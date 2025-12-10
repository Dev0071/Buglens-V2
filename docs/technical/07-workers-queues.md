# 07 - Workers & Queues

## Overview

The Workers & Queues subsystem handles asynchronous job processing using BullMQ and Redis. All long-running operations (code fetching, AST analysis, LLM calls, Slack notifications) are processed via background jobs to ensure webhook responses remain fast.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        WORKERS & QUEUES                                      │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         BullMQ QUEUES                                   │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │   rca-jobs                    │   Priority: 1 (High)            │   │ │
│  │  │   Main RCA processing queue   │   Concurrency: 3                │   │ │
│  │  │   Rate limited per org        │   Retry: 3 attempts             │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │   code-fetch                  │   Priority: 2 (Normal)          │   │ │
│  │  │   GitHub code fetching        │   Concurrency: 5                │   │ │
│  │  │   Respects rate limits        │   Retry: 5 attempts             │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │   notifications               │   Priority: 3 (Low)             │   │ │
│  │  │   Slack/Email delivery        │   Concurrency: 10               │   │ │
│  │  │   Non-blocking                │   Retry: 3 attempts             │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │   cost-tracking               │   Priority: 4 (Background)      │   │ │
│  │  │   Async cost metric updates   │   Concurrency: 1                │   │ │
│  │  │   Non-critical                │   Retry: 1 attempt              │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                       JOB FLOW DIAGRAM                                  │ │
│  │                                                                         │ │
│  │  Webhook ──▶ Validate ──▶ Enqueue ──▶ Worker ──▶ Process ──▶ Complete  │ │
│  │                 │                        │                              │ │
│  │                 │                        │                              │ │
│  │                 ▼                        ▼                              │ │
│  │           Rate Check              Child Jobs                            │ │
│  │           Quota Check             (code-fetch)                          │ │
│  │                                   (notifications)                       │ │
│  │                                                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         REDIS STRUCTURE                                 │ │
│  │                                                                         │ │
│  │  bull:rca-jobs:*        - RCA job queue                                │ │
│  │  bull:code-fetch:*      - Code fetch queue                             │ │
│  │  bull:notifications:*   - Notification queue                           │ │
│  │  bull:cost-tracking:*   - Cost tracking queue                          │ │
│  │                                                                         │ │
│  │  ratelimit:*            - Rate limit counters                          │ │
│  │  cache:gh:*             - GitHub file cache                            │ │
│  │  cache:rca:*            - RCA result cache                             │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                                 | Purpose                          |
| ------------------------------------ | -------------------------------- |
| `src/workers/rca-worker.ts`          | Main RCA processing worker       |
| `src/workers/code-fetch-worker.ts`   | Code fetching worker             |
| `src/workers/notification-worker.ts` | Slack/Email notification worker  |
| `src/services/queue.ts`              | Queue configuration and helpers  |
| `src/services/job-scheduler.ts`      | Job scheduling and orchestration |

---

## Queue Configuration

