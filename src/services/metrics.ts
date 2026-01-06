/**
 * Metrics Service for Buglens
 *
 * Provides observability for:
 * - Cache hit rates (Redis, S3, Database)
 * - Source map resolution success/failure
 * - LLM usage and costs
 * - GitHub API rate limiting
 *
 * In production, integrates with CloudWatch.
 * In development, uses in-memory tracking with console output.
 */

import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import {
  CloudWatchClient,
  PutMetricDataCommand,
  type MetricDatum,
} from "@aws-sdk/client-cloudwatch";

// ============================================
// Metrics Configuration
// ============================================

const NAMESPACE = "Buglens/MVP";
const FLUSH_INTERVAL_MS = 60_000; // Flush metrics every minute
const MAX_BATCH_SIZE = 20; // CloudWatch limit per request

// ============================================
// Types
// ============================================

export type CacheTier = "redis" | "s3" | "database" | "github";
export type SourceMapOutcome =
  | "resolved"
  | "inline_resolved"
  | "external_resolved"
  | "missing"
  | "malformed"
  | "parse_error";
export type RCAJobStatus = "success" | "failure" | "timeout" | "retry";
export type DatabaseOperationType = "query" | "transaction" | "connection";

interface MetricDataPoint {
  name: string;
  value: number;
  unit: "Count" | "Milliseconds" | "Percent" | "Bytes" | "None";
  dimensions: Record<string, string>;
  timestamp: Date;
}

interface AggregatedMetrics {
  // Cache metrics
  cacheHits: { [tier in CacheTier]: number };
  cacheLookups: number;
  cacheLookupLatency: number[];

  // Source map metrics
  sourceMapOutcomes: { [outcome in SourceMapOutcome]: number };
  sourceMapLatency: number[];
  sourceMapBytesProcessed: number;

  // LLM metrics
  llmRequests: number;
  llmTokensUsed: number;
  llmLatency: number[];
  llmErrors: number;

  // GitHub API metrics
  githubApiCalls: number;
  githubRateLimitRemaining: number;
  githubApiLatency: number[];

  // RCA Job metrics (NEW)
  rcaJobs: { [status in RCAJobStatus]: number };
  rcaJobLatency: number[];
  rcaQueueDepth: number;
  rcaJobsByOrg: Map<string, { success: number; failure: number }>;

  // Database Pool metrics (NEW)
  dbQueries: number;
  dbQueryLatency: number[];
  dbConnections: { active: number; idle: number; waiting: number };
  dbTransactions: { success: number; failure: number };
  dbConnectionWaitTime: number[];

  // Organization-level metrics (NEW)
  eventsByOrg: Map<string, number>;
  llmTokensByOrg: Map<string, number>;
}

// ============================================
// In-Memory Metrics Store
// ============================================

let metrics: AggregatedMetrics = createEmptyMetrics();
let cloudWatchClient: CloudWatchClient | null = null;
let flushInterval: NodeJS.Timeout | null = null;
let isInitialized = false;

function createEmptyMetrics(): AggregatedMetrics {
  return {
    cacheHits: { redis: 0, s3: 0, database: 0, github: 0 },
    cacheLookups: 0,
    cacheLookupLatency: [],

    sourceMapOutcomes: {
      resolved: 0,
      inline_resolved: 0,
      external_resolved: 0,
      missing: 0,
      malformed: 0,
      parse_error: 0,
    },
    sourceMapLatency: [],
    sourceMapBytesProcessed: 0,

    llmRequests: 0,
    llmTokensUsed: 0,
    llmLatency: [],
    llmErrors: 0,

    githubApiCalls: 0,
    githubRateLimitRemaining: 5000,
    githubApiLatency: [],

    // RCA Job metrics
    rcaJobs: { success: 0, failure: 0, timeout: 0, retry: 0 },
    rcaJobLatency: [],
    rcaQueueDepth: 0,
    rcaJobsByOrg: new Map(),

    // Database Pool metrics
    dbQueries: 0,
    dbQueryLatency: [],
    dbConnections: { active: 0, idle: 0, waiting: 0 },
    dbTransactions: { success: 0, failure: 0 },
    dbConnectionWaitTime: [],

    // Organization-level metrics
    eventsByOrg: new Map(),
    llmTokensByOrg: new Map(),
  };
}

