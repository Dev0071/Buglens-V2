import { FastifyPluginAsync } from "fastify";
import crypto from "crypto";
import { config } from "../../utils/config.js";
import { sentryWebhookSchema } from "../../types/sentry.js";
import { pool } from "../../db/client.js";

export const webhooksRoutes: FastifyPluginAsync = async (server) => {
  // Webhook endpoint with org_id in path for multi-tenancy
  server.post("/webhooks/sentry/:org_id", async (request, reply) => {
    const { org_id } = request.params as { org_id: string };

    // Validate org_id is a valid UUID
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(org_id)) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid organization ID",
      });
    }

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

      // Store event (org_id from URL path)
      const result = await pool.query(
        `
        INSERT INTO events (
          org_id,
          source,
          sentry_event_id,
          signature,
          platform,
          message,
          stack_trace,
          breadcrumbs,
          context,
          environment,
          release,
          timestamp,
          status,
          raw_payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id
      `,
        [
          org_id, // From URL path parameter
          "sentry",
          payload.event_id,
          signature,
          payload.platform,
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
