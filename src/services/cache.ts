import {
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { createGzip, createGunzip } from "zlib";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { getFromCache, setInCache } from "../db/redis.js";
import { pool } from "../db/client.js";
import type { CacheKeyParams, CachedFileContent } from "../types/github.js";
import { sanitizePathForCacheKey } from "../types/github.js";
import { getSharedS3Client } from "../utils/s3-client.js";

// ============================================
// Cache Configuration
// ============================================

const REDIS_TTL_SECONDS = 3600; // 1 hour
const S3_RETRY_MAX_ATTEMPTS = 3;
const S3_RETRY_BASE_DELAY_MS = 100;
// S3 lifecycle policy configured via Terraform for 7-day retention

// ============================================
// S3 Client
// ============================================

let s3Disabled = false; // Flag to disable S3 if bucket doesn't exist
let s3DisabledReason: string | null = null;
let s3HealthChecked = false; // Track if health check has been performed

/**
 * Check if S3 cache should be used.
 * In development mode without S3_ENDPOINT (LocalStack), skip S3 operations.
 * Also skip if S3 has been disabled due to missing bucket.
 */
function shouldUseS3(): boolean {
  // S3 disabled due to previous error (e.g., bucket doesn't exist)
  if (s3Disabled) {
    return false;
  }
  // In dev mode, only use S3 if LocalStack endpoint is configured
  if (config.NODE_ENV === "development" && !config.S3_ENDPOINT) {
    return false;
  }
  // In production/staging, always use S3
  return true;
}

/**
 * Disable S3 cache for this session (e.g., bucket doesn't exist)
 */
function disableS3Cache(reason: string): void {
  if (!s3Disabled) {
    s3Disabled = true;
    s3DisabledReason = reason;
    logger.warn({ reason }, "S3 cache disabled for this session");
  }
}

/**
 * Re-enable S3 cache (for testing or after transient issues resolved)
 */
export function resetS3Cache(): void {
  s3Disabled = false;
  s3DisabledReason = null;
  s3HealthChecked = false;
  logger.info("S3 cache reset - will be re-enabled on next use");
}

/**
 * Get S3 cache status for health checks
 */
export function getS3CacheStatus(): {
  enabled: boolean;
  disabledReason: string | null;
  healthChecked: boolean;
} {
  return {
    enabled: shouldUseS3(),
    disabledReason: s3DisabledReason,
    healthChecked: s3HealthChecked,
  };
}

/**
 * Classify S3 errors into permanent (disable cache) vs transient (retry)
 */
interface S3ErrorClassification {
  isPermanent: boolean;
  isTransient: boolean;
  shouldDisable: boolean;
  errorType: string;
}

function classifyS3Error(error: unknown): S3ErrorClassification {
  const e = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const errorName = e.name || e.Code || "Unknown";
  const statusCode = e.$metadata?.httpStatusCode;

  // Permanent errors - disable S3 cache
  const permanentErrors = [
    "NoSuchBucket", // Bucket doesn't exist
    "InvalidBucketName", // Invalid bucket configuration
    "AccessDenied", // Permission error - likely misconfiguration
    "InvalidAccessKeyId", // Wrong credentials
    "SignatureDoesNotMatch", // Wrong secret key
    "AccountProblem", // Account-level issue
    "InvalidSecurity", // Security configuration issue
  ];

  // Transient errors - retry with backoff
  const transientErrors = [
    "RequestTimeout",
    "ServiceUnavailable",
    "SlowDown", // S3 rate limiting
    "InternalError",
    "OperationAborted",
  ];

  const isPermanent = permanentErrors.includes(errorName) || statusCode === 403;
  const isTransient =
    transientErrors.includes(errorName) ||
    statusCode === 500 ||
    statusCode === 503 ||
    statusCode === 429;

  return {
    isPermanent,
    isTransient,
    shouldDisable: isPermanent,
    errorType: errorName,
  };
}

// NOTE: isBucketMissingError was replaced by classifyS3Error for comprehensive error handling

/**
 * Retry an S3 operation with exponential backoff for transient errors
 */
async function withS3Retry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= S3_RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const classification = classifyS3Error(error);

      // Permanent errors - don't retry, optionally disable
      if (classification.isPermanent) {
        if (classification.shouldDisable) {
          disableS3Cache(
            `Permanent S3 error: ${classification.errorType} - ${String(error)}`
          );
        }
        throw error;
      }

      // Transient errors - retry with backoff
      if (classification.isTransient && attempt < S3_RETRY_MAX_ATTEMPTS) {
        const delay = S3_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          {
            operation: operationName,
            attempt,
            maxAttempts: S3_RETRY_MAX_ATTEMPTS,
            delayMs: delay,
            errorType: classification.errorType,
          },
          "S3 transient error, retrying"
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Non-classified errors or max retries reached
      throw error;
    }
  }

  throw lastError;
}

