import { pino } from "pino";
import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";

const isDev = config.NODE_ENV === "development";

export const logger = pino({
  level: config.LOG_LEVEL,
  transport: {
    target: "pino-pretty",
    options: {
      colorize: isDev,
      translateTime: "mmm dd HH:MM:ss",
      ignore: "pid,hostname",
      messageKey: "msg",
      levelFirst: false,
      singleLine: false,
    },
  },
}) as unknown as FastifyBaseLogger;

export function createChildLogger(
  context: Record<string, unknown>
): FastifyBaseLogger {
  return logger.child(context) as FastifyBaseLogger;
}
