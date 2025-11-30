import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { webhooksRoutes } from "./routes/webhooks.js";
import { healthRoutes } from "./routes/health.js";

const server = Fastify({
  logger: logger,
  requestIdHeader: "x-request-id",
  disableRequestLogging: false,
});

// Register plugins
await server.register(cors, {
  origin: config.NODE_ENV === "development" ? "*" : false,
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
  redis: undefined, // Will add Redis later
});

// Register routes
await server.register(healthRoutes, { prefix: "/api/v1" });
await server.register(webhooksRoutes, { prefix: "/api/v1" });

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
