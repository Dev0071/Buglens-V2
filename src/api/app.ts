import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { webhooksRoutes } from "./routes/webhooks.js";
import { githubWebhooksRoutes } from "./routes/github-webhooks.js";
import { healthRoutes } from "./routes/health.js";
import { rcaRoutes } from "./routes/rca.js";
import {
  orgContextMiddleware,
  setupOrgDecorators,
} from "./middleware/org-context.js";
import { redis } from "../db/redis.js";

const server = Fastify({
  logger: logger,
  requestIdHeader: "x-request-id",
  disableRequestLogging: false,
});

// Remove the default JSON parser so we can use our custom one
server.removeContentTypeParser("application/json");

// Preserve raw body for HMAC verification (GitHub/Sentry)
// This MUST override the default parser to capture raw bytes
server.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (request, body, done) => {
    try {
      const buffer = body as Buffer;
      (request as FastifyRequest & { rawBody?: Buffer }).rawBody = buffer;
      if (buffer.length === 0) {
        done(null, {});
        return;
      }
      const json = JSON.parse(buffer.toString("utf-8"));
      done(null, json);
    } catch (error) {
      done(error as Error);
    }
  }
);

// Organization context helpers (multi-tenancy)
setupOrgDecorators(server);
server.addHook("preHandler", orgContextMiddleware);

// Register plugins
await server.register(cors, {
  // Explicit CORS origins for security - no wildcard in production
  origin:
    config.NODE_ENV === "test"
      ? true // Allow all origins in test for flexibility
      : config.CORS_ORIGINS && Array.isArray(config.CORS_ORIGINS)
        ? config.CORS_ORIGINS
        : config.NODE_ENV === "production"
          ? ["https://app.buglens.com", "https://buglens.com"]
          : ["http://localhost:3000", "http://localhost:5173"], // Fallback dev origins
  credentials: true,
});

await server.register(jwt, {
  secret: config.JWT_SECRET,
});

await server.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
  cache: 10000,
  allowList: [],
  redis: config.NODE_ENV === "test" ? undefined : redis.client,
  keyGenerator: (request) => request.getOrgId() || request.ip,
});

// Register routes
await server.register(healthRoutes, { prefix: "/api/v1" });
await server.register(webhooksRoutes, { prefix: "/api/v1" });
await server.register(githubWebhooksRoutes, { prefix: "/api/v1" });
await server.register(rcaRoutes, { prefix: "/api" });

// Error handler
server.setErrorHandler((error, request, reply) => {
  request.log.error(error);

  if (error.validation) {
    return reply.status(400).send({
      error: "Validation Error",
      message: error.message,
      details: error.validation,
    });
  }

  if (error.statusCode === 429) {
    return reply.status(429).send({
      error: "Rate Limit Exceeded",
      message: "Too many requests, please try again later",
    });
  }

  return reply.status(error.statusCode || 500).send({
    error: error.name || "Internal Server Error",
    message: error.message || "An unexpected error occurred",
  });
});

// Graceful shutdown
const signals = ["SIGINT", "SIGTERM"];
for (const signal of signals) {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, closing server...`);
    await server.close();
    process.exit(0);
  });
}

export { server };
