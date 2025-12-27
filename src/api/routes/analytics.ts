import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { query } from "../../db/client.js";

// ============================================
// Request/Response Schemas
// ============================================

const analyticsQuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
});

type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

// ============================================
// Response Types
// ============================================

interface AnalyticsSummary {
  totalCost: number;
  costChange: number;
  totalTokens: number;
  tokenChange: number;
  totalRCAs: number;
  rcaChange: number;
  avgCostPerRCA: number;
  avgTimePerRCA: number;
  roi: number;
  budgetUsed: number;
  budgetLimit: number;
  qualityBreakdown: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  };
}

interface DailyAnalytics {
  date: string;
  events: number;
  rcas: number;
  tokens: number;
  cost: number;
  avgConfidence: number;
}

// ============================================
// Helper Functions
// ============================================

function getDaysForPeriod(period: string): number {
  switch (period) {
    case "7d":
      return 7;
    case "90d":
      return 90;
    case "30d":
    default:
      return 30;
  }
}

function getBudgetLimitForPlan(plan: string): number {
  switch (plan) {
    case "enterprise":
      return 1000;
    case "pro":
      return 100;
    case "free":
    default:
      return 10;
  }
}

// ============================================
// Route Handlers
// ============================================

/**
 * GET /api/analytics/summary
 *
 * Returns analytics summary with cost, ROI, and quality metrics
 */
async function getAnalyticsSummaryHandler(
  request: FastifyRequest<{ Querystring: AnalyticsQuery }>,
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
    const period = request.query.period || "30d";
    const days = getDaysForPeriod(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split("T")[0];

    // Get previous period for comparison
    const prevStartDate = new Date();
    prevStartDate.setDate(prevStartDate.getDate() - days * 2);
    const prevEndDate = new Date();
    prevEndDate.setDate(prevEndDate.getDate() - days);
    const prevStartStr = prevStartDate.toISOString().split("T")[0];
    const prevEndStr = prevEndDate.toISOString().split("T")[0];

    // Get organization plan for budget
    const orgResult = await query<{ plan: string }>(
      "SELECT plan FROM organizations WHERE id = $1",
      [orgId]
    );
    const plan = orgResult.rows[0]?.plan || "free";
    const budgetLimit = getBudgetLimitForPlan(plan);

    // Current period metrics from cost_metrics
    const currentMetrics = await query<{
      total_tokens: string | null;
      total_cost: string | null;
    }>(
      `SELECT
         COALESCE(SUM(llm_tokens_used), 0) as total_tokens,
         COALESCE(SUM(llm_cost_usd), 0) as total_cost
       FROM cost_metrics
       WHERE org_id = $1 AND date >= $2`,
      [orgId, startDateStr]
    );

    // Previous period metrics
    const previousMetrics = await query<{
      total_tokens: string | null;
      total_cost: string | null;
    }>(
      `SELECT
         COALESCE(SUM(llm_tokens_used), 0) as total_tokens,
         COALESCE(SUM(llm_cost_usd), 0) as total_cost
       FROM cost_metrics
       WHERE org_id = $1 AND date >= $2 AND date < $3`,
      [orgId, prevStartStr, prevEndStr]
    );

    // RCA metrics
    const rcaMetrics = await query<{
      total_rcas: string;
      avg_confidence: string | null;
      high_confidence: string;
      medium_confidence: string;
      low_confidence: string;
    }>(
      `SELECT
         COUNT(*) as total_rcas,
         AVG(confidence) as avg_confidence,
         COUNT(*) FILTER (WHERE confidence >= 0.8) as high_confidence,
         COUNT(*) FILTER (WHERE confidence >= 0.6 AND confidence < 0.8) as medium_confidence,
         COUNT(*) FILTER (WHERE confidence < 0.6) as low_confidence
       FROM rca_results
       WHERE org_id = $1 AND created_at >= $2`,
      [orgId, startDate.toISOString()]
    );

    // Previous period RCA count
    const prevRcaMetrics = await query<{ total_rcas: string }>(
      `SELECT COUNT(*) as total_rcas
       FROM rca_results
       WHERE org_id = $1 AND created_at >= $2 AND created_at < $3`,
      [orgId, prevStartDate.toISOString(), prevEndDate.toISOString()]
    );

    // Average resolution time (from completed jobs)
    const timeMetrics = await query<{ avg_time_seconds: string | null }>(
      `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_time_seconds
       FROM rca_jobs
       WHERE org_id = $1
         AND status = 'done'
         AND completed_at IS NOT NULL
         AND created_at >= $2`,
      [orgId, startDate.toISOString()]
    );

    // Calculate values
    const totalTokens = parseInt(
      currentMetrics.rows[0]?.total_tokens || "0",
      10
    );
    const totalCost = parseFloat(currentMetrics.rows[0]?.total_cost || "0");
    const prevTokens = parseInt(
      previousMetrics.rows[0]?.total_tokens || "0",
      10
    );
    const prevCost = parseFloat(previousMetrics.rows[0]?.total_cost || "0");

    const totalRCAs = parseInt(rcaMetrics.rows[0]?.total_rcas || "0", 10);
    const prevRCAs = parseInt(prevRcaMetrics.rows[0]?.total_rcas || "0", 10);

    // Calculate changes (percentage)
    const costChange =
      prevCost > 0 ? ((totalCost - prevCost) / prevCost) * 100 : 0;
    const tokenChange =
      prevTokens > 0 ? ((totalTokens - prevTokens) / prevTokens) * 100 : 0;
    const rcaChange =
      prevRCAs > 0 ? ((totalRCAs - prevRCAs) / prevRCAs) * 100 : 0;

    // Calculate ROI: estimate 2 hours saved per RCA at $75/hour
    const engineerHourlyRate = 75;
    const hoursPerRCA = 2;
    const moneySaved = totalRCAs * hoursPerRCA * engineerHourlyRate;
    const roi =
      totalCost > 0 ? ((moneySaved - totalCost) / totalCost) * 100 : 0;

    const avgTimeSeconds = parseFloat(
      timeMetrics.rows[0]?.avg_time_seconds || "0"
    );
    const avgCostPerRCA = totalRCAs > 0 ? totalCost / totalRCAs : 0;

    const response: AnalyticsSummary = {
      totalCost,
      costChange,
      totalTokens,
      tokenChange,
      totalRCAs,
      rcaChange,
      avgCostPerRCA,
      avgTimePerRCA: avgTimeSeconds,
      roi,
      budgetUsed: totalCost,
      budgetLimit,
      qualityBreakdown: {
        highConfidence: parseInt(
          rcaMetrics.rows[0]?.high_confidence || "0",
          10
        ),
        mediumConfidence: parseInt(
          rcaMetrics.rows[0]?.medium_confidence || "0",
          10
        ),
        lowConfidence: parseInt(rcaMetrics.rows[0]?.low_confidence || "0", 10),
      },
    };

    reply.send(response);
  } catch (error) {
    logger.error({ error, orgId: orgId }, "Failed to fetch analytics summary");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch analytics summary",
    });
  }
}

