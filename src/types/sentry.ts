import { z } from "zod";

export const sentryWebhookSchema = z.object({
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
          z.object({
            type: z.string(),
            value: z.string(),
            stacktrace: z
              .object({
                frames: z.array(
                  z.object({
                    filename: z.string(),
                    function: z.string().optional(),
                    lineno: z.number().optional(),
                    colno: z.number().optional(),
                    abs_path: z.string().optional(),
                    context_line: z.string().optional(),
                    pre_context: z.array(z.string()).optional(),
                    post_context: z.array(z.string()).optional(),
                    in_app: z.boolean().optional(),
                  })
                ),
              })
              .optional(),
          })
        )
        .optional(),
    })
    .optional(),
  message: z.string().optional(),
  level: z.string().optional(),
  environment: z.string().optional(),
  release: z.string().optional(),
  breadcrumbs: z
    .object({
      values: z
        .array(
          z.object({
            timestamp: z.number(),
            type: z.string().optional(),
            category: z.string().optional(),
            message: z.string().optional(),
            data: z.record(z.unknown()).optional(),
            level: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
  request: z
    .object({
      url: z.string().optional(),
      method: z.string().optional(),
      headers: z.record(z.string()).optional(),
      query_string: z.string().optional(),
    })
    .optional(),
  user: z
    .object({
      id: z.string().optional(),
      email: z.string().optional(),
      username: z.string().optional(),
      ip_address: z.string().optional(),
    })
    .optional(),
  contexts: z.record(z.unknown()).optional(),
  tags: z.record(z.string()).optional(),
  fingerprint: z.array(z.string()).optional(),
});

export type SentryWebhookPayload = z.infer<typeof sentryWebhookSchema>;
