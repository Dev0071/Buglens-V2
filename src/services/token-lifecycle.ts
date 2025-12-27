/**
 * Token Lifecycle Service
 *
 * Manages OAuth token lifecycle:
 * - Automatic refresh before expiry
 * - Expiry detection and warning
 * - Token revocation
 * - Health checks for integrations
 *
 * This service should be run periodically (e.g., via BullMQ scheduled job)
 * to keep tokens fresh and detect issues before they cause problems.
 */

import { logger } from "../utils/logger.js";
import { query } from "../db/client.js";
import {
  getIntegrationTokens,
  updateIntegrationTokens,
  updateIntegrationStatus,
  checkTokensNeedRefresh,
  type StoredTokens,
} from "./integration-tokens.js";
import { platformCredentials } from "./platform-credentials.js";

// ============================================
// Constants
// ============================================

// Refresh tokens when they have less than this time remaining
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ============================================
// Types
// ============================================

interface TokenHealthResult {
  integrationId: string;
  orgId: string;
  type: string;
  status: "healthy" | "expiring" | "expired" | "error" | "refresh_failed";
  message: string;
  expiresAt?: Date;
}

interface RefreshResult {
  success: boolean;
  integrationId: string;
  message: string;
  newExpiresAt?: Date;
}

// ============================================
// Token Refresh Functions
// ============================================

/**
 * Refresh Google OAuth tokens
 */
async function refreshGoogleTokens(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn?: number;
} | null> {
  const credentials = platformCredentials.getGoogleOAuth();
  if (!credentials) {
    return null;
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, "Google token refresh failed");
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in?: number;
      error?: string;
    };

    if (data.error) {
      logger.error({ error: data.error }, "Google token refresh error");
      return null;
    }

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  } catch (error) {
    logger.error({ error }, "Google token refresh exception");
    return null;
  }
}

/**
 * Refresh Slack tokens (Bot tokens don't expire, but user tokens may)
 */
async function refreshSlackTokens(_refreshToken: string): Promise<{
  accessToken: string;
  expiresIn?: number;
} | null> {
  // Slack Bot tokens don't expire and don't have refresh tokens
  // If using user tokens with rotation, implement refresh here
  logger.debug("Slack bot tokens don't require refresh");
  return null;
}

/**
 * Refresh Jira tokens
 */
async function refreshJiraTokens(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
} | null> {
  const credentials = platformCredentials.getJiraOAuth();
  if (!credentials) {
    return null;
  }

  try {
    const response = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, "Jira token refresh failed");
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };

    if (data.error) {
      logger.error({ error: data.error }, "Jira token refresh error");
      return null;
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  } catch (error) {
    logger.error({ error }, "Jira token refresh exception");
    return null;
  }
}

/**
 * Refresh Microsoft Teams tokens
 */
