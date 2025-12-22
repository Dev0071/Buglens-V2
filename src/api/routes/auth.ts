/**
 * Authentication Routes
 *
 * Endpoints:
 * - POST /api/auth/signup - Register new user
 * - POST /api/auth/login - Login with email/password
 * - POST /api/auth/logout - Logout (invalidate session)
 * - POST /api/auth/refresh - Refresh access token
 * - GET /api/auth/me - Get current user
 *
 * @module api/routes/auth
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { authService, AuthError } from "../../services/auth.js";
import { logger } from "../../utils/logger.js";

// ============================================
// Schemas
// ============================================

const signupSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(100),
  organizationName: z.string().max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

// Reserved for POST /api/auth/refresh endpoint (future implementation)
// Exported to prevent unused variable error while keeping for future use
export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

// ============================================
// Route Handler
// ============================================

export async function authRoutes(server: FastifyInstance): Promise<void> {
  logger.info("Auth routes registered");

  /**
   * POST /api/auth/signup
   * Register a new user and organization
   */
  server.post(
    "/auth/signup",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password", "name"],
          properties: {
            email: { type: "string" },
            password: { type: "string" },
            name: { type: "string" },
            organizationName: { type: "string" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = signupSchema.parse(request.body);

        const result = await authService.signup({
          email: body.email,
          password: body.password,
          name: body.name,
          organizationName: body.organizationName,
        });

        // Sign the JWT with the user ID
        const accessToken = server.jwt.sign(
          { userId: result.user.id, orgId: result.user.orgId },
          { expiresIn: "1h" }
        );

        // Set refresh token in HTTP-only cookie
        reply.setCookie("refreshToken", result.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 60, // 30 days
        });

        return reply.status(201).send({
          user: result.user,
          organization: result.organization,
          accessToken,
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  /**
   * POST /api/auth/login
   * Authenticate with email and password
   */
  server.post(
    "/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string" },
            password: { type: "string" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = loginSchema.parse(request.body);

        const result = await authService.login(
          { email: body.email, password: body.password },
          request.headers["user-agent"],
          request.ip
        );

        // Sign the JWT with the user ID
        const accessToken = server.jwt.sign(
          { userId: result.user.id, orgId: result.user.orgId },
          { expiresIn: "1h" }
        );

        // Set refresh token in HTTP-only cookie
        reply.setCookie("refreshToken", result.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 60, // 30 days
        });

        return reply.status(200).send({
          user: result.user,
          organization: result.organization,
          accessToken,
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  /**
   * POST /api/auth/logout
   * Invalidate current session
   */
  server.post(
    "/auth/logout",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const refreshToken = request.cookies?.refreshToken;

        if (refreshToken) {
          await authService.logout(refreshToken);
        }

        // Clear the cookie
        reply.clearCookie("refreshToken", {
          path: "/",
        });

        return reply
          .status(200)
          .send({ success: true, message: "Logged out successfully" });
      } catch (error) {
        logger.error(error, "Logout error");
        return reply.status(200).send({ success: true, message: "Logged out" });
      }
    }
  );

  /**
   * POST /api/auth/refresh
   * Refresh access token using refresh token
   */
  server.post(
    "/auth/refresh",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Get refresh token from cookie or body
        const refreshToken =
          request.cookies?.refreshToken ||
          (request.body as { refreshToken?: string })?.refreshToken;

        if (!refreshToken) {
          return reply.status(401).send({
            error: "Unauthorized",
            message: "Refresh token is required",
          });
        }

        const result = await authService.refreshSession(refreshToken);

        // Get user info for new access token
        // First, find the user from the new session
        const sessionResult = await import("../../db/client.js").then((m) =>
          m.query<{ user_id: string }>(
            "SELECT user_id FROM sessions WHERE refresh_token = $1",
            [result.refreshToken]
          )
        );

        if (sessionResult.rows.length === 0) {
          throw new AuthError("Session not found", "INVALID_TOKEN");
        }

        const { user, organization } = await authService.getCurrentUser(
          sessionResult.rows[0].user_id
        );

        // Sign new JWT
        const accessToken = server.jwt.sign(
          { userId: user.id, orgId: user.orgId },
          { expiresIn: "1h" }
        );

        // Update refresh token cookie
        reply.setCookie("refreshToken", result.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 60,
        });

        return reply.status(200).send({
          user,
          organization,
          accessToken,
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  /**
   * GET /api/auth/me
   * Get current authenticated user
   */
  server.get(
    "/auth/me",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Verify JWT from Authorization header
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return reply.status(401).send({
            error: "Unauthorized",
            message: "Access token is required",
          });
        }

        const token = authHeader.substring(7);

        let decoded: { userId: string; orgId: string };
        try {
          decoded = server.jwt.verify<{ userId: string; orgId: string }>(token);
        } catch {
          return reply.status(401).send({
            error: "Unauthorized",
            message: "Invalid or expired access token",
          });
        }

        const { user, organization } = await authService.getCurrentUser(
          decoded.userId
        );

        return reply.status(200).send({ user, organization });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  /**
   * POST /api/auth/logout-all
   * Logout from all devices (requires authentication)
   */
  server.post(
    "/auth/logout-all",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return reply.status(401).send({
            error: "Unauthorized",
            message: "Access token is required",
          });
        }

        const token = authHeader.substring(7);

        let decoded: { userId: string };
        try {
          decoded = server.jwt.verify<{ userId: string }>(token);
        } catch {
          return reply.status(401).send({
            error: "Unauthorized",
            message: "Invalid or expired access token",
          });
        }

        await authService.logoutAll(decoded.userId);

        // Clear the cookie
        reply.clearCookie("refreshToken", {
          path: "/",
        });

        return reply.status(200).send({
          success: true,
          message: "Logged out from all devices",
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );
}

// ============================================
// Error Handler
// ============================================

function handleAuthError(error: unknown, reply: FastifyReply) {
  if (error instanceof AuthError) {
    const statusCodes: Record<AuthError["code"], number> = {
      INVALID_EMAIL: 400,
      WEAK_PASSWORD: 400,
      EMAIL_EXISTS: 409,
      INVALID_CREDENTIALS: 401,
      OAUTH_ONLY: 400,
      USER_NOT_FOUND: 404,
      INVALID_TOKEN: 401,
      UNAUTHORIZED: 401,
    };

    return reply.status(statusCodes[error.code] || 400).send({
      error: error.code,
      message: error.message,
    });
  }

  if (error instanceof z.ZodError) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: error.errors.map((e) => e.message).join(", "),
      details: error.errors,
    });
  }

  logger.error(error, "Auth error");
  return reply.status(500).send({
    error: "INTERNAL_ERROR",
    message: "An unexpected error occurred",
  });
}
