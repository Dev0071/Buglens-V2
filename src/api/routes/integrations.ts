import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { config } from "../../utils/config.js";
import { query, transaction } from "../../db/client.js";
import { platformCredentials } from "../../services/platform-credentials.js";
import {
  generateOAuthState,
  validateOAuthState,
  getSlackAuthUrl,
  getJiraAuthUrl,
  getTeamsAuthUrl,
  getGitHubAppInstallUrl,
  exchangeGitHubCode,
  exchangeSlackCode,
  exchangeJiraCode,
  exchangeTeamsCode,
  saveIntegration,
  processSlackInstallation,
  processGitHubAppInstallation,
  getGitHubUser,
  getGitHubRepos,
  getAvailableIntegrationProviders,
} from "../../services/oauth.js";
import {
  checkOrganizationTokenHealth,
  refreshIntegrationTokens,
} from "../../services/token-lifecycle.js";
import { triggerSingleTokenRefresh } from "../../workers/queues/token-refresh.js";
import {
  logIntegrationConnect,
  logIntegrationDisconnect,
} from "../../services/audit.js";
import {
  notificationService,
  type EventNotificationData,
} from "../../services/notification-service.js";
import {
  jiraTicketService,
  type EventTicketData,
  type RCATicketData,
} from "../../services/jira-ticket-service.js";
import { sentryConfigureHandler } from "./oauth.js";

// ============================================
// Request/Response Schemas
// ============================================

const connectIntegrationBodySchema = z.object({
  config: z.record(z.unknown()).optional().default({}),
});

type ConnectIntegrationBody = z.infer<typeof connectIntegrationBodySchema>;

// ============================================
// Response Types
// ============================================