/**
 * Perform S3 health check on startup
 * Verifies bucket exists and is accessible
 */
export async function checkS3Health(): Promise<{
  healthy: boolean;
  error?: string;
  bucket?: string;
}> {
  if (!shouldUseS3()) {
    return {
      healthy: true,
      bucket: config.S3_BUCKET_NAME,
      error: config.S3_ENDPOINT
        ? undefined
        : "S3 disabled (no LocalStack endpoint in development)",
    };
  }

  const s3 = getS3Client();
  if (!s3) {
    return {
      healthy: true,
      bucket: config.S3_BUCKET_NAME,
      error: "S3 client not initialized (expected)",
    };
  }

  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET_NAME }));
    s3HealthChecked = true;
    logger.info(
      { bucket: config.S3_BUCKET_NAME, endpoint: config.S3_ENDPOINT || "AWS" },
      "S3 health check passed"
    );
    return { healthy: true, bucket: config.S3_BUCKET_NAME };
  } catch (error) {
    const classification = classifyS3Error(error);

    if (classification.shouldDisable) {
      disableS3Cache(
        `S3 health check failed: ${classification.errorType} for bucket '${config.S3_BUCKET_NAME}'`
      );
    }

    const errorMsg = `S3 health check failed: ${classification.errorType}`;
    logger.error(
      {
        bucket: config.S3_BUCKET_NAME,
        endpoint: config.S3_ENDPOINT || "AWS",
        errorType: classification.errorType,
        isPermanent: classification.isPermanent,
      },
      errorMsg
    );

    return { healthy: false, error: errorMsg, bucket: config.S3_BUCKET_NAME };
  }
}

function getS3Client() {
  if (!shouldUseS3()) return null;
  return getSharedS3Client();
}

// ============================================
// Cache Key Builders
// ============================================

function buildRedisCacheKey(params: CacheKeyParams): string {
  const safePath = sanitizePathForCacheKey(params.path);
  return `gh:file:${params.orgId}:${params.repo}:${params.sha}:${safePath}`;
}

function buildS3CacheKey(params: CacheKeyParams): string {
  const safePath = sanitizePathForCacheKey(params.path);
  return `cache/${params.orgId}/${params.repo}/${params.sha}/${safePath}`;
}

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
// Redis Cache Layer (Tier 1 - Hot)
// ============================================

/**
 * Get file content from Redis cache
 */
export async function getFromRedisCache(
  params: CacheKeyParams
): Promise<CachedFileContent | null> {
  const key = buildRedisCacheKey(params);
  const cached = await getFromCache<CachedFileContent>(key);

  if (cached) {
    logger.debug({ key }, "Redis cache hit");
    return { ...cached, cache_source: "redis" };
  }

  return null;
}

/**
 * Store file content in Redis cache
 */
export async function setInRedisCache(
  params: CacheKeyParams,
  content: CachedFileContent
): Promise<void> {
  const key = buildRedisCacheKey(params);
  await setInCache(key, content, REDIS_TTL_SECONDS);
  logger.debug({ key }, "Stored in Redis cache");
}

// ============================================
// S3 Cache Layer (Tier 2 - Warm)
// ============================================

/**
 * Get file content from S3 cache
 * Uses retry logic for transient errors
 */
