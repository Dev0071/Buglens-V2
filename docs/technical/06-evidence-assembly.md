# 06 - Evidence Assembly

## Overview

The Evidence Assembly subsystem collects, correlates, and packages all available evidence for Root Cause Analysis. It acts as the bridge between raw data collection (Sentry events, GitHub code, logs) and the LLM reasoning layer.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EVIDENCE ASSEMBLY                                     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      DATA SOURCES                                       │ │
│  │                                                                         │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │ │
│  │  │   Sentry    │ │   GitHub    │ │  Breadcrumb │ │   Commit    │       │ │
│  │  │   Event     │ │    Code     │ │    Logs     │ │   History   │       │ │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘       │ │
│  │         │               │               │               │              │ │
│  │         └───────────────┴───────────────┴───────────────┘              │ │
│  │                                   │                                     │ │
│  └───────────────────────────────────┼─────────────────────────────────────┘ │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    EVIDENCE COLLECTOR                                   │ │
│  │                                                                         │ │
│  │  ┌────────────────────────────────────────────────────────────────┐    │ │
│  │  │  1. extractErrorInfo()     - Parse error metadata              │    │ │
│  │  │  2. buildCodeContext()     - Assemble relevant code snippets   │    │ │
│  │  │  3. reconstructTimeline()  - Order breadcrumbs chronologically │    │ │
│  │  │  4. getRecentCommits()     - Fetch git history for context     │    │ │
│  │  │  5. calculateConfidence()  - Score evidence completeness       │    │ │
│  │  └────────────────────────────────────────────────────────────────┘    │ │
│  │                                                                         │ │
│  └─────────────────────────────────────┬───────────────────────────────────┘ │
│                                        │                                     │
│                                        ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      EVIDENCE BUNDLE                                    │ │
│  │                                                                         │ │
│  │  {                                                                      │ │
│  │    errorInfo:    { type, message, stack, fingerprint }                 │ │
│  │    codeContext:  { frames: [{ file, code, analysis }] }                │ │
│  │    timeline:     { events: [...], duration_ms }                        │ │
│  │    commits:      [{ sha, message, author, date }]                      │ │
│  │    metadata:     { confidence, completeness, gaps }                    │ │
│  │  }                                                                      │ │
│  │                                                                         │ │
│  │  Stored in: S3 (gzipped) + Postgres (metadata)                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                                  | Purpose                          |
| ------------------------------------- | -------------------------------- |
| `src/services/evidence-collector.ts`  | Main evidence collection service |
| `src/services/evidence-transforms.ts` | Pure transformation functions    |
| `python/timeline/reconstructor.py`    | Timeline reconstruction logic    |
| `python/evidence/bundle_builder.py`   | Evidence packaging for LLM       |

---

## Evidence Collector Service

### Class Structure