/**
 * GET /api/analytics/daily
 *
 * Returns daily analytics data for charts
 */
async function getDailyAnalyticsHandler(
  request: FastifyRequest<{ Querystring: AnalyticsQuery }>,
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
    const period = request.query.period || "30d";
    const days = getDaysForPeriod(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split("T")[0];

    // Get daily metrics from cost_metrics table
    const dailyMetrics = await query<{
      date: string;
      llm_tokens_used: string;
      llm_cost_usd: string;
    }>(
      `SELECT
         date::text,
         COALESCE(llm_tokens_used, 0) as llm_tokens_used,
         COALESCE(llm_cost_usd, 0) as llm_cost_usd
       FROM cost_metrics
       WHERE org_id = $1 AND date >= $2
       ORDER BY date ASC`,
      [orgId, startDateStr]
    );

    // Get daily event counts
    const dailyEvents = await query<{
      date: string;
      event_count: string;
    }>(
      `SELECT
         DATE(created_at)::text as date,
         COUNT(*) as event_count
       FROM events
       WHERE org_id = $1 AND created_at >= $2
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [orgId, startDate.toISOString()]
    );

    // Get daily RCA counts with average confidence
    const dailyRcas = await query<{
      date: string;
      rca_count: string;
      avg_confidence: string | null;
    }>(
      `SELECT
         DATE(created_at)::text as date,
         COUNT(*) as rca_count,
         AVG(confidence) as avg_confidence
       FROM rca_results
       WHERE org_id = $1 AND created_at >= $2
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [orgId, startDate.toISOString()]
    );

    // Create maps for easy lookup
    const eventsByDate = new Map<string, number>();
    for (const row of dailyEvents.rows) {
      eventsByDate.set(row.date, parseInt(row.event_count, 10));
    }

    const rcaByDate = new Map<string, { count: number; confidence: number }>();
    for (const row of dailyRcas.rows) {
      rcaByDate.set(row.date, {
        count: parseInt(row.rca_count, 10),
        confidence: parseFloat(row.avg_confidence || "0"),
      });
    }

    // Build response with all dates in period
    const response: DailyAnalytics[] = [];
    const metricsMap = new Map(dailyMetrics.rows.map((m) => [m.date, m]));

    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      const dateStr = date.toISOString().split("T")[0];

      const metrics = metricsMap.get(dateStr);
      const rca = rcaByDate.get(dateStr);
      const events = eventsByDate.get(dateStr) || 0;

      response.push({
        date: dateStr,
        events,
        rcas: rca?.count || 0,
        tokens: parseInt(metrics?.llm_tokens_used || "0", 10),
        cost: parseFloat(metrics?.llm_cost_usd || "0"),
        avgConfidence: rca?.confidence || 0,
      });
    }

    reply.send(response);
  } catch (error) {
    logger.error({ error, orgId: orgId }, "Failed to fetch daily analytics");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch daily analytics",
    });
  }
}

/**
 * GET /api/analytics/rca-quality
 *
 * Returns RCA quality metrics for the last 7 days
 */
