import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { query } from "../../db/client.js";

// ============================================
// Request/Response Schemas
// ============================================

const dailyCostsQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

type DailyCostsQuery = z.infer<typeof dailyCostsQuerySchema>;

// ============================================
// Response Types
// ============================================

interface CostSummary {
  currentMonth: {
    totalCost: number;
    llmCost: number;
    tokenCount: number;
    eventsProcessed: number;
    avgCostPerRCA: number;
  };
  previousMonth: {
    totalCost: number;
    llmCost: number;
    tokenCount: number;
    eventsProcessed: number;
  };
  costChange: number;
  projectedMonthlyCost: number;
  dailyMetrics: DailyMetric[];
}

interface DailyMetric {
  date: string;
  llmCost: number;
  tokenCount: number;
  eventsProcessed: number;
  rcasCompleted: number;
}

// ============================================
// Helper Functions
// ============================================

// Note: calculateLLMCost available for future use when storing calculated costs
// Cost per 1000 tokens for GPT-4o-mini:
// Input: $0.00015/1K tokens, Output: $0.0006/1K tokens
// Estimate ~60% input, 40% output

// ============================================
// Route Handlers
// ============================================

/**
 * GET /api/costs/summary
 *
 * Returns cost summary for the organization
 */
async function getCostSummaryHandler(
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
    // Calculate date ranges
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1
    );
    const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Get current month metrics from cost_metrics table
    const currentMetricsResult = await query<{
      total_tokens: string | null;
      total_llm_cost: string | null;
    }>(
      `SELECT
         COALESCE(SUM(llm_tokens_used), 0) as total_tokens,
         COALESCE(SUM(llm_cost_usd), 0) as total_llm_cost
       FROM cost_metrics
       WHERE org_id = $1 AND date >= $2`,
      [orgId, currentMonthStart.toISOString().split("T")[0]]
    );

    const currentTokens = parseInt(
      currentMetricsResult.rows[0]?.total_tokens || "0",
      10
    );
    const currentLLMCost = parseFloat(
      currentMetricsResult.rows[0]?.total_llm_cost || "0"
    );

    // Get current month events processed
    const currentEventsResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM events
       WHERE org_id = $1 AND created_at >= $2`,
      [orgId, currentMonthStart.toISOString()]
    );
    const currentEventsProcessed = parseInt(
      currentEventsResult.rows[0]?.count || "0",
      10
    );

    // Get current month RCAs completed
    const currentRCAsResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM rca_jobs
       WHERE org_id = $1 AND status = 'done' AND created_at >= $2`,
      [orgId, currentMonthStart.toISOString()]
    );
    const currentRCAs = parseInt(currentRCAsResult.rows[0]?.count || "0", 10);

    // Get previous month metrics
    const previousMetricsResult = await query<{
      total_tokens: string | null;
      total_llm_cost: string | null;
    }>(
      `SELECT
         COALESCE(SUM(llm_tokens_used), 0) as total_tokens,
         COALESCE(SUM(llm_cost_usd), 0) as total_llm_cost
       FROM cost_metrics
       WHERE org_id = $1 AND date >= $2 AND date <= $3`,
      [
        orgId,
        previousMonthStart.toISOString().split("T")[0],
        previousMonthEnd.toISOString().split("T")[0],
      ]
    );

    const previousTokens = parseInt(
      previousMetricsResult.rows[0]?.total_tokens || "0",
      10
    );
    const previousLLMCost = parseFloat(
      previousMetricsResult.rows[0]?.total_llm_cost || "0"
    );

    // Get previous month events
    const previousEventsResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM events
       WHERE org_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [orgId, previousMonthStart.toISOString(), previousMonthEnd.toISOString()]
    );
    const previousEventsProcessed = parseInt(
      previousEventsResult.rows[0]?.count || "0",
      10
    );

    // Calculate cost change percentage
    const costChange =
      previousLLMCost > 0
        ? Math.round(
            ((currentLLMCost - previousLLMCost) / previousLLMCost) * 100
          )
        : currentLLMCost > 0
          ? 100
          : 0;

    // Calculate projected monthly cost based on current usage rate
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0
    ).getDate();
    const daysElapsed = now.getDate();
    const projectedMonthlyCost =
      daysElapsed > 0
        ? Math.round((currentLLMCost / daysElapsed) * daysInMonth * 100) / 100
        : 0;

    // Calculate average cost per RCA
    const avgCostPerRCA =
      currentRCAs > 0
        ? Math.round((currentLLMCost / currentRCAs) * 10000) / 10000
        : 0;

    // Get daily metrics for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyMetricsResult = await query<{
      date: Date;
      llm_tokens_used: number;
      llm_cost_usd: string;
      events_count: string;
      rcas_count: string;
    }>(
      `SELECT
         cm.date,
         cm.llm_tokens_used,
         cm.llm_cost_usd,
         COALESCE(e.events_count, 0) as events_count,
         COALESCE(r.rcas_count, 0) as rcas_count
       FROM cost_metrics cm
       LEFT JOIN LATERAL (
         SELECT COUNT(*) as events_count
         FROM events
         WHERE org_id = cm.org_id AND DATE(created_at) = cm.date
       ) e ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) as rcas_count
         FROM rca_jobs
         WHERE org_id = cm.org_id AND status = 'done' AND DATE(created_at) = cm.date
       ) r ON true
       WHERE cm.org_id = $1 AND cm.date >= $2
       ORDER BY cm.date DESC
       LIMIT 30`,
      [orgId, thirtyDaysAgo.toISOString().split("T")[0]]
    );

    const dailyMetrics: DailyMetric[] = dailyMetricsResult.rows.map((row) => ({
      date: row.date.toISOString().split("T")[0],
      llmCost: parseFloat(row.llm_cost_usd) || 0,
      tokenCount: row.llm_tokens_used || 0,
      eventsProcessed: parseInt(row.events_count, 10) || 0,
      rcasCompleted: parseInt(row.rcas_count, 10) || 0,
    }));

    const response: CostSummary = {
      currentMonth: {
        totalCost: Math.round(currentLLMCost * 100) / 100,
        llmCost: Math.round(currentLLMCost * 100) / 100,
        tokenCount: currentTokens,
        eventsProcessed: currentEventsProcessed,
        avgCostPerRCA,
      },
      previousMonth: {
        totalCost: Math.round(previousLLMCost * 100) / 100,
        llmCost: Math.round(previousLLMCost * 100) / 100,
        tokenCount: previousTokens,
        eventsProcessed: previousEventsProcessed,
      },
      costChange,
      projectedMonthlyCost,
      dailyMetrics,
    };

    reply.send(response);
  } catch (error) {
    logger.error({ error, orgId }, "Failed to fetch cost summary");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch cost summary",
    });
  }
}

