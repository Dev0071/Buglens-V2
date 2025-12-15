/**
 * Evidence Transforms - Pure Functions for Evidence Processing
 *
 * This module contains stateless, pure transform functions for processing
 * evidence data. These functions have no side effects and can be composed,
 * tested in isolation, and reused across the codebase.
 *
 * Architecture Guideline:
 * - All transforms are pure functions (output depends only on input)
 * - No external dependencies (logging, DB, network)
 * - Each function is independently testable
 * - Composition over inheritance
 *
 * @module evidence-transforms
 */

import type { GitHubCommit } from "../types/github.js";
import type {
  AnalyzerResult,
  DeterministicFinding,
} from "../types/analyzer.js";
import type {
  ErrorInfo,
  CodeContext,
  Timeline,
  TimelineStep,
  EnvironmentContext,
  CommitInfo,
} from "../types/evidence.js";
import type { EventData, CodeFetchResult } from "./evidence-collector.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Stack frame extracted from Sentry payload
 */
export interface RawStackFrame {
  filename?: string;
  lineno?: number;
  colno?: number;
  function?: string;
  in_app?: boolean;
}

/**
 * Breadcrumb from Sentry payload
 */
export interface RawBreadcrumb {
  timestamp?: string | number;
  type?: string;
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  level?: string;
}

// ============================================================================
// ERROR INFO EXTRACTION
// ============================================================================

/**
 * Extract error info from Sentry event data
 * @pure
 */
export function extractErrorInfo(eventData: EventData): ErrorInfo {
  const rawPayload = eventData.raw_payload as Record<string, unknown> | null;
  const exception = rawPayload?.exception as
    | {
        values?: Array<{
          type?: string;
          value?: string;
          stacktrace?: unknown;
        }>;
      }
    | undefined;

  const primaryException = exception?.values?.[0];
  const stacktrace = eventData.stack_trace as
    | { frames?: Array<unknown> }
    | undefined;

  const frames = (stacktrace?.frames ?? []) as RawStackFrame[];

  return {
    message: eventData.message,
    type: primaryException?.type ?? "Error",
    value: primaryException?.value ?? eventData.message,
    stack_trace: transformStackFrames(frames),
  };
}

/**
 * Transform raw stack frames to normalized format
 * @pure
 */
export function transformStackFrames(
  frames: RawStackFrame[]
): ErrorInfo["stack_trace"] {
  return frames.map((frame) => ({
    file: frame.filename ?? "unknown",
    line: frame.lineno ?? null,
    column: frame.colno ?? null,
    function: frame.function ?? null,
    in_app: frame.in_app ?? true,
  }));
}

// ============================================================================
// CODE CONTEXT BUILDING
// ============================================================================

/**
 * Build code context from fetched code results
 * @pure
 */
export function buildCodeContext(
  codeResults: CodeFetchResult[],
  repo: string,
  commitSha: string | null
): {
  primary: CodeContext | null;
  related: CodeContext[];
  repo: string;
  commit_sha: string | null;
} {
  if (codeResults.length === 0) {
    return {
      primary: null,
      related: [],
      repo,
      commit_sha: commitSha,
    };
  }

  return {
    primary: codeResultToContext(codeResults[0]),
    related: codeResults.slice(1).map(codeResultToContext),
    repo,
    commit_sha: commitSha,
  };
}

/**
 * Transform a code fetch result to CodeContext
 * @pure
 */
export function codeResultToContext(result: CodeFetchResult): CodeContext {
  return {
    file_path: result.file.path,
    line_number: result.context.line_number,
    column_number: result.context.column_number,
    snippet: result.file.content,
    snippet_start_line: result.context.snippet_start,
    snippet_end_line: result.context.snippet_end,
    language: result.file.language ?? "text",
    source_map_resolved: result.context.source_map_resolved,
  };
}

// ============================================================================
// COMMIT TRANSFORMATION
// ============================================================================

/**
 * Transform GitHub commit to CommitInfo
 * @pure
 */
export function transformCommit(commit: GitHubCommit): CommitInfo {
  return {
    sha: commit.sha,
    short_sha: commit.sha.slice(0, 7),
    message: commit.commit.message,
    author: {
      name: commit.commit.author.name,
      email: commit.commit.author.email,
      date: commit.commit.author.date,
      github_username: commit.author?.login ?? null,
    },
    url: commit.html_url,
    files_changed: undefined,
    additions: undefined,
    deletions: undefined,
  };
}

/**
 * Transform multiple GitHub commits to CommitInfo array
 * @pure
 */
export function transformCommits(commits: GitHubCommit[]): CommitInfo[] {
  return commits.map(transformCommit);
}

// ============================================================================
// TIMELINE RECONSTRUCTION (FALLBACK)
// ============================================================================

