import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { query, transaction } from "../../db/client.js";

// ============================================
// Request/Response Schemas
// ============================================

const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  settings: z
    .object({
      slack_channel: z.string().max(100).optional(),
      notification_level: z
        .enum(["all", "high", "critical", "none"])
        .optional(),
      auto_analyze: z.boolean().optional(),
      daily_digest: z.boolean().optional(),
      weekly_report: z.boolean().optional(),
    })
    .optional(),
});

type UpdateOrganizationBody = z.infer<typeof updateOrganizationSchema>;

// ============================================
// Response Types
// ============================================

interface OrganizationSettings {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro" | "enterprise";
  settings: {
    slack_channel?: string;
    notification_level?: "all" | "high" | "critical" | "none";
    auto_analyze?: boolean;
    daily_digest?: boolean;
    weekly_report?: boolean;
  };
  usage: {
    eventsThisMonth: number;
    rcasThisMonth: number;
    llmTokensThisMonth: number;
  };
  limits: {
    eventsPerMonth: number;
    rcasPerMonth: number;
    llmTokensPerMonth: number;
  };
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get plan limits
 */
function getPlanLimits(plan: string): {
  eventsPerMonth: number;
  rcasPerMonth: number;
  llmTokensPerMonth: number;
} {
  switch (plan) {
    case "enterprise":
      return {
        eventsPerMonth: 100000,
        rcasPerMonth: 50000,
        llmTokensPerMonth: 50000000,
      };
    case "pro":
      return {
        eventsPerMonth: 10000,
        rcasPerMonth: 5000,
        llmTokensPerMonth: 5000000,
      };
    case "free":
    default:
      return {
        eventsPerMonth: 100,
        rcasPerMonth: 50,
        llmTokensPerMonth: 100000,
      };
  }
}

// ============================================
// Route Handlers
// ============================================

/**
 * GET /api/settings/organization
 *
 * Returns organization settings and usage information
 */
async function getOrganizationSettingsHandler(
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
    // Get organization details
    const orgResult = await query<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      settings: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, slug, plan, settings, created_at, updated_at
       FROM organizations
       WHERE id = $1`,
      [orgId]
    );

    if (orgResult.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "Organization not found",
      });
      return;
    }

    const org = orgResult.rows[0];

    // Get current month usage
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);

    // Events this month
    const eventsResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM events
       WHERE org_id = $1 AND created_at >= $2`,
      [orgId, currentMonthStart.toISOString()]
    );
    const eventsThisMonth = parseInt(eventsResult.rows[0]?.count || "0", 10);

    // RCAs this month
    const rcasResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM rca_jobs
       WHERE org_id = $1 AND created_at >= $2`,
      [orgId, currentMonthStart.toISOString()]
    );
    const rcasThisMonth = parseInt(rcasResult.rows[0]?.count || "0", 10);

    // LLM tokens this month
    const tokensResult = await query<{ sum: string | null }>(
      `SELECT COALESCE(SUM(llm_tokens_used), 0) as sum
       FROM cost_metrics
       WHERE org_id = $1 AND date >= $2`,
      [orgId, currentMonthStart.toISOString().split("T")[0]]
    );
    const llmTokensThisMonth = parseInt(tokensResult.rows[0]?.sum || "0", 10);

    const response: OrganizationSettings = {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan as "free" | "pro" | "enterprise",
      settings: {
        slack_channel: org.settings.slack_channel as string | undefined,
        notification_level: org.settings.notification_level as
          | "all"
          | "high"
          | "critical"
          | "none"
          | undefined,
        auto_analyze: org.settings.auto_analyze as boolean | undefined,
        daily_digest: org.settings.daily_digest as boolean | undefined,
        weekly_report: org.settings.weekly_report as boolean | undefined,
      },
      usage: {
        eventsThisMonth,
        rcasThisMonth,
        llmTokensThisMonth,
      },
      limits: getPlanLimits(org.plan),
      createdAt: org.created_at.toISOString(),
      updatedAt: org.updated_at.toISOString(),
    };

    reply.send(response);
  } catch (error) {
    logger.error({ error, orgId }, "Failed to fetch organization settings");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch organization settings",
    });
  }
}

/**
 * PATCH /api/settings/organization
 *
 * Updates organization settings
 */
async function updateOrganizationSettingsHandler(
  request: FastifyRequest<{ Body: UpdateOrganizationBody }>,
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

  // Validate body
  const parseResult = updateOrganizationSchema.safeParse(request.body);
  if (!parseResult.success) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid request body",
      details: parseResult.error.errors,
    });
    return;
  }

  const updates = parseResult.data;

  try {
    // Get current settings
    const currentResult = await query<{
      settings: Record<string, unknown>;
      name: string;
    }>(`SELECT settings, name FROM organizations WHERE id = $1`, [orgId]);

    if (currentResult.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "Organization not found",
      });
      return;
    }

    const current = currentResult.rows[0];

    // Merge settings
    const newSettings = {
      ...current.settings,
      ...(updates.settings || {}),
    };

    const newName = updates.name || current.name;

    // Update organization
    await transaction(orgId, async (client) => {
      await client.query(
        `UPDATE organizations
         SET name = $1,
             settings = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [newName, newSettings, orgId]
      );
    });

    logger.info({ orgId, updates }, "Organization settings updated");

    reply.send({
      success: true,
      message: "Settings updated successfully",
    });
  } catch (error) {
    logger.error({ error, orgId }, "Failed to update organization settings");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to update organization settings",
    });
  }
}

// ============================================
// Route Registration
// ============================================

export async function settingsRoutes(server: FastifyInstance): Promise<void> {
  // GET /api/settings/organization
  server.get("/settings/organization", getOrganizationSettingsHandler);

  // PATCH /api/settings/organization
  server.patch(
    "/settings/organization",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            settings: {
              type: "object",
              properties: {
                slack_channel: { type: "string" },
                notification_level: {
                  type: "string",
                  enum: ["all", "high", "critical", "none"],
                },
                auto_analyze: { type: "boolean" },
                daily_digest: { type: "boolean" },
                weekly_report: { type: "boolean" },
              },
            },
          },
        },
      },
    },
    updateOrganizationSettingsHandler
  );
}