// ============================================
// Initialization
// ============================================

/**
 * Initialize the metrics service.
 * Call this once at application startup.
 */
export function initializeMetrics(): void {
  if (isInitialized) {
    return;
  }

  // Only create CloudWatch client in production/staging or when AWS_REGION is set
  const isProdOrStaging =
    config.NODE_ENV === "production" ||
    (config.NODE_ENV as string) === "staging";
  if (isProdOrStaging || config.AWS_REGION) {
    try {
      cloudWatchClient = new CloudWatchClient({
        region: config.AWS_REGION || "us-east-1",
      });
      logger.info(
        { namespace: NAMESPACE, region: config.AWS_REGION },
        "CloudWatch metrics client initialized"
      );
    } catch (error) {
      logger.warn(
        { error },
        "Failed to initialize CloudWatch client - metrics will be local only"
      );
    }
  }

  // Start periodic flush
  flushInterval = setInterval(() => {
    flushMetrics().catch((error) => {
      logger.error({ error }, "Failed to flush metrics");
    });
  }, FLUSH_INTERVAL_MS);

  isInitialized = true;
  logger.info("Metrics service initialized");
}

/**
 * Shutdown the metrics service.
 * Flushes pending metrics before stopping.
 */
export async function shutdownMetrics(): Promise<void> {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }

  // Final flush
  await flushMetrics();
  isInitialized = false;
  logger.info("Metrics service shutdown complete");
}

// ============================================
// Cache Metrics
// ============================================

/**
 * Record a cache lookup with its result.
 */
export function recordCacheLookup(
  tier: CacheTier,
  hit: boolean,
  latencyMs: number,
  orgId?: string
): void {
  metrics.cacheLookups++;
  metrics.cacheLookupLatency.push(latencyMs);

  if (hit) {
    metrics.cacheHits[tier]++;
  }

  // Log for debugging
  logger.debug(
    { tier, hit, latencyMs, orgId },
    `Cache ${hit ? "hit" : "miss"}: ${tier}`
  );
}

/**
 * Get current cache hit rate as a percentage.
 */
export function getCacheHitRate(): number {
  const totalHits =
    metrics.cacheHits.redis + metrics.cacheHits.s3 + metrics.cacheHits.database;

  if (metrics.cacheLookups === 0) {
    return 0;
  }

  return (totalHits / metrics.cacheLookups) * 100;
}

/**
 * Get cache stats by tier.
 */
export function getCacheStatsByTier(): { [tier in CacheTier]: number } {
  return { ...metrics.cacheHits };
}

// ============================================
// Source Map Metrics
// ============================================

/**
 * Record a source map resolution attempt.
 */
export function recordSourceMapResolution(
  outcome: SourceMapOutcome,
  latencyMs: number,
  bytesProcessed: number = 0,
  bundlerType?: string
): void {
  metrics.sourceMapOutcomes[outcome]++;
  metrics.sourceMapLatency.push(latencyMs);
  metrics.sourceMapBytesProcessed += bytesProcessed;

  const success = outcome.includes("resolved");
  logger.debug(
    { outcome, latencyMs, bytesProcessed, bundlerType, success },
    `Source map ${success ? "resolved" : "failed"}`
  );
}

/**
 * Get source map resolution success rate.
 */
export function getSourceMapSuccessRate(): number {
  const resolved =
    metrics.sourceMapOutcomes.resolved +
    metrics.sourceMapOutcomes.inline_resolved +
    metrics.sourceMapOutcomes.external_resolved;

  const total =
    resolved +
    metrics.sourceMapOutcomes.missing +
    metrics.sourceMapOutcomes.malformed +
    metrics.sourceMapOutcomes.parse_error;

  if (total === 0) {
    return 100; // No attempts = no failures
  }

  return (resolved / total) * 100;
}

