/**
 * URL Helpers
 *
 * Centralized URL generation utilities to avoid duplication across the codebase.
 * Provides consistent URL construction for API, app, and OAuth callback URLs.
 */

import type { FastifyRequest } from "fastify";
import { config } from "./config.js";

/**
 * Get the API base URL (backend server)
 *
 * Used for: OAuth callbacks, webhook URLs, API endpoints
 *
 * @returns API base URL (e.g., https://api.buglens.com or http://localhost:3000)
 */
export function getApiBaseUrl(): string {
  if (config.NODE_ENV === "production" || config.NODE_ENV === "staging") {
    return (
      process.env.API_BASE_URL ||
      process.env.BASE_URL ||
      "https://api.buglens.com"
    );
  }
  return `http://localhost:${config.PORT}`;
}

/**
 * Get the app base URL (frontend application)
 *
 * Used for: Deep links in notifications, emails, Slack messages
 *
 * @returns App base URL (e.g., https://app.buglens.com)
 */
export function getAppBaseUrl(): string {
  return process.env.APP_BASE_URL || "https://app.buglens.com";
}

/**
 * Get base URL from incoming request
 *
 * Useful for OAuth callbacks where you need to redirect back to the requester
 *
 * @param request - Fastify request object
 * @returns Constructed base URL from request headers
 */
export function getBaseUrlFromRequest(request: FastifyRequest): string {
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const host =
    request.headers["x-forwarded-host"] ||
    request.headers.host ||
    "localhost:3000";
  return `${protocol}://${host}`;
}

/**
 * Build OAuth callback URL
 *
 * @param provider - OAuth provider (github, slack, google, etc.)
 * @param type - Callback type: "auth" for user auth, "integration" for integrations
 * @returns Full callback URL
 */
export function getOAuthCallbackUrl(
  provider: string,
  type: "auth" | "integration" = "integration"
): string {
  const baseUrl = getApiBaseUrl();
  if (type === "auth") {
    return `${baseUrl}/api/auth/${provider}/callback`;
  }
  return `${baseUrl}/api/integrations/${provider}/callback`;
}

/**
 * Build webhook URL for a specific provider
 *
 * @param provider - Webhook provider (sentry, github, etc.)
 * @param orgId - Organization ID (optional, for org-specific webhooks)
 * @returns Full webhook URL
 */
export function getWebhookUrl(provider: string, orgId?: string): string {
  const baseUrl = getApiBaseUrl();
  if (orgId) {
    return `${baseUrl}/api/v1/webhooks/${provider}/${orgId}`;
  }
  return `${baseUrl}/api/v1/webhooks/${provider}`;
}

/**
 * Build deep link to specific resource in the app
 *
 * @param resource - Resource type (event, rca, etc.)
 * @param resourceId - Resource ID
 * @returns Full app URL
 */
export function getAppResourceUrl(
  resource: "event" | "rca" | "events" | "dashboard",
  resourceId?: string
): string {
  const baseUrl = getAppBaseUrl();
  if (resourceId) {
    return `${baseUrl}/${resource}s/${resourceId}`;
  }
  return `${baseUrl}/${resource}`;
}
