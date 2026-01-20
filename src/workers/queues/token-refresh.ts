/**
 * Token Refresh Queue
 *
 * Scheduled jobs for OAuth token lifecycle management:
 * - Periodic token refresh (every 5 minutes)
 * - Token health checks (every hour)
 *
 * Uses BullMQ's repeat functionality for scheduling.
 */

import {
  Queue,
  Worker,
  type ConnectionOptions,
  type JobsOptions,
} from "bullmq";
import { logger } from "../../utils/logger.js";
import { config } from "../../utils/config.js";
import { URL } from "node:url";
import {
  tokenRefreshJobHandler,
  tokenHealthCheckJobHandler,
  refreshIntegrationTokens,
} from "../../services/token-lifecycle.js";

export const TOKEN_REFRESH_QUEUE_NAME = "token-refresh";

// ============================================
// Types
// ============================================

export type TokenJobType = "refresh-all" | "health-check" | "refresh-single";

export interface TokenRefreshJobData {
  type: TokenJobType;
  // For single refresh
  orgId?: string;
  integrationId?: string;
}

// ============================================
// Queue Setup
// ============================================

let queue: Queue<TokenRefreshJobData> | null = null;

function resolveQueueConnection(): ConnectionOptions {
  const redisUrl = config.REDIS_URL;
  const isTls = redisUrl.startsWith("rediss://");
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname ? Number(parsed.pathname.replace("/", "")) || 0 : 0,
    ...(isTls
      ? {
          tls: {
            rejectUnauthorized: false,
          },
        }
      : {}),
  };
}

function getQueue(): Queue<TokenRefreshJobData> {
  if (queue) {
    return queue;
  }

  queue = new Queue(TOKEN_REFRESH_QUEUE_NAME, {
    connection: resolveQueueConnection(),
  });

  return queue;
}

// ============================================
// Job Options
// ============================================

const defaultJobOptions: JobsOptions = {
  removeOnComplete: 50,
  removeOnFail: 100,
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000, // 5 seconds
  },
};

// ============================================
// Scheduler Setup
// ============================================

/**
 * Initialize recurring jobs for token management
 * Call this on application startup
 */
export async function initializeTokenScheduler(): Promise<void> {
  if (config.NODE_ENV === "test") {
    logger.debug("Skipping token scheduler in test mode");
    return;
  }

  const q = getQueue();

  // Remove any existing repeat jobs to avoid duplicates
  const repeatableJobs = await q.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await q.removeRepeatableByKey(job.key);
  }

  // Schedule token refresh every 5 minutes
  await q.add(
    "token-refresh",
    { type: "refresh-all" },
    {
      ...defaultJobOptions,
      repeat: {
        every: 5 * 60 * 1000, // 5 minutes
      },
      jobId: "scheduled-token-refresh",
    }
  );

  // Schedule health check every hour
  await q.add(
    "token-health-check",
    { type: "health-check" },
    {
      ...defaultJobOptions,
      repeat: {
        every: 60 * 60 * 1000, // 1 hour
      },
      jobId: "scheduled-health-check",
    }
  );

  logger.info(
    { refreshInterval: "5m", healthCheckInterval: "1h" },
    "Token refresh scheduler initialized"
  );
}

// ============================================
// Manual Triggers
// ============================================

/**
 * Trigger immediate refresh of all expiring tokens
 */
export async function triggerTokenRefresh(): Promise<void> {
  const q = getQueue();
  await q.add(
    "token-refresh-manual",
    { type: "refresh-all" },
    defaultJobOptions
  );
  logger.info("Manual token refresh triggered");
}

/**
 * Trigger refresh for a specific integration
 */
export async function triggerSingleTokenRefresh(
  orgId: string,
  integrationId: string
): Promise<void> {
  const q = getQueue();
  await q.add(
    "token-refresh-single",
    { type: "refresh-single", orgId, integrationId },
    defaultJobOptions
  );
  logger.info({ orgId, integrationId }, "Single token refresh triggered");
}

// ============================================
// Worker
// ============================================

export function startTokenRefreshWorker(): Worker<TokenRefreshJobData> {
  const worker = new Worker<TokenRefreshJobData>(
    TOKEN_REFRESH_QUEUE_NAME,
    async (job) => {
      logger.debug(
        { jobId: job.id, type: job.data.type },
        "Processing token job"
      );

      try {
        switch (job.data.type) {
          case "refresh-all":
            await tokenRefreshJobHandler();
            break;

          case "health-check":
            await tokenHealthCheckJobHandler();
            break;

          case "refresh-single":
            if (job.data.orgId && job.data.integrationId) {
              const result = await refreshIntegrationTokens(
                job.data.orgId,
                job.data.integrationId
              );
              if (!result.success) {
                throw new Error(result.message);
              }
            } else {
              throw new Error(
                "Missing orgId or integrationId for single refresh"
              );
            }
            break;

          default:
            throw new Error(`Unknown job type: ${job.data.type}`);
        }

        logger.debug(
          { jobId: job.id, type: job.data.type },
          "Token job completed"
        );
      } catch (error) {
        logger.error(
          { jobId: job.id, type: job.data.type, error },
          "Token job failed"
        );
        throw error;
      }
    },
    {
      connection: resolveQueueConnection(),
      concurrency: 1, // Process one at a time to avoid race conditions
    }
  );

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, type: job?.data.type, error: err.message },
      "Token refresh job failed"
    );
  });

  worker.on("error", (err) => {
    logger.error({ error: err.message }, "Token refresh worker error");
  });

  return worker;
}
