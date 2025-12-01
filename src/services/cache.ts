import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { createGzip, createGunzip } from "zlib";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { getFromCache, setInCache } from "../db/redis.js";
import { pool } from "../db/client.js";
import type { CacheKeyParams, CachedFileContent } from "../types/github.js";

// ============================================
// Cache Configuration
// ============================================

const REDIS_TTL_SECONDS = 3600; // 1 hour
// S3 lifecycle policy configured via Terraform for 7-day retention

// ============================================
// S3 Client
// ============================================

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  s3Client = new S3Client({
    region: config.AWS_REGION,
    // LocalStack endpoint for local development
    ...(config.S3_ENDPOINT
      ? {
          endpoint: config.S3_ENDPOINT,
          forcePathStyle: true, // Required for LocalStack
        }
      : {}),
    ...(config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: config.AWS_ACCESS_KEY_ID,
            secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}), // Use IAM role if no explicit credentials
  });

  return s3Client;
}

// ============================================
// Cache Key Builders
// ============================================

function buildRedisCacheKey(params: CacheKeyParams): string {
  return `gh:file:${params.orgId}:${params.repo}:${params.sha}:${params.path}`;
}

function buildS3CacheKey(params: CacheKeyParams): string {
  // Sanitize path to be S3-safe
  const safePath = params.path.replace(/^\/+/, "");
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
 */
export async function getFromS3Cache(
  params: CacheKeyParams
): Promise<CachedFileContent | null> {
  const key = buildS3CacheKey(params);

  try {
    const s3 = getS3Client();
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: config.S3_BUCKET_NAME,
        Key: key,
      })
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
    const e = error as {
      name?: string;
      $metadata?: { httpStatusCode: number };
    };
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      return null;
    }
    logger.error({ error, key }, "Failed to get from S3 cache");
    return null;
  }
}

/**
 * Store file content in S3 cache
 */
export async function setInS3Cache(
  params: CacheKeyParams,
  content: CachedFileContent
): Promise<void> {
  const key = buildS3CacheKey(params);

  try {
    const s3 = getS3Client();

    // Compress content
    const compressed = await compressContent(JSON.stringify(content));

    await s3.send(
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
    );

    logger.debug({ key }, "Stored in S3 cache");
  } catch (error) {
    logger.error({ error, key }, "Failed to store in S3 cache");
    // Don't throw - S3 cache is non-critical
  }
}

/**
 * Check if file exists in S3 cache
 */
export async function existsInS3Cache(
  params: CacheKeyParams
): Promise<boolean> {
  const key = buildS3CacheKey(params);

  try {
    const s3 = getS3Client();
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
