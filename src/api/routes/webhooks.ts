import { FastifyPluginAsync, FastifyRequest } from "fastify";
import crypto from "crypto";
import { config } from "../../utils/config.js";
import { logger } from "../../utils/logger.js";
import { sentryWebhookSchema, SentryEventPayload } from "../../types/sentry.js";
import { transaction } from "../../db/client.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.js";
import { enqueueDeterministicJob } from "../../workers/queues/deterministic.js";

type WebhookRequestWithRaw = FastifyRequest & { rawBody?: Buffer };

// ============================================
// Environment Filtering
// ============================================

// Environments that should NOT be processed (local development)
const IGNORED_ENVIRONMENTS = new Set([
  "local",
  "localhost",
  "development",
  "dev",
  "test",
  "testing",
]);

// Environments that SHOULD be processed (hosted/deployed)
const ALLOWED_ENVIRONMENTS = new Set([
  "production",
  "prod",
  "staging",
  "stage",
  "stg",
  "preview",
  "qa",
  "uat",
]);

/**
 * Determine if an error from this environment should be processed.
 * Returns { shouldProcess: boolean, reason?: string }
 */
function shouldProcessEnvironment(environment: string | undefined | null): {
  shouldProcess: boolean;
  reason?: string;
} {
  // If no environment is set, we process it (user may not have configured Sentry properly)
  if (!environment) {
    return { shouldProcess: true };
  }

  const normalizedEnv = environment.toLowerCase().trim();

  // Check if dev errors are allowed (for testing)
  if (config.ALLOW_DEV_ERRORS && IGNORED_ENVIRONMENTS.has(normalizedEnv)) {
    logger.info(
      { environment },
      "Processing dev/local error (ALLOW_DEV_ERRORS=true)"
    );
    return { shouldProcess: true };
  }

  // Explicitly ignored environments
  if (IGNORED_ENVIRONMENTS.has(normalizedEnv)) {
    return {
      shouldProcess: false,
      reason: `Environment '${environment}' is a local/development environment`,
    };
  }

  // Explicitly allowed environments
  if (ALLOWED_ENVIRONMENTS.has(normalizedEnv)) {
    return { shouldProcess: true };
  }

  // For unknown environments, process them (could be custom staging names like "preprod")
  return { shouldProcess: true };
}

/**
 * Check if the error has sufficient data for analysis.
 * Production errors should have release/commit info for proper code fetching.
 */
function hasRequiredProductionData(event: SentryEventPayload): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Check for release info (needed to fetch correct code version)
  if (!event.release) {
    warnings.push("No release tag - will use default branch for code fetching");
  }

  // Check for stack trace
  const hasStackTrace =
    event.exception?.values?.some(
      (v) => v.stacktrace?.frames && v.stacktrace.frames.length > 0
    ) ?? false;

  if (!hasStackTrace) {
    warnings.push("No stack trace frames found");
  }

  return {
    valid: hasStackTrace, // Must have stack trace to analyze
    warnings,
  };
}

const resolvePayloadBuffer = (request: WebhookRequestWithRaw): Buffer => {
  if (request.rawBody && Buffer.isBuffer(request.rawBody)) {
    return request.rawBody;
  }

  const body = request.body ?? {};
  const textPayload = typeof body === "string" ? body : JSON.stringify(body);
  return Buffer.from(textPayload ?? "", "utf8");
};