/**
 * Get source map resolution stats.
 */
export function getSourceMapStats(): {
  outcomes: { [outcome in SourceMapOutcome]: number };
  successRate: number;
  avgLatencyMs: number;
  totalBytesProcessed: number;
} {
  const latencies = metrics.sourceMapLatency;
  const avgLatencyMs =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

  return {
    outcomes: { ...metrics.sourceMapOutcomes },
    successRate: getSourceMapSuccessRate(),
    avgLatencyMs,
    totalBytesProcessed: metrics.sourceMapBytesProcessed,
  };
}

// ============================================
// LLM Metrics
// ============================================

/**
 * Record an LLM API request.
 */
export function recordLLMRequest(
  tokensUsed: number,
  latencyMs: number,
  model: string,
  success: boolean = true
): void {
  metrics.llmRequests++;
  metrics.llmTokensUsed += tokensUsed;
  metrics.llmLatency.push(latencyMs);

  if (!success) {
    metrics.llmErrors++;
  }

  logger.debug({ tokensUsed, latencyMs, model, success }, "LLM request");
}

/**
 * Get LLM usage stats.
 */
export function getLLMStats(): {
  requests: number;
  tokensUsed: number;
  errors: number;
  avgLatencyMs: number;
  errorRate: number;
} {
  const latencies = metrics.llmLatency;
  const avgLatencyMs =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

  return {
    requests: metrics.llmRequests,
    tokensUsed: metrics.llmTokensUsed,
    errors: metrics.llmErrors,
    avgLatencyMs,
    errorRate:
      metrics.llmRequests > 0
        ? (metrics.llmErrors / metrics.llmRequests) * 100
        : 0,
  };
}

// ============================================
// GitHub API Metrics
// ============================================

/**
 * Record a GitHub API call.
 */
export function recordGitHubApiCall(
  latencyMs: number,
  rateLimitRemaining: number
): void {
  metrics.githubApiCalls++;
  metrics.githubApiLatency.push(latencyMs);
  metrics.githubRateLimitRemaining = rateLimitRemaining;

  // Warn if rate limit is low
  if (rateLimitRemaining < 100) {
    logger.warn({ rateLimitRemaining }, "GitHub API rate limit running low");
  }
}

/**
 * Get GitHub API stats.
 */
export function getGitHubApiStats(): {
  calls: number;
  rateLimitRemaining: number;
  avgLatencyMs: number;
} {
  const latencies = metrics.githubApiLatency;
  const avgLatencyMs =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

  return {
    calls: metrics.githubApiCalls,
    rateLimitRemaining: metrics.githubRateLimitRemaining,
    avgLatencyMs,
  };
}

// ============================================
// RCA Job Metrics (NEW)
// ============================================

/**
 * Record an RCA job completion.
 */
export function recordRCAJob(
  status: RCAJobStatus,
  latencyMs: number,
  orgId: string
): void {
  metrics.rcaJobs[status]++;
  metrics.rcaJobLatency.push(latencyMs);

  // Track by organization
  const orgStats = metrics.rcaJobsByOrg.get(orgId) || {
    success: 0,
    failure: 0,
  };
  if (status === "success") {
    orgStats.success++;
  } else {
    orgStats.failure++;
  }
  metrics.rcaJobsByOrg.set(orgId, orgStats);

  logger.debug(
    { status, latencyMs, orgId },
    `RCA job ${status === "success" ? "completed" : "failed"}`
  );
}

/**
 * Update RCA queue depth (call from queue worker).
 */
export function updateRCAQueueDepth(depth: number): void {
  metrics.rcaQueueDepth = depth;

  // Warn if queue is backing up
  if (depth > 100) {
    logger.warn({ queueDepth: depth }, "RCA queue depth is high");
  }
}

/**
 * Get RCA job stats.
 */
