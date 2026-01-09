import { Redis } from "ioredis";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

// ============================================
// Redis Client Singleton
// ============================================

let redisClient: Redis | null = null;

/**
 * Get or create Redis client singleton
 */
export function getRedisClient(): Redis {
  if (redisClient) {
    return redisClient;
  }
  const redisUrl = config.REDIS_URL;
  const isTls = redisUrl.startsWith("rediss://");
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: config.REDIS_MAX_RETRIES,
    enableReadyCheck: true,
    ...(isTls
      ? {
          tls: {
            rejectUnauthorized: false,
          },
        }
      : {}),
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      logger.warn({ attempt: times, delay }, "Redis connection retry");
      return delay;
    },
    reconnectOnError(err: Error) {
      const targetError = "READONLY";
      if (err.message.includes(targetError)) {
        // Only reconnect when the error contains "READONLY"
        return true;
      }
      return false;
    },
  });

  client.on("connect", () => {
    logger.info("Redis client connected");
  });

  client.on("ready", () => {
    logger.info("Redis client ready");
  });

  client.on("error", (err: Error) => {
    logger.error({ err }, "Redis client error");
  });

  client.on("close", () => {
    logger.warn("Redis connection closed");
  });

  client.on("reconnecting", () => {
    logger.info("Redis client reconnecting");
  });

  redisClient = client;
  return client;
}

/**
 * Get Redis client (alias for getRedisClient)
 */
export const redis = {
  get client(): Redis {
    return getRedisClient();
  },
};

// ============================================
// Cache Helper Functions
// ============================================

/**
 * Get a cached value from Redis
 */
export async function getFromCache<T>(key: string): Promise<T | null> {
  try {
    const client = getRedisClient();
    const value = await client.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch (error) {
    logger.error({ error, key }, "Failed to get from Redis cache");
    return null;
  }
}

/**
 * Set a value in Redis cache with TTL
 */
export async function setInCache<T>(
  key: string,
  value: T,
  ttlSeconds: number = 3600
): Promise<boolean> {
  try {
    const client = getRedisClient();
    await client.setex(key, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (error) {
    logger.error({ error, key }, "Failed to set in Redis cache");
    return false;
  }
}

/**
 * Delete a key from cache
 */
export async function deleteFromCache(key: string): Promise<boolean> {
  try {
    const client = getRedisClient();
    await client.del(key);
    return true;
  } catch (error) {
    logger.error({ error, key }, "Failed to delete from Redis cache");
    return false;
  }
}

/**
 * Check if a key exists in cache
 */
export async function existsInCache(key: string): Promise<boolean> {
  try {
    const client = getRedisClient();
    const exists = await client.exists(key);
    return exists === 1;
  } catch (error) {
    logger.error({ error, key }, "Failed to check key existence in Redis");
    return false;
  }
}

// ============================================
// Rate Limit Tracking
// ============================================

/**
 * Increment a rate limit counter
 * Returns the new count
 */
export async function incrementRateLimit(
  key: string,
  windowSeconds: number = 3600
): Promise<number> {
  try {
    const client = getRedisClient();
    const multi = client.multi();
    multi.incr(key);
    multi.expire(key, windowSeconds);
    const results = await multi.exec();

    if (!results || results.length === 0) {
      return 0;
    }

    const [incrResult] = results;
    if (incrResult && incrResult[1] !== null) {
      return incrResult[1] as number;
    }
    return 0;
  } catch (error) {
    logger.error({ error, key }, "Failed to increment rate limit");
    return 0;
  }
}

/**
 * Get current rate limit count
 */
export async function getRateLimitCount(key: string): Promise<number> {
  try {
    const client = getRedisClient();
    const count = await client.get(key);
    return count ? parseInt(count, 10) : 0;
  } catch (error) {
    logger.error({ error, key }, "Failed to get rate limit count");
    return 0;
  }
}

/**
 * Build rate limit key for GitHub API calls
 * Uses a sliding window approach: key includes the start of the current hour window
 * The TTL is set when incrementing, so keys auto-expire after the window
 *
 * Note: This is a simple hourly bucket. For more accurate sliding windows,
 * consider using Redis sorted sets with timestamps. This approach is sufficient
 * for MVP and has the advantage of being simple and having automatic cleanup.
 */
export function buildGitHubRateLimitKey(orgId: string): string {
  // Use current hour as bucket (YYYY-MM-DDTHH format)
  // This creates a new bucket each hour, with 1-hour TTL from incrementRateLimit
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  return `gh:rate:${orgId}:${hour}`;
}

// ============================================
// Installation Token Caching
// ============================================

const TOKEN_CACHE_PREFIX = "gh:token:";
const TOKEN_BUFFER_SECONDS = 300; // Refresh 5 min before expiry

/**
 * Cache GitHub installation token
 */
export async function cacheInstallationToken(
  installationId: string,
  token: string,
  expiresAt: Date
): Promise<void> {
  const key = `${TOKEN_CACHE_PREFIX}${installationId}`;
  const ttl = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000) - TOKEN_BUFFER_SECONDS
  );

  if (ttl > 0) {
    await setInCache(key, { token, expiresAt: expiresAt.toISOString() }, ttl);
    logger.debug({ installationId, ttl }, "Cached GitHub installation token");
  }
}

/**
 * Get cached GitHub installation token
 */
export async function getCachedInstallationToken(
  installationId: string
): Promise<string | null> {
  const key = `${TOKEN_CACHE_PREFIX}${installationId}`;
  const cached = await getFromCache<{ token: string; expiresAt: string }>(key);

  if (!cached) return null;

  // Double-check expiry
  const expiresAt = new Date(cached.expiresAt);
  if (expiresAt.getTime() - Date.now() < TOKEN_BUFFER_SECONDS * 1000) {
    // Token is about to expire, return null to force refresh
    await deleteFromCache(key);
    return null;
  }

  return cached.token;
}

// ============================================
// Cleanup
// ============================================

/**
 * Close Redis connection gracefully
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info("Redis connection closed");
  }
}

/**
 * Check Redis health
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const result = await client.ping();
    return result === "PONG";
  } catch (error) {
    logger.error({ error }, "Redis health check failed");
    return false;
  }
}
