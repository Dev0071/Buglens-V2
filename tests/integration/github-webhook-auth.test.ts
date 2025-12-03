import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import crypto from "crypto";
import { server } from "../../src/api/app.js";
import { config } from "../../src/utils/config.js";
import { pool } from "../../src/db/client.js";

const TEST_SECRET = "test-github-webhook-secret";
const TEST_SLUG = "test-org";

function signPayload(payload: object): string {
  const json = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", TEST_SECRET);
  hmac.update(json);
  return `sha256=${hmac.digest("hex")}`;
}

const installationPayload = {
  action: "created" as const,
  installation: {
    id: 987654321,
    account: {
      login: TEST_SLUG,
      id: 42,
      type: "Organization" as const,
    },
    repository_selection: "selected" as const,
    target_type: "Organization" as const,
  },
  repositories: [
    {
      id: 1,
      name: "sample-repo",
      full_name: `${TEST_SLUG}/sample-repo`,
      private: false,
      default_branch: "main",
    },
  ],
  sender: { login: "tester" },
};

async function postGithubWebhook(
  event: string,
  payload: object,
  signatureOverride?: string
) {
  const signature =
    signatureOverride ??
    (config.GITHUB_WEBHOOK_SECRET ? signPayload(payload) : undefined);

  return server.inject({
    method: "POST",
    url: "/api/v1/webhooks/github",
    payload,
    headers: {
      "x-github-event": event,
      "x-github-delivery": "test-delivery",
      ...(signature ? { "x-hub-signature-256": signature } : {}),
    },
  });
}

describe("GitHub Webhook Signatures", () => {
  beforeAll(async () => {
    config.GITHUB_WEBHOOK_SECRET = TEST_SECRET;
    await server.ready();
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM repos WHERE org_id IN (SELECT id FROM organizations WHERE slug = $1)",
      [TEST_SLUG]
    );
    await pool.query("DELETE FROM organizations WHERE slug = $1", [TEST_SLUG]);
    await server.close();
  });

  beforeEach(async () => {
    await pool.query(
      "DELETE FROM repos WHERE org_id IN (SELECT id FROM organizations WHERE slug = $1)",
      [TEST_SLUG]
    );
    await pool.query("DELETE FROM organizations WHERE slug = $1", [TEST_SLUG]);
  });

  it("accepts webhook with valid signature", async () => {
    const response = await postGithubWebhook(
      "installation",
      installationPayload
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("processed");
    expect(body.event).toBe("installation");

    const orgResult = await pool.query(
      "SELECT id FROM organizations WHERE slug = $1",
      [TEST_SLUG]
    );
    expect(orgResult.rows.length).toBe(1);

    const repoResult = await pool.query(
      "SELECT full_name FROM repos WHERE org_id = $1",
      [orgResult.rows[0].id]
    );
    expect(repoResult.rows.map((row) => row.full_name)).toContain(
      `${TEST_SLUG}/sample-repo`
    );
  });

  it("rejects webhook with invalid signature", async () => {
    const response = await postGithubWebhook(
      "installation",
      installationPayload,
      "sha256=invalid"
    );

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("Invalid signature");

    const orgResult = await pool.query(
      "SELECT id FROM organizations WHERE slug = $1",
      [TEST_SLUG]
    );
    expect(orgResult.rows.length).toBe(0);
  });

  it("registers additional repositories on installation_repositories.added", async () => {
    await postGithubWebhook("installation", installationPayload);

    const repositoriesAddedPayload = {
      action: "added" as const,
      installation: installationPayload.installation,
      repositories_added: [
        {
          id: 2,
          name: "second-repo",
          full_name: `${TEST_SLUG}/second-repo`,
          private: false,
          default_branch: "develop",
        },
      ],
    };

    const addResponse = await postGithubWebhook(
      "installation_repositories",
      repositoriesAddedPayload
    );

    expect(addResponse.statusCode).toBe(200);

    const orgResult = await pool.query(
      "SELECT id FROM organizations WHERE slug = $1",
      [TEST_SLUG]
    );
    const repoResult = await pool.query(
      "SELECT name, default_branch FROM repos WHERE org_id = $1 ORDER BY name",
      [orgResult.rows[0].id]
    );

    expect(repoResult.rows).toEqual([
      { name: "sample-repo", default_branch: "main" },
      { name: "second-repo", default_branch: "develop" },
    ]);
  });

  it("marks repositories inactive on installation_repositories.removed", async () => {
    await postGithubWebhook("installation", installationPayload);

    const orgResult = await pool.query(
      "SELECT id FROM organizations WHERE slug = $1",
      [TEST_SLUG]
    );
    const orgId = orgResult.rows[0].id;

    const removePayload = {
      action: "removed" as const,
      installation: installationPayload.installation,
      repositories_removed: [
        {
          id: 1,
          name: "sample-repo",
          full_name: `${TEST_SLUG}/sample-repo`,
          private: false,
          default_branch: "main",
        },
      ],
    };

    const removeResponse = await postGithubWebhook(
      "installation_repositories",
      removePayload
    );

    expect(removeResponse.statusCode).toBe(200);

    const repoResult = await pool.query(
      "SELECT is_active FROM repos WHERE org_id = $1 AND full_name = $2",
      [orgId, `${TEST_SLUG}/sample-repo`]
    );
    expect(repoResult.rows[0].is_active).toBe(false);
  });

  it("performs a single bulk insert for large installations", async () => {
    const largeInstallationPayload = {
      ...installationPayload,
      repositories: Array.from({ length: 50 }, (_, index) => ({
        id: index + 1,
        name: `repo-${index + 1}`,
        full_name: `${TEST_SLUG}/repo-${index + 1}`,
        private: false,
        default_branch: index % 2 === 0 ? "main" : "develop",
      })),
    } as const;

    const querySpy = vi.spyOn(pool, "query");

    try {
      const response = await postGithubWebhook(
        "installation",
        largeInstallationPayload
      );

      expect(response.statusCode).toBe(200);

      const repoInsertCalls = querySpy.mock.calls.filter(([queryArg]) => {
        if (typeof queryArg === "string") {
          return queryArg.includes("INSERT INTO repos");
        }

        if (
          queryArg !== null &&
          typeof queryArg === "object" &&
          "text" in queryArg &&
          typeof (queryArg as Record<string, unknown>).text === "string"
        ) {
          const text = (queryArg as { text: string }).text;
          return text.includes("INSERT INTO repos");
        }
        return false;
      });

      expect(repoInsertCalls.length).toBe(1);

      const orgResult = await pool.query(
        "SELECT id FROM organizations WHERE slug = $1",
        [TEST_SLUG]
      );
      const orgId = orgResult.rows[0].id;

      const repoCountResult = await pool.query(
        "SELECT COUNT(*)::int FROM repos WHERE org_id = $1",
        [orgId]
      );
      expect(repoCountResult.rows[0].count).toBe(50);
    } finally {
      querySpy.mockRestore();
    }
  });
});
