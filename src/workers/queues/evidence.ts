import { Queue, Worker, Job, type ConnectionOptions } from "bullmq";
import { URL } from "node:url";
import { config } from "../../utils/config.js";
import { logger } from "../../utils/logger.js";
import { transaction } from "../../db/client.js";
import {
  EvidenceCollectorService,
  type CollectEvidenceParams,
  type EventData,
  type CodeFetchResult,
} from "../../services/evidence-collector.js";
import type { AnalyzerResult } from "../../types/analyzer.js";
import { enqueueLLMReasoning } from "./llm-reasoning.js";

// ============================================
// Queue Configuration
// ============================================

const QUEUE_NAME = "evidence-assembly";

export interface EvidenceAssemblyJobData {
  jobId: string;
  eventId: string;
  orgId: string;
}

// ============================================
// Queue Instance
// ============================================

let evidenceQueue: Queue<EvidenceAssemblyJobData> | null = null;

// Test mode buffer for integration testing
const testModeBuffer: EvidenceAssemblyJobData[] = [];
let testMode = false;

export function enableTestMode(): void {
  testMode = true;
}

export function disableTestMode(): void {
  testMode = false;
  testModeBuffer.length = 0;
}

export function getTestModeJobs(): EvidenceAssemblyJobData[] {
  return [...testModeBuffer];
}

export function resolveQueueConnection(): ConnectionOptions {
  const redisUrl = config.REDIS_URL;
  const isTls = redisUrl.startsWith("rediss://");
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname ? Number(parsed.pathname.replace("/", "")) || 0 : 0,
    maxRetriesPerRequest: null,
    ...(isTls
      ? {
          tls: {
            rejectUnauthorized: false,
          },
        }
      : {}),
  };
}

export function getEvidenceQueue(): Queue<EvidenceAssemblyJobData> {
  if (!evidenceQueue) {
    evidenceQueue = new Queue<EvidenceAssemblyJobData>(QUEUE_NAME, {
      connection: resolveQueueConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: {
          age: 86400, // 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 604800, // 7 days
        },
      },
    });
  }
  return evidenceQueue;
}

// ============================================
// Job Enqueue Function
// ============================================

export async function enqueueEvidenceAssembly(
  data: EvidenceAssemblyJobData
): Promise<void> {
  if (testMode) {
    testModeBuffer.push(data);
    logger.debug({ jobId: data.jobId }, "Evidence job buffered in test mode");
    return;
  }

  const queue = getEvidenceQueue();
  await queue.add(`evidence-${data.jobId}`, data, {
    jobId: `evidence-${data.jobId}`,
  });

  // Note: Log is in the caller (deterministic-analyzer.ts) to avoid duplicates
  logger.debug(
    { jobId: data.jobId, orgId: data.orgId, queue: "evidence-assembly" },
    "Evidence job added to queue"
  );
}

// ============================================
// Worker Processing
// ============================================

interface JobRowWithDetails {
  id: string;
  event_id: string;
  deterministic_findings: AnalyzerResult | null;
  code_context: CodeContextData | null;
  sentry_event_id: string;
  message: string;
  environment: string | null;
  release: string | null;
  stack_trace: unknown;
  breadcrumbs: unknown;
  context: unknown;
  raw_payload: unknown;
  repo_full_name: string;
  installation_id: string | null;
}

interface CodeContextData {
  fetched_at: string;
  repo: string;
  commit_sha: string;
  files: Array<{
    path: string;
    content: string;
    language: string;
    line_number: number;
    column_number: number | null;
    source_map_resolved?: boolean;
  }>;
}

