/**
 * Hybrid LLM-Assisted Event Extraction
 *
 * Three-stage pipeline for extracting code location data from Sentry events:
 *
 * Stage 1: Deterministic Extractor (80% of events)
 *   - Rule-based extraction of file paths, line numbers, commit SHA
 *   - Classification of frames (user_code vs vendor)
 *
 * Stage 2: LLM Assist Extractor (when Stage 1 incomplete)
 *   - GPT-4o-mini for cleaning noise, classifying frames
 *   - RESTRICTED: Can only clean/interpret, NOT invent data
 *
 * Stage 3: Extraction Validator (always runs)
 *   - Verifies repo/commit/files exist in GitHub
 *   - Applies fallback strategies
 *
 * Usage:
 * ```typescript
 * import { ExtractionPipeline } from './services/event-extractor';
 *
 * const pipeline = new ExtractionPipeline();
 * const result = await pipeline.extract(eventId, orgId, sentryPayload);
 *
 * if (result.is_complete) {
 *   // Use result.repo, result.commit_sha, result.frames
 * }
 * ```
 */

export { ExtractionPipeline } from "./extraction-pipeline.js";
export { DeterministicExtractor } from "./deterministic-extractor.js";
export { LLMAssistExtractor } from "./llm-assist-extractor.js";
export { ExtractionValidator } from "./extraction-validator.js";

// Re-export types
export type {
  ExtractionResult,
  ExtractionStage,
  ExtractedFrame,
  FrameClassification,
  DeterministicExtractorInput,
  DeterministicExtractorOutput,
  LLMAssistInput,
  LLMAssistOutput,
  LLMAssistTask,
  ValidationInput,
  ValidationOutput,
  ValidationCheck,
} from "../../types/extraction.js";
