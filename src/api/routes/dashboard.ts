import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { query } from "../../db/client.js";

// ============================================
// Request/Response Schemas
// ============================================

const recentEventsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 5))
    .pipe(z.number().min(1).max(20)),
});

type RecentEventsQuery = z.infer<typeof recentEventsQuerySchema>;

// ============================================
// Response Types
// ============================================

interface DashboardStats {
  totalEvents: number;
  eventsChange: number;
  resolvedRCAs: number;
  resolvedChange: number;
  avgResolutionTime: number;
  resolutionTimeChange: number;
  pendingAnalysis: number;
}

interface RecentEvent {
  id: string;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  rcaId?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Calculate severity based on error type and context
 * Deterministic rules-based classification
 */
function calculateSeverity(
  errorType?: string,
  environment?: string
): "low" | "medium" | "high" | "critical" {
  // Critical: Unhandled exceptions in production
  if (
    environment === "production" &&
    (errorType?.includes("Unhandled") || errorType?.includes("Fatal"))
  ) {
    return "critical";
  }

  // High: Type errors, reference errors in production
  if (
    environment === "production" &&
    (errorType === "TypeError" ||
      errorType === "ReferenceError" ||
      errorType === "RangeError")
  ) {
    return "high";
  }

  // Medium: Syntax errors, network errors
  if (
    errorType === "SyntaxError" ||
    errorType === "NetworkError" ||
    errorType?.includes("Connection")
  ) {
    return "medium";
  }

  // Default to low for unknown/other
  return "low";
}

/**
 * Map RCA job status to user-friendly status
 */
function mapJobStatus(
  jobStatus?: string
): "pending" | "processing" | "completed" | "failed" {
  if (!jobStatus) return "pending";

  switch (jobStatus) {
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "pending":
      return "pending";
    case "fetching_code":
    case "analyzing":
    case "deterministic_complete":
    case "reasoning":
      return "processing";
    default:
      return "pending";
  }
}

// ============================================
// Route Handlers
// ============================================

/**
 * GET /api/dashboard/stats
 *
 * Returns aggregated statistics for the dashboard
 * - Total events (current period)
 * - Events change from previous period
 * - Resolved RCAs count
 * - Average resolution time
 * - Pending analysis count
 */
async function getStatsHandler(
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
    // Calculate date ranges (current week vs previous week)
    const now = new Date();
    const currentWeekStart = new Date(now);
    currentWeekStart.setDate(now.getDate() - 7);

    const previousWeekStart = new Date(currentWeekStart);
    previousWeekStart.setDate(currentWeekStart.getDate() - 7);

    // Get total events for current period
    const currentEventsResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM events
       WHERE org_id = $1
         AND created_at >= $2`,
      [orgId, currentWeekStart.toISOString()]
    );
    const totalEvents = parseInt(currentEventsResult.rows[0]?.count || "0", 10);

    // Get events from previous period for comparison
    const previousEventsResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM events
       WHERE org_id = $1
         AND created_at >= $2
         AND created_at < $3`,
      [orgId, previousWeekStart.toISOString(), currentWeekStart.toISOString()]
    );
    const previousEvents = parseInt(
      previousEventsResult.rows[0]?.count || "0",
      10
    );

    // Calculate events change percentage
    const eventsChange =
      previousEvents > 0
        ? Math.round(((totalEvents - previousEvents) / previousEvents) * 100)
        : totalEvents > 0
          ? 100
          : 0;

