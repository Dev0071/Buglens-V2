import { Worker } from "bullmq";
import { logger } from "../utils/logger.js";
import {
  DETERMINISTIC_QUEUE_NAME,
  resolveQueueConnection,
  type DeterministicAnalyzerJobData,
} from "./queues/deterministic.js";
import { DeterministicAnalyzerService } from "../services/deterministic-analyzer.js";

export function startDeterministicAnalyzerWorker(): Worker<DeterministicAnalyzerJobData> {
  const service = new DeterministicAnalyzerService();
  const worker = new Worker<DeterministicAnalyzerJobData>(
    DETERMINISTIC_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.data.jobId }, "Starting deterministic analysis");
      await service.process(job.data);
      logger.info({ jobId: job.data.jobId }, "Deterministic analysis complete");
    },
    { connection: resolveQueueConnection() }
  );

  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.data.jobId, error: error?.message },
      "Deterministic analyzer worker failure"
    );
  });

  worker.on("completed", (job) => {
    logger.debug(
      { jobId: job.data.jobId },
      "Deterministic analyzer job completed"
    );
  });

  return worker;
}
