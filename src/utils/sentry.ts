import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Initialize Sentry for error tracking and performance monitoring
 * Only enabled in production/staging environments
 */
export function initSentry() {
  const dsn = config.SENTRY_DSN;

  if (!dsn) {
    logger.warn("⚠️  Sentry DSN not configured - error tracking disabled");
    return;
  }

  Sentry.init({
    dsn,
    environment: config.NODE_ENV,
    release: `buglens-backend@${process.env.npm_package_version || "1.0.0"}`,
    enabled: true, // Enabled in all environments for testing (set to NODE_ENV !== 'development' in production)
    debug: true, // Enable debug mode to see what's happening
    sendDefaultPii: true, // Include PII for better context

    // Performance Monitoring
    tracesSampleRate: config.NODE_ENV === "production" ? 0.1 : 1.0, // 10% in prod, 100% in staging

    // Profiling
    profilesSampleRate: config.NODE_ENV === "production" ? 0.1 : 1.0,

    // Transport settings - ensure events are sent
    transportOptions: {
      keepAlive: true,
    },

    integrations: [nodeProfilingIntegration()],

    // Log when events are sent
    beforeSend(event, _hint) {
      logger.info(
        {
          eventId: event.event_id,
          message: event.message,
          exception: event.exception?.values?.[0]?.value,
        },
        "📤 Sentry sending event"
      );

      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
        delete event.request.headers["x-api-key"];
      }

      // Filter out health check errors
      if (event.request?.url?.includes("/health")) {
        return null;
      }

      return event;
    },
  });

  logger.info(
    {
      environment: config.NODE_ENV,
      dsn: dsn.substring(0, 50) + "...",
    },
    "✅ Sentry initialized"
  );
}

/**
 * Capture an exception and send to Sentry
 */
export function captureException(
  error: Error,
  context?: Record<string, unknown>
) {
  logger.info(
    {
      errorMessage: error.message,
      context,
      sentryClient: !!Sentry.getClient(),
    },
    "🔴 captureException called"
  );

  if (Sentry.getClient()) {
    const eventId = Sentry.captureException(error, { extra: context });
    logger.info({ eventId }, "✅ Sentry event captured");
    return eventId;
  } else {
    logger.warn("⚠️ Sentry client not available");
    return undefined;
  }
}

/**
 * Set user context for Sentry events
 */
export function setUser(user: { id: string; email?: string; orgId?: string }) {
  Sentry.setUser({
    id: user.id,
    email: user.email,
    org_id: user.orgId,
  });
}

/**
 * Clear user context
 */
export function clearUser() {
  Sentry.setUser(null);
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(message: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({
    message,
    data,
    level: "info",
  });
}

export { Sentry };
