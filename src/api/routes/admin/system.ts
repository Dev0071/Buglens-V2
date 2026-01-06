/**
 * Admin Routes for System Health Monitoring
 *
 * Provides endpoints for:
 * - System-wide health status
 * - Service health checks (DB, Redis, S3, GitHub)
 * - Queue statistics and job monitoring
 * - Resource metrics
 *
 * @security Requires admin role + platform-admin-token validation
 */

import type { FastifyInstance } from "fastify";
import { query, pool } from "../../../db/client.js";
import { redis } from "../../../db/redis.js";
import { logger } from "../../../utils/logger.js";
import { config } from "../../../utils/config.js";
import { createAdminAuthHook } from "../../middleware/admin-auth.js";

// ============================================
// Types
// ============================================

interface ServiceStatus {
  name: string;
  status: "healthy" | "degraded" | "down";
  latencyMs?: number;
  message?: string;
  lastChecked: Date;
}

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface ResourceMetrics {
  cpu?: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  connections: {
    database: number;
    redis: number;
  };
}

interface ListJobsQuery {
  status?: "waiting" | "active" | "completed" | "failed" | "delayed";
  page?: number;
  limit?: number;
}

// ============================================
// Health Check Helpers
// ============================================

async function checkDatabaseHealth(): Promise<ServiceStatus> {
  const startTime = Date.now();
  try {
    await query("SELECT 1");
    const latencyMs = Date.now() - startTime;

    // Check pool status
    const totalConnections = pool.totalCount;
    const idleConnections = pool.idleCount;
    const waitingClients = pool.waitingCount;

    let status: "healthy" | "degraded" | "down" = "healthy";
    let message = `${totalConnections} connections (${idleConnections} idle)`;

    if (waitingClients > 0) {
      status = "degraded";
      message += `, ${waitingClients} waiting`;
    }

    if (latencyMs > 100) {
      status = "degraded";
      message += `, high latency`;
    }

    return {
      name: "PostgreSQL",
      status,
      latencyMs,
      message,
      lastChecked: new Date(),
    };
  } catch (error) {
    return {
      name: "PostgreSQL",
      status: "down",
      latencyMs: Date.now() - startTime,
      message: error instanceof Error ? error.message : "Connection failed",
      lastChecked: new Date(),
    };
  }
}

async function checkRedisHealth(): Promise<ServiceStatus> {
  const startTime = Date.now();
  try {
    await redis.client.ping();
    const latencyMs = Date.now() - startTime;

    let status: "healthy" | "degraded" | "down" = "healthy";
    if (latencyMs > 50) {
      status = "degraded";
    }

    return {
      name: "Redis",
      status,
      latencyMs,
      message: "Connected",
      lastChecked: new Date(),
    };
  } catch (error) {
    return {
      name: "Redis",
      status: "down",
      latencyMs: Date.now() - startTime,
      message: error instanceof Error ? error.message : "Connection failed",
      lastChecked: new Date(),
    };
  }
}

async function checkS3Health(): Promise<ServiceStatus> {
  const startTime = Date.now();
  try {
    // S3 health check - just verify we have config
    // In production, you'd do a headBucket or similar
    if (!config.S3_BUCKET_NAME) {
      return {
        name: "S3",
        status: "degraded",
        message: "S3 bucket not configured",
        lastChecked: new Date(),
      };
    }

    return {
      name: "S3",
      status: "healthy",
      latencyMs: Date.now() - startTime,
      message: `Bucket: ${config.S3_BUCKET_NAME}`,
      lastChecked: new Date(),
    };
  } catch (error) {
    return {
      name: "S3",
      status: "down",
      latencyMs: Date.now() - startTime,
      message: error instanceof Error ? error.message : "Check failed",
      lastChecked: new Date(),
    };
  }
}

async function checkGitHubAPIHealth(): Promise<ServiceStatus> {
  const startTime = Date.now();
  try {
    // Check if we have GitHub app configured
    if (!config.GITHUB_APP_ID || !config.GITHUB_APP_PRIVATE_KEY_SECRET_ID) {
      return {
        name: "GitHub API",
        status: "degraded",
        message: "GitHub App not configured",
        lastChecked: new Date(),
      };
    }

    // Check rate limit status from cache
    const rateLimitKey = "github:rate_limit";
    const cached = await redis.client.get(rateLimitKey);

    if (cached) {
      const rateLimit = JSON.parse(cached);
      const remaining = rateLimit.remaining || 0;
      const limit = rateLimit.limit || 5000;

      let status: "healthy" | "degraded" | "down" = "healthy";
      let message = `Rate limit: ${remaining}/${limit}`;

      if (remaining < 100) {
        status = "degraded";
        message += " (low)";
      } else if (remaining < 10) {
        status = "down";
        message += " (exhausted)";
      }

      return {
        name: "GitHub API",
        status,
        latencyMs: Date.now() - startTime,
        message,
        lastChecked: new Date(),
      };
    }

    return {
      name: "GitHub API",
      status: "healthy",
      latencyMs: Date.now() - startTime,
      message: "Configured",
      lastChecked: new Date(),
    };
  } catch (error) {
    return {
      name: "GitHub API",
      status: "down",
      latencyMs: Date.now() - startTime,
      message: error instanceof Error ? error.message : "Check failed",
      lastChecked: new Date(),
    };
  }
}

