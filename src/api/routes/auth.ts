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
 * - GET /api/auth/providers - Get available OAuth providers
 *
 * @module api/routes/auth
 */

import crypto from "crypto";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { authService, AuthError } from "../../services/auth.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../utils/config.js";
import { platformCredentials } from "../../services/platform-credentials.js";
import {
  generateCodeVerifier,
  generateCodeChallenge,
} from "../../services/oauth.js";
import {
  linkOAuthProvider,
  getLinkedAccounts,
  unlinkOAuthProvider,
  switchPrimaryProvider,
} from "../../services/account-linking.js";
import {
  logLogin,
  logLoginFailed,
  logLogout,
  logSignup,
  logOrgCreated,
} from "../../services/audit.js";
import { getApiBaseUrl, getOAuthCallbackUrl } from "../../utils/url-helpers.js";

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

        // Set access token in HTTP-only cookie (SOC2 compliance)
        reply.setCookie("accessToken", accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60, // 1 hour
        });

        // Set refresh token in HTTP-only cookie
        reply.setCookie("refreshToken", result.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 60, // 30 days
        });

        // Audit logging for SOC2 compliance
        await logSignup(
          result.user.id,
          result.user.orgId,
          body.email,
          request.ip,
          request.headers["user-agent"] as string
        );
        await logOrgCreated(
          result.user.id,
          result.user.orgId,
          result.organization.name,
          request.ip
        );

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

        // Set access token in HTTP-only cookie (SOC2 compliance)
        reply.setCookie("accessToken", accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60, // 1 hour
        });

        // Set refresh token in HTTP-only cookie
        reply.setCookie("refreshToken", result.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 60, // 30 days
        });

        // Audit logging for SOC2 compliance
        await logLogin(
          result.user.id,
          result.user.orgId,
          request.ip,
          request.headers["user-agent"] as string,
          { method: "password" }
        );

        return reply.status(200).send({
          user: result.user,
          organization: result.organization,
          accessToken,
        });
      } catch (error) {
        // Log failed login attempts for security monitoring
        if (
          error instanceof AuthError &&
          error.code === "INVALID_CREDENTIALS"
        ) {
          const body = request.body as { email?: string };
          await logLoginFailed(
            body.email || "unknown",
            request.ip,
            request.headers["user-agent"] as string,
            "invalid_credentials"
          );
        }
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
        const accessToken = request.cookies?.accessToken;

        // Try to get user info for audit logging before clearing
        let userId: string | undefined;
        let orgId: string | undefined;
        if (accessToken) {
          try {
            const decoded = server.jwt.verify<{
              userId: string;
              orgId: string;
            }>(accessToken);
            userId = decoded.userId;
            orgId = decoded.orgId;
          } catch {
            // Token may be expired, continue with logout
          }
        }

        if (refreshToken) {
          await authService.logout(refreshToken);
        }

        // Clear both cookies (SOC2 compliance)
        reply.clearCookie("accessToken", {
          path: "/",
        });
        reply.clearCookie("refreshToken", {
          path: "/",
        });

        // Audit log the logout
        if (userId && orgId) {
          await logLogout(
            userId,
            orgId,
            request.ip,
            request.headers["user-agent"] as string
          );
        }

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

        // Set access token in HTTP-only cookie (SOC2 compliance)
        reply.setCookie("accessToken", accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60, // 1 hour
        });

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
        // Try to get JWT from Authorization header first, then cookie
        // Cookie-based auth is preferred for SOC2 compliance (httpOnly)
        let token: string | undefined;

        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          token = authHeader.substring(7);
        } else if (request.cookies?.accessToken) {
          // Fall back to httpOnly cookie (SOC2 compliant)
          token = request.cookies.accessToken;
        }

        if (!token) {
          return reply.status(401).send({
            error: "Unauthorized",
            message: "Access token is required",
          });
        }

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
        // Try to get JWT from Authorization header first, then cookie
        let token: string | undefined;

        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          token = authHeader.substring(7);
        } else if (request.cookies?.accessToken) {
          token = request.cookies.accessToken;
        }

        if (!token) {
          return reply.status(401).send({
            error: "Unauthorized",
            message: "Access token is required",
          });
        }

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

        // Clear both cookies (SOC2 compliance)
        reply.clearCookie("accessToken", {
          path: "/",
        });
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
   * Uses platform-owned OAuth credentials (no user configuration needed)
   */
  server.get(
    "/auth/github",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const credentials = platformCredentials.getGitHubOAuth();
      if (!credentials) {
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

      const redirectUri = getOAuthCallbackUrl("github", "auth");
      const scope = "user:email read:user";

      const authUrl = new URL("https://github.com/login/oauth/authorize");
      authUrl.searchParams.set("client_id", credentials.clientId);
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

      const frontendUrl = config.FRONTEND_URL;

      // Validate state
      if (!state || state !== savedState) {
        logger.warn({ state, savedState }, "OAuth state mismatch");
        return reply.redirect(`${frontendUrl}/login?error=invalid_state`);
      }

      if (!code) {
        return reply.redirect(`${frontendUrl}/login?error=no_code`);
      }

      try {
        const credentials = platformCredentials.getGitHubOAuth();

        if (!credentials) {
          return reply.redirect(`${frontendUrl}/login?error=oauth_not_configured`);
        }

        // Exchange code for access token using platform credentials
        const tokenResponse = await fetch(
          "https://github.com/login/oauth/access_token",
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              client_id: credentials.clientId,
              client_secret: credentials.clientSecret,
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
          return reply.redirect(`${frontendUrl}/login?error=token_exchange_failed`);
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
          return reply.redirect(`${frontendUrl}/login?error=no_email`);
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

        // Redirect to frontend with token in URL (will be extracted by frontend)
        return reply.redirect(`${frontendUrl}/?token=${accessToken}&provider=github`);
      } catch (error) {
        logger.error(error, "GitHub OAuth callback error");
        return reply.redirect(`${frontendUrl}/login?error=oauth_failed`);
      }
    }
  );

  // ============================================
  // Google OAuth Login
  // ============================================

  /**
   * GET /api/auth/google
   * Initiate Google OAuth login flow with PKCE
   * Uses platform-owned OAuth credentials (no user configuration needed)
   */
  server.get(
    "/auth/google",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const credentials = platformCredentials.getGoogleOAuth();
      if (!credentials) {
        return reply.status(503).send({
          error: "OAUTH_NOT_CONFIGURED",
          message: "Google login is not configured. Please contact support.",
        });
      }

      // Generate state for CSRF protection
      const state = crypto.randomUUID();

      // Generate PKCE code verifier and challenge
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      // Store state and code verifier in cookies
      reply.setCookie("oauth_state", state, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      });

      // Store code verifier for PKCE (needed during token exchange)
      reply.setCookie("oauth_verifier", codeVerifier, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      });

      const redirectUri = getOAuthCallbackUrl("google", "auth");
      const scope = "openid email profile";

      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", credentials.clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", scope);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      // PKCE parameters
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");

      return reply.redirect(authUrl.toString());
    }
  );

  /**
   * GET /api/auth/google/callback
   * Handle Google OAuth callback with PKCE
   */
  server.get(
    "/auth/google/callback",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { code, state } = request.query as {
        code?: string;
        state?: string;
      };
      const savedState = request.cookies?.oauth_state;
      const codeVerifier = request.cookies?.oauth_verifier;

      // Clear the cookies
      reply.clearCookie("oauth_state", { path: "/" });
      reply.clearCookie("oauth_verifier", { path: "/" });

      const frontendUrl = config.FRONTEND_URL;

      if (!state || state !== savedState) {
        logger.warn({ state, savedState }, "OAuth state mismatch");
        return reply.redirect(`${frontendUrl}/login?error=invalid_state`);
      }

      if (!code) {
        return reply.redirect(`${frontendUrl}/login?error=no_code`);
      }

      try {
        const credentials = platformCredentials.getGoogleOAuth();

        if (!credentials) {
          return reply.redirect(`${frontendUrl}/login?error=oauth_not_configured`);
        }

        const redirectUri = getOAuthCallbackUrl("google", "auth");

        // Exchange code for access token using platform credentials + PKCE
        const tokenParams: Record<string, string> = {
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        };

        // Include code verifier for PKCE
        if (codeVerifier) {
          tokenParams.code_verifier = codeVerifier;
        }

        const tokenResponse = await fetch(
          "https://oauth2.googleapis.com/token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams(tokenParams),
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
          return reply.redirect(`${frontendUrl}/login?error=token_exchange_failed`);
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
          return reply.redirect(`${frontendUrl}/login?error=email_not_verified`);
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

        return reply.redirect(`${frontendUrl}/?token=${accessToken}&provider=google`);
      } catch (error) {
        logger.error(error, "Google OAuth callback error");
        return reply.redirect(`${frontendUrl}/login?error=oauth_failed`);
      }
    }
  );

  // ============================================
  // OAuth Providers Discovery
  // ============================================

  /**
   * GET /api/auth/providers
   * Get available OAuth providers for login
   * Returns which providers are configured at the platform level
   */
  server.get(
    "/auth/providers",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const providers: Array<{
        id: string;
        name: string;
        available: boolean;
        icon?: string;
      }> = [
        {
          id: "google",
          name: "Google",
          available: platformCredentials.isConfigured("google"),
          icon: "google",
        },
        {
          id: "github",
          name: "GitHub",
          available: platformCredentials.isConfigured("github"),
          icon: "github",
        },
      ];

      return reply.send({
        providers: providers.filter((p) => p.available),
        allProviders: providers,
      });
    }
  );

  // ============================================
  // Account Linking Routes
  // ============================================

  /**
   * GET /api/auth/linked-accounts
   * Get all linked OAuth providers for the current user
   */
  server.get(
    "/auth/linked-accounts",
    { preHandler: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.getUserId();

      if (!userId) {
        return reply.status(401).send({
          error: "UNAUTHORIZED",
          message: "Authentication required",
        });
      }

      try {
        const linkedAccounts = await getLinkedAccounts(userId);

        return reply.send({
          accounts: linkedAccounts.map((account) => ({
            id: account.id,
            provider: account.provider,
            email: account.email,
            name: account.name,
            avatarUrl: account.avatarUrl,
            linkedAt: account.linkedAt.toISOString(),
            isPrimary: account.id === "primary",
          })),
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  /**
   * GET /api/auth/link/:provider
   * Initiate OAuth flow to link a new provider
   */
  server.get(
    "/auth/link/:provider",
    { preHandler: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.getUserId();
      const { provider } = request.params as { provider: string };

      if (!userId) {
        return reply.status(401).send({
          error: "UNAUTHORIZED",
          message: "Authentication required",
        });
      }

      if (provider !== "google" && provider !== "github") {
        return reply.status(400).send({
          error: "INVALID_PROVIDER",
          message: "Supported providers: google, github",
        });
      }

      const baseUrl = getApiBaseUrl();
      const state = crypto.randomBytes(32).toString("hex");

      // Store state with user ID for linking (not login)
      reply.setCookie("oauth_link_state", state, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 600, // 10 minutes
      });

      reply.setCookie("oauth_link_user", userId, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      });

      if (provider === "github") {
        const credentials = platformCredentials.getGitHubOAuth();
        if (!credentials) {
          return reply.status(503).send({
            error: "PROVIDER_NOT_CONFIGURED",
            message: "GitHub OAuth is not configured",
          });
        }

        const redirectUri = `${baseUrl}/api/auth/link/github/callback`;
        const authUrl = new URL("https://github.com/login/oauth/authorize");
        authUrl.searchParams.set("client_id", credentials.clientId);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("scope", "user:email read:user");
        authUrl.searchParams.set("state", state);

        return reply.redirect(authUrl.toString());
      }

      if (provider === "google") {
        const credentials = platformCredentials.getGoogleOAuth();
        if (!credentials) {
          return reply.status(503).send({
            error: "PROVIDER_NOT_CONFIGURED",
            message: "Google OAuth is not configured",
          });
        }

        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);

        reply.setCookie("oauth_link_verifier", codeVerifier, {
          httpOnly: true,
          secure: config.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 600,
        });

        const redirectUri = `${baseUrl}/api/auth/link/google/callback`;
        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.searchParams.set("client_id", credentials.clientId);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", "openid email profile");
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", codeChallenge);
        authUrl.searchParams.set("code_challenge_method", "S256");
        authUrl.searchParams.set("access_type", "offline");

        return reply.redirect(authUrl.toString());
      }
    }
  );

  /**
   * GET /api/auth/link/github/callback
   * Handle GitHub OAuth callback for account linking
   */
  server.get("/auth/link/github/callback", async (request, reply) => {
    const { code, state } = request.query as {
      code?: string;
      state?: string;
    };

    const storedState = request.cookies.oauth_link_state;
    const userId = request.cookies.oauth_link_user;

    // Clear cookies
    reply.clearCookie("oauth_link_state");
    reply.clearCookie("oauth_link_user");

    if (!code || !state || state !== storedState || !userId) {
      return reply.redirect("/settings/account?error=invalid_state");
    }

    try {
      const credentials = platformCredentials.getGitHubOAuth();
      if (!credentials) {
        return reply.redirect(
          "/settings/account?error=provider_not_configured"
        );
      }

      // Exchange code for token
      const tokenResponse = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            code,
          }),
        }
      );

      const tokens = (await tokenResponse.json()) as {
        access_token?: string;
        error?: string;
      };

      if (!tokens.access_token) {
        return reply.redirect("/settings/account?error=oauth_failed");
      }

      // Get user info
      const userResponse = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const githubUser = (await userResponse.json()) as {
        id: number;
        email: string;
        name: string;
        avatar_url: string;
      };

      // Get primary email if not public
      let email = githubUser.email;
      if (!email) {
        const emailsResponse = await fetch(
          "https://api.github.com/user/emails",
          {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          }
        );
        const emails = (await emailsResponse.json()) as Array<{
          email: string;
          primary: boolean;
        }>;
        email = emails.find((e) => e.primary)?.email || emails[0]?.email;
      }

      // Link the account
      await linkOAuthProvider(userId, {
        provider: "github",
        providerId: String(githubUser.id),
        email,
        name: githubUser.name,
        avatarUrl: githubUser.avatar_url,
      });

      return reply.redirect("/settings/account?success=github_linked");
    } catch (error) {
      logger.error({ error }, "GitHub account linking failed");
      if (error instanceof AuthError) {
        return reply.redirect(
          `/settings/account?error=${error.code.toLowerCase()}`
        );
      }
      return reply.redirect("/settings/account?error=link_failed");
    }
  });

  /**
   * GET /api/auth/link/google/callback
   * Handle Google OAuth callback for account linking
   */
  server.get("/auth/link/google/callback", async (request, reply) => {
    const { code, state } = request.query as {
      code?: string;
      state?: string;
    };

    const storedState = request.cookies.oauth_link_state;
    const userId = request.cookies.oauth_link_user;
    const codeVerifier = request.cookies.oauth_link_verifier;

    // Clear cookies
    reply.clearCookie("oauth_link_state");
    reply.clearCookie("oauth_link_user");
    reply.clearCookie("oauth_link_verifier");

    if (!code || !state || state !== storedState || !userId || !codeVerifier) {
      return reply.redirect("/settings/account?error=invalid_state");
    }

    try {
      const credentials = platformCredentials.getGoogleOAuth();
      if (!credentials) {
        return reply.redirect(
          "/settings/account?error=provider_not_configured"
        );
      }

      const redirectUri = `${getApiBaseUrl()}/api/auth/link/google/callback`;

      // Exchange code for token with PKCE
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          code,
          code_verifier: codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });

      const tokens = (await tokenResponse.json()) as {
        access_token?: string;
        error?: string;
      };

      if (!tokens.access_token) {
        return reply.redirect("/settings/account?error=oauth_failed");
      }

      // Get user info
      const userResponse = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }
      );
      const googleUser = (await userResponse.json()) as {
        id: string;
        email: string;
        name: string;
        picture: string;
      };

      // Link the account
      await linkOAuthProvider(userId, {
        provider: "google",
        providerId: googleUser.id,
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture,
      });

      return reply.redirect("/settings/account?success=google_linked");
    } catch (error) {
      logger.error({ error }, "Google account linking failed");
      if (error instanceof AuthError) {
        return reply.redirect(
          `/settings/account?error=${error.code.toLowerCase()}`
        );
      }
      return reply.redirect("/settings/account?error=link_failed");
    }
  });

  /**
   * DELETE /api/auth/linked-accounts/:id
   * Unlink an OAuth provider from the account
   */
  server.delete(
    "/auth/linked-accounts/:id",
    { preHandler: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.getUserId();
      const { id } = request.params as { id: string };

      if (!userId) {
        return reply.status(401).send({
          error: "UNAUTHORIZED",
          message: "Authentication required",
        });
      }

      try {
        await unlinkOAuthProvider(userId, id);

        return reply.send({
          success: true,
          message: "Provider unlinked successfully",
        });
      } catch (error) {
        return handleAuthError(error, reply);
      }
    }
  );

  /**
   * POST /api/auth/linked-accounts/:id/primary
   * Set a linked account as the primary authentication method
   */
  server.post(
    "/auth/linked-accounts/:id/primary",
    { preHandler: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.getUserId();
      const { id } = request.params as { id: string };

      if (!userId) {
        return reply.status(401).send({
          error: "UNAUTHORIZED",
          message: "Authentication required",
        });
      }

      try {
        await switchPrimaryProvider(userId, id);

        return reply.send({
          success: true,
          message: "Primary provider updated",
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
    const statusCodes: Record<string, number> = {
      INVALID_EMAIL: 400,
      WEAK_PASSWORD: 400,
      EMAIL_EXISTS: 409,
      INVALID_CREDENTIALS: 401,
      OAUTH_ONLY: 400,
      USER_NOT_FOUND: 404,
      INVALID_TOKEN: 401,
      UNAUTHORIZED: 401,
      // Account linking errors
      PROVIDER_ALREADY_LINKED: 409,
      PROVIDER_LINKED_TO_OTHER: 409,
      EMAIL_BELONGS_TO_OTHER: 409,
      CANNOT_UNLINK_PRIMARY: 400,
      CANNOT_REMOVE_LAST_AUTH: 400,
      IDENTITY_NOT_FOUND: 404,
      ACCOUNTS_NOT_FOUND: 404,
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
