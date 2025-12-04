import { z } from "zod";

// The actual event data structure (inside data.error or at root for some webhook types)
// Using passthrough() and flexible types since Sentry's format varies
export const sentryEventSchema = z
  .object({
    event_id: z.string(),
    timestamp: z.string().or(z.number()),
    platform: z.string().optional(),
    sdk: z
      .object({
        name: z.string(),
        version: z.string(),
      })
      .optional(),
    exception: z
      .object({
        values: z
          .array(
            z
              .object({
                type: z.string().optional(),
                value: z.string().optional(),
                stacktrace: z
                  .object({
                    frames: z.array(
                      z
                        .object({
                          filename: z.string().optional(),
                          function: z.string().optional(),
                          lineno: z.number().optional(),
                          colno: z.number().optional(),
                          abs_path: z.string().optional(),
                          context_line: z.string().optional(),
                          pre_context: z.array(z.string()).optional(),
                          post_context: z.array(z.string()).optional(),
                          in_app: z.boolean().optional(),
                        })
                        .passthrough()
                    ),
                  })
                  .passthrough()
                  .optional(),
              })
              .passthrough()
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    message: z.string().optional(),
    level: z.string().optional(),
    environment: z.string().optional(),
    release: z.string().optional(),
    breadcrumbs: z
      .object({
        values: z
          .array(
            z
              .object({
                timestamp: z.number().optional(),
                type: z.string().optional(),
                category: z.string().optional(),
                message: z.string().optional(),
                data: z.record(z.unknown()).optional(),
                level: z.string().optional(),
              })
              .passthrough()
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    // Sentry sends headers as array of tuples OR object - accept both
    request: z
      .object({
        url: z.string().optional(),
        method: z.string().optional(),
        headers: z
          .union([z.record(z.string()), z.array(z.array(z.string()))])
          .optional(),
        query_string: z.string().optional(),
      })
      .passthrough()
      .optional(),
    user: z
      .object({
        id: z.string().optional(),
        email: z.string().optional(),
        username: z.string().optional(),
        ip_address: z.string().optional(),
      })
      .passthrough()
      .optional(),
    contexts: z.record(z.unknown()).optional(),
    // Sentry sends tags as array of tuples OR object - accept both
    tags: z
      .union([z.record(z.string()), z.array(z.array(z.string()))])
      .optional(),
    fingerprint: z.array(z.string()).optional(),
  })
  .passthrough(); // Allow additional fields we don't explicitly handle

// Sentry webhook envelope structure (wraps the event)
export const sentryWebhookEnvelopeSchema = z
  .object({
    action: z.string(), // "created", "resolved", "assigned", etc.
    installation: z
      .object({
        uuid: z.string(),
      })
      .passthrough()
      .optional(),
    data: z
      .object({
        error: sentryEventSchema, // The actual error event
      })
      .passthrough(),
    actor: z
      .object({
        type: z.string(),
        id: z.string().optional(),
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// Support both direct event payload (legacy) and envelope format (current)
export const sentryWebhookSchema = z.union([
  sentryWebhookEnvelopeSchema,
  sentryEventSchema,
]);

export type SentryEventPayload = z.infer<typeof sentryEventSchema>;
export type SentryWebhookEnvelope = z.infer<typeof sentryWebhookEnvelopeSchema>;
export type SentryWebhookPayload = z.infer<typeof sentryWebhookSchema>;
