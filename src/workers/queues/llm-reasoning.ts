import { Queue, Worker, Job } from "bullmq";
import { resolveRedisConnection } from "../../db/redis-connection.js";
import { logger } from "../../utils/logger.js";
import { transaction } from "../../db/client.js";
import { LLMService } from "../../services/llm-service.js";
import { buildEvidenceGraph } from "../../services/evidence-graph-builder.js";
import { EvidenceCollectorService } from "../../services/evidence-collector.js";
import {
  notificationService,
  type RCANotificationData,
} from "../../services/notification-service.js";
import {
  jiraTicketService,
  type RCATicketData,
} from "../../services/jira-ticket-service.js";
import type { EvidenceBundle } from "../../types/evidence.js";
import type { EvidenceGraph } from "../../types/evidence-graph.js";

// ============================================
// Queue Configuration
// ============================================

const QUEUE_NAME = "llm-reasoning";

export interface LLMReasoningJobData {
  jobId: string;
  eventId: string;
  orgId: string;
}

// ============================================
// Queue Instance
// ============================================

let llmQueue: Queue<LLMReasoningJobData> | null = null;

// Test mode buffer for integration testing
const testModeBuffer: LLMReasoningJobData[] = [];
let testMode = false;

export function enableTestMode(): void {
  testMode = true;
}

export function disableTestMode(): void {
  testMode = false;
  testModeBuffer.length = 0;
}

export function getTestModeJobs(): LLMReasoningJobData[] {
  return [...testModeBuffer];
}

export { resolveRedisConnection as resolveQueueConnection } from "../../db/redis-connection.js";

