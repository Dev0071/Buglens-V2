import { v4 as uuidv4 } from "uuid";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { createGzip, createGunzip } from "zlib";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { transaction } from "../db/client.js";
import {
  fetchRecentCommits,
  parseRepoFullName,
  GitHubRateLimitError,
} from "./github.js";
import { PythonBridge } from "./python-bridge.js";
import type { GitHubCommit } from "../types/github.js";
import type {
  AnalyzerResult,
  DeterministicFinding,
} from "../types/analyzer.js";
import {
  type EvidenceBundle,
  type CommitInfo,
  type ErrorInfo,
  type CodeContext,
  type Timeline,
  type TimelineStep,
  type EnvironmentContext,
  type EvidenceStorageRef,
  type EvidenceCollectorConfig,
  DEFAULT_EVIDENCE_CONFIG,
  evidenceBundleSchema,
} from "../types/evidence.js";

// ============================================
// S3 Client for Evidence Storage
// ============================================

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  s3Client = new S3Client({
    region: config.AWS_REGION,
    ...(config.S3_ENDPOINT
      ? {
          endpoint: config.S3_ENDPOINT,
          forcePathStyle: true,
        }
      : {}),
    ...(config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: config.AWS_ACCESS_KEY_ID,
            secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });

  return s3Client;
}

// ============================================
// Compression Utilities
// ============================================

async function compressContent(content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gzip = createGzip();

    gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));
    gzip.on("error", reject);

    gzip.write(content);
    gzip.end();
  });
}

async function decompressContent(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gunzip = createGunzip();

    gunzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gunzip.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    gunzip.on("error", reject);

    gunzip.write(buffer);
    gunzip.end();
  });
}

// ============================================
// Evidence Collector Service
// ============================================

export interface CollectEvidenceParams {
  orgId: string;
  eventId: string;
  jobId: string;
  installationId: string;
  repo: string;
  commitSha: string | null;
}

export interface EventData {
  sentry_event_id: string;
  message: string;
  environment: string | null;
  release: string | null;
  stack_trace: unknown;
  breadcrumbs: unknown;
  context: unknown;
  raw_payload: unknown;
}

export interface CodeFetchResult {
  file: {
    path: string;
    content: string;
    language: string | null;
  };
  context: {
    line_number: number;
    column_number: number | null;
    snippet_start: number;
    snippet_end: number;
    source_map_resolved: boolean;
  };
  /** Source of the code fetch - tracks cache hit rate (target >75%) */
  source?: "github" | "redis_cache" | "s3_cache" | "embedded";
}

export class EvidenceCollectorService {
  private readonly pythonBridge: PythonBridge;
  private readonly config: EvidenceCollectorConfig;

  constructor(
    deps: {
      pythonBridge?: PythonBridge;
      config?: Partial<EvidenceCollectorConfig>;
    } = {}
  ) {
    this.pythonBridge =
      deps.pythonBridge ??
      new PythonBridge({ module: "timeline.reconstructor" });
    this.config = { ...DEFAULT_EVIDENCE_CONFIG, ...deps.config };
  }