```typescript
// src/services/queue.ts
import { Queue, Worker, QueueEvents, Job } from "bullmq";
import Redis from "ioredis";
import { config } from "../utils/config";

// Shared Redis connection
const redisConnection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

// Queue definitions with configuration
export const QUEUES = {
  RCA_JOBS: "rca-jobs",
  CODE_FETCH: "code-fetch",
  NOTIFICATIONS: "notifications",
  COST_TRACKING: "cost-tracking",
} as const;

export interface QueueConfig {
  name: string;
  concurrency: number;
  priority: number;
  retries: number;
  backoff: {
    type: "exponential" | "fixed";
    delay: number;
  };
}

export const QUEUE_CONFIGS: Record<keyof typeof QUEUES, QueueConfig> = {
  RCA_JOBS: {
    name: QUEUES.RCA_JOBS,
    concurrency: 3,
    priority: 1,
    retries: 3,
    backoff: {
      type: "exponential",
      delay: 5000, // 5s, 10s, 20s
    },
  },
  CODE_FETCH: {
    name: QUEUES.CODE_FETCH,
    concurrency: 5,
    priority: 2,
    retries: 5,
    backoff: {
      type: "exponential",
      delay: 2000, // 2s, 4s, 8s, 16s, 32s
    },
  },
  NOTIFICATIONS: {
    name: QUEUES.NOTIFICATIONS,
    concurrency: 10,
    priority: 3,
    retries: 3,
    backoff: {
      type: "fixed",
      delay: 10000, // 10s between retries
    },
  },
  COST_TRACKING: {
    name: QUEUES.COST_TRACKING,
    concurrency: 1,
    priority: 4,
    retries: 1,
    backoff: {
      type: "fixed",
      delay: 1000,
    },
  },
};

// Create queue instance
export function createQueue(queueName: keyof typeof QUEUES): Queue {
  const queueConfig = QUEUE_CONFIGS[queueName];

  return new Queue(queueConfig.name, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: queueConfig.retries,
      backoff: queueConfig.backoff,
      removeOnComplete: {
        age: 86400, // Keep completed jobs for 24 hours
        count: 1000, // Keep last 1000 completed
      },
      removeOnFail: {
        age: 604800, // Keep failed jobs for 7 days
      },
    },
  });
}

// Create worker instance
export function createWorker<T, R>(
  queueName: keyof typeof QUEUES,
  processor: (job: Job<T>) => Promise<R>
): Worker<T, R> {
  const queueConfig = QUEUE_CONFIGS[queueName];

  return new Worker<T, R>(queueConfig.name, processor, {
    connection: redisConnection,
    concurrency: queueConfig.concurrency,
    limiter: {
      max: 100,
      duration: 60000, // 100 jobs per minute max
    },
  });
}

// Queue health check
export async function checkQueueHealth(): Promise<Record<string, QueueHealth>> {
  const health: Record<string, QueueHealth> = {};

  for (const [key, config] of Object.entries(QUEUE_CONFIGS)) {
    const queue = createQueue(key as keyof typeof QUEUES);

    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
    ]);

    health[config.name] = {
      waiting,
      active,
      completed,
      failed,
      isPaused: await queue.isPaused(),
    };

    await queue.close();
  }

  return health;
}

interface QueueHealth {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  isPaused: boolean;
}
```

---

## RCA Worker