// Helper to extract the event from envelope or direct payload
const extractEventFromPayload = (
  payload: ReturnType<typeof sentryWebhookSchema.parse>
): SentryEventPayload => {
  // Check if it's an envelope (has action and data.error)
  if ("action" in payload && "data" in payload) {
    const data = payload.data as { error?: SentryEventPayload };
    return data.error as SentryEventPayload;
  }
  // Otherwise it's a direct event payload
  return payload as SentryEventPayload;
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

        // Debug context (no secrets logged)
        request.log.debug(
          {
            payloadLength: payloadBuffer.length,
            rawBodyExists: !!requestWithRawBody.rawBody,
            rawBodyIsBuffer: Buffer.isBuffer(requestWithRawBody.rawBody),
            contentType: request.headers["content-type"],
          },
          "HMAC verification context"
        );

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

      // Extract the actual event from envelope or direct payload
      const rawPayload = parseResult.data;
      const event = extractEventFromPayload(rawPayload);
      const sentryEventId = event.event_id;

      // Filter out local/development environments
      const envCheck = shouldProcessEnvironment(event.environment);
      if (!envCheck.shouldProcess) {
        request.log.info(
          { environment: event.environment, reason: envCheck.reason },
          "Ignoring local/development error"
        );
        return reply.status(200).send({
          status: "ignored",
          reason: envCheck.reason,
        });
      }

      // Validate that we have enough data for production analysis
      const dataCheck = hasRequiredProductionData(event);
      if (!dataCheck.valid) {
        request.log.warn(
          { warnings: dataCheck.warnings },
          "Event missing required data for analysis"
        );
        return reply.status(200).send({
          status: "ignored",
          reason: "Event missing stack trace for analysis",
          warnings: dataCheck.warnings,
        });
      }

      // Log warnings but continue processing
      if (dataCheck.warnings.length > 0) {
        request.log.info(
          { warnings: dataCheck.warnings },
          "Event has missing optional data"
        );
      }

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
              // Limit each part to 200 chars, remove control chars and HTML-sensitive chars
              part
                .slice(0, 200)
                // eslint-disable-next-line no-control-regex
                .replace(/[\x00-\x1f\x7f]/g, "") // Control chars
                .replace(/[<>&"']/g, "") // HTML entities for XSS prevention
                .trim()
            )
            .join(":")
            .slice(0, 1000); // Limit total signature length
        };

        const eventSignature = event.fingerprint
          ? sanitizeFingerprint(event.fingerprint)
          : `${event.exception?.values?.[0]?.type || "unknown"}:${
              event.exception?.values?.[0]?.value?.slice(0, 500) || "unknown"
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

            const existingJob = await client.query(
              "SELECT id FROM rca_jobs WHERE org_id = $1 AND event_id = $2 LIMIT 1",
              [org_id, existingEventId]
            );

            return {
              status: "duplicate" as const,
              eventId: existingEventId,
              jobId: existingJob.rows[0]?.id ?? null,
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
              event.platform,
              event.message ||
                event.exception?.values?.[0]?.value ||
                "Unknown error",
              JSON.stringify(event.exception?.values?.[0]?.stacktrace),
              JSON.stringify(event.breadcrumbs),
              JSON.stringify({
                user: event.user,
                request: event.request,
                contexts: event.contexts,
                tags: event.tags,
              }),
              event.environment,
              event.release,
              new Date(
                typeof event.timestamp === "number"
                  ? event.timestamp * 1000
                  : event.timestamp
              ),
              "received",
              JSON.stringify(rawPayload),
            ]
          );

          const eventId = insertResult.rows[0].id as string;

          const jobResult = await client.query(
            `
            INSERT INTO rca_jobs (
              org_id,
              event_id,
              status,
              created_at,
              updated_at
            ) VALUES ($1, $2, 'pending', NOW(), NOW())
            RETURNING id
          `,
            [org_id, eventId]
          );

          const jobId = jobResult.rows[0].id as string;
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
            jobId,
          };
        });

        if (txnResult.status === "duplicate") {
          return reply.status(200).send({
            status: "duplicate",
            event_id: txnResult.eventId,
          });
        }

        try {
          if (txnResult.jobId) {
            await enqueueDeterministicJob({
              jobId: txnResult.jobId,
              eventId: txnResult.eventId,
              orgId: org_id,
            });
          }
        } catch (error) {
          request.log.error(
            { error, job_id: txnResult.jobId },
            "Failed to enqueue deterministic analyzer job"
          );

          if (txnResult.jobId) {
            await transaction(org_id, async (client) => {
              await client.query(
                `UPDATE rca_jobs SET status = 'failed', error_message = $1 WHERE id = $2`,
                ["deterministic_queue_enqueue_failed", txnResult.jobId]
              );
            });
          }

          return reply.status(500).send({
            error: "Internal Server Error",
            message: "Failed to enqueue analysis job",
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
