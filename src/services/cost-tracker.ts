/**
 * Cost and metrics tracking service
 *
 * Tracks extraction metrics, LLM usage, GitHub API calls per organization.
 * Updates cost_metrics table with daily aggregated data.
 *
 * Critical for:
 * - Rate limiting enforcement (quotas per org plan)
 * - Cost attribution (per-customer billing)
 * - Performance monitoring (latency, success rates)
 */

import { query } from "../db/client.js";
import { logger } from "../utils/logger.js";

// =============================================================================
// TYPES
// =============================================================================

interface DailyMetrics {
  org_id: string;
  date: string; // YYYY-MM-DD

  // Extraction stage counts
  stage_1_count: number;
  stage_2_count: number;
  stage_3_failures: number;

  // LLM usage
  llm_tokens_used: number;
  llm_cost_usd: number;

  // API usage
  github_api_calls: number;

  // Quality metrics
  complete_extractions: number;
  incomplete_extractions: number;
  extraction_avg_ms: number;
  extraction_total_ms: number; // For computing average
}

interface ExtractionMetricsUpdate {
  org_id: string;
  stage_reached: 1 | 2; // Which stage completed the extraction
  is_complete: boolean;
  extraction_ms: number;
  llm_tokens_used?: number;
  /** Actual input tokens from LLM API response.usage.prompt_tokens */
  llm_input_tokens?: number;
  /** Actual output tokens from LLM API response.usage.completion_tokens */
  llm_output_tokens?: number;
  validation_passed: boolean;
}

// =============================================================================
// LLM PRICING CONFIGURATION
// =============================================================================

/**
 * GPT-4o-mini pricing per token (as of Dec 2024)
 * Source: https://openai.com/pricing
 *
 * Make these environment-configurable for easy updates when pricing changes.
 */
const LLM_PRICING = {
  // GPT-4o-mini: $0.15 per 1M input tokens, $0.60 per 1M output tokens
  input_per_token: parseFloat(
    process.env.LLM_INPUT_PRICE_PER_TOKEN || "0.00000015"
  ),
  output_per_token: parseFloat(
    process.env.LLM_OUTPUT_PRICE_PER_TOKEN || "0.0000006"
  ),
  // Fallback ratio when actual input/output breakdown not available
  // Based on typical extraction prompts: ~70% input, ~30% output
  fallback_input_ratio: 0.7,
  fallback_output_ratio: 0.3,
} as const;

/**
 * Calculate LLM cost from token usage
 *
 * Prefers actual input/output token counts from API response.
 * Falls back to estimated ratio when only total tokens available.
 */
function calculateLLMCost(
  totalTokens: number,
  inputTokens?: number,
  outputTokens?: number
): number {
  if (inputTokens !== undefined && outputTokens !== undefined) {
    // Use actual token breakdown from API response
    return (
      inputTokens * LLM_PRICING.input_per_token +
      outputTokens * LLM_PRICING.output_per_token
    );
  }

  // Fallback to estimated ratio when actual breakdown not available
  // Log this for monitoring - we should aim to always have actual counts
  logger.debug(
    { totalTokens },
    "Using estimated token ratio - consider updating caller to pass actual input/output counts"
  );

  return (
    totalTokens *
      LLM_PRICING.fallback_input_ratio *
      LLM_PRICING.input_per_token +
    totalTokens *
      LLM_PRICING.fallback_output_ratio *
      LLM_PRICING.output_per_token
  );
}

// =============================================================================
// COST TRACKER SERVICE
// =============================================================================

export class CostTracker {
  /**
   * Record metrics from a completed extraction
   */
  async recordExtraction(metrics: ExtractionMetricsUpdate): Promise<void> {
    const date = this.getDateString();
    const {
      org_id,
      stage_reached,
      is_complete,
      extraction_ms,
      llm_tokens_used,
      llm_input_tokens,
      llm_output_tokens,
      validation_passed,
    } = metrics;

    try {
      // Calculate LLM cost using actual token counts when available
      const llm_cost_usd = llm_tokens_used
        ? calculateLLMCost(llm_tokens_used, llm_input_tokens, llm_output_tokens)
        : 0;

      await query(
        `INSERT INTO cost_metrics (
          org_id, date,
          llm_tokens_used, llm_cost_usd,
          github_api_calls, s3_storage_gb
        ) VALUES ($1, $2, $3, $4, 0, 0)
        ON CONFLICT (org_id, date) DO UPDATE SET
          llm_tokens_used = cost_metrics.llm_tokens_used + EXCLUDED.llm_tokens_used,
          llm_cost_usd = cost_metrics.llm_cost_usd + EXCLUDED.llm_cost_usd`,
        [org_id, date, llm_tokens_used ?? 0, llm_cost_usd]
      );

      // Log extraction metrics for monitoring
      logger.debug(
        {
          org_id,
          date,
          stage_reached,
          is_complete,
          extraction_ms,
          llm_tokens_used,
          llm_cost_usd: llm_cost_usd.toFixed(6),
          validation_passed,
        },
        "Extraction metrics recorded"
      );
    } catch (error) {
      logger.error(
        { error, org_id, date },
        "Failed to record extraction metrics"
      );
      // Don't throw - metrics are non-critical
    }
  }

  /**
   * Record GitHub API call
   */
  async recordGitHubAPICall(org_id: string, calls: number = 1): Promise<void> {
    const date = this.getDateString();

    try {
      await query(
        `INSERT INTO cost_metrics (org_id, date, github_api_calls, llm_tokens_used, llm_cost_usd, s3_storage_gb)
         VALUES ($1, $2, $3, 0, 0, 0)
         ON CONFLICT (org_id, date) DO UPDATE SET
           github_api_calls = cost_metrics.github_api_calls + EXCLUDED.github_api_calls`,
        [org_id, date, calls]
      );
    } catch (error) {
      logger.error({ error, org_id, date }, "Failed to record GitHub API call");
    }
  }