export async function getFromS3Cache(
  params: CacheKeyParams
): Promise<CachedFileContent | null> {
  const s3 = getS3Client();

  // Skip S3 in dev mode without LocalStack
  if (!s3) {
    return null;
  }

  const key = buildS3CacheKey(params);

  try {
    const response = await withS3Retry(
      () =>
        s3.send(
          new GetObjectCommand({
            Bucket: config.S3_BUCKET_NAME,
            Key: key,
          })
        ),
      `getFromS3Cache:${key}`
    );

    if (!response.Body) {
      return null;
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Decompress
    const jsonStr = await decompressContent(buffer);
    const cached = JSON.parse(jsonStr) as CachedFileContent;

    logger.debug({ key }, "S3 cache hit");
    return { ...cached, cache_source: "s3" };
  } catch (error: unknown) {
    const classification = classifyS3Error(error);

    // Handle permanent errors
    if (classification.shouldDisable) {
      disableS3Cache(
        `${classification.errorType} for bucket '${config.S3_BUCKET_NAME}'`
      );
      return null;
    }

    // Handle "not found" (expected for cache miss)
    const e = error as {
      name?: string;
      $metadata?: { httpStatusCode: number };
    };
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      return null;
    }

    logger.error(
      { error, key, errorType: classification.errorType },
      "Failed to get from S3 cache"
    );
    return null;
  }
}

/**
 * Store file content in S3 cache
 * Uses retry logic for transient errors
 */
export async function setInS3Cache(
  params: CacheKeyParams,
  content: CachedFileContent
): Promise<void> {
  const s3 = getS3Client();

  // Skip S3 in dev mode without LocalStack
  if (!s3) {
    return;
  }

  const key = buildS3CacheKey(params);

  try {
    // Compress content
    const compressed = await compressContent(JSON.stringify(content));

    await withS3Retry(
      () =>
        s3.send(
          new PutObjectCommand({
            Bucket: config.S3_BUCKET_NAME,
            Key: key,
            Body: compressed,
            ContentType: "application/json",
            ContentEncoding: "gzip",
            Metadata: {
              org_id: params.orgId,
              repo: params.repo,
              sha: params.sha,
              cached_at: new Date().toISOString(),
            },
          })
        ),
      `setInS3Cache:${key}`
    );

    logger.debug({ key }, "Stored in S3 cache");
  } catch (error) {
    const classification = classifyS3Error(error);

    // Handle permanent errors
    if (classification.shouldDisable) {
      disableS3Cache(
        `${classification.errorType} for bucket '${config.S3_BUCKET_NAME}'`
      );
      return;
    }

    logger.error(
      { error, key, errorType: classification.errorType },
      "Failed to store in S3 cache"
    );
    // Don't throw - S3 cache is non-critical
  }
}

/**
 * Check if file exists in S3 cache
 */
export async function existsInS3Cache(
  params: CacheKeyParams
): Promise<boolean> {
  const s3 = getS3Client();

  // Skip S3 in dev mode without LocalStack
  if (!s3) {
    return false;
  }

  const key = buildS3CacheKey(params);

  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: config.S3_BUCKET_NAME,
        Key: key,
      })
    );
    return true;
  } catch (error: unknown) {
    const e = error as { name?: string };
    if (e.name === "NotFound") {
      return false;
    }
    return false;
  }
}

// ============================================
// Database Cache Layer (Tier 3 - Cold)
// ============================================

/**
 * Get file content from database (code_snapshots table)
 */