```typescript
// src/workers/rca-worker.ts
import { Job } from "bullmq";
import { createWorker, createQueue, QUEUES } from "../services/queue";
import { EvidenceCollectorService } from "../services/evidence-collector";
import { LLMOrchestrator } from "../services/llm-orchestrator";
import { EvidenceStorageService } from "../services/evidence-storage";
import { pool } from "../db/client";
import { logger } from "../utils/logger";
import { checkOrgQuota, trackCost } from "../utils/rate-limits";

export interface RCAJobData {
  eventId: string;
  orgId: string;
  eventData: SentryEvent;
  repo: string;
  ref: string;
  priority?: "high" | "normal" | "low";
}

export interface RCAJobResult {
  rcaId: string;
  confidence: number;
  rootCause: string;
  suggestedFix: string;
  executionTimeMs: number;
}

// Services (initialized once)
const evidenceCollector = new EvidenceCollectorService();
const llmOrchestrator = new LLMOrchestrator();
const evidenceStorage = new EvidenceStorageService();
const notificationQueue = createQueue("NOTIFICATIONS");

export const rcaWorker = createWorker<RCAJobData, RCAJobResult>(
  "RCA_JOBS",
  async (job: Job<RCAJobData>) => {
    const startTime = Date.now();
    const { eventId, orgId, eventData, repo, ref } = job.data;

    logger.info({ jobId: job.id, eventId, orgId }, "Starting RCA job");

    try {
      // 1. Check organization quota
      await checkOrgQuota(orgId, "rca");

      // 2. Update job status
      await updateJobStatus(eventId, "processing");
      await job.updateProgress(10);

      // 3. Collect evidence
      logger.debug({ eventId }, "Collecting evidence");
      const evidence = await evidenceCollector.collect({
        eventId,
        orgId,
        eventData,
        repo,
        ref,
      });
      await job.updateProgress(40);

      // 4. Store evidence bundle
      await evidenceStorage.store(orgId, eventId, evidence);
      await job.updateProgress(50);

      // 5. Check LLM quota before expensive operation
      await checkOrgQuota(orgId, "llm");

      // 6. Generate RCA with LLM
      logger.debug(
        { eventId, confidence: evidence.metadata.confidence },
        "Generating RCA"
      );
      const rca = await llmOrchestrator.generateRCA(evidence);
      await job.updateProgress(80);

      // 7. Track costs
      await trackCost(orgId, "llm", rca.tokensUsed, rca.cost);

      // 8. Store RCA result
      const rcaId = await storeRCAResult(orgId, eventId, rca);
      await job.updateProgress(90);

      // 9. Queue notification
      await notificationQueue.add("slack-notification", {
        orgId,
        eventId,
        rcaId,
        channel: await getSlackChannel(orgId),
        rca: {
          rootCause: rca.rootCause,
          confidence: rca.confidence,
          suggestedFix: rca.suggestedFix,
        },
      });

      // 10. Complete
      await updateJobStatus(eventId, "completed");
      await job.updateProgress(100);

      const executionTimeMs = Date.now() - startTime;
      logger.info(
        {
          jobId: job.id,
          eventId,
          rcaId,
          executionTimeMs,
          confidence: rca.confidence,
        },
        "RCA job completed"
      );

      return {
        rcaId,
        confidence: rca.confidence,
        rootCause: rca.rootCause,
        suggestedFix: rca.suggestedFix,
        executionTimeMs,
      };
    } catch (error) {
      logger.error({ error, jobId: job.id, eventId }, "RCA job failed");
      await updateJobStatus(eventId, "failed", error.message);
      throw error;
    }
  }
);

// Event handlers
rcaWorker.on("completed", (job, result) => {
  logger.info(
    {
      jobId: job.id,
      rcaId: result.rcaId,
      executionTimeMs: result.executionTimeMs,
    },
    "RCA job success"
  );
});

rcaWorker.on("failed", (job, error) => {
  logger.error(
    {
      jobId: job?.id,
      error: error.message,
      stack: error.stack,
    },
    "RCA job failure"
  );
});

rcaWorker.on("stalled", (jobId) => {
  logger.warn({ jobId }, "RCA job stalled");
});

// Helper functions
async function updateJobStatus(
  eventId: string,
  status: string,
  error?: string
): Promise<void> {
  await pool.query(
    `
    UPDATE rca_jobs
    SET status = $1, error_message = $2, updated_at = NOW()
    WHERE event_id = $3
  `,
    [status, error || null, eventId]
  );
}

async function storeRCAResult(
  orgId: string,
  eventId: string,
  rca: RCAOutput
): Promise<string> {
  const result = await pool.query(
    `
    INSERT INTO rca_results (
      org_id, event_id, root_cause, confidence, suggested_fix,
      evidence_summary, llm_tokens_used, llm_cost_usd
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `,
    [
      orgId,
      eventId,
      rca.rootCause,
      rca.confidence,
      rca.suggestedFix,
      JSON.stringify(rca.evidenceSummary),
      rca.tokensUsed,
      rca.cost,
    ]
  );

  return result.rows[0].id;
}

async function getSlackChannel(orgId: string): Promise<string | null> {
  const result = await pool.query(
    `
    SELECT config->>'slack_channel' as channel
    FROM integrations
    WHERE org_id = $1 AND type = 'slack' AND enabled = true
  `,
    [orgId]
  );

  return result.rows[0]?.channel || null;
}
```

---

## Code Fetch Worker

```typescript
// src/workers/code-fetch-worker.ts
import { Job } from "bullmq";
import { createWorker } from "../services/queue";
import { CodeFetcherService } from "../services/code-fetcher";
import { logger } from "../utils/logger";

export interface CodeFetchJobData {
  orgId: string;
  repo: string;
  ref: string;
  files: Array<{
    path: string;
    lineNumber?: number;
  }>;
  requestId: string;
}

export interface CodeFetchJobResult {
  requestId: string;
  results: Array<{
    path: string;
    content: string | null;
    error: string | null;
  }>;
  cacheHits: number;
  cacheMisses: number;
}

const codeFetcher = new CodeFetcherService();

export const codeFetchWorker = createWorker<
  CodeFetchJobData,
  CodeFetchJobResult
>("CODE_FETCH", async (job: Job<CodeFetchJobData>) => {
  const { orgId, repo, ref, files, requestId } = job.data;

  logger.debug(
    {
      jobId: job.id,
      requestId,
      fileCount: files.length,
    },
    "Starting code fetch job"
  );

  const results: CodeFetchJobResult["results"] = [];
  let cacheHits = 0;
  let cacheMisses = 0;

  // Process files in parallel (respecting rate limits internally)
  const fetchPromises = files.map(async (file) => {
    try {
      const result = await codeFetcher.fetch({
        orgId,
        repo,
        ref,
        filePath: file.path,
      });

      if (result.fromCache) {
        cacheHits++;
      } else {
        cacheMisses++;
      }

      return {
        path: file.path,
        content: result.content,
        error: null,
      };
    } catch (error) {
      cacheMisses++;
      return {
        path: file.path,
        content: null,
        error: error.message,
      };
    }
  });

  const fetchResults = await Promise.all(fetchPromises);
  results.push(...fetchResults);

  // Update progress
  await job.updateProgress(100);

  logger.info(
    {
      jobId: job.id,
      requestId,
      totalFiles: files.length,
      successful: results.filter((r) => r.content).length,
      cacheHits,
      cacheMisses,
    },
    "Code fetch job completed"
  );

  return {
    requestId,
    results,
    cacheHits,
    cacheMisses,
  };
});
```

---

## Notification Worker

```typescript
// src/workers/notification-worker.ts
import { Job } from "bullmq";
import { createWorker } from "../services/queue";
import { SlackService } from "../services/slack";
import { logger } from "../utils/logger";

export interface NotificationJobData {
  type: "slack" | "email" | "webhook";
  orgId: string;
  eventId: string;
  rcaId: string;
  channel?: string;
  email?: string;
  webhookUrl?: string;
  rca: {
    rootCause: string;
    confidence: number;
    suggestedFix: string;
  };
}

const slackService = new SlackService();

export const notificationWorker = createWorker<NotificationJobData, void>(
  "NOTIFICATIONS",
  async (job: Job<NotificationJobData>) => {
    const { type, orgId, eventId, rcaId, rca } = job.data;

    logger.debug(
      {
        jobId: job.id,
        type,
        eventId,
      },
      "Starting notification job"
    );

    try {
      switch (type) {
        case "slack":
          await sendSlackNotification(job.data);
          break;
        case "email":
          await sendEmailNotification(job.data);
          break;
        case "webhook":
          await sendWebhookNotification(job.data);
          break;
        default:
          throw new Error(`Unknown notification type: ${type}`);
      }

      logger.info(
        {
          jobId: job.id,
          type,
          eventId,
          rcaId,
        },
        "Notification sent"
      );
    } catch (error) {
      logger.error(
        {
          error,
          jobId: job.id,
          type,
        },
        "Notification failed"
      );
      throw error;
    }
  }
);

async function sendSlackNotification(data: NotificationJobData): Promise<void> {
  if (!data.channel) {
    logger.warn({ orgId: data.orgId }, "No Slack channel configured");
    return;
  }

  const confidenceEmoji = getConfidenceEmoji(data.rca.confidence);

  await slackService.sendMessage({
    channel: data.channel,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${confidenceEmoji} Buglens RCA Report`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Confidence:* ${Math.round(data.rca.confidence * 100)}%`,
          },
          {
            type: "mrkdwn",
            text: `*Event:* ${data.eventId.substring(0, 8)}`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Root Cause:*\n${data.rca.rootCause}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Suggested Fix:*\n\`\`\`${data.rca.suggestedFix}\`\`\``,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View Full Report",
            },
            url: `${config.APP_URL}/rca/${data.rcaId}`,
          },
        ],
      },
    ],
  });
}

