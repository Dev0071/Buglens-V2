/**
 * OAuth Routes
 *
 * Handles OAuth authorization flows for all integrations:
 * - GitHub: OAuth App flow for repository access
 * - Slack: OAuth 2.0 for workspace integration
 * - Jira: OAuth 2.0 for issue tracking
 * - Teams: Microsoft OAuth 2.0 for notifications
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { logger } from "../../utils/logger.js";
import { config } from "../../utils/config.js";
import { query } from "../../db/client.js";
import {
  generateOAuthState,
  validateOAuthState,
  getGitHubAuthUrl,
  exchangeGitHubCode,
  getGitHubUser,
  getGitHubRepos,
  getSlackAuthUrl,
  exchangeSlackCode,
  getSlackChannels,
  sendSlackTestMessage,
  getTeamsAuthUrl,
  exchangeTeamsCode,
  getJiraAuthUrl,
  exchangeJiraCode,
  getJiraResources,
  saveIntegration,
} from "../../services/oauth.js";

// ============================================
// Types
// ============================================

interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get orgId from session cookie when Authorization header is not available
 * This is needed for OAuth redirects where browser can't send the header
 */
async function getOrgIdFromSession(
  request: FastifyRequest
): Promise<string | null> {
  // First try the standard way
  const orgId = request.getOrgId?.();
  if (orgId) {
    return orgId;
  }

  // Try to get from refresh token cookie
  const refreshToken = request.cookies?.refreshToken;
  if (!refreshToken) {
    return null;
  }

  try {
    const result = await query<{ org_id: string }>(
      `SELECT u.org_id
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.refresh_token = $1 AND s.expires_at > NOW()`,
      [refreshToken]
    );
    return result.rows[0]?.org_id || null;
  } catch (error) {
    logger.error({ error }, "Failed to get orgId from session");
    return null;
  }
}

// ============================================
// GitHub OAuth Routes
// ============================================

/**
 * GET /api/integrations/github/connect
 *
 * Initiates GitHub OAuth flow
 */
async function githubConnectHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const orgId = await getOrgIdFromSession(request);

  if (!orgId) {
    reply.redirect("/login?error=auth_required");
    return;
  }

  if (!config.GITHUB_APP_ID) {
    logger.error("GitHub OAuth not configured - missing GITHUB_APP_ID");
    reply.redirect("/settings/integrations?error=github_not_configured");
    return;
  }

  const state = generateOAuthState(orgId, "github", "/settings/integrations");
  const authUrl = getGitHubAuthUrl(state);

  if (!authUrl) {
    logger.error("Failed to generate GitHub auth URL");
    reply.redirect("/settings/integrations?error=github_config_error");
    return;
  }

  logger.info({ orgId }, "Initiating GitHub OAuth flow");
  reply.redirect(authUrl);
}

/**
 * GET /api/integrations/github/callback
 *
 * Handles GitHub OAuth callback
 */
