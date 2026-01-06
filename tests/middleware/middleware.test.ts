/**
 * Middleware Tests
 *
 * Tests for org-context and rate-limit middleware covering:
 * - JWT extraction and validation
 * - Header-based org context
 * - Path parameter org context
 * - RLS context setting
 * - Rate limit enforcement
 * - 429 responses
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
vi.mock("../../src/db/client.js", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { pool } from "../../src/db/client.js";
import {
  orgContextMiddleware,
  setupOrgDecorators,
} from "../../src/api/middleware/org-context.js";
import { createRateLimitMiddleware } from "../../src/api/middleware/rate-limit.js";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

// =============================================================================
// TEST FIXTURES
// =============================================================================

const createMockRequest = (
  overrides: Partial<FastifyRequest> = {}
): FastifyRequest => {
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    headers: {},
    params: {},
    user: undefined,
    jwtVerify: vi.fn().mockRejectedValue(new Error("No token")),
    log: mockLog,
    orgContext: undefined,
    getOrgId: vi.fn().mockReturnValue(""),
    getOrgPlan: vi.fn().mockReturnValue("free"),
    getUserId: vi.fn().mockReturnValue(undefined),
    ...overrides,
  } as unknown as FastifyRequest;
};

const createMockReply = (): FastifyReply => {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
  return reply;
};

const validUUID = "550e8400-e29b-41d4-a716-446655440000";
const invalidUUID = "not-a-uuid";

// =============================================================================
// ORG CONTEXT MIDDLEWARE TESTS
// =============================================================================

describe("orgContextMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("JWT extraction", () => {
    it("should extract orgId from valid JWT", async () => {
      const request = createMockRequest({
        headers: { authorization: "Bearer valid-token" },
        jwtVerify: vi.fn().mockResolvedValue(undefined),
        user: { orgId: validUUID, userId: "user-123" },
      });
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({
        rows: [{ id: validUUID, plan: "pro" }],
      });

      await orgContextMiddleware(request, reply);

      expect(request.jwtVerify).toHaveBeenCalled();
      expect(request.orgContext).toEqual({
        orgId: validUUID,
        orgPlan: "pro",
      });
    });

    it("should skip JWT extraction for non-Bearer tokens", async () => {
      const request = createMockRequest({
        headers: { authorization: "Basic credentials" },
      });
      const reply = createMockReply();

      await orgContextMiddleware(request, reply);

      expect(request.jwtVerify).not.toHaveBeenCalled();
    });

    it("should continue to headers when JWT verification fails", async () => {
      const request = createMockRequest({
        headers: {
          authorization: "Bearer invalid-token",
          "x-org-id": validUUID,
        },
        jwtVerify: vi.fn().mockRejectedValue(new Error("Invalid token")),
      });
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({
        rows: [{ id: validUUID, plan: "free" }],
      });

      await orgContextMiddleware(request, reply);

      expect(request.orgContext?.orgId).toBe(validUUID);
    });
  });

  describe("header extraction", () => {
    it("should extract orgId from x-org-id header", async () => {
      const request = createMockRequest({
        headers: { "x-org-id": validUUID },
      });
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({
        rows: [{ id: validUUID, plan: "enterprise" }],
      });

      await orgContextMiddleware(request, reply);

      expect(request.orgContext).toEqual({
        orgId: validUUID,
        orgPlan: "enterprise",
      });
    });

    it("should ignore empty x-org-id header", async () => {
      const request = createMockRequest({
        headers: { "x-org-id": "  " },
      });
      const reply = createMockReply();

      await orgContextMiddleware(request, reply);

      expect(request.orgContext).toBeUndefined();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe("path parameter extraction", () => {
    it("should extract orgId from path parameter", async () => {
      const request = createMockRequest({
        params: { org_id: validUUID },
      });
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({
        rows: [{ id: validUUID, plan: "free" }],
      });

      await orgContextMiddleware(request, reply);

      expect(request.orgContext?.orgId).toBe(validUUID);
    });
  });

  describe("priority order", () => {
    it("should prefer JWT over header", async () => {
      const jwtOrgId = "11111111-1111-1111-1111-111111111111";
      const headerOrgId = "22222222-2222-2222-2222-222222222222";

      const request = createMockRequest({
        headers: {
          authorization: "Bearer token",
          "x-org-id": headerOrgId,
        },
        jwtVerify: vi.fn().mockResolvedValue(undefined),
        user: { orgId: jwtOrgId },
      });
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({
        rows: [{ id: jwtOrgId, plan: "pro" }],
      });

      await orgContextMiddleware(request, reply);

      expect(request.orgContext?.orgId).toBe(jwtOrgId);
    });

    it("should prefer header over path parameter", async () => {
      const headerOrgId = "11111111-1111-1111-1111-111111111111";
      const paramOrgId = "22222222-2222-2222-2222-222222222222";

      const request = createMockRequest({
        headers: { "x-org-id": headerOrgId },
        params: { org_id: paramOrgId },
      });
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({
        rows: [{ id: headerOrgId, plan: "free" }],
      });

      await orgContextMiddleware(request, reply);

      expect(request.orgContext?.orgId).toBe(headerOrgId);
    });
  });

  describe("validation", () => {
    it("should reject invalid UUID format", async () => {
      const request = createMockRequest({
        headers: { "x-org-id": invalidUUID },
      });
      const reply = createMockReply();

      await orgContextMiddleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        error: "Bad Request",
        message: "Invalid organization ID",
      });
    });

    it("should return 404 for non-existent organization", async () => {
      const request = createMockRequest({
        headers: { "x-org-id": validUUID },
      });
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({ rows: [] });

      await orgContextMiddleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith({
        error: "Not Found",
        message: "Organization does not exist",
      });
    });

    it("should handle database errors", async () => {
      const request = createMockRequest({
        headers: { "x-org-id": validUUID },
      });
      const reply = createMockReply();

      mockPool.query.mockRejectedValue(new Error("Database error"));

      await orgContextMiddleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply.send).toHaveBeenCalledWith({
        error: "Internal Server Error",
      });
    });
  });

  describe("unauthenticated routes", () => {
    it("should allow requests without org context", async () => {
      const request = createMockRequest({
        headers: {},
        params: {},
      });
      const reply = createMockReply();

      await orgContextMiddleware(request, reply);

      expect(request.orgContext).toBeUndefined();
      expect(reply.status).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// SETUP ORG DECORATORS TESTS
// =============================================================================

describe("setupOrgDecorators", () => {
  it("should add all required decorators", () => {
    const mockServer = {
      decorateRequest: vi.fn(),
      decorate: vi.fn(),
    } as unknown as FastifyInstance;

    setupOrgDecorators(mockServer);

    expect(mockServer.decorateRequest).toHaveBeenCalledWith("orgContext", null);
    expect(mockServer.decorateRequest).toHaveBeenCalledWith(
      "getOrgId",
      expect.any(Function)
    );
    expect(mockServer.decorateRequest).toHaveBeenCalledWith(
      "getOrgPlan",
      expect.any(Function)
    );
    expect(mockServer.decorateRequest).toHaveBeenCalledWith(
      "getUserId",
      expect.any(Function)
    );
    expect(mockServer.decorate).toHaveBeenCalledWith(
      "authenticate",
      expect.any(Function)
    );
  });

  describe("getOrgId decorator", () => {
    it("should return orgId when context exists", () => {
      const mockServer = {
        decorateRequest: vi.fn(),
        decorate: vi.fn(),
      } as unknown as FastifyInstance;

      setupOrgDecorators(mockServer);

      // Get the getOrgId function
      const getOrgIdCall = (
        mockServer.decorateRequest as ReturnType<typeof vi.fn>
      ).mock.calls.find((call) => call[0] === "getOrgId");
      const getOrgIdFn = getOrgIdCall?.[1];

      const mockThis = { orgContext: { orgId: validUUID, orgPlan: "pro" } };
      const result = getOrgIdFn?.call(mockThis);

      expect(result).toBe(validUUID);
    });

    it("should return empty string when no context", () => {
      const mockServer = {
        decorateRequest: vi.fn(),
        decorate: vi.fn(),
      } as unknown as FastifyInstance;

      setupOrgDecorators(mockServer);

      const getOrgIdCall = (
        mockServer.decorateRequest as ReturnType<typeof vi.fn>
      ).mock.calls.find((call) => call[0] === "getOrgId");
      const getOrgIdFn = getOrgIdCall?.[1];

      const mockThis = { orgContext: undefined };
      const result = getOrgIdFn?.call(mockThis);

      expect(result).toBe("");
    });
  });

  describe("getOrgPlan decorator", () => {
    it("should return plan when context exists", () => {
      const mockServer = {
        decorateRequest: vi.fn(),
        decorate: vi.fn(),
      } as unknown as FastifyInstance;

      setupOrgDecorators(mockServer);

      const getOrgPlanCall = (
        mockServer.decorateRequest as ReturnType<typeof vi.fn>
      ).mock.calls.find((call) => call[0] === "getOrgPlan");
      const getOrgPlanFn = getOrgPlanCall?.[1];

      const mockThis = {
        orgContext: { orgId: validUUID, orgPlan: "enterprise" },
      };
      const result = getOrgPlanFn?.call(mockThis);

      expect(result).toBe("enterprise");
    });

    it("should default to 'free' when no context", () => {
      const mockServer = {
        decorateRequest: vi.fn(),
        decorate: vi.fn(),
      } as unknown as FastifyInstance;

      setupOrgDecorators(mockServer);

      const getOrgPlanCall = (
        mockServer.decorateRequest as ReturnType<typeof vi.fn>
      ).mock.calls.find((call) => call[0] === "getOrgPlan");
      const getOrgPlanFn = getOrgPlanCall?.[1];

      const mockThis = { orgContext: undefined };
      const result = getOrgPlanFn?.call(mockThis);

      expect(result).toBe("free");
    });
  });

  describe("authenticate decorator", () => {
    it("should call jwtVerify", async () => {
      const mockServer = {
        decorateRequest: vi.fn(),
        decorate: vi.fn(),
      } as unknown as FastifyInstance;

      setupOrgDecorators(mockServer);

      const authenticateCall = (
        mockServer.decorate as ReturnType<typeof vi.fn>
      ).mock.calls.find((call) => call[0] === "authenticate");
      const authenticateFn = authenticateCall?.[1];

      const mockRequest = {
        jwtVerify: vi.fn().mockResolvedValue(undefined),
      } as unknown as FastifyRequest;
      const mockReply = createMockReply();

      await authenticateFn?.(mockRequest, mockReply);

      expect(mockRequest.jwtVerify).toHaveBeenCalled();
      expect(mockReply.status).not.toHaveBeenCalled();
    });

    it("should return 401 on JWT verification failure", async () => {
      const mockServer = {
        decorateRequest: vi.fn(),
        decorate: vi.fn(),
      } as unknown as FastifyInstance;

      setupOrgDecorators(mockServer);

      const authenticateCall = (
        mockServer.decorate as ReturnType<typeof vi.fn>
      ).mock.calls.find((call) => call[0] === "authenticate");
      const authenticateFn = authenticateCall?.[1];

      const mockRequest = {
        jwtVerify: vi.fn().mockRejectedValue(new Error("Invalid token")),
      } as unknown as FastifyRequest;
      const mockReply = createMockReply();

      await authenticateFn?.(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "UNAUTHORIZED",
        message: "Authentication required",
      });
    });
  });
});

// =============================================================================
// RATE LIMIT MIDDLEWARE TESTS
// =============================================================================

describe("createRateLimitMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("events rate limit", () => {
    it("should allow requests under limit", async () => {
      const middleware = createRateLimitMiddleware({
        resource: "events",
        period: "hour",
      });

      const request = createMockRequest();
      (request.getOrgId as ReturnType<typeof vi.fn>).mockReturnValue(validUUID);
      (request.getOrgPlan as ReturnType<typeof vi.fn>).mockReturnValue("free");
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({ rows: [{ count: "50" }] });

      await middleware(request, reply);

      expect(reply.status).not.toHaveBeenCalledWith(429);
      expect(reply.header).toHaveBeenCalledWith(
        "X-RateLimit-Limit",
        expect.any(Number)
      );
      expect(reply.header).toHaveBeenCalledWith(
        "X-RateLimit-Remaining",
        expect.any(Number)
      );
    });

    it("should return 429 when limit exceeded", async () => {
      const middleware = createRateLimitMiddleware({
        resource: "events",
        period: "hour",
      });

      const request = createMockRequest();
      (request.getOrgId as ReturnType<typeof vi.fn>).mockReturnValue(validUUID);
      (request.getOrgPlan as ReturnType<typeof vi.fn>).mockReturnValue("free");
      const reply = createMockReply();

      // Simulate exceeding the limit
      mockPool.query.mockResolvedValue({ rows: [{ count: "1000000" }] });

      await middleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(429);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Rate Limit Exceeded",
          message: expect.stringContaining("events"),
          quota: expect.objectContaining({
            limit: expect.any(Number),
            used: 1000000,
            remaining: 0,
          }),
        })
      );
    });
  });

  describe("RCA jobs rate limit", () => {
    it("should check RCA jobs table for usage", async () => {
      const middleware = createRateLimitMiddleware({
        resource: "rca_jobs",
        period: "day",
      });

      const request = createMockRequest();
      (request.getOrgId as ReturnType<typeof vi.fn>).mockReturnValue(validUUID);
      (request.getOrgPlan as ReturnType<typeof vi.fn>).mockReturnValue("pro");
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({ rows: [{ count: "100" }] });

      await middleware(request, reply);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("rca_jobs"),
        expect.arrayContaining([validUUID])
      );
    });
  });

  describe("LLM tokens rate limit", () => {
    it("should check cost_metrics table for token usage", async () => {
      const middleware = createRateLimitMiddleware({
        resource: "llm_tokens",
        period: "day",
      });

      const request = createMockRequest();
      (request.getOrgId as ReturnType<typeof vi.fn>).mockReturnValue(validUUID);
      (request.getOrgPlan as ReturnType<typeof vi.fn>).mockReturnValue(
        "enterprise"
      );
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({ rows: [{ llm_tokens_used: 50000 }] });

      await middleware(request, reply);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("cost_metrics"),
        expect.arrayContaining([validUUID])
      );
    });

    it("should default to 0 when no usage record exists", async () => {
      const middleware = createRateLimitMiddleware({
        resource: "llm_tokens",
        period: "day",
      });

      const request = createMockRequest();
      (request.getOrgId as ReturnType<typeof vi.fn>).mockReturnValue(validUUID);
      (request.getOrgPlan as ReturnType<typeof vi.fn>).mockReturnValue("free");
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({ rows: [] });

      await middleware(request, reply);

      expect(reply.status).not.toHaveBeenCalledWith(429);
    });
  });

  describe("org context handling", () => {
    it("should skip rate limiting when no org context", async () => {
      const middleware = createRateLimitMiddleware({
        resource: "events",
        period: "hour",
      });

      const request = createMockRequest();
      (request.getOrgId as ReturnType<typeof vi.fn>).mockReturnValue("");
      const reply = createMockReply();

      await middleware(request, reply);

      expect(mockPool.query).not.toHaveBeenCalled();
      expect(reply.status).not.toHaveBeenCalled();
    });

    it("should skip when org plan is unknown", async () => {
      const middleware = createRateLimitMiddleware({
        resource: "events",
        period: "hour",
      });

      const request = createMockRequest();
      (request.getOrgId as ReturnType<typeof vi.fn>).mockReturnValue(validUUID);
      (request.getOrgPlan as ReturnType<typeof vi.fn>).mockReturnValue(
        "unknown" as any
      );
      const reply = createMockReply();

      await middleware(request, reply);

      // Should log warning and skip
      expect(reply.status).not.toHaveBeenCalledWith(429);
    });
  });

  describe("period handling", () => {
    it("should use correct time window for hourly limits", async () => {
      const middleware = createRateLimitMiddleware({
        resource: "events",
        period: "hour",
      });

      const request = createMockRequest();
      (request.getOrgId as ReturnType<typeof vi.fn>).mockReturnValue(validUUID);
      (request.getOrgPlan as ReturnType<typeof vi.fn>).mockReturnValue("free");
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({ rows: [{ count: "10" }] });

      await middleware(request, reply);

      // Query should use timestamp from 1 hour ago
      const queryCall = mockPool.query.mock.calls[0];
      const timestamp = queryCall[1][1] as Date;
      const oneHourAgo = Date.now() - 60 * 60 * 1000;

      expect(timestamp.getTime()).toBeGreaterThanOrEqual(oneHourAgo - 1000);
      expect(timestamp.getTime()).toBeLessThanOrEqual(oneHourAgo + 1000);
    });

    it("should include reset_at in 429 response", async () => {
      const middleware = createRateLimitMiddleware({
        resource: "events",
        period: "hour",
      });

      const request = createMockRequest();
      (request.getOrgId as ReturnType<typeof vi.fn>).mockReturnValue(validUUID);
      (request.getOrgPlan as ReturnType<typeof vi.fn>).mockReturnValue("free");
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({ rows: [{ count: "999999" }] });

      await middleware(request, reply);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          quota: expect.objectContaining({
            reset_at: expect.any(Date),
          }),
        })
      );
    });
  });

  describe("rate limit headers", () => {
    it("should set X-RateLimit headers on every response", async () => {
      const middleware = createRateLimitMiddleware({
        resource: "rca_jobs",
        period: "day",
      });

      const request = createMockRequest();
      (request.getOrgId as ReturnType<typeof vi.fn>).mockReturnValue(validUUID);
      (request.getOrgPlan as ReturnType<typeof vi.fn>).mockReturnValue("pro");
      const reply = createMockReply();

      mockPool.query.mockResolvedValue({ rows: [{ count: "50" }] });

      await middleware(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        "X-RateLimit-Limit",
        expect.any(Number)
      );
      expect(reply.header).toHaveBeenCalledWith(
        "X-RateLimit-Remaining",
        expect.any(Number)
      );
    });
  });
});