export function getRCAJobStats(): {
  total: number;
  success: number;
  failure: number;
  timeout: number;
  retry: number;
  successRate: number;
  avgLatencyMs: number;
  queueDepth: number;
} {
  const total =
    metrics.rcaJobs.success +
    metrics.rcaJobs.failure +
    metrics.rcaJobs.timeout +
    metrics.rcaJobs.retry;

  const latencies = metrics.rcaJobLatency;
  const avgLatencyMs =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

  return {
    total,
    success: metrics.rcaJobs.success,
    failure: metrics.rcaJobs.failure,
    timeout: metrics.rcaJobs.timeout,
    retry: metrics.rcaJobs.retry,
    successRate: total > 0 ? (metrics.rcaJobs.success / total) * 100 : 100,
    avgLatencyMs,
    queueDepth: metrics.rcaQueueDepth,
  };
}

/**
 * Get RCA job stats by organization.
 */
export function getRCAJobStatsByOrg(): Map<
  string,
  { success: number; failure: number; successRate: number }
> {
  const result = new Map<
    string,
    { success: number; failure: number; successRate: number }
  >();

  for (const [orgId, stats] of metrics.rcaJobsByOrg) {
    const total = stats.success + stats.failure;
    result.set(orgId, {
      ...stats,
      successRate: total > 0 ? (stats.success / total) * 100 : 100,
    });
  }

  return result;
}

// ============================================
// Database Pool Metrics (NEW)
// ============================================

/**
 * Record a database query.
 */
export function recordDatabaseQuery(
  latencyMs: number,
  success: boolean = true
): void {
  metrics.dbQueries++;
  metrics.dbQueryLatency.push(latencyMs);

  if (!success) {
    // Track failed queries via transaction failure
    metrics.dbTransactions.failure++;
  }

  // Warn on slow queries
  if (latencyMs > 1000) {
    logger.warn({ latencyMs }, "Slow database query detected");
  }
}

/**
 * Record a database transaction.
 */
export function recordDatabaseTransaction(
  success: boolean,
  latencyMs: number
): void {
  if (success) {
    metrics.dbTransactions.success++;
  } else {
    metrics.dbTransactions.failure++;
  }

  metrics.dbQueryLatency.push(latencyMs);

  logger.debug(
    { success, latencyMs },
    `Database transaction ${success ? "committed" : "rolled back"}`
  );
}

/**
 * Update database connection pool stats.
 * Call this periodically from pool monitoring.
 */
export function updateDatabasePoolStats(stats: {
  active: number;
  idle: number;
  waiting: number;
}): void {
  metrics.dbConnections = stats;

  // Calculate utilization
  const total = stats.active + stats.idle;
  const utilization = total > 0 ? (stats.active / total) * 100 : 0;

  // Warn if pool is saturated
  if (utilization > 90) {
    logger.warn(
      { ...stats, utilization: utilization.toFixed(1) + "%" },
      "Database connection pool nearly exhausted"
    );
  }

  // Warn if many connections are waiting
  if (stats.waiting > 5) {
    logger.warn(
      { waiting: stats.waiting },
      "Database connections waiting for pool"
    );
  }
}

/**
 * Record database connection wait time.
 */
export function recordDatabaseConnectionWait(waitTimeMs: number): void {
  metrics.dbConnectionWaitTime.push(waitTimeMs);

  if (waitTimeMs > 100) {
    logger.debug({ waitTimeMs }, "Database connection wait time elevated");
  }
}

/**
 * Get database pool stats.
 */
