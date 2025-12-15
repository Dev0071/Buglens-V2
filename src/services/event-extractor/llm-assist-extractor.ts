import { logger } from "../../utils/logger.js";
import { PythonBridge } from "../python-bridge.js";
import {
  type LLMAssistInput,
  type LLMAssistOutput,
  type LLMAssistTask,
  type DeterministicExtractorOutput,
  llmAssistOutputSchema,
  EXTRACTION_CONFIG,
} from "../../types/extraction.js";

/**
 * Stage 2: LLM Assist Extractor
 *
 * Uses GPT-4o-mini to enhance extraction when Stage 1 is incomplete.
 * RESTRICTED SCOPE: LLM can only clean/classify, NOT invent data.
 *
 * Capabilities:
 * - Clean stacktrace noise (polyfills, bundler internals)
 * - Classify frames (user_code vs vendor)
 * - Identify root crash frame from 20-100 frames
 * - Suggest branch when missing
 */
export class LLMAssistExtractor {
  private createPythonBridge(): PythonBridge {
    // Use longer timeout for LLM operations (30s default)
    return new PythonBridge({
      module: "extractors.llm_assist_extractor",
      timeoutMs: 30000, // LLM API calls can take 10-30 seconds
    });
  }

  /**
   * Determine which LLM tasks are needed based on Stage 1 output
   */
  determineNeededTasks(
    stage1Output: DeterministicExtractorOutput
  ): LLMAssistTask[] {
    const tasks: LLMAssistTask[] = [];

    // If we have lots of frames but no clear primary, ask LLM to identify
    const userCodeFrames = stage1Output.frames.filter(
      (f) => f.classification === "user_code"
    );
    const hasAmbiguousPrimary = userCodeFrames.length > 3;

    // If many frames, clean noise
    if (stage1Output.frames.length > 10) {
      tasks.push("clean_stacktrace_noise");
    }

    // If frames have unknown classification
    const unknownFrames = stage1Output.frames.filter(
      (f) => f.classification === "unknown"
    );
    if (unknownFrames.length > 0) {
      tasks.push("classify_frames");
    }

    // If ambiguous primary frame
    if (hasAmbiguousPrimary) {
      tasks.push("identify_root_frame");
    }

    // If missing branch
    if (!stage1Output.branch && !stage1Output.commit_sha) {
      tasks.push("infer_missing_branch");
    }

    return tasks;
  }

  /**
   * Run LLM-assisted extraction via Python bridge
   */
  async extract(
    stage1Output: DeterministicExtractorOutput,
    rawFrames: unknown[],
    context?: { repo_languages?: string[]; known_frameworks?: string[] }
  ): Promise<LLMAssistOutput> {
    const startTime = Date.now();

    try {
      // Determine tasks
      const tasks = this.determineNeededTasks(stage1Output);

      // If no tasks needed, return pass-through
      if (tasks.length === 0) {
        logger.debug(
          { framesCount: stage1Output.frames.length },
          "Stage 2: No LLM tasks needed, passing through"
        );
        return this.createPassThroughOutput(stage1Output);
      }

      // Limit frames to send to LLM
      const limitedFrames = rawFrames.slice(
        0,
        EXTRACTION_CONFIG.MAX_LLM_FRAMES
      );

      const input: LLMAssistInput = {
        stage_1_output: stage1Output,
        tasks,
        raw_frames: limitedFrames,
        context,
      };

      logger.debug(
        {
          tasks,
          framesCount: limitedFrames.length,
        },
        "Stage 2: Calling LLM assist"
      );

      // Call Python LLM assist extractor
      const pythonBridge = this.createPythonBridge();
      const result = await pythonBridge.execute<
        LLMAssistInput,
        LLMAssistOutput
      >(input);

      // Validate output
      const validated = llmAssistOutputSchema.safeParse(result);
      if (!validated.success) {
        logger.warn(
          { errors: validated.error.issues },
          "Stage 2: Invalid LLM output, using fallback"
        );
        return this.createPassThroughOutput(stage1Output);
      }

      const output = validated.data;
      const durationMs = Date.now() - startTime;

      logger.info(
        {
          tasks,
          tokensUsed: output.tokens_used,
          cleanedFrames: output.cleaned_frames_count,
          removedNoise: output.removed_noise_count,
          confidence: output.confidence,
          durationMs,
        },
        "Stage 2: LLM assist complete"
      );

      return output;
    } catch (error) {
      logger.error(
        { error },
        "Stage 2: LLM assist failed, using deterministic fallback"
      );
      return this.createPassThroughOutput(stage1Output);
    }
  }

  /**
   * Create pass-through output when LLM is not needed or fails
   */
  private createPassThroughOutput(
    stage1Output: DeterministicExtractorOutput
  ): LLMAssistOutput {
    // Find primary frame index
    const primaryIndex = stage1Output.frames.findIndex((f) => f.is_entry_point);

    return {
      frames: stage1Output.frames,
      primary_frame_index: primaryIndex >= 0 ? primaryIndex : null,
      suggested_branch: null,
      cleaned_frames_count: stage1Output.frames.length,
      removed_noise_count: 0,
      model: "passthrough",
      tokens_used: 0,
      reasoning: "LLM assist not needed or skipped",
      confidence: 0.7,
    };
  }

  /**
   * Check if LLM assist should be triggered based on Stage 1 completeness
   */
  shouldTriggerLLM(stage1Output: DeterministicExtractorOutput): boolean {
    // Already complete - no need for LLM
    if (stage1Output.is_complete) {
      return false;
    }

    // Calculate completeness score
    let score = 0;
    const weights = {
      has_repo: 0.3,
      has_commit: 0.2,
      has_user_frames: 0.3,
      has_clear_primary: 0.2,
    };

    if (stage1Output.repo) score += weights.has_repo;
    if (stage1Output.commit_sha) score += weights.has_commit;

    const userFrames = stage1Output.frames.filter(
      (f) => f.classification === "user_code"
    );
    if (userFrames.length > 0) score += weights.has_user_frames;

    const primaryFrames = stage1Output.frames.filter((f) => f.is_entry_point);
    if (primaryFrames.length === 1) score += weights.has_clear_primary;

    // Trigger LLM if below threshold
    return score < EXTRACTION_CONFIG.STAGE_2_THRESHOLD;
  }
}