```typescript
// src/services/evidence-collector.ts
import {
  extractErrorInfo,
  buildCodeContext,
  transformCommit,
  calculateEvidenceConfidence,
} from "./evidence-transforms";
import { PythonBridge } from "./python-bridge";
import { GitHubService } from "./github";
import { CodeFetcherService } from "./code-fetcher";

export interface CollectEvidenceParams {
  eventId: string;
  orgId: string;
  eventData: SentryEvent;
  repo: string;
  ref: string;
}

export interface EvidenceBundle {
  errorInfo: ErrorInfo;
  codeContext: CodeContext;
  timeline: Timeline;
  commits: CommitInfo[];
  astFindings: ASTFinding[];
  metadata: EvidenceMetadata;
}

export class EvidenceCollectorService {
  private readonly codeFetcher: CodeFetcherService;
  private readonly github: GitHubService;
  private readonly pythonBridge: PythonBridge;

  constructor(
    deps: {
      codeFetcher?: CodeFetcherService;
      github?: GitHubService;
      pythonBridge?: PythonBridge;
    } = {}
  ) {
    this.codeFetcher = deps.codeFetcher ?? new CodeFetcherService();
    this.github = deps.github ?? new GitHubService();
    this.pythonBridge =
      deps.pythonBridge ??
      new PythonBridge({
        module: "timeline.reconstructor",
      });
  }

  async collect(params: CollectEvidenceParams): Promise<EvidenceBundle> {
    const { eventId, orgId, eventData, repo, ref } = params;

    // 1. Extract error info (pure function)
    const errorInfo = extractErrorInfo(eventData);

    // 2. Fetch code for each stack frame
    const codeResults = await this.fetchCodeForStackTrace(
      orgId,
      repo,
      ref,
      errorInfo.stack_trace
    );

    // 3. Build code context (pure function)
    const codeContext = buildCodeContext(codeResults);

    // 4. Run AST analysis on fetched code
    const astFindings = await this.runASTAnalysis(codeResults, errorInfo);

    // 5. Reconstruct timeline from breadcrumbs
    const timeline = await this.reconstructTimeline(
      eventData.breadcrumbs || []
    );

    // 6. Get recent commits for context
    const commits = await this.getRecentCommits(
      orgId,
      repo,
      errorInfo.stack_trace[0]?.file
    );

    // 7. Calculate metadata (pure function)
    const metadata = calculateEvidenceConfidence({
      errorInfo,
      codeContext,
      timeline,
      commits,
      astFindings,
    });

    return {
      errorInfo,
      codeContext,
      timeline,
      commits,
      astFindings,
      metadata,
    };
  }

  private async fetchCodeForStackTrace(
    orgId: string,
    repo: string,
    ref: string,
    stackTrace: StackFrame[]
  ): Promise<CodeFetchResult[]> {
    // Fetch code for top N frames (configurable)
    const maxFrames = config.EVIDENCE_MAX_FRAMES || 5;
    const framesToFetch = stackTrace
      .filter((frame) => frame.in_app !== false)
      .slice(0, maxFrames);

    const results = await Promise.all(
      framesToFetch.map((frame) =>
        this.codeFetcher
          .fetchWithContext({
            orgId,
            repo,
            ref,
            filePath: frame.file,
            lineNumber: frame.line,
            contextLines: 15,
          })
          .catch((error) => ({
            frame,
            error: error.message,
            code: null,
          }))
      )
    );

    return results;
  }

  private async runASTAnalysis(
    codeResults: CodeFetchResult[],
    errorInfo: ErrorInfo
  ): Promise<ASTFinding[]> {
    const allFindings: ASTFinding[] = [];

    for (const result of codeResults) {
      if (!result.code) continue;

      try {
        const analysisResult = await this.pythonBridge.analyze({
          sourceCode: result.code.fullFile,
          errorMessage: errorInfo.message,
          errorType: errorInfo.type,
          filePath: result.frame.file,
          lineNumber: result.frame.line,
        });

        allFindings.push(...analysisResult.findings);
      } catch (error) {
        logger.warn(
          {
            error,
            file: result.frame.file,
          },
          "AST analysis failed for file"
        );
      }
    }

    // Sort by confidence and dedupe
    return allFindings.sort((a, b) => b.confidence - a.confidence).slice(0, 10); // Top 10 findings
  }

  private async reconstructTimeline(
    breadcrumbs: Breadcrumb[]
  ): Promise<Timeline> {
    if (breadcrumbs.length === 0) {
      return { events: [], duration_ms: 0 };
    }

    // Use Python for complex timeline reconstruction
    const result = await this.pythonBridge.call("reconstruct_timeline", {
      breadcrumbs,
    });

    return result;
  }

  private async getRecentCommits(
    orgId: string,
    repo: string,
    filePath?: string
  ): Promise<CommitInfo[]> {
    try {
      const commits = await this.github.getRecentCommits(
        orgId,
        repo,
        filePath,
        10 // Last 10 commits
      );

      return commits.map(transformCommit);
    } catch (error) {
      logger.warn({ error, repo }, "Failed to fetch commits");
      return [];
    }
  }
}
```

---

## Evidence Transforms (Pure Functions)

