import { z } from "zod";

// =============================================================================
// EXTRACTION STAGE TYPES
// =============================================================================

/**
 * Stage classification for the 3-stage extraction pipeline
 * - stage_1: Deterministic (rule-based) - handles 80% of events
 * - stage_2: LLM-assisted - when Stage 1 data is incomplete
 * - stage_3: Validation - GitHub verification (always runs)
 */
export const extractionStageSchema = z.enum([
  "stage_1_deterministic",
  "stage_2_llm_assist",
  "stage_3_validation",
]);
export type ExtractionStage = z.infer<typeof extractionStageSchema>;

/**
 * Frame classification by LLM (Stage 2)
 */
export const frameClassificationSchema = z.enum([
  "user_code", // Application code - highest priority
  "third_party", // node_modules, vendor code
  "runtime", // Node.js internals, browser APIs
  "framework", // React, Express, Next.js internals
  "polyfill", // core-js, regenerator-runtime
  "unknown", // Cannot be classified
]);
export type FrameClassification = z.infer<typeof frameClassificationSchema>;

// =============================================================================
// EXTRACTED FRAME TYPES
// =============================================================================

/**
 * A single extracted stack frame with classification
 */
export const extractedFrameSchema = z.object({
  // Core frame data
  file_path: z.string(), // Relative path within repo
  abs_path: z.string().optional(), // Original absolute/URL path
  line_number: z.number().int().positive(),
  column_number: z.number().int().nonnegative().optional(),
  function_name: z.string().nullable().optional(),

  // Classification
  classification: frameClassificationSchema,
  is_entry_point: z.boolean().default(false), // Root cause candidate

  // Source map resolution
  source_mapped: z.boolean().default(false),
  original_file: z.string().optional(), // Before source map
  original_line: z.number().int().positive().optional(),

  // Context
  context_line: z.string().optional(),
  in_app: z.boolean().default(true),
});
export type ExtractedFrame = z.infer<typeof extractedFrameSchema>;

// =============================================================================
// EXTRACTION RESULT
// =============================================================================

/**
 * Complete extraction result from the pipeline
 */
