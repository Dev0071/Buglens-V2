/**
 * LLM Service for RCA Generation
 *
 * TypeScript wrapper for Python LLM orchestrator that:
 * - Manages quota checks before expensive operations
 * - Tracks costs in real-time
 * - Handles timeouts and retries
 * - Provides deterministic fallback
 *
 * @module services/llm-service
 */

import { PythonBridge } from "./python-bridge.js";
import { CostTracker } from "./cost-tracker.js";
import { logger } from "../utils/logger.js";
import { config } from "../utils/config.js";
import { RATE_LIMITS } from "../utils/rate-limits.js";
import type { EvidenceBundle } from "../types/evidence.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Causal chain step in RCA
 */
export interface CausalStep {
  step: string;
  evidence: string;
  confidence: number;
}

/**
 * Suggested fix from RCA
 */
export interface SuggestedFix {
  description: string;
  file_path?: string;
  patch_description?: string;
}

/**
 * Test intention from RCA
 */
export interface TestIntention {
  description: string;
  rationale: string;
}

/**
 * RCA response from LLM
 */
export interface RCAResponse {
  title: string;
  summary: string;
  root_cause: string;
  causal_chain: CausalStep[];
  suggested_fix?: SuggestedFix;
  test_intentions?: TestIntention[];
  confidence: number;
  // Metadata
  llm_model?: string;
  llm_tokens_used?: number;
  llm_input_tokens?: number;
  llm_output_tokens?: number;
  llm_cost_usd?: number;
}

/**
 * Result from LLM orchestrator
 */
export interface LLMOrchestratorResult {
  success: boolean;
  rca: RCAResponse | null;
  error: string | null;
  llm_model: string;
  llm_tokens_used: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  llm_cost_usd: number;
  processing_time_ms: number;
  validation_passed: boolean;
  validation_errors: string[];
  used_fallback: boolean;
}

/**
 * Configuration for LLM service
 */
export interface LLMServiceConfig {
  timeoutMs: number;
  maxRetries: number;
  checkQuotaBeforeCall: boolean;
}

const DEFAULT_CONFIG: LLMServiceConfig = {
  timeoutMs: config.PYTHON_LLM_TIMEOUT_MS,
  maxRetries: 2,
  checkQuotaBeforeCall: true,
};

// =============================================================================
// QUOTA ERRORS
// =============================================================================

/**
 * Error thrown when org exceeds LLM quota
 */
export class QuotaExceededError extends Error {
  public readonly orgId: string;
  public readonly currentUsage: number;
  public readonly maxAllowed: number;

  constructor(orgId: string, currentUsage: number, maxAllowed: number) {
    super(
      `LLM token quota exceeded for org ${orgId}: ${currentUsage}/${maxAllowed}`
    );
    this.name = "QuotaExceededError";
    this.orgId = orgId;
    this.currentUsage = currentUsage;
    this.maxAllowed = maxAllowed;
  }
}

// =============================================================================
// LLM SERVICE
// =============================================================================

/**
 * Service for LLM-based RCA generation
 *
 * Uses Python orchestrator for actual LLM calls, but handles:
 * - Quota management (rate limits per org)
 * - Cost tracking
 * - Timeout management
 * - Error handling
 */
export class LLMService {
  private readonly pythonBridge: PythonBridge;
  private readonly costTracker: CostTracker;
  private readonly config: LLMServiceConfig;

  constructor(
    deps: {
      pythonBridge?: PythonBridge;
      costTracker?: CostTracker;
      config?: Partial<LLMServiceConfig>;
    } = {}
  ) {
    this.pythonBridge =
      deps.pythonBridge ??
      new PythonBridge({
        module: "llm",
        timeoutMs: deps.config?.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
      });
    this.costTracker = deps.costTracker ?? new CostTracker();
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
  }

