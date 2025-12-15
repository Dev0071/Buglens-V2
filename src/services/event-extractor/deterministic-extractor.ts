import { logger } from "../../utils/logger.js";
import {
  type DeterministicExtractorInput,
  type DeterministicExtractorOutput,
  type ExtractedFrame,
  type FrameClassification,
  NOISE_PATTERNS,
  USER_CODE_PATTERNS,
} from "../../types/extraction.js";
import { type SentryEventPayload } from "../../types/sentry.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Raw frame as extracted from Sentry (before cleaning)
 */
export interface RawFrame {
  filename: string | null;
  abs_path: string | null;
  lineno: number | null;
  colno: number | null;
  function: string | null;
  context_line: string | null;
  in_app: boolean | null;
}

/**
 * Repository info extracted from Sentry payload
 */
export interface RepoInfo {
  repo: string | null;
  commitSha: string | null;
  branch: string | null;
  releaseTag: string | null;
}

/**
 * Error info extracted from Sentry payload
 */
export interface ErrorInfo {
  errorType: string | null;
  errorMessage: string | null;
}

// ============================================================================
// PURE FUNCTIONS - Tag Normalization
// ============================================================================

/**
 * Normalize tags from Sentry (can be array of tuples or object)
 * @pure
 */
export function normalizeTags(
  tags: SentryEventPayload["tags"]
): Record<string, string> | null {
  if (!tags) return null;

  if (Array.isArray(tags)) {
    // Array of [key, value] tuples
    const result: Record<string, string> = {};
    for (const item of tags) {
      if (Array.isArray(item) && item.length >= 2) {
        result[item[0]] = item[1];
      }
    }
    return result;
  }

  // Already an object
  return tags as Record<string, string>;
}

// ============================================================================
// PURE FUNCTIONS - Repository Extraction
// ============================================================================

/**
 * Extract repo info from release tag (format: "owner/repo@sha" or "owner/repo@version")
 * @pure
 */