export function getDatabasePoolStats(): {
  queries: number;
  avgQueryLatencyMs: number;
  connections: { active: number; idle: number; waiting: number };
  poolUtilization: number;
  transactions: { success: number; failure: number; successRate: number };
  avgConnectionWaitMs: number;
} {
  const latencies = metrics.dbQueryLatency;
  const avgQueryLatencyMs =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

  const waitTimes = metrics.dbConnectionWaitTime;
  const avgConnectionWaitMs =
    waitTimes.length > 0
      ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length
      : 0;

  const { active, idle, waiting: _waiting } = metrics.dbConnections;
  const total = active + idle;
  const poolUtilization = total > 0 ? (active / total) * 100 : 0;

  const txnTotal =
    metrics.dbTransactions.success + metrics.dbTransactions.failure;
  const txnSuccessRate =
    txnTotal > 0 ? (metrics.dbTransactions.success / txnTotal) * 100 : 100;

  return {
    queries: metrics.dbQueries,
    avgQueryLatencyMs,
    connections: metrics.dbConnections,
    poolUtilization,
    transactions: {
      ...metrics.dbTransactions,
      successRate: txnSuccessRate,
    },
    avgConnectionWaitMs,
  };
}

// ============================================
// Organization-Level Metrics (NEW)
// ============================================

/**
 * Record an event for an organization.
 */
export function recordEventForOrg(orgId: string): void {
  const current = metrics.eventsByOrg.get(orgId) || 0;
  metrics.eventsByOrg.set(orgId, current + 1);
}

/**
 * Record LLM tokens used by an organization.
 */
export function recordLLMTokensForOrg(orgId: string, tokens: number): void {
  const current = metrics.llmTokensByOrg.get(orgId) || 0;
  metrics.llmTokensByOrg.set(orgId, current + tokens);
}

/**
 * Get events by organization.
 */
export function getEventsByOrg(): Map<string, number> {
  return new Map(metrics.eventsByOrg);
}

/**
 * Get LLM tokens by organization.
 */
export function getLLMTokensByOrg(): Map<string, number> {
  return new Map(metrics.llmTokensByOrg);
}

/**
 * Get organization-level summary stats.
 */
export function getOrgLevelStats(): {
  orgsWithEvents: number;
  orgsWithLLMUsage: number;
  topEventOrgs: Array<{ orgId: string; events: number }>;
  topLLMOrgs: Array<{ orgId: string; tokens: number }>;
} {
  // Sort by events (descending) and take top 10
  const topEventOrgs = Array.from(metrics.eventsByOrg.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([orgId, events]) => ({ orgId, events }));

  // Sort by tokens (descending) and take top 10
  const topLLMOrgs = Array.from(metrics.llmTokensByOrg.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([orgId, tokens]) => ({ orgId, tokens }));

  return {
    orgsWithEvents: metrics.eventsByOrg.size,
    orgsWithLLMUsage: metrics.llmTokensByOrg.size,
    topEventOrgs,
    topLLMOrgs,
  };
}

// ============================================
// Aggregate Stats
// ============================================

/**
 * Get all metrics as a summary object.
 */
export function getAllStats(): {
  cache: ReturnType<typeof getCacheStatsByTier> & { hitRate: number };
  sourceMap: ReturnType<typeof getSourceMapStats>;
  llm: ReturnType<typeof getLLMStats>;
  github: ReturnType<typeof getGitHubApiStats>;
  rcaJobs: ReturnType<typeof getRCAJobStats>;
  database: ReturnType<typeof getDatabasePoolStats>;
  organizations: ReturnType<typeof getOrgLevelStats>;
  collectedAt: Date;
} {
  return {
    cache: { ...getCacheStatsByTier(), hitRate: getCacheHitRate() },
    sourceMap: getSourceMapStats(),
    llm: getLLMStats(),
    github: getGitHubApiStats(),
    rcaJobs: getRCAJobStats(),
    database: getDatabasePoolStats(),
    organizations: getOrgLevelStats(),
    collectedAt: new Date(),
  };
}

// ============================================
// CloudWatch Integration
// ============================================

/**
 * Flush accumulated metrics to CloudWatch.
 */
