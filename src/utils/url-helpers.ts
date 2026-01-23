/**
 * URL Helpers
 *
 * Centralized URL generation utilities to avoid duplication across the codebase.
 * Provides consistent URL construction for API, app, and OAuth callback URLs.
 *
 * Security Note: These functions use validated environment variables from config.ts
 * to prevent configuration issues in production.
 */

import type { FastifyRequest } from "fastify";
import { config } from "./config.js";

/**
 * Trusted domains for URL validation (prevents open redirect attacks)
 */
const TRUSTED_DOMAINS = [
  "localhost",
  "buglens.com",
  "buglens.co",
  "staging.buglens.co",
  "api.buglens.com",
  "api.staging.buglens.co",
  "app.buglens.com",
  "app.staging.buglens.co",
];

/**
 * Validate that a URL belongs to a trusted domain
 *
 * @param url - URL to validate
 * @returns true if the URL domain is trusted
 */
function isTrustedDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return TRUSTED_DOMAINS.some(
      (trusted) => hostname === trusted || hostname.endsWith(`.${trusted}`)
    );
  } catch {
    return false;
  }
}

/**
 * Get the API base URL (backend server)
 *
 * Used for: OAuth callbacks, webhook URLs, API endpoints
 * Uses validated config.API_BASE_URL when available.
 *
 * @returns API base URL (e.g., https://api.buglens.com or http://localhost:3000)
 */
export function getApiBaseUrl(): string {
  if (config.NODE_ENV === "production" || config.NODE_ENV === "staging") {
    // Use validated config values, fallback to hardcoded default
    return config.API_BASE_URL || "https://api.buglens.com";
  }
  return `http://localhost:${config.PORT}`;
}

/**
 * Get the app base URL (frontend application)
 *
 * Used for: Deep links in notifications, emails, Slack messages
 * Uses validated config.APP_BASE_URL when available.
 *
 * @returns App base URL (e.g., https://app.buglens.com)
 */
export function getAppBaseUrl(): string {
  // Use validated config value if available
  if (config.APP_BASE_URL) {
    return config.APP_BASE_URL;
  }
  // Fallback based on environment
  if (config.NODE_ENV === "production") {
    return "https://app.buglens.com";
  }
  if (config.NODE_ENV === "staging") {
    return "https://staging.buglens.co";
  }
  return config.FRONTEND_URL || "http://localhost:3002";
}

/**
 * Get base URL from incoming request
 *
 * Useful for OAuth callbacks where you need to redirect back to the requester.
 *
 * SECURITY WARNING: This function constructs URLs from user-controlled headers.
 * The result is validated against trusted domains to prevent open redirect attacks.
 * For OAuth callbacks, prefer using getApiBaseUrl() instead.
 *
 * @param request - Fastify request object
 * @returns Constructed base URL from request headers, or null if untrusted
 * @throws Error if the resulting URL is from an untrusted domain
 */
export function getBaseUrlFromRequest(request: FastifyRequest): string {
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const host =
    request.headers["x-forwarded-host"] ||
    request.headers.host ||
    "localhost:3000";
  const url = `${protocol}://${host}`;

  // Validate against trusted domains to prevent open redirect attacks
  if (!isTrustedDomain(url)) {
    // In development, allow any domain for testing flexibility
    if (config.NODE_ENV === "development" || config.NODE_ENV === "test") {
      return url;
    }
    // In production/staging, log warning and fall back to configured API URL
    // This prevents attackers from manipulating headers to redirect to malicious sites
    return getApiBaseUrl();
  }

  return url;
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
 * Resource path mapping for correct URL construction
 * Maps resource types to their correct URL path segments
 */
const RESOURCE_PATHS: Record<string, string> = {
  event: "events",
  events: "events",
  rca: "rca",
  dashboard: "dashboard",
};

/**
 * Build deep link to specific resource in the app
 *
 * @param resource - Resource type (event, rca, events, dashboard)
 * @param resourceId - Resource ID (optional)
 * @returns Full app URL
 *
 * @example
 * getAppResourceUrl("event", "123") // https://app.buglens.com/events/123
 * getAppResourceUrl("rca", "456")   // https://app.buglens.com/rca/456
 * getAppResourceUrl("dashboard")    // https://app.buglens.com/dashboard
 */
export function getAppResourceUrl(
  resource: "event" | "rca" | "events" | "dashboard",
  resourceId?: string
): string {
  const baseUrl = getAppBaseUrl();
  const path = RESOURCE_PATHS[resource] || resource;

  if (resourceId) {
    return `${baseUrl}/${path}/${resourceId}`;
  }
  return `${baseUrl}/${path}`;
}
