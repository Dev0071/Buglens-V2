import { describe, it, expect, vi, beforeEach } from "vitest";
import { normaliseSha, isValidSha } from "../../src/services/deployment-tracker.js";

// ============================================================================
// Pure function tests (no mocks needed)
// ============================================================================

describe("normaliseSha", () => {
  it("lowercases and trims", () => {
    expect(normaliseSha("  ABC123  ")).toBe("abc123");
    expect(normaliseSha("DEADBEEF1234567890")).toBe("deadbeef1234567890");
  });
});

describe("isValidSha", () => {
  it("accepts 7-char abbreviated SHA", () => {
    expect(isValidSha("abc1234")).toBe(true);
  });

  it("accepts full 40-char SHA", () => {
    expect(isValidSha("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")).toBe(true);
  });

  it("rejects non-hex strings", () => {
    expect(isValidSha("not-a-sha")).toBe(false);
    expect(isValidSha("unknown")).toBe(false);
    expect(isValidSha("v1.2.3")).toBe(false);
  });

  it("rejects SHAs shorter than 7 chars", () => {
    expect(isValidSha("abc12")).toBe(false);
  });

  it("rejects SHAs longer than 40 chars", () => {
    expect(isValidSha("a".repeat(41))).toBe(false);
  });
});

// ============================================================================
// recordDeployment / resolveDeploymentAtTime — DB interaction tests
// ============================================================================

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/db/client.js", () => ({
  query: vi.fn(),
  transaction: vi.fn((_orgId, fn) =>
    fn({
      query: vi.fn().mockResolvedValue({ rows: [{ id: "dep-1", commit_sha: "abc1234", repo_full_name: "owner/repo", environment: "production", deployed_at: new Date(), source: "api" }] }),
    })
  ),
}));

describe("resolveDeploymentAtTime", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no row matches", async () => {
    const { query } = await import("../../src/db/client.js");
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);

    const { resolveDeploymentAtTime } = await import("../../src/services/deployment-tracker.js");
    const result = await resolveDeploymentAtTime("org-1", "owner/repo", "production", new Date());
    expect(result).toBeNull();
  });

  it("returns the matched deployment when a row exists", async () => {
    const { query } = await import("../../src/db/client.js");
    const deployed_at = new Date("2026-05-01T12:00:00Z");
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{
        commit_sha: "abc1234567890",
        repo_full_name: "owner/repo",
        environment: "production",
        deployed_at,
        source: "api",
      }],
    } as never);

    const { resolveDeploymentAtTime } = await import("../../src/services/deployment-tracker.js");
    const result = await resolveDeploymentAtTime("org-1", "owner/repo", "production", new Date());
    expect(result).not.toBeNull();
    expect(result?.commit_sha).toBe("abc1234567890");
    expect(result?.source).toBe("api");
  });
});

describe("trackDeploySchema validation", () => {
  it("rejects invalid repo format", async () => {
    const { trackDeploySchema } = await import("../../src/types/deployment.js");
    const result = trackDeploySchema.safeParse({ repo: "notarepo", sha: "abc1234" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid SHA", async () => {
    const { trackDeploySchema } = await import("../../src/types/deployment.js");
    const result = trackDeploySchema.safeParse({ repo: "owner/repo", sha: "not-a-sha" });
    expect(result.success).toBe(false);
  });

  it("accepts minimal valid payload", async () => {
    const { trackDeploySchema } = await import("../../src/types/deployment.js");
    const result = trackDeploySchema.safeParse({ repo: "owner/repo", sha: "abc1234" });
    expect(result.success).toBe(true);
    expect(result.data?.environment).toBe("production"); // default applied
  });

  it("accepts full payload", async () => {
    const { trackDeploySchema } = await import("../../src/types/deployment.js");
    const result = trackDeploySchema.safeParse({
      repo: "owner/repo",
      sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      environment: "staging",
      branch: "main",
      deployer: "github-actions",
      deployed_at: "2026-05-07T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });
});