async function flushMetrics(): Promise<void> {
  const dataPoints: MetricDataPoint[] = [];
  const now = new Date();

  // Cache metrics
  dataPoints.push({
    name: "CacheHitRate",
    value: getCacheHitRate(),
    unit: "Percent",
    dimensions: {},
    timestamp: now,
  });

  for (const tier of ["redis", "s3", "database", "github"] as CacheTier[]) {
    dataPoints.push({
      name: "CacheHits",
      value: metrics.cacheHits[tier],
      unit: "Count",
      dimensions: { Tier: tier },
      timestamp: now,
    });
  }

  if (metrics.cacheLookupLatency.length > 0) {
    const avgLatency =
      metrics.cacheLookupLatency.reduce((a, b) => a + b, 0) /
      metrics.cacheLookupLatency.length;
    dataPoints.push({
      name: "CacheLookupLatency",
      value: avgLatency,
      unit: "Milliseconds",
      dimensions: {},
      timestamp: now,
    });
  }

  // Source map metrics
  dataPoints.push({
    name: "SourceMapSuccessRate",
    value: getSourceMapSuccessRate(),
    unit: "Percent",
    dimensions: {},
    timestamp: now,
  });

  for (const [outcome, count] of Object.entries(metrics.sourceMapOutcomes)) {
    if (count > 0) {
      dataPoints.push({
        name: "SourceMapOutcome",
        value: count,
        unit: "Count",
        dimensions: { Outcome: outcome },
        timestamp: now,
      });
    }
  }

  // LLM metrics
  dataPoints.push({
    name: "LLMRequests",
    value: metrics.llmRequests,
    unit: "Count",
    dimensions: {},
    timestamp: now,
  });

  dataPoints.push({
    name: "LLMTokensUsed",
    value: metrics.llmTokensUsed,
    unit: "Count",
    dimensions: {},
    timestamp: now,
  });

  dataPoints.push({
    name: "LLMErrors",
    value: metrics.llmErrors,
    unit: "Count",
    dimensions: {},
    timestamp: now,
  });

  // GitHub API metrics
  dataPoints.push({
    name: "GitHubApiCalls",
    value: metrics.githubApiCalls,
    unit: "Count",
    dimensions: {},
    timestamp: now,
  });

  dataPoints.push({
    name: "GitHubRateLimitRemaining",
    value: metrics.githubRateLimitRemaining,
    unit: "Count",
    dimensions: {},
    timestamp: now,
  });

  // RCA Job metrics (NEW)
  for (const status of [
    "success",
    "failure",
    "timeout",
    "retry",
  ] as RCAJobStatus[]) {
    if (metrics.rcaJobs[status] > 0) {
      dataPoints.push({
        name: "RCAJobs",
        value: metrics.rcaJobs[status],
        unit: "Count",
        dimensions: { Status: status },
        timestamp: now,
      });
    }
  }

  const rcaStats = getRCAJobStats();
  dataPoints.push({
    name: "RCAJobSuccessRate",
    value: rcaStats.successRate,
    unit: "Percent",
    dimensions: {},
    timestamp: now,
  });

  if (rcaStats.avgLatencyMs > 0) {
    dataPoints.push({
      name: "RCAJobLatency",
      value: rcaStats.avgLatencyMs,
      unit: "Milliseconds",
      dimensions: {},
      timestamp: now,
    });
  }

  dataPoints.push({
    name: "RCAQueueDepth",
    value: metrics.rcaQueueDepth,
    unit: "Count",
    dimensions: {},
    timestamp: now,
  });

  // Database Pool metrics (NEW)
  const dbStats = getDatabasePoolStats();

  dataPoints.push({
    name: "DatabaseQueries",
    value: metrics.dbQueries,
    unit: "Count",
    dimensions: {},
    timestamp: now,
  });

  if (dbStats.avgQueryLatencyMs > 0) {
    dataPoints.push({
      name: "DatabaseQueryLatency",
      value: dbStats.avgQueryLatencyMs,
      unit: "Milliseconds",
      dimensions: {},
      timestamp: now,
    });
  }

  dataPoints.push({
    name: "DatabasePoolUtilization",
    value: dbStats.poolUtilization,
    unit: "Percent",
    dimensions: {},
    timestamp: now,
  });

  dataPoints.push({
    name: "DatabaseConnectionsActive",
    value: metrics.dbConnections.active,
    unit: "Count",
    dimensions: {},
    timestamp: now,
  });

  dataPoints.push({
    name: "DatabaseConnectionsWaiting",
    value: metrics.dbConnections.waiting,
    unit: "Count",
    dimensions: {},
    timestamp: now,
  });

  if (dbStats.avgConnectionWaitMs > 0) {
    dataPoints.push({
      name: "DatabaseConnectionWaitTime",
      value: dbStats.avgConnectionWaitMs,
      unit: "Milliseconds",
      dimensions: {},
      timestamp: now,
    });
  }

  dataPoints.push({
    name: "DatabaseTransactionSuccessRate",
    value: dbStats.transactions.successRate,
    unit: "Percent",
    dimensions: {},
    timestamp: now,
  });

  // Organization-level metrics (NEW)
  // Emit top 10 orgs by events
  for (const { orgId, events } of getOrgLevelStats().topEventOrgs) {
    dataPoints.push({
      name: "EventsPerOrganization",
      value: events,
      unit: "Count",
      dimensions: { OrgId: orgId },
      timestamp: now,
    });
  }

  // Emit top 10 orgs by LLM tokens
  for (const { orgId, tokens } of getOrgLevelStats().topLLMOrgs) {
    dataPoints.push({
      name: "LLMTokensPerOrganization",
      value: tokens,
      unit: "Count",
      dimensions: { OrgId: orgId },
      timestamp: now,
    });
  }

  // RCA jobs by org (top orgs)
  const orgRCAStats = getRCAJobStatsByOrg();
  const sortedOrgRCA = Array.from(orgRCAStats.entries())
    .sort((a, b) => b[1].success + b[1].failure - (a[1].success + a[1].failure))
    .slice(0, 10);

  for (const [orgId, stats] of sortedOrgRCA) {
    dataPoints.push({
      name: "RCAJobsPerOrganization",
      value: stats.success + stats.failure,
      unit: "Count",
      dimensions: { OrgId: orgId },
      timestamp: now,
    });
    dataPoints.push({
      name: "RCASuccessRatePerOrganization",
      value: stats.successRate,
      unit: "Percent",
      dimensions: { OrgId: orgId },
      timestamp: now,
    });
  }

  // Send to CloudWatch if available
  if (cloudWatchClient && dataPoints.length > 0) {
    await sendToCloudWatch(dataPoints);
  }

  // Log summary in development
  if (config.NODE_ENV === "development") {
    logger.debug(
      {
        cacheHitRate: getCacheHitRate().toFixed(1) + "%",
        sourceMapSuccessRate: getSourceMapSuccessRate().toFixed(1) + "%",
        llmRequests: metrics.llmRequests,
        githubCalls: metrics.githubApiCalls,
      },
      "Metrics flush"
    );
  }

  // Reset accumulators
  metrics = createEmptyMetrics();
}