  /**
   * Generate RCA from evidence bundle
   *
   * @param params - Parameters for RCA generation
   * @returns RCA result with metadata
   */
  async generateRCA(params: {
    orgId: string;
    eventId: string;
    jobId: string;
    evidence: EvidenceBundle;
    orgPlan?: "free" | "pro" | "enterprise";
  }): Promise<LLMOrchestratorResult> {
    const { orgId, eventId, jobId, evidence, orgPlan = "free" } = params;
    const startTime = Date.now();

    logger.info({ orgId, eventId, jobId }, "Starting LLM RCA generation");

    // Check quota before expensive operation
    if (this.config.checkQuotaBeforeCall) {
      await this.checkQuota(orgId, orgPlan);
    }

    try {
      // Call Python orchestrator
      const result = await this.pythonBridge.execute<
        Record<string, unknown>,
        LLMOrchestratorResult
      >(evidence as unknown as Record<string, unknown>);

      // Track costs
      if (result.llm_tokens_used > 0) {
        await this.costTracker.recordLLMUsage(
          orgId,
          result.llm_tokens_used,
          result.llm_input_tokens,
          result.llm_output_tokens
        );
      }

      const totalTime = Date.now() - startTime;

      logger.info(
        {
          orgId,
          eventId,
          jobId,
          success: result.success,
          tokens: result.llm_tokens_used,
          cost: result.llm_cost_usd.toFixed(6),
          usedFallback: result.used_fallback,
          processingMs: totalTime,
        },
        "LLM RCA generation completed"
      );

      return {
        ...result,
        processing_time_ms: totalTime,
      };
    } catch (error) {
      const totalTime = Date.now() - startTime;

      logger.error(
        {
          orgId,
          eventId,
          jobId,
          error: error instanceof Error ? error.message : String(error),
          processingMs: totalTime,
        },
        "LLM RCA generation failed"
      );

      // Return error result
      return {
        success: false,
        rca: null,
        error: error instanceof Error ? error.message : String(error),
        llm_model: "error",
        llm_tokens_used: 0,
        llm_input_tokens: 0,
        llm_output_tokens: 0,
        llm_cost_usd: 0,
        processing_time_ms: totalTime,
        validation_passed: false,
        validation_errors: [
          error instanceof Error ? error.message : String(error),
        ],
        used_fallback: false,
      };
    }
  }

  /**
   * Check if org has remaining LLM quota
   *
   * @throws QuotaExceededError if quota is exceeded
   */
  private async checkQuota(
    orgId: string,
    orgPlan: "free" | "pro" | "enterprise"
  ): Promise<void> {
    const limits = RATE_LIMITS[orgPlan];
    const usage = await this.costTracker.getDailyLLMTokens(orgId);

    if (usage >= limits.llm_tokens_per_day) {
      logger.warn(
        { orgId, orgPlan, usage, limit: limits.llm_tokens_per_day },
        "LLM token quota exceeded"
      );
      throw new QuotaExceededError(orgId, usage, limits.llm_tokens_per_day);
    }

    // Log warning if approaching limit
    const usagePercent = (usage / limits.llm_tokens_per_day) * 100;
    if (usagePercent > 80) {
      logger.warn(
        {
          orgId,
          orgPlan,
          usage,
          limit: limits.llm_tokens_per_day,
          percent: usagePercent.toFixed(1),
        },
        "LLM token usage approaching daily limit"
      );
    }
  }

  /**
   * Get estimated cost for an RCA request
   *
   * Useful for displaying cost estimates in UI before processing.
   */
  estimateCost(evidenceSize: number): {
    estimatedTokens: number;
    estimatedCost: number;
  } {
    // Rough estimation: ~4 characters per token
    // Plus ~500 tokens for system prompt and response overhead
    const estimatedTokens = Math.ceil(evidenceSize / 4) + 500;

    // GPT-4o-mini pricing
    const inputCost = estimatedTokens * 0.5 * 0.00000015; // 50% input
    const outputCost = estimatedTokens * 0.5 * 0.0000006; // 50% output

    return {
      estimatedTokens,
      estimatedCost: inputCost + outputCost,
    };
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

let defaultService: LLMService | null = null;

/**
 * Get or create default LLM service instance
 */
export function getLLMService(): LLMService {
  if (!defaultService) {
    defaultService = new LLMService();
  }
  return defaultService;
}

/**
 * Reset default service (for testing)
 */
export function resetLLMService(): void {
  defaultService = null;
}