async function sendEmailNotification(data: NotificationJobData): Promise<void> {
  // TODO: Implement email notifications (Phase 2)
  logger.info({ email: data.email }, "Email notifications not yet implemented");
}

async function sendWebhookNotification(
  data: NotificationJobData
): Promise<void> {
  if (!data.webhookUrl) return;

  await fetch(data.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_id: data.eventId,
      rca_id: data.rcaId,
      root_cause: data.rca.rootCause,
      confidence: data.rca.confidence,
      suggested_fix: data.rca.suggestedFix,
    }),
  });
}

function getConfidenceEmoji(confidence: number): string {
  if (confidence >= 0.8) return "🎯";
  if (confidence >= 0.6) return "🔍";
  if (confidence >= 0.4) return "🤔";
  return "⚠️";
}
```

---

## Job Scheduler

```typescript
// src/services/job-scheduler.ts
import { createQueue, QUEUES } from "./queue";
import { RCAJobData } from "../workers/rca-worker";
import { logger } from "../utils/logger";
import { checkOrgQuota } from "../utils/rate-limits";

const rcaQueue = createQueue("RCA_JOBS");
const codeFetchQueue = createQueue("CODE_FETCH");

export async function scheduleRCAJob(
  data: RCAJobData,
  options: { priority?: "high" | "normal" | "low"; delay?: number } = {}
): Promise<string> {
  const { priority = "normal", delay } = options;

  // Pre-check quota (fail fast)
  try {
    await checkOrgQuota(data.orgId, "rca");
  } catch (error) {
    logger.warn(
      {
        orgId: data.orgId,
        error: error.message,
      },
      "RCA quota exceeded, job not scheduled"
    );
    throw error;
  }

  // Calculate priority value (lower = higher priority)
  const priorityMap = { high: 1, normal: 5, low: 10 };
  const priorityValue = priorityMap[priority];

  const job = await rcaQueue.add("process-rca", data, {
    priority: priorityValue,
    delay,
    jobId: `rca-${data.eventId}`, // Prevent duplicates
  });

  logger.info(
    {
      jobId: job.id,
      eventId: data.eventId,
      orgId: data.orgId,
      priority,
    },
    "RCA job scheduled"
  );

  return job.id!;
}

