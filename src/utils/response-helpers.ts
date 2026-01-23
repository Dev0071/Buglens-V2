/**
 * Response Helpers
 *
 * Standardized response utilities for Fastify routes.
 * Eliminates duplicate reply.status().send() patterns across 215+ route handlers.
 *
 * Usage:
 *   import { sendError, sendSuccess, sendUnauthorized } from '../utils/response-helpers.js';
 *
 *   // Instead of: reply.status(401).send({ error: "Unauthorized", message: "..." })
 *   return sendUnauthorized(reply, "Authentication required");
 *
 *   // Instead of: reply.status(200).send({ data: result })
 *   return sendSuccess(reply, result);
 */

import type { FastifyReply } from "fastify";

// ============================================
// Types
// ============================================

export interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface SuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================
// Error Responses (4xx, 5xx)
// ============================================

/**
 * Send a generic error response
 *
 * @param reply - Fastify reply object
 * @param status - HTTP status code
 * @param error - Error type/name
 * @param message - Human-readable error message
 * @param details - Optional additional details
 */
export function sendError(
  reply: FastifyReply,
  status: number,
  error: string,
  message: string,
  details?: Record<string, unknown>
): FastifyReply {
  const response: ErrorResponse = { error, message };
  if (details) {
    response.details = details;
  }
  return reply.status(status).send(response);
}

/**
 * 400 Bad Request - Invalid request data
 */
export function sendBadRequest(
  reply: FastifyReply,
  message: string,
  details?: Record<string, unknown>
): FastifyReply {
  return sendError(reply, 400, "Bad Request", message, details);
}

/**
 * 401 Unauthorized - Missing or invalid authentication
 */
export function sendUnauthorized(
  reply: FastifyReply,
  message = "Authentication required"
): FastifyReply {
  return sendError(reply, 401, "Unauthorized", message);
}

/**
 * 403 Forbidden - Authenticated but not allowed
 */
export function sendForbidden(
  reply: FastifyReply,
  message = "You do not have permission to access this resource"
): FastifyReply {
  return sendError(reply, 403, "Forbidden", message);
}

/**
 * 404 Not Found - Resource doesn't exist
 */
export function sendNotFound(
  reply: FastifyReply,
  resource = "Resource",
  id?: string
): FastifyReply {
  const message = id
    ? `${resource} with ID '${id}' not found`
    : `${resource} not found`;
  return sendError(reply, 404, "Not Found", message);
}

/**
 * 409 Conflict - Resource already exists or state conflict
 */
export function sendConflict(
  reply: FastifyReply,
  message: string
): FastifyReply {
  return sendError(reply, 409, "Conflict", message);
}

/**
 * 422 Unprocessable Entity - Validation errors
 */
export function sendValidationError(
  reply: FastifyReply,
  message: string,
  errors?: Record<string, string[]>
): FastifyReply {
  return sendError(
    reply,
    422,
    "Validation Error",
    message,
    errors ? { errors } : undefined
  );
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export function sendRateLimited(
  reply: FastifyReply,
  retryAfterSeconds?: number
): FastifyReply {
  if (retryAfterSeconds) {
    reply.header("Retry-After", String(retryAfterSeconds));
  }
  return sendError(
    reply,
    429,
    "Too Many Requests",
    "Rate limit exceeded. Please try again later."
  );
}

/**
 * 500 Internal Server Error - Unexpected server error
 */
export function sendInternalError(
  reply: FastifyReply,
  message = "An unexpected error occurred"
): FastifyReply {
  return sendError(reply, 500, "Internal Server Error", message);
}

/**
 * 503 Service Unavailable - Service temporarily unavailable
 */
export function sendServiceUnavailable(
  reply: FastifyReply,
  service: string,
  message?: string
): FastifyReply {
  return sendError(
    reply,
    503,
    "Service Unavailable",
    message || `${service} is not configured or temporarily unavailable`
  );
}

// ============================================
// Success Responses (2xx)
// ============================================

/**
 * 200 OK - Generic success response
 */
export function sendSuccess<T>(
  reply: FastifyReply,
  data?: T,
  message?: string
): FastifyReply {
  const response: SuccessResponse<T> = { success: true };
  if (data !== undefined) {
    response.data = data;
  }
  if (message) {
    response.message = message;
  }
  return reply.status(200).send(response);
}

/**
 * 200 OK - Send raw data without wrapper
 */
export function sendData<T>(reply: FastifyReply, data: T): FastifyReply {
  return reply.status(200).send(data);
}

/**
 * 201 Created - Resource created successfully
 */
export function sendCreated<T>(
  reply: FastifyReply,
  data: T,
  message?: string
): FastifyReply {
  const response: SuccessResponse<T> = { success: true, data };
  if (message) {
    response.message = message;
  }
  return reply.status(201).send(response);
}

/**
 * 202 Accepted - Request accepted for processing
 */
export function sendAccepted(
  reply: FastifyReply,
  message = "Request accepted for processing",
  jobId?: string
): FastifyReply {
  return reply.status(202).send({
    success: true,
    message,
    ...(jobId && { jobId }),
  });
}

/**
 * 204 No Content - Success with no body
 */
export function sendNoContent(reply: FastifyReply): FastifyReply {
  return reply.status(204).send();
}

/**
 * Send paginated response
 */
export function sendPaginated<T>(
  reply: FastifyReply,
  data: T[],
  page: number,
  limit: number,
  total: number
): FastifyReply {
  const response: PaginatedResponse<T> = {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
  return reply.status(200).send(response);
}

// ============================================
// OAuth / Redirect Helpers
// ============================================

/**
 * Redirect with success parameter
 */
export function redirectWithSuccess(
  reply: FastifyReply,
  path: string,
  successKey: string
): FastifyReply {
  return reply.redirect(`${path}?success=${encodeURIComponent(successKey)}`);
}

/**
 * Redirect with error parameter
 */
export function redirectWithError(
  reply: FastifyReply,
  path: string,
  errorKey: string
): FastifyReply {
  return reply.redirect(`${path}?error=${encodeURIComponent(errorKey)}`);
}

// ============================================
// Utility Functions
// ============================================

/**
 * Extract org_id from request and validate
 * Returns null and sends 401 if not found
 */
export function getOrgIdOrFail(
  reply: FastifyReply,
  orgId: string | undefined | null
): string | null {
  if (!orgId) {
    sendUnauthorized(reply, "Organization context required");
    return null;
  }
  return orgId;
}