async function loadJobWithEventData(
  orgId: string,
  jobId: string
): Promise<JobRowWithDetails> {
  return transaction(orgId, async (client) => {
    const result = await client.query<JobRowWithDetails>(
      `SELECT
         j.id,
         j.event_id,
         j.deterministic_findings,
         j.code_context,
         e.sentry_event_id,
         e.message,
         e.environment,
         e.release,
         e.stack_trace,
         e.breadcrumbs,
         e.context,
         e.raw_payload,
         r.full_name as repo_full_name,
         r.installation_id
       FROM rca_jobs j
       INNER JOIN events e ON e.id = j.event_id
       INNER JOIN repos r ON r.org_id = j.org_id AND r.is_active = true
       WHERE j.id = $1 AND j.org_id = $2
       LIMIT 1`,
      [jobId, orgId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Job ${jobId} not found`);
    }

    return result.rows[0];
  });
}

/**
 * Process evidence assembly job
 *
 * Steps:
 * 1. Load job and event data from database
 * 2. Extract code results from deterministic findings
 * 3. Build event data structure for evidence bundle
 * 4. Collect evidence (error info, code context, commits, timeline)
 * 5. Store bundle in S3
 * 6. Update job with S3 reference
 * 7. Mark job as evidence complete
 */
async function processEvidenceJob(
  job: Job<EvidenceAssemblyJobData>
): Promise<void> {
  const { jobId, eventId, orgId } = job.data;
  const startTime = Date.now();

  logger.info(
    {
      jobId,
      eventId,
      orgId,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts || 3,
      worker: "evidence-assembly",
    },
    "[JOB:START] Evidence assembly starting"
  );

  try {
    // Step 1: Load job and event data
    logger.debug({ jobId, step: 1 }, "[STEP] Loading job and event data");
    const jobRow = await loadJobWithEventData(orgId, jobId);

    if (!jobRow.installation_id) {
      throw new Error("Repository missing GitHub installation ID");
    }

    logger.debug(
      {
        jobId,
        repo: jobRow.repo_full_name,
        hasDeterministicFindings: !!jobRow.deterministic_findings,
        findingsCount: jobRow.deterministic_findings?.findings?.length ?? 0,
        hasCodeContext: !!jobRow.code_context,
        codeContextFiles: jobRow.code_context?.files?.length ?? 0,
      },
      "[STEP] Job data loaded"
    );

    // Step 2: Get code results - prefer stored code_context over extracting from findings
    logger.debug({ jobId, step: 2 }, "[STEP] Getting code results");
    const codeResults: CodeFetchResult[] = extractCodeResults(
      jobRow.code_context,
      jobRow.deterministic_findings
    );

    // Step 3: Build event data structure
    const eventData: EventData = {
      sentry_event_id: jobRow.sentry_event_id,
      message: jobRow.message,
      environment: jobRow.environment,
      release: jobRow.release,
      stack_trace: jobRow.stack_trace,
      breadcrumbs: jobRow.breadcrumbs,
      context: jobRow.context,
      raw_payload: jobRow.raw_payload,
    };

    // Step 4: Collect evidence params
    const collectParams: CollectEvidenceParams = {
      orgId,
      eventId,
      jobId,
      installationId: jobRow.installation_id,
      repo: jobRow.repo_full_name,
      commitSha: extractCommitSha(jobRow.release),
    };

    // Step 5: Run evidence collection
    logger.debug(
      { jobId, step: 5, repo: jobRow.repo_full_name },
      "[STEP] Collecting evidence bundle"
    );
    const evidenceCollector = new EvidenceCollectorService();
    const bundle = await evidenceCollector.collect(
      collectParams,
      eventData,
      codeResults,
      jobRow.deterministic_findings
    );

    logger.debug(
      {
        jobId,
        bundleId: bundle.bundle_id,
        hasError: !!bundle.error,
        hasCode: !!bundle.code,
        commitCount: bundle.recent_commits?.length ?? 0,
      },
      "[STEP] Evidence bundle assembled"
    );

    // Step 6: Store in S3
    logger.debug({ jobId, step: 6 }, "[STEP] Storing bundle in S3");
    const storageRef = await evidenceCollector.storeInS3(bundle);

    // Step 7: Update job with S3 reference
    logger.debug({ jobId, step: 7 }, "[STEP] Updating job with S3 reference");
    await evidenceCollector.updateJobWithEvidence(orgId, jobId, storageRef);

    // Step 8: Mark job as evidence complete
    await markEvidenceComplete(orgId, jobId);

    // Step 9: Enqueue LLM reasoning job
    logger.info(
      { jobId, eventId, orgId },
      "[PIPELINE:HANDOFF] Enqueueing LLM reasoning job"
    );
    await enqueueLLMReasoning({ jobId, eventId, orgId });

    const durationMs = Date.now() - startTime;
    logger.info(
      {
        jobId,
        eventId,
        orgId,
        durationMs,
        durationSec: (durationMs / 1000).toFixed(2),
        bundleId: bundle.bundle_id,
        s3Key: storageRef.key,
        worker: "evidence-assembly",
        status: "success",
      },
      "[JOB:SUCCESS] Evidence assembly completed"
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const err = error instanceof Error ? error : new Error(String(error));
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 3);

    logger.error(
      {
        jobId,
        eventId,
        orgId,
        durationMs,
        attempt: job.attemptsMade + 1,
        error: err.message,
        errorStack: err.stack,
        isLastAttempt,
        worker: "evidence-assembly",
        status: "failed",
      },
      "[JOB:ERROR] Evidence assembly failed"
    );

    // Only mark job as permanently failed if this is the last attempt
    // For retryable failures, keep status so retry can pick it up
    if (isLastAttempt) {
      await markEvidenceFailed(orgId, jobId, err.message);
    }
    throw error;
  }
}

/**
 * Extract code results for evidence bundle
 *
 * Prefers stored code_context (full file content from deterministic phase)
 * over extracting snippets from findings.
 */
function extractCodeResults(
  codeContext: CodeContextData | null,
  findings: AnalyzerResult | null
): CodeFetchResult[] {
  // Prefer code_context if available (full file content)
  if (codeContext?.files && codeContext.files.length > 0) {
    logger.info(
      { filesCount: codeContext.files.length },
      "Using stored code context (full file content) for LLM reasoning"
    );

    return codeContext.files.map((file) => ({
      file: {
        path: file.path,
        content: file.content,
        language: file.language,
      },
      context: {
        line_number: file.line_number,
        column_number: file.column_number,
        snippet_start: Math.max(1, file.line_number - 50), // Full context ±50 lines
        snippet_end: file.line_number + 50,
        source_map_resolved: file.source_map_resolved ?? false,
      },
    }));
  }

  // Fall back to extracting from findings (legacy path)
  return extractCodeResultsFromFindings(findings);
}

/**
 * @deprecated Use extractCodeResults which prefers stored code_context
 * Legacy function that extracts snippets from findings
 */
function extractCodeResultsFromFindings(
  findings: AnalyzerResult | null
): CodeFetchResult[] {
  /**
   * LEGACY FALLBACK - Prefer stored code_context
   * =============================================
   * This extracts snippets from findings, NOT full file content.
   * Only used when code_context is not available (older jobs).
   *
   * Impact on RCA Quality:
   * - LLM won't have full context around the error location
   * - Missing imports, function definitions, or relevant nearby code
   */
  if (!findings || findings.findings.length === 0) {
    return [];
  }

  logger.warn(
    { findingsCount: findings.findings.length },
    "LEGACY: Using snippet extraction from findings - code_context not available"
  );

  return findings.findings.map((finding) => ({
    file: {
      path: finding.evidence.file_path,
      content: finding.evidence.snippet,
      language: finding.evidence.language || "text",
    },
    context: {
      line_number: finding.evidence.line_number,
      column_number: finding.evidence.column_number ?? null,
      snippet_start:
        finding.evidence.snippet_start_line ??
        finding.evidence.line_number - 10,
      snippet_end:
        finding.evidence.snippet_end_line ?? finding.evidence.line_number + 10,
      source_map_resolved: false,
    },
  }));
}

// Git short SHA (exactly 7 chars) or full SHA (exactly 40 chars)
const GIT_SHA_REGEX = /^[0-9a-f]{7}$|^[0-9a-f]{40}$/i;

function extractCommitSha(release: string | null): string | null {
  if (!release) return null;

  // Try to extract SHA from release string
  // Format: "owner/repo@sha" or just "sha"
  const atIndex = release.indexOf("@");
  if (atIndex !== -1) {
    const sha = release.slice(atIndex + 1);
    if (GIT_SHA_REGEX.test(sha)) {
      return sha;
    }
  }

  // Check if release itself is a SHA
  if (GIT_SHA_REGEX.test(release)) {
    return release;
  }

  return null;
}

async function markEvidenceComplete(
  orgId: string,
  jobId: string
): Promise<void> {
  await transaction(orgId, async (client) => {
    await client.query(
      `UPDATE rca_jobs
       SET status = 'evidence_complete',
           updated_at = NOW()
       WHERE id = $1 AND org_id = $2`,
      [jobId, orgId]
    );
  });
}

async function markEvidenceFailed(
  orgId: string,
  jobId: string,
  reason: string
): Promise<void> {
  // UTF-8 safe truncation: use substring instead of slice to avoid
  // cutting multi-byte characters in the middle
  const truncatedReason = truncateUtf8Safe(reason, 512);

  await transaction(orgId, async (client) => {
    await client.query(
      `UPDATE rca_jobs
       SET status = 'evidence_failed',
           error_message = $1,
           updated_at = NOW()
       WHERE id = $2 AND org_id = $3`,
      [truncatedReason, jobId, orgId]
    );
  });
}

/**
 * Truncate a string to maxBytes while respecting UTF-8 character boundaries.
 * Prevents corruption of multi-byte characters (emoji, international chars).
 */
function truncateUtf8Safe(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);

  if (encoded.length <= maxBytes) {
    return str;
  }

  // Binary search for the right cut point
  let low = 0;
  let high = str.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(str.slice(0, mid)).length <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return str.slice(0, low);
}

// ============================================
// Worker Instance
// ============================================

let evidenceWorker: Worker<EvidenceAssemblyJobData> | null = null;

export function startEvidenceWorker(): Worker<EvidenceAssemblyJobData> {
  if (evidenceWorker) {
    return evidenceWorker;
  }

  evidenceWorker = new Worker<EvidenceAssemblyJobData>(
    QUEUE_NAME,
    processEvidenceJob,
    {
      connection: resolveQueueConnection(),
      concurrency: 5,
      limiter: {
        max: 10,
        duration: 1000,
      },
    }
  );

  // Worker-level event handlers (for retries and final outcomes)
  evidenceWorker.on("failed", (job, err) => {
    const isRetryable = job && job.attemptsMade < (job.opts.attempts || 3);
    logger.warn(
      {
        jobId: job?.data.jobId,
        eventId: job?.data.eventId,
        attempt: job?.attemptsMade,
        maxAttempts: job?.opts.attempts || 3,
        willRetry: isRetryable,
        error: err?.message,
        worker: "evidence-assembly",
      },
      isRetryable
        ? "[JOB:RETRY] Evidence job failed, will retry"
        : "[JOB:EXHAUSTED] Evidence job failed after all retries"
    );
  });

  evidenceWorker.on("stalled", (jobId) => {
    logger.warn(
      { jobId, worker: "evidence-assembly" },
      "[JOB:STALLED] Evidence job stalled - may have lost worker connection"
    );
  });

  evidenceWorker.on("error", (err) => {
    logger.error(
      { error: err.message, stack: err.stack, worker: "evidence-assembly" },
      "[WORKER:ERROR] Evidence worker error"
    );
  });

  return evidenceWorker;
}

export async function stopEvidenceWorker(): Promise<void> {
  if (evidenceWorker) {
    await evidenceWorker.close();
    evidenceWorker = null;
    logger.info({ worker: "evidence-assembly" }, "Evidence worker stopped");
  }
  if (evidenceQueue) {
    await evidenceQueue.close();
    evidenceQueue = null;
  }
}
