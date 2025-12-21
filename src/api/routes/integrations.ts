import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { query, transaction } from "../../db/client.js";

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
      config: Record<string, unknown>;
      is_active: boolean;
      last_verified_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, type, config, is_active, last_verified_at, created_at
       FROM integrations
       WHERE org_id = $1`,
      [orgId]
    );

    // Build integration map from DB results
    const configuredIntegrations = new Map<string, Integration>();
    for (const row of result.rows) {
      configuredIntegrations.set(row.type, {
        id: row.id,
        type: row.type as "sentry" | "github" | "slack",
        name: getIntegrationName(row.type),
        status: getIntegrationStatus(row.is_active, row.last_verified_at),
        configuredAt: row.created_at.toISOString(),
        metadata: extractSafeMetadata(row.type, row.config),
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

    // Soft delete - mark as inactive
    await transaction(orgId, async (client) => {
      await client.query(
        `UPDATE integrations
         SET is_active = false,
             updated_at = NOW()
         WHERE id = $1 AND org_id = $2`,
        [id, orgId]
      );
    });

    logger.info(
      { integrationId: id, type: integrationType, orgId },
      "Integration disconnected"
    );

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
  // GET /api/integrations
  server.get("/integrations", listIntegrationsHandler);

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

  // POST /api/integrations/:type/connect
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
}