export async function scheduleCodeFetch(
  orgId: string,
  repo: string,
  ref: string,
  files: Array<{ path: string; lineNumber?: number }>
): Promise<string> {
  const requestId = crypto.randomUUID();

  const job = await codeFetchQueue.add("fetch-code", {
    orgId,
    repo,
    ref,
    files,
    requestId,
  });

  return requestId;
}

// Graceful shutdown
export async function shutdownQueues(): Promise<void> {
  logger.info("Shutting down queues...");

  await Promise.all([rcaQueue.close(), codeFetchQueue.close()]);

  logger.info("Queues shut down");
}
```

---

## Worker Management

### Starting Workers

```typescript
// src/workers/index.ts
import { rcaWorker } from "./rca-worker";
import { codeFetchWorker } from "./code-fetch-worker";
import { notificationWorker } from "./notification-worker";
import { logger } from "../utils/logger";

const workers = [rcaWorker, codeFetchWorker, notificationWorker];

export async function startWorkers(): Promise<void> {
  logger.info(`Starting ${workers.length} workers...`);

  // Workers start automatically when created
  // Add global error handlers
  for (const worker of workers) {
    worker.on("error", (error) => {
      logger.error({ error, worker: worker.name }, "Worker error");
    });
  }

  logger.info("All workers started");
}

