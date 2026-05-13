import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { query, transaction } from "../../db/client.js";
import {
  logSettingsUpdate,
  logOrgDelete,
  logPlanChange,
} from "../../services/audit.js";
import { createAdminAuthHook } from "../middleware/admin-auth.js";

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
 * Get plan limits (daily)
 */
function getDailyPlanLimits(plan: string): {
  eventsPerDay: number;
  llmTokensPerDay: number;
  usersAllowed: number;
} {
  switch (plan) {
    case "enterprise":
      return {
        eventsPerDay: 100000,
        llmTokensPerDay: 10000000,
        usersAllowed: 1000,
      };
    case "pro":
      return {
        eventsPerDay: 1000,
        llmTokensPerDay: 500000,
        usersAllowed: 10,
      };
    case "free":
    default:
      return {
        eventsPerDay: 100,
        llmTokensPerDay: 50000,
        usersAllowed: 3,
      };
  }
}

/**
 * Get plan limits (monthly)
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

    // Get userId for audit logging
    const userId = request.getUserId();

    // Audit log: settings update (HIGH priority for SOC2)
    if (userId) {
      await logSettingsUpdate(
        userId,
        orgId,
        "organization_settings",
        { name: newName, settings: updates.settings },
        request.ip
      );
    }

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

/**
 * DELETE /api/settings/organization
 *
 * Deletes the organization and all associated data
 */
async function deleteOrganizationHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const orgId = request.getOrgId();
  const userId = request.getUserId();

  if (!orgId || !userId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  try {
    // Verify user is org owner
    const userResult = await query<{ role: string }>(
      `SELECT role FROM users WHERE id = $1 AND org_id = $2`,
      [userId, orgId]
    );

    if (userResult.rows.length === 0 || userResult.rows[0].role !== "owner") {
      reply.status(403).send({
        error: "Forbidden",
        message: "Only organization owners can delete the organization",
      });
      return;
    }

    // Get org name for audit log
    const orgResult = await query<{ name: string }>(
      `SELECT name FROM organizations WHERE id = $1`,
      [orgId]
    );
    const orgName = orgResult.rows[0]?.name || "unknown";

    // Soft delete organization (set deleted_at timestamp)
    await transaction(orgId, async (client) => {
      await client.query(
        `UPDATE organizations
         SET deleted_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL`,
        [orgId]
      );

      // Log the deletion
      logger.info({ orgId, userId }, "Organization deleted");
    });

    // Audit log: organization deletion (CRITICAL for SOC2)
    await logOrgDelete(userId, orgId, orgName, request.ip);

    reply.send({
      success: true,
      message: "Organization deleted successfully",
    });
  } catch (error) {
    logger.error({ error, orgId }, "Failed to delete organization");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to delete organization",
    });
  }
}

/**
 * GET /api/settings/billing/usage
 *
 * Returns billing usage and plan information
 */
async function getBillingUsageHandler(
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
    // Get organization plan
    const orgResult = await query<{ plan: string }>(
      `SELECT plan FROM organizations WHERE id = $1`,
      [orgId]
    );

    if (orgResult.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "Organization not found",
      });
      return;
    }

    const plan = orgResult.rows[0].plan;
    const limits = getDailyPlanLimits(plan);

    // Get current day usage
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const eventsToday = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM events
       WHERE org_id = $1 AND created_at >= $2`,
      [orgId, todayStart.toISOString()]
    );

    const tokensToday = await query<{ sum: string | null }>(
      `SELECT COALESCE(SUM(llm_tokens_used), 0) as sum
       FROM cost_metrics
       WHERE org_id = $1 AND date = $2`,
      [orgId, todayStart.toISOString().split("T")[0]]
    );

    const teamMembers = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM users WHERE org_id = $1`,
      [orgId]
    );

    reply.send({
      plan,
      limits,
      usage: {
        eventsToday: parseInt(eventsToday.rows[0]?.count || "0", 10),
        llmTokensToday: parseInt(tokensToday.rows[0]?.sum || "0", 10),
        teamMembers: parseInt(teamMembers.rows[0]?.count || "0", 10),
      },
    });
  } catch (error) {
    logger.error({ error, orgId }, "Failed to fetch billing usage");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch billing usage",
    });
  }
}

/**
 * POST /api/settings/billing/upgrade
 *
 * Upgrades organization plan
 */