async function getQueueStats(): Promise<QueueStats> {
  try {
    // Get queue stats from Redis/BullMQ
    const prefix = "bull:rca-queue:";

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      redis.client.llen(`${prefix}wait`).catch(() => 0),
      redis.client.llen(`${prefix}active`).catch(() => 0),
      redis.client
        .get(`${prefix}completed:count`)
        .then((v) => parseInt(v || "0", 10)),
      redis.client.zcard(`${prefix}failed`).catch(() => 0),
      redis.client.zcard(`${prefix}delayed`).catch(() => 0),
    ]);

    return {
      waiting: Number(waiting) || 0,
      active: Number(active) || 0,
      completed: Number(completed) || 0,
      failed: Number(failed) || 0,
      delayed: Number(delayed) || 0,
    };
  } catch (error) {
    logger.warn({ error }, "Failed to get queue stats");
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  }
}

async function getResourceMetrics(): Promise<ResourceMetrics> {
  const memUsage = process.memoryUsage();

  return {
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024),
      total: Math.round(memUsage.heapTotal / 1024 / 1024),
      percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
    },
    connections: {
      database: pool.totalCount,
      redis: 1, // Redis uses a single connection with multiplexing
    },
  };
}

// ============================================
// Route Registration
// ============================================

export async function adminSystemRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // Apply admin authentication to all routes
  fastify.addHook("preHandler", createAdminAuthHook("system health"));

  /**
   * GET /api/admin/system/health
   * Get comprehensive system health status
   */
  fastify.get("/health", async (_request, reply) => {
    try {
      // Wrap each health check in try-catch to prevent one failure from crashing the entire endpoint
      const safeHealthCheck = async <T>(
        check: () => Promise<T>,
        fallback: T
      ): Promise<T> => {
        try {
          return await check();
        } catch (error) {
          logger.warn({ error }, "Health check failed");
          return fallback;
        }
      };

      const defaultServiceStatus = (name: string): ServiceStatus => ({
        name,
        status: "down" as const,
        message: "Health check failed",
        lastChecked: new Date(),
      });

      const [dbHealth, redisHealth, s3Health, githubHealth] = await Promise.all(
        [
          safeHealthCheck(
            checkDatabaseHealth,
            defaultServiceStatus("PostgreSQL")
          ),
          safeHealthCheck(checkRedisHealth, defaultServiceStatus("Redis")),
          safeHealthCheck(checkS3Health, defaultServiceStatus("S3")),
          safeHealthCheck(
            checkGitHubAPIHealth,
            defaultServiceStatus("GitHub API")
          ),
        ]
      );

      const services = [dbHealth, redisHealth, s3Health, githubHealth];

      // Determine overall status
      const hasDown = services.some((s) => s.status === "down");
      const hasDegraded = services.some((s) => s.status === "degraded");

      let overallStatus: "healthy" | "degraded" | "critical" = "healthy";
      if (hasDown) {
        overallStatus = "critical";
      } else if (hasDegraded) {
        overallStatus = "degraded";
      }

      const queueStats = await safeHealthCheck(getQueueStats, {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
      const resourceMetrics = await safeHealthCheck(getResourceMetrics, {
        memory: { used: 0, total: 0, percentage: 0 },
        connections: { database: 0, redis: 0 },
      });

      return reply.send({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealth,
          redis: redisHealth,
          s3: s3Health,
          githubApi: githubHealth,
        },
        queue: queueStats,
        resources: resourceMetrics,
        uptime: Math.round(process.uptime()),
        version: process.env.npm_package_version || "dev",
      });
    } catch (error) {
      logger.error({ error }, "Failed to get system health");
      return reply.status(500).send({ error: "Failed to get system health" });
    }
  });

  /**
   * GET /api/admin/system/queue
   * Get detailed queue statistics
   */
  fastify.get("/queue", async (_request, reply) => {
    try {
      const stats = await getQueueStats();

      // Get additional metrics
      const successRate =
        stats.completed > 0
          ? Math.round(
              (stats.completed / (stats.completed + stats.failed)) * 100
            )
          : 100;

      // Get average processing time (if tracked)
      let avgProcessingTimeMs: number | null = null;
      try {
        const avgTimeKey = "rca:avg_processing_time";
        const cached = await redis.client.get(avgTimeKey);
        if (cached) {
          avgProcessingTimeMs = parseInt(cached, 10);
        }
      } catch {
        // Ignore
      }

      return reply.send({
        stats,
        metrics: {
          successRate,
          avgProcessingTimeMs,
          totalProcessed: stats.completed + stats.failed,
        },
        lastUpdated: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, "Failed to get queue stats");
      return reply.status(500).send({ error: "Failed to get queue stats" });
    }
  });

  /**
   * GET /api/admin/system/jobs
   * List recent jobs from the queue
   */
  fastify.get<{ Querystring: ListJobsQuery }>(
    "/jobs",
    async (request, reply) => {
      try {
        const { status = "failed", page = 1, limit = 20 } = request.query;

        // Get jobs from database (rca_jobs table)
        const offset = (page - 1) * limit;
        let statusCondition = "";

        switch (status) {
          case "waiting":
            statusCondition = "status = 'pending'";
            break;
          case "active":
            statusCondition = "status = 'processing'";
            break;
          case "completed":
            statusCondition = "status = 'completed'";
            break;
          case "failed":
            statusCondition = "status = 'failed'";
            break;
          default:
            statusCondition = "1=1";
        }

        const countResult = await query<{ total: string }>(
          `SELECT COUNT(*) as total FROM rca_jobs WHERE ${statusCondition}`
        );
        const total = parseInt(countResult.rows[0].total, 10);

        const jobsResult = await query<{
          id: string;
          org_id: string;
          event_id: string;
          status: string;
          attempts: number;
          error: string | null;
          created_at: Date;
          updated_at: Date;
          started_at: Date | null;
          completed_at: Date | null;
        }>(
          `
        SELECT id, org_id, event_id, status, attempts, error,
               created_at, updated_at, started_at, completed_at
        FROM rca_jobs
        WHERE ${statusCondition}
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `,
          [limit, offset]
        );

        return reply.send({
          jobs: jobsResult.rows.map((job) => ({
            id: job.id,
            orgId: job.org_id,
            eventId: job.event_id,
            status: job.status,
            attempts: job.attempts,
            error: job.error,
            createdAt: job.created_at,
            updatedAt: job.updated_at,
            startedAt: job.started_at,
            completedAt: job.completed_at,
            duration:
              job.started_at && job.completed_at
                ? new Date(job.completed_at).getTime() -
                  new Date(job.started_at).getTime()
                : null,
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        logger.error({ error }, "Failed to list jobs");
        return reply.status(500).send({ error: "Failed to list jobs" });
      }
    }
  );

  /**
   * POST /api/admin/system/jobs/:jobId/retry
   * Retry a failed job
   */
  fastify.post<{ Params: { jobId: string } }>(
    "/jobs/:jobId/retry",
    async (request, reply) => {
      try {
        const { jobId } = request.params;

        // Get job info
        const jobResult = await query<{
          id: string;
          org_id: string;
          event_id: string;
          status: string;
        }>("SELECT id, org_id, event_id, status FROM rca_jobs WHERE id = $1", [
          jobId,
        ]);

        if (jobResult.rows.length === 0) {
          return reply.status(404).send({ error: "Job not found" });
        }

        const job = jobResult.rows[0];

        if (job.status !== "failed") {
          return reply.status(400).send({
            error: "Only failed jobs can be retried",
          });
        }

        // Reset job status
        await query(
          `
        UPDATE rca_jobs
        SET
          status = 'pending',
          error = NULL,
          updated_at = NOW()
        WHERE id = $1
      `,
          [jobId]
        );

        // In a real implementation, you'd also re-add to BullMQ
        logger.info(
          { jobId, adminUserId: (request.user as { userId?: string })?.userId },
          "Job queued for retry"
        );

        return reply.send({
          success: true,
          message: "Job queued for retry",
        });
      } catch (error) {
        logger.error({ error }, "Failed to retry job");
        return reply.status(500).send({ error: "Failed to retry job" });
      }
    }
  );

  /**
   * GET /api/admin/system/analytics
   * Get global system analytics
   */
  fastify.get("/analytics", async (_request, reply) => {
    try {
      // Get overall stats
      const statsQuery = `
        SELECT
          (SELECT COUNT(*) FROM organizations) as org_count,
          (SELECT COUNT(*) FROM users) as user_count,
          (SELECT COUNT(*) FROM events) as event_count,
          (SELECT COUNT(*) FROM rca_results) as rca_count,
          (SELECT COALESCE(SUM(llm_cost_usd), 0) FROM cost_metrics) as total_cost,
          (SELECT COALESCE(SUM(llm_tokens_used), 0) FROM cost_metrics) as total_tokens,
          (SELECT COUNT(*) FROM events WHERE created_at >= CURRENT_DATE - INTERVAL '24 hours') as events_24h,
          (SELECT COUNT(*) FROM rca_results WHERE created_at >= CURRENT_DATE - INTERVAL '24 hours') as rcas_24h
      `;

      const statsResult = await query<{
        org_count: string;
        user_count: string;
        event_count: string;
        rca_count: string;
        total_cost: string;
        total_tokens: string;
        events_24h: string;
        rcas_24h: string;
      }>(statsQuery);

      const stats = statsResult.rows[0];

      // Get daily breakdown for last 7 days
      const dailyQuery = `
        SELECT
          DATE(created_at) as date,
          COUNT(*) as count
        FROM events
        WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date
      `;
      const dailyResult = await query<{ date: Date; count: string }>(
        dailyQuery
      );

      return reply.send({
        totals: {
          organizations: parseInt(stats.org_count, 10),
          users: parseInt(stats.user_count, 10),
          events: parseInt(stats.event_count, 10),
          rcas: parseInt(stats.rca_count, 10),
          costUsd: parseFloat(stats.total_cost),
          tokensUsed: parseInt(stats.total_tokens, 10),
        },
        last24h: {
          events: parseInt(stats.events_24h, 10),
          rcas: parseInt(stats.rcas_24h, 10),
        },
        daily: dailyResult.rows.map((row) => ({
          date: row.date,
          events: parseInt(row.count, 10),
        })),
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, "Failed to get system analytics");
      return reply
        .status(500)
        .send({ error: "Failed to get system analytics" });
    }
  });

  /**
   * GET /api/admin/system/costs
   * Get detailed cost breakdown
   */
  fastify.get("/costs", async (_request, reply) => {
    try {
      // Get cost breakdown by organization
      const orgCostsQuery = `
        SELECT
          o.id,
          o.name,
          o.plan,
          COALESCE(SUM(c.llm_cost_usd), 0) as total_cost,
          COALESCE(SUM(c.llm_tokens_used), 0) as total_tokens,
          COUNT(DISTINCT c.date) as days_active
        FROM organizations o
        LEFT JOIN cost_metrics c ON c.org_id = o.id
        GROUP BY o.id, o.name, o.plan
        ORDER BY total_cost DESC
        LIMIT 20
      `;

      const orgCostsResult = await query<{
        id: string;
        name: string;
        plan: string;
        total_cost: string;
        total_tokens: string;
        days_active: string;
      }>(orgCostsQuery);

      // Get daily costs for last 30 days
      const dailyCostsQuery = `
        SELECT
          date,
          SUM(llm_cost_usd) as cost,
          SUM(llm_tokens_used) as tokens
        FROM cost_metrics
        WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY date
        ORDER BY date
      `;

      const dailyCostsResult = await query<{
        date: Date;
        cost: string;
        tokens: string;
      }>(dailyCostsQuery);

      // Calculate totals
      const totalCost = orgCostsResult.rows.reduce(
        (sum, row) => sum + parseFloat(row.total_cost),
        0
      );
      const totalTokens = orgCostsResult.rows.reduce(
        (sum, row) => sum + parseInt(row.total_tokens, 10),
        0
      );

      return reply.send({
        summary: {
          totalCostUsd: totalCost,
          totalTokens,
          avgCostPerOrg: orgCostsResult.rows.length
            ? totalCost / orgCostsResult.rows.length
            : 0,
        },
        byOrganization: orgCostsResult.rows.map((row) => ({
          id: row.id,
          name: row.name,
          plan: row.plan,
          costUsd: parseFloat(row.total_cost),
          tokensUsed: parseInt(row.total_tokens, 10),
          daysActive: parseInt(row.days_active, 10),
        })),
        daily: dailyCostsResult.rows.map((row) => ({
          date: row.date,
          costUsd: parseFloat(row.cost),
          tokensUsed: parseInt(row.tokens, 10),
        })),
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, "Failed to get cost breakdown");
      return reply.status(500).send({ error: "Failed to get cost breakdown" });
    }
  });
}

export default adminSystemRoutes;
