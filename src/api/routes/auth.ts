/**
 * Authentication Routes
 *
 * Endpoints:
 * - POST /api/auth/signup - Register new user
 * - POST /api/auth/login - Login with email/password
 * - POST /api/auth/logout - Logout (invalidate session)
 * - POST /api/auth/refresh - Refresh access token
 * - GET /api/auth/me - Get current user
 * - GET /api/auth/github - Initiate GitHub OAuth login
 * - GET /api/auth/github/callback - GitHub OAuth callback
 * - GET /api/auth/google - Initiate Google OAuth login
 * - GET /api/auth/google/callback - Google OAuth callback
 *
 * @module api/routes/auth
 */

import crypto from "crypto";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { authService, AuthError } from "../../services/auth.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../utils/config.js";

// ============================================
// Helper Functions
// ============================================

/**
 * Get the base URL from the request for OAuth redirects
 */
function getBaseUrl(request: FastifyRequest): string {
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const host =
    request.headers["x-forwarded-host"] ||
    request.headers.host ||
    "localhost:3000";
  return `${protocol}://${host}`;
}

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

  // ============================================
  // GitHub OAuth Login
  // ============================================

  /**
   * GET /api/auth/github
   * Initiate GitHub OAuth login flow
   */
  server.get(
    "/auth/github",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const clientId = config.GITHUB_OAUTH_CLIENT_ID;
      if (!clientId) {
        return reply.status(503).send({
          error: "OAUTH_NOT_CONFIGURED",
          message: "GitHub login is not configured. Please contact support.",
        });
      }

      // Generate state for CSRF protection
      const state = crypto.randomUUID();

      // Store state in session/cookie for verification
      reply.setCookie("oauth_state", state, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 600, // 10 minutes
      });

      const redirectUri = `${getBaseUrl(_request)}/api/auth/github/callback`;
      const scope = "user:email read:user";

      const authUrl = new URL("https://github.com/login/oauth/authorize");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("scope", scope);
      authUrl.searchParams.set("state", state);

      return reply.redirect(authUrl.toString());
    }
  );

  /**
   * GET /api/auth/github/callback
   * Handle GitHub OAuth callback
   */
  server.get(
    "/auth/github/callback",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { code, state } = request.query as {
        code?: string;
        state?: string;
      };
      const savedState = request.cookies?.oauth_state;

      // Clear the state cookie
      reply.clearCookie("oauth_state", { path: "/" });

      // Validate state
      if (!state || state !== savedState) {
        logger.warn({ state, savedState }, "OAuth state mismatch");
        return reply.redirect("/login?error=invalid_state");
      }

      if (!code) {
        return reply.redirect("/login?error=no_code");
      }

      try {
        const clientId = config.GITHUB_OAUTH_CLIENT_ID;
        const clientSecret = config.GITHUB_OAUTH_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
          return reply.redirect("/login?error=oauth_not_configured");
        }

        // Exchange code for access token
        const tokenResponse = await fetch(
          "https://github.com/login/oauth/access_token",
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              client_id: clientId,
              client_secret: clientSecret,
              code,
            }),
          }
        );

        const tokenData = (await tokenResponse.json()) as {
          access_token?: string;
          error?: string;
        };

        if (tokenData.error || !tokenData.access_token) {
          logger.error(
            { error: tokenData.error },
            "GitHub token exchange failed"
          );
          return reply.redirect("/login?error=token_exchange_failed");
        }

        // Get user info from GitHub
        const userResponse = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            Accept: "application/json",
          },
        });

        const githubUser = (await userResponse.json()) as {
          id: number;
          login: string;
          name?: string;
          email?: string;
          avatar_url?: string;
        };

        // Get user's primary email if not in profile
        let email = githubUser.email;
        if (!email) {
          const emailsResponse = await fetch(
            "https://api.github.com/user/emails",
            {
              headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                Accept: "application/json",
              },
            }
          );
          const emails = (await emailsResponse.json()) as Array<{
            email: string;
            primary: boolean;
            verified: boolean;
          }>;
          const primaryEmail = emails.find((e) => e.primary && e.verified);
          email = primaryEmail?.email;
        }

        if (!email) {
          return reply.redirect("/login?error=no_email");
        }

        // Login or signup with OAuth
        const result = await authService.loginWithOAuth({
          provider: "github",
          providerId: String(githubUser.id),
          email,
          name: githubUser.name || githubUser.login,
          avatarUrl: githubUser.avatar_url,
        });

        // Sign the JWT
        const accessToken = server.jwt.sign(
          { userId: result.user.id, orgId: result.user.orgId },
          { expiresIn: "1h" }
        );

        // Set refresh token cookie
        reply.setCookie("refreshToken", result.refreshToken, {
          httpOnly: true,
          secure: config.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 60,
        });

        // Redirect to app with token in URL (will be extracted by frontend)
        return reply.redirect(`/?token=${accessToken}&provider=github`);
      } catch (error) {
        logger.error(error, "GitHub OAuth callback error");
        return reply.redirect("/login?error=oauth_failed");
      }
    }
  );

  // ============================================
  // Google OAuth Login
  // ============================================

  /**
   * GET /api/auth/google
   * Initiate Google OAuth login flow
   */
  server.get(
    "/auth/google",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const clientId = config.GOOGLE_OAUTH_CLIENT_ID;
      if (!clientId) {
        return reply.status(503).send({
          error: "OAUTH_NOT_CONFIGURED",
          message: "Google login is not configured. Please contact support.",
        });
      }

      // Generate state for CSRF protection
      const state = crypto.randomUUID();

      reply.setCookie("oauth_state", state, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      });

      const redirectUri = `${getBaseUrl(_request)}/api/auth/google/callback`;
      const scope = "openid email profile";

      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", scope);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");

      return reply.redirect(authUrl.toString());
    }
  );

  /**
   * GET /api/auth/google/callback
   * Handle Google OAuth callback
   */
  server.get(
    "/auth/google/callback",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { code, state } = request.query as {
        code?: string;
        state?: string;
      };
      const savedState = request.cookies?.oauth_state;

      reply.clearCookie("oauth_state", { path: "/" });

      if (!state || state !== savedState) {
        logger.warn({ state, savedState }, "OAuth state mismatch");
        return reply.redirect("/login?error=invalid_state");
      }

      if (!code) {
        return reply.redirect("/login?error=no_code");
      }

      try {
        const clientId = config.GOOGLE_OAUTH_CLIENT_ID;
        const clientSecret = config.GOOGLE_OAUTH_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
          return reply.redirect("/login?error=oauth_not_configured");
        }

        const redirectUri = `${getBaseUrl(request)}/api/auth/google/callback`;

        // Exchange code for access token
        const tokenResponse = await fetch(
          "https://oauth2.googleapis.com/token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              code,
              redirect_uri: redirectUri,
              grant_type: "authorization_code",
            }),
          }
        );

        const tokenData = (await tokenResponse.json()) as {
          access_token?: string;
          id_token?: string;
          error?: string;
        };

        if (tokenData.error || !tokenData.access_token) {
          logger.error(
            { error: tokenData.error },
            "Google token exchange failed"
          );
          return reply.redirect("/login?error=token_exchange_failed");
        }

        // Get user info from Google
        const userResponse = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
            },
          }
        );

        const googleUser = (await userResponse.json()) as {
          id: string;
          email: string;
          name?: string;
          picture?: string;
          verified_email?: boolean;
        };

        if (!googleUser.email || !googleUser.verified_email) {
          return reply.redirect("/login?error=email_not_verified");
        }

        // Login or signup with OAuth
        const result = await authService.loginWithOAuth({
          provider: "google",
          providerId: googleUser.id,
          email: googleUser.email,
          name: googleUser.name || googleUser.email.split("@")[0],
          avatarUrl: googleUser.picture,
        });

        // Sign the JWT
        const accessToken = server.jwt.sign(
          { userId: result.user.id, orgId: result.user.orgId },
          { expiresIn: "1h" }
        );

        // Set refresh token cookie
        reply.setCookie("refreshToken", result.refreshToken, {
          httpOnly: true,
          secure: config.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 60,
        });

        return reply.redirect(`/?token=${accessToken}&provider=google`);
      } catch (error) {
        logger.error(error, "Google OAuth callback error");
        return reply.redirect("/login?error=oauth_failed");
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
