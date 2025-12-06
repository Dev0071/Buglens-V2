import { randomUUID } from "crypto";
import { logger } from "../../utils/logger.js";
import { DeterministicExtractor } from "./deterministic-extractor.js";
import { LLMAssistExtractor } from "./llm-assist-extractor.js";
import { ExtractionValidator } from "./extraction-validator.js";
import { costTracker } from "../cost-tracker.js";
import {
  type ExtractionResult,
  type ExtractionStage,
  type DeterministicExtractorInput,
  type ExtractedFrame,
  extractionResultSchema,
} from "../../types/extraction.js";

/**
 * Hybrid LLM-Assisted Event Extraction Pipeline
 *
 * Three-stage pipeline that extracts code location data from Sentry events:
 *
 * Stage 1: DETERMINISTIC (handles 80% of events)
 *   - Rule-based extraction of file paths, line numbers, commit SHA
 *   - Classification of frames (user_code vs vendor)
 *   - Fast path if all data present
 *
 * Stage 2: LLM ASSIST (when Stage 1 incomplete)
 *   - Uses GPT-4o-mini to clean noise, classify frames
 *   - RESTRICTED: Can only clean/interpret, NOT invent data
 *   - Fallback to deterministic if LLM fails
 *
 * Stage 3: VALIDATION (always runs)
 *   - Verifies repo/commit/files exist in GitHub
 *   - Applies fallback strategies (branch inference, default branch)
 *   - Produces final validated extraction result
 */
export class ExtractionPipeline {
  private deterministicExtractor: DeterministicExtractor;
  private llmAssistExtractor: LLMAssistExtractor;
  private validator: ExtractionValidator;

  constructor() {
    this.deterministicExtractor = new DeterministicExtractor();
    this.llmAssistExtractor = new LLMAssistExtractor();
    this.validator = new ExtractionValidator();
  }