async function getRCAQualityHandler(
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
    // Get RCA quality data from last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const rcaQualityResult = await query<{
      total_rcas: string;
      high_confidence: string;
      medium_confidence: string;
      low_confidence: string;
      avg_confidence: string | null;
      avg_processing_time: string | null;
    }>(
      `SELECT
        COUNT(*) as total_rcas,
        COUNT(*) FILTER (WHERE confidence >= 0.8) as high_confidence,
        COUNT(*) FILTER (WHERE confidence >= 0.5 AND confidence < 0.8) as medium_confidence,
        COUNT(*) FILTER (WHERE confidence < 0.5) as low_confidence,
        AVG(confidence) as avg_confidence,
        AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_processing_time
      FROM rca_results
      WHERE org_id = $1
        AND created_at >= $2
        AND status = 'completed'`,
      [orgId, sevenDaysAgo.toISOString()]
    );

    const result = rcaQualityResult.rows[0] || {
      total_rcas: "0",
      high_confidence: "0",
      medium_confidence: "0",
      low_confidence: "0",
      avg_confidence: null,
      avg_processing_time: null,
    };

    const totalRCAs = parseInt(result.total_rcas, 10);
    const highConfidence = parseInt(result.high_confidence, 10);
    const mediumConfidence = parseInt(result.medium_confidence, 10);
    const lowConfidence = parseInt(result.low_confidence, 10);

    reply.send({
      period: "7d",
      totalRCAs,
      qualityBreakdown: {
        highConfidence,
        mediumConfidence,
        lowConfidence,
      },
      percentages: {
        highConfidence: totalRCAs > 0 ? (highConfidence / totalRCAs) * 100 : 0,
        mediumConfidence:
          totalRCAs > 0 ? (mediumConfidence / totalRCAs) * 100 : 0,
        lowConfidence: totalRCAs > 0 ? (lowConfidence / totalRCAs) * 100 : 0,
      },
      avgConfidence: result.avg_confidence
        ? parseFloat(result.avg_confidence)
        : 0,
      avgProcessingTime: result.avg_processing_time
        ? parseFloat(result.avg_processing_time)
        : 0,
    });

    logger.info({ orgId }, "RCA quality metrics retrieved successfully");
  } catch (error) {
    logger.error({ error, orgId }, "Failed to fetch RCA quality metrics");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch RCA quality metrics",
    });
  }
}

// ============================================
// Route Registration
// ============================================

export async function analyticsRoutes(server: FastifyInstance): Promise<void> {
  // GET /api/analytics/summary
  server.get(
    "/analytics/summary",
    {
      schema: {
        description: "Get analytics summary for the organization",
        tags: ["Analytics"],
        querystring: {
          type: "object",
          properties: {
            period: {
              type: "string",
              enum: ["7d", "30d", "90d"],
              default: "30d",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              totalCost: { type: "number" },
              costChange: { type: "number" },
              totalTokens: { type: "number" },
              tokenChange: { type: "number" },
              totalRCAs: { type: "number" },
              rcaChange: { type: "number" },
              avgCostPerRCA: { type: "number" },
              avgTimePerRCA: { type: "number" },
              roi: { type: "number" },
              budgetUsed: { type: "number" },
              budgetLimit: { type: "number" },
              qualityBreakdown: {
                type: "object",
                properties: {
                  highConfidence: { type: "number" },
                  mediumConfidence: { type: "number" },
                  lowConfidence: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    getAnalyticsSummaryHandler
  );

  // GET /api/analytics/daily
  server.get(
    "/analytics/daily",
    {
      schema: {
        description: "Get daily analytics data for charts",
        tags: ["Analytics"],
        querystring: {
          type: "object",
          properties: {
            period: {
              type: "string",
              enum: ["7d", "30d", "90d"],
              default: "30d",
            },
          },
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                date: { type: "string" },
                events: { type: "number" },
                rcas: { type: "number" },
                tokens: { type: "number" },
                cost: { type: "number" },
                avgConfidence: { type: "number" },
              },
            },
          },
        },
      },
    },
    getDailyAnalyticsHandler
  );

  // GET /api/analytics/rca-quality
  server.get(
    "/analytics/rca-quality",
    {
      schema: {
        description: "Get RCA quality metrics for the last 7 days",
        tags: ["Analytics"],
        response: {
          200: {
            type: "object",
            properties: {
              period: { type: "string" },
              totalRCAs: { type: "number" },
              qualityBreakdown: {
                type: "object",
                properties: {
                  highConfidence: { type: "number" },
                  mediumConfidence: { type: "number" },
                  lowConfidence: { type: "number" },
                },
              },
              percentages: {
                type: "object",
                properties: {
                  highConfidence: { type: "number" },
                  mediumConfidence: { type: "number" },
                  lowConfidence: { type: "number" },
                },
              },
              avgConfidence: { type: "number" },
              avgProcessingTime: { type: "number" },
            },
          },
        },
      },
    },
    getRCAQualityHandler
  );

  logger.info("Analytics routes registered");
}
