import { FastifyPluginAsync } from "fastify";
import crypto from "crypto";
import { config } from "../../utils/config.js";
import { sentryWebhookSchema } from "../../types/sentry.js";
import { pool } from "../../db/client.js";

export const webhooksRoutes: FastifyPluginAsync = async (server) => {
  server.post("/webhooks/sentry", async (request, reply) => {
    const signature = request.headers["sentry-hook-signature"] as
      | string
      | undefined;

    // HMAC validation (if secret configured)
    if (config.SENTRY_WEBHOOK_SECRET) {
      if (!signature) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Missing signature",
        });
      }

      const hmac = crypto.createHmac("sha256", config.SENTRY_WEBHOOK_SECRET);
      hmac.update(JSON.stringify(request.body));
      const expectedSignature = hmac.digest("hex");

      if (signature !== expectedSignature) {
        request.log.warn({ signature, expectedSignature }, "Invalid signature");
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Invalid signature",
        });
      }
    }

    // Validate payload
    const parseResult = sentryWebhookSchema.safeParse(request.body);
    if (!parseResult.success) {
      request.log.warn({ error: parseResult.error }, "Invalid payload");
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid Sentry webhook payload",
        details: parseResult.error.format(),
      });
    }

    const payload = parseResult.data;

    try {
      // Extract error signature (for deduplication)
      const signature = payload.fingerprint
        ? payload.fingerprint.join(":")
        : `${payload.exception?.values?.[0]?.type || "unknown"}:${
            payload.exception?.values?.[0]?.value || "unknown"
          }`;

      // Store event (hardcoded org_id for now - will get from integration config later)
      const result = await pool.query(
        `
        INSERT INTO events (
          org_id,
          source,
          sentry_event_id,
          signature,
          message,
          stack_trace,
          breadcrumbs,
          context,
          environment,
          release,
          timestamp,
          status,
          raw_payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id
      `,
        [
          "00000000-0000-0000-0000-000000000000", // TODO: Get from integration
          "sentry",
          payload.event_id,
          signature,
          payload.message ||
            payload.exception?.values?.[0]?.value ||
            "Unknown error",
          JSON.stringify(payload.exception?.values?.[0]?.stacktrace),
          JSON.stringify(payload.breadcrumbs),
          JSON.stringify({
            user: payload.user,
            request: payload.request,
            contexts: payload.contexts,
            tags: payload.tags,
          }),
          payload.environment,
          payload.release,
          new Date(
            typeof payload.timestamp === "number"
              ? payload.timestamp * 1000
              : payload.timestamp
          ),
          "received",
          JSON.stringify(payload),
        ]
      );

      request.log.info(
        {
          event_id: result.rows[0].id,
          sentry_event_id: payload.event_id,
        },
        "Event received"
      );

      return reply.status(200).send({
        status: "received",
        event_id: result.rows[0].id,
      });
    } catch (error) {
      request.log.error({ error }, "Failed to store event");
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Failed to process webhook",
      });
    }
  });
};