async function githubCallbackHandler(
  request: FastifyRequest<{ Querystring: OAuthCallbackQuery }>,
  reply: FastifyReply
): Promise<void> {
  const { code, state, error, error_description } = request.query;

  // Handle OAuth errors
  if (error) {
    logger.error({ error, error_description }, "GitHub OAuth error");
    reply.redirect(`/settings/integrations?error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code || !state) {
    reply.redirect("/settings/integrations?error=missing_params");
    return;
  }

  // Validate state
  const oauthState = validateOAuthState(state);
  if (!oauthState) {
    logger.error("Invalid or expired OAuth state");
    reply.redirect("/settings/integrations?error=invalid_state");
    return;
  }

  try {
    // Exchange code for token
    const tokenData = await exchangeGitHubCode(code);

    // Get user info
    const user = await getGitHubUser(tokenData.access_token);

    // Get user repositories
    const repos = await getGitHubRepos(tokenData.access_token);

    // Save integration
    await saveIntegration(oauthState.orgId, "github", {
      access_token: tokenData.access_token,
      token_type: tokenData.token_type,
      scope: tokenData.scope,
      user_id: user.id,
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
      repos: repos.map((r) => ({
        id: r.id,
        full_name: r.full_name,
        private: r.private,
      })),
    });

    logger.info(
      { orgId: oauthState.orgId, login: user.login, repoCount: repos.length },
      "GitHub integration connected"
    );

    reply.redirect("/settings/integrations?success=github_connected");
  } catch (err) {
    logger.error({ error: err }, "Failed to complete GitHub OAuth");
    reply.redirect("/settings/integrations?error=github_failed");
  }
}

// ============================================
// Slack OAuth Routes
// ============================================

/**
 * GET /api/integrations/slack/connect
 *
 * Initiates Slack OAuth flow
 */
async function slackConnectHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const orgId = await getOrgIdFromSession(request);

  if (!orgId) {
    reply.redirect("/login?error=auth_required");
    return;
  }

  if (!config.SLACK_CLIENT_ID) {
    logger.error("Slack OAuth not configured - missing SLACK_CLIENT_ID");
    reply.redirect("/settings/integrations?error=slack_not_configured");
    return;
  }

  const state = generateOAuthState(orgId, "slack", "/settings/integrations");
  const authUrl = getSlackAuthUrl(state);

  if (!authUrl) {
    logger.error("Failed to generate Slack auth URL");
    reply.redirect("/settings/integrations?error=slack_config_error");
    return;
  }

  logger.info({ orgId }, "Initiating Slack OAuth flow");
  reply.redirect(authUrl);
}

/**
 * GET /api/integrations/slack/callback
 *
 * Handles Slack OAuth callback
 */
async function slackCallbackHandler(
  request: FastifyRequest<{ Querystring: OAuthCallbackQuery }>,
  reply: FastifyReply
): Promise<void> {
  const { code, state, error, error_description } = request.query;

  if (error) {
    logger.error({ error, error_description }, "Slack OAuth error");
    reply.redirect(`/settings/integrations?error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code || !state) {
    reply.redirect("/settings/integrations?error=missing_params");
    return;
  }

  const oauthState = validateOAuthState(state);
  if (!oauthState) {
    logger.error("Invalid or expired OAuth state");
    reply.redirect("/settings/integrations?error=invalid_state");
    return;
  }

  try {
    // Exchange code for token
    const authData = await exchangeSlackCode(code);

    // Get available channels
    const channels = await getSlackChannels(authData.access_token);

    // Send test message if webhook channel is available
    if (authData.incoming_webhook) {
      await sendSlackTestMessage(
        authData.access_token,
        authData.incoming_webhook.channel_id
      );
    }

    // Save integration
    await saveIntegration(oauthState.orgId, "slack", {
      access_token: authData.access_token,
      token_type: authData.token_type,
      scope: authData.scope,
      bot_user_id: authData.bot_user_id,
      team_id: authData.team.id,
      team_name: authData.team.name,
      webhook: authData.incoming_webhook,
      channels: channels.slice(0, 50).map((c) => ({
        id: c.id,
        name: c.name,
        is_private: c.is_private,
      })),
    });

    logger.info(
      { orgId: oauthState.orgId, teamName: authData.team.name },
      "Slack integration connected"
    );

    reply.redirect("/settings/integrations?success=slack_connected");
  } catch (err) {
    logger.error({ error: err }, "Failed to complete Slack OAuth");
    reply.redirect("/settings/integrations?error=slack_failed");
  }
}

// ============================================
// Jira OAuth Routes
// ============================================

/**
 * GET /api/integrations/jira/connect
 *
 * Initiates Jira OAuth flow
 */
async function jiraConnectHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const orgId = await getOrgIdFromSession(request);

  if (!orgId) {
    reply.redirect("/login?error=auth_required");
    return;
  }

  if (!config.JIRA_CLIENT_ID) {
    logger.error("Jira OAuth not configured - missing JIRA_CLIENT_ID");
    reply.redirect("/settings/integrations?error=jira_not_configured");
    return;
  }

  const state = generateOAuthState(orgId, "jira", "/settings/integrations");
  const authUrl = getJiraAuthUrl(state);

  if (!authUrl) {
    logger.error("Failed to generate Jira auth URL");
    reply.redirect("/settings/integrations?error=jira_config_error");
    return;
  }

  logger.info({ orgId }, "Initiating Jira OAuth flow");
  reply.redirect(authUrl);
}

/**
 * GET /api/integrations/jira/callback
 *
 * Handles Jira OAuth callback
 */
