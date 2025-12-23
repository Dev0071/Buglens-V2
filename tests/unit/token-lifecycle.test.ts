/**
 * Token Lifecycle Service Tests
 *
 * Tests for:
 * - Token refresh logic
 * - Health check functionality
 * - Revocation flows
 * - Scheduled job handlers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock database
const mockQuery = vi.fn();
vi.mock("../../src/db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Mock platform credentials
vi.mock("../../src/services/platform-credentials.js", () => ({
  platformCredentials: {
    getGoogleOAuth: vi.fn().mockReturnValue({
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
    }),
    getSlackApp: vi.fn().mockReturnValue({
      clientId: "slack-client-id",
      clientSecret: "slack-client-secret",
    }),
    getJiraOAuth: vi.fn().mockReturnValue({
      clientId: "jira-client-id",
      clientSecret: "jira-client-secret",
    }),
    getTeamsOAuth: vi.fn().mockReturnValue({
      clientId: "teams-client-id",
      clientSecret: "teams-client-secret",
      tenantId: "common",
    }),
  },
}));

// Mock integration tokens
const mockGetIntegrationTokens = vi.fn();
const mockUpdateIntegrationTokens = vi.fn();
const mockUpdateIntegrationStatus = vi.fn();
const mockCheckTokensNeedRefresh = vi.fn();

vi.mock("../../src/services/integration-tokens.js", () => ({
  getIntegrationTokens: (...args: unknown[]) =>
    mockGetIntegrationTokens(...args),
  updateIntegrationTokens: (...args: unknown[]) =>
    mockUpdateIntegrationTokens(...args),
  updateIntegrationStatus: (...args: unknown[]) =>
    mockUpdateIntegrationStatus(...args),
  checkTokensNeedRefresh: (...args: unknown[]) =>
    mockCheckTokensNeedRefresh(...args),
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
  checkOrganizationTokenHealth,
  refreshIntegrationTokens,
  refreshAllExpiringTokens,
  revokeIntegrationTokens,
  tokenRefreshJobHandler,
  tokenHealthCheckJobHandler,
} from "../../src/services/token-lifecycle.js";

describe("Token Lifecycle Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe("checkOrganizationTokenHealth", () => {
    it("should return healthy status for non-expiring tokens", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "int-1",
            type: "github",
            status: "connected",
            expires_at: null, // No expiry
          },
          {
            id: "int-2",
            type: "slack",
            status: "connected",
            expires_at: null,
          },
        ],
      });

      const results = await checkOrganizationTokenHealth("org-123");

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe("healthy");
      expect(results[1].status).toBe("healthy");
    });

    it("should return expiring status for soon-to-expire tokens", async () => {
      const soonExpiry = new Date(Date.now() + 3 * 60 * 1000); // 3 minutes

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "int-1",
            type: "google",
            status: "connected",
            expires_at: soonExpiry,
          },
        ],
      });

      const results = await checkOrganizationTokenHealth("org-123");

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("expiring");
      expect(results[0].message).toContain("minutes");
    });

    it("should return expired status for past tokens", async () => {
      const pastExpiry = new Date(Date.now() - 60 * 1000); // 1 minute ago

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "int-1",
            type: "google",
            status: "connected",
            expires_at: pastExpiry,
          },
        ],
      });

      const results = await checkOrganizationTokenHealth("org-123");

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("expired");
    });

    it("should handle organizations with no integrations", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const results = await checkOrganizationTokenHealth("org-empty");

      expect(results).toHaveLength(0);
    });
  });

  describe("refreshIntegrationTokens", () => {
    it("should successfully refresh Google tokens", async () => {
      mockGetIntegrationTokens.mockResolvedValueOnce({
        accessToken: "old-access-token",
        refreshToken: "valid-refresh-token",
        tokenType: "Bearer",
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ type: "google" }],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "new-access-token",
          expires_in: 3600,
        }),
      });

      mockUpdateIntegrationTokens.mockResolvedValueOnce(undefined);

      const result = await refreshIntegrationTokens("org-123", "int-456");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Tokens refreshed successfully");
      expect(mockUpdateIntegrationTokens).toHaveBeenCalled();
    });

    it("should return error when integration not found", async () => {
      mockGetIntegrationTokens.mockResolvedValueOnce(null);

      const result = await refreshIntegrationTokens("org-123", "nonexistent");

      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("should return error when no refresh token available", async () => {
      mockGetIntegrationTokens.mockResolvedValueOnce({
        accessToken: "access-token",
        // No refreshToken
        tokenType: "Bearer",
      });

      const result = await refreshIntegrationTokens("org-123", "int-456");

      expect(result.success).toBe(false);
      expect(result.message).toContain("No refresh token");
    });

    it("should handle refresh failure gracefully", async () => {
      mockGetIntegrationTokens.mockResolvedValueOnce({
        accessToken: "old-access-token",
        refreshToken: "invalid-refresh-token",
        tokenType: "Bearer",
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ type: "google" }],
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      mockUpdateIntegrationStatus.mockResolvedValueOnce(undefined);

      const result = await refreshIntegrationTokens("org-123", "int-456");

      expect(result.success).toBe(false);
      expect(mockUpdateIntegrationStatus).toHaveBeenCalledWith(
        "org-123",
        "int-456",
        "error",
        "Token refresh failed"
      );
    });

    it("should skip refresh for Slack bot tokens (no expiry)", async () => {
      mockGetIntegrationTokens.mockResolvedValueOnce({
        accessToken: "xoxb-token",
        refreshToken: "some-token",
        tokenType: "Bearer",
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ type: "slack" }],
      });

      // Slack refresh returns null (not needed)
      const result = await refreshIntegrationTokens("org-123", "int-456");

      // Slack tokens don't refresh, but shouldn't error
      expect(result.success).toBe(false);
    });
  });

  describe("refreshAllExpiringTokens", () => {
    it("should refresh all expiring tokens across organizations", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: "org-1" }, { id: "org-2" }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: "int-1", type: "google", expires_at: new Date() }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: "int-2", type: "google", expires_at: new Date() }],
        });

      mockCheckTokensNeedRefresh
        .mockResolvedValueOnce({ needsRefresh: true })
        .mockResolvedValueOnce({ needsRefresh: false });

      mockGetIntegrationTokens.mockResolvedValueOnce({
        accessToken: "token",
        refreshToken: "refresh",
        tokenType: "Bearer",
      });

      mockQuery.mockResolvedValueOnce({ rows: [{ type: "google" }] });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "new", expires_in: 3600 }),
      });

      mockUpdateIntegrationTokens.mockResolvedValueOnce(undefined);

      const result = await refreshAllExpiringTokens();

      expect(result.total).toBeGreaterThanOrEqual(1);
    });

    it("should handle empty organizations list", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await refreshAllExpiringTokens();

      expect(result.total).toBe(0);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe("revokeIntegrationTokens", () => {
    it("should revoke Google tokens", async () => {
      mockGetIntegrationTokens.mockResolvedValueOnce({
        accessToken: "google-access-token",
        tokenType: "Bearer",
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ type: "google" }],
      });

      mockFetch.mockResolvedValueOnce({ ok: true });

      mockUpdateIntegrationStatus.mockResolvedValueOnce(undefined);

      const result = await revokeIntegrationTokens("org-123", "int-456");

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("oauth2.googleapis.com/revoke"),
        expect.objectContaining({ method: "POST" })
      );
    });

    it("should revoke Slack tokens", async () => {
      mockGetIntegrationTokens.mockResolvedValueOnce({
        accessToken: "xoxb-slack-token",
        tokenType: "Bearer",
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ type: "slack" }],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      mockUpdateIntegrationStatus.mockResolvedValueOnce(undefined);

      const result = await revokeIntegrationTokens("org-123", "int-456");

      expect(result).toBe(true);
    });

    it("should return true even when tokens already gone", async () => {
      mockGetIntegrationTokens.mockResolvedValueOnce(null);

      const result = await revokeIntegrationTokens("org-123", "nonexistent");

      expect(result).toBe(true);
    });

    it("should update status to disconnected after revocation", async () => {
      mockGetIntegrationTokens.mockResolvedValueOnce({
        accessToken: "token",
        tokenType: "Bearer",
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ type: "google" }],
      });

      mockFetch.mockResolvedValueOnce({ ok: true });

      mockUpdateIntegrationStatus.mockResolvedValueOnce(undefined);

      await revokeIntegrationTokens("org-123", "int-456");

      expect(mockUpdateIntegrationStatus).toHaveBeenCalledWith(
        "org-123",
        "int-456",
        "disconnected"
      );
    });
  });

  describe("Job Handlers", () => {
    it("tokenRefreshJobHandler should call refreshAllExpiringTokens", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(tokenRefreshJobHandler()).resolves.not.toThrow();
    });

    it("tokenHealthCheckJobHandler should check all tokens", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // getAllTokenHealth organizations
        .mockResolvedValueOnce({ rows: [] }); // health check

      await expect(tokenHealthCheckJobHandler()).resolves.not.toThrow();
    });
  });
});

describe("Token Refresh Edge Cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("should handle network errors during refresh", async () => {
    mockGetIntegrationTokens.mockResolvedValueOnce({
      accessToken: "token",
      refreshToken: "refresh",
      tokenType: "Bearer",
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{ type: "google" }],
    });

    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    mockUpdateIntegrationStatus.mockResolvedValueOnce(undefined);

    const result = await refreshIntegrationTokens("org-123", "int-456");

    expect(result.success).toBe(false);
  });

  it("should handle malformed refresh response", async () => {
    mockGetIntegrationTokens.mockResolvedValueOnce({
      accessToken: "token",
      refreshToken: "refresh",
      tokenType: "Bearer",
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{ type: "google" }],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "invalid_grant" }),
    });

    mockUpdateIntegrationStatus.mockResolvedValueOnce(undefined);

    const result = await refreshIntegrationTokens("org-123", "int-456");

    expect(result.success).toBe(false);
  });

  it("should handle unsupported integration type", async () => {
    // Ensure mocks are fresh
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockQuery.mockReset();
    mockGetIntegrationTokens.mockReset();
    mockUpdateIntegrationStatus.mockReset();

    mockGetIntegrationTokens.mockResolvedValueOnce({
      accessToken: "token",
      refreshToken: "refresh",
      tokenType: "Bearer",
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{ type: "sentry" }], // sentry is not in the switch cases (only google, slack, jira, teams)
    });

    const result = await refreshIntegrationTokens("org-123", "int-456");

    expect(result.success).toBe(false);
    expect(result.message).toContain("not supported");
  });
});