```typescript
// src/services/evidence-transforms.ts

/**
 * Extract structured error information from Sentry event.
 * @pure - output depends only on input
 */
export function extractErrorInfo(eventData: SentryEvent): ErrorInfo {
  const rawPayload = eventData.raw_payload as Record<string, unknown>;
  const exception = rawPayload?.exception as ExceptionData | undefined;
  const firstException = exception?.values?.[0];

  return {
    message: eventData.message || firstException?.value || "Unknown error",
    type: firstException?.type || "Error",
    value: firstException?.value || eventData.message || "",
    stack_trace: transformStackFrames(firstException?.stacktrace?.frames || []),
    tags: eventData.tags || {},
    fingerprint: eventData.fingerprint,
    timestamp: eventData.timestamp,
  };
}

/**
 * Transform raw stack frames to normalized format.
 * @pure
 */
export function transformStackFrames(frames: RawStackFrame[]): StackFrame[] {
  return frames
    .filter((frame) => frame.filename) // Must have filename
    .map((frame) => ({
      file: cleanFilePath(frame.filename),
      line: frame.lineno,
      column: frame.colno,
      function: frame.function || "<anonymous>",
      context_line: frame.context_line,
      pre_context: frame.pre_context || [],
      post_context: frame.post_context || [],
      in_app: frame.in_app ?? isUserCode(frame.filename),
    }))
    .reverse(); // Sentry sends oldest first, we want newest first
}

/**
 * Clean and normalize file path.
 * @pure
 */
export function cleanFilePath(rawPath: string): string {
  let path = rawPath;

  // Remove webpack prefixes
  path = path.replace(/^webpack:\/\/[^/]+\//, "");
  path = path.replace(/^\[project\]\//, "");

  // Remove query strings
  path = path.split("?")[0];

  // Normalize node_modules paths
  path = path.replace(/.*node_modules\//, "node_modules/");

  return path;
}

/**
 * Determine if file is user code (not third-party).
 * @pure
 */
export function isUserCode(filePath: string): boolean {
  const thirdPartyPatterns = [
    /node_modules/,
    /\.next\/static/,
    /__webpack__/,
    /vendor\//,
    /polyfill/,
  ];

  return !thirdPartyPatterns.some((pattern) => pattern.test(filePath));
}

/**
 * Build code context from fetched code results.
 * @pure
 */
export function buildCodeContext(results: CodeFetchResult[]): CodeContext {
  const frames: CodeContextFrame[] = [];

  for (const result of results) {
    if (!result.code) {
      frames.push({
        file: result.frame.file,
        error: result.error || "Code not available",
        snippet: null,
      });
      continue;
    }

    frames.push({
      file: result.frame.file,
      line: result.frame.line,
      snippet: result.code.snippet,
      full_file: result.code.fullFile,
      highlighted_line: result.code.highlightedLine,
      language: detectLanguage(result.frame.file),
    });
  }

  return {
    frames,
    files_fetched: results.length,
    files_available: results.filter((r) => r.code).length,
  };
}

/**
 * Transform GitHub commit to simplified format.
 * @pure
 */
export function transformCommit(commit: GitHubCommit): CommitInfo {
  return {
    sha: commit.sha,
    short_sha: commit.sha.substring(0, 7),
    message: commit.message.split("\n")[0], // First line only
    author: commit.author,
    date: commit.date,
    files_changed: commit.files?.length || 0,
  };
}

/**
 * Calculate evidence confidence score.
 * @pure
 */
export function calculateEvidenceConfidence(
  bundle: Partial<EvidenceBundle>
): EvidenceMetadata {
  let score = 0;
  const gaps: string[] = [];

  // Error info (25 points max)
  if (bundle.errorInfo?.message) score += 10;
  if (bundle.errorInfo?.stack_trace?.length) {
    score += Math.min(bundle.errorInfo.stack_trace.length * 3, 15);
  }

  // Code context (30 points max)
  if (bundle.codeContext?.files_available) {
    score += Math.min(bundle.codeContext.files_available * 10, 30);
  } else {
    gaps.push("No source code available");
  }

  // AST findings (25 points max)
  if (bundle.astFindings?.length) {
    const highConfFindings = bundle.astFindings.filter(
      (f) => f.confidence > 0.7
    );
    score += Math.min(highConfFindings.length * 8, 25);
  } else {
    gaps.push("No deterministic findings");
  }

  // Timeline (10 points max)
  if (bundle.timeline?.events?.length) {
    score += Math.min(bundle.timeline.events.length, 10);
  } else {
    gaps.push("No breadcrumb timeline");
  }

  // Commits (10 points max)
  if (bundle.commits?.length) {
    score += Math.min(bundle.commits.length, 10);
  }

  return {
    confidence: Math.min(score, 100) / 100,
    completeness: score / 100,
    gaps,
    sources: {
      error: !!bundle.errorInfo,
      code: (bundle.codeContext?.files_available || 0) > 0,
      ast: (bundle.astFindings?.length || 0) > 0,
      timeline: (bundle.timeline?.events?.length || 0) > 0,
      commits: (bundle.commits?.length || 0) > 0,
    },
  };
}

/**
 * Detect programming language from file extension.
 * @pure
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rb: "ruby",
    go: "go",
    java: "java",
  };
  return langMap[ext || ""] || "unknown";
}
```