  /**
   * Record LLM tokens used (for non-extraction LLM calls)
   *
   * @param org_id - Organization ID
   * @param tokens - Total tokens used
   * @param inputTokens - Optional: actual input tokens from response.usage.prompt_tokens
   * @param outputTokens - Optional: actual output tokens from response.usage.completion_tokens
   */
  async recordLLMTokens(
    org_id: string,
    tokens: number,
    inputTokens?: number,
    outputTokens?: number
  ): Promise<void> {
    const date = this.getDateString();

    // Use actual token breakdown when available
    const llm_cost_usd = calculateLLMCost(tokens, inputTokens, outputTokens);

    try {
      await query(
        `INSERT INTO cost_metrics (org_id, date, llm_tokens_used, llm_cost_usd, github_api_calls, s3_storage_gb)
         VALUES ($1, $2, $3, $4, 0, 0)
         ON CONFLICT (org_id, date) DO UPDATE SET
           llm_tokens_used = cost_metrics.llm_tokens_used + EXCLUDED.llm_tokens_used,
           llm_cost_usd = cost_metrics.llm_cost_usd + EXCLUDED.llm_cost_usd`,
        [org_id, date, tokens, llm_cost_usd]
      );
    } catch (error) {
      logger.error({ error, org_id, date }, "Failed to record LLM tokens");
    }
  }

  /**
   * Get current daily metrics for an organization
   */
  async getDailyMetrics(
    org_id: string,
    date?: string
  ): Promise<DailyMetrics | null> {
    const targetDate = date ?? this.getDateString();

    try {
      const result = await query(
        `SELECT
          org_id,
          date::text,
          llm_tokens_used,
          llm_cost_usd,
          github_api_calls,
          s3_storage_gb
         FROM cost_metrics
         WHERE org_id = $1 AND date = $2`,
        [org_id, targetDate]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        org_id: row.org_id,
        date: row.date,
        stage_1_count: 0, // Not tracked in current schema
        stage_2_count: 0, // Not tracked in current schema
        stage_3_failures: 0, // Not tracked in current schema
        llm_tokens_used: row.llm_tokens_used,
        llm_cost_usd: parseFloat(row.llm_cost_usd),
        github_api_calls: row.github_api_calls,
        complete_extractions: 0, // Not tracked in current schema
        incomplete_extractions: 0, // Not tracked in current schema
        extraction_avg_ms: 0, // Not tracked in current schema
        extraction_total_ms: 0, // Not tracked in current schema
      };
    } catch (error) {
      logger.error(
        { error, org_id, date: targetDate },
        "Failed to get daily metrics"
      );
      return null;
    }
  }

  /**
   * Check if organization is within daily LLM token quota
   */
  async checkLLMQuota(
    org_id: string,
    tokensNeeded: number,
    dailyLimit: number
  ): Promise<{
    allowed: boolean;
    current: number;
    limit: number;
    remaining: number;
  }> {
    const metrics = await this.getDailyMetrics(org_id);
    const current = metrics?.llm_tokens_used ?? 0;
    const remaining = Math.max(0, dailyLimit - current);
    const allowed = remaining >= tokensNeeded;

    return { allowed, current, limit: dailyLimit, remaining };
  }

  /**
   * Check if organization is within daily GitHub API quota
   */
  async checkGitHubQuota(
    org_id: string,
    callsNeeded: number,
    dailyLimit: number
  ): Promise<{
    allowed: boolean;
    current: number;
    limit: number;
    remaining: number;
  }> {
    const metrics = await this.getDailyMetrics(org_id);
    const current = metrics?.github_api_calls ?? 0;
    const remaining = Math.max(0, dailyLimit - current);
    const allowed = remaining >= callsNeeded;

    return { allowed, current, limit: dailyLimit, remaining };
  }

  /**
   * Get monthly cost summary for an organization
   */
  async getMonthlyCostSummary(
    org_id: string,
    year: number,
    month: number
  ): Promise<{
    total_cost_usd: number;
    llm_tokens_used: number;
    github_api_calls: number;
    days_active: number;
  }> {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate =
      month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    try {
      const result = await query(
        `SELECT
          COALESCE(SUM(llm_cost_usd), 0) as total_cost_usd,
          COALESCE(SUM(llm_tokens_used), 0) as llm_tokens_used,
          COALESCE(SUM(github_api_calls), 0) as github_api_calls,
          COUNT(DISTINCT date) as days_active
         FROM cost_metrics
         WHERE org_id = $1 AND date >= $2 AND date < $3`,
        [org_id, startDate, endDate]
      );

      const row = result.rows[0];
      return {
        total_cost_usd: parseFloat(row.total_cost_usd),
        llm_tokens_used: parseInt(row.llm_tokens_used, 10),
        github_api_calls: parseInt(row.github_api_calls, 10),
        days_active: parseInt(row.days_active, 10),
      };
    } catch (error) {
      logger.error(
        { error, org_id, year, month },
        "Failed to get monthly cost summary"
      );
      return {
        total_cost_usd: 0,
        llm_tokens_used: 0,
        github_api_calls: 0,
        days_active: 0,
      };
    }
  }

  /**
   * Get today's date string in YYYY-MM-DD format
   */
  private getDateString(): string {
    return new Date().toISOString().split("T")[0];
  }
}

// Singleton instance
export const costTracker = new CostTracker();