/**
 * Map Sentry breadcrumb type to internal type
 * @pure
 */
export function mapBreadcrumbType(
  type: string | undefined
): TimelineStep["type"] {
  const typeMap: Record<string, TimelineStep["type"]> = {
    navigation: "navigation",
    http: "http",
    fetch: "http",
    xhr: "http",
    console: "console",
    ui: "ui",
    click: "ui",
    input: "ui",
    user: "user",
    error: "error",
    debug: "debug",
    query: "query",
    transaction: "transaction",
  };
  return typeMap[type ?? ""] ?? "default";
}

/**
 * Map Sentry breadcrumb level to internal level
 * @pure
 */
export function mapBreadcrumbLevel(
  level: string | undefined
): TimelineStep["level"] {
  const levelMap: Record<string, TimelineStep["level"]> = {
    debug: "debug",
    info: "info",
    warning: "warning",
    warn: "warning",
    error: "error",
    fatal: "fatal",
    critical: "fatal",
  };
  return levelMap[level ?? ""] ?? "info";
}

/**
 * Parse breadcrumb timestamp to milliseconds
 * @pure
 */
export function parseBreadcrumbTimestamp(
  timestamp: string | number | undefined
): number {
  if (typeof timestamp === "number") {
    // Sentry sends timestamps as unix seconds, convert to ms
    return timestamp * 1000;
  }
  if (timestamp) {
    return new Date(timestamp).getTime();
  }
  return Date.now();
}

/**
 * Transform a single breadcrumb to TimelineStep
 * @pure
 */
export function transformBreadcrumb(crumb: RawBreadcrumb): TimelineStep {
  const timestampMs = parseBreadcrumbTimestamp(crumb.timestamp);
  const type = mapBreadcrumbType(crumb.type);
  const level = mapBreadcrumbLevel(crumb.level);

  return {
    timestamp: new Date(timestampMs).toISOString(),
    timestamp_ms: timestampMs,
    type,
    category: crumb.category,
    message: crumb.message ?? "",
    data: crumb.data,
    level,
    is_anomaly: false,
  };
}

/**
 * Build fallback timeline from breadcrumbs (no Python analysis)
 * @pure
 */
export function buildFallbackTimeline(
  breadcrumbs: unknown[],
  maxSteps: number
): Timeline {
  const limitedCrumbs = breadcrumbs.slice(0, maxSteps) as RawBreadcrumb[];
  const steps = limitedCrumbs.map(transformBreadcrumb);

  // Count HTTP requests and errors
  let httpRequests = 0;
  let errorsBefore = 0;

  for (const step of steps) {
    if (step.type === "http") httpRequests++;
    if (step.level === "error" || step.level === "fatal") errorsBefore++;
  }

  // Calculate duration from timestamps
  const timestamps = steps.map((s) => s.timestamp_ms).sort((a, b) => a - b);
  const firstTs = timestamps[0] ?? 0;
  const lastTs = timestamps[timestamps.length - 1] ?? 0;
  const durationMs = timestamps.length > 0 ? lastTs - firstTs : 0;

  return {
    steps,
    anomalies_count: 0,
    duration_ms: durationMs,
    first_timestamp: steps[0]?.timestamp ?? null,
    last_timestamp: steps[steps.length - 1]?.timestamp ?? null,
    http_requests: httpRequests,
    errors_before_crash: errorsBefore,
  };
}

// ============================================================================
// ENVIRONMENT CONTEXT EXTRACTION
// ============================================================================

/**
 * Extract environment context from Sentry event data
 * @pure
 */
export function extractEnvironmentContext(
  eventData: EventData
): EnvironmentContext {
  const context = eventData.context as Record<string, unknown> | null;
  const rawPayload = eventData.raw_payload as Record<string, unknown> | null;
  const contexts = (context?.contexts ?? rawPayload?.contexts) as
    | Record<string, unknown>
    | undefined;
  const rawTags = context?.tags ?? rawPayload?.tags;

  // Sentry can send tags as either:
  // 1. Object: { "key": "value" }
  // 2. Array: [["key", "value"], ["key2", "value2"]]
  // Normalize to object format
  const tags = normalizeTagsToObject(rawTags);

  const browser = contexts?.browser as
    | { name?: string; version?: string }
    | undefined;
  const os = contexts?.os as { name?: string; version?: string } | undefined;
  const device = contexts?.device as
    | { family?: string; model?: string }
    | undefined;
  const runtime = contexts?.runtime as
    | { name?: string; version?: string }
    | undefined;

  const request = (context?.request ?? rawPayload?.request) as
    | { headers?: Record<string, string> }
    | undefined;
  const userAgent = request?.headers?.["User-Agent"] ?? null;

  const sdk = rawPayload?.sdk as
    | { name?: string; version?: string }
    | undefined;

  return {
    environment: eventData.environment,
    release: eventData.release,
    server_name: (rawPayload?.server_name as string) ?? null,
    user_agent: userAgent,
    browser: browser
      ? { name: browser.name ?? null, version: browser.version ?? null }
      : null,
    os: os ? { name: os.name ?? null, version: os.version ?? null } : null,
    device: device
      ? { family: device.family ?? null, model: device.model ?? null }
      : null,
    runtime: runtime
      ? { name: runtime.name ?? null, version: runtime.version ?? null }
      : null,
    sdk: sdk ? { name: sdk.name ?? null, version: sdk.version ?? null } : null,
    tags,
  };
}