export function getLLMQueue(): Queue<LLMReasoningJobData> {
  if (!llmQueue) {
    llmQueue = new Queue<LLMReasoningJobData>(QUEUE_NAME, {
      connection: resolveRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 10000, // 10s initial delay for LLM rate limits
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
  return llmQueue;
}

// ============================================
// Job Enqueue Function
// ============================================

export async function enqueueLLMReasoning(
  data: LLMReasoningJobData
): Promise<void> {
  if (testMode) {
    testModeBuffer.push(data);
    logger.debug({ jobId: data.jobId }, "LLM job buffered in test mode");
    return;
  }

  const queue = getLLMQueue();
  await queue.add(`llm-${data.jobId}`, data, {
    jobId: `llm-${data.jobId}`,
  });

  logger.debug(
    { jobId: data.jobId, orgId: data.orgId, queue: QUEUE_NAME },
    "LLM reasoning job added to queue"
  );
}

// ============================================
// Worker Processing
// ============================================

interface JobRowWithEvidence {
  id: string;
  event_id: string;
  org_id: string;
  code_context_s3_url: string | null;
  deterministic_findings: unknown;
}

interface RCAResultInsert {
  id: string;
  org_id: string;
  event_id: string;
  job_id: string;
  title: string;
  summary: string;
  root_cause: string;
  causal_chain: string[];
  suggested_fix: Record<string, unknown> | null;
  test_intentions: unknown[];
  evidence: Record<string, unknown>;
  confidence: number;
  evidence_refs: string[];
  llm_model: string;
  llm_tokens_used: number;
  evidence_graph: EvidenceGraph | null;
  error_category: string | null;
  created_at: Date;
}

async function loadJobForLLM(
  orgId: string,
  jobId: string
): Promise<JobRowWithEvidence> {
  return transaction(orgId, async (client) => {
    // Allow evidence_complete (fresh job), llm_processing (interrupted), or llm_failed (retry)
    const result = await client.query<JobRowWithEvidence>(
      `SELECT
         j.id,
         j.event_id,
         j.org_id,
         j.code_context_s3_url,
         j.deterministic_findings
       FROM rca_jobs j
       WHERE j.id = $1 AND j.org_id = $2
         AND j.status IN ('evidence_complete', 'llm_processing', 'llm_failed')
       LIMIT 1`,
      [jobId, orgId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Job ${jobId} not found or not ready for LLM reasoning`);
    }

    return result.rows[0];
  });
}

async function loadEvidenceBundle(
  s3Key: string,
  _orgId: string,
  _jobId: string
): Promise<EvidenceBundle> {
  const evidenceCollector = new EvidenceCollectorService();

  // Extract just the key part from s3://bucket/key format
  const key = s3Key.replace(/^s3:\/\/[^/]+\//, "");
  const bundle = await evidenceCollector.retrieveFromS3(key);

  if (!bundle) {
    throw new Error(`Evidence bundle not found at ${s3Key}`);
  }

  return bundle;
}

/**
 * Process LLM reasoning job
 *
 * Steps:
 * 1. Load job from database (must be in evidence_complete status)
 * 2. Load evidence bundle from S3
 * 3. Check LLM quota for organization
 * 4. Call LLM service for RCA generation
 * 5. Build evidence graph from findings
 * 6. Store RCA result in database
 * 7. Update job status to complete
 */
async function processLLMJob(job: Job<LLMReasoningJobData>): Promise<void> {
  const { jobId, eventId, orgId } = job.data;
  const startTime = Date.now();

  logger.info(
    {
      jobId,
      eventId,
      orgId,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts || 3,
      worker: "llm-reasoning",
    },
    "[JOB:START] LLM reasoning starting"
  );

  try {
    // Step 1: Load job data
    logger.debug({ jobId, step: 1 }, "[STEP] Loading job for LLM");
    const jobRow = await loadJobForLLM(orgId, jobId);

    if (!jobRow.code_context_s3_url) {
      throw new Error(
        "Evidence S3 key not found - evidence assembly may have failed"
      );
    }

    // Step 2: Load evidence bundle from S3
    logger.debug(
      { jobId, step: 2, s3Key: jobRow.code_context_s3_url },
      "[STEP] Loading evidence bundle"
    );
    const evidenceBundle = await loadEvidenceBundle(
      jobRow.code_context_s3_url,
      orgId,
      jobId
    );

    // Step 3: Mark job as LLM processing
    await markLLMProcessing(orgId, jobId);

    // Step 4: Cache check — same signature + release + top-frame already analyzed?
    const cached = await findCachedRCA(orgId, eventId, evidenceBundle);

    let rcaResult: LLMResult;
    let cacheHit = false;

    if (cached) {
      logger.info(
        {
          jobId,
          eventId,
          sourceRcaId: cached.source_rca_id,
          sourceEventId: cached.source_event_id,
          confidence: cached.confidence,
        },
        "[STEP] Cache hit — reusing prior RCA for identical signature+release"
      );
      rcaResult = {
        title: cached.title,
        summary: cached.summary,
        root_cause: cached.root_cause,
        suggested_fix: cached.suggested_fix,
        confidence: cached.confidence,
        causal_chain: cached.causal_chain,
        evidence_refs: cached.evidence_refs,
        llm_model: `cached:${cached.llm_model}`,
        llm_tokens_used: 0,
        error_category: cached.error_category ?? undefined,
      };
      cacheHit = true;
    } else {
      // Cache miss — call LLM
      logger.debug({ jobId, step: 4 }, "[STEP] Generating RCA with LLM");
      const llmService = new LLMService();
      const llmResult = await llmService.generateRCA({
        orgId,
        eventId,
        jobId,
        evidence: evidenceBundle,
      });

      if (!llmResult.success || !llmResult.rca) {
        throw new Error(
          llmResult.error ?? "LLM generation failed without error message"
        );
      }

      const orchestratorRca = llmResult.rca;
      rcaResult = {
        title: orchestratorRca.title,
        summary: orchestratorRca.summary,
        root_cause: orchestratorRca.root_cause,
        suggested_fix:
          orchestratorRca.suggested_fix?.description ?? orchestratorRca.summary,
        confidence: orchestratorRca.confidence,
        causal_chain: orchestratorRca.causal_chain.map((step) => step.step),
        evidence_refs: orchestratorRca.causal_chain.map(
          (step) => step.evidence
        ),
        llm_model: llmResult.llm_model,
        llm_tokens_used: llmResult.llm_tokens_used,
        error_category: undefined,
      };

      logger.info(
        {
          jobId,
          confidence: rcaResult.confidence,
          tokensUsed: llmResult.llm_tokens_used,
          model: llmResult.llm_model,
          usedFallback: llmResult.used_fallback,
        },
        "[STEP] RCA generated successfully"
      );
    }

    // Step 5: Build evidence graph
    logger.debug({ jobId, step: 5 }, "[STEP] Building evidence graph");
    let evidenceGraph: EvidenceGraph | null = null;
    try {
      // Extract data from evidence bundle for graph builder
      const event = {
        message: evidenceBundle.error?.message ?? "Unknown error",
        exception: {
          type: evidenceBundle.error?.type ?? "Error",
          value: evidenceBundle.error?.value ?? "",
        },
      };

      // Extract user frames from stack trace
      const userFrames = (evidenceBundle.error?.stack_trace ?? [])
        .filter((f) => f.in_app)
        .map((f, index) => ({
          file_path: f.file,
          line_number: f.line,
          column_number: f.column,
          function_name: f.function,
          is_entry_point: index === 0,
        }));

      // Get recent commits - map from CommitInfo to GraphBuildCommit
      const recentCommits = (evidenceBundle.recent_commits ?? []).map((c) => ({
        sha: c.sha,
        short_sha: c.short_sha,
        message: c.message,
        author: c.author,
        files_changed: c.files_changed,
        additions: c.additions,
        deletions: c.deletions,
      }));

      // Get findings from deterministic analysis
      const findings = (evidenceBundle.deterministic_findings ?? []).map(
        (f) => ({
          rule_id: f.id,
          title: f.title,
          message: f.message,
          severity: f.severity,
          confidence: f.confidence,
          location: {
            file: f.evidence?.file_path,
            line: f.evidence?.line_number,
            column: f.evidence?.column_number,
          },
        })
      );

      evidenceGraph = buildEvidenceGraph({
        event,
        userFrames,
        recentCommits,
        findings,
      });
    } catch (err) {
      // Evidence graph is optional - log but don't fail
      logger.warn(
        { jobId, error: err instanceof Error ? err.message : String(err) },
        "Failed to build evidence graph - continuing without it"
      );
    }

    // Step 6: Store RCA result
    logger.debug({ jobId, step: 6, cacheHit }, "[STEP] Storing RCA result");
    const rcaId = await storeRCAResult({
      orgId,
      eventId,
      jobId,
      result: rcaResult,
      evidenceBundle,
      evidenceGraph,
    });

    // Step 7: Mark job as complete
    await markRCAComplete(orgId, jobId, rcaId);

    // Step 8: Send notifications (Slack, Teams) and create Jira ticket if enabled
    await sendRCANotifications(
      orgId,
      rcaId,
      eventId,
      rcaResult,
      evidenceBundle
    );

    const durationMs = Date.now() - startTime;
    logger.info(
      {
        jobId,
        eventId,
        orgId,
        rcaId,
        durationMs,
        durationSec: (durationMs / 1000).toFixed(2),
        confidence: rcaResult.confidence,
        tokensUsed: rcaResult.llm_tokens_used,
        model: rcaResult.llm_model,
        cacheHit,
        hasEvidenceGraph: !!evidenceGraph,
        worker: "llm-reasoning",
        status: "success",
      },
      "[JOB:SUCCESS] LLM reasoning completed"
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const err = error instanceof Error ? error : new Error(String(error));

    // Check for quota exceeded
    const isQuotaError = err.message.includes("quota exceeded");

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
        isQuotaError,
        isLastAttempt,
        worker: "llm-reasoning",
        status: "failed",
      },
      "[JOB:ERROR] LLM reasoning failed"
    );

    // Only mark job as permanently failed if this is the last attempt or quota error
    // For retryable failures, keep status as llm_processing so retry can pick it up
    if (isLastAttempt || isQuotaError) {
      await markLLMFailed(orgId, jobId, err.message, isQuotaError);
    }
    throw error;
  }
}

interface LLMResult {
  title: string;
  summary: string;
  root_cause: string;
  suggested_fix: string;
  confidence: number;
  causal_chain: string[];
  evidence_refs: string[];
  llm_model: string;
  llm_tokens_used: number;
  error_category?: string;
}

// ============================================
// LLM Result Cache
// ============================================
//
// Re-uses an existing high-confidence RCA when the same error has already been
// analyzed at the same code revision (release). The cache only short-circuits
// the LLM call (worker step 4); the downstream steps — evidence graph,
// persistence, notifications — still run per event.
//
// Cache key: signature + release + (first in-app stack frame file:line).
//
// Why the extra frame check: events.signature falls back to
// `<exceptionType>:<exceptionValue>` when Sentry doesn't send a fingerprint
// (webhooks.ts). A generic message like "Cannot read properties of undefined"
// would otherwise collide across unrelated call sites in the same release and
// we'd serve the wrong root cause. The first in-app frame disambiguates which
// piece of code raised the error.

const CACHE_MIN_CONFIDENCE = 0.7;
const CACHE_MAX_AGE_DAYS = 30;
// Look at up to N candidate rows from SQL and post-filter for matching
// stack-frame location. Keeps the SQL bounded while still tolerating bursts
// of the same incident.
const CACHE_CANDIDATE_LIMIT = 20;

interface CachedRCA {
  title: string;
  summary: string;
  root_cause: string;
  causal_chain: string[];
  suggested_fix: string;
  confidence: number;
  evidence_refs: string[];
  llm_model: string;
  error_category: string | null;
  source_rca_id: string;
  source_event_id: string;
}

interface FrameKey {
  file: string;
  line: number;
}

/**
 * Pick the first in-app frame's file:line as the disambiguator. Falls back to
 * the very first frame if no in-app frame is present (some Sentry payloads
 * don't tag frames). Returns null when there's no usable frame info — in that
 * case we conservatively skip the cache.
 */
function extractFrameKey(bundle: EvidenceBundle): FrameKey | null {
  const frames = bundle.error?.stack_trace ?? [];
  const isUsable = (f: { file?: string; line?: number | null } | undefined) =>
    !!f && typeof f.file === "string" && typeof f.line === "number";
  const inApp = frames.find((f) => f?.in_app && isUsable(f));
  const fallback = frames.find((f) => isUsable(f));
  const chosen = inApp ?? fallback;
  if (!chosen || typeof chosen.line !== "number") return null;
  return { file: chosen.file, line: chosen.line };
}

function frameKeysMatch(a: FrameKey, b: FrameKey | null): boolean {
  return b !== null && b.file === a.file && b.line === a.line;
}

function extractFrameKeyFromFrames(frames: unknown): FrameKey | null {
  if (!Array.isArray(frames)) return null;
  const isUsable = (f: unknown): f is { file: string; line: number; in_app?: boolean } =>
    !!f &&
    typeof (f as Record<string, unknown>).file === "string" &&
    typeof (f as Record<string, unknown>).line === "number";
  const inApp = frames.find((f) => isUsable(f) && f.in_app);
  const fallback = frames.find((f) => isUsable(f));
  const chosen = inApp ?? fallback;
  if (!chosen) return null;
  return { file: chosen.file, line: chosen.line };
}

async function findCachedRCA(
  orgId: string,
  eventId: string,
  currentEvidence: EvidenceBundle
): Promise<CachedRCA | null> {
  const currentFrame = extractFrameKey(currentEvidence);
  if (!currentFrame) {
    // No usable frame — fall through to LLM rather than risk a wrong reuse.
    return null;
  }

  return transaction(orgId, async (client) => {
    const result = await client.query<{
      id: string;
      event_id: string;
      title: string;
      summary: string;
      root_cause: string;
      causal_chain: unknown;
      suggested_fix: unknown;
      confidence: number;
      evidence_refs: unknown;
      llm_model: string;
      error_category: string | null;
      stack_trace: unknown;
    }>(
      `WITH current_event AS (
         SELECT signature, COALESCE(release, '') AS release
         FROM events
         WHERE id = $1 AND org_id = $2
       )
       SELECT r.id, r.event_id, r.title, r.summary, r.root_cause,
              r.causal_chain, r.suggested_fix, r.confidence,
              r.evidence_refs, r.llm_model, r.error_category,
              r.evidence->'error'->'stack_trace' AS stack_trace
       FROM rca_results r
       JOIN events e ON e.id = r.event_id
       JOIN current_event c ON e.signature = c.signature
                           AND COALESCE(e.release, '') = c.release
       WHERE r.org_id = $2
         AND r.event_id <> $1
         AND r.confidence >= $3
         AND r.created_at >= NOW() - ($4 || ' days')::interval
       ORDER BY r.created_at DESC
       LIMIT $5`,
      [
        eventId,
        orgId,
        CACHE_MIN_CONFIDENCE,
        CACHE_MAX_AGE_DAYS.toString(),
        CACHE_CANDIDATE_LIMIT,
      ]
    );

    // Post-filter: pick the most recent candidate whose first in-app frame
    // matches. SQL groups by signature+release; the in-app frame acts as
    // tiebreaker for generic signatures. We extract the in-app-first frame
    // from the full stack_trace array (same logic as extractFrameKey) rather
    // than relying on ->0 which may be a library frame.
    const match = result.rows.find((row) =>
      frameKeysMatch(currentFrame, extractFrameKeyFromFrames(row.stack_trace))
    );

    if (!match) return null;

    const causalChain = Array.isArray(match.causal_chain)
      ? (match.causal_chain as string[])
      : [];
    const evidenceRefs = Array.isArray(match.evidence_refs)
      ? (match.evidence_refs as string[])
      : [];
    const suggestedFix =
      match.suggested_fix &&
      typeof match.suggested_fix === "object" &&
      "description" in match.suggested_fix
        ? String((match.suggested_fix as { description: unknown }).description)
        : "";

    return {
      title: match.title,
      summary: match.summary,
      root_cause: match.root_cause,
      causal_chain: causalChain,
      suggested_fix: suggestedFix,
      confidence: match.confidence,
      evidence_refs: evidenceRefs,
      llm_model: match.llm_model,
      error_category: match.error_category,
      source_rca_id: match.id,
      source_event_id: match.event_id,
    };
  });
}

interface StoreRCAParams {
  orgId: string;
  eventId: string;
  jobId: string;
  result: LLMResult;
  evidenceBundle: EvidenceBundle;
  evidenceGraph: EvidenceGraph | null;
}

async function storeRCAResult(params: StoreRCAParams): Promise<string> {
  const { orgId, eventId, jobId, result, evidenceBundle, evidenceGraph } =
    params;
  const rcaId = crypto.randomUUID();

  const insertData: RCAResultInsert = {
    id: rcaId,
    org_id: orgId,
    event_id: eventId,
    job_id: jobId,
    title: result.title,
    summary: result.summary,
    root_cause: result.root_cause,
    causal_chain: result.causal_chain,
    suggested_fix: result.suggested_fix
      ? { description: result.suggested_fix }
      : null,
    test_intentions: [],
    evidence: {
      error: evidenceBundle.error,
      code: evidenceBundle.code,
      findings_count: evidenceBundle.deterministic_findings?.length ?? 0,
    },
    confidence: result.confidence,
    evidence_refs: result.evidence_refs,
    llm_model: result.llm_model,
    llm_tokens_used: result.llm_tokens_used,
    evidence_graph: evidenceGraph,
    error_category: result.error_category ?? null,
    created_at: new Date(),
  };

  // Debug log the data being inserted
  logger.debug(
    {
      jobId,
      title: insertData.title?.substring(0, 50),
      causalChainLength: insertData.causal_chain?.length,
      evidenceRefsLength: insertData.evidence_refs?.length,
      hasEvidenceGraph: !!evidenceGraph,
    },
    "[DEBUG] RCA result data before INSERT"
  );

  await transaction(orgId, async (client) => {
    // Pre-serialize all JSON fields
    const serializedCausalChain = JSON.stringify(insertData.causal_chain ?? []);
    const serializedEvidenceRefs = JSON.stringify(
      insertData.evidence_refs ?? []
    );
    const serializedEvidenceGraph = evidenceGraph
      ? JSON.stringify(evidenceGraph)
      : null;
    const serializedSuggestedFix = insertData.suggested_fix
      ? JSON.stringify(insertData.suggested_fix)
      : null;
    const serializedTestIntentions = JSON.stringify(
      insertData.test_intentions ?? []
    );
    const serializedEvidence = JSON.stringify(insertData.evidence);

    await client.query(
      `INSERT INTO rca_results (
        id, org_id, event_id, job_id, title, summary, root_cause,
        causal_chain, suggested_fix, test_intentions, evidence,
        confidence, evidence_refs, llm_model, llm_tokens_used,
        evidence_graph, error_category, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      )`,
      [
        insertData.id,
        insertData.org_id,
        insertData.event_id,
        insertData.job_id,
        insertData.title,
        insertData.summary,
        insertData.root_cause,
        serializedCausalChain,
        serializedSuggestedFix,
        serializedTestIntentions,
        serializedEvidence,
        insertData.confidence,
        serializedEvidenceRefs,
        insertData.llm_model,
        insertData.llm_tokens_used,
        serializedEvidenceGraph,
        insertData.error_category,
        insertData.created_at,
      ]
    );
  });

  return rcaId;
}

async function markLLMProcessing(orgId: string, jobId: string): Promise<void> {
  await transaction(orgId, async (client) => {
    await client.query(
      `UPDATE rca_jobs
       SET status = 'llm_processing',
           updated_at = NOW()
       WHERE id = $1 AND org_id = $2`,
      [jobId, orgId]
    );
  });
}

async function markRCAComplete(
  orgId: string,
  jobId: string,
  rcaId: string
): Promise<void> {
  await transaction(orgId, async (client) => {
    await client.query(
      `UPDATE rca_jobs
       SET status = 'complete',
           rca_result_id = $1,
           updated_at = NOW()
       WHERE id = $2 AND org_id = $3`,
      [rcaId, jobId, orgId]
    );
  });
}

async function markLLMFailed(
  orgId: string,
  jobId: string,
  reason: string,
  isQuotaError: boolean
): Promise<void> {
  const status = isQuotaError ? "quota_exceeded" : "llm_failed";
  const truncatedReason = reason.slice(0, 512);

  await transaction(orgId, async (client) => {
    await client.query(
      `UPDATE rca_jobs
       SET status = $1,
           error_message = $2,
           updated_at = NOW()
       WHERE id = $3 AND org_id = $4`,
      [status, truncatedReason, jobId, orgId]
    );
  });
}

// ============================================
// Notification & Ticket Creation
// ============================================

interface RCAResultForNotification {
  title: string;
  summary: string;
  root_cause: string;
  suggested_fix?: string;
  confidence: number;
}

/**
 * Send RCA notifications to Slack/Teams and optionally create Jira ticket
 */
async function sendRCANotifications(
  orgId: string,
  rcaId: string,
  eventId: string,
  rcaResult: RCAResultForNotification,
  evidenceBundle: EvidenceBundle
): Promise<void> {
  try {
    // Determine severity from confidence and error type
    const severity = determineSeverity(rcaResult.confidence, evidenceBundle);

    // Get event title for notification
    const eventTitle =
      evidenceBundle.error?.type && evidenceBundle.error?.value
        ? `${evidenceBundle.error.type}: ${evidenceBundle.error.value}`
        : evidenceBundle.error?.message || "Unknown Error";

    // Prepare notification data
    const notificationData: RCANotificationData = {
      rcaId,
      eventId,
      eventTitle: truncateString(eventTitle, 100),
      rootCause: rcaResult.root_cause,
      confidence: rcaResult.confidence,
      severity,
      suggestedFix: rcaResult.suggested_fix,
      affectedFile: evidenceBundle.error?.stack_trace?.[0]?.file,
      affectedLine: evidenceBundle.error?.stack_trace?.[0]?.line ?? undefined,
      timestamp: new Date().toISOString(),
    };

    // Send notifications to Slack and Teams
    const notificationResult = await notificationService.sendRCANotification(
      orgId,
      notificationData
    );

    if (notificationResult.slack?.success) {
      logger.debug({ orgId, rcaId }, "Slack RCA notification sent");
    }
    if (notificationResult.teams?.success) {
      logger.debug({ orgId, rcaId }, "Teams RCA notification sent");
    }

    // Check if auto-create Jira ticket is enabled
    const shouldCreateTicket = await jiraTicketService.shouldAutoCreateTicket(
      orgId,
      severity,
      rcaResult.confidence
    );

    if (shouldCreateTicket) {
      // Extract related file paths from code context
      const relatedFiles =
        evidenceBundle.code?.related?.map((c) => c.file_path) || [];
      if (evidenceBundle.code?.primary?.file_path) {
        relatedFiles.unshift(evidenceBundle.code.primary.file_path);
      }

      const ticketData: RCATicketData = {
        rcaId,
        eventId,
        eventTitle: truncateString(eventTitle, 200),
        eventMessage: evidenceBundle.error?.message || "",
        rootCause: rcaResult.root_cause,
        confidence: rcaResult.confidence,
        severity,
        suggestedFix: rcaResult.suggested_fix,
        affectedFile: evidenceBundle.error?.stack_trace?.[0]?.file,
        affectedLine: evidenceBundle.error?.stack_trace?.[0]?.line ?? undefined,
        relatedFiles,
        codeSnippet: evidenceBundle.code?.primary?.snippet?.substring(0, 500),
        analysisDetails: rcaResult.summary,
        timestamp: new Date().toISOString(),
      };

      const ticketResult = await jiraTicketService.createRCATicket(
        orgId,
        ticketData
      );

      if (ticketResult.success && ticketResult.ticket) {
        logger.info(
          { orgId, rcaId, ticketKey: ticketResult.ticket.key },
          "Jira ticket created for RCA"
        );
      }
    }
  } catch (error) {
    // Don't fail the job if notifications fail
    logger.warn(
      { error, orgId, rcaId },
      "Failed to send RCA notifications - job completed but notifications failed"
    );
  }
}

/**
 * Determine severity based on confidence and error characteristics
 */
function determineSeverity(
  confidence: number,
  evidenceBundle: EvidenceBundle
): "critical" | "high" | "medium" | "low" {
  // High confidence issues with stack trace in user code are more severe
  const hasUserCode = evidenceBundle.error?.stack_trace?.some((f) => f.in_app);
  const findingsCount = evidenceBundle.deterministic_findings?.length ?? 0;

  if (confidence >= 0.9 && hasUserCode && findingsCount > 0) {
    return "critical";
  }
  if (confidence >= 0.75 && hasUserCode) {
    return "high";
  }
  if (confidence >= 0.5) {
    return "medium";
  }
  return "low";
}

/**
 * Truncate string to max length
 */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + "...";
}

// ============================================
// Worker Instance
// ============================================

let llmWorker: Worker<LLMReasoningJobData> | null = null;

export function startLLMWorker(): Worker<LLMReasoningJobData> {
  if (llmWorker) {
    return llmWorker;
  }

  llmWorker = new Worker<LLMReasoningJobData>(QUEUE_NAME, processLLMJob, {
    connection: resolveRedisConnection(),
    concurrency: 3, // Lower concurrency for LLM rate limits
    limiter: {
      max: 5,
      duration: 1000,
    },
  });

  // Worker-level event handlers
  llmWorker.on("failed", (job, err) => {
    const isRetryable = job && job.attemptsMade < (job.opts.attempts || 3);
    const isQuotaError = err?.message?.includes("quota exceeded");

    logger.warn(
      {
        jobId: job?.data.jobId,
        eventId: job?.data.eventId,
        attempt: job?.attemptsMade,
        maxAttempts: job?.opts.attempts || 3,
        willRetry: isRetryable && !isQuotaError,
        isQuotaError,
        error: err?.message,
        worker: "llm-reasoning",
      },
      isQuotaError
        ? "[JOB:QUOTA] LLM job failed due to quota - will not retry"
        : isRetryable
          ? "[JOB:RETRY] LLM job failed, will retry"
          : "[JOB:EXHAUSTED] LLM job failed after all retries"
    );
  });

  llmWorker.on("stalled", (jobId) => {
    logger.warn(
      { jobId, worker: "llm-reasoning" },
      "[JOB:STALLED] LLM job stalled - may have lost worker connection"
    );
  });

  llmWorker.on("error", (err) => {
    logger.error(
      { error: err.message, stack: err.stack, worker: "llm-reasoning" },
      "[WORKER:ERROR] LLM worker error"
    );
  });

  return llmWorker;
}

export async function stopLLMWorker(): Promise<void> {
  if (llmWorker) {
    await llmWorker.close();
    llmWorker = null;
    logger.info({ worker: "llm-reasoning" }, "LLM worker stopped");
  }
  if (llmQueue) {
    await llmQueue.close();
    llmQueue = null;
  }
}
