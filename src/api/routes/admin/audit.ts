/**
 * Admin Routes for Audit Logs
 *
 * Provides endpoints for:
 * - Listing audit log entries
 * - Filtering by action, actor, resource
 * - Exporting audit logs
 *
 * @security Requires admin role + platform-admin-token validation
 */

import type { FastifyInstance } from "fastify";
import { query } from "../../../db/client.js";
import { logger } from "../../../utils/logger.js";
import { createAdminAuthHook } from "../../middleware/admin-auth.js";

// ============================================
// Types
// ============================================

interface AuditLogRow {
  id: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

interface AuditLogWithActor extends AuditLogRow {
  actor_email: string | null;
  actor_name: string | null;
}

interface ListAuditLogsQuery {
  action?: string;
  resourceType?: string;
  resourceId?: string;
  actorId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

// ============================================
// Route Registration
// ============================================

export async function adminAuditRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // Apply admin authentication to all routes
  fastify.addHook("preHandler", createAdminAuthHook("audit logs"));

  // Check if audit_logs table exists
  fastify.addHook("preHandler", async (_request, reply) => {
    const tableCheck = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'audit_logs'
      ) as exists`
    );

    if (!tableCheck.rows[0]?.exists) {
      reply.status(503).send({
        error: "Audit logs not available",
        message:
          "The audit_logs table has not been created. Run migrations to enable audit logging.",
      });
      return;
    }
  });

  /**
   * GET /api/admin/audit
   * List audit log entries with filtering
   */
  fastify.get<{ Querystring: ListAuditLogsQuery }>(
    "/",
    async (request, reply) => {
      try {
        const {
          action,
          resourceType,
          resourceId,
          actorId,
          startDate,
          endDate,
          page = 1,
          limit = 50,
        } = request.query;

        const offset = (page - 1) * limit;
        const conditions: string[] = ["1=1"];
        const params: unknown[] = [];
        let paramIndex = 1;

        // Action filter
        if (action) {
          conditions.push(`a.action = $${paramIndex}`);
          params.push(action);
          paramIndex++;
        }

        // Resource type filter
        if (resourceType) {
          conditions.push(`a.resource_type = $${paramIndex}`);
          params.push(resourceType);
          paramIndex++;
        }

        // Resource ID filter
        if (resourceId) {
          conditions.push(`a.resource_id = $${paramIndex}`);
          params.push(resourceId);
          paramIndex++;
        }

        // Actor ID filter
        if (actorId) {
          conditions.push(`a.actor_id = $${paramIndex}`);
          params.push(actorId);
          paramIndex++;
        }

        // Date range filters
        if (startDate) {
          conditions.push(`a.created_at >= $${paramIndex}`);
          params.push(new Date(startDate));
          paramIndex++;
        }

        if (endDate) {
          conditions.push(`a.created_at <= $${paramIndex}`);
          params.push(new Date(endDate));
          paramIndex++;
        }

        // Get total count
        const countQuery = `
        SELECT COUNT(*) as total
        FROM audit_logs a
        WHERE ${conditions.join(" AND ")}
      `;
        const countResult = await query<{ total: string }>(countQuery, params);
        const total = parseInt(countResult.rows[0].total, 10);

        // Get logs with actor info
        const logsQuery = `
        SELECT
          a.*,
          u.email as actor_email,
          u.name as actor_name
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_id::uuid
        WHERE ${conditions.join(" AND ")}
        ORDER BY a.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;

        params.push(limit, offset);
        const logsResult = await query<AuditLogWithActor>(logsQuery, params);

        return reply.send({
          logs: logsResult.rows.map((log) => ({
            id: log.id,
            action: log.action,
            resourceType: log.resource_type,
            resourceId: log.resource_id,
            details: log.details,
            actor: {
              id: log.actor_id,
              type: log.actor_type,
              email: log.actor_email,
              name: log.actor_name,
            },
            ipAddress: log.ip_address,
            userAgent: log.user_agent,
            createdAt: log.created_at,
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        logger.error({ error }, "Failed to list audit logs");
        return reply.status(500).send({ error: "Failed to list audit logs" });
      }
    }
  );

  /**
   * GET /api/admin/audit/:logId
   * Get detailed audit log entry
   */
  fastify.get<{ Params: { logId: string } }>(
    "/:logId",
    async (request, reply) => {
      try {
        const { logId } = request.params;

        const logQuery = `
        SELECT
          a.*,
          u.email as actor_email,
          u.name as actor_name,
          u.role as actor_role
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_id::uuid
        WHERE a.id = $1
      `;

        const logResult = await query<
          AuditLogWithActor & { actor_role: string | null }
        >(logQuery, [logId]);

        if (logResult.rows.length === 0) {
          return reply.status(404).send({ error: "Audit log not found" });
        }

        const log = logResult.rows[0];

        return reply.send({
          log: {
            id: log.id,
            action: log.action,
            resourceType: log.resource_type,
            resourceId: log.resource_id,
            details: log.details,
            actor: {
              id: log.actor_id,
              type: log.actor_type,
              email: log.actor_email,
              name: log.actor_name,
              role: log.actor_role,
            },
            ipAddress: log.ip_address,
            userAgent: log.user_agent,
            createdAt: log.created_at,
          },
        });
      } catch (error) {
        logger.error({ error }, "Failed to get audit log details");
        return reply
          .status(500)
          .send({ error: "Failed to get audit log details" });
      }
    }
  );

  /**
   * GET /api/admin/audit/actions
   * Get list of unique actions for filtering
   */
  fastify.get("/actions", async (_request, reply) => {
    try {
      const actionsQuery = `
        SELECT DISTINCT action, COUNT(*) as count
        FROM audit_logs
        GROUP BY action
        ORDER BY count DESC
      `;

      const actionsResult = await query<{ action: string; count: string }>(
        actionsQuery
      );

      return reply.send({
        actions: actionsResult.rows.map((row) => ({
          action: row.action,
          count: parseInt(row.count, 10),
        })),
      });
    } catch (error) {
      logger.error({ error }, "Failed to get audit actions");
      return reply.status(500).send({ error: "Failed to get audit actions" });
    }
  });

  /**
   * GET /api/admin/audit/resource-types
   * Get list of unique resource types for filtering
   */
  fastify.get("/resource-types", async (_request, reply) => {
    try {
      const typesQuery = `
        SELECT DISTINCT resource_type, COUNT(*) as count
        FROM audit_logs
        GROUP BY resource_type
        ORDER BY count DESC
      `;

      const typesResult = await query<{
        resource_type: string;
        count: string;
      }>(typesQuery);

      return reply.send({
        resourceTypes: typesResult.rows.map((row) => ({
          type: row.resource_type,
          count: parseInt(row.count, 10),
        })),
      });
    } catch (error) {
      logger.error({ error }, "Failed to get resource types");
      return reply.status(500).send({ error: "Failed to get resource types" });
    }
  });

  /**
   * GET /api/admin/audit/export
   * Export audit logs as CSV
   */
  fastify.get<{
    Querystring: ListAuditLogsQuery & { format?: "csv" | "json" };
  }>("/export", async (request, reply) => {
    try {
      const {
        action,
        resourceType,
        resourceId,
        actorId,
        startDate,
        endDate,
        format = "csv",
      } = request.query;

      const conditions: string[] = ["1=1"];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (action) {
        conditions.push(`a.action = $${paramIndex}`);
        params.push(action);
        paramIndex++;
      }

      if (resourceType) {
        conditions.push(`a.resource_type = $${paramIndex}`);
        params.push(resourceType);
        paramIndex++;
      }

      if (resourceId) {
        conditions.push(`a.resource_id = $${paramIndex}`);
        params.push(resourceId);
        paramIndex++;
      }

      if (actorId) {
        conditions.push(`a.actor_id = $${paramIndex}`);
        params.push(actorId);
        paramIndex++;
      }

      if (startDate) {
        conditions.push(`a.created_at >= $${paramIndex}`);
        params.push(new Date(startDate));
        paramIndex++;
      }

      if (endDate) {
        conditions.push(`a.created_at <= $${paramIndex}`);
        params.push(new Date(endDate));
        paramIndex++;
      }

      // Limit export to 10000 records
      const logsQuery = `
        SELECT
          a.id,
          a.action,
          a.resource_type,
          a.resource_id,
          a.actor_id,
          a.actor_type,
          u.email as actor_email,
          a.ip_address,
          a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_id::uuid
        WHERE ${conditions.join(" AND ")}
        ORDER BY a.created_at DESC
        LIMIT 10000
      `;

      const logsResult = await query<{
        id: string;
        action: string;
        resource_type: string;
        resource_id: string;
        actor_id: string | null;
        actor_type: string;
        actor_email: string | null;
        ip_address: string | null;
        created_at: Date;
      }>(logsQuery, params);

      if (format === "json") {
        return reply
          .header("Content-Type", "application/json")
          .header(
            "Content-Disposition",
            `attachment; filename="audit_logs_${new Date().toISOString().split("T")[0]}.json"`
          )
          .send({
            exportedAt: new Date().toISOString(),
            totalRecords: logsResult.rows.length,
            logs: logsResult.rows,
          });
      }

      // CSV format
      const csvHeader =
        "ID,Action,Resource Type,Resource ID,Actor ID,Actor Type,Actor Email,IP Address,Created At\n";
      const csvRows = logsResult.rows
        .map((log) =>
          [
            log.id,
            log.action,
            log.resource_type,
            log.resource_id,
            log.actor_id || "",
            log.actor_type,
            log.actor_email || "",
            log.ip_address || "",
            log.created_at.toISOString(),
          ]
            .map((field) => `"${String(field).replace(/"/g, '""')}"`)
            .join(",")
        )
        .join("\n");

      return reply
        .header("Content-Type", "text/csv")
        .header(
          "Content-Disposition",
          `attachment; filename="audit_logs_${new Date().toISOString().split("T")[0]}.csv"`
        )
        .send(csvHeader + csvRows);
    } catch (error) {
      logger.error({ error }, "Failed to export audit logs");
      return reply.status(500).send({ error: "Failed to export audit logs" });
    }
  });

  /**
   * GET /api/admin/audit/stats
   * Get audit log statistics
   */
  fastify.get("/stats", async (_request, reply) => {
    try {
      const statsQuery = `
        SELECT
          COUNT(*) as total_count,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '24 hours') as last_24h,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as last_7d,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as last_30d,
          COUNT(DISTINCT actor_id) as unique_actors,
          COUNT(DISTINCT action) as unique_actions
        FROM audit_logs
      `;

      const statsResult = await query<{
        total_count: string;
        last_24h: string;
        last_7d: string;
        last_30d: string;
        unique_actors: string;
        unique_actions: string;
      }>(statsQuery);

      const stats = statsResult.rows[0];

      // Get top actions
      const topActionsQuery = `
        SELECT action, COUNT(*) as count
        FROM audit_logs
        WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY action
        ORDER BY count DESC
        LIMIT 5
      `;
      const topActionsResult = await query<{ action: string; count: string }>(
        topActionsQuery
      );

      return reply.send({
        total: parseInt(stats.total_count, 10),
        last24h: parseInt(stats.last_24h, 10),
        last7d: parseInt(stats.last_7d, 10),
        last30d: parseInt(stats.last_30d, 10),
        uniqueActors: parseInt(stats.unique_actors, 10),
        uniqueActions: parseInt(stats.unique_actions, 10),
        topActions: topActionsResult.rows.map((row) => ({
          action: row.action,
          count: parseInt(row.count, 10),
        })),
      });
    } catch (error) {
      logger.error({ error }, "Failed to get audit stats");
      return reply.status(500).send({ error: "Failed to get audit stats" });
    }
  });
}

export default adminAuditRoutes;
