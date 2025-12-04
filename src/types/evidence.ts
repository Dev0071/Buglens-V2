import { z } from "zod";

// ============================================
// Evidence Types for RCA Assembly (Week 4)
// ============================================

/**
 * Error information extracted from Sentry event
 */
export const errorInfoSchema = z.object({
  message: z.string(),
  type: z.string(), // e.g., "TypeError", "ReferenceError"
  value: z.string().optional(), // Full error message
  stack_trace: z.array(
    z.object({
      file: z.string(),
      line: z.number().nullable(),
      column: z.number().nullable(),
      function: z.string().nullable(),
      in_app: z.boolean().default(true),
    })
  ),
});

export type ErrorInfo = z.infer<typeof errorInfoSchema>;

/**
 * Code context for the error location
 */
export const codeContextSchema = z.object({
  file_path: z.string(),
  line_number: z.number(),
  column_number: z.number().nullable(),
  snippet: z.string(),
  snippet_start_line: z.number(),
  snippet_end_line: z.number(),
  language: z.string(),
  source_map_resolved: z.boolean().default(false),
});

export type CodeContext = z.infer<typeof codeContextSchema>;

/**
 * Commit information for recent changes
 */
export const commitInfoSchema = z.object({
  sha: z.string(),
  short_sha: z.string(), // First 7 chars
  message: z.string(),
  author: z.object({
    name: z.string(),
    email: z.string(),
    date: z.string(), // ISO timestamp
    github_username: z.string().nullable(),
  }),
  url: z.string(),
  files_changed: z.number().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
});

export type CommitInfo = z.infer<typeof commitInfoSchema>;

/**
 * Timeline step from breadcrumbs
 */
export const timelineStepSchema = z.object({
  timestamp: z.string(), // ISO timestamp
  timestamp_ms: z.number(), // Unix timestamp in ms
  type: z.enum([
    "navigation",
    "http",
    "console",
    "ui",
    "user",
    "error",
    "debug",
    "query",
    "transaction",
    "default",
  ]),
  category: z.string().optional(),
  message: z.string(),
  data: z.record(z.unknown()).optional(),
  level: z.enum(["debug", "info", "warning", "error", "fatal"]).default("info"),
  is_anomaly: z.boolean().default(false),
  anomaly_reason: z.string().optional(),
});

export type TimelineStep = z.infer<typeof timelineStepSchema>;

/**
 * Reconstructed timeline from Sentry breadcrumbs
 */
export const timelineSchema = z.object({
  steps: z.array(timelineStepSchema),
  anomalies_count: z.number(),
  duration_ms: z.number(),
  first_timestamp: z.string().nullable(),
  last_timestamp: z.string().nullable(),
  http_requests: z.number(),
  errors_before_crash: z.number(),
});

export type Timeline = z.infer<typeof timelineSchema>;

/**
 * Environment context
 */
export const environmentContextSchema = z.object({
  environment: z.string().nullable(),
  release: z.string().nullable(),
  server_name: z.string().nullable(),
  user_agent: z.string().nullable(),
  browser: z
    .object({
      name: z.string().nullable(),
      version: z.string().nullable(),
    })
    .nullable(),
  os: z
    .object({
      name: z.string().nullable(),
      version: z.string().nullable(),
    })
    .nullable(),
  device: z
    .object({
      family: z.string().nullable(),
      model: z.string().nullable(),
    })
    .nullable(),
  runtime: z
    .object({
      name: z.string().nullable(),
      version: z.string().nullable(),
    })
    .nullable(),
  sdk: z
    .object({
      name: z.string().nullable(),
      version: z.string().nullable(),
    })
    .nullable(),
  tags: z.record(z.string()).default({}),
});

export type EnvironmentContext = z.infer<typeof environmentContextSchema>;

/**
 * Deterministic finding from analyzer (imported from analyzer.ts)
 */
export const deterministicFindingSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  confidence: z.number().min(0).max(1),
  message: z.string(),
  evidence: z.object({
    file_path: z.string(),
    line_number: z.number(),
    column_number: z.number().optional(),
    snippet: z.string(),
    snippet_start_line: z.number().optional(),
    snippet_end_line: z.number().optional(),
    language: z.string(),
  }),
  metadata: z.record(z.unknown()).default({}),
});

export type DeterministicFinding = z.infer<typeof deterministicFindingSchema>;

/**
 * Complete evidence bundle for LLM processing
 */
export const evidenceBundleSchema = z.object({
  // Metadata
  bundle_id: z.string().uuid(),
  created_at: z.string(), // ISO timestamp
  org_id: z.string().uuid(),
  event_id: z.string().uuid(),
  job_id: z.string().uuid(),

  // Error information
  error: errorInfoSchema,

  // Code context
  code: z.object({
    primary: codeContextSchema.nullable(), // Main error location
    related: z.array(codeContextSchema), // Other stack frames
    repo: z.string(),
    commit_sha: z.string().nullable(),
  }),

  // Deterministic analysis results
  deterministic_findings: z.array(deterministicFindingSchema),

  // Timeline from breadcrumbs
  timeline: timelineSchema.nullable(),

  // Recent commits
  recent_commits: z.array(commitInfoSchema),

  // Environment context
  environment: environmentContextSchema,

  // Metadata
  metadata: z.object({
    sentry_event_id: z.string(),
    processing_started_at: z.string(),
    code_fetch_source: z.enum(["github", "cache", "embedded"]).nullable(),
    source_map_used: z.boolean(),
    /** Indicates if the bundle passed full schema validation.
     *  MUST be set explicitly after validation. No default. */
    validation_passed: z.boolean(),
    /** Validation errors if validation_passed is false */
    validation_errors: z.array(z.string()).optional(),
  }),
});

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

/**
 * S3 storage reference for evidence bundle
 */
export interface EvidenceStorageRef {
  bucket: string;
  key: string;
  size_bytes: number;
  compressed: boolean;
  created_at: Date;
}

/**
 * Evidence collector configuration
 */
export interface EvidenceCollectorConfig {
  maxCommits: number;
  maxTimelineSteps: number;
  maxCodeContextLines: number;
  includeCommitDiffs: boolean;
  maxDiffSize: number;
}

export const DEFAULT_EVIDENCE_CONFIG: EvidenceCollectorConfig = {
  maxCommits: 5,
  maxTimelineSteps: 50,
  maxCodeContextLines: 50,
  includeCommitDiffs: false, // Disabled for MVP to save API calls
  maxDiffSize: 500,
};