  /**
   * Extract code location data from a Sentry event
   */
  async extract(
    eventId: string,
    orgId: string,
    rawPayload: unknown
  ): Promise<ExtractionResult> {
    const extractionId = randomUUID();
    const startTime = Date.now();
    const stagesUsed: ExtractionStage[] = [];
    const issues: string[] = [];

    logger.info(
      { extractionId, eventId, orgId },
      "Starting extraction pipeline"
    );

    try {
      // =================================================================
      // STAGE 1: Deterministic Extraction
      // =================================================================
      stagesUsed.push("stage_1_deterministic");

      const stage1Input: DeterministicExtractorInput = {
        event_id: eventId,
        org_id: orgId,
        raw_payload: rawPayload,
      };

      const stage1Output =
        await this.deterministicExtractor.extract(stage1Input);

      logger.debug(
        {
          extractionId,
          isComplete: stage1Output.is_complete,
          missingFields: stage1Output.missing_fields,
          framesCount: stage1Output.frames.length,
        },
        "Stage 1 complete"
      );

      // Track issues from Stage 1
      if (stage1Output.missing_fields.length > 0) {
        issues.push(`Missing: ${stage1Output.missing_fields.join(", ")}`);
      }

      // =================================================================
      // STAGE 2: LLM Assist (conditional)
      // =================================================================
      let frames = stage1Output.frames;
      let llmTokensUsed = 0;

      const shouldUseLLM =
        this.llmAssistExtractor.shouldTriggerLLM(stage1Output);

      if (shouldUseLLM) {
        stagesUsed.push("stage_2_llm_assist");

        logger.debug({ extractionId }, "Triggering Stage 2 LLM assist");

        // Extract raw frames from payload for LLM
        const rawFrames = this.extractRawFrames(rawPayload);

        const stage2Output = await this.llmAssistExtractor.extract(
          stage1Output,
          rawFrames,
          { repo_languages: ["javascript", "typescript"] }
        );

        frames = stage2Output.frames;
        llmTokensUsed = stage2Output.tokens_used;

        if (stage2Output.suggested_branch && !stage1Output.branch) {
          stage1Output.branch = stage2Output.suggested_branch;
        }

        logger.debug(
          {
            extractionId,
            tokensUsed: llmTokensUsed,
            cleanedFrames: stage2Output.cleaned_frames_count,
            removedNoise: stage2Output.removed_noise_count,
          },
          "Stage 2 complete"
        );
      }

      // =================================================================
      // STAGE 3: Validation
      // =================================================================
      stagesUsed.push("stage_3_validation");

      const validationResult = await this.validator.validate({
        org_id: orgId,
        repo: stage1Output.repo,
        commit_sha: stage1Output.commit_sha,
        branch: stage1Output.branch,
        frames,
      });

      // Track validation issues
      const failedChecks = validationResult.checks.filter((c) => !c.passed);
      for (const check of failedChecks) {
        issues.push(`${check.check}: ${check.message || "failed"}`);
      }

      logger.debug(
        {
          extractionId,
          allPassed: validationResult.all_passed,
          fallbacksUsed: validationResult.fallbacks_used,
          validatedFrames: validationResult.frames.length,
        },
        "Stage 3 complete"
      );

      // =================================================================
      // BUILD FINAL RESULT
      // =================================================================
      const extractionMs = Date.now() - startTime;
      const finalStage: ExtractionStage = stagesUsed[stagesUsed.length - 1];

      // Calculate confidence
      const confidence = this.calculateConfidence(
        stage1Output,
        validationResult,
        llmTokensUsed > 0
      );

      const isComplete =
        !!validationResult.repo &&
        validationResult.frames.length > 0 &&
        !!validationResult.primary_frame;

      const result: ExtractionResult = {
        extraction_id: extractionId,
        event_id: eventId,
        org_id: orgId,
        pipeline_version: "1.0.0",
        extraction_stage: finalStage,
        stages_used: stagesUsed,
        repo: validationResult.repo,
        commit_sha: validationResult.commit_sha,
        branch: validationResult.branch,
        release_tag: stage1Output.release_tag,
        frames: validationResult.frames,
        primary_frame: validationResult.primary_frame,
        error_type: stage1Output.error_type,
        error_message: stage1Output.error_message,
        platform: stage1Output.platform || "javascript",
        environment: stage1Output.environment || "production",
        confidence,
        issues,
        is_complete: isComplete,
        extraction_ms: extractionMs,
        created_at: new Date().toISOString(),
      };

      // Validate final result
      const validated = extractionResultSchema.safeParse(result);
      if (!validated.success) {
        logger.warn(
          { errors: validated.error.issues },
          "Extraction result validation failed"
        );
      }

      // Record extraction metrics (async, non-blocking)
      costTracker
        .recordExtraction({
          org_id: orgId,
          stage_reached: stagesUsed.includes("stage_2_llm_assist") ? 2 : 1,
          is_complete: isComplete,
          extraction_ms: extractionMs,
          llm_tokens_used: llmTokensUsed,
          validation_passed: validationResult.all_passed,
        })
        .catch((err) => {
          logger.warn({ err }, "Failed to record extraction metrics");
        });

      logger.info(
        {
          extractionId,
          eventId,
          stagesUsed,
          isComplete,
          confidence,
          framesExtracted: result.frames.length,
          llmTokensUsed,
          extractionMs,
        },
        "Extraction pipeline complete"
      );

      return result;
    } catch (error) {
      logger.error(
        { error, extractionId, eventId },
        "Extraction pipeline failed"
      );

      // Return error result
      return {
        extraction_id: extractionId,
        event_id: eventId,
        org_id: orgId,
        pipeline_version: "1.0.0",
        extraction_stage:
          stagesUsed[stagesUsed.length - 1] || "stage_1_deterministic",
        stages_used: stagesUsed,
        repo: null,
        commit_sha: null,
        branch: null,
        release_tag: null,
        frames: [],
        primary_frame: null,
        error_type: null,
        error_message: null,
        platform: "javascript",
        environment: "production",
        confidence: 0,
        issues: [`Pipeline error: ${(error as Error).message}`],
        is_complete: false,
        extraction_ms: Date.now() - startTime,
        created_at: new Date().toISOString(),
      };
    }
  }

  /**
   * Extract raw frames from Sentry payload for LLM processing
   */
  private extractRawFrames(payload: unknown): unknown[] {
    const frames: unknown[] = [];

    try {
      const event = payload as Record<string, unknown>;
      const exception = event.exception as {
        values?: Array<Record<string, unknown>>;
      };

      if (!exception?.values) return frames;

      for (const value of exception.values) {
        const stacktrace = value.stacktrace as { frames?: unknown[] };
        if (stacktrace?.frames) {
          frames.push(...stacktrace.frames);
        }
      }
    } catch {
      // Ignore parse errors
    }

    return frames;
  }

  /**
   * Calculate confidence score based on extraction quality
   */
  private calculateConfidence(
    stage1Output: { is_complete: boolean; frames: ExtractedFrame[] },
    validationResult: {
      all_passed: boolean;
      fallbacks_used: number;
      frames: ExtractedFrame[];
    },
    usedLLM: boolean
  ): number {
    let confidence = 0;

    // Base confidence from Stage 1 completeness
    if (stage1Output.is_complete) {
      confidence += 0.4;
    } else {
      confidence += 0.2;
    }

    // Bonus for validation passing
    if (validationResult.all_passed) {
      confidence += 0.3;
    } else {
      confidence += 0.1;
    }

    // Penalty for fallbacks used
    confidence -= validationResult.fallbacks_used * 0.05;

    // Bonus for having validated frames
    if (validationResult.frames.length > 0) {
      confidence += 0.2;
    }

    // Small bonus for having primary frame
    const hasPrimary = validationResult.frames.some((f) => f.is_entry_point);
    if (hasPrimary) {
      confidence += 0.1;
    }

    // LLM assist slightly reduces confidence (deterministic is more reliable)
    if (usedLLM) {
      confidence -= 0.05;
    }

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, confidence));
  }
}
