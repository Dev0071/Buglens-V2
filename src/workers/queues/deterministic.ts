import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { config } from "../../utils/config.js";
import { logger } from "../../utils/logger.js";
import { URL } from "node:url";

export const DETERMINISTIC_QUEUE_NAME = "deterministic-analyzer";

export interface DeterministicAnalyzerJobData {
  jobId: string;
  eventId: string;
  orgId: string;
}

let queue: Queue<DeterministicAnalyzerJobData> | null = null;
const inMemoryJobs: DeterministicAnalyzerJobData[] = [];

export function resolveQueueConnection(): ConnectionOptions {
  const parsed = new URL(config.REDIS_URL);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname ? Number(parsed.pathname.replace("/", "")) || 0 : 0,
  };
}

function getQueue(): Queue<DeterministicAnalyzerJobData> {
  if (queue) {
    return queue;
  }

  queue = new Queue(DETERMINISTIC_QUEUE_NAME, {
    connection: resolveQueueConnection(),
  });

  return queue;
}

const defaultJobOptions: JobsOptions = {
  removeOnComplete: 100,
  removeOnFail: 100,
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
};

export async function enqueueDeterministicJob(
  data: DeterministicAnalyzerJobData
): Promise<void> {
  if (config.NODE_ENV === "test") {
    inMemoryJobs.push(data);
    logger.debug({ data }, "Captured deterministic job (test mode)");
    return;
  }

  const q = getQueue();
  await q.add("analyze", data, defaultJobOptions);

  logger.info(
    {
      jobId: data.jobId,
      eventId: data.eventId,
      orgId: data.orgId,
      queue: "deterministic-analyzer",
    },
    "[QUEUE:ENQUEUE] Deterministic analyzer job queued"
  );
}

export function peekDeterministicJobs(): DeterministicAnalyzerJobData[] {
  return [...inMemoryJobs];
}
