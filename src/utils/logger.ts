import { pino } from "pino";
import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";

// Pino logger configuration compatible with Fastify
// Cast through unknown to satisfy FastifyBaseLogger interface
// (Fastify bundles its own pino types with extra properties like msgPrefix)
export const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname",
          },
        }
      : undefined,
}) as unknown as FastifyBaseLogger;

export function createChildLogger(context: Record<string, unknown>): FastifyBaseLogger {
  return logger.child(context) as FastifyBaseLogger;
}