/**
 * Send metrics to CloudWatch.
 */
async function sendToCloudWatch(dataPoints: MetricDataPoint[]): Promise<void> {
  if (!cloudWatchClient) {
    return;
  }

  // Convert to CloudWatch format
  const metricData: MetricDatum[] = dataPoints.map((dp) => ({
    MetricName: dp.name,
    Value: dp.value,
    Unit: dp.unit,
    Timestamp: dp.timestamp,
    Dimensions: Object.entries(dp.dimensions).map(([name, value]) => ({
      Name: name,
      Value: value,
    })),
  }));

  // Send in batches (CloudWatch limit is 20 per request)
  for (let i = 0; i < metricData.length; i += MAX_BATCH_SIZE) {
    const batch = metricData.slice(i, i + MAX_BATCH_SIZE);

    try {
      await cloudWatchClient.send(
        new PutMetricDataCommand({
          Namespace: NAMESPACE,
          MetricData: batch,
        })
      );
    } catch (error) {
      logger.error(
        { error, batchSize: batch.length },
        "Failed to send metrics to CloudWatch"
      );
    }
  }
}

// ============================================
// Health Check Endpoint Support
// ============================================

/**
 * Generate health check data for metrics service.
 */
export function getMetricsHealth(): {
  status: "healthy" | "degraded" | "unhealthy";
  details: {
    cloudWatchEnabled: boolean;
    cacheHitRate: number;
    sourceMapSuccessRate: number;
    rcaSuccessRate: number;
    dbPoolUtilization: number;
    warnings: string[];
  };
} {
  const cacheHitRate = getCacheHitRate();
  const sourceMapSuccessRate = getSourceMapSuccessRate();
  const rcaStats = getRCAJobStats();
  const dbStats = getDatabasePoolStats();
  const warnings: string[] = [];

  // Check for warning conditions
  if (cacheHitRate < 50 && metrics.cacheLookups > 10) {
    warnings.push(`Low cache hit rate: ${cacheHitRate.toFixed(1)}%`);
  }

  if (sourceMapSuccessRate < 70 && metrics.sourceMapLatency.length > 5) {
    warnings.push(
      `Low source map resolution rate: ${sourceMapSuccessRate.toFixed(1)}%`
    );
  }

  if (metrics.githubRateLimitRemaining < 100) {
    warnings.push(
      `GitHub rate limit low: ${metrics.githubRateLimitRemaining} remaining`
    );
  }

  const llmErrorRate =
    metrics.llmRequests > 0
      ? (metrics.llmErrors / metrics.llmRequests) * 100
      : 0;
  if (llmErrorRate > 10 && metrics.llmRequests > 5) {
    warnings.push(`High LLM error rate: ${llmErrorRate.toFixed(1)}%`);
  }

  // RCA job health checks
  if (rcaStats.successRate < 80 && rcaStats.total > 10) {
    warnings.push(
      `Low RCA job success rate: ${rcaStats.successRate.toFixed(1)}%`
    );
  }

  if (rcaStats.queueDepth > 100) {
    warnings.push(`High RCA queue depth: ${rcaStats.queueDepth}`);
  }

  if (rcaStats.avgLatencyMs > 30000 && rcaStats.total > 5) {
    warnings.push(
      `High RCA job latency: ${(rcaStats.avgLatencyMs / 1000).toFixed(1)}s`
    );
  }

  // Database pool health checks
  if (dbStats.poolUtilization > 90) {
    warnings.push(
      `High DB pool utilization: ${dbStats.poolUtilization.toFixed(1)}%`
    );
  }

  if (metrics.dbConnections.waiting > 5) {
    warnings.push(`DB connections waiting: ${metrics.dbConnections.waiting}`);
  }

  if (dbStats.avgConnectionWaitMs > 100) {
    warnings.push(
      `High DB connection wait time: ${dbStats.avgConnectionWaitMs.toFixed(0)}ms`
    );
  }

  if (
    dbStats.transactions.successRate < 95 &&
    metrics.dbTransactions.success + metrics.dbTransactions.failure > 10
  ) {
    warnings.push(
      `Low DB transaction success rate: ${dbStats.transactions.successRate.toFixed(1)}%`
    );
  }

  // Determine overall status
  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (warnings.length > 3) {
    status = "unhealthy";
  } else if (warnings.length > 0) {
    status = "degraded";
  }

  return {
    status,
    details: {
      cloudWatchEnabled: cloudWatchClient !== null,
      cacheHitRate,
      sourceMapSuccessRate,
      rcaSuccessRate: rcaStats.successRate,
      dbPoolUtilization: dbStats.poolUtilization,
      warnings,
    },
  };
}

// ============================================
// Exports for Testing
// ============================================

export function _resetMetricsForTesting(): void {
  metrics = createEmptyMetrics();
}

export function _getMetricsForTesting(): AggregatedMetrics {
  return { ...metrics };
}