async function upgradePlanHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const orgId = request.getOrgId();
  const userId = request.getUserId();
  const { plan } = request.body as { plan: string };

  if (!orgId || !userId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // Validate plan
  if (!["free", "pro", "enterprise"].includes(plan)) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid plan. Must be free, pro, or enterprise",
    });
    return;
  }

  try {
    // Verify user is org owner/admin
    const userResult = await query<{ role: string }>(
      `SELECT role FROM users WHERE id = $1 AND org_id = $2`,
      [userId, orgId]
    );

    if (
      userResult.rows.length === 0 ||
      !["owner", "admin"].includes(userResult.rows[0].role)
    ) {
      reply.status(403).send({
        error: "Forbidden",
        message: "Only organization owners/admins can upgrade the plan",
      });
      return;
    }

    // Get current plan for audit log
    const currentPlanResult = await query<{ plan: string }>(
      `SELECT plan FROM organizations WHERE id = $1`,
      [orgId]
    );
    const oldPlan = currentPlanResult.rows[0]?.plan || "free";

    // Update plan
    await transaction(orgId, async (client) => {
      await client.query(
        `UPDATE organizations
         SET plan = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [plan, orgId]
      );

      logger.info({ orgId, userId, plan }, "Organization plan upgraded");
    });

    // Audit log: plan change (HIGH priority for SOC2)
    await logPlanChange(userId, orgId, oldPlan, plan, request.ip);

    reply.send({
      success: true,
      message: `Plan upgraded to ${plan} successfully`,
      plan,
    });
  } catch (error) {
    logger.error({ error, orgId }, "Failed to upgrade plan");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to upgrade plan",
    });
  }
}

// ============================================
// Onboarding Status
// ============================================

/**
 * GET /api/settings/onboarding/status
 *
 * Returns per-step setup completion for the org.
 * Used by the onboarding page, SDK setup tab, and dashboard banner.
 *
 * Steps in order:
 *   1. github      — at least one active repo synced via GitHub App
 *   2. sentry      — Sentry integration connected
 *   3. deploy      — at least one deployment tracked (any source)
 *   4. first_event — at least one Sentry error received
 */
async function getOnboardingStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const orgId = request.getOrgId();
  if (!orgId) return reply.status(401).send({ error: "Unauthorized" });

  try {
    const result = await query<{
      repos_count: string;
      sentry_connected: boolean;
      deployments_count: string;
      events_count: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM repos      WHERE org_id = $1 AND is_active = true) AS repos_count,
         EXISTS(
           SELECT 1 FROM integrations
           WHERE org_id = $1 AND type IN ('sentry', 'sentry_app') AND status = 'connected'
         ) AS sentry_connected,
         (SELECT COUNT(*) FROM deployments WHERE org_id = $1) AS deployments_count,
         (SELECT COUNT(*) FROM events     WHERE org_id = $1) AS events_count`,
      [orgId]
    );

    const row = result.rows[0];
    const reposCount      = parseInt(row.repos_count,      10);
    const deploymentsCount = parseInt(row.deployments_count, 10);
    const eventsCount     = parseInt(row.events_count,     10);

    const steps = {
      github: {
        complete: reposCount > 0,
        repos_count: reposCount,
        label: "Connect GitHub",
        description: "Install the Buglens GitHub App to enable code fetching and deploy tracking.",
        action_url: "/settings/integrations",
      },
      sentry: {
        complete: row.sentry_connected,
        label: "Connect Sentry",
        description: "Configure Sentry to send error events to Buglens via webhook.",
        action_url: "/settings/integrations",
      },
      deploy: {
        complete: deploymentsCount > 0,
        deployments_count: deploymentsCount,
        label: "Set up deploy tracking",
        description: "Add one line to your CI/CD pipeline so Buglens knows which commit is running in production.",
        action_url: "/settings/sdk",
      },
      first_event: {
        complete: eventsCount > 0,
        events_count: eventsCount,
        label: "Receive your first error",
        description: "Trigger a test error in your app to verify the Sentry webhook is working.",
        action_url: "/events",
      },
    };

    const completedCount = Object.values(steps).filter((s) => s.complete).length;
    const totalCount = Object.keys(steps).length;
    const completionPct = Math.round((completedCount / totalCount) * 100);

    // RCA requires GitHub (for code) + Sentry (for events)
    const isReadyForRca = steps.github.complete && steps.sentry.complete;

    const nextStep = !steps.github.complete
      ? "github"
      : !steps.sentry.complete
        ? "sentry"
        : !steps.deploy.complete
          ? "deploy"
          : !steps.first_event.complete
            ? "first_event"
            : "complete";

    return reply.send({
      steps,
      completion_pct: completionPct,
      is_ready_for_rca: isReadyForRca,
      next_step: nextStep,
    });
  } catch (error) {
    logger.error({ error, orgId }, "Failed to fetch onboarding status");
    return reply.status(500).send({ error: "Failed to fetch onboarding status" });
  }
}

// ============================================
// Route Registration
// ============================================

export async function settingsRoutes(server: FastifyInstance): Promise<void> {
  // GET /api/settings/onboarding/status
  server.get("/settings/onboarding/status", getOnboardingStatusHandler);

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

  // DELETE /api/settings/organization
  server.delete("/settings/organization", deleteOrganizationHandler);

  // GET /api/settings/billing/usage
  server.get("/settings/billing/usage", getBillingUsageHandler);

  // POST /api/settings/billing/upgrade — platform admin only (no self-promotion without payment)
  server.post(
    "/settings/billing/upgrade",
    {
      preHandler: createAdminAuthHook("billing plan upgrade"),
      schema: {
        body: {
          type: "object",
          required: ["plan"],
          properties: {
            plan: {
              type: "string",
              enum: ["free", "pro", "enterprise"],
            },
          },
        },
      },
    },
    upgradePlanHandler
  );
}
