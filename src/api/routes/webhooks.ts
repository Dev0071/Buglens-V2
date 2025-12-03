import { FastifyPluginAsync, FastifyRequest } from "fastify";
import crypto from "crypto";
import { config } from "../../utils/config.js";
import { sentryWebhookSchema } from "../../types/sentry.js";
import { transaction } from "../../db/client.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.js";

type WebhookRequestWithRaw = FastifyRequest & { rawBody?: Buffer };

const resolvePayloadBuffer = (request: WebhookRequestWithRaw): Buffer => {
  if (request.rawBody && Buffer.isBuffer(request.rawBody)) {
    return request.rawBody;
  }

  const body = request.body ?? {};
  const textPayload = typeof body === "string" ? body : JSON.stringify(body);
  return Buffer.from(textPayload ?? "", "utf8");
};

export const webhooksRoutes: FastifyPluginAsync = async (server) => {
  // Webhook endpoint with org_id in path for multi-tenancy
  server.post(
    "/webhooks/sentry/:org_id",
    {
      preHandler: [
        createRateLimitMiddleware({
          resource: "events",
          period: "hour",
        }),
      ],
    },
    async (request, reply) => {
      const { org_id } = request.params as { org_id: string };
      const requestWithRawBody = request as WebhookRequestWithRaw;

      // Validate org_id is a valid UUID
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(org_id)) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Invalid organization ID",
        });
      }

      const sentrySignatureHeader = request.headers["sentry-hook-signature"] as
        | string
        | undefined;

      if (config.SENTRY_WEBHOOK_SECRET) {
        if (!sentrySignatureHeader) {
          return reply.status(401).send({
            error: "Unauthorized",
            message: "Missing signature",
          });
        }

        const payloadBuffer = resolvePayloadBuffer(requestWithRawBody);
        const hmac = crypto.createHmac("sha256", config.SENTRY_WEBHOOK_SECRET);
        hmac.update(payloadBuffer);
        const expectedBuffer = hmac.digest();
        const expectedSignature = expectedBuffer.toString("hex");

        const normalizedSignature = sentrySignatureHeader
          .replace(/^sha256=/i, "")
          .trim();
        const hexRegex = /^[0-9a-f]+$/i;

        if (!hexRegex.test(normalizedSignature)) {
          request.log.warn(
            { header: sentrySignatureHeader },
            "Malformed signature header"
          );
          return reply.status(401).send({
            error: "Unauthorized",
            message: "Invalid signature format",
          });
        }

        const signatureBuffer = Buffer.from(normalizedSignature, "hex");
        const signatureLengthMatches =
          signatureBuffer.length === expectedBuffer.length;
        const signatureValid =
          signatureLengthMatches &&
          crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

        if (!signatureValid) {
          request.log.warn(
            { header: sentrySignatureHeader, expected: expectedSignature },
            "Invalid signature"
          );
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
      const sentryEventId = payload.event_id;

      try {
        const orgContext = request.orgContext;
        if (!orgContext || orgContext.orgId !== org_id) {
          request.log.warn({ org_id }, "Webhook received without org context");
          return reply.status(404).send({
            error: "Not Found",
            message: "Organization does not exist",
          });
        }

        // Extract error signature (for deduplication)
        // Sanitize fingerprint values - limit length and remove any problematic characters
        const sanitizeFingerprint = (fp: string[]): string => {
          return fp
            .map((part) =>
              // Limit each part to 200 chars, replace control chars (ASCII 0-31 and 127)
              // eslint-disable-next-line no-control-regex
              part.slice(0, 200).replace(/[\x00-\x1f\x7f]/g, "")
            )
            .join(":")
            .slice(0, 1000); // Limit total signature length
        };

        const eventSignature = payload.fingerprint
          ? sanitizeFingerprint(payload.fingerprint)
          : `${payload.exception?.values?.[0]?.type || "unknown"}:${
              payload.exception?.values?.[0]?.value?.slice(0, 500) || "unknown"
            }`.slice(0, 1000);

        const txnResult = await transaction(org_id, async (client) => {
          const duplicateEvent = await client.query(
            "SELECT id FROM events WHERE org_id = $1 AND sentry_event_id = $2 LIMIT 1",
            [org_id, sentryEventId]
          );

          if (duplicateEvent.rows.length > 0) {
            const existingEventId = duplicateEvent.rows[0].id;
            request.log.info(
              {
                org_id,
                sentry_event_id: sentryEventId,
                event_id: existingEventId,
              },
              "Duplicate webhook ignored"
            );

            return {
              status: "duplicate" as const,
              eventId: existingEventId,
            };
          }

          const insertResult = await client.query(
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
              org_id,
              "sentry",
              sentryEventId,
              eventSignature,
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

          const eventId = insertResult.rows[0].id as string;
          request.log.info(
            {
              org_id,
              event_id: eventId,
              sentry_event_id: sentryEventId,
            },
            "Event received"
          );

          return {
            status: "received" as const,
            eventId,
          };
        });

        if (txnResult.status === "duplicate") {
          return reply.status(200).send({
            status: "duplicate",
            event_id: txnResult.eventId,
          });
        }

        return reply.status(200).send({
          status: "received",
          event_id: txnResult.eventId,
        });
      } catch (error) {
        request.log.error({ error }, "Failed to store event");
        return reply.status(500).send({
          error: "Internal Server Error",
          message: "Failed to process webhook",
        });
      }
    }
  );
};
