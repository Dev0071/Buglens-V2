/**
 * Admin Routes for Organization Management
 *
 * Provides endpoints for:
 * - Listing all organizations with metrics
 * - Getting organization details
 * - Suspending/unsuspending organizations
 *
 * @security Requires admin role + platform-admin-token validation
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { query } from "../../../db/client.js";
import { logger } from "../../../utils/logger.js";
import { createAdminAuthHook } from "../../middleware/admin-auth.js";

// ============================================
// Types
// ============================================

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  suspended_at: Date | null;
  suspended_reason: string | null;
}

interface OrganizationWithMetrics extends OrganizationRow {
  user_count: number;
  event_count: number;
  rca_count: number;
  integration_count: number;
  total_cost_usd: number;
}

interface ListOrganizationsQuery {
  search?: string;
  plan?: "free" | "pro" | "enterprise";
  status?: "active" | "suspended";
  page?: number;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
}

interface SuspendOrganizationBody {
  reason: string;
}

// ============================================
// Route Registration
// ============================================

export async function adminOrganizationRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // Apply admin authentication to all routes
  fastify.addHook("preHandler", createAdminAuthHook("organization management"));

  /**
   * GET /api/admin/organizations
   * List all organizations with metrics
   */
  fastify.get<{ Querystring: ListOrganizationsQuery }>(
    "/",
    async (request, reply) => {
      try {
        const {
          search,
          plan,
          status,
          page = 1,
          limit = 20,
          sort = "created_at",
          order = "desc",
        } = request.query;

        const offset = (page - 1) * limit;
        const conditions: string[] = ["1=1"];
        const params: unknown[] = [];
        let paramIndex = 1;

        // Search filter
        if (search) {
          conditions.push(
            `(o.name ILIKE $${paramIndex} OR o.slug ILIKE $${paramIndex})`
          );
          params.push(`%${search}%`);
          paramIndex++;
        }

        // Plan filter
        if (plan) {
          conditions.push(`o.plan = $${paramIndex}`);
          params.push(plan);
          paramIndex++;
        }

        // Status filter
        if (status === "suspended") {
          conditions.push("o.suspended_at IS NOT NULL");
        } else if (status === "active") {
          conditions.push("o.suspended_at IS NULL");
        }

        // Validate sort column to prevent SQL injection
        const allowedSortColumns = [
          "created_at",
          "name",
          "plan",
          "user_count",
          "event_count",
        ];
        const sortColumn = allowedSortColumns.includes(sort)
          ? sort
          : "created_at";
        const sortOrder = order === "asc" ? "ASC" : "DESC";

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as total
          FROM organizations o
          WHERE ${conditions.join(" AND ")}
        `;
        const countResult = await query<{ total: string }>(countQuery, params);
        const total = parseInt(countResult.rows[0].total, 10);

        // Get organizations with metrics
        const orgsQuery = `
          SELECT
            o.*,
            COALESCE(u.user_count, 0)::int as user_count,
            COALESCE(e.event_count, 0)::int as event_count,
            COALESCE(r.rca_count, 0)::int as rca_count,
            COALESCE(i.integration_count, 0)::int as integration_count,
            COALESCE(c.total_cost_usd, 0)::numeric as total_cost_usd
          FROM organizations o
          LEFT JOIN (
            SELECT org_id, COUNT(*) as user_count
            FROM users
            GROUP BY org_id
          ) u ON u.org_id = o.id
          LEFT JOIN (
            SELECT org_id, COUNT(*) as event_count
            FROM events
            GROUP BY org_id
          ) e ON e.org_id = o.id
          LEFT JOIN (
            SELECT org_id, COUNT(*) as rca_count
            FROM rca_results
            GROUP BY org_id
          ) r ON r.org_id = o.id
          LEFT JOIN (
            SELECT org_id, COUNT(*) as integration_count
            FROM integrations
            GROUP BY org_id
          ) i ON i.org_id = o.id
          LEFT JOIN (
            SELECT org_id, SUM(llm_cost_usd) as total_cost_usd
            FROM cost_metrics
            GROUP BY org_id
          ) c ON c.org_id = o.id
          WHERE ${conditions.join(" AND ")}
          ORDER BY ${sortColumn} ${sortOrder}
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        params.push(limit, offset);
        const orgsResult = await query<OrganizationWithMetrics>(
          orgsQuery,
          params
        );

        return reply.send({
          organizations: orgsResult.rows.map((org) => ({
            id: org.id,
            name: org.name,
            slug: org.slug,
            plan: org.plan,
            settings: org.settings,
            status: org.suspended_at ? "suspended" : "active",
            suspendedAt: org.suspended_at,
            suspendedReason: org.suspended_reason,
            createdAt: org.created_at,
            updatedAt: org.updated_at,
            metrics: {
              userCount: org.user_count,
              eventCount: org.event_count,
              rcaCount: org.rca_count,
              integrationCount: org.integration_count,
              totalCostUsd: parseFloat(String(org.total_cost_usd || 0)),
            },
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        logger.error({ error }, "Failed to list organizations");
        return reply
          .status(500)
          .send({ error: "Failed to list organizations" });
      }
    }
  );

  /**
   * GET /api/admin/organizations/:orgId
   * Get detailed organization information
   */
  fastify.get<{ Params: { orgId: string } }>(
    "/:orgId",
    async (request, reply) => {
      try {
        const { orgId } = request.params;

        // Get organization with all metrics
        const orgQuery = `
          SELECT
            o.*,
            COALESCE(u.user_count, 0)::int as user_count,
            COALESCE(e.event_count, 0)::int as event_count,
            COALESCE(e.last_event_at, NULL) as last_event_at,
            COALESCE(r.rca_count, 0)::int as rca_count,
            COALESCE(i.integration_count, 0)::int as integration_count,
            COALESCE(c.total_cost_usd, 0)::numeric as total_cost_usd,
            COALESCE(c.llm_tokens_used, 0)::bigint as total_tokens_used
          FROM organizations o
          LEFT JOIN (
            SELECT org_id, COUNT(*) as user_count
            FROM users
            GROUP BY org_id
          ) u ON u.org_id = o.id
          LEFT JOIN (
            SELECT org_id, COUNT(*) as event_count, MAX(created_at) as last_event_at
            FROM events
            GROUP BY org_id
          ) e ON e.org_id = o.id
          LEFT JOIN (
            SELECT org_id, COUNT(*) as rca_count
            FROM rca_results
            GROUP BY org_id
          ) r ON r.org_id = o.id
          LEFT JOIN (
            SELECT org_id, COUNT(*) as integration_count
            FROM integrations
            GROUP BY org_id
          ) i ON i.org_id = o.id
          LEFT JOIN (
            SELECT org_id, SUM(llm_cost_usd) as total_cost_usd, SUM(llm_tokens_used) as llm_tokens_used
            FROM cost_metrics
            GROUP BY org_id
          ) c ON c.org_id = o.id
          WHERE o.id = $1
        `;

        const orgResult = await query<
          OrganizationWithMetrics & {
            last_event_at: Date | null;
            total_tokens_used: number;
          }
        >(orgQuery, [orgId]);

        if (orgResult.rows.length === 0) {
          return reply.status(404).send({ error: "Organization not found" });
        }

        const org = orgResult.rows[0];

        // Get users list
        const usersQuery = `
          SELECT id, email, name, role, is_active, created_at, updated_at
          FROM users
          WHERE org_id = $1
          ORDER BY created_at DESC
          LIMIT 10
        `;
        const usersResult = await query<{
          id: string;
          email: string;
          name: string | null;
          role: string;
          is_active: boolean;
          created_at: Date;
          updated_at: Date;
        }>(usersQuery, [orgId]);

        // Get integrations
        const integrationsQuery = `
          SELECT id, type, is_active, created_at
          FROM integrations
          WHERE org_id = $1
        `;
        const integrationsResult = await query<{
          id: string;
          type: string;
          is_active: boolean;
          created_at: Date;
        }>(integrationsQuery, [orgId]);

        // Get recent activity (last 7 days cost)
        const recentCostQuery = `
          SELECT
            SUM(llm_cost_usd) as cost,
            SUM(llm_tokens_used) as tokens
          FROM cost_metrics
          WHERE org_id = $1 AND date >= CURRENT_DATE - INTERVAL '7 days'
        `;
        const recentCostResult = await query<{
          cost: number | null;
          tokens: number | null;
        }>(recentCostQuery, [orgId]);

        return reply.send({
          organization: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            plan: org.plan,
            settings: org.settings,
            status: org.suspended_at ? "suspended" : "active",
            suspendedAt: org.suspended_at,
            suspendedReason: org.suspended_reason,
            createdAt: org.created_at,
            updatedAt: org.updated_at,
          },
          metrics: {
            userCount: org.user_count,
            eventCount: org.event_count,
            rcaCount: org.rca_count,
            integrationCount: org.integration_count,
            totalCostUsd: parseFloat(String(org.total_cost_usd || 0)),
            totalTokensUsed: Number(org.total_tokens_used || 0),
            lastEventAt: org.last_event_at,
            recentCostUsd: parseFloat(
              String(recentCostResult.rows[0]?.cost || 0)
            ),
            recentTokensUsed: Number(recentCostResult.rows[0]?.tokens || 0),
          },
          users: usersResult.rows.map((u) => ({
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            isActive: u.is_active,
            createdAt: u.created_at,
          })),
          integrations: integrationsResult.rows.map((i) => ({
            id: i.id,
            type: i.type,
            isActive: i.is_active,
            createdAt: i.created_at,
          })),
        });
      } catch (error) {
        logger.error({ error }, "Failed to get organization details");
        return reply
          .status(500)
          .send({ error: "Failed to get organization details" });
      }
    }
  );

  /**
   * POST /api/admin/organizations/:orgId/suspend
   * Suspend an organization
   */
  fastify.post<{
    Params: { orgId: string };
    Body: SuspendOrganizationBody;
  }>("/:orgId/suspend", async (request, reply) => {
    try {
      const { orgId } = request.params;
      const { reason } = request.body;

      if (!reason || reason.trim().length < 10) {
        return reply.status(400).send({
          error: "Suspension reason must be at least 10 characters",
        });
      }

      // Update organization
      const result = await query(
        `
        UPDATE organizations
        SET
          suspended_at = NOW(),
          suspended_reason = $2,
          updated_at = NOW()
        WHERE id = $1 AND suspended_at IS NULL
        RETURNING id
      `,
        [orgId, reason.trim()]
      );

      if (result.rowCount === 0) {
        return reply.status(404).send({
          error: "Organization not found or already suspended",
        });
      }

      // Log audit event
      await logAuditEvent(
        request,
        "organization.suspended",
        "organization",
        orgId,
        {
          reason,
        }
      );

      logger.info(
        {
          orgId,
          reason,
          adminUserId: (request.user as { userId?: string })?.userId,
        },
        "Organization suspended"
      );

      return reply.send({
        success: true,
        message: "Organization suspended successfully",
      });
    } catch (error) {
      logger.error({ error }, "Failed to suspend organization");
      return reply
        .status(500)
        .send({ error: "Failed to suspend organization" });
    }
  });

  /**
   * POST /api/admin/organizations/:orgId/unsuspend
   * Unsuspend an organization
   */
  fastify.post<{ Params: { orgId: string } }>(
    "/:orgId/unsuspend",
    async (request, reply) => {
      try {
        const { orgId } = request.params;

        const result = await query(
          `
          UPDATE organizations
          SET
            suspended_at = NULL,
            suspended_reason = NULL,
            updated_at = NOW()
          WHERE id = $1 AND suspended_at IS NOT NULL
          RETURNING id
        `,
          [orgId]
        );

        if (result.rowCount === 0) {
          return reply.status(404).send({
            error: "Organization not found or not suspended",
          });
        }

        // Log audit event
        // Note: audit logging temporarily disabled in this endpoint
        // await logAuditEvent(_request, "organization.suspended", "organization", orgId, { reason });

        logger.info(
          { orgId, adminUserId: (request.user as { userId?: string })?.userId },
          "Organization unsuspended"
        );

        return reply.send({
          success: true,
          message: "Organization unsuspended successfully",
        });
      } catch (error) {
        logger.error({ error }, "Failed to unsuspend organization");
        return reply
          .status(500)
          .send({ error: "Failed to unsuspend organization" });
      }
    }
  );

  /**
   * GET /api/admin/organizations/stats
   * Get global organization statistics
   */
  fastify.get("/stats", async (_request, reply) => {
    try {
      const statsQuery = `
        SELECT
          COUNT(*) FILTER (WHERE plan = 'free') as free_count,
          COUNT(*) FILTER (WHERE plan = 'pro') as pro_count,
          COUNT(*) FILTER (WHERE plan = 'enterprise') as enterprise_count,
          COUNT(*) FILTER (WHERE suspended_at IS NOT NULL) as suspended_count,
          COUNT(*) as total_count,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as new_last_week,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as new_last_month
        FROM organizations
      `;

      const result = await query<{
        free_count: string;
        pro_count: string;
        enterprise_count: string;
        suspended_count: string;
        total_count: string;
        new_last_week: string;
        new_last_month: string;
      }>(statsQuery, []);

      const stats = result.rows[0];

      return reply.send({
        byPlan: {
          free: parseInt(stats.free_count, 10),
          pro: parseInt(stats.pro_count, 10),
          enterprise: parseInt(stats.enterprise_count, 10),
        },
        suspended: parseInt(stats.suspended_count, 10),
        total: parseInt(stats.total_count, 10),
        growth: {
          lastWeek: parseInt(stats.new_last_week, 10),
          lastMonth: parseInt(stats.new_last_month, 10),
        },
      });
    } catch (error) {
      logger.error({ error }, "Failed to get organization stats");
      return reply
        .status(500)
        .send({ error: "Failed to get organization stats" });
    }
  });
}

// ============================================
// Audit Logging Helper
// ============================================

async function logAuditEvent(
  _request: FastifyRequest,
  action: string,
  resourceType: string,
  resourceId: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    // Check if audit_logs table exists, if not skip logging
    const tableCheck = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'audit_logs'
      ) as exists`
    );

    if (!tableCheck.rows[0]?.exists) {
      logger.debug("Audit logs table does not exist, skipping audit log");
      return;
    }

    await query(
      `INSERT INTO audit_logs (
        actor_id, actor_type, action, resource_type, resource_id,
        details, ip_address, user_agent, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        (_request.user as { userId?: string })?.userId,
        "user",
        action,
        resourceType,
        resourceId,
        JSON.stringify(details),
        _request.ip,
        _request.headers["user-agent"] || null,
      ]
    );
  } catch (error) {
    logger.warn({ error }, "Failed to log audit event (non-fatal)");
  }
}

export default adminOrganizationRoutes;