/**
 * GET /api/costs/daily
 *
 * Returns daily cost breakdown for a date range
 */
async function getDailyCostsHandler(
  request: FastifyRequest<{ Querystring: DailyCostsQuery }>,
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
  const parseResult = dailyCostsQuerySchema.safeParse(request.query);
  if (!parseResult.success) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid query parameters",
      details: parseResult.error.errors,
    });
    return;
  }

  const { startDate, endDate } = parseResult.data;

  // Default to last 30 days if not specified
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate
    ? new Date(startDate)
    : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Validate date range (max 90 days)
  const maxDays = 90;
  const daysDiff = Math.ceil(
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysDiff > maxDays) {
    reply.status(400).send({
      error: "Bad Request",
      message: `Date range cannot exceed ${maxDays} days`,
    });
    return;
  }

  if (start > end) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Start date must be before end date",
    });
    return;
  }

  try {
    const result = await query<{
      date: Date;
      llm_tokens_used: number;
      llm_cost_usd: string;
      github_api_calls: number;
    }>(
      `SELECT date, llm_tokens_used, llm_cost_usd, github_api_calls
       FROM cost_metrics
       WHERE org_id = $1 AND date >= $2 AND date <= $3
       ORDER BY date ASC`,
      [
        orgId,
        start.toISOString().split("T")[0],
        end.toISOString().split("T")[0],
      ]
    );

    const metrics = result.rows.map((row) => ({
      date: row.date.toISOString().split("T")[0],
      llmTokens: row.llm_tokens_used,
      llmCost: parseFloat(row.llm_cost_usd) || 0,
      githubApiCalls: row.github_api_calls,
    }));

    // Calculate totals
    const totals = metrics.reduce(
      (acc, m) => ({
        llmTokens: acc.llmTokens + m.llmTokens,
        llmCost: acc.llmCost + m.llmCost,
        githubApiCalls: acc.githubApiCalls + m.githubApiCalls,
      }),
      { llmTokens: 0, llmCost: 0, githubApiCalls: 0 }
    );

    reply.send({
      startDate: start.toISOString().split("T")[0],
      endDate: end.toISOString().split("T")[0],
      metrics,
      totals: {
        ...totals,
        llmCost: Math.round(totals.llmCost * 100) / 100,
      },
    });
  } catch (error) {
    logger.error({ error, orgId }, "Failed to fetch daily costs");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch daily costs",
    });
  }
}

// ============================================
// Route Registration
// ============================================

export async function costsRoutes(server: FastifyInstance): Promise<void> {
  // GET /api/costs/summary
  server.get("/costs/summary", getCostSummaryHandler);

  // GET /api/costs/daily
  server.get(
    "/costs/daily",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
        },
      },
    },
    getDailyCostsHandler
  );
}
