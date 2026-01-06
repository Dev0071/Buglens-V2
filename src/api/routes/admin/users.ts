/**
 * Admin Routes for User Management
 *
 * Provides endpoints for:
 * - Listing all users across organizations
 * - Getting user details
 * - Suspending/unsuspending users
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

interface UserRow {
  id: string;
  org_id: string;
  email: string;
  name: string | null;
  role: string;
  slack_user_id: string | null;
  github_username: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

interface UserWithOrg extends UserRow {
  org_name: string;
  org_slug: string;
  org_plan: string;
}

interface ListUsersQuery {
  search?: string;
  role?: "owner" | "admin" | "member";
  status?: "active" | "inactive";
  orgId?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
}

interface SuspendUserBody {
  reason: string;
}

// ============================================
// Route Registration
// ============================================

export async function adminUserRoutes(fastify: FastifyInstance): Promise<void> {
  // Apply admin authentication to all routes
  fastify.addHook("preHandler", createAdminAuthHook("user management"));

  /**
   * GET /api/admin/users
   * List all users with their organizations
   */
  fastify.get<{ Querystring: ListUsersQuery }>("/", async (request, reply) => {
    try {
      const {
        search,
        role,
        status,
        orgId,
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
          `(u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`
        );
        params.push(`%${search}%`);
        paramIndex++;
      }

      // Role filter
      if (role) {
        conditions.push(`u.role = $${paramIndex}`);
        params.push(role);
        paramIndex++;
      }

      // Status filter
      if (status === "active") {
        conditions.push("u.is_active = true");
      } else if (status === "inactive") {
        conditions.push("u.is_active = false");
      }

      // Organization filter
      if (orgId) {
        conditions.push(`u.org_id = $${paramIndex}`);
        params.push(orgId);
        paramIndex++;
      }

      // Validate sort column
      const allowedSortColumns = [
        "created_at",
        "email",
        "name",
        "role",
        "last_login_at",
      ];
      const sortColumn = allowedSortColumns.includes(sort)
        ? sort
        : "created_at";
      const sortOrder = order === "asc" ? "ASC" : "DESC";

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total
        FROM users u
        WHERE ${conditions.join(" AND ")}
      `;
      const countResult = await query<{ total: string }>(countQuery, params);
      const total = parseInt(countResult.rows[0].total, 10);

      // Get users with organization info
      const usersQuery = `
        SELECT
          u.*,
          o.name as org_name,
          o.slug as org_slug,
          o.plan as org_plan
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY u.${sortColumn} ${sortOrder}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;

      params.push(limit, offset);
      const usersResult = await query<UserWithOrg>(usersQuery, params);

      return reply.send({
        users: usersResult.rows.map((user) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          isActive: user.is_active,
          slackUserId: user.slack_user_id,
          githubUsername: user.github_username,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
          lastLoginAt: user.last_login_at,
          organization: {
            id: user.org_id,
            name: user.org_name,
            slug: user.org_slug,
            plan: user.org_plan,
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
      logger.error({ error }, "Failed to list users");
      return reply.status(500).send({ error: "Failed to list users" });
    }
  });

  /**
   * GET /api/admin/users/:userId
   * Get detailed user information
   */
  fastify.get<{ Params: { userId: string } }>(
    "/:userId",
    async (request, reply) => {
      try {
        const { userId } = request.params;

        // Get user with organization info
        const userQuery = `
          SELECT
            u.*,
            o.name as org_name,
            o.slug as org_slug,
            o.plan as org_plan,
            o.suspended_at as org_suspended_at
          FROM users u
          JOIN organizations o ON o.id = u.org_id
          WHERE u.id = $1
        `;

        const userResult = await query<
          UserWithOrg & { org_suspended_at: Date | null }
        >(userQuery, [userId]);

        if (userResult.rows.length === 0) {
          return reply.status(404).send({ error: "User not found" });
        }

        const user = userResult.rows[0];

        // Get user activity stats
        const activityQuery = `
          SELECT
            COUNT(DISTINCT e.id) as events_created,
            COUNT(DISTINCT r.id) as rcas_triggered
          FROM users u
          LEFT JOIN events e ON e.org_id = u.org_id
          LEFT JOIN rca_results r ON r.org_id = u.org_id
          WHERE u.id = $1
        `;
        const activityResult = await query<{
          events_created: string;
          rcas_triggered: string;
        }>(activityQuery, [userId]);

        // Get user sessions (if tracked)
        const sessionsQuery = `
          SELECT id, created_at, expires_at, user_agent, ip_address
          FROM user_sessions
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 5
        `;
        let sessions: Array<{
          id: string;
          createdAt: Date;
          expiresAt: Date;
          userAgent: string | null;
          ipAddress: string | null;
        }> = [];

        try {
          const sessionsResult = await query<{
            id: string;
            created_at: Date;
            expires_at: Date;
            user_agent: string | null;
            ip_address: string | null;
          }>(sessionsQuery, [userId]);
          sessions = sessionsResult.rows.map((s) => ({
            id: s.id,
            createdAt: s.created_at,
            expiresAt: s.expires_at,
            userAgent: s.user_agent,
            ipAddress: s.ip_address,
          }));
        } catch {
          // Sessions table may not exist
        }

        return reply.send({
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isActive: user.is_active,
            slackUserId: user.slack_user_id,
            githubUsername: user.github_username,
            createdAt: user.created_at,
            updatedAt: user.updated_at,
            lastLoginAt: user.last_login_at,
          },
          organization: {
            id: user.org_id,
            name: user.org_name,
            slug: user.org_slug,
            plan: user.org_plan,
            isSuspended: user.org_suspended_at !== null,
          },
          activity: {
            eventsCreated: parseInt(
              activityResult.rows[0]?.events_created || "0",
              10
            ),
            rcasTriggered: parseInt(
              activityResult.rows[0]?.rcas_triggered || "0",
              10
            ),
          },
          sessions,
        });
      } catch (error) {
        logger.error({ error }, "Failed to get user details");
        return reply.status(500).send({ error: "Failed to get user details" });
      }
    }
  );

  /**
   * POST /api/admin/users/:userId/suspend
   * Suspend a user
   */
  fastify.post<{
    Params: { userId: string };
    Body: SuspendUserBody;
  }>("/:userId/suspend", async (request, reply) => {
    try {
      const { userId } = request.params;
      const { reason } = request.body;

      if (!reason || reason.trim().length < 10) {
        return reply.status(400).send({
          error: "Suspension reason must be at least 10 characters",
        });
      }

      // Check if user is an owner - owners cannot be suspended via this endpoint
      const userCheck = await query<{ role: string }>(
        "SELECT role FROM users WHERE id = $1",
        [userId]
      );

      if (userCheck.rows.length === 0) {
        return reply.status(404).send({ error: "User not found" });
      }

      if (userCheck.rows[0].role === "owner") {
        return reply.status(403).send({
          error:
            "Organization owners cannot be suspended. Suspend the organization instead.",
        });
      }

      // Update user
      const result = await query(
        `
        UPDATE users
        SET
          is_active = false,
          updated_at = NOW()
        WHERE id = $1 AND is_active = true
        RETURNING id
      `,
        [userId]
      );

      if (result.rowCount === 0) {
        return reply.status(404).send({
          error: "User not found or already suspended",
        });
      }

      // Log audit event
      await logAuditEvent(request, "user.suspended", "user", userId, {
        reason,
      });

      logger.info(
        {
          userId,
          reason,
          adminUserId: (request.user as { userId?: string })?.userId,
        },
        "User suspended"
      );

      return reply.send({
        success: true,
        message: "User suspended successfully",
      });
    } catch (error) {
      logger.error({ error }, "Failed to suspend user");
      return reply.status(500).send({ error: "Failed to suspend user" });
    }
  });

  /**
   * POST /api/admin/users/:userId/unsuspend
   * Unsuspend a user
   */
  fastify.post<{ Params: { userId: string } }>(
    "/:userId/unsuspend",
    async (request, reply) => {
      try {
        const { userId } = request.params;

        const result = await query(
          `
          UPDATE users
          SET
            is_active = true,
            updated_at = NOW()
          WHERE id = $1 AND is_active = false
          RETURNING id
        `,
          [userId]
        );

        if (result.rowCount === 0) {
          return reply.status(404).send({
            error: "User not found or not suspended",
          });
        }

        // Log audit event
        await logAuditEvent(request, "user.unsuspended", "user", userId, {});

        logger.info(
          {
            userId,
            adminUserId: (request.user as { userId?: string })?.userId,
          },
          "User unsuspended"
        );

        return reply.send({
          success: true,
          message: "User unsuspended successfully",
        });
      } catch (error) {
        logger.error({ error }, "Failed to unsuspend user");
        return reply.status(500).send({ error: "Failed to unsuspend user" });
      }
    }
  );

  /**
   * GET /api/admin/users/stats
   * Get global user statistics
   */
  fastify.get("/stats", async (_request, reply) => {
    try {
      const statsQuery = `
        SELECT
          COUNT(*) FILTER (WHERE role = 'owner') as owner_count,
          COUNT(*) FILTER (WHERE role = 'admin') as admin_count,
          COUNT(*) FILTER (WHERE role = 'member') as member_count,
          COUNT(*) FILTER (WHERE is_active = false) as inactive_count,
          COUNT(*) as total_count,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as new_last_week,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as new_last_month,
          COUNT(*) FILTER (WHERE last_login_at >= CURRENT_DATE - INTERVAL '7 days') as active_last_week
        FROM users
      `;

      const result = await query<{
        owner_count: string;
        admin_count: string;
        member_count: string;
        inactive_count: string;
        total_count: string;
        new_last_week: string;
        new_last_month: string;
        active_last_week: string;
      }>(statsQuery, []);

      const stats = result.rows[0];

      return reply.send({
        byRole: {
          owner: parseInt(stats.owner_count, 10),
          admin: parseInt(stats.admin_count, 10),
          member: parseInt(stats.member_count, 10),
        },
        inactive: parseInt(stats.inactive_count, 10),
        total: parseInt(stats.total_count, 10),
        growth: {
          lastWeek: parseInt(stats.new_last_week, 10),
          lastMonth: parseInt(stats.new_last_month, 10),
        },
        activeLastWeek: parseInt(stats.active_last_week, 10),
      });
    } catch (error) {
      logger.error({ error }, "Failed to get user stats");
      return reply.status(500).send({ error: "Failed to get user stats" });
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

export default adminUserRoutes;