    // Get resolved RCAs (completed jobs)
    const resolvedResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM rca_jobs
       WHERE org_id = $1
         AND status = 'done'
         AND created_at >= $2`,
      [orgId, currentWeekStart.toISOString()]
    );
    const resolvedRCAs = parseInt(resolvedResult.rows[0]?.count || "0", 10);

    // Get previous period resolved for comparison
    const previousResolvedResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM rca_jobs
       WHERE org_id = $1
         AND status = 'done'
         AND created_at >= $2
         AND created_at < $3`,
      [orgId, previousWeekStart.toISOString(), currentWeekStart.toISOString()]
    );
    const previousResolved = parseInt(
      previousResolvedResult.rows[0]?.count || "0",
      10
    );

    const resolvedChange =
      previousResolved > 0
        ? Math.round(
            ((resolvedRCAs - previousResolved) / previousResolved) * 100
          )
        : resolvedRCAs > 0
          ? 100
          : 0;

    // Get average resolution time (in minutes)
    const avgTimeResult = await query<{ avg_minutes: string | null }>(
      `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) as avg_minutes
       FROM rca_jobs
       WHERE org_id = $1
         AND status = 'done'
         AND started_at IS NOT NULL
         AND completed_at IS NOT NULL
         AND created_at >= $2`,
      [orgId, currentWeekStart.toISOString()]
    );
    const avgResolutionTime = Math.round(
      parseFloat(avgTimeResult.rows[0]?.avg_minutes || "0")
    );

    // Get previous period avg time for comparison
    const previousAvgTimeResult = await query<{ avg_minutes: string | null }>(
      `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) as avg_minutes
       FROM rca_jobs
       WHERE org_id = $1
         AND status = 'done'
         AND started_at IS NOT NULL
         AND completed_at IS NOT NULL
         AND created_at >= $2
         AND created_at < $3`,
      [orgId, previousWeekStart.toISOString(), currentWeekStart.toISOString()]
    );
    const previousAvgTime = parseFloat(
      previousAvgTimeResult.rows[0]?.avg_minutes || "0"
    );

    // Resolution time change (negative is good - faster)
    const resolutionTimeChange =
      previousAvgTime > 0
        ? Math.round(
            ((avgResolutionTime - previousAvgTime) / previousAvgTime) * 100
          )
        : 0;

    // Get pending analysis count
    const pendingResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM rca_jobs
       WHERE org_id = $1
         AND status IN ('pending', 'fetching_code', 'analyzing', 'deterministic_complete', 'reasoning')`,
      [orgId]
    );
    const pendingAnalysis = parseInt(pendingResult.rows[0]?.count || "0", 10);

    const stats: DashboardStats = {
      totalEvents,
      eventsChange,
      resolvedRCAs,
      resolvedChange,
      avgResolutionTime,
      resolutionTimeChange,
      pendingAnalysis,
    };

    reply.send(stats);
  } catch (error) {
    logger.error({ error, orgId }, "Failed to fetch dashboard stats");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch dashboard statistics",
    });
  }
}

/**
 * GET /api/dashboard/recent-events
 *
 * Returns recent events with their RCA status for the dashboard widget
 */
async function getRecentEventsHandler(
  request: FastifyRequest<{ Querystring: RecentEventsQuery }>,
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

  // Validate query params
  const parseResult = recentEventsQuerySchema.safeParse(request.query);
  if (!parseResult.success) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid query parameters",
      details: parseResult.error.errors,
    });
    return;
  }

  const { limit } = parseResult.data;

  try {
    // Fetch recent events with their latest RCA job status
    const result = await query<{
      id: string;
      message: string | null;
      raw_payload: Record<string, unknown> | null;
      environment: string | null;
      created_at: Date;
      job_status: string | null;
      rca_result_id: string | null;
    }>(
      `SELECT
         e.id,
         e.message,
         e.raw_payload,
         e.environment,
         e.created_at,
         j.status as job_status,
         r.id as rca_result_id
       FROM events e
       LEFT JOIN rca_jobs j ON e.id = j.event_id AND j.org_id = e.org_id
       LEFT JOIN rca_results r ON j.id = r.job_id AND r.org_id = e.org_id
       WHERE e.org_id = $1
       ORDER BY e.created_at DESC
       LIMIT $2`,
      [orgId, limit]
    );

    const events: RecentEvent[] = result.rows.map((row) => {
      // Extract error type from raw_payload
      const payload = row.raw_payload as {
        exception?: { values?: Array<{ type?: string }> };
      } | null;
      const errorType = payload?.exception?.values?.[0]?.type;

      return {
        id: row.id,
        message: row.message || "Unknown error",
        severity: calculateSeverity(errorType, row.environment ?? undefined),
        status: mapJobStatus(row.job_status ?? undefined),
        createdAt: row.created_at.toISOString(),
        rcaId: row.rca_result_id ?? undefined,
      };
    });

    reply.send(events);
  } catch (error) {
    logger.error({ error, orgId }, "Failed to fetch recent events");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch recent events",
    });
  }
}

// ============================================
// Route Registration
// ============================================

export async function dashboardRoutes(server: FastifyInstance): Promise<void> {
  // GET /api/dashboard/stats
  server.get(
    "/dashboard/stats",
    {
      schema: {
        description: "Get dashboard statistics",
        tags: ["dashboard"],
        response: {
          200: {
            type: "object",
            properties: {
              totalEvents: { type: "number" },
              eventsChange: { type: "number" },
              resolvedRCAs: { type: "number" },
              resolvedChange: { type: "number" },
              avgResolutionTime: { type: "number" },
              resolutionTimeChange: { type: "number" },
              pendingAnalysis: { type: "number" },
            },
          },
        },
      },
    },
    getStatsHandler
  );

  // GET /api/dashboard/recent-events
  server.get(
    "/dashboard/recent-events",
    {
      schema: {
        description: "Get recent events for dashboard widget",
        tags: ["dashboard"],
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
          },
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                message: { type: "string" },
                severity: {
                  type: "string",
                  enum: ["low", "medium", "high", "critical"],
                },
                status: {
                  type: "string",
                  enum: ["pending", "processing", "completed", "failed"],
                },
                createdAt: { type: "string" },
                rcaId: { type: "string" },
              },
            },
          },
        },
      },
    },
    getRecentEventsHandler
  );
}
