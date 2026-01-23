/**
 * OAuth Helpers Unit Tests
 *
 * Tests for OAuth callback validation utilities
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyRequest, FastifyReply } from "fastify";

// Mock dependencies
vi.mock("../../src/utils/config.js", () => ({
  config: {
    NODE_ENV: "production",
    FRONTEND_URL: "https://app.buglens.com",
    APP_BASE_URL: "https://app.buglens.com",
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/services/oauth.js", () => ({
  validateOAuthState: vi.fn(),
}));

vi.mock("../../src/utils/response-helpers.js", () => ({
  redirectWithError: vi.fn(),
  redirectWithSuccess: vi.fn(),
}));

import {
  validateOAuthCallback,
  handleOAuthSuccess,
  handleOAuthError,
  withOAuthErrorHandling,
  validateConnectRequest,
  type OAuthCallbackQuery,
} from "../../src/utils/oauth-helpers.js";
import { validateOAuthState } from "../../src/services/oauth.js";
import {
  redirectWithError,
  redirectWithSuccess,
} from "../../src/utils/response-helpers.js";
import { logger } from "../../src/utils/logger.js";

const mockedValidateOAuthState = vi.mocked(validateOAuthState);
const mockedRedirectWithError = vi.mocked(redirectWithError);
const mockedRedirectWithSuccess = vi.mocked(redirectWithSuccess);

describe("oauth-helpers", () => {
  let mockRequest: FastifyRequest<{ Querystring: OAuthCallbackQuery }>;
  let mockReply: FastifyReply;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRequest = {
      query: {},
    } as unknown as FastifyRequest<{ Querystring: OAuthCallbackQuery }>;

    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      redirect: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;
  });

  // ============================================
  // validateOAuthCallback Tests
  // ============================================
  describe("validateOAuthCallback", () => {
    it("should return valid context when code and state are valid", () => {
      mockRequest.query = { code: "auth_code_123", state: "state_token" };
      const mockOAuthState = {
        state: "state_token",
        orgId: "org_123",
        integrationType: "github",
        returnUrl: "/settings/integrations",
        action: "link" as const,
        nonce: "nonce_123",
        createdAt: Date.now(),
      };
      mockedValidateOAuthState.mockReturnValue(mockOAuthState);

      const result = validateOAuthCallback(mockRequest, mockReply, {
        provider: "github",
      });

      expect(result).not.toBeNull();
      expect(result?.code).toBe("auth_code_123");
      expect(result?.state.orgId).toBe("org_123");
    });

    it("should redirect when code is missing", () => {
      mockRequest.query = { state: "state_token" };

      const result = validateOAuthCallback(mockRequest, mockReply, {
        provider: "github",
      });

      expect(result).toBeNull();
      expect(mockedRedirectWithError).toHaveBeenCalledWith(
        mockReply,
        "/settings/integrations",
        "missing_params"
      );
    });

    it("should redirect when state is missing", () => {
      mockRequest.query = { code: "auth_code_123" };

      const result = validateOAuthCallback(mockRequest, mockReply, {
        provider: "github",
      });

      expect(result).toBeNull();
      expect(mockedRedirectWithError).toHaveBeenCalledWith(
        mockReply,
        "/settings/integrations",
        "missing_params"
      );
    });

    it("should handle OAuth error response from provider", () => {
      mockRequest.query = {
        error: "access_denied",
        error_description: "User denied access",
      };

      const result = validateOAuthCallback(mockRequest, mockReply, {
        provider: "github",
      });

      expect(result).toBeNull();
      expect(mockedRedirectWithError).toHaveBeenCalledWith(
        mockReply,
        "/settings/integrations",
        "access_denied"
      );
    });

    it("should redirect when state validation fails", () => {
      mockRequest.query = { code: "auth_code_123", state: "invalid_state" };
      mockedValidateOAuthState.mockReturnValue(null);

      const result = validateOAuthCallback(mockRequest, mockReply, {
        provider: "slack",
      });

      expect(result).toBeNull();
      expect(mockedRedirectWithError).toHaveBeenCalledWith(
        mockReply,
        "/settings/integrations",
        "invalid_state"
      );
    });

    it("should use custom redirect path", () => {
      mockRequest.query = { error: "server_error" };

      validateOAuthCallback(mockRequest, mockReply, {
        provider: "github",
        redirectPath: "/custom/path",
      });

      expect(mockedRedirectWithError).toHaveBeenCalledWith(
        mockReply,
        "/custom/path",
        "server_error"
      );
    });
  });

  // ============================================
  // handleOAuthSuccess Tests
  // ============================================
  describe("handleOAuthSuccess", () => {
    it("should redirect with success message", () => {
      handleOAuthSuccess(mockReply, "github", "org_123");

      expect(mockedRedirectWithSuccess).toHaveBeenCalledWith(
        mockReply,
        "/settings/integrations",
        "github_connected"
      );
    });

    it("should log success with metadata", () => {
      handleOAuthSuccess(mockReply, "slack", "org_456", {
        channelName: "general",
      });

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: "org_456",
          provider: "slack",
          channelName: "general",
        }),
        "slack integration connected"
      );
    });

    it("should use custom redirect path", () => {
      handleOAuthSuccess(
        mockReply,
        "jira",
        "org_789",
        undefined,
        "/custom/success"
      );

      expect(mockedRedirectWithSuccess).toHaveBeenCalledWith(
        mockReply,
        "/custom/success",
        "jira_connected"
      );
    });
  });

  // ============================================
  // handleOAuthError Tests
  // ============================================
  describe("handleOAuthError", () => {
    it("should redirect with error", () => {
      handleOAuthError(mockReply, "github", new Error("Token expired"));

      expect(mockedRedirectWithError).toHaveBeenCalledWith(
        mockReply,
        "/settings/integrations",
        "github_failed"
      );
    });

    it("should log the error", () => {
      const error = new Error("Connection refused");
      handleOAuthError(mockReply, "slack", error);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error }),
        "Failed to complete slack OAuth"
      );
    });

    it("should use custom redirect path", () => {
      handleOAuthError(
        mockReply,
        "jira",
        new Error("Timeout"),
        "/custom/error"
      );

      expect(mockedRedirectWithError).toHaveBeenCalledWith(
        mockReply,
        "/custom/error",
        "jira_failed"
      );
    });
  });

  // ============================================
  // withOAuthErrorHandling Tests
  // ============================================
  describe("withOAuthErrorHandling", () => {
    it("should call handler without catching on success", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      await withOAuthErrorHandling(mockReply, "github", handler);

      expect(handler).toHaveBeenCalled();
      expect(mockedRedirectWithError).not.toHaveBeenCalled();
    });

    it("should redirect on error", async () => {
      const handler = vi
        .fn()
        .mockRejectedValue(new Error("Token exchange failed"));

      await withOAuthErrorHandling(mockReply, "github", handler);

      expect(mockedRedirectWithError).toHaveBeenCalledWith(
        mockReply,
        "/settings/integrations",
        "github_failed"
      );
    });

    it("should use custom redirect path on error", async () => {
      const handler = vi.fn().mockRejectedValue(new Error("Failed"));

      await withOAuthErrorHandling(mockReply, "slack", handler, "/custom/path");

      expect(mockedRedirectWithError).toHaveBeenCalledWith(
        mockReply,
        "/custom/path",
        "slack_failed"
      );
    });
  });

  // ============================================
  // validateConnectRequest Tests
  // ============================================
  describe("validateConnectRequest", () => {
    it("should return orgId when valid and configured", () => {
      const result = validateConnectRequest(
        "org_123",
        mockReply,
        "github",
        true
      );

      expect(result).toBe("org_123");
    });

    it("should redirect when orgId is missing", () => {
      const result = validateConnectRequest(null, mockReply, "github", true);

      expect(result).toBeNull();
      expect(mockedRedirectWithError).toHaveBeenCalledWith(
        mockReply,
        "/login",
        "auth_required"
      );
    });

    it("should redirect when not configured", () => {
      const result = validateConnectRequest(
        "org_123",
        mockReply,
        "slack",
        false
      );

      expect(result).toBeNull();
      expect(mockedRedirectWithError).toHaveBeenCalledWith(
        mockReply,
        "/settings/integrations",
        "slack_not_configured"
      );
    });

    it("should use custom redirect path for not configured error", () => {
      const result = validateConnectRequest(
        "org_123",
        mockReply,
        "jira",
        false,
        "/custom/path"
      );

      expect(result).toBeNull();
      expect(mockedRedirectWithError).toHaveBeenCalledWith(
        mockReply,
        "/custom/path",
        "jira_not_configured"
      );
    });
  });
});