async function jiraCallbackHandler(
  request: FastifyRequest<{ Querystring: OAuthCallbackQuery }>,
  reply: FastifyReply
): Promise<void> {
  const { code, state, error, error_description } = request.query;

  if (error) {
    logger.error({ error, error_description }, "Jira OAuth error");
    reply.redirect(`/settings/integrations?error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code || !state) {
    reply.redirect("/settings/integrations?error=missing_params");
    return;
  }

  const oauthState = validateOAuthState(state);
  if (!oauthState) {
    logger.error("Invalid or expired OAuth state");
    reply.redirect("/settings/integrations?error=invalid_state");
    return;
  }

  try {
    // Exchange code for token
    const tokenData = await exchangeJiraCode(code);

    // Get accessible resources
    const resources = await getJiraResources(tokenData.access_token);

    // Save integration
    await saveIntegration(oauthState.orgId, "jira", {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
      resources: resources.map((r) => ({
        id: r.id,
        name: r.name,
        url: r.url,
      })),
    });

    logger.info(
      { orgId: oauthState.orgId, resourceCount: resources.length },
      "Jira integration connected"
    );

    reply.redirect("/settings/integrations?success=jira_connected");
  } catch (err) {
    logger.error({ error: err }, "Failed to complete Jira OAuth");
    reply.redirect("/settings/integrations?error=jira_failed");
  }
}

// ============================================
// Teams OAuth Routes
// ============================================

/**
 * GET /api/integrations/teams/connect
 *
 * Initiates Microsoft Teams OAuth flow
 */
async function teamsConnectHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const orgId = await getOrgIdFromSession(request);

  if (!orgId) {
    reply.redirect("/login?error=auth_required");
    return;
  }

  if (!config.TEAMS_CLIENT_ID) {
    logger.error("Teams OAuth not configured - missing TEAMS_CLIENT_ID");
    reply.redirect("/settings/integrations?error=teams_not_configured");
    return;
  }

  const state = generateOAuthState(orgId, "teams", "/settings/integrations");
  const authUrl = getTeamsAuthUrl(state);

  if (!authUrl) {
    logger.error("Failed to generate Teams auth URL");
    reply.redirect("/settings/integrations?error=teams_config_error");
    return;
  }

  logger.info({ orgId }, "Initiating Teams OAuth flow");
  reply.redirect(authUrl);
}

/**
 * GET /api/integrations/teams/callback
 *
 * Handles Microsoft Teams OAuth callback
 */
async function teamsCallbackHandler(
  request: FastifyRequest<{ Querystring: OAuthCallbackQuery }>,
  reply: FastifyReply
): Promise<void> {
  const { code, state, error, error_description } = request.query;

  if (error) {
    logger.error({ error, error_description }, "Teams OAuth error");
    reply.redirect(`/settings/integrations?error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code || !state) {
    reply.redirect("/settings/integrations?error=missing_params");
    return;
  }

  const oauthState = validateOAuthState(state);
  if (!oauthState) {
    logger.error("Invalid or expired OAuth state");
    reply.redirect("/settings/integrations?error=invalid_state");
    return;
  }

  try {
    // Exchange code for token
    const tokenData = await exchangeTeamsCode(code);

    // Save integration
    await saveIntegration(oauthState.orgId, "teams", {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
    });

    logger.info({ orgId: oauthState.orgId }, "Teams integration connected");

    reply.redirect("/settings/integrations?success=teams_connected");
  } catch (err) {
    logger.error({ error: err }, "Failed to complete Teams OAuth");
    reply.redirect("/settings/integrations?error=teams_failed");
  }
}

// ============================================
// Sentry Configuration (Non-OAuth)
// ============================================

interface SentryConfigBody {
  dsn?: string;
  projectSlug: string;
  organizationSlug: string;
}

/**
 * POST /api/integrations/sentry/configure
 *
 * Configure Sentry integration with DSN/project details
 */
async function sentryConfigureHandler(
  request: FastifyRequest<{ Body: SentryConfigBody }>,
  reply: FastifyReply
): Promise<void> {
  const orgId = request.getOrgId();

  if (!orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  const { dsn, projectSlug, organizationSlug } = request.body;

  if (!projectSlug || !organizationSlug) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Project slug and organization slug are required",
    });
    return;
  }

  try {
    // Generate webhook URL and secret for this org
    const webhookSecret = crypto.randomUUID();
    const webhookUrl = `${getBaseUrl()}/api/v1/webhooks/sentry/${orgId}`;

    await saveIntegration(orgId, "sentry", {
      dsn,
      project_slug: projectSlug,
      organization_slug: organizationSlug,
      webhook_secret: webhookSecret,
      webhook_url: webhookUrl,
    });

    logger.info(
      { orgId, projectSlug, organizationSlug },
      "Sentry integration configured"
    );

    reply.send({
      success: true,
      webhookUrl,
      webhookSecret,
      message: "Configure this webhook URL in your Sentry project settings",
    });
  } catch (err) {
    logger.error({ error: err }, "Failed to configure Sentry");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to configure Sentry integration",
    });
  }
}

// ============================================
// Route Registration
// ============================================

import crypto from "crypto";

function getBaseUrl(): string {
  if (config.NODE_ENV === "production") {
    return process.env.BASE_URL || "https://api.buglens.com";
  }
  return `http://localhost:${config.PORT}`;
}

export async function oauthRoutes(server: FastifyInstance): Promise<void> {
  // GitHub OAuth
  server.get("/integrations/github/connect", githubConnectHandler);
  server.get("/integrations/github/callback", githubCallbackHandler);

  // Slack OAuth
  server.get("/integrations/slack/connect", slackConnectHandler);
  server.get("/integrations/slack/callback", slackCallbackHandler);

  // Jira OAuth
  server.get("/integrations/jira/connect", jiraConnectHandler);
  server.get("/integrations/jira/callback", jiraCallbackHandler);

  // Teams OAuth
  server.get("/integrations/teams/connect", teamsConnectHandler);
  server.get("/integrations/teams/callback", teamsCallbackHandler);

  // Sentry Configuration (non-OAuth)
  server.post("/integrations/sentry/configure", sentryConfigureHandler);

  logger.info("OAuth routes registered");
}
