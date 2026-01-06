import { Worker, Job } from "bullmq";
import { logger } from "../utils/logger.js";
import {
  DETERMINISTIC_QUEUE_NAME,
  resolveQueueConnection,
  type DeterministicAnalyzerJobData,
} from "./queues/deterministic.js";
import { DeterministicAnalyzerService } from "../services/deterministic-analyzer.js";

/**
 * Deterministic Analyzer Worker
 *
 * Processes RCA jobs through the 3-stage extraction pipeline:
 * 1. Deterministic extraction (AST/pattern matching)
 * 2. LLM-assisted extraction (frame classification)
 * 3. Validation (repo/commit verification)
 *
 * Then fetches code and runs Python analyzers for findings.
 */

/**
 * Create the job processor function
 * Exported for testing purposes
 */
export function createDeterministicProcessor(
  service: DeterministicAnalyzerService
) {
  return async (job: Job<DeterministicAnalyzerJobData>) => {
    const { jobId, eventId, orgId } = job.data;
    const startTime = Date.now();

    logger.info(
      {
        jobId,
        eventId,
        orgId,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts || 3,
        worker: "deterministic-analyzer",
      },
      "[JOB:START] Deterministic analysis starting"
    );

    try {
      await service.process(job.data);

      const durationMs = Date.now() - startTime;
      logger.info(
        {
          jobId,
          eventId,
          orgId,
          durationMs,
          durationSec: (durationMs / 1000).toFixed(2),
          worker: "deterministic-analyzer",
          status: "success",
        },
        "[JOB:SUCCESS] Deterministic analysis completed"
      );

      return { success: true, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      logger.error(
        {
          jobId,
          eventId,
          orgId,
          durationMs,
          attempt: job.attemptsMade + 1,
          error: err.message,
          errorStack: err.stack,
          worker: "deterministic-analyzer",
          status: "failed",
        },
        "[JOB:ERROR] Deterministic analysis failed"
      );
      throw error;
    }
  };
}

export function startDeterministicAnalyzerWorker(): Worker<DeterministicAnalyzerJobData> {
  const service = new DeterministicAnalyzerService();
  const processor = createDeterministicProcessor(service);

  const worker = new Worker<DeterministicAnalyzerJobData>(
    DETERMINISTIC_QUEUE_NAME,
    processor,
    {
      connection: resolveQueueConnection(),
      concurrency: 1, // Process one at a time for predictable resource usage
    }
  );

  // Worker-level event handlers (for retries and final outcomes)
  worker.on("failed", (job, error) => {
    const isRetryable = job && job.attemptsMade < (job.opts.attempts || 3);
    logger.warn(
      {
        jobId: job?.data.jobId,
        eventId: job?.data.eventId,
        attempt: job?.attemptsMade,
        maxAttempts: job?.opts.attempts || 3,
        willRetry: isRetryable,
        error: error?.message,
        worker: "deterministic-analyzer",
      },
      isRetryable
        ? "[JOB:RETRY] Job failed, will retry"
        : "[JOB:EXHAUSTED] Job failed after all retries"
    );
  });

  worker.on("stalled", (jobId) => {
    logger.warn(
      { jobId, worker: "deterministic-analyzer" },
      "[JOB:STALLED] Job stalled - may have lost worker connection"
    );
  });

  worker.on("error", (err) => {
    logger.error(
      {
        error: err.message,
        stack: err.stack,
        worker: "deterministic-analyzer",
      },
      "[WORKER:ERROR] Deterministic worker error"
    );
  });

  return worker;
}