---

## Timeline Reconstruction (Python)

```python
# python/timeline/reconstructor.py
"""
Timeline reconstruction from Sentry breadcrumbs.

All functions are PURE - output depends only on input.
"""
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from datetime import datetime


@dataclass
class TimelineEvent:
    """A single event in the reconstructed timeline."""
    timestamp: str
    category: str
    message: str
    level: str
    data: Dict[str, Any]
    relative_ms: int  # Milliseconds before error


@dataclass
class Timeline:
    """Reconstructed timeline with events."""
    events: List[TimelineEvent]
    duration_ms: int
    error_timestamp: str


def reconstruct_timeline(
    breadcrumbs: List[Dict[str, Any]],
    error_timestamp: Optional[str] = None,
) -> Timeline:
    """
    Reconstruct chronological timeline from breadcrumbs.

    @pure - output depends only on inputs
    """
    if not breadcrumbs:
        return Timeline(events=[], duration_ms=0, error_timestamp='')

    # Sort by timestamp
    sorted_crumbs = sorted(
        breadcrumbs,
        key=lambda b: b.get('timestamp', ''),
    )

    # Determine error timestamp (last event or provided)
    if error_timestamp:
        error_ts = _parse_timestamp(error_timestamp)
    else:
        error_ts = _parse_timestamp(sorted_crumbs[-1].get('timestamp', ''))

    # Transform to timeline events
    events = []
    for crumb in sorted_crumbs:
        event = _transform_breadcrumb(crumb, error_ts)
        if event:
            events.append(event)

    # Calculate duration
    if events:
        duration_ms = abs(events[0].relative_ms - events[-1].relative_ms)
    else:
        duration_ms = 0

    return Timeline(
        events=events,
        duration_ms=duration_ms,
        error_timestamp=error_ts.isoformat() if error_ts else '',
    )


def _transform_breadcrumb(
    crumb: Dict[str, Any],
    error_ts: Optional[datetime],
) -> Optional[TimelineEvent]:
    """Transform single breadcrumb to timeline event."""
    timestamp_str = crumb.get('timestamp', '')
    if not timestamp_str:
        return None

    crumb_ts = _parse_timestamp(timestamp_str)

    # Calculate relative time (negative = before error)
    if crumb_ts and error_ts:
        relative_ms = int((crumb_ts - error_ts).total_seconds() * 1000)
    else:
        relative_ms = 0

    return TimelineEvent(
        timestamp=timestamp_str,
        category=crumb.get('category', 'default'),
        message=_extract_message(crumb),
        level=crumb.get('level', 'info'),
        data=crumb.get('data', {}),
        relative_ms=relative_ms,
    )


def _extract_message(crumb: Dict[str, Any]) -> str:
    """Extract human-readable message from breadcrumb."""
    # Direct message
    if crumb.get('message'):
        return crumb['message']

    # HTTP request
    if crumb.get('category') == 'http':
        method = crumb.get('data', {}).get('method', 'GET')
        url = crumb.get('data', {}).get('url', '')
        status = crumb.get('data', {}).get('status_code', '')
        return f"{method} {url} → {status}"

    # Console log
    if crumb.get('category') == 'console':
        return crumb.get('data', {}).get('message', '')

    # Navigation
    if crumb.get('category') == 'navigation':
        to_url = crumb.get('data', {}).get('to', '')
        return f"Navigate to {to_url}"

    # Click
    if crumb.get('category') == 'ui.click':
        target = crumb.get('message', '') or crumb.get('data', {}).get('target', '')
        return f"Click: {target}"

    # Default: use category
    return crumb.get('category', 'Event')


def _parse_timestamp(ts: str) -> Optional[datetime]:
    """Parse timestamp string to datetime."""
    if not ts:
        return None

    try:
        # ISO format
        if 'T' in ts:
            return datetime.fromisoformat(ts.replace('Z', '+00:00'))
        # Unix timestamp
        if ts.isdigit():
            return datetime.fromtimestamp(int(ts))
        # Float timestamp
        return datetime.fromtimestamp(float(ts))
    except (ValueError, TypeError):
        return None


def filter_relevant_events(
    timeline: Timeline,
    error_message: str,
    window_ms: int = 60000,  # 1 minute before error
) -> Timeline:
    """
    Filter timeline to events likely relevant to error.

    @pure
    """
    relevant = []

    for event in timeline.events:
        # Within time window
        if event.relative_ms < -window_ms:
            continue

        # High-signal categories
        if event.category in ('error', 'exception', 'http', 'fetch'):
            relevant.append(event)
            continue

        # Console errors/warnings
        if event.category == 'console' and event.level in ('error', 'warning'):
            relevant.append(event)
            continue

        # Failed HTTP requests
        if event.category == 'http':
            status = event.data.get('status_code', 200)
            if status >= 400:
                relevant.append(event)
                continue

    return Timeline(
        events=relevant,
        duration_ms=timeline.duration_ms,
        error_timestamp=timeline.error_timestamp,
    )


def summarize_timeline(timeline: Timeline) -> str:
    """
    Create human-readable timeline summary.

    @pure
    """
    if not timeline.events:
        return "No timeline events available."

    lines = []

    # Group by category
    by_category: Dict[str, List[TimelineEvent]] = {}
    for event in timeline.events:
        cat = event.category
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(event)

    lines.append(f"Timeline: {len(timeline.events)} events over {timeline.duration_ms}ms")
    lines.append("")

    for category, events in by_category.items():
        lines.append(f"[{category}] {len(events)} events:")
        for event in events[-3:]:  # Last 3 per category
            relative = _format_relative_time(event.relative_ms)
            lines.append(f"  {relative}: {event.message}")

    return '\n'.join(lines)


def _format_relative_time(ms: int) -> str:
    """Format relative time as human-readable string."""
    if ms == 0:
        return "at error"
    if ms > 0:
        return f"+{ms}ms"

    abs_ms = abs(ms)
    if abs_ms < 1000:
        return f"-{abs_ms}ms"
    if abs_ms < 60000:
        return f"-{abs_ms // 1000}s"
    return f"-{abs_ms // 60000}m"
```