export async function stopWorkers(): Promise<void> {
  logger.info("Stopping workers...");

  await Promise.all(workers.map((w) => w.close()));

  logger.info("All workers stopped");
}

// Graceful shutdown handler
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down...");
  await stopWorkers();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down...");
  await stopWorkers();
  process.exit(0);
});
```

### Running Workers (Separate Process)

```bash
# Start workers independently from API
npx tsx src/workers/start.ts
```

```typescript
// src/workers/start.ts
import { startWorkers } from "./index";
import { logger } from "../utils/logger";

async function main() {
  logger.info("Starting Buglens workers...");
  await startWorkers();
  logger.info("Workers running. Press Ctrl+C to stop.");
}

main().catch((error) => {
  logger.error({ error }, "Failed to start workers");
  process.exit(1);
});
```

---

## Monitoring

### Queue Metrics

```typescript
// src/api/routes/admin/queues.ts
server.get("/admin/queues", async (request, reply) => {
  const health = await checkQueueHealth();

  return reply.send({
    status: "ok",
    queues: health,
    timestamp: new Date().toISOString(),
  });
});

server.post("/admin/queues/:name/pause", async (request, reply) => {
  const { name } = request.params as { name: string };
  const queue = getQueueByName(name);

  await queue.pause();

  return reply.send({ paused: true });
});

server.post("/admin/queues/:name/resume", async (request, reply) => {
  const { name } = request.params as { name: string };
  const queue = getQueueByName(name);

  await queue.resume();

  return reply.send({ paused: false });
});
```

### Dashboard Integration

Use [Bull Board](https://github.com/felixmosh/bull-board) for visual monitoring:

```typescript
// src/api/admin/bull-board.ts
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import { createQueue, QUEUES } from "../../services/queue";

export function setupBullBoard(server: FastifyInstance) {
  const serverAdapter = new FastifyAdapter();

  const queues = Object.keys(QUEUES).map(
    (key) => new BullMQAdapter(createQueue(key as keyof typeof QUEUES))
  );

  createBullBoard({
    queues,
    serverAdapter,
  });

  serverAdapter.setBasePath("/admin/queues");
  server.register(serverAdapter.registerPlugin(), {
    basePath: "/admin/queues",
    prefix: "/admin/queues",
  });
}
```

---

## Testing

```typescript
// tests/unit/queue.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scheduleRCAJob } from "../../src/services/job-scheduler";
import { createQueue } from "../../src/services/queue";

vi.mock("../../src/services/queue", () => ({
  createQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({ id: "test-job-id" }),
  })),
}));

vi.mock("../../src/utils/rate-limits", () => ({
  checkOrgQuota: vi.fn().mockResolvedValue(true),
}));

describe("Job Scheduler", () => {
  it("schedules RCA job with correct data", async () => {
    const mockQueue = { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
    vi.mocked(createQueue).mockReturnValue(mockQueue as any);

    const jobData = {
      eventId: "event-123",
      orgId: "org-456",
      eventData: {} as any,
      repo: "owner/repo",
      ref: "main",
    };

    const jobId = await scheduleRCAJob(jobData);

    expect(jobId).toBe("job-1");
    expect(mockQueue.add).toHaveBeenCalledWith(
      "process-rca",
      jobData,
      expect.objectContaining({
        priority: 5, // normal
        jobId: "rca-event-123",
      })
    );
  });

  it("respects priority setting", async () => {
    const mockQueue = { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
    vi.mocked(createQueue).mockReturnValue(mockQueue as any);

    await scheduleRCAJob(
      { eventId: "e", orgId: "o", eventData: {} as any, repo: "r", ref: "r" },
      { priority: "high" }
    );

    expect(mockQueue.add).toHaveBeenCalledWith(
      "process-rca",
      expect.anything(),
      expect.objectContaining({ priority: 1 })
    );
  });
});
```
