/**
 * Platform Credentials Service Tests
 *
 * Tests for:
 * - Provider configuration detection
 * - Credential retrieval
 * - Missing credential handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Store original env
const originalEnv = process.env;

describe("Platform Credentials Service", () => {
  beforeEach(() => {
    // Reset modules to pick up new env vars
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  describe("Provider Configuration Detection", () => {
    it("should detect Google OAuth when configured", async () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client-id";
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret";

      vi.doMock("../../src/utils/config.js", () => ({
        config: {
          GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
          GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        },
      }));

      vi.doMock("../../src/utils/logger.js", () => ({
        logger: { info: vi.fn(), debug: vi.fn() },
      }));

      const { platformCredentials } =
        await import("../../src/services/platform-credentials.js");

      expect(platformCredentials.isConfigured("google")).toBe(true);
    });

    it("should not detect Google OAuth when missing client ID", async () => {
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret";
      // Client ID is missing

      vi.doMock("../../src/utils/config.js", () => ({
        config: {
          GOOGLE_OAUTH_CLIENT_ID: undefined,
          GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        },
      }));

      vi.doMock("../../src/utils/logger.js", () => ({
        logger: { info: vi.fn(), debug: vi.fn() },
      }));

      const { platformCredentials } =
        await import("../../src/services/platform-credentials.js");

      expect(platformCredentials.isConfigured("google")).toBe(false);
    });

    it("should detect GitHub OAuth when configured", async () => {
      vi.doMock("../../src/utils/config.js", () => ({
        config: {
          GITHUB_OAUTH_CLIENT_ID: "test-github-client-id",
          GITHUB_OAUTH_CLIENT_SECRET: "test-github-secret",
        },
      }));

      vi.doMock("../../src/utils/logger.js", () => ({
        logger: { info: vi.fn(), debug: vi.fn() },
      }));

      const { platformCredentials } =
        await import("../../src/services/platform-credentials.js");

      expect(platformCredentials.isConfigured("github")).toBe(true);
    });

    it("should detect Slack when configured", async () => {
      vi.doMock("../../src/utils/config.js", () => ({
        config: {
          SLACK_CLIENT_ID: "test-slack-client-id",
          SLACK_CLIENT_SECRET: "test-slack-secret",
        },
      }));

      vi.doMock("../../src/utils/logger.js", () => ({
        logger: { info: vi.fn(), debug: vi.fn() },
      }));

      const { platformCredentials } =
        await import("../../src/services/platform-credentials.js");

      expect(platformCredentials.isConfigured("slack")).toBe(true);
    });

    it("should always report Sentry as configured (webhook-based)", async () => {
      vi.doMock("../../src/utils/config.js", () => ({
        config: {},
      }));

      vi.doMock("../../src/utils/logger.js", () => ({
        logger: { info: vi.fn(), debug: vi.fn() },
      }));

      const { platformCredentials } =
        await import("../../src/services/platform-credentials.js");

      expect(platformCredentials.isConfigured("sentry")).toBe(true);
    });
  });

  describe("Credential Retrieval", () => {
    it("should return Google OAuth credentials when configured", async () => {
      vi.doMock("../../src/utils/config.js", () => ({
        config: {
          GOOGLE_OAUTH_CLIENT_ID: "google-client-123",
          GOOGLE_OAUTH_CLIENT_SECRET: "google-secret-456",
        },
      }));

      vi.doMock("../../src/utils/logger.js", () => ({
        logger: { info: vi.fn(), debug: vi.fn() },
      }));

      const { platformCredentials } =
        await import("../../src/services/platform-credentials.js");

      const creds = platformCredentials.getGoogleOAuth();

      expect(creds).not.toBeNull();
      expect(creds?.clientId).toBe("google-client-123");
      expect(creds?.clientSecret).toBe("google-secret-456");
    });

    it("should return null for Google OAuth when not configured", async () => {
      vi.doMock("../../src/utils/config.js", () => ({
        config: {},
      }));

      vi.doMock("../../src/utils/logger.js", () => ({
        logger: { info: vi.fn(), debug: vi.fn() },
      }));

      const { platformCredentials } =
        await import("../../src/services/platform-credentials.js");

      const creds = platformCredentials.getGoogleOAuth();
      expect(creds).toBeNull();
    });

    it("should return GitHub OAuth credentials when configured", async () => {
      vi.doMock("../../src/utils/config.js", () => ({
        config: {
          GITHUB_OAUTH_CLIENT_ID: "github-client-123",
          GITHUB_OAUTH_CLIENT_SECRET: "github-secret-456",
        },
      }));

      vi.doMock("../../src/utils/logger.js", () => ({
        logger: { info: vi.fn(), debug: vi.fn() },
      }));

      const { platformCredentials } =
        await import("../../src/services/platform-credentials.js");

      const creds = platformCredentials.getGitHubOAuth();

      expect(creds).not.toBeNull();
      expect(creds?.clientId).toBe("github-client-123");
      expect(creds?.clientSecret).toBe("github-secret-456");
    });

    it("should return Slack credentials when configured", async () => {
      vi.doMock("../../src/utils/config.js", () => ({
        config: {
          SLACK_CLIENT_ID: "slack-client-123",
          SLACK_CLIENT_SECRET: "slack-secret-456",
          SLACK_SIGNING_SECRET: "slack-signing-789",
        },
      }));

      vi.doMock("../../src/utils/logger.js", () => ({
        logger: { info: vi.fn(), debug: vi.fn() },
      }));

      const { platformCredentials } =
        await import("../../src/services/platform-credentials.js");

      const creds = platformCredentials.getSlackApp();

      expect(creds).not.toBeNull();
      expect(creds?.clientId).toBe("slack-client-123");
      expect(creds?.clientSecret).toBe("slack-secret-456");
    });
  });

  describe("Security", () => {
    it("should not expose secrets in toString or JSON serialization", async () => {
      vi.doMock("../../src/utils/config.js", () => ({
        config: {
          GOOGLE_OAUTH_CLIENT_ID: "client-id",
          GOOGLE_OAUTH_CLIENT_SECRET: "super-secret",
        },
      }));

      vi.doMock("../../src/utils/logger.js", () => ({
        logger: { info: vi.fn(), debug: vi.fn() },
      }));

      const { platformCredentials } =
        await import("../../src/services/platform-credentials.js");

      // The service object itself shouldn't leak secrets
      const stringified = JSON.stringify(platformCredentials);

      // Credentials should not appear in the stringified output
      expect(stringified).not.toContain("super-secret");
    });
  });
});

describe("Provider Types", () => {
  it("should support all OAuth providers", async () => {
    vi.doMock("../../src/utils/config.js", () => ({
      config: {},
    }));

    vi.doMock("../../src/utils/logger.js", () => ({
      logger: { info: vi.fn(), debug: vi.fn() },
    }));

    const providers = ["google", "github"] as const;

    const { platformCredentials } =
      await import("../../src/services/platform-credentials.js");

    for (const provider of providers) {
      // Should not throw - method exists
      expect(() => platformCredentials.isConfigured(provider)).not.toThrow();
    }
  });

  it("should support all integration providers", async () => {
    vi.doMock("../../src/utils/config.js", () => ({
      config: {},
    }));

    vi.doMock("../../src/utils/logger.js", () => ({
      logger: { info: vi.fn(), debug: vi.fn() },
    }));

    const providers = [
      "github",
      "github_app",
      "slack",
      "jira",
      "teams",
      "sentry",
    ] as const;

    const { platformCredentials } =
      await import("../../src/services/platform-credentials.js");

    for (const provider of providers) {
      expect(() => platformCredentials.isConfigured(provider)).not.toThrow();
    }
  });
});
