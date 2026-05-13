import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { captureException } from "../utils/sentry.js";
import { webhooksRoutes } from "./routes/webhooks.js";
import { githubWebhooksRoutes } from "./routes/github-webhooks.js";
import { healthRoutes } from "./routes/health.js";
import { rcaRoutes } from "./routes/rca.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { eventsRoutes } from "./routes/events.js";
import { integrationsRoutes } from "./routes/integrations.js";
// Note: oauth.ts routes removed - integrations.ts now handles all OAuth flows
// with platform-credentials support for one-click provider connections
import { settingsRoutes } from "./routes/settings.js";
import { costsRoutes } from "./routes/costs.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { authRoutes } from "./routes/auth.js";
import { teamRoutes } from "./routes/team.js";
import { profileRoutes } from "./routes/profile.js";
import { adminSecretRoutes } from "./routes/admin/secrets.js";
import { adminOrganizationRoutes } from "./routes/admin/organizations.js";
import { adminUserRoutes } from "./routes/admin/users.js";
import { adminSystemRoutes } from "./routes/admin/system.js";
import { adminAuditRoutes } from "./routes/admin/audit.js";
import { sentryTunnelRoutes } from "./routes/sentry-tunnel.js";
import { deploymentRoutes } from "./routes/deployments.js";
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

// Sentry envelope parser - handles application/x-sentry-envelope
server.addContentTypeParser(
  "application/x-sentry-envelope",
  { parseAs: "string" },
  (_request, body, done) => {
    done(null, body);
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
          : [
              "http://localhost:3000",
              "http://localhost:3001",
              "http://localhost:3002",
              "http://localhost:5173",
            ], // Fallback dev origins
  credentials: true,
});

await server.register(jwt, {
  secret: config.JWT_SECRET,
});

await server.register(cookie, {
  secret: config.JWT_SECRET, // Used for signing cookies
  parseOptions: {},
});

await server.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
  cache: 10000,
  allowList: [],
  redis: config.NODE_ENV === "test" ? undefined : redis.client,
  keyGenerator: (request) => request.getOrgId() || request.ip,
});

// ============================================
// Security Headers (SOC2 Compliance)
// ============================================
server.addHook("onSend", async (request, reply) => {
  // Prevent clickjacking
  reply.header("X-Frame-Options", "DENY");

  // Prevent MIME type sniffing
  reply.header("X-Content-Type-Options", "nosniff");

  // XSS Protection (legacy browsers)
  reply.header("X-XSS-Protection", "1; mode=block");

  // Referrer policy - don't leak URLs
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions policy - disable unnecessary features
  reply.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );

  // Content Security Policy
  // Note: CSP is primarily for browser-rendered content
  // API responses are JSON so this is mainly defensive
  if (config.NODE_ENV === "production") {
    reply.header(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; ")
    );
  }

  // Strict Transport Security (HTTPS only)
  if (config.NODE_ENV === "production") {
    reply.header(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }

  // Cache control for sensitive endpoints
  if (
    request.url.startsWith("/api/admin") ||
    request.url.startsWith("/api/auth")
  ) {
    reply.header(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");
  }
});

// Register routes
await server.register(healthRoutes, { prefix: "/api/v1" });
await server.register(webhooksRoutes, { prefix: "/api/v1" });
await server.register(githubWebhooksRoutes, { prefix: "/api/v1" });
await server.register(authRoutes, { prefix: "/api" });
await server.register(rcaRoutes, { prefix: "/api" });
await server.register(dashboardRoutes, { prefix: "/api" });
await server.register(eventsRoutes, { prefix: "/api" });
await server.register(integrationsRoutes, { prefix: "/api" });
await server.register(settingsRoutes, { prefix: "/api" });
await server.register(costsRoutes, { prefix: "/api" });
await server.register(analyticsRoutes, { prefix: "/api" });
await server.register(teamRoutes, { prefix: "/api" });
await server.register(profileRoutes, { prefix: "/api" });
await server.register(adminSecretRoutes, { prefix: "/api/admin/secrets" });
await server.register(adminOrganizationRoutes, {
  prefix: "/api/admin/organizations",
});
await server.register(adminUserRoutes, { prefix: "/api/admin/users" });
await server.register(adminSystemRoutes, { prefix: "/api/admin/system" });
await server.register(adminAuditRoutes, { prefix: "/api/admin/audit" });
await server.register(sentryTunnelRoutes, { prefix: "/api" });
await server.register(deploymentRoutes, { prefix: "/api" });

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

  // Capture 5xx errors in Sentry
  if (!error.statusCode || error.statusCode >= 500) {
    captureException(error, {
      request: {
        url: request.url,
        method: request.method,
        headers: request.headers,
      },
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
