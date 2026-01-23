/**
 * URL Helpers Unit Tests
 *
 * Tests for URL generation, trusted domain validation,
 * and security logging in url-helpers.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to define variables that vi.mock can reference
const mockConfig = vi.hoisted(() => ({
  NODE_ENV: "production" as string,
  PORT: 3000 as number,
  API_BASE_URL: undefined as string | undefined,
  APP_BASE_URL: undefined as string | undefined,
  FRONTEND_URL: undefined as string | undefined,
}));

vi.mock("../../src/utils/config.js", () => ({
  config: mockConfig,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  getApiBaseUrl,
  getAppBaseUrl,
  getBaseUrlFromRequest,
  getOAuthCallbackUrl,
  getWebhookUrl,
  getAppResourceUrl,
} from "../../src/utils/url-helpers.js";
import { logger } from "../../src/utils/logger.js";
import type { FastifyRequest } from "fastify";

const mockedLogger = vi.mocked(logger);

describe("url-helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config to defaults
    mockConfig.NODE_ENV = "production";
    mockConfig.PORT = 3000;
    mockConfig.API_BASE_URL = undefined;
    mockConfig.APP_BASE_URL = undefined;
    mockConfig.FRONTEND_URL = undefined;
  });

  // ============================================
  // getApiBaseUrl Tests
  // ============================================
  describe("getApiBaseUrl", () => {
    it("should return configured API_BASE_URL when set", () => {
      mockConfig.API_BASE_URL = "https://custom-api.example.com";
      expect(getApiBaseUrl()).toBe("https://custom-api.example.com");
    });

    it("should return production URL for production environment", () => {
      mockConfig.NODE_ENV = "production";
      mockConfig.API_BASE_URL = undefined;
      expect(getApiBaseUrl()).toBe("https://api.buglens.com");
    });

    it("should return staging URL for staging environment", () => {
      mockConfig.NODE_ENV = "staging";
      mockConfig.API_BASE_URL = undefined;
      expect(getApiBaseUrl()).toBe("https://api.staging.buglens.co");
    });

    it("should return localhost URL for development", () => {
      mockConfig.NODE_ENV = "development";
      mockConfig.API_BASE_URL = undefined;
      mockConfig.PORT = 3001;
      expect(getApiBaseUrl()).toBe("http://localhost:3001");
    });
  });

  // ============================================
  // getAppBaseUrl Tests
  // ============================================
  describe("getAppBaseUrl", () => {
    it("should return configured APP_BASE_URL when set", () => {
      mockConfig.APP_BASE_URL = "https://custom-app.example.com";
      expect(getAppBaseUrl()).toBe("https://custom-app.example.com");
    });

    it("should return production URL for production environment", () => {
      mockConfig.NODE_ENV = "production";
      mockConfig.APP_BASE_URL = undefined;
      expect(getAppBaseUrl()).toBe("https://app.buglens.com");
    });

    it("should return staging URL for staging environment", () => {
      mockConfig.NODE_ENV = "staging";
      mockConfig.APP_BASE_URL = undefined;
      expect(getAppBaseUrl()).toBe("https://staging.buglens.co");
    });

    it("should return FRONTEND_URL for development when set", () => {
      mockConfig.NODE_ENV = "development";
      mockConfig.APP_BASE_URL = undefined;
      mockConfig.FRONTEND_URL = "http://localhost:5173";
      expect(getAppBaseUrl()).toBe("http://localhost:5173");
    });

    it("should return default localhost for development when FRONTEND_URL not set", () => {
      mockConfig.NODE_ENV = "development";
      mockConfig.APP_BASE_URL = undefined;
      mockConfig.FRONTEND_URL = undefined;
      expect(getAppBaseUrl()).toBe("http://localhost:3002");
    });
  });

  // ============================================
  // getBaseUrlFromRequest Tests
  // ============================================
  describe("getBaseUrlFromRequest", () => {
    const createMockRequest = (
      headers: Record<string, string | undefined>
    ): FastifyRequest => {
      return {
        headers,
        ip: "192.168.1.1",
      } as unknown as FastifyRequest;
    };

    it("should return URL from trusted domain headers", () => {
      const request = createMockRequest({
        "x-forwarded-proto": "https",
        "x-forwarded-host": "api.buglens.com",
      });

      expect(getBaseUrlFromRequest(request)).toBe("https://api.buglens.com");
    });

    it("should fall back to host header when x-forwarded-host not set", () => {
      const request = createMockRequest({
        "x-forwarded-proto": "https",
        host: "app.buglens.com",
      });

      expect(getBaseUrlFromRequest(request)).toBe("https://app.buglens.com");
    });

    it("should allow any domain in development mode", () => {
      mockConfig.NODE_ENV = "development";
      const request = createMockRequest({
        "x-forwarded-proto": "http",
        host: "untrusted-domain.com",
      });

      expect(getBaseUrlFromRequest(request)).toBe(
        "http://untrusted-domain.com"
      );
      expect(mockedLogger.warn).not.toHaveBeenCalled();
    });

    it("should log warning and return fallback for untrusted domains in production", () => {
      mockConfig.NODE_ENV = "production";
      mockConfig.API_BASE_URL = "https://api.buglens.com";
      const request = createMockRequest({
        "x-forwarded-proto": "https",
        "x-forwarded-host": "evil-attacker.com",
      });

      const result = getBaseUrlFromRequest(request);

      expect(result).toBe("https://api.buglens.com");
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          untrustedUrl: "https://evil-attacker.com",
          forwardedHost: "evil-attacker.com",
          remoteIp: "192.168.1.1",
        }),
        "Blocked URL from untrusted domain, falling back to API base URL"
      );
    });

    it("should allow subdomains of trusted domains", () => {
      const request = createMockRequest({
        "x-forwarded-proto": "https",
        host: "subdomain.buglens.com",
      });

      expect(getBaseUrlFromRequest(request)).toBe(
        "https://subdomain.buglens.com"
      );
    });

    it("should allow localhost", () => {
      const request = createMockRequest({
        "x-forwarded-proto": "http",
        host: "localhost:3000",
      });

      expect(getBaseUrlFromRequest(request)).toBe("http://localhost:3000");
    });

    it("should default to http when x-forwarded-proto not set", () => {
      const request = createMockRequest({
        host: "api.buglens.com",
      });

      expect(getBaseUrlFromRequest(request)).toBe("http://api.buglens.com");
    });

    it("should use localhost:3000 when no host headers", () => {
      const request = createMockRequest({});

      // localhost is trusted, so it should work
      const result = getBaseUrlFromRequest(request);
      expect(result).toBe("http://localhost:3000");
    });
  });

  // ============================================
  // getOAuthCallbackUrl Tests
  // ============================================
  describe("getOAuthCallbackUrl", () => {
    beforeEach(() => {
      mockConfig.NODE_ENV = "development";
      mockConfig.PORT = 3000;
    });

    it("should generate auth callback URL for auth type", () => {
      const url = getOAuthCallbackUrl("github", "auth");
      expect(url).toBe("http://localhost:3000/api/auth/github/callback");
    });

    it("should generate integration callback URL by default", () => {
      const url = getOAuthCallbackUrl("slack");
      expect(url).toBe("http://localhost:3000/api/integrations/slack/callback");
    });

    it("should generate integration callback URL for integration type", () => {
      const url = getOAuthCallbackUrl("jira", "integration");
      expect(url).toBe("http://localhost:3000/api/integrations/jira/callback");
    });

    it("should use production URL in production", () => {
      mockConfig.NODE_ENV = "production";
      const url = getOAuthCallbackUrl("google", "auth");
      expect(url).toBe("https://api.buglens.com/api/auth/google/callback");
    });
  });

  // ============================================
  // getWebhookUrl Tests
  // ============================================
  describe("getWebhookUrl", () => {
    beforeEach(() => {
      mockConfig.NODE_ENV = "development";
      mockConfig.PORT = 3000;
    });

    it("should generate webhook URL without orgId", () => {
      const url = getWebhookUrl("sentry");
      expect(url).toBe("http://localhost:3000/api/v1/webhooks/sentry");
    });

    it("should generate webhook URL with orgId", () => {
      const url = getWebhookUrl("github", "org_12345");
      expect(url).toBe(
        "http://localhost:3000/api/v1/webhooks/github/org_12345"
      );
    });

    it("should use production URL in production", () => {
      mockConfig.NODE_ENV = "production";
      const url = getWebhookUrl("sentry", "org_abc");
      expect(url).toBe(
        "https://api.buglens.com/api/v1/webhooks/sentry/org_abc"
      );
    });
  });

  // ============================================
  // getAppResourceUrl Tests
  // ============================================
  describe("getAppResourceUrl", () => {
    beforeEach(() => {
      mockConfig.NODE_ENV = "development";
      mockConfig.FRONTEND_URL = "http://localhost:3002";
    });

    it("should generate event URL with correct plural path", () => {
      const url = getAppResourceUrl("event", "evt_123");
      expect(url).toBe("http://localhost:3002/events/evt_123");
    });

    it("should generate events URL for events resource", () => {
      const url = getAppResourceUrl("events", "evt_456");
      expect(url).toBe("http://localhost:3002/events/evt_456");
    });

    it("should generate RCA URL", () => {
      const url = getAppResourceUrl("rca", "rca_789");
      expect(url).toBe("http://localhost:3002/rca/rca_789");
    });

    it("should generate dashboard URL without resourceId", () => {
      const url = getAppResourceUrl("dashboard");
      expect(url).toBe("http://localhost:3002/dashboard");
    });

    it("should use production URL in production", () => {
      mockConfig.NODE_ENV = "production";
      mockConfig.APP_BASE_URL = undefined;
      const url = getAppResourceUrl("event", "evt_123");
      expect(url).toBe("https://app.buglens.com/events/evt_123");
    });
  });

  // ============================================
  // Security Edge Cases
  // ============================================
  describe("Security Edge Cases", () => {
    it("should reject URLs with similar-looking domains", () => {
      mockConfig.NODE_ENV = "production";
      mockConfig.API_BASE_URL = "https://api.buglens.com";

      const maliciousDomains = [
        "buglens.com.attacker.com",
        "fake-buglens.com",
        "buglens-com.io",
        "buglenscom.io",
      ];

      for (const domain of maliciousDomains) {
        vi.clearAllMocks();
        const request = {
          headers: {
            "x-forwarded-proto": "https",
            host: domain,
          },
          ip: "10.0.0.1",
        } as unknown as FastifyRequest;

        const result = getBaseUrlFromRequest(request);
        expect(result).toBe("https://api.buglens.com");
        expect(mockedLogger.warn).toHaveBeenCalled();
      }
    });

    it("should handle malformed URLs gracefully", () => {
      mockConfig.NODE_ENV = "production";
      mockConfig.API_BASE_URL = "https://api.buglens.com";

      const request = {
        headers: {
          "x-forwarded-proto": "https",
          host: ":::invalid:::host",
        },
        ip: "10.0.0.1",
      } as unknown as FastifyRequest;

      const result = getBaseUrlFromRequest(request);
      // Should fall back to API base URL when URL parsing fails
      expect(result).toBe("https://api.buglens.com");
    });
  });
});
