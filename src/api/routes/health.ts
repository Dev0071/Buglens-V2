import { FastifyPluginAsync } from "fastify";
import { pool } from "../../db/client.js";
import { getRedisClient } from "../../db/redis.js";
import { config } from "../../utils/config.js";

interface HealthCheckResult {
  status: "healthy" | "unhealthy" | "degraded";
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: "connected" | "disconnected";
    redis: "connected" | "disconnected";
  };
}

interface ReadinessCheckResult {
  status: "ready" | "not_ready";
  timestamp: string;
  checks: {
    database: { status: "ok" | "error"; latencyMs?: number; error?: string };
    redis: { status: "ok" | "error"; latencyMs?: number; error?: string };
    queues: { status: "ok" | "error"; accessible?: boolean; error?: string };
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

    // Determine overall status
    const allConnected =
      result.checks.database === "connected" &&
      result.checks.redis === "connected";
    const noneConnected =
      result.checks.database === "disconnected" &&
      result.checks.redis === "disconnected";

    if (allConnected) {
      result.status = "healthy";
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

    // Determine overall readiness
    const allChecksPass =
      result.checks.database.status === "ok" &&
      result.checks.redis.status === "ok" &&
      result.checks.queues.status === "ok";

    if (allChecksPass) {
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
};
