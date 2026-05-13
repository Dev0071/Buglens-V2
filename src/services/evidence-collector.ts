import { v4 as uuidv4 } from "uuid";
import {
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { createGzip, createGunzip } from "zlib";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { getSharedS3Client, isS3Configured } from "../utils/s3-client.js";
import { query, transaction } from "../db/client.js";
import {
  fetchRecentCommits,
  parseRepoFullName,
  GitHubRateLimitError,
} from "./github.js";
import { PythonBridge } from "./python-bridge.js";
import type { AnalyzerResult } from "../types/analyzer.js";
import {
  type EvidenceBundle,
  type CommitInfo,
  type Timeline,
  type EvidenceStorageRef,
  type EvidenceCollectorConfig,
  DEFAULT_EVIDENCE_CONFIG,
  evidenceBundleSchema,
} from "../types/evidence.js";
// Import pure transform functions (functional paradigm)
import {
  extractErrorInfo,
  buildCodeContext,
  transformCommit,
  extractEnvironmentContext,
  extractDeterministicFindings,
  determineCodeFetchSource,
  buildFallbackTimeline,
} from "./evidence-transforms.js";

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
   *
   * This method orchestrates the evidence collection process using pure
   * transform functions from evidence-transforms.ts for all stateless operations.
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

    // 1. Extract error info from event (pure function)
    const errorInfo = extractErrorInfo(eventData);

    // 2. Build code context from fetched code (pure function)
    const codeContext = buildCodeContext(
      codeResults,
      params.repo,
      params.commitSha
    );

    // 3. Get recent commits for the error file (async I/O operation)
    const recentCommits = await this.fetchRecentCommits(
      params,
      codeContext.primary?.file_path ?? null
    );

    // 4. Reconstruct timeline from breadcrumbs (async - may call Python)
    const timeline = await this.reconstructTimeline(eventData.breadcrumbs);

    // 5. Extract environment context (pure function)
    const environmentContext = extractEnvironmentContext(eventData);

    // 6. Extract deterministic findings (pure function)
    const deterministicFindings = extractDeterministicFindings(analyzerResult);

    // 7. Determine code fetch source (pure function)
    const codeFetchSource = determineCodeFetchSource(codeResults);

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
   * Store evidence bundle in S3 or fall back to database when S3 is not configured.
   *
   * Falls back to database when credentials or bucket are missing — this keeps the
   * pipeline running in staging/dev without DO Spaces configured. The LLM reasoning
   * worker detects the "local-db" bucket marker and loads from the database instead.
   */
  async storeInS3(bundle: EvidenceBundle): Promise<EvidenceStorageRef> {
    const date = new Date(bundle.created_at);
    const datePrefix = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
    const key = `evidence/${datePrefix}/${bundle.org_id}/${bundle.job_id}/${bundle.bundle_id}.json.gz`;

    if (!isS3Configured()) {
      logger.info(
        { bundleId: bundle.bundle_id, key },
        "S3 not configured: storing evidence bundle in database"
      );
      await this.storeInDatabase(bundle, key);
      return {
        bucket: "local-db",
        key,
        size_bytes: JSON.stringify(bundle).length,
        compressed: false,
        created_at: new Date(),
      };
    }

    const jsonContent = JSON.stringify(bundle);
    const compressed = await compressContent(jsonContent);

    const s3 = getSharedS3Client();
    try {
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
    } catch (error: unknown) {
      const e = error as { name?: string; Code?: string };
      const code = e.name ?? e.Code ?? "";
      if (code === "SignatureDoesNotMatch" || code === "InvalidAccessKeyId" || code === "AuthorizationQueryParametersError") {
        logger.error(
          { bundleId: bundle.bundle_id, key, errorCode: code },
          "S3 credentials invalid: falling back to database storage"
        );
        await this.storeInDatabase(bundle, key);
        return {
          bucket: "local-db",
          key,
          size_bytes: jsonContent.length,
          compressed: false,
          created_at: new Date(),
        };
      }
      throw error;
    }

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
   * Retrieve evidence bundle from S3 using the storage key
   * Note: Use the key from EvidenceStorageRef returned by storeInS3()
   */
  async retrieveFromS3(key: string): Promise<EvidenceBundle | null> {
    try {
      const s3 = getSharedS3Client();
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
   * Retrieve evidence bundle stored in the database (local-db fallback path).
   * Used by the LLM reasoning worker when S3 wasn't configured at assembly time.
   */
  async retrieveFromDatabase(
    jobId: string,
    orgId: string
  ): Promise<EvidenceBundle | null> {
    const result = await query<{ evidence_bundle: unknown }>(
      `SELECT evidence_bundle FROM rca_jobs WHERE id = $1 AND org_id = $2`,
      [jobId, orgId]
    );
    const raw = result.rows[0]?.evidence_bundle;
    if (!raw) return null;
    return typeof raw === "string"
      ? (JSON.parse(raw) as EvidenceBundle)
      : (raw as EvidenceBundle);
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
  // Private Helper Methods (I/O operations only)
  // ============================================

  /**
   * Fetch recent commits from GitHub for a file path
   * Note: This method handles I/O and delegates to pure transforms
   */
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

      // Use pure transform function
      return commits.map(transformCommit);
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

  /**
   * Reconstruct timeline from breadcrumbs
   * Note: Attempts Python bridge, falls back to pure function
   */
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
      // Fallback: use pure function for basic timeline
      return buildFallbackTimeline(breadcrumbs, this.config.maxTimelineSteps);
    }
  }

  /**
   * Store evidence bundle in database (development fallback)
   * Uses the rca_jobs table's evidence_bundle column
   */
  private async storeInDatabase(
    bundle: EvidenceBundle,
    key: string
  ): Promise<void> {
    await transaction(bundle.org_id, async (client) => {
      await client.query(
        `UPDATE rca_jobs
         SET evidence_bundle = $1::jsonb,
             code_context_s3_url = $2,
             updated_at = NOW()
         WHERE id = $3 AND org_id = $4`,
        [JSON.stringify(bundle), `local://${key}`, bundle.job_id, bundle.org_id]
      );
    });

    logger.debug(
      { bundleId: bundle.bundle_id, jobId: bundle.job_id },
      "Evidence bundle stored in database"
    );
  }
}

// Note: Do NOT export a singleton instance here.
// Consumers should instantiate EvidenceCollectorService directly to enable
// dependency injection for testing and configuration flexibility.