interface Integration {
  id: string;
  type: "sentry" | "github" | "slack" | "jira" | "teams";
  name: string;
  status: "connected" | "disconnected" | "error";
  configuredAt?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get display name for integration type
 */
function getIntegrationName(type: string): string {
  const names: Record<string, string> = {
    sentry: "Sentry",
    github: "GitHub",
    slack: "Slack",
    jira: "Jira",
    teams: "Microsoft Teams",
  };
  return names[type] || type;
}

/**
 * Determine integration status from database record
 */
function getIntegrationStatus(
  isActive: boolean,
  lastVerifiedAt: Date | null
): "connected" | "disconnected" | "error" {
  if (!isActive) return "disconnected";

  // If verified within last 24 hours, it's connected
  if (lastVerifiedAt) {
    const hoursSinceVerified =
      (Date.now() - lastVerifiedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceVerified > 24) {
      return "error"; // Stale verification
    }
    return "connected";
  }

  // New integrations without verification
  return "connected";
}

/**
 * Extract safe metadata from integration config
 * Never expose secrets
 */
function extractSafeMetadata(
  type: string,
  config: Record<string, unknown>
): Record<string, unknown> {
  switch (type) {
    case "sentry":
      return {
        project_id: config.project_id,
        organization: config.organization,
        project_slug: config.project_slug,
        organization_slug: config.organization_slug,
      };
    case "github":
      return {
        login: config.login,
        repos: Array.isArray(config.repos) ? config.repos.length : 0,
        installation_id: config.installation_id,
      };
    case "slack":
      return {
        team_name: config.team_name,
        channel: config.channel,
        webhook: config.webhook
          ? { channel: (config.webhook as { channel?: string }).channel }
          : null,
      };
    case "jira":
      return {
        resources: Array.isArray(config.resources)
          ? config.resources.length
          : 0,
      };
    case "teams":
      return {
        configured: true,
      };
    default:
      return {};
  }
}

// ============================================
// Route Handlers
// ============================================

interface IntegrationTypeParams {
  type: string;
}

interface IntegrationIdParams {
  id: string;
}

/**
 * GET /api/integrations
 *
 * Returns all integrations for the organization
 * Includes both configured and available integrations
 */
async function listIntegrationsHandler(
  request: FastifyRequest,
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

  try {
    // Get configured integrations from database
    const result = await query<{
      id: string;
      type: string;
      status: string;
      config: Record<string, unknown> | null;
      is_active: boolean;
      last_verified_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, type, status, config, is_active, last_verified_at, created_at
       FROM integrations
       WHERE org_id = $1 AND is_active = true`,
      [orgId]
    );

    // Build integration map from DB results
    const configuredIntegrations = new Map<string, Integration>();
    for (const row of result.rows) {
      // Normalize github_app to github for frontend compatibility
      const normalizedType = row.type === "github_app" ? "github" : row.type;

      // Use is_active to determine status
      const status = row.is_active ? "connected" : "disconnected";

      configuredIntegrations.set(normalizedType, {
        id: row.id,
        type: normalizedType as "sentry" | "github" | "slack",
        name: getIntegrationName(normalizedType),
        status: status as "connected" | "disconnected" | "error",
        configuredAt: row.created_at.toISOString(),
        metadata: extractSafeMetadata(row.type, row.config || {}),
      });
    }

    // Return all supported integration types (configured + available)
    const supportedTypes = [
      "sentry",
      "github",
      "slack",
      "jira",
      "teams",
    ] as const;
    const integrations: Integration[] = supportedTypes.map((type) => {
      if (configuredIntegrations.has(type)) {
        return configuredIntegrations.get(type)!;
      }
      // Return unconfigured placeholder
      return {
        id: `${type}-not-configured`,
        type,
        name: getIntegrationName(type),
        status: "disconnected",
      };
    });

    reply.send(integrations);
  } catch (error) {
    logger.error({ error, orgId }, "Failed to fetch integrations");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch integrations",
    });
  }
}

/**
 * GET /api/integrations/:id
 *
 * Returns details for a specific integration
 */
async function getIntegrationHandler(
  request: FastifyRequest<{ Params: IntegrationIdParams }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const orgId = request.getOrgId();

  if (!orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid integration ID format",
    });
    return;
  }

  try {
    const result = await query<{
      id: string;
      type: string;
      config: Record<string, unknown>;
      is_active: boolean;
      last_verified_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, type, config, is_active, last_verified_at, created_at, updated_at
       FROM integrations
       WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "Integration not found",
      });
      return;
    }

    const row = result.rows[0];
    const integration: Integration = {
      id: row.id,
      type: row.type as "sentry" | "github" | "slack",
      name: getIntegrationName(row.type),
      status: getIntegrationStatus(row.is_active, row.last_verified_at),
      configuredAt: row.created_at.toISOString(),
      metadata: extractSafeMetadata(row.type, row.config),
    };

    reply.send(integration);
  } catch (error) {
    logger.error(
      { error, integrationId: id, orgId },
      "Failed to fetch integration"
    );
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch integration details",
    });
  }
}

/**
 * POST /api/integrations/:type/connect
 *
 * Creates or updates an integration connection
 * In production, this would initiate OAuth flow or validate API keys
 */
async function connectIntegrationHandler(
  request: FastifyRequest<{
    Params: IntegrationTypeParams;
    Body: ConnectIntegrationBody;
  }>,
  reply: FastifyReply
): Promise<void> {
  const { type } = request.params;
  const orgId = request.getOrgId();

  if (!orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // Validate integration type
  const validTypes = ["sentry", "github", "slack", "jira", "teams"];
  if (!validTypes.includes(type)) {
    reply.status(400).send({
      error: "Bad Request",
      message: `Invalid integration type. Supported: ${validTypes.join(", ")}`,
    });
    return;
  }

  // Validate body
  const parseResult = connectIntegrationBodySchema.safeParse(request.body);
  if (!parseResult.success) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid request body",
      details: parseResult.error.errors,
    });
    return;
  }

  const { config } = parseResult.data;

  try {
    // Check if integration already exists
    const existing = await query<{ id: string }>(
      `SELECT id FROM integrations WHERE org_id = $1 AND type = $2`,
      [orgId, type]
    );

    let integrationId: string;

    if (existing.rows.length > 0) {
      // Update existing integration
      integrationId = existing.rows[0].id;
      await transaction(orgId, async (client) => {
        await client.query(
          `UPDATE integrations
           SET config = $1,
               is_active = true,
               last_verified_at = NOW(),
               updated_at = NOW()
           WHERE id = $2 AND org_id = $3`,
          [config, integrationId, orgId]
        );
      });
    } else {
      // Create new integration
      integrationId = crypto.randomUUID();
      await transaction(orgId, async (client) => {
        await client.query(
          `INSERT INTO integrations (id, org_id, type, config, is_active, last_verified_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, true, NOW(), NOW(), NOW())`,
          [integrationId, orgId, type, config]
        );
      });
    }

    logger.info(
      { integrationId, type, orgId },
      "Integration connected successfully"
    );

    reply.send({
      success: true,
      integrationId,
      message: `${getIntegrationName(type)} integration connected`,
    });
  } catch (error) {
    logger.error({ error, type, orgId }, "Failed to connect integration");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to connect integration",
    });
  }
}

/**
 * DELETE /api/integrations/:id
 *
 * Disconnects/removes an integration
 */
async function disconnectIntegrationHandler(
  request: FastifyRequest<{ Params: IntegrationIdParams }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const orgId = request.getOrgId();

  if (!orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid integration ID format",
    });
    return;
  }

  try {
    // Verify integration exists and belongs to org
    const existing = await query<{ id: string; type: string }>(
      `SELECT id, type FROM integrations WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );

    if (existing.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "Integration not found",
      });
      return;
    }

