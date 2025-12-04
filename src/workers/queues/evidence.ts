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
  const parsed = new URL(config.REDIS_URL);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname ? Number(parsed.pathname.replace("/", "")) || 0 : 0,
    maxRetriesPerRequest: null,
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

  logger.info(
    { jobId: data.jobId, orgId: data.orgId },
    "Evidence assembly job enqueued"
  );
}

// ============================================
// Worker Processing
// ============================================

interface JobRowWithDetails {
  id: string;
  event_id: string;
  deterministic_findings: AnalyzerResult | null;
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
       LEFT JOIN repos r ON r.org_id = j.org_id AND r.is_active = true
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

async function processEvidenceJob(
  job: Job<EvidenceAssemblyJobData>
): Promise<void> {
  const { jobId, eventId, orgId } = job.data;
  const startTime = Date.now();

  logger.info(
    { jobId, eventId, orgId, attempt: job.attemptsMade },
    "Processing evidence assembly job"
  );

  try {
    // 1. Load job and event data
    const jobRow = await loadJobWithEventData(orgId, jobId);

    if (!jobRow.installation_id) {
      throw new Error("Repository missing GitHub installation ID");
    }

    // 2. Extract code results from deterministic analysis
    // For now, we use simplified code results since the actual code is in the analyzer
    // In a full implementation, we'd store intermediate results
    const codeResults: CodeFetchResult[] = extractCodeResultsFromFindings(
      jobRow.deterministic_findings
    );

    // 3. Build event data structure
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

    // 4. Collect evidence params
    const collectParams: CollectEvidenceParams = {
      orgId,
      eventId,
      jobId,
      installationId: jobRow.installation_id,
      repo: jobRow.repo_full_name,
      commitSha: extractCommitSha(jobRow.release),
    };

    // 5. Run evidence collection
    const evidenceCollector = new EvidenceCollectorService();
    const bundle = await evidenceCollector.collect(
      collectParams,
      eventData,
      codeResults,
      jobRow.deterministic_findings
    );

    // 6. Store in S3
    const storageRef = await evidenceCollector.storeInS3(bundle);

    // 7. Update job with S3 reference
    await evidenceCollector.updateJobWithEvidence(orgId, jobId, storageRef);

    // 8. Mark job as evidence complete
    await markEvidenceComplete(orgId, jobId);

    const duration = Date.now() - startTime;
    logger.info(
      {
        jobId,
        orgId,
        duration,
        bundleId: bundle.bundle_id,
        s3Key: storageRef.key,
      },
      "Evidence assembly complete"
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(
      { jobId, orgId, error: err.message },
      "Evidence assembly failed"
    );
    await markEvidenceFailed(orgId, jobId, err.message);
    throw error;
  }
}

function extractCodeResultsFromFindings(
  findings: AnalyzerResult | null
): CodeFetchResult[] {
  /**
   * CRITICAL TECH DEBT - MUST FIX BEFORE BETA LAUNCH
   * ================================================
   * This extracts snippets from findings, NOT full file content.
   *
   * Impact on RCA Quality:
   * - LLM won't have full context around the error location
   * - Missing imports, function definitions, or relevant nearby code
   * - Makes it harder to suggest accurate fixes
   * - Directly impacts core value proposition (evidence-backed RCA)
   *
   * Fix Required:
   * Store actual fetched code in intermediate results during the deterministic
   * analysis phase, then retrieve full file content here.
   *
   * Tracking: https://github.com/buglens/buglens/issues/xxx
   * Priority: P0 - Blocks accurate RCA generation
   */
  if (!findings || findings.findings.length === 0) {
    return [];
  }

  logger.warn(
    { findingsCount: findings.findings.length },
    "CRITICAL: Using simplified code extraction from findings - LLM lacks full context for accurate RCA"
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

  evidenceWorker.on("completed", (job) => {
    logger.info({ jobId: job.data.jobId }, "Evidence job completed");
  });

  evidenceWorker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.data.jobId, error: err.message },
      "Evidence job failed"
    );
  });

  evidenceWorker.on("error", (err) => {
    logger.error({ error: err.message }, "Evidence worker error");
  });

  logger.info("Evidence assembly worker started");
  return evidenceWorker;
}

export async function stopEvidenceWorker(): Promise<void> {
  if (evidenceWorker) {
    await evidenceWorker.close();
    evidenceWorker = null;
  }
  if (evidenceQueue) {
    await evidenceQueue.close();
    evidenceQueue = null;
  }
}