  /**
   * Collect all evidence for an RCA job
   */
  async collect(
    params: CollectEvidenceParams,
    eventData: EventData,
    codeResults: CodeFetchResult[],
    analyzerResult: AnalyzerResult | null
  ): Promise<EvidenceBundle> {
    const bundleId = uuidv4();
    const startedAt = new Date().toISOString();

    logger.info(
      { bundleId, orgId: params.orgId, jobId: params.jobId },
      "Starting evidence collection"
    );

    // 1. Extract error info from event
    const errorInfo = this.extractErrorInfo(eventData);

    // 2. Build code context from fetched code
    const codeContext = this.buildCodeContext(
      codeResults,
      params.repo,
      params.commitSha
    );

    // 3. Get recent commits for the error file
    const recentCommits = await this.fetchRecentCommits(
      params,
      codeContext.primary?.file_path ?? null
    );

    // 4. Reconstruct timeline from breadcrumbs
    const timeline = await this.reconstructTimeline(eventData.breadcrumbs);

    // 5. Extract environment context
    const environmentContext = this.extractEnvironmentContext(eventData);

    // 6. Extract deterministic findings
    const deterministicFindings =
      this.extractDeterministicFindings(analyzerResult);

    // 7. Determine code fetch source
    const codeFetchSource = this.determineCodeFetchSource(codeResults);

    // Build the complete evidence bundle
    const bundle: EvidenceBundle = {
      bundle_id: bundleId,
      created_at: new Date().toISOString(),
      org_id: params.orgId,
      event_id: params.eventId,
      job_id: params.jobId,

      error: errorInfo,
      code: codeContext,
      deterministic_findings: deterministicFindings,
      timeline,
      recent_commits: recentCommits,
      environment: environmentContext,

      metadata: {
        sentry_event_id: eventData.sentry_event_id,
        processing_started_at: startedAt,
        code_fetch_source: codeFetchSource,
        source_map_used: codeResults.some((r) => r.context.source_map_resolved),
        validation_passed: true, // Will be updated after validation
        validation_errors: undefined,
      },
    };

    // Validate the bundle and flag if invalid
    const validationResult = evidenceBundleSchema.safeParse(bundle);
    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(
        (e) => `${e.path.join(".")}: ${e.message}`
      );
      logger.error(
        { errors: errorMessages, bundleId },
        "Evidence bundle validation failed - flagging for downstream systems"
      );
      // Flag the bundle as invalid so downstream systems can handle appropriately
      bundle.metadata.validation_passed = false;
      bundle.metadata.validation_errors = errorMessages;
    } else {
      bundle.metadata.validation_passed = true;
    }

    logger.info(
      {
        bundleId,
        findingsCount: deterministicFindings.length,
        commitsCount: recentCommits.length,
        timelineSteps: timeline?.steps.length ?? 0,
      },
      "Evidence collection complete"
    );

