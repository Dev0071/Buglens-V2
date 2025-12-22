/**
 * OAuth Routes Tests
 *
 * Tests for:
 * - OAuth state generation and validation
 * - GitHub OAuth flow
 * - Slack OAuth flow
 * - Jira OAuth flow
 * - Teams OAuth flow
 * - Sentry configuration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all external services before importing
vi.mock("../../src/db/client.js", () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  transaction: vi.fn().mockImplementation((_, callback) =>
    callback({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    })
  ),
}));

vi.mock("../../src/utils/config.js", () => ({
  config: {
    NODE_ENV: "test",
    PORT: 3000,
    GITHUB_APP_ID: "test-github-app-id",
    SLACK_CLIENT_ID: "test-slack-client-id",
    SLACK_CLIENT_SECRET: "test-slack-secret",
    JIRA_CLIENT_ID: "test-jira-client-id",
    JIRA_CLIENT_SECRET: "test-jira-secret",
    TEAMS_CLIENT_ID: "test-teams-client-id",
    TEAMS_CLIENT_SECRET: "test-teams-secret",
    TEAMS_TENANT_ID: "common",
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks are set up
import {
  generateOAuthState,
  validateOAuthState,
  getGitHubAuthUrl,
  getSlackAuthUrl,
  getJiraAuthUrl,
  getTeamsAuthUrl,
} from "../../src/services/oauth.js";

describe("OAuth Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("State Management", () => {
    it("should generate unique OAuth state tokens", () => {
      const state1 = generateOAuthState("org-1", "github", "/integrations");
      const state2 = generateOAuthState("org-1", "github", "/integrations");

      expect(state1).toBeDefined();
      expect(state2).toBeDefined();
      expect(state1).not.toBe(state2);
    });

    it("should generate 64-character hex state tokens", () => {
      const state = generateOAuthState("org-1", "github", "/integrations");

      expect(state).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should validate and return correct state data", () => {
      const orgId = "test-org-123";
      const integrationType = "github";
      const returnUrl = "/integrations";

      const stateToken = generateOAuthState(orgId, integrationType, returnUrl);
      const validated = validateOAuthState(stateToken);

      expect(validated).not.toBeNull();
      expect(validated?.orgId).toBe(orgId);
      expect(validated?.integrationType).toBe(integrationType);
      expect(validated?.returnUrl).toBe(returnUrl);
    });

    it("should consume state token on validation (one-time use)", () => {
      const state = generateOAuthState("org-1", "github", "/integrations");

      // First validation should succeed
      const first = validateOAuthState(state);
      expect(first).not.toBeNull();

      // Second validation should fail (consumed)
      const second = validateOAuthState(state);
      expect(second).toBeNull();
    });

    it("should return null for invalid state token", () => {
      const result = validateOAuthState("invalid-state-token");
      expect(result).toBeNull();
    });

    it("should include nonce and timestamp in state", () => {
      const state = generateOAuthState("org-1", "github", "/integrations");
      const validated = validateOAuthState(state);

      expect(validated?.nonce).toBeDefined();
      expect(validated?.nonce).toMatch(/^[a-f0-9]{32}$/);
      expect(validated?.createdAt).toBeDefined();
      expect(typeof validated?.createdAt).toBe("number");
    });
  });

  describe("GitHub OAuth URL", () => {
    it("should generate valid GitHub OAuth URL", () => {
      const state = "test-state-123";
      const url = getGitHubAuthUrl(state);

      expect(url).toContain("https://github.com/login/oauth/authorize");
      expect(url).toContain("client_id=test-github-app-id");
      expect(url).toContain("state=test-state-123");
      expect(url).toContain("scope=read%3Auser+repo");
    });

    it("should include correct redirect URI", () => {
      const state = "test-state";
      const url = getGitHubAuthUrl(state);

      // In test mode, should use localhost
      expect(url).toContain(
        encodeURIComponent("/api/integrations/github/callback")
      );
    });
  });

  describe("Slack OAuth URL", () => {
    it("should generate valid Slack OAuth URL", () => {
      const state = "test-state-456";
      const url = getSlackAuthUrl(state);

      expect(url).toContain("https://slack.com/oauth/v2/authorize");
      expect(url).toContain("client_id=test-slack-client-id");
      expect(url).toContain("state=test-state-456");
    });

    it("should include required Slack scopes", () => {
      const url = getSlackAuthUrl("state");

      expect(url).toContain("scope=");
      expect(url).toContain("chat%3Awrite");
      expect(url).toContain("channels%3Aread");
      expect(url).toContain("incoming-webhook");
    });
  });

  describe("Jira OAuth URL", () => {
    it("should generate valid Jira OAuth URL", () => {
      const state = "test-state-789";
      const url = getJiraAuthUrl(state);

      expect(url).toContain("https://auth.atlassian.com/authorize");
      expect(url).toContain("client_id=test-jira-client-id");
      expect(url).toContain("state=test-state-789");
      expect(url).toContain("audience=api.atlassian.com");
    });

    it("should include required Jira scopes", () => {
      const url = getJiraAuthUrl("state");

      expect(url).toContain("scope=");
      expect(url).toContain("read%3Ajira-work");
      expect(url).toContain("write%3Ajira-work");
      expect(url).toContain("offline_access");
    });

    it("should include prompt=consent for Jira", () => {
      const url = getJiraAuthUrl("state");
      expect(url).toContain("prompt=consent");
    });
  });

  describe("Microsoft Teams OAuth URL", () => {
    it("should generate valid Teams OAuth URL", () => {
      const state = "test-state-teams";
      const url = getTeamsAuthUrl(state);

      expect(url).toContain("https://login.microsoftonline.com/");
      expect(url).toContain("client_id=test-teams-client-id");
      expect(url).toContain("state=test-state-teams");
      expect(url).toContain("response_type=code");
    });

    it("should include Microsoft Graph scope", () => {
      const url = getTeamsAuthUrl("state");
      expect(url).toContain(
        encodeURIComponent("https://graph.microsoft.com/.default")
      );
    });

    it("should include offline_access scope", () => {
      const url = getTeamsAuthUrl("state");
      expect(url).toContain("offline_access");
    });
  });
});

describe("OAuth Integration Types", () => {
  const integrationTypes = ["github", "slack", "jira", "teams"];

  integrationTypes.forEach((type) => {
    it(`should handle ${type} integration type in state`, () => {
      const state = generateOAuthState("org-1", type, "/integrations");
      const validated = validateOAuthState(state);

      expect(validated?.integrationType).toBe(type);
    });
  });
});

describe("OAuth Security", () => {
  it("should generate cryptographically random state tokens", () => {
    // Generate many tokens and check for collisions
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const state = generateOAuthState("org-1", "github", "/");
      // Consume the token immediately to avoid memory growth
      validateOAuthState(state);
      tokens.add(state);
    }
    // All tokens should be unique
    expect(tokens.size).toBe(100);
  });

  it("should include unique nonce in each state", () => {
    const nonces = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const state = generateOAuthState("org-1", "github", "/");
      const validated = validateOAuthState(state);
      if (validated?.nonce) {
        nonces.add(validated.nonce);
      }
    }

    expect(nonces.size).toBe(10);
  });

  it("should not expose sensitive data in OAuth URLs", () => {
    const urls = [
      getGitHubAuthUrl("state"),
      getSlackAuthUrl("state"),
      getJiraAuthUrl("state"),
      getTeamsAuthUrl("state"),
    ];

    urls.forEach((url) => {
      // Should not contain secrets
      expect(url.toLowerCase()).not.toContain("secret");
      expect(url.toLowerCase()).not.toContain("password");
      expect(url.toLowerCase()).not.toContain("token");
    });
  });
});

describe("State TTL", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should expire state after TTL (10 minutes)", () => {
    const state = generateOAuthState("org-1", "github", "/integrations");

    // Advance time by 11 minutes
    vi.advanceTimersByTime(11 * 60 * 1000);

    // State should be expired
    const validated = validateOAuthState(state);
    expect(validated).toBeNull();
  });

  it("should accept state before TTL expires", () => {
    const state = generateOAuthState("org-1", "github", "/integrations");

    // Advance time by 5 minutes (less than TTL)
    vi.advanceTimersByTime(5 * 60 * 1000);

    // State should still be valid
    const validated = validateOAuthState(state);
    expect(validated).not.toBeNull();
    expect(validated?.orgId).toBe("org-1");
  });
});
