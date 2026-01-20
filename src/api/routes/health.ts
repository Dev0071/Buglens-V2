import { FastifyPluginAsync } from "fastify";
import { pool } from "../../db/client.js";
import { getRedisClient } from "../../db/redis.js";
import { config } from "../../utils/config.js";
import { checkS3Health, getS3CacheStatus } from "../../services/cache.js";
import { captureException } from "../../utils/sentry.js";

interface HealthCheckResult {
  status: "healthy" | "unhealthy" | "degraded";
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: "connected" | "disconnected";
    redis: "connected" | "disconnected";
    s3: "connected" | "disconnected" | "disabled";
  };
}

interface ReadinessCheckResult {
  status: "ready" | "not_ready";
  timestamp: string;
  checks: {
    database: { status: "ok" | "error"; latencyMs?: number; error?: string };
    redis: { status: "ok" | "error"; latencyMs?: number; error?: string };
    queues: { status: "ok" | "error"; accessible?: boolean; error?: string };
    s3: {
      status: "ok" | "error" | "disabled";
      latencyMs?: number;
      error?: string;
      bucket?: string;
    };
  };
}

export const healthRoutes: FastifyPluginAsync = async (server) => {
  /**
   * Liveness probe - basic health check
   * Returns 200 if the service is running, regardless of dependencies
   */
  server.get("/health", async (_request, reply) => {
    const result: HealthCheckResult = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || "0.1.0",
      checks: {
        database: "disconnected",
        redis: "disconnected",
        s3: "disconnected",
      },
    };

    try {
      // Check database (non-blocking for liveness)
      await pool.query("SELECT 1");
      result.checks.database = "connected";
    } catch {
      result.checks.database = "disconnected";
    }

    try {
      // Check Redis (non-blocking for liveness)
      const redis = getRedisClient();
      await redis.ping();
      result.checks.redis = "connected";
    } catch {
      result.checks.redis = "disconnected";
    }

    // Check S3 status (non-blocking for liveness)
    const s3Status = getS3CacheStatus();
    if (!s3Status.enabled) {
      result.checks.s3 = "disabled";
    } else if (s3Status.healthChecked) {
      result.checks.s3 = "connected";
    } else {
      // Not yet health checked - try now
      const s3Health = await checkS3Health();
      result.checks.s3 = s3Health.healthy ? "connected" : "disconnected";
    }

    // Determine overall status
    // S3 is optional - degraded if unavailable but not unhealthy
    const coreConnected =
      result.checks.database === "connected" &&
      result.checks.redis === "connected";
    const noneConnected =
      result.checks.database === "disconnected" &&
      result.checks.redis === "disconnected";

    if (coreConnected && result.checks.s3 === "connected") {
      result.status = "healthy";
    } else if (coreConnected) {
      result.status = "degraded"; // S3 issues but core services OK
    } else if (noneConnected) {
      result.status = "unhealthy";
    } else {
      result.status = "degraded";
    }

    return reply.send(result);
  });

  /**
   * Readiness probe - comprehensive dependency check
   * Returns 200 only when all critical dependencies are accessible
   * Used by Kubernetes to determine if the pod should receive traffic
   */
  server.get("/ready", async (_request, reply) => {
    const result: ReadinessCheckResult = {
      status: "not_ready",
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: "error" },
        redis: { status: "error" },
        queues: { status: "error" },
        s3: { status: "disabled" },
      },
    };

    // Check database with latency
    try {
      const dbStart = Date.now();
      await pool.query("SELECT 1");
      result.checks.database = {
        status: "ok",
        latencyMs: Date.now() - dbStart,
      };
    } catch (error) {
      result.checks.database = {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // Check Redis with latency
    try {
      const redisStart = Date.now();
      const redis = getRedisClient();
      await redis.ping();
      result.checks.redis = {
        status: "ok",
        latencyMs: Date.now() - redisStart,
      };
    } catch (error) {
      result.checks.redis = {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // Check BullMQ queues are accessible (via Redis)
    try {
      const redis = getRedisClient();
      // Check if queue keys exist (indicates queues are set up)
      await redis.keys("bull:*:id");
      result.checks.queues = {
        status: "ok",
        accessible: true,
      };
    } catch (error) {
      result.checks.queues = {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // Check S3 cache (optional but included in readiness)
    const s3Status = getS3CacheStatus();
    if (!s3Status.enabled) {
      result.checks.s3 = {
        status: "disabled",
      };
    } else {
      try {
        const s3Start = Date.now();
        const s3Health = await checkS3Health();
        if (s3Health.healthy) {
          result.checks.s3 = {
            status: "ok",
            latencyMs: Date.now() - s3Start,
            bucket: s3Health.bucket,
          };
        } else {
          result.checks.s3 = {
            status: "error",
            latencyMs: Date.now() - s3Start,
            error: s3Health.error,
            bucket: s3Health.bucket,
          };
        }
      } catch (error) {
        result.checks.s3 = {
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    // Determine overall readiness
    // Core services must be OK; S3 is optional (can be disabled or degraded)
    const coreChecksPass =
      result.checks.database.status === "ok" &&
      result.checks.redis.status === "ok" &&
      result.checks.queues.status === "ok";

    // S3 is considered OK if disabled or actually working
    const s3CheckPass =
      result.checks.s3.status === "disabled" ||
      result.checks.s3.status === "ok";

    if (coreChecksPass && s3CheckPass) {
      result.status = "ready";
      return reply.send(result);
    }

    return reply.status(503).send(result);
  });

  /**
   * Startup probe - check if the service has finished initialization
   * More lenient than readiness - allows for initial connection establishment
   */
  server.get("/startup", async (_request, reply) => {
    try {
      // Basic check - can we connect to the database?
      await pool.query("SELECT 1");

      return reply.send({
        status: "started",
        timestamp: new Date().toISOString(),
        environment: config.NODE_ENV,
      });
    } catch (error) {
      return reply.status(503).send({
        status: "starting",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * Test Sentry error reporting (development only)
   * GET /debug-sentry
   */
  if (config.NODE_ENV === "development") {
    server.get("/debug-sentry", async (_request, _reply) => {
      const testError = new Error(
        "Test error from backend - debug-sentry endpoint"
      );
      captureException(testError, { test: true, endpoint: "/debug-sentry" });
      throw testError; // This will be caught by Fastify's error handler
    });
  }
};
