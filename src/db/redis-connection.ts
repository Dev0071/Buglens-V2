/**
 * Shared Redis connection builder.
 *
 * Resolves connection options from either explicit env vars (REDIS_HOST /
 * REDIS_PORT / REDIS_PASSWORD / REDIS_TLS) or by parsing REDIS_URL as a
 * fallback. Explicit vars take precedence so deployments that receive a
 * password-less or malformed DATABASE_URL from managed-DB bindings can still
 * authenticate correctly.
 *
 * Used by both the ioredis singleton (src/db/redis.ts) and every BullMQ
 * Queue/Worker in src/workers/queues/* to guarantee a single, consistent
 * resolution path.
 */

import { config } from "../utils/config.js";

export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: { rejectUnauthorized: boolean };
  maxRetriesPerRequest: null;
}

export function resolveRedisConnection(): RedisConnectionOptions {
  // Prefer individual env vars — avoids URL-parsing pitfalls with managed DBs.
  if (config.REDIS_HOST) {
    return {
      host: config.REDIS_HOST,
      port: config.REDIS_PORT ?? 6379,
      password: config.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      ...(config.REDIS_TLS ? { tls: { rejectUnauthorized: false } } : {}),
    };
  }

  // Fall back to URL parsing.
  const redisUrl = config.REDIS_URL;
  const isTls =
    redisUrl.startsWith("rediss://") || config.REDIS_TLS;

  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch {
    // If the URL is unparseable, return safe defaults and let ioredis fail
    // with a clear connection error rather than a cryptic crash.
    return {
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
    };
  }

  // ioredis treats an empty hostname as localhost — guard against it so the
  // ECONNREFUSED lands at the right address.
  const host = parsed.hostname || "localhost";

  // If REDIS_PASSWORD is set as a separate var, prefer it over the URL's
  // embedded password (handles the case where DATABASE_URL omits the password).
  const password =
    config.REDIS_PASSWORD ||
    (parsed.password ? decodeURIComponent(parsed.password) : undefined);

  return {
    host,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password,
    db: parsed.pathname ? Number(parsed.pathname.replace("/", "")) || 0 : 0,
    maxRetriesPerRequest: null,
    ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
  };
}

/**
 * Build a full Redis URL from resolved connection options.
 * Used by the ioredis client which accepts a URL string.
 */
export function resolveRedisUrl(): string {
  if (config.REDIS_HOST) {
    const scheme = config.REDIS_TLS ? "rediss" : "redis";
    const auth = config.REDIS_PASSWORD
      ? `:${encodeURIComponent(config.REDIS_PASSWORD)}@`
      : "";
    const port = config.REDIS_PORT ?? 6379;
    return `${scheme}://${auth}${config.REDIS_HOST}:${port}`;
  }

  // If a separate password was provided and the URL is missing it, inject it.
  if (config.REDIS_PASSWORD) {
    try {
      const parsed = new URL(config.REDIS_URL);
      if (!parsed.password) {
        parsed.password = encodeURIComponent(config.REDIS_PASSWORD);
        return parsed.toString();
      }
    } catch {
      // fall through to raw URL
    }
  }

  return config.REDIS_URL;
}