---

## Evidence Storage

### S3 Storage (Evidence Bundles)

```typescript
// src/services/evidence-storage.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export class EvidenceStorageService {
  private s3: S3Client;
  private bucket: string;

  constructor() {
    this.s3 = new S3Client({ region: config.AWS_REGION });
    this.bucket = config.S3_EVIDENCE_BUCKET;
  }

  async store(
    orgId: string,
    eventId: string,
    bundle: EvidenceBundle
  ): Promise<string> {
    const key = `evidence/${orgId}/${eventId}.json.gz`;

    // Compress
    const json = JSON.stringify(bundle);
    const compressed = await gzipAsync(json);

    // Store
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: compressed,
        ContentType: "application/json",
        ContentEncoding: "gzip",
        Metadata: {
          "x-org-id": orgId,
          "x-event-id": eventId,
          "x-confidence": String(bundle.metadata.confidence),
        },
      })
    );

    // Also store metadata in Postgres for querying
    await this.storeMetadata(orgId, eventId, bundle.metadata);

    return key;
  }

  async retrieve(
    orgId: string,
    eventId: string
  ): Promise<EvidenceBundle | null> {
    const key = `evidence/${orgId}/${eventId}.json.gz`;

    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      const compressed = await response.Body?.transformToByteArray();
      if (!compressed) return null;

      const json = await gunzipAsync(Buffer.from(compressed));
      return JSON.parse(json.toString());
    } catch (error) {
      if (error.name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }

  private async storeMetadata(
    orgId: string,
    eventId: string,
    metadata: EvidenceMetadata
  ): Promise<void> {
    await pool.query(
      `
      INSERT INTO evidence_metadata (
        org_id, event_id, confidence, completeness,
        has_code, has_ast, has_timeline, has_commits, gaps
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (org_id, event_id) DO UPDATE SET
        confidence = EXCLUDED.confidence,
        completeness = EXCLUDED.completeness,
        updated_at = NOW()
    `,
      [
        orgId,
        eventId,
        metadata.confidence,
        metadata.completeness,
        metadata.sources.code,
        metadata.sources.ast,
        metadata.sources.timeline,
        metadata.sources.commits,
        metadata.gaps,
      ]
    );
  }
}
```

---

## Types

```typescript
// src/types/evidence.ts
export interface ErrorInfo {
  message: string;
  type: string;
  value: string;
  stack_trace: StackFrame[];
  tags: Record<string, string>;
  fingerprint?: string;
  timestamp: string;
}

export interface StackFrame {
  file: string;
  line: number;
  column?: number;
  function: string;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  in_app: boolean;
}

export interface CodeContext {
  frames: CodeContextFrame[];
  files_fetched: number;
  files_available: number;
}

export interface CodeContextFrame {
  file: string;
  line?: number;
  snippet?: string;
  full_file?: string;
  highlighted_line?: string;
  language?: string;
  error?: string;
}

export interface Timeline {
  events: TimelineEvent[];
  duration_ms: number;
  error_timestamp?: string;
}

export interface TimelineEvent {
  timestamp: string;
  category: string;
  message: string;
  level: string;
  data: Record<string, unknown>;
  relative_ms: number;
}

export interface CommitInfo {
  sha: string;
  short_sha: string;
  message: string;
  author: string;
  date: string;
  files_changed: number;
}

export interface ASTFinding {
  rule_id: string;
  title: string;
  severity: "high" | "medium" | "low";
  confidence: number;
  message: string;
  line_start: number;
  line_end: number;
  code_snippet: string;
  suggested_fix?: string;
}

export interface EvidenceMetadata {
  confidence: number;
  completeness: number;
  gaps: string[];
  sources: {
    error: boolean;
    code: boolean;
    ast: boolean;
    timeline: boolean;
    commits: boolean;
  };
}

export interface EvidenceBundle {
  errorInfo: ErrorInfo;
  codeContext: CodeContext;
  timeline: Timeline;
  commits: CommitInfo[];
  astFindings: ASTFinding[];
  metadata: EvidenceMetadata;
}
```

---

## Testing

```typescript
// tests/unit/evidence-transforms.test.ts
import { describe, it, expect } from "vitest";
import {
  extractErrorInfo,
  transformStackFrames,
  cleanFilePath,
  calculateEvidenceConfidence,
} from "../../src/services/evidence-transforms";

describe("extractErrorInfo", () => {
  it("extracts error info from Sentry event", () => {
    const event = {
      message: "Test error",
      raw_payload: {
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Cannot read property x of undefined",
              stacktrace: {
                frames: [{ filename: "app.js", lineno: 10, function: "test" }],
              },
            },
          ],
        },
      },
    };

    const info = extractErrorInfo(event as any);

    expect(info.type).toBe("TypeError");
    expect(info.value).toContain("Cannot read property");
    expect(info.stack_trace).toHaveLength(1);
  });
});

describe("cleanFilePath", () => {
  it("removes webpack prefixes", () => {
    expect(cleanFilePath("webpack://app/src/index.js")).toBe("src/index.js");
    expect(cleanFilePath("[project]/src/app.ts")).toBe("src/app.ts");
  });

  it("normalizes node_modules paths", () => {
    expect(cleanFilePath("/app/node_modules/lodash/index.js")).toBe(
      "node_modules/lodash/index.js"
    );
  });
});

describe("calculateEvidenceConfidence", () => {
  it("returns high confidence with complete evidence", () => {
    const bundle = {
      errorInfo: { message: "Error", stack_trace: [{ file: "a.js" }] },
      codeContext: { files_available: 3 },
      astFindings: [{ confidence: 0.9 }],
      timeline: { events: [{}] },
      commits: [{}],
    };

    const metadata = calculateEvidenceConfidence(bundle as any);

    expect(metadata.confidence).toBeGreaterThan(0.7);
    expect(metadata.gaps).toHaveLength(0);
  });

  it("identifies gaps when data missing", () => {
    const bundle = {
      errorInfo: { message: "Error" },
    };

    const metadata = calculateEvidenceConfidence(bundle as any);

    expect(metadata.confidence).toBeLessThan(0.3);
    expect(metadata.gaps).toContain("No source code available");
  });
});
```