    return bundle;
  }

  /**
   * Store evidence bundle in S3
   */
  async storeInS3(bundle: EvidenceBundle): Promise<EvidenceStorageRef> {
    // Add date-based prefix for better S3 performance and organization
    const date = new Date(bundle.created_at);
    const datePrefix = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
    const key = `evidence/${datePrefix}/${bundle.org_id}/${bundle.job_id}/${bundle.bundle_id}.json.gz`;

    const jsonContent = JSON.stringify(bundle);
    const compressed = await compressContent(jsonContent);

    const s3 = getS3Client();
    await s3.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET_NAME,
        Key: key,
        Body: compressed,
        ContentType: "application/json",
        ContentEncoding: "gzip",
        Metadata: {
          org_id: bundle.org_id,
          event_id: bundle.event_id,
          job_id: bundle.job_id,
          bundle_id: bundle.bundle_id,
          created_at: bundle.created_at,
        },
      })
    );

    logger.info({ key, sizeBytes: compressed.length }, "Evidence stored in S3");

    return {
      bucket: config.S3_BUCKET_NAME,
      key,
      size_bytes: compressed.length,
      compressed: true,
      created_at: new Date(),
    };
  }

  /**
   * Retrieve evidence bundle from S3
   */
  async retrieveFromS3(
    orgId: string,
    jobId: string,
    bundleId: string
  ): Promise<EvidenceBundle | null> {
    const key = `evidence/${orgId}/${jobId}/${bundleId}.json.gz`;

    try {
      const s3 = getS3Client();
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: config.S3_BUCKET_NAME,
          Key: key,
        })
      );

      if (!response.Body) {
        return null;
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const jsonStr = await decompressContent(buffer);

      return JSON.parse(jsonStr) as EvidenceBundle;
    } catch (error: unknown) {
      const e = error as { name?: string };
      if (e.name === "NoSuchKey") {
        return null;
      }
      logger.error({ error, key }, "Failed to retrieve evidence from S3");
      throw error;
    }
  }

  /**
   * Update RCA job with evidence reference
   */
  async updateJobWithEvidence(
    orgId: string,
    jobId: string,
    storageRef: EvidenceStorageRef
  ): Promise<void> {
    await transaction(orgId, async (client) => {
      await client.query(
        `UPDATE rca_jobs
         SET code_context_s3_url = $1,
             updated_at = NOW()
         WHERE id = $2 AND org_id = $3`,
        [`s3://${storageRef.bucket}/${storageRef.key}`, jobId, orgId]
      );
    });
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  private extractErrorInfo(eventData: EventData): ErrorInfo {
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

    const frames = (stacktrace?.frames ?? []) as Array<{
      filename?: string;
      lineno?: number;
      colno?: number;
      function?: string;
      in_app?: boolean;
    }>;

    return {
      message: eventData.message,
      type: primaryException?.type ?? "Error",
      value: primaryException?.value ?? eventData.message,
      stack_trace: frames.map((frame) => ({
        file: frame.filename ?? "unknown",
        line: frame.lineno ?? null,
        column: frame.colno ?? null,
        function: frame.function ?? null,
        in_app: frame.in_app ?? true,
      })),
    };
  }

  private buildCodeContext(
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

    const toCodeContext = (result: CodeFetchResult): CodeContext => ({
      file_path: result.file.path,
      line_number: result.context.line_number,
      column_number: result.context.column_number,
      snippet: result.file.content,
      snippet_start_line: result.context.snippet_start,
      snippet_end_line: result.context.snippet_end,
      language: result.file.language ?? "text",
      source_map_resolved: result.context.source_map_resolved,
    });

    return {
      primary: toCodeContext(codeResults[0]),
      related: codeResults.slice(1).map(toCodeContext),
      repo,
      commit_sha: commitSha,
    };
  }

  private async fetchRecentCommits(
    params: CollectEvidenceParams,
    filePath: string | null
  ): Promise<CommitInfo[]> {
    if (!filePath) {
      logger.debug(
        { jobId: params.jobId },
        "No file path for recent commits fetch"
      );
      return [];
    }

    try {
      const { owner, repo } = parseRepoFullName(params.repo);
      const commits = await fetchRecentCommits(
        params.installationId,
        owner,
        repo,
        filePath,
        this.config.maxCommits,
        params.orgId
      );

      return commits.map((commit) => this.transformCommit(commit));
    } catch (error) {
      if (error instanceof GitHubRateLimitError) {
        logger.warn(
          { orgId: params.orgId },
          "Skipping recent commits due to rate limit"
        );
      } else {
        logger.error({ error, filePath }, "Failed to fetch recent commits");
      }
      return [];
    }
  }

  private transformCommit(commit: GitHubCommit): CommitInfo {
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
      files_changed: undefined, // Would require additional API call
      additions: undefined,
      deletions: undefined,
    };
  }

  private async reconstructTimeline(
    breadcrumbs: unknown
  ): Promise<Timeline | null> {
    if (!breadcrumbs || !Array.isArray(breadcrumbs)) {
      return null;
    }

    if (breadcrumbs.length === 0) {
      return {
        steps: [],
        anomalies_count: 0,
        duration_ms: 0,
        first_timestamp: null,
        last_timestamp: null,
        http_requests: 0,
        errors_before_crash: 0,
      };
    }

    try {
      // Call Python timeline reconstructor
      const result = await this.pythonBridge.execute<
        { breadcrumbs: unknown[] },
        Timeline
      >({
        breadcrumbs: breadcrumbs.slice(0, this.config.maxTimelineSteps),
      });

      return result;
    } catch (error) {
      logger.error({ error }, "Timeline reconstruction failed, using fallback");
      // Fallback: basic timeline without anomaly detection
      return this.buildFallbackTimeline(breadcrumbs);
    }
  }

  private buildFallbackTimeline(breadcrumbs: unknown[]): Timeline {
    const steps: TimelineStep[] = [];
    let httpRequests = 0;
    let errorsBefore = 0;

    for (const crumb of breadcrumbs.slice(0, this.config.maxTimelineSteps)) {
      const bc = crumb as Record<string, unknown>;
      const timestamp = bc.timestamp as string | number | undefined;
      const timestampMs =
        typeof timestamp === "number"
          ? timestamp * 1000
          : timestamp
            ? new Date(timestamp).getTime()
            : Date.now();

      const type = this.mapBreadcrumbType(bc.type as string | undefined);
      const level = this.mapBreadcrumbLevel(bc.level as string | undefined);

      if (type === "http") httpRequests++;
      if (level === "error" || level === "fatal") errorsBefore++;

      steps.push({
        timestamp: new Date(timestampMs).toISOString(),
        timestamp_ms: timestampMs,
        type,
        category: bc.category as string | undefined,
        message: (bc.message as string) ?? "",
        data: bc.data as Record<string, unknown> | undefined,
        level,
        is_anomaly: false,
      });
    }

    const timestamps = steps.map((s) => s.timestamp_ms).sort((a, b) => a - b);
    const firstTs = timestamps[0];
    const lastTs = timestamps[timestamps.length - 1];

    return {
      steps,
      anomalies_count: 0,
      duration_ms: lastTs - firstTs,
      first_timestamp: steps[0]?.timestamp ?? null,
      last_timestamp: steps[steps.length - 1]?.timestamp ?? null,
      http_requests: httpRequests,
      errors_before_crash: errorsBefore,
    };
  }

  private mapBreadcrumbType(type: string | undefined): TimelineStep["type"] {
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

  private mapBreadcrumbLevel(level: string | undefined): TimelineStep["level"] {
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

  private extractEnvironmentContext(eventData: EventData): EnvironmentContext {
    const context = eventData.context as Record<string, unknown> | null;
    const rawPayload = eventData.raw_payload as Record<string, unknown> | null;
    const contexts = (context?.contexts ?? rawPayload?.contexts) as
      | Record<string, unknown>
      | undefined;
    const tags = (context?.tags ?? rawPayload?.tags) as
      | Record<string, string>
      | undefined;

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
      sdk: sdk
        ? { name: sdk.name ?? null, version: sdk.version ?? null }
        : null,
      tags: tags ?? {},
    };
  }

  private extractDeterministicFindings(
    analyzerResult: AnalyzerResult | null
  ): DeterministicFinding[] {
    if (!analyzerResult) {
      return [];
    }

    return analyzerResult.findings.map((finding) => ({
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
    }));
  }

  private determineCodeFetchSource(
    codeResults: CodeFetchResult[]
  ): "github" | "cache" | "embedded" | null {
    if (codeResults.length === 0) {
      return null;
    }

    // Track actual source from code results for cache hit metrics
    const sources = codeResults
      .map((r) => r.source)
      .filter((s): s is NonNullable<typeof s> => s !== undefined);

    if (sources.length === 0) {
      // Fallback for results without source tracking (tech debt)
      logger.debug(
        { resultsCount: codeResults.length },
        "Code results missing source field - cannot determine cache hit rate"
      );
      return "github"; // Conservative assumption
    }

    // Prioritize: if any came from GitHub, report github (worst case for metrics)
    // This incentivizes improving cache hit rate
    if (sources.includes("github")) {
      return "github";
    }
    if (sources.includes("redis_cache") || sources.includes("s3_cache")) {
      return "cache";
    }
    if (sources.includes("embedded")) {
      return "embedded";
    }

    return "github";
  }
}

// Export singleton instance
export const evidenceCollectorService = new EvidenceCollectorService();
