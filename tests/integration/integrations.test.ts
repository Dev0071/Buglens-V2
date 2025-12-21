/**
 * Integrations API Integration Tests
 *
 * Tests for:
 * - GET /api/integrations (list all)
 * - GET /api/integrations/:id (single integration)
 * - POST /api/integrations/:type/connect (create/connect)
 * - DELETE /api/integrations/:id (disconnect)
 * - POST /api/integrations/:id/verify (test connection)
 *
 * Test coverage includes:
 * - Positive cases (valid CRUD operations)
 * - Negative cases (invalid types, missing data)
 * - Edge cases (duplicates, reconnection)
 * - Security (org isolation, config masking)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { server } from "../../src/api/app.js";
import {
  TEST_ORG_ID,
  SECOND_TEST_ORG_ID,
  createAuthHeaders,
  ensureTestOrg,
  cleanupTestData,
  insertIntegration,
  createIntegrationData,
  // Reserved for future test utilities
  type SeedIntegration as _SeedIntegration,
  ensureSecondTestOrg,
  cleanupSecondTestOrg,
} from "../helpers/test-utils.js";
import { query } from "../../src/db/client.js";

describe("Integrations API", () => {
  beforeAll(async () => {
    await server.ready();
    await ensureTestOrg();
  });

  afterAll(async () => {
    await cleanupTestData();
    await server.close();
  });

  beforeEach(async () => {
    await cleanupTestData();
    await ensureTestOrg();
  });

  // ==========================================
  // GET /api/integrations
  // ==========================================
  describe("GET /api/integrations", () => {
    describe("Positive Cases", () => {
      it("should return all supported integration types", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/integrations",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // API returns all 5 supported types (configured or not)
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(5);
        const types = body.map((i: { type: string }) => i.type);
        expect(types).toContain("sentry");
        expect(types).toContain("github");
        expect(types).toContain("slack");
        expect(types).toContain("jira");
        expect(types).toContain("teams");
      });

      it("should show configured integrations as connected", async () => {
        // Seed integrations
        await insertIntegration(createIntegrationData("sentry"));
        await insertIntegration(createIntegrationData("github"));

        const response = await server.inject({
          method: "GET",
          url: "/api/integrations",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // Find configured integrations
        const sentry = body.find((i: { type: string }) => i.type === "sentry");
        const github = body.find((i: { type: string }) => i.type === "github");

        expect(sentry.status).toBe("connected");
        expect(github.status).toBe("connected");
      });

      it("should return integrations with correct structure", async () => {
        await insertIntegration(createIntegrationData("sentry"));

        const response = await server.inject({
          method: "GET",
          url: "/api/integrations",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        const sentry = body.find((i: { type: string }) => i.type === "sentry");
        expect(sentry).toHaveProperty("id");
        expect(sentry).toHaveProperty("type");
        expect(sentry).toHaveProperty("name");
        expect(sentry).toHaveProperty("status");
        expect(sentry).toHaveProperty("configuredAt");
      });

      it("should return safe metadata without sensitive data", async () => {
        await insertIntegration(createIntegrationData("slack"));

        const response = await server.inject({
          method: "GET",
          url: "/api/integrations",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        const slack = body.find((i: { type: string }) => i.type === "slack");
        // Metadata should not include raw config with secrets
        if (slack.metadata) {
          expect(slack.metadata).not.toHaveProperty("webhook_url");
          expect(slack.metadata).not.toHaveProperty("bot_token");
        }
      });
    });

    describe("Security Cases", () => {
      it("should return 401 without org context", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/integrations",
          headers: { "Content-Type": "application/json" },
        });

        expect(response.statusCode).toBe(401);
      });

      it("should isolate integrations by organization", async () => {
        // Create integrations for test org
        await insertIntegration(createIntegrationData("sentry"));

        // Create second org with integration
        await cleanupSecondTestOrg();
        await query("DELETE FROM organizations WHERE id = $1", [
          SECOND_TEST_ORG_ID,
        ]);
        await query(
          `INSERT INTO organizations (id, name, slug, plan, created_at, updated_at)
           VALUES ($1, $2, $3, 'free', NOW(), NOW())`,
          [SECOND_TEST_ORG_ID, "Second Org", "second-org"]
        );

        await insertIntegration(
          createIntegrationData("github", { org_id: SECOND_TEST_ORG_ID })
        );

        // Query with test org
        const response = await server.inject({
          method: "GET",
          url: "/api/integrations",
          headers: createAuthHeaders(TEST_ORG_ID),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // API returns all 3 types, but only test org's sentry should be connected
        const sentry = body.find((i: { type: string }) => i.type === "sentry");
        const github = body.find((i: { type: string }) => i.type === "github");

        expect(sentry.status).toBe("connected");
        expect(github.status).toBe("disconnected"); // Second org's github not visible

        // Cleanup
        await cleanupSecondTestOrg();
        await query("DELETE FROM organizations WHERE id = $1", [
          SECOND_TEST_ORG_ID,
        ]);
      });
    });
  });

  // ==========================================
  // GET /api/integrations/:id
  // ==========================================
  describe("GET /api/integrations/:id", () => {
    describe("Positive Cases", () => {
      it("should return single integration by ID", async () => {
        const integration = await insertIntegration(
          createIntegrationData("sentry")
        );

        const response = await server.inject({
          method: "GET",
          url: `/api/integrations/${integration.id}`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.id).toBe(integration.id);
        expect(body.type).toBe("sentry");
        expect(body.status).toBe("connected");
      });

      it("should include metadata details", async () => {
        const integration = await insertIntegration(
          createIntegrationData("github")
        );

        const response = await server.inject({
          method: "GET",
          url: `/api/integrations/${integration.id}`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // API returns metadata, not raw config
        expect(body).toHaveProperty("metadata");
      });
    });

    describe("Negative Cases", () => {
      it("should return 404 for non-existent integration", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/integrations/00000000-0000-0000-0000-000000000001",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(404);
      });

      it("should return 400 for invalid UUID format", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/integrations/not-a-uuid",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe("Security Cases", () => {
      it("should return 401 without org context", async () => {
        const integration = await insertIntegration(
          createIntegrationData("sentry")
        );

        const response = await server.inject({
          method: "GET",
          url: `/api/integrations/${integration.id}`,
          headers: { "Content-Type": "application/json" },
        });

        expect(response.statusCode).toBe(401);
      });

      it("should return 404 for integration from different org", async () => {
        // Create second org with integration
        await ensureSecondTestOrg();

        const otherIntegration = await insertIntegration(
          createIntegrationData("sentry", { org_id: SECOND_TEST_ORG_ID })
        );

        // Try to access with test org
        const response = await server.inject({
          method: "GET",
          url: `/api/integrations/${otherIntegration.id}`,
          headers: createAuthHeaders(TEST_ORG_ID),
        });

        expect(response.statusCode).toBe(404);

        // Cleanup
        await cleanupSecondTestOrg();
      });
    });
  });

  // ==========================================
  // POST /api/integrations/:type/connect
  // ==========================================
  describe("POST /api/integrations/:type/connect", () => {
    describe("Positive Cases", () => {
      it("should create Sentry integration", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/integrations/sentry/connect",
          headers: createAuthHeaders(),
          payload: {
            config: {
              dsn: "https://test@sentry.io/12345",
              project_slug: "my-project",
              organization_slug: "my-org",
            },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // API returns {success, integrationId, message}
        expect(body.success).toBe(true);
        expect(body).toHaveProperty("integrationId");
        expect(body.message).toContain("Sentry");
      });

      it("should create GitHub integration", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/integrations/github/connect",
          headers: createAuthHeaders(),
          payload: {
            config: {
              installation_id: 12345,
              owner: "test-owner",
              repos: ["repo-1", "repo-2"],
            },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.success).toBe(true);
        expect(body.message).toContain("GitHub");
      });

      it("should create Slack integration", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/integrations/slack/connect",
          headers: createAuthHeaders(),
          payload: {
            config: {
              webhook_url: "https://hooks.slack.com/services/xxx",
              channel: "#errors",
            },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.success).toBe(true);
        expect(body.message).toContain("Slack");
      });

      it("should return integration ID on connect", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/integrations/sentry/connect",
          headers: createAuthHeaders(),
          payload: {
            config: {
              dsn: "https://test@sentry.io/12345",
              project_slug: "my-project",
            },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.integrationId).toBeDefined();
        // UUID format
        expect(body.integrationId).toMatch(/^[0-9a-f-]{36}$/i);
      });
    });

    describe("Negative Cases", () => {
      it("should reject invalid integration type", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/integrations/invalid/connect",
          headers: createAuthHeaders(),
          payload: { config: { key: "value" } },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBe("Bad Request");
      });

      it("should accept empty config (optional)", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/integrations/sentry/connect",
          headers: createAuthHeaders(),
          payload: {},
        });

        // Empty payload has default empty config, which is valid
        expect(response.statusCode).toBe(200);
      });

      it("should accept partial config", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/integrations/github/connect",
          headers: createAuthHeaders(),
          payload: { config: { owner: "test" } }, // Partial config is OK
        });

        // API accepts any config object
        expect(response.statusCode).toBe(200);
      });
    });

    describe("Edge Cases", () => {
      it("should handle reconnection of existing integration type", async () => {
        // Create first integration
        await insertIntegration(createIntegrationData("sentry"));

        // Try to create another sentry integration
        const response = await server.inject({
          method: "POST",
          url: "/api/integrations/sentry/connect",
          headers: createAuthHeaders(),
          payload: {
            dsn: "https://new@sentry.io/54321",
            project_slug: "new-project",
          },
        });

        // Should either update existing or reject duplicate
        expect([200, 201, 409]).toContain(response.statusCode);
      });
    });

    describe("Security Cases", () => {
      it("should return 401 without org context", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/integrations/sentry/connect",
          headers: { "Content-Type": "application/json" },
          payload: {
            dsn: "https://test@sentry.io/12345",
          },
        });

        expect(response.statusCode).toBe(401);
      });
    });
  });

  // ==========================================
  // DELETE /api/integrations/:id
  // ==========================================
  describe("DELETE /api/integrations/:id", () => {
    describe("Positive Cases", () => {
      it("should disconnect integration successfully", async () => {
        const integration = await insertIntegration(
          createIntegrationData("sentry")
        );

        const response = await server.inject({
          method: "DELETE",
          url: `/api/integrations/${integration.id}`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.success).toBe(true);
        expect(body.message).toContain("disconnected");
      });

      it("should mark integration as disconnected after deletion", async () => {
        const integration = await insertIntegration(
          createIntegrationData("sentry")
        );

        // Soft delete
        await server.inject({
          method: "DELETE",
          url: `/api/integrations/${integration.id}`,
          headers: createAuthHeaders(),
        });

        // Verify integration shows as disconnected
        const listResponse = await server.inject({
          method: "GET",
          url: "/api/integrations",
          headers: createAuthHeaders(),
        });

        const listBody = listResponse.json();
        const sentry = listBody.find(
          (i: { type: string }) => i.type === "sentry"
        );
        // After soft delete, sentry should show as disconnected
        expect(sentry.status).toBe("disconnected");
      });
    });

    describe("Negative Cases", () => {
      it("should return 404 for non-existent integration", async () => {
        const response = await server.inject({
          method: "DELETE",
          url: "/api/integrations/00000000-0000-0000-0000-000000000001",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(404);
      });

      it("should return 400 for invalid UUID", async () => {
        const response = await server.inject({
          method: "DELETE",
          url: "/api/integrations/invalid-uuid",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe("Security Cases", () => {
      it("should return 401 without org context", async () => {
        const integration = await insertIntegration(
          createIntegrationData("sentry")
        );

        const response = await server.inject({
          method: "DELETE",
          url: `/api/integrations/${integration.id}`,
          headers: { "Content-Type": "application/json" },
        });

        expect(response.statusCode).toBe(401);
      });

      it("should not allow deleting integration from different org", async () => {
        // Create second org
        await ensureSecondTestOrg();

        const otherIntegration = await insertIntegration(
          createIntegrationData("github", { org_id: SECOND_TEST_ORG_ID })
        );

        // Try to delete with test org
        const response = await server.inject({
          method: "DELETE",
          url: `/api/integrations/${otherIntegration.id}`,
          headers: createAuthHeaders(TEST_ORG_ID),
        });

        expect(response.statusCode).toBe(404);

        // Verify still exists
        const checkResult = await query(
          "SELECT id FROM integrations WHERE id = $1",
          [otherIntegration.id]
        );
        expect(checkResult.rows.length).toBe(1);

        // Cleanup
        await cleanupSecondTestOrg();
      });
    });

    describe("Idempotency", () => {
      it("should allow repeated disconnects (idempotent)", async () => {
        const integration = await insertIntegration(
          createIntegrationData("sentry")
        );

        // First disconnect
        const response1 = await server.inject({
          method: "DELETE",
          url: `/api/integrations/${integration.id}`,
          headers: createAuthHeaders(),
        });
        expect(response1.statusCode).toBe(200);

        // Second disconnect - soft delete is idempotent
        const response2 = await server.inject({
          method: "DELETE",
          url: `/api/integrations/${integration.id}`,
          headers: createAuthHeaders(),
        });
        // With soft-delete, second call also succeeds (record still exists, just inactive)
        expect(response2.statusCode).toBe(200);
      });
    });
  });

  // ==========================================
  // POST /api/integrations/:id/verify
  // ==========================================
  describe("POST /api/integrations/:id/verify", () => {
    describe("Positive Cases", () => {
      it("should verify connected integration", async () => {
        const integration = await insertIntegration(
          createIntegrationData("sentry")
        );

        const response = await server.inject({
          method: "POST",
          url: `/api/integrations/${integration.id}/verify`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // API returns {success, verified, verifiedAt}
        expect(body).toHaveProperty("success");
        expect(body).toHaveProperty("verified");
        expect(body).toHaveProperty("verifiedAt");
      });

      it("should return verification result", async () => {
        const integration = await insertIntegration(
          createIntegrationData("github")
        );

        const response = await server.inject({
          method: "POST",
          url: `/api/integrations/${integration.id}/verify`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // Verify response structure
        expect(body.success).toBe(true);
        expect(body.verified).toBe(true);
        expect(typeof body.verifiedAt).toBe("string");
      });
    });

    describe("Negative Cases", () => {
      it("should return 404 for non-existent integration", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/integrations/00000000-0000-0000-0000-000000000001/verify",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(404);
      });

      it("should return 400 for invalid UUID", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/integrations/invalid-uuid/verify",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe("Security Cases", () => {
      it("should return 401 without org context", async () => {
        const integration = await insertIntegration(
          createIntegrationData("sentry")
        );

        const response = await server.inject({
          method: "POST",
          url: `/api/integrations/${integration.id}/verify`,
          headers: { "Content-Type": "application/json" },
        });

        expect(response.statusCode).toBe(401);
      });

      it("should not allow verifying integration from different org", async () => {
        // Create second org
        await ensureSecondTestOrg();

        const otherIntegration = await insertIntegration(
          createIntegrationData("slack", { org_id: SECOND_TEST_ORG_ID })
        );

        const response = await server.inject({
          method: "POST",
          url: `/api/integrations/${otherIntegration.id}/verify`,
          headers: createAuthHeaders(TEST_ORG_ID),
        });

        expect(response.statusCode).toBe(404);

        // Cleanup
        await cleanupSecondTestOrg();
      });
    });
  });
});
