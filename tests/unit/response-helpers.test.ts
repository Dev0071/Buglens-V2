/**
 * Response Helpers Unit Tests
 *
 * Tests for standardized HTTP response utilities
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyReply } from "fastify";

import {
  sendError,
  sendBadRequest,
  sendUnauthorized,
  sendForbidden,
  sendNotFound,
  sendConflict,
  sendValidationError,
  sendRateLimited,
  sendInternalError,
  sendServiceUnavailable,
  sendSuccess,
  sendData,
  sendCreated,
  sendAccepted,
  sendNoContent,
  sendPaginated,
  redirectWithSuccess,
  redirectWithError,
  getOrgIdOrFail,
} from "../../src/utils/response-helpers.js";

describe("response-helpers", () => {
  let mockReply: FastifyReply;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      redirect: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;
  });

  // ============================================
  // Error Response Tests
  // ============================================
  describe("sendError", () => {
    it("should send error with correct status and message", () => {
      sendError(mockReply, 400, "Bad Request", "Invalid input");

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Bad Request",
        message: "Invalid input",
      });
    });

    it("should include optional details when provided", () => {
      sendError(mockReply, 422, "Validation Error", "Validation failed", {
        errors: { email: ["Invalid format"] },
      });

      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Validation Error",
        message: "Validation failed",
        details: { errors: { email: ["Invalid format"] } },
      });
    });
  });

  describe("sendBadRequest", () => {
    it("should send 400 status with message", () => {
      sendBadRequest(mockReply, "Invalid input");
      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Bad Request",
        message: "Invalid input",
      });
    });

    it("should include details when provided", () => {
      sendBadRequest(mockReply, "Invalid data", { field: "email" });
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { field: "email" },
        })
      );
    });
  });

  describe("sendUnauthorized", () => {
    it("should send 401 status", () => {
      sendUnauthorized(mockReply);
      expect(mockReply.status).toHaveBeenCalledWith(401);
    });

    it("should use default message when not provided", () => {
      sendUnauthorized(mockReply);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Authentication required" })
      );
    });

    it("should use custom message", () => {
      sendUnauthorized(mockReply, "Token expired");
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Token expired" })
      );
    });
  });

  describe("sendForbidden", () => {
    it("should send 403 status", () => {
      sendForbidden(mockReply);
      expect(mockReply.status).toHaveBeenCalledWith(403);
    });

    it("should use custom message", () => {
      sendForbidden(mockReply, "Admin access only");
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Admin access only" })
      );
    });
  });

  describe("sendNotFound", () => {
    it("should send 404 status", () => {
      sendNotFound(mockReply, "Event");
      expect(mockReply.status).toHaveBeenCalledWith(404);
    });

    it("should include resource name in message", () => {
      sendNotFound(mockReply, "Event");
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Event not found" })
      );
    });

    it("should include ID in message when provided", () => {
      sendNotFound(mockReply, "Event", "evt_123");
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Event with ID 'evt_123' not found",
        })
      );
    });
  });

  describe("sendConflict", () => {
    it("should send 409 status", () => {
      sendConflict(mockReply, "Resource already exists");
      expect(mockReply.status).toHaveBeenCalledWith(409);
    });
  });

  describe("sendValidationError", () => {
    it("should send 422 status with message", () => {
      sendValidationError(mockReply, "Validation failed");

      expect(mockReply.status).toHaveBeenCalledWith(422);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Validation Error",
        message: "Validation failed",
      });
    });

    it("should include errors when provided", () => {
      sendValidationError(mockReply, "Validation failed", {
        email: ["Invalid format"],
      });

      expect(mockReply.send).toHaveBeenCalledWith({
        error: "Validation Error",
        message: "Validation failed",
        details: { errors: { email: ["Invalid format"] } },
      });
    });
  });

  describe("sendRateLimited", () => {
    it("should send 429 status", () => {
      sendRateLimited(mockReply);
      expect(mockReply.status).toHaveBeenCalledWith(429);
    });

    it("should set retry-after header when provided", () => {
      sendRateLimited(mockReply, 60);
      expect(mockReply.header).toHaveBeenCalledWith("Retry-After", "60");
    });
  });

  describe("sendInternalError", () => {
    it("should send 500 status", () => {
      sendInternalError(mockReply);
      expect(mockReply.status).toHaveBeenCalledWith(500);
    });

    it("should use custom message when provided", () => {
      sendInternalError(mockReply, "Database connection failed");
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Database connection failed" })
      );
    });
  });

  describe("sendServiceUnavailable", () => {
    it("should send 503 status", () => {
      sendServiceUnavailable(mockReply, "GitHub");
      expect(mockReply.status).toHaveBeenCalledWith(503);
    });

    it("should include service name in default message", () => {
      sendServiceUnavailable(mockReply, "Slack");
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Slack is not configured or temporarily unavailable",
        })
      );
    });

    it("should use custom message when provided", () => {
      sendServiceUnavailable(mockReply, "GitHub", "GitHub API is down");
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({ message: "GitHub API is down" })
      );
    });
  });

  // ============================================
  // Success Response Tests
  // ============================================
  describe("sendSuccess", () => {
    it("should send 200 status", () => {
      sendSuccess(mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({ success: true });
    });

    it("should include data when provided", () => {
      const data = { id: "123", name: "Test" };
      sendSuccess(mockReply, data);

      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        data,
      });
    });

    it("should include message when provided", () => {
      sendSuccess(mockReply, undefined, "Operation completed");

      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        message: "Operation completed",
      });
    });
  });

  describe("sendData", () => {
    it("should send 200 status with raw data", () => {
      const data = { id: "123", name: "Test" };
      sendData(mockReply, data);

      expect(mockReply.status).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith(data);
    });
  });

  describe("sendCreated", () => {
    it("should send 201 status", () => {
      const data = { id: "new_123" };
      sendCreated(mockReply, data);

      expect(mockReply.status).toHaveBeenCalledWith(201);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        data,
      });
    });

    it("should include message when provided", () => {
      sendCreated(mockReply, { id: "1" }, "Created successfully");

      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        data: { id: "1" },
        message: "Created successfully",
      });
    });
  });

  describe("sendAccepted", () => {
    it("should send 202 status", () => {
      sendAccepted(mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(202);
    });

    it("should include jobId when provided", () => {
      sendAccepted(mockReply, "Processing started", "job_123");

      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        message: "Processing started",
        jobId: "job_123",
      });
    });
  });

  describe("sendNoContent", () => {
    it("should send 204 status with no body", () => {
      sendNoContent(mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(204);
      expect(mockReply.send).toHaveBeenCalled();
    });
  });

  describe("sendPaginated", () => {
    it("should send paginated response with all pagination fields", () => {
      const data = [{ id: "1" }, { id: "2" }];

      sendPaginated(mockReply, data, 2, 10, 100);

      expect(mockReply.status).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        data,
        pagination: {
          page: 2,
          limit: 10,
          total: 100,
          totalPages: 10,
        },
      });
    });
  });

  // ============================================
  // Redirect Tests
  // ============================================
  describe("redirectWithSuccess", () => {
    it("should redirect with success parameter", () => {
      redirectWithSuccess(mockReply, "/dashboard", "login_success");

      expect(mockReply.redirect).toHaveBeenCalledWith(
        "/dashboard?success=login_success"
      );
    });
  });

  describe("redirectWithError", () => {
    it("should redirect with error parameter", () => {
      redirectWithError(mockReply, "/login", "invalid_credentials");

      expect(mockReply.redirect).toHaveBeenCalledWith(
        "/login?error=invalid_credentials"
      );
    });
  });

  // ============================================
  // getOrgIdOrFail Tests
  // ============================================
  describe("getOrgIdOrFail", () => {
    it("should return org_id when present", () => {
      const result = getOrgIdOrFail(mockReply, "org_12345");
      expect(result).toBe("org_12345");
    });

    it("should send 401 and return null when org_id is null", () => {
      const result = getOrgIdOrFail(mockReply, null);

      expect(result).toBeNull();
      expect(mockReply.status).toHaveBeenCalledWith(401);
    });

    it("should send 401 and return null when org_id is undefined", () => {
      const result = getOrgIdOrFail(mockReply, undefined);

      expect(result).toBeNull();
      expect(mockReply.status).toHaveBeenCalledWith(401);
    });
  });
});