export function extractRepoFromRelease(releaseTag: string | null): {
  repo: string | null;
  commitSha: string | null;
} {
  if (!releaseTag) return { repo: null, commitSha: null };

  const releaseMatch = releaseTag.match(
    /^([a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+)[@:]([a-f0-9]{7,40}|v?[\d.]+.*)$/i
  );

  if (!releaseMatch) return { repo: null, commitSha: null };

  const repo = releaseMatch[1];
  const ref = releaseMatch[2];

  // Check if ref is a commit SHA (7-40 hex chars)
  const commitSha = /^[a-f0-9]{7,40}$/i.test(ref) ? ref : null;

  return { repo, commitSha };
}

/**
 * Extract repo info from GitHub context (some Sentry SDKs add this)
 * @pure
 */
export function extractRepoFromGitHubContext(
  contexts: Record<string, unknown> | undefined
): Partial<RepoInfo> {
  if (!contexts?.github) return {};

  const github = contexts.github as Record<string, unknown>;
  return {
    repo: typeof github.repo === "string" ? github.repo : undefined,
    commitSha: typeof github.commit === "string" ? github.commit : undefined,
    branch: typeof github.branch === "string" ? github.branch : undefined,
  };
}

/**
 * Extract repo info from Sentry tags
 * @pure
 */
export function extractRepoFromTags(
  tags: Record<string, string> | null
): Partial<RepoInfo> {
  if (!tags) return {};

  return {
    repo: tags["github.repo"] || undefined,
    commitSha: tags["commit"] || tags["github.sha"] || undefined,
    branch: tags["branch"] || tags["github.branch"] || undefined,
  };
}

/**
 * Validate commit SHA format (7-40 hex characters)
 * @pure
 */
export function isValidCommitSha(sha: string | null | undefined): boolean {
  return sha !== null && sha !== undefined && /^[a-f0-9]{7,40}$/i.test(sha);
}

/**
 * Extract repository info from Sentry payload using multiple strategies
 * @pure
 */
export function extractRepoInfo(payload: SentryEventPayload): RepoInfo {
  const releaseTag = payload.release ?? null;
  const contexts = payload.contexts as Record<string, unknown> | undefined;
  const normalizedTags = normalizeTags(payload.tags);

  // Strategy 1: Parse release tag
  const fromRelease = extractRepoFromRelease(releaseTag);

  // Strategy 2: GitHub context
  const fromGitHub = extractRepoFromGitHubContext(contexts);

  // Strategy 3: Tags
  const fromTags = extractRepoFromTags(normalizedTags);

  // Strategy 4: Runtime context (fallback)
  let runtimeRepo: string | null = null;
  if (contexts?.runtime) {
    const runtime = contexts.runtime as Record<string, unknown>;
    if (typeof runtime.name === "string" && runtime.name.includes("/")) {
      runtimeRepo = runtime.name;
    }
  }

  // Merge results (first non-null wins)
  const repo =
    fromRelease.repo ?? fromGitHub.repo ?? fromTags.repo ?? runtimeRepo;
  const commitSha =
    fromRelease.commitSha ?? fromGitHub.commitSha ?? fromTags.commitSha ?? null;
  const branch = fromGitHub.branch ?? fromTags.branch ?? null;

  return {
    repo,
    commitSha: isValidCommitSha(commitSha) ? commitSha : null,
    branch,
    releaseTag,
  };
}

// ============================================================================
// PURE FUNCTIONS - Error Extraction
// ============================================================================

/**
 * Extract error type and message from Sentry payload
 * @pure
 */
export function extractErrorInfo(payload: SentryEventPayload): ErrorInfo {
  let errorType: string | null = null;
  let errorMessage: string | null = null;

  // Try exception values
  const values = payload.exception?.values;
  if (values && values.length > 0) {
    // Last exception is usually the root cause
    const lastException = values[values.length - 1];
    errorType = lastException.type ?? null;
    errorMessage = lastException.value ?? null;
  }

  // Fall back to message field
  if (!errorMessage && payload.message) {
    errorMessage = payload.message;
  }

  return { errorType, errorMessage };
}

// ============================================================================
// PURE FUNCTIONS - Frame Extraction
// ============================================================================

/**
 * Extract raw frames from Sentry exception stacktrace
 * @pure
 */
export function extractRawFrames(payload: SentryEventPayload): RawFrame[] {
  const frames: RawFrame[] = [];

  const values = payload.exception?.values;
  if (!values) {
    logger.debug(
      {
        hasException: !!payload.exception,
        payloadKeys: Object.keys(payload),
      },
      "No exception.values found in payload"
    );
    return frames;
  }

  logger.debug(
    {
      exceptionCount: values.length,
      exceptionTypes: values.map((v) => v.type),
    },
    "Processing exception values"
  );

  // Process all exceptions (could be chained)
  for (const exception of values) {
    const stackFrames = exception.stacktrace?.frames;
    if (!stackFrames) {
      logger.debug(
        {
          exceptionType: exception.type,
          hasStacktrace: !!exception.stacktrace,
        },
        "Exception has no stacktrace frames"
      );
      continue;
    }

    logger.debug(
      {
        exceptionType: exception.type,
        rawFrameCount: stackFrames.length,
        sampleFrame: stackFrames[0]
          ? {
              filename: stackFrames[0].filename,
              abs_path: stackFrames[0].abs_path,
              lineno: stackFrames[0].lineno,
              in_app: stackFrames[0].in_app,
            }
          : null,
      },
      "Processing stacktrace frames"
    );

    // Sentry frames are in reverse order (most recent first)
    // We want root cause order (deepest frame first)
    for (let i = stackFrames.length - 1; i >= 0; i--) {
      const frame = stackFrames[i];
      frames.push({
        filename: frame.filename ?? null,
        abs_path: frame.abs_path ?? null,
        lineno: frame.lineno ?? null,
        colno: frame.colno ?? null,
        function: frame.function ?? null,
        context_line: frame.context_line ?? null,
        in_app: frame.in_app ?? null,
      });
    }
  }

  return frames;
}

// ============================================================================
// PURE FUNCTIONS - Path Cleaning
// ============================================================================

/**
 * Clean and normalize file path
 * Returns null if path should be filtered out
 * @pure
 */
export function cleanFilePath(path: string): string | null {
  // Strip URL schemes
  let cleaned = path
    .replace(/^(https?|file|webpack|webpack-internal):\/\//, "")
    .replace(/^\[native code\]$/, "")
    .replace(/^<anonymous>$/, "");

  // Skip if nothing useful remains
  if (!cleaned || cleaned === "" || cleaned === "/") return null;

  // Skip node internals
  if (NOISE_PATTERNS.NODE_INTERNALS.test(cleaned)) return null;

  // Skip browser internals
  if (NOISE_PATTERNS.BROWSER_INTERNALS.test(cleaned)) return null;

  // Skip bundler internals
  if (NOISE_PATTERNS.BUNDLER_INTERNAL.test(cleaned)) return null;

  // Strip leading slashes and dots
  cleaned = cleaned.replace(/^[/.]+/, "");

  // Handle webpack paths like ./src/file.ts
  cleaned = cleaned.replace(/^\.\//, "");

  // Handle query strings and hashes (common in web builds)
  cleaned = cleaned.replace(/[?#].*$/, "");

  return cleaned || null;
}

// ============================================================================
// PURE FUNCTIONS - Frame Classification
// ============================================================================

/**
 * Classify a frame based on its path and metadata
 * @pure
 */
export function classifyFrame(
  raw: RawFrame,
  cleanedPath: string
): FrameClassification {
  // Explicit in_app: false from Sentry
  if (raw.in_app === false) {
    return "third_party";
  }

  // Check noise patterns
  if (NOISE_PATTERNS.NODE_MODULES.test(cleanedPath)) {
    // Check if it's a framework we recognize
    if (NOISE_PATTERNS.REACT_INTERNALS.test(cleanedPath)) return "framework";
    if (NOISE_PATTERNS.NEXT_INTERNALS.test(cleanedPath)) return "framework";
    if (NOISE_PATTERNS.EXPRESS_INTERNALS.test(cleanedPath)) return "framework";
    if (NOISE_PATTERNS.POLYFILLS.test(cleanedPath)) return "polyfill";
    return "third_party";
  }

  // Check for runtime patterns
  if (NOISE_PATTERNS.NODE_INTERNALS.test(cleanedPath)) return "runtime";

  // Check test runners (shouldn't be in prod, but filter)
  if (NOISE_PATTERNS.TEST_RUNNERS.test(cleanedPath)) return "third_party";

  // Check user code patterns
  if (USER_CODE_PATTERNS.SRC_DIR.test(cleanedPath)) return "user_code";

  // Explicit in_app: true is strong signal
  if (raw.in_app === true) return "user_code";

  // Default to user_code for unclassified (benefit of the doubt)
  return "user_code";
}

/**
 * Classify frames and convert to ExtractedFrame format
 * @pure
 */
export function classifyFrames(rawFrames: RawFrame[]): ExtractedFrame[] {
  const frames: ExtractedFrame[] = [];
  let foundEntryPoint = false;
  let skippedNoLocation = 0;
  let skippedCleanedPath = 0;

  for (const raw of rawFrames) {
    // Skip frames without usable location
    const filePath = raw.filename ?? raw.abs_path;
    if (!filePath || !raw.lineno) {
      skippedNoLocation++;
      continue;
    }

    // Clean file path
    const cleanedPath = cleanFilePath(filePath);
    if (!cleanedPath) {
      skippedCleanedPath++;
      continue;
    }

    // Classify the frame
    const classification = classifyFrame(raw, cleanedPath);

    // Determine if this could be the entry point (root cause)
    const isEntryPoint =
      !foundEntryPoint &&
      classification === "user_code" &&
      raw.in_app !== false;

    if (isEntryPoint) foundEntryPoint = true;

    frames.push({
      file_path: cleanedPath,
      abs_path: raw.abs_path ?? undefined,
      line_number: raw.lineno,
      column_number: raw.colno ?? undefined,
      function_name: raw.function,
      classification,
      is_entry_point: isEntryPoint,
      source_mapped: false,
      context_line: raw.context_line ?? undefined,
      in_app: raw.in_app ?? true,
    });
  }

  if (rawFrames.length > 0 && frames.length === 0) {
    logger.warn(
      {
        rawFrameCount: rawFrames.length,
        skippedNoLocation,
        skippedCleanedPath,
        sampleRawFrame: rawFrames[0]
          ? {
              filename: rawFrames[0].filename,
              abs_path: rawFrames[0].abs_path,
              lineno: rawFrames[0].lineno,
            }
          : null,
      },
      "All frames filtered out during classification"
    );
  }

  return frames;
}

// ============================================================================
// PURE FUNCTIONS - Main Extraction Pipeline
// ============================================================================

/**
 * Calculate missing fields based on extracted data
 * @pure
 */
export function calculateMissingFields(
  repoInfo: RepoInfo,
  frames: ExtractedFrame[]
): string[] {
  const missing: string[] = [];

  if (!repoInfo.repo) missing.push("repo");
  if (!repoInfo.commitSha) missing.push("commit_sha");

  const userCodeFrames = frames.filter((f) => f.classification === "user_code");
  if (userCodeFrames.length === 0 && frames.length > 0) {
    missing.push("user_code_frames");
  }

  return missing;
}

/**
 * Determine if extraction is complete
 * @pure
 */
export function isExtractionComplete(
  repoInfo: RepoInfo,
  frames: ExtractedFrame[]
): boolean {
  const hasRequiredFields = !!repoInfo.repo;
  const userCodeFrames = frames.filter((f) => f.classification === "user_code");
  const hasUserFrames = userCodeFrames.length > 0;
  return hasRequiredFields && hasUserFrames;
}

/**
 * Extract code location data from a Sentry event using deterministic rules
 * Main orchestration function - composes all extraction steps
 * @pure (except for timing)
 */
export function extract(
  input: DeterministicExtractorInput
): DeterministicExtractorOutput {
  const startTime = Date.now();

  try {
    const payload = input.raw_payload as SentryEventPayload;

    // Step 1: Extract repository info
    const repoInfo = extractRepoInfo(payload);

    // Step 2: Extract error info
    const errorInfo = extractErrorInfo(payload);

    // Step 3: Extract and classify stack frames
    const rawFrames = extractRawFrames(payload);
    const frames = classifyFrames(rawFrames);

    // Step 4: Calculate completeness
    const missingFields = calculateMissingFields(repoInfo, frames);
    const isComplete = isExtractionComplete(repoInfo, frames);

    const extractionMs = Date.now() - startTime;

    logger.debug(
      {
        eventId: input.event_id,
        framesExtracted: frames.length,
        userCodeFrames: frames.filter((f) => f.classification === "user_code")
          .length,
        missingFields,
        isComplete,
        extractionMs,
      },
      "Stage 1 extraction complete"
    );

    return {
      repo: repoInfo.repo,
      commit_sha: repoInfo.commitSha,
      branch: repoInfo.branch,
      release_tag: repoInfo.releaseTag,
      frames,
      error_type: errorInfo.errorType,
      error_message: errorInfo.errorMessage,
      platform: payload.platform ?? null,
      environment: payload.environment ?? null,
      is_complete: isComplete,
      missing_fields: missingFields,
      extraction_ms: extractionMs,
    };
  } catch (error) {
    logger.error(
      { error, eventId: input.event_id },
      "Stage 1 extraction failed"
    );

    return {
      repo: null,
      commit_sha: null,
      branch: null,
      release_tag: null,
      frames: [],
      error_type: null,
      error_message: null,
      platform: null,
      environment: null,
      is_complete: false,
      missing_fields: ["extraction_failed"],
      extraction_ms: Date.now() - startTime,
    };
  }
}

// ============================================================================
// OOP WRAPPER - For backward compatibility and integration
// ============================================================================

/**
 * Stage 1: Deterministic Extractor (OOP Wrapper)
 *
 * Rule-based extraction of code location data from Sentry payloads.
 * Handles ~80% of events without LLM assistance.
 *
 * This class wraps the pure functional implementation for:
 * - Backward compatibility with existing code
 * - Integration with the service layer
 * - Consistent API with other extractors
 *
 * For new code, prefer using the pure functions directly:
 * - extract() - main extraction pipeline
 * - extractRepoInfo() - repository info extraction
 * - extractErrorInfo() - error info extraction
 * - classifyFrames() - frame classification
 */
export class DeterministicExtractor {
  /**
   * Extract code location data from a Sentry event using deterministic rules
   */
  async extract(
    input: DeterministicExtractorInput
  ): Promise<DeterministicExtractorOutput> {
    // Delegate to pure function (async wrapper for interface consistency)
    return extract(input);
  }
}
