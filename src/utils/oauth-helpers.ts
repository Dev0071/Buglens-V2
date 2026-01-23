/**
 * OAuth Helpers
 *
 * Shared utilities for OAuth callback handlers.
 * Reduces duplication across 4 similar OAuth callback implementations.
 *
 * Common pattern across GitHub, Slack, Jira, Teams callbacks:
 * 1. Check for OAuth error in query params
 * 2. Validate code and state params exist
 * 3. Validate state token (CSRF protection)
 * 4. Exchange code for tokens
 * 5. Save integration data
 * 6. Redirect with success/error
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { logger } from "../utils/logger.js";
import { validateOAuthState, type OAuthState } from "../services/oauth.js";
import {
  redirectWithError,
  redirectWithSuccess,
} from "../utils/response-helpers.js";

// ============================================
// Types
// ============================================

export interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

export interface OAuthCallbackContext {
  code: string;
  state: OAuthState;
  reply: FastifyReply;
}

export type OAuthProvider = "github" | "slack" | "jira" | "teams";

export interface OAuthCallbackOptions {
  /** OAuth provider name for logging */
  provider: OAuthProvider;
  /** Path to redirect on success/error (default: /settings/integrations) */
  redirectPath?: string;
}

// ============================================
// Validation Helpers
// ============================================

/**
 * Validate OAuth callback query parameters.
 *
 * Handles the common validation pattern:
 * 1. Check for OAuth error from provider
 * 2. Validate code and state exist
 * 3. Validate and consume state token
 *
 * @param request - Fastify request with OAuth query params
 * @param reply - Fastify reply for redirects
 * @param options - Provider-specific options
 * @returns OAuthCallbackContext if valid, null if validation failed (redirect sent)
 */
export function validateOAuthCallback(
  request: FastifyRequest<{ Querystring: OAuthCallbackQuery }>,
  reply: FastifyReply,
  options: OAuthCallbackOptions
): OAuthCallbackContext | null {
  const { provider, redirectPath = "/settings/integrations" } = options;
  const { code, state, error, error_description } = request.query;

  // 1. Handle OAuth errors from provider
  if (error) {
    logger.error({ error, error_description }, `${provider} OAuth error`);
    redirectWithError(reply, redirectPath, error);
    return null;
  }

  // 2. Validate required params
  if (!code || !state) {
    logger.warn(
      { code: !!code, state: !!state },
      `${provider} OAuth missing params`
    );
    redirectWithError(reply, redirectPath, "missing_params");
    return null;
  }

  // 3. Validate and consume state token (CSRF protection)
  const oauthState = validateOAuthState(state);
  if (!oauthState) {
    logger.error({ provider }, "Invalid or expired OAuth state");
    redirectWithError(reply, redirectPath, "invalid_state");
    return null;
  }

  return {
    code,
    state: oauthState,
    reply,
  };
}

/**
 * Handle successful OAuth completion
 */
export function handleOAuthSuccess(
  reply: FastifyReply,
  provider: OAuthProvider,
  orgId: string,
  metadata?: Record<string, unknown>,
  redirectPath = "/settings/integrations"
): void {
  logger.info(
    { orgId, provider, ...metadata },
    `${provider} integration connected`
  );
  redirectWithSuccess(reply, redirectPath, `${provider}_connected`);
}

/**
 * Handle OAuth failure
 */
export function handleOAuthError(
  reply: FastifyReply,
  provider: OAuthProvider,
  error: unknown,
  redirectPath = "/settings/integrations"
): void {
  logger.error({ error }, `Failed to complete ${provider} OAuth`);
  redirectWithError(reply, redirectPath, `${provider}_failed`);
}

/**
 * Wrap async OAuth callback logic with consistent error handling
 *
 * @example
 * async function githubCallbackHandler(request, reply) {
 *   const ctx = validateOAuthCallback(request, reply, { provider: 'github' });
 *   if (!ctx) return;
 *
 *   await withOAuthErrorHandling(reply, 'github', async () => {
 *     const tokens = await exchangeGitHubCode(ctx.code);
 *     await saveIntegration(ctx.state.orgId, 'github', { ... });
 *   });
 * }
 */
export async function withOAuthErrorHandling(
  reply: FastifyReply,
  provider: OAuthProvider,
  fn: () => Promise<void>,
  redirectPath = "/settings/integrations"
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    handleOAuthError(reply, provider, error, redirectPath);
  }
}

// ============================================
// Connect Handler Helpers
// ============================================

export interface ConnectHandlerOptions {
  provider: OAuthProvider;
  /** Config key to check (e.g., GITHUB_APP_ID, SLACK_CLIENT_ID) */
  configKey: string;
  /** Function to generate OAuth auth URL */
  getAuthUrl: (stateId: string) => string | null;
  /** State generator function */
  generateState: (orgId: string) => string;
}

/**
 * Validate connect handler prerequisites
 *
 * @returns orgId if valid, null if validation failed (redirect sent)
 */
export function validateConnectRequest(
  orgId: string | null,
  reply: FastifyReply,
  provider: OAuthProvider,
  isConfigured: boolean,
  redirectPath = "/settings/integrations"
): string | null {
  if (!orgId) {
    redirectWithError(reply, "/login", "auth_required");
    return null;
  }

  if (!isConfigured) {
    logger.error(`${provider} OAuth not configured`);
    redirectWithError(reply, redirectPath, `${provider}_not_configured`);
    return null;
  }

  return orgId;
}