async function refreshTeamsTokens(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
} | null> {
  const credentials = platformCredentials.getTeamsOAuth();
  if (!credentials) {
    return null;
  }

  try {
    const response = await fetch(
      `https://login.microsoftonline.com/${credentials.tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
          scope: "https://graph.microsoft.com/.default offline_access",
        }),
      }
    );

    if (!response.ok) {
      logger.error({ status: response.status }, "Teams token refresh failed");
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };

    if (data.error) {
      logger.error({ error: data.error }, "Teams token refresh error");
      return null;
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  } catch (error) {
    logger.error({ error }, "Teams token refresh exception");
    return null;
  }
}

// ============================================
// Token Health Check
// ============================================

/**
 * Check the health of all integrations for an organization
 */
export async function checkOrganizationTokenHealth(
  orgId: string
): Promise<TokenHealthResult[]> {
  const results: TokenHealthResult[] = [];

  const integrations = await query<{
    id: string;
    type: string;
    status: string;
    expires_at: Date | null;
  }>(
    `SELECT id, type, status, expires_at FROM integrations
     WHERE org_id = $1 AND status = 'connected'`,
    [orgId]
  );

  for (const integration of integrations.rows) {
    const result: TokenHealthResult = {
      integrationId: integration.id,
      orgId,
      type: integration.type,
      status: "healthy",
      message: "Token is valid",
      expiresAt: integration.expires_at || undefined,
    };

    if (integration.expires_at) {
      const timeToExpiry = integration.expires_at.getTime() - Date.now();

      if (timeToExpiry <= 0) {
        result.status = "expired";
        result.message = "Token has expired";
      } else if (timeToExpiry < REFRESH_THRESHOLD_MS) {
        result.status = "expiring";
        result.message = `Token expires in ${Math.round(timeToExpiry / 1000 / 60)} minutes`;
      }
    }

    results.push(result);
  }

  return results;
}

/**
 * Check all organizations for token health issues
 */
export async function checkAllTokenHealth(): Promise<TokenHealthResult[]> {
  const results: TokenHealthResult[] = [];

  const organizations = await query<{ id: string }>(
    `SELECT DISTINCT org_id as id FROM integrations WHERE status = 'connected'`
  );

  for (const org of organizations.rows) {
    const orgResults = await checkOrganizationTokenHealth(org.id);
    results.push(...orgResults);
  }

  return results;
}

// ============================================
// Token Refresh
// ============================================

/**
 * Refresh a single integration's tokens
 */
export async function refreshIntegrationTokens(
  orgId: string,
  integrationId: string
): Promise<RefreshResult> {
  const tokens = await getIntegrationTokens(orgId, integrationId);

  if (!tokens) {
    return {
      success: false,
      integrationId,
      message: "Integration not found or not connected",
    };
  }

  if (!tokens.refreshToken) {
    return {
      success: false,
      integrationId,
      message: "No refresh token available",
    };
  }

  // Get integration type
  const integration = await query<{ type: string }>(
    `SELECT type FROM integrations WHERE id = $1 AND org_id = $2`,
    [integrationId, orgId]
  );

  if (integration.rows.length === 0) {
    return {
      success: false,
      integrationId,
      message: "Integration not found",
    };
  }

  const type = integration.rows[0].type;
  let refreshResult: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  } | null = null;

  // Call appropriate refresh function based on type
  switch (type) {
    case "google":
      const googleResult = await refreshGoogleTokens(tokens.refreshToken);
      if (googleResult) {
        refreshResult = { ...googleResult, refreshToken: tokens.refreshToken };
      }
      break;
    case "slack":
      refreshResult = await refreshSlackTokens(tokens.refreshToken);
      break;
    case "jira":
      refreshResult = await refreshJiraTokens(tokens.refreshToken);
      break;
    case "teams":
      refreshResult = await refreshTeamsTokens(tokens.refreshToken);
      break;
    default:
      return {
        success: false,
        integrationId,
        message: `Refresh not supported for type: ${type}`,
      };
  }

  if (!refreshResult) {
    await updateIntegrationStatus(
      orgId,
      integrationId,
      "error",
      "Token refresh failed"
    );
    return {
      success: false,
      integrationId,
      message: "Token refresh failed",
    };
  }

  // Update tokens
  const newExpiresAt = refreshResult.expiresIn
    ? new Date(Date.now() + refreshResult.expiresIn * 1000)
    : undefined;

  const updatedTokens: StoredTokens = {
    accessToken: refreshResult.accessToken,
    refreshToken: refreshResult.refreshToken || tokens.refreshToken,
    tokenType: tokens.tokenType,
    scope: tokens.scope,
    expiresAt: newExpiresAt,
  };

  await updateIntegrationTokens(orgId, integrationId, updatedTokens);

  logger.info({ orgId, integrationId, type }, "Integration tokens refreshed");

  return {
    success: true,
    integrationId,
    message: "Tokens refreshed successfully",
    newExpiresAt,
  };
}

/**
 * Refresh all expiring tokens for an organization
 */
export async function refreshExpiringTokens(
  orgId: string
): Promise<RefreshResult[]> {
  const results: RefreshResult[] = [];

  const integrations = await query<{
    id: string;
    type: string;
    expires_at: Date | null;
  }>(
    `SELECT id, type, expires_at FROM integrations
     WHERE org_id = $1 AND status = 'connected'`,
    [orgId]
  );

  for (const integration of integrations.rows) {
    const { needsRefresh } = await checkTokensNeedRefresh(
      orgId,
      integration.id
    );

    if (needsRefresh) {
      const result = await refreshIntegrationTokens(orgId, integration.id);
      results.push(result);
    }
  }

  return results;
}

/**
 * Refresh all expiring tokens across all organizations
 */
export async function refreshAllExpiringTokens(): Promise<{
  total: number;
  successful: number;
  failed: number;
  results: RefreshResult[];
}> {
  const allResults: RefreshResult[] = [];

  const organizations = await query<{ id: string }>(
    `SELECT DISTINCT org_id as id FROM integrations WHERE status = 'connected'`
  );

  for (const org of organizations.rows) {
    const results = await refreshExpiringTokens(org.id);
    allResults.push(...results);
  }

  const successful = allResults.filter((r) => r.success).length;
  const failed = allResults.filter((r) => !r.success).length;

  if (allResults.length > 0) {
    logger.info(
      { total: allResults.length, successful, failed },
      "Token refresh job completed"
    );
  }

  return {
    total: allResults.length,
    successful,
    failed,
    results: allResults,
  };
}

// ============================================
// Token Revocation
// ============================================

/**
 * Revoke Google OAuth tokens
 */
async function revokeGoogleToken(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/revoke?token=${accessToken}`,
      { method: "POST" }
    );
    return response.ok;
  } catch (error) {
    logger.error({ error }, "Google token revocation failed");
    return false;
  }
}

