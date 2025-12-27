/**
 * Integration Tokens Service Tests
 *
 * Tests for:
 * - Token storage and retrieval
 * - Encryption/decryption of tokens
 * - GitHub installation storage
 * - Slack workspace storage
 * - Token expiry detection
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database
const mockQuery = vi.fn();
vi.mock("../../src/db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Mock crypto service
const mockEncrypt = vi.fn();
const mockDecrypt = vi.fn();
vi.mock("../../src/services/crypto.js", () => ({
  encryptJsonForOrg: (...args: unknown[]) => mockEncrypt(...args),
  decryptJsonForOrg: (...args: unknown[]) => mockDecrypt(...args),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  storeIntegrationTokens,
  getIntegrationTokens,
  getIntegrationTokensByType,
  updateIntegrationTokens,
  updateIntegrationStatus,
  recordIntegrationUsage,
  getOrganizationIntegrations,
  disconnectIntegration,
  checkTokensNeedRefresh,
  storeGitHubInstallation,
  storeSlackWorkspace,
  type StoredTokens,
  type GitHubInstallation,
  type SlackWorkspace,
} from "../../src/services/integration-tokens.js";

describe("Integration Tokens Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEncrypt.mockReturnValue({ version: 1, data: "encrypted-data" });
    mockDecrypt.mockImplementation((_data) => ({
      accessToken: "decrypted-token",
      refreshToken: "decrypted-refresh",
      tokenType: "Bearer",
    }));
  });

  describe("storeIntegrationTokens", () => {
    it("should store encrypted tokens and return integration ID", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "int-123" }],
      });

      const tokens: StoredTokens = {
        accessToken: "gho_xxxxx",
        refreshToken: "ghr_xxxxx",
        tokenType: "Bearer",
        scope: "repo read:user",
        expiresAt: new Date("2025-01-01"),
      };

      const id = await storeIntegrationTokens("org-123", "github", tokens, {
        displayName: "GitHub - buglens/repo",
      });

      expect(id).toBe("int-123");
      expect(mockEncrypt).toHaveBeenCalledWith(tokens, "org-123");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO integrations"),
        expect.arrayContaining(["org-123", "github"])
      );
    });

    it("should upsert on conflict", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "int-123" }],
      });

      const tokens: StoredTokens = {
        accessToken: "new-token",
        tokenType: "Bearer",
      };

      await storeIntegrationTokens("org-123", "github", tokens, {
        displayName: "GitHub",
        externalId: "user-456",
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("ON CONFLICT"),
        expect.any(Array)
      );
    });
  });

  describe("getIntegrationTokens", () => {
    it("should retrieve and decrypt tokens", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            encrypted_tokens: '{"version":1,"data":"encrypted"}',
            org_id: "org-123",
          },
        ],
      });

      const tokens = await getIntegrationTokens("org-123", "int-456");

      expect(tokens).not.toBeNull();
      expect(mockDecrypt).toHaveBeenCalled();
    });

    it("should return null for disconnected integration", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const tokens = await getIntegrationTokens("org-123", "nonexistent");

      expect(tokens).toBeNull();
    });

    it("should verify org_id matches", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Query should include org_id check
      await getIntegrationTokens("org-123", "int-456");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("org_id = $2"),
        expect.arrayContaining(["org-123"])
      );
    });
  });

  describe("getIntegrationTokensByType", () => {
    it("should retrieve tokens by type (e.g., github)", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "int-123",
            encrypted_tokens: '{"version":1,"data":"encrypted"}',
          },
        ],
      });

      const result = await getIntegrationTokensByType("org-123", "github");

      expect(result).not.toBeNull();
      expect(result?.integrationId).toBe("int-123");
    });

    it("should return most recently updated if multiple exist", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "newest-int", encrypted_tokens: "{}" }],
      });

      await getIntegrationTokensByType("org-123", "slack");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY updated_at DESC"),
        expect.any(Array)
      );
    });
  });

  describe("updateIntegrationTokens", () => {
    it("should update tokens after refresh", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const newTokens: StoredTokens = {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        tokenType: "Bearer",
        expiresAt: new Date(),
      };

      await updateIntegrationTokens("org-123", "int-456", newTokens);

      expect(mockEncrypt).toHaveBeenCalledWith(newTokens, "org-123");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE integrations"),
        expect.arrayContaining(["int-456", "org-123"])
      );
    });
  });

  describe("updateIntegrationStatus", () => {
    it("should update status to error with message", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await updateIntegrationStatus(
        "org-123",
        "int-456",
        "error",
        "Token refresh failed"
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = $1"),
        expect.arrayContaining(["error"])
      );
    });

    it("should update status without error message", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await updateIntegrationStatus("org-123", "int-456", "connected");

      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe("recordIntegrationUsage", () => {
    it("should update last_used_at timestamp", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await recordIntegrationUsage("org-123", "int-456");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("last_used_at = NOW()"),
        expect.arrayContaining(["int-456", "org-123"])
      );
    });
  });

  describe("getOrganizationIntegrations", () => {
    it("should return all integrations for an org", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "int-1",
            org_id: "org-123",
            type: "github",
            status: "connected",
            display_name: "GitHub",
            external_id: "user-1",
            metadata: {},
            created_at: new Date(),
            updated_at: new Date(),
            last_used_at: null,
            expires_at: null,
          },
          {
            id: "int-2",
            org_id: "org-123",
            type: "slack",
            status: "connected",
            display_name: "Slack Workspace",
            external_id: "T123",
            metadata: { team_name: "Test" },
            created_at: new Date(),
            updated_at: new Date(),
            last_used_at: new Date(),
            expires_at: null,
          },
        ],
      });

      const integrations = await getOrganizationIntegrations("org-123");

      expect(integrations).toHaveLength(2);
      expect(integrations[0].type).toBe("github");
      expect(integrations[1].type).toBe("slack");
    });

    it("should return empty array for org with no integrations", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const integrations = await getOrganizationIntegrations("empty-org");

      expect(integrations).toEqual([]);
    });
  });

  describe("disconnectIntegration", () => {
    it("should set status to disconnected and clear tokens", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const result = await disconnectIntegration("org-123", "int-456");

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("encrypted_tokens = NULL"),
        expect.arrayContaining(["int-456", "org-123"])
      );
    });

    it("should return false if integration not found", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const result = await disconnectIntegration("org-123", "nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("checkTokensNeedRefresh", () => {
    it("should return true if tokens expire within threshold", async () => {
      // Mock getIntegrationTokens query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            encrypted_tokens: '{"version":1,"data":"encrypted"}',
            org_id: "org-123",
          },
        ],
      });

      // Mock decrypt to return tokens with near expiry
      mockDecrypt.mockReturnValueOnce({
        accessToken: "token",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresAt: new Date(Date.now() + 3 * 60 * 1000), // 3 minutes
      });

      const { needsRefresh } = await checkTokensNeedRefresh(
        "org-123",
        "int-456"
      );

      expect(needsRefresh).toBe(true);
    });

    it("should return false if tokens have plenty of time", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            encrypted_tokens: '{"version":1,"data":"encrypted"}',
            org_id: "org-123",
          },
        ],
      });

      mockDecrypt.mockReturnValueOnce({
        accessToken: "token",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      });

      const { needsRefresh } = await checkTokensNeedRefresh(
        "org-123",
        "int-456"
      );

      expect(needsRefresh).toBe(false);
    });

    it("should return false if no expiry set", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            encrypted_tokens: '{"version":1,"data":"encrypted"}',
            org_id: "org-123",
          },
        ],
      });

      mockDecrypt.mockReturnValueOnce({
        accessToken: "token",
        tokenType: "Bearer",
        // No expiresAt
      });

      const { needsRefresh } = await checkTokensNeedRefresh(
        "org-123",
        "int-456"
      );

      expect(needsRefresh).toBe(false);
    });
  });
});

describe("GitHub Installation Storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEncrypt.mockReturnValue({ version: 1, data: "encrypted" });
  });

  it("should store GitHub App installation details", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "int-gh-123" }],
    });

    const installation: GitHubInstallation = {
      installationId: 12345678,
      permissions: { contents: "read", issues: "write" },
      repositorySelection: "selected",
      account: {
        id: 98765,
        login: "test-org",
        type: "Organization",
        avatarUrl: "https://github.com/avatar.png",
      },
    };

    const id = await storeGitHubInstallation("org-123", installation);

    expect(id).toBe("int-gh-123");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO integrations"),
      expect.arrayContaining([
        "org-123",
        "test-org (Organization)", // display_name
        "12345678", // external_id (installationId as string)
      ])
    );
  });
});

describe("Slack Workspace Storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEncrypt.mockReturnValue({ version: 1, data: "encrypted" });
  });

  it("should store Slack workspace with webhook", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "int-slack-123" }],
    });

    const workspace: SlackWorkspace = {
      teamId: "T123ABC",
      teamName: "Test Workspace",
      botUserId: "U456DEF",
      accessToken: "xoxb-token",
      scope: "chat:write,channels:read",
      incomingWebhook: {
        channel: "#alerts",
        channelId: "C789",
        configurationUrl: "https://slack.com/config",
        url: "https://hooks.slack.com/services/xxx",
      },
    };

    const id = await storeSlackWorkspace("org-123", workspace);

    expect(id).toBe("int-slack-123");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO integrations"),
      expect.arrayContaining(["org-123", "slack"])
    );
  });

  it("should store Slack workspace without webhook", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "int-slack-456" }],
    });

    const workspace: SlackWorkspace = {
      teamId: "T123ABC",
      teamName: "Test Workspace",
      botUserId: "U456DEF",
      accessToken: "xoxb-token",
      scope: "chat:write",
      // No incomingWebhook
    };

    const id = await storeSlackWorkspace("org-123", workspace);

    expect(id).toBe("int-slack-456");
  });
});

describe("Token Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should never return raw tokens in integration list", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "int-1",
          org_id: "org-123",
          type: "github",
          status: "connected",
          display_name: "GitHub",
          external_id: null,
          metadata: {},
          created_at: new Date(),
          updated_at: new Date(),
          last_used_at: null,
          expires_at: null,
          // encrypted_tokens should NOT be returned in list
        },
      ],
    });

    const integrations = await getOrganizationIntegrations("org-123");

    // Tokens should not be in the result
    for (const integration of integrations) {
      expect(integration).not.toHaveProperty("accessToken");
      expect(integration).not.toHaveProperty("refreshToken");
      expect(integration).not.toHaveProperty("encrypted_tokens");
    }
  });

  it("should use org-specific encryption key", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "int-1" }] });

    const tokens: StoredTokens = {
      accessToken: "secret-token",
      tokenType: "Bearer",
    };

    await storeIntegrationTokens("org-123", "github", tokens, {
      displayName: "GitHub",
    });

    // Verify encryptJsonForOrg was called with orgId
    expect(mockEncrypt).toHaveBeenCalledWith(tokens, "org-123");
  });
});