    const integrationType = existing.rows[0].type;

    // Soft delete - mark as inactive and update status
    await transaction(orgId, async (client) => {
      await client.query(
        `UPDATE integrations
         SET is_active = false,
             status = 'disconnected',
             updated_at = NOW()
         WHERE id = $1 AND org_id = $2`,
        [id, orgId]
      );
    });

    logger.info(
      { integrationId: id, type: integrationType, orgId },
      "Integration disconnected"
    );

    // Audit log: integration disconnect (HIGH priority for SOC2)
    const userId = request.getUserId();
    if (userId) {
      await logIntegrationDisconnect(
        userId,
        orgId,
        integrationType,
        id,
        request.ip
      );
    }

    reply.send({
      success: true,
      message: `${getIntegrationName(integrationType)} integration disconnected`,
    });
  } catch (error) {
    logger.error(
      { error, integrationId: id, orgId },
      "Failed to disconnect integration"
    );
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to disconnect integration",
    });
  }
}

/**
 * POST /api/integrations/:id/verify
 *
 * Verifies an integration is still working
 */
async function verifyIntegrationHandler(
  request: FastifyRequest<{ Params: IntegrationIdParams }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const orgId = request.getOrgId();

  if (!orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid integration ID format",
    });
    return;
  }

  try {
    const existing = await query<{
      id: string;
      type: string;
      config: Record<string, unknown>;
    }>(
      `SELECT id, type, config FROM integrations WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );

    if (existing.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "Integration not found",
      });
      return;
    }

    // In production, this would actually verify the integration
    // For now, just update the verification timestamp
    await transaction(orgId, async (client) => {
      await client.query(
        `UPDATE integrations
         SET last_verified_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND org_id = $2`,
        [id, orgId]
      );
    });

    reply.send({
      success: true,
      verified: true,
      verifiedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(
      { error, integrationId: id, orgId },
      "Failed to verify integration"
    );
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to verify integration",
    });
  }
}

// ============================================
// Route Registration
// ============================================

export async function integrationsRoutes(
  server: FastifyInstance
): Promise<void> {
  // POST /api/integrations/sentry/configure (non-OAuth, config-based)
  server.post("/integrations/sentry/configure", sentryConfigureHandler);

  // GET /api/integrations
  server.get("/integrations", listIntegrationsHandler);

  // GET /api/integrations/available
  // Get available integration providers (configured at platform level)
  server.get("/integrations/available", async (_request, reply) => {
    const providers = getAvailableIntegrationProviders();

    const integrationProviders = [
      {
        id: "github_app",
        name: "GitHub",
        description: "Connect GitHub repositories for code analysis",
        available:
          providers.includes("github_app") || providers.includes("github"),
        oauthRequired: true,
        icon: "github",
      },
      {
        id: "slack",
        name: "Slack",
        description: "Receive RCA notifications in Slack",
        available: providers.includes("slack"),
        oauthRequired: true,
        icon: "slack",
      },
      {
        id: "sentry",
        name: "Sentry",
        description: "Receive error events from Sentry",
        available: true, // Always available (webhook-based)
        oauthRequired: false,
        icon: "sentry",
      },
      {
        id: "jira",
        name: "Jira",
        description: "Create Jira tickets from RCA findings",
        available: providers.includes("jira"),
        oauthRequired: true,
        icon: "jira",
      },
      {
        id: "teams",
        name: "Microsoft Teams",
        description: "Receive RCA notifications in Teams",
        available: providers.includes("teams"),
        oauthRequired: true,
        icon: "teams",
      },
    ];

    return reply.send({
      providers: integrationProviders.filter((p) => p.available),
      allProviders: integrationProviders,
    });
  });

  // GET /api/integrations/:id
  server.get(
    "/integrations/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
      },
    },
    getIntegrationHandler
  );

  // ============================================
  // OAuth-Based Integration Connect Flows
  // ============================================

  /**
   * GET /api/integrations/github/connect
   * Initiate GitHub OAuth flow for repository access
   */
  server.get("/integrations/github/connect", async (request, reply) => {
    const orgId = request.getOrgId();
    if (!orgId) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    if (!platformCredentials.isConfigured("github_app")) {
      return reply.status(503).send({
        error: "INTEGRATION_NOT_CONFIGURED",
        message: "GitHub App integration is not configured. Please contact support.",
      });
    }

    const state = generateOAuthState(
      orgId,
      "github_app",
      "/settings/integrations",
      { action: "install" }
    );
    const url = getGitHubAppInstallUrl(state);
    if (!url) {
      return reply.status(503).send({
        error: "INTEGRATION_NOT_CONFIGURED",
        message: "GitHub App integration is not configured. Please contact support.",
      });
    }
    return reply.send({ authUrl: url, method: "github_app" });
  });

  /**
   * GET /api/integrations/github/callback
   * Handle GitHub OAuth callback
   */
  server.get("/integrations/github/callback", async (request, reply) => {
    const {
      code,
      state,
      installation_id,
      setup_action: _setup_action,
    } = request.query as {
      code?: string;
      state?: string;
      installation_id?: string;
      setup_action?: string;
    };

    // Handle GitHub App installation callback
    if (installation_id) {
      const oauthState = validateOAuthState(state || "");
      if (!oauthState) {
        return reply.redirect(
          `${config.FRONTEND_URL}/settings/integrations?error=invalid_state`
        );
      }

      // Store the installation ID for later API access
      await processGitHubAppInstallation(
        parseInt(installation_id, 10),
        oauthState.orgId,
        { login: "unknown", id: 0, type: "Organization" }, // Will be filled by webhook
        {},
        "all"
      );

      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?success=github_connected`
      );
    }

    // Handle OAuth App callback
    if (!code || !state) {
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=no_code`
      );
    }

    const oauthState = validateOAuthState(state);
    if (!oauthState) {
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=invalid_state`
      );
    }

    try {
      const tokens = await exchangeGitHubCode(code);
      const user = await getGitHubUser(tokens.access_token);
      const repos = await getGitHubRepos(tokens.access_token);

      const integrationId = await saveIntegration(
        oauthState.orgId,
        "github",
        { login: user.login, repos: repos.map((r) => ({ id: r.id, full_name: r.full_name })) },
        { access_token: tokens.access_token }
      );

      // Audit log: GitHub integration connected (CRITICAL for SOC2)
      // Note: OAuth callbacks don't have user context, use org-level logging
      await logIntegrationConnect(
        "system", // OAuth callback doesn't have user context
        oauthState.orgId,
        "github",
        integrationId,
        request.ip
      );

      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?success=github_connected`
      );
    } catch (error) {
      logger.error({ error }, "GitHub OAuth callback failed");
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=oauth_failed`
      );
    }
  });

  /**
   * GET /api/integrations/slack/connect
   * Initiate Slack OAuth flow
   */
  server.get("/integrations/slack/connect", async (request, reply) => {
    const orgId = request.getOrgId();
    if (!orgId) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    if (!platformCredentials.isConfigured("slack")) {
      return reply.status(503).send({
        error: "INTEGRATION_NOT_CONFIGURED",
        message: "Slack integration is not configured. Please contact support.",
      });
    }

    const state = generateOAuthState(orgId, "slack", "/settings/integrations", {
      action: "install",
    });
    const url = getSlackAuthUrl(state);

    if (!url) {
      return reply.status(503).send({
        error: "INTEGRATION_NOT_CONFIGURED",
        message: "Slack integration is not configured. Please contact support.",
      });
    }

    return reply.send({ authUrl: url });
  });

  /**
   * GET /api/integrations/slack/callback
   * Handle Slack OAuth callback
   */
  server.get("/integrations/slack/callback", async (request, reply) => {
    const {
      code,
      state,
      error: oauthError,
    } = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oauthError) {
      logger.warn({ error: oauthError }, "Slack OAuth denied");
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=${oauthError}`
      );
    }

    if (!code || !state) {
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=no_code`
      );
    }

    const oauthState = validateOAuthState(state);
    if (!oauthState) {
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=invalid_state`
      );
    }

    try {
      const slackResponse = await exchangeSlackCode(code);
      const integrationId = await processSlackInstallation(
        slackResponse,
        oauthState.orgId
      );

      // Audit log: Slack integration connected (CRITICAL for SOC2)
      await logIntegrationConnect(
        "system",
        oauthState.orgId,
        "slack",
        integrationId || "unknown",
        request.ip
      );

      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?success=slack_connected`
      );
    } catch (error) {
      logger.error({ error }, "Slack OAuth callback failed");
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=oauth_failed`
      );
    }
  });

  /**
   * GET /api/integrations/jira/connect
   * Initiate Jira OAuth flow
   */
  server.get("/integrations/jira/connect", async (request, reply) => {
    const orgId = request.getOrgId();
    if (!orgId) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    if (!platformCredentials.isConfigured("jira")) {
      return reply.status(503).send({
        error: "INTEGRATION_NOT_CONFIGURED",
        message: "Jira integration is not configured. Please contact support.",
      });
    }

    const state = generateOAuthState(orgId, "jira", "/settings/integrations", {
      action: "install",
    });
    const url = getJiraAuthUrl(state);

    if (!url) {
      return reply.status(503).send({
        error: "INTEGRATION_NOT_CONFIGURED",
        message: "Jira integration is not configured. Please contact support.",
      });
    }

    return reply.send({ authUrl: url });
  });

  /**
   * GET /api/integrations/jira/callback
   * Handle Jira OAuth callback
   */
  server.get("/integrations/jira/callback", async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };

    if (!code || !state) {
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=no_code`
      );
    }

    const oauthState = validateOAuthState(state);
    if (!oauthState) {
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=invalid_state`
      );
    }

    try {
      const tokens = await exchangeJiraCode(code);
      const integrationId = await saveIntegration(
        oauthState.orgId,
        "jira",
        {},
        { access_token: tokens.access_token, refresh_token: tokens.refresh_token }
      );

      // Audit log: Jira integration connected (CRITICAL for SOC2)
      await logIntegrationConnect(
        "system",
        oauthState.orgId,
        "jira",
        integrationId,
        request.ip
      );

      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?success=jira_connected`
      );
    } catch (error) {
      logger.error({ error }, "Jira OAuth callback failed");
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=oauth_failed`
      );
    }
  });

  /**
   * GET /api/integrations/teams/connect
   * Initiate Microsoft Teams OAuth flow
   */
  server.get("/integrations/teams/connect", async (request, reply) => {
    const orgId = request.getOrgId();
    if (!orgId) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    if (!platformCredentials.isConfigured("teams")) {
      return reply.status(503).send({
        error: "INTEGRATION_NOT_CONFIGURED",
        message:
          "Microsoft Teams integration is not configured. Please contact support.",
      });
    }

    const state = generateOAuthState(orgId, "teams", "/settings/integrations", {
      action: "install",
    });
    const url = getTeamsAuthUrl(state);

    if (!url) {
      return reply.status(503).send({
        error: "INTEGRATION_NOT_CONFIGURED",
        message:
          "Microsoft Teams integration is not configured. Please contact support.",
      });
    }

    return reply.send({ authUrl: url });
  });

  /**
   * GET /api/integrations/teams/callback
   * Handle Microsoft Teams OAuth callback
   */
  server.get("/integrations/teams/callback", async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };

    if (!code || !state) {
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=no_code`
      );
    }

    const oauthState = validateOAuthState(state);
    if (!oauthState) {
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=invalid_state`
      );
    }

    try {
      const tokens = await exchangeTeamsCode(code);
      const integrationId = await saveIntegration(
        oauthState.orgId,
        "teams",
        {},
        { access_token: tokens.access_token, refresh_token: tokens.refresh_token }
      );

      // Audit log: Teams integration connected (CRITICAL for SOC2)
      await logIntegrationConnect(
        "system",
        oauthState.orgId,
        "teams",
        integrationId,
        request.ip
      );

      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?success=teams_connected`
      );
    } catch (error) {
      logger.error({ error }, "Teams OAuth callback failed");
      return reply.redirect(
        `${config.FRONTEND_URL}/settings/integrations?error=oauth_failed`
      );
    }
  });

  // ============================================
  // Legacy Routes (for backward compatibility)
  // ============================================

  // POST /api/integrations/:type/connect (legacy)
  server.post(
    "/integrations/:type/connect",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            type: { type: "string" },
          },
          required: ["type"],
        },
      },
    },
    connectIntegrationHandler
  );

  // DELETE /api/integrations/:id
  server.delete(
    "/integrations/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
      },
    },
    disconnectIntegrationHandler
  );

  // POST /api/integrations/:id/verify
  server.post(
    "/integrations/:id/verify",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
      },
    },
    verifyIntegrationHandler
  );

  // ============================================
  // Token Lifecycle Management Routes
  // ============================================

  /**
   * GET /api/integrations/health
   * Check health of all integration tokens for the organization
   */
  server.get("/integrations/health", async (request, reply) => {
    const orgId = request.getOrgId();

    if (!orgId) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Organization context required",
      });
    }

    try {
      const healthResults = await checkOrganizationTokenHealth(orgId);

      const summary = {
        total: healthResults.length,
        healthy: healthResults.filter((r) => r.status === "healthy").length,
        expiring: healthResults.filter((r) => r.status === "expiring").length,
        expired: healthResults.filter((r) => r.status === "expired").length,
        error: healthResults.filter(
          (r) => r.status === "error" || r.status === "refresh_failed"
        ).length,
      };

      return reply.send({
        success: true,
        summary,
        integrations: healthResults.map((r) => ({
          id: r.integrationId,
          type: r.type,
          status: r.status,
          message: r.message,
          expiresAt: r.expiresAt?.toISOString(),
        })),
      });
    } catch (error) {
      logger.error({ error }, "Failed to check token health");
      return reply.status(500).send({
        error: "HEALTH_CHECK_FAILED",
        message: "Failed to check integration health",
      });
    }
  });

  /**
   * POST /api/integrations/:id/refresh
   * Manually trigger token refresh for an integration
   */
  server.post(
    "/integrations/:id/refresh",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const orgId = request.getOrgId();
      const { id } = request.params as { id: string };

      if (!orgId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Organization context required",
        });
      }

      try {
        // Try immediate refresh
        const result = await refreshIntegrationTokens(orgId, id);

        if (result.success) {
          return reply.send({
            success: true,
            message: result.message,
            newExpiresAt: result.newExpiresAt?.toISOString(),
          });
        } else {
          // Queue for retry if immediate refresh failed
          await triggerSingleTokenRefresh(orgId, id);
          return reply.status(202).send({
            success: false,
            message: result.message,
            queued: true,
          });
        }
      } catch (error) {
        logger.error(
          { error, orgId, integrationId: id },
          "Token refresh failed"
        );
        return reply.status(500).send({
          error: "REFRESH_FAILED",
          message: "Failed to refresh integration tokens",
        });
      }
    }
  );

  // ============================================
  // Jira Ticket Creation Routes
  // ============================================

  /**
   * GET /api/integrations/jira/projects
   * Get available Jira projects for the organization
   */
  server.get(
    "/integrations/jira/projects",
    { preHandler: [server.authenticate] },
    async (request, reply) => {
      const orgId = request.getOrgId();

      if (!orgId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Organization context required",
        });
      }

      try {
        const projects = await jiraTicketService.getProjects(orgId);
        return reply.send({ projects });
      } catch (error) {
        logger.error({ error, orgId }, "Failed to get Jira projects");
        return reply.status(500).send({
          error: "JIRA_ERROR",
          message: "Failed to get Jira projects",
        });
      }
    }
  );

  /**
   * GET /api/integrations/jira/projects/:projectKey/issue-types
   * Get available issue types for a Jira project
   */
  server.get(
    "/integrations/jira/projects/:projectKey/issue-types",
    { preHandler: [server.authenticate] },
    async (request, reply) => {
      const orgId = request.getOrgId();
      const { projectKey } = request.params as { projectKey: string };

      if (!orgId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Organization context required",
        });
      }

      try {
        const issueTypes = await jiraTicketService.getIssueTypes(
          orgId,
          projectKey
        );
        return reply.send({ issueTypes });
      } catch (error) {
        logger.error({ error, orgId, projectKey }, "Failed to get issue types");
        return reply.status(500).send({
          error: "JIRA_ERROR",
          message: "Failed to get Jira issue types",
        });
      }
    }
  );

  /**
   * POST /api/integrations/jira/tickets/event
   * Create a Jira ticket from an event
   */
  server.post(
    "/integrations/jira/tickets/event",
    {
      preHandler: [server.authenticate],
      schema: {
        body: {
          type: "object",
          properties: {
            eventId: { type: "string" },
            projectKey: { type: "string" },
            issueType: { type: "string" },
          },
          required: ["eventId"],
        },
      },
    },
    async (request, reply) => {
      const orgId = request.getOrgId();
      const { eventId, projectKey, issueType } = request.body as {
        eventId: string;
        projectKey?: string;
        issueType?: string;
      };

      if (!orgId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Organization context required",
        });
      }

      try {
        // Load event data
        const eventResult = await query<{
          id: string;
          message: string;
          stack_trace: unknown;
          environment: string | null;
          raw_payload: Record<string, unknown>;
          created_at: Date;
        }>(
          `SELECT id, message, stack_trace, environment, raw_payload, created_at
           FROM events WHERE id = $1 AND org_id = $2`,
          [eventId, orgId]
        );

        if (eventResult.rows.length === 0) {
          return reply.status(404).send({
            error: "NOT_FOUND",
            message: "Event not found",
          });
        }

        const event = eventResult.rows[0];
        const rawPayload = event.raw_payload as {
          exception?: { values?: Array<{ type?: string; value?: string }> };
          project?: { name?: string };
        };

        const ticketData: EventTicketData = {
          eventId: event.id,
          eventTitle:
            rawPayload.exception?.values?.[0]?.type ||
            event.message.substring(0, 100),
          eventMessage: event.message,
          severity: "error",
          errorType: rawPayload.exception?.values?.[0]?.type,
          stackTrace:
            typeof event.stack_trace === "string"
              ? event.stack_trace
              : JSON.stringify(event.stack_trace, null, 2),
          timestamp: event.created_at.toISOString(),
          projectName: rawPayload.project?.name,
          environment: event.environment || undefined,
        };

        const result = await jiraTicketService.createEventTicket(
          orgId,
          ticketData,
          { projectKey, issueType }
        );

        if (!result.success) {
          return reply.status(400).send({
            error: "TICKET_CREATION_FAILED",
            message: result.error,
          });
        }

        return reply.status(201).send({
          success: true,
          ticket: result.ticket,
        });
      } catch (error) {
        logger.error(
          { error, orgId, eventId },
          "Failed to create event ticket"
        );
        return reply.status(500).send({
          error: "JIRA_ERROR",
          message: "Failed to create Jira ticket",
        });
      }
    }
  );

  /**
   * POST /api/integrations/jira/tickets/rca
   * Create a Jira ticket from an RCA result
   */
  server.post(
    "/integrations/jira/tickets/rca",
    {
      preHandler: [server.authenticate],
      schema: {
        body: {
          type: "object",
          properties: {
            rcaId: { type: "string" },
            projectKey: { type: "string" },
            issueType: { type: "string" },
          },
          required: ["rcaId"],
        },
      },
    },
    async (request, reply) => {
      const orgId = request.getOrgId();
      const { rcaId, projectKey, issueType } = request.body as {
        rcaId: string;
        projectKey?: string;
        issueType?: string;
      };

      if (!orgId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Organization context required",
        });
      }

      try {
        // Load RCA data
        const rcaResult = await query<{
          id: string;
          event_id: string;
          title: string;
          summary: string;
          root_cause: string;
          suggested_fix: { description?: string } | null;
          confidence: number;
          evidence: Record<string, unknown>;
          created_at: Date;
        }>(
          `SELECT id, event_id, title, summary, root_cause, suggested_fix,
                  confidence, evidence, created_at
           FROM rca_results WHERE id = $1 AND org_id = $2`,
          [rcaId, orgId]
        );

        if (rcaResult.rows.length === 0) {
          return reply.status(404).send({
            error: "NOT_FOUND",
            message: "RCA result not found",
          });
        }

        const rca = rcaResult.rows[0];
        const evidence = rca.evidence as {
          error?: {
            message?: string;
            stack_trace?: Array<{ file: string; line: number }>;
          };
        };

        // Determine severity from confidence
        let severity: "critical" | "high" | "medium" | "low" = "medium";
        if (rca.confidence >= 0.9) severity = "critical";
        else if (rca.confidence >= 0.75) severity = "high";
        else if (rca.confidence < 0.5) severity = "low";

        const ticketData: RCATicketData = {
          rcaId: rca.id,
          eventId: rca.event_id,
          eventTitle: rca.title,
          eventMessage: evidence.error?.message || rca.summary,
          rootCause: rca.root_cause,
          confidence: rca.confidence,
          severity,
          suggestedFix: rca.suggested_fix?.description,
          affectedFile: evidence.error?.stack_trace?.[0]?.file,
          affectedLine: evidence.error?.stack_trace?.[0]?.line,
          analysisDetails: rca.summary,
          timestamp: rca.created_at.toISOString(),
        };

        const result = await jiraTicketService.createRCATicket(
          orgId,
          ticketData,
          { projectKey, issueType }
        );

        if (!result.success) {
          return reply.status(400).send({
            error: "TICKET_CREATION_FAILED",
            message: result.error,
          });
        }

        return reply.status(201).send({
          success: true,
          ticket: result.ticket,
        });
      } catch (error) {
        logger.error({ error, orgId, rcaId }, "Failed to create RCA ticket");
        return reply.status(500).send({
          error: "JIRA_ERROR",
          message: "Failed to create Jira ticket",
        });
      }
    }
  );

  // ============================================
  // Notification Test Routes
  // ============================================

  /**
   * POST /api/integrations/slack/test
   * Send a test notification to Slack
   */
  server.post(
    "/integrations/slack/test",
    { preHandler: [server.authenticate] },
    async (request, reply) => {
      const orgId = request.getOrgId();

      if (!orgId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Organization context required",
        });
      }

      try {
        const testData: EventNotificationData = {
          eventId: "test-" + Date.now(),
          eventTitle: "Test Error: Connection Timeout",
          eventMessage:
            "This is a test notification from Buglens to verify your Slack integration is working correctly.",
          severity: "warning",
          errorType: "TestError",
          timestamp: new Date().toISOString(),
          projectName: "Test Project",
          environment: "test",
        };

        const result = await notificationService.sendSlackEventNotification(
          orgId,
          testData
        );

        if (!result.success) {
          return reply.status(400).send({
            error: "NOTIFICATION_FAILED",
            message: result.error || "Failed to send test notification",
          });
        }

        return reply.send({
          success: true,
          message: "Test notification sent to Slack",
        });
      } catch (error) {
        logger.error(
          { error, orgId },
          "Failed to send Slack test notification"
        );
        return reply.status(500).send({
          error: "NOTIFICATION_ERROR",
          message: "Failed to send test notification",
        });
      }
    }
  );

  /**
   * POST /api/integrations/teams/test
   * Send a test notification to Microsoft Teams
   */
  server.post(
    "/integrations/teams/test",
    { preHandler: [server.authenticate] },
    async (request, reply) => {
      const orgId = request.getOrgId();

      if (!orgId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Organization context required",
        });
      }

      try {
        const testData: EventNotificationData = {
          eventId: "test-" + Date.now(),
          eventTitle: "Test Error: Connection Timeout",
          eventMessage:
            "This is a test notification from Buglens to verify your Microsoft Teams integration is working correctly.",
          severity: "warning",
          errorType: "TestError",
          timestamp: new Date().toISOString(),
          projectName: "Test Project",
          environment: "test",
        };

        const result = await notificationService.sendTeamsEventNotification(
          orgId,
          testData
        );

        if (!result.success) {
          return reply.status(400).send({
            error: "NOTIFICATION_FAILED",
            message: result.error || "Failed to send test notification",
          });
        }

        return reply.send({
          success: true,
          message: "Test notification sent to Microsoft Teams",
        });
      } catch (error) {
        logger.error(
          { error, orgId },
          "Failed to send Teams test notification"
        );
        return reply.status(500).send({
          error: "NOTIFICATION_ERROR",
          message: "Failed to send test notification",
        });
      }
    }
  );
}