/**
 * Normalize tags from Sentry's various formats to Record<string, string>
 *
 * Sentry can send tags as:
 * - Object: { "environment": "production", "release": "1.0.0" }
 * - Array of tuples: [["environment", "production"], ["release", "1.0.0"]]
 * - Array of objects: [{ "key": "environment", "value": "production" }]
 *
 * @pure
 */
export function normalizeTagsToObject(
  rawTags: unknown
): Record<string, string> {
  if (!rawTags) {
    return {};
  }

  // Already an object (most common case)
  if (typeof rawTags === "object" && !Array.isArray(rawTags)) {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      rawTags as Record<string, unknown>
    )) {
      if (typeof value === "string") {
        result[key] = value;
      } else if (value !== null && value !== undefined) {
        result[key] = String(value);
      }
    }
    return result;
  }

  // Array format
  if (Array.isArray(rawTags)) {
    const result: Record<string, string> = {};
    for (const item of rawTags) {
      // Tuple format: ["key", "value"]
      if (Array.isArray(item) && item.length >= 2) {
        const [key, value] = item;
        if (typeof key === "string") {
          result[key] = typeof value === "string" ? value : String(value ?? "");
        }
      }
      // Object format: { key: "environment", value: "production" }
      else if (
        item &&
        typeof item === "object" &&
        "key" in item &&
        "value" in item
      ) {
        const { key, value } = item as { key: unknown; value: unknown };
        if (typeof key === "string") {
          result[key] = typeof value === "string" ? value : String(value ?? "");
        }
      }
    }
    return result;
  }

  return {};
}

// ============================================================================
// DETERMINISTIC FINDINGS EXTRACTION
// ============================================================================

/**
 * Extract deterministic findings from analyzer result
 * @pure
 */
export function extractDeterministicFindings(
  analyzerResult: AnalyzerResult | null
): DeterministicFinding[] {
  if (!analyzerResult) {
    return [];
  }

  return analyzerResult.findings.map(transformFinding);
}

/**
 * Transform a single finding to DeterministicFinding
 * @pure
 */
export function transformFinding(
  finding: AnalyzerResult["findings"][number]
): DeterministicFinding {
  return {
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    confidence: finding.confidence,
    message: finding.message,
    evidence: {
      file_path: finding.evidence.file_path,
      line_number: finding.evidence.line_number,
      column_number: finding.evidence.column_number,
      snippet: finding.evidence.snippet,
      snippet_start_line: finding.evidence.snippet_start_line,
      snippet_end_line: finding.evidence.snippet_end_line,
      language: finding.evidence.language,
    },
    metadata: finding.metadata,
  };
}

// ============================================================================
// CODE FETCH SOURCE DETERMINATION
// ============================================================================

/**
 * Determine the source of code fetch for cache metrics
 * Returns the "worst case" source to incentivize cache improvements
 * @pure
 */
export function determineCodeFetchSource(
  codeResults: CodeFetchResult[]
): "github" | "redis_cache" | "s3_cache" | "embedded" | null {
  if (codeResults.length === 0) {
    return null;
  }

  const sources = codeResults
    .map((r) => r.source)
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  if (sources.length === 0) {
    // Fallback for results without source tracking
    return "github";
  }

  // Prioritize: if any came from GitHub, report github (worst case)
  if (sources.includes("github")) return "github";
  if (sources.includes("s3_cache")) return "s3_cache";
  if (sources.includes("redis_cache")) return "redis_cache";
  if (sources.includes("embedded")) return "embedded";

  return "github";
}

/**
 * Calculate cache hit rate from code results
 * @pure
 */
export function calculateCacheHitRate(codeResults: CodeFetchResult[]): number {
  if (codeResults.length === 0) return 0;

  const sources = codeResults
    .map((r) => r.source)
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  if (sources.length === 0) return 0;

  const cacheHits = sources.filter(
    (s) => s === "redis_cache" || s === "s3_cache" || s === "embedded"
  ).length;

  return cacheHits / sources.length;
}