export const extractionResultSchema = z.object({
  // Identification
  extraction_id: z.string().uuid(),
  event_id: z.string().uuid(),
  org_id: z.string().uuid(),

  // Pipeline metadata
  pipeline_version: z.string().default("1.0.0"),
  extraction_stage: extractionStageSchema,
  stages_used: z.array(extractionStageSchema),

  // Repository info
  repo: z.string().nullable(), // owner/repo format
  commit_sha: z.string().nullable(), // Full 40-char SHA
  branch: z.string().nullable(),
  release_tag: z.string().nullable(),

  // Extracted frames (sorted by relevance)
  frames: z.array(extractedFrameSchema),
  primary_frame: extractedFrameSchema.nullable(), // Best candidate for root cause

  // Error metadata
  error_type: z.string().nullable(),
  error_message: z.string().nullable(),
  platform: z.string().default("javascript"),
  environment: z.string().default("production"),

  // Extraction quality
  confidence: z.number().min(0).max(1),
  issues: z.array(z.string()), // Warnings/problems encountered
  is_complete: z.boolean(), // All required data present

  // Timing
  extraction_ms: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

// =============================================================================
// STAGE 1: DETERMINISTIC EXTRACTOR TYPES
// =============================================================================

/**
 * Input to the deterministic extractor
 */
export const deterministicExtractorInputSchema = z.object({
  event_id: z.string().uuid(),
  org_id: z.string().uuid(),
  raw_payload: z.unknown(), // Raw Sentry event
});
export type DeterministicExtractorInput = z.infer<
  typeof deterministicExtractorInputSchema
>;

/**
 * Output from Stage 1
 */
export const deterministicExtractorOutputSchema = z.object({
  repo: z.string().nullable(),
  commit_sha: z.string().nullable(),
  branch: z.string().nullable(),
  release_tag: z.string().nullable(),
  frames: z.array(extractedFrameSchema),
  error_type: z.string().nullable(),
  error_message: z.string().nullable(),
  platform: z.string().nullable(),
  environment: z.string().nullable(),

  // Completeness check
  is_complete: z.boolean(),
  missing_fields: z.array(z.string()),
  extraction_ms: z.number(),
});
export type DeterministicExtractorOutput = z.infer<
  typeof deterministicExtractorOutputSchema
>;

// =============================================================================
// STAGE 2: LLM ASSIST TYPES
// =============================================================================

/**
 * Tasks the LLM can perform (RESTRICTED SCOPE)
 */
export const llmAssistTaskSchema = z.enum([
  "clean_stacktrace_noise", // Remove polyfills, noise
  "classify_frames", // User vs vendor frames
  "identify_root_frame", // Pick most likely crash location
  "repair_malformed_json", // Fix broken Sentry payload
  "deminify_filenames", // Map minified names to source
  "infer_missing_branch", // Suggest branch when missing
  "interpret_custom_context", // Parse custom Sentry contexts
]);
export type LLMAssistTask = z.infer<typeof llmAssistTaskSchema>;

/**
 * Input to LLM assist stage
 */
export const llmAssistInputSchema = z.object({
  stage_1_output: deterministicExtractorOutputSchema,
  tasks: z.array(llmAssistTaskSchema),
  raw_frames: z.array(z.unknown()), // Original frame data
  context: z
    .object({
      repo_languages: z.array(z.string()).optional(),
      known_frameworks: z.array(z.string()).optional(),
    })
    .optional(),
});
export type LLMAssistInput = z.infer<typeof llmAssistInputSchema>;

/**
 * Output from LLM assist stage
 */
export const llmAssistOutputSchema = z.object({
  // Enhanced frames (re-ordered, classified)
  frames: z.array(extractedFrameSchema),
  primary_frame_index: z.number().int().nonnegative().nullable(),

  // Suggestions (NOT authoritative - must be validated)
  suggested_branch: z.string().nullable(),
  cleaned_frames_count: z.number().int(),
  removed_noise_count: z.number().int(),

  // LLM metadata
  model: z.string(),
  tokens_used: z.number().int().nonnegative(),
  reasoning: z.string(), // Brief explanation of decisions
  confidence: z.number().min(0).max(1),
});
export type LLMAssistOutput = z.infer<typeof llmAssistOutputSchema>;

// =============================================================================
// STAGE 3: VALIDATION TYPES
// =============================================================================

/**
 * Validation check result
 */
export const validationCheckSchema = z.object({
  check: z.enum([
    "repo_exists",
    "commit_exists",
    "branch_exists",
    "file_exists",
    "line_valid",
  ]),
  passed: z.boolean(),
  message: z.string().optional(),
  fallback_used: z.boolean().default(false),
  fallback_value: z.string().nullable().optional(),
});
export type ValidationCheck = z.infer<typeof validationCheckSchema>;

/**
 * Input to validation stage
 */
export const validationInputSchema = z.object({
  org_id: z.string().uuid(),
  repo: z.string().nullable(),
  commit_sha: z.string().nullable(),
  branch: z.string().nullable(),
  frames: z.array(extractedFrameSchema),
});
export type ValidationInput = z.infer<typeof validationInputSchema>;

/**
 * Output from validation stage
 */
export const validationOutputSchema = z.object({
  // Final validated values
  repo: z.string().nullable(),
  commit_sha: z.string().nullable(),
  branch: z.string().nullable(),

  // Validated frames (only those that exist in repo)
  frames: z.array(extractedFrameSchema),
  primary_frame: extractedFrameSchema.nullable(),

  // Check results
  checks: z.array(validationCheckSchema),
  all_passed: z.boolean(),
  fallbacks_used: z.number().int(),

  // Timing
  validation_ms: z.number().int().nonnegative(),
});
export type ValidationOutput = z.infer<typeof validationOutputSchema>;

// =============================================================================
// EXTRACTION METRICS
// =============================================================================

/**
 * Metrics tracked per extraction
 */
export const extractionMetricsSchema = z.object({
  org_id: z.string().uuid(),
  date: z.string(), // YYYY-MM-DD

  stage_1_count: z.number().int().nonnegative().default(0),
  stage_2_count: z.number().int().nonnegative().default(0),
  stage_3_failures: z.number().int().nonnegative().default(0),

  extraction_llm_tokens: z.number().int().nonnegative().default(0),
  extraction_avg_ms: z.number().nonnegative().default(0),

  // Quality metrics
  complete_extractions: z.number().int().nonnegative().default(0),
  incomplete_extractions: z.number().int().nonnegative().default(0),
  source_map_resolutions: z.number().int().nonnegative().default(0),
});
export type ExtractionMetrics = z.infer<typeof extractionMetricsSchema>;

// =============================================================================
// FRAME FILTERING PATTERNS
// =============================================================================

/**
 * Common patterns for frame classification (Stage 1 deterministic rules)
 */
export const NOISE_PATTERNS = {
  // Node.js internals
  NODE_INTERNALS: /^(internal|node:|timers|events|_http|_stream|async_hooks)/,

  // Browser internals
  BROWSER_INTERNALS: /^(native|<anonymous>|eval|Function)/,

  // Common vendor paths
  NODE_MODULES: /node_modules\//,

  // Polyfills
  POLYFILLS: /(core-js|regenerator-runtime|@babel\/runtime|tslib)/,

  // Bundler-generated
  BUNDLER_INTERNAL: /(__webpack__|__vite__|__rollup__|\.hot-update\.)/,

  // Framework internals
  REACT_INTERNALS: /react-dom\/|react\/cjs\/|scheduler\//,
  NEXT_INTERNALS: /next\/dist\/|\.next\//,
  EXPRESS_INTERNALS: /express\/lib\//,

  // Test runners (shouldn't appear in prod but filter anyway)
  TEST_RUNNERS: /(jest|mocha|vitest|cypress|playwright)/,
} as const;

/**
 * Patterns indicating user code (high priority frames)
 */
export const USER_CODE_PATTERNS = {
  // Typical source directories
  SRC_DIR: /^(src|lib|app|pages|components|services|utils|modules)\//,

  // Has in_app: true from Sentry
  IN_APP_FLAG: /in_app.*true/,

  // Not in vendor paths
  NOT_VENDOR: /^(?!.*node_modules)/,
} as const;

// =============================================================================
// PIPELINE CONFIG
// =============================================================================

export const EXTRACTION_CONFIG = {
  // Stage 2 trigger threshold - if Stage 1 is less than this complete, trigger LLM
  STAGE_2_THRESHOLD: 0.7,

  // Max frames to send to LLM (cost control)
  MAX_LLM_FRAMES: 50,

  // LLM token limit for extraction
  MAX_EXTRACTION_TOKENS: 1500,

  // Confidence thresholds
  HIGH_CONFIDENCE: 0.85,
  LOW_CONFIDENCE: 0.5,

  // Validation fallback order
  FALLBACK_ORDER: ["commit_sha", "branch", "default_branch"] as const,

  // Default branch names to try
  DEFAULT_BRANCHES: ["main", "master", "develop"] as const,
} as const;