export async function getFromDatabaseCache(
  params: CacheKeyParams
): Promise<CachedFileContent | null> {
  try {
    const result = await pool.query<{
      content: string;
      file_path: string;
      commit_sha: string;
      language: string | null;
      size_bytes: number;
      created_at: Date;
    }>(
      `
      SELECT content, file_path, commit_sha, language, size_bytes, created_at
      FROM code_snapshots
      WHERE org_id = $1
        AND repo_id = (SELECT id FROM repos WHERE org_id = $1 AND full_name = $2 LIMIT 1)
        AND file_path = $3
        AND commit_sha = $4
      LIMIT 1
    `,
      [params.orgId, params.repo, params.path, params.sha]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    logger.debug(
      { org: params.orgId, repo: params.repo, path: params.path },
      "Database cache hit"
    );

    return {
      content: row.content,
      path: row.file_path,
      sha: row.commit_sha,
      repo: params.repo,
      size: row.size_bytes,
      language: row.language,
      cached_at: row.created_at.getTime(),
      cache_source: "database",
    };
  } catch (error) {
    logger.error({ error, params }, "Failed to get from database cache");
    return null;
  }
}

/**
 * Store file content in database (permanent storage for analyzed files)
 */
export async function setInDatabaseCache(
  params: CacheKeyParams,
  content: CachedFileContent
): Promise<void> {
  try {
    // First, get or create repo reference
    const repoResult = await pool.query<{ id: string }>(
      `SELECT id FROM repos WHERE org_id = $1 AND full_name = $2 LIMIT 1`,
      [params.orgId, params.repo]
    );

    if (repoResult.rows.length === 0) {
      logger.warn(
        { orgId: params.orgId, repo: params.repo },
        "Repo not found, skipping database cache"
      );
      return;
    }

    const repoId = repoResult.rows[0].id;

    await pool.query(
      `
      INSERT INTO code_snapshots (org_id, repo_id, file_path, commit_sha, content, language, size_bytes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (org_id, repo_id, file_path, commit_sha) DO UPDATE SET
        content = EXCLUDED.content,
        language = EXCLUDED.language,
        size_bytes = EXCLUDED.size_bytes
    `,
      [
        params.orgId,
        repoId,
        params.path,
        params.sha,
        content.content,
        content.language,
        content.size,
      ]
    );

    logger.debug(
      { org: params.orgId, repo: params.repo, path: params.path },
      "Stored in database cache"
    );
  } catch (error) {
    logger.error({ error, params }, "Failed to store in database cache");
    // Don't throw - database cache is non-critical for immediate operation
  }
}

// ============================================
// Three-Tier Cache Fetch (Main Entry Point)
// ============================================

export interface CacheFetchResult {
  content: CachedFileContent;
  source: "redis" | "s3" | "database" | "github";
  hit: boolean;
}

/**
 * Fetch file content through the 3-tier cache
 * Checks Redis → S3 → Database in order
 * If found in lower tier, promotes to higher tiers
 */
export async function fetchFromCache(
  params: CacheKeyParams
): Promise<CachedFileContent | null> {
  // Tier 1: Redis (hot cache)
  const redisResult = await getFromRedisCache(params);
  if (redisResult) {
    return redisResult;
  }

  // Tier 2: S3 (warm cache)
  const s3Result = await getFromS3Cache(params);
  if (s3Result) {
    // Promote to Redis
    await setInRedisCache(params, s3Result);
    return s3Result;
  }

  // Tier 3: Database (cold cache)
  const dbResult = await getFromDatabaseCache(params);
  if (dbResult) {
    // Promote to S3 and Redis
    await Promise.all([
      setInS3Cache(params, dbResult),
      setInRedisCache(params, dbResult),
    ]);
    return dbResult;
  }

  // Cache miss - content needs to be fetched from GitHub
  return null;
}

/**
 * Store file content in all cache tiers
 */
export async function storeInCache(
  params: CacheKeyParams,
  content: CachedFileContent
): Promise<void> {
  // Store in all tiers in parallel
  await Promise.all([
    setInRedisCache(params, content),
    setInS3Cache(params, content),
    // Only store in DB if this is a file that was analyzed
    // (controlled by caller via shouldPersist flag)
  ]);
}

/**
 * Store in all cache tiers including database (for analyzed files)
 */
export async function storeInAllCacheTiers(
  params: CacheKeyParams,
  content: CachedFileContent
): Promise<void> {
  await Promise.all([
    setInRedisCache(params, content),
    setInS3Cache(params, content),
    setInDatabaseCache(params, content),
  ]);
}

// ============================================
// Cache Statistics
// ============================================

export interface CacheStats {
  redis_hits: number;
  s3_hits: number;
  database_hits: number;
  github_fetches: number;
  total_requests: number;
  hit_rate: number;
}

// In-memory stats tracking (would be replaced with proper metrics in production)
const stats = {
  redis_hits: 0,
  s3_hits: 0,
  database_hits: 0,
  github_fetches: 0,
};

export function recordCacheHit(
  source: "redis" | "s3" | "database" | "github"
): void {
  switch (source) {
    case "redis":
      stats.redis_hits++;
      break;
    case "s3":
      stats.s3_hits++;
      break;
    case "database":
      stats.database_hits++;
      break;
    case "github":
      stats.github_fetches++;
      break;
  }
}

export function getCacheStats(): CacheStats {
  const total =
    stats.redis_hits +
    stats.s3_hits +
    stats.database_hits +
    stats.github_fetches;
  const hits = stats.redis_hits + stats.s3_hits + stats.database_hits;

  return {
    ...stats,
    total_requests: total,
    hit_rate: total > 0 ? hits / total : 0,
  };
}

export function resetCacheStats(): void {
  stats.redis_hits = 0;
  stats.s3_hits = 0;
  stats.database_hits = 0;
  stats.github_fetches = 0;
}