/**
 * Revoke Slack tokens
 */
async function revokeSlackToken(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const data = (await response.json()) as { ok?: boolean };
    return data.ok === true;
  } catch (error) {
    logger.error({ error }, "Slack token revocation failed");
    return false;
  }
}

/**
 * Revoke integration tokens (best-effort)
 */
export async function revokeIntegrationTokens(
  orgId: string,
  integrationId: string
): Promise<boolean> {
  const tokens = await getIntegrationTokens(orgId, integrationId);

  if (!tokens) {
    return true; // Already gone
  }

  // Get integration type
  const integration = await query<{ type: string }>(
    `SELECT type FROM integrations WHERE id = $1 AND org_id = $2`,
    [integrationId, orgId]
  );

  if (integration.rows.length === 0) {
    return true;
  }

  const type = integration.rows[0].type;
  let revoked = true;

  // Best-effort revocation
  switch (type) {
    case "google":
      revoked = await revokeGoogleToken(tokens.accessToken);
      break;
    case "slack":
      revoked = await revokeSlackToken(tokens.accessToken);
      break;
    // Other providers may not support revocation via API
  }

  // Update status regardless of revocation success
  await updateIntegrationStatus(orgId, integrationId, "disconnected");

  logger.info(
    { orgId, integrationId, type, revoked },
    "Integration tokens revoked"
  );

  return revoked;
}

// ============================================
// Exports for BullMQ Jobs
// ============================================

/**
 * Job handler for periodic token refresh
 * Should be called every 5 minutes by BullMQ scheduler
 */
export async function tokenRefreshJobHandler(): Promise<void> {
  logger.debug("Starting token refresh job");
  await refreshAllExpiringTokens();
}

/**
 * Job handler for token health check
 * Should be called every hour by BullMQ scheduler
 */
export async function tokenHealthCheckJobHandler(): Promise<void> {
  logger.debug("Starting token health check job");
  const results = await checkAllTokenHealth();

  const issues = results.filter((r) => r.status !== "healthy");
  if (issues.length > 0) {
    logger.warn({ issues: issues.length }, "Token health issues detected");
    // Could trigger alerts here
  }
}

logger.info("Token lifecycle service initialized");
