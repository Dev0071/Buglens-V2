/**
 * Integration Tokens Service
 *
 * Manages OAuth tokens for integrations (GitHub, Slack, etc.)
 * All tokens are encrypted at rest using organization-specific keys.
 *
 * Token Lifecycle:
 * 1. User clicks "Connect GitHub" → redirected to GitHub OAuth
 * 2. GitHub redirects back with code → exchanged for access_token + refresh_token
 * 3. Tokens encrypted and stored in database
 * 4. When using integration, tokens decrypted and used
 * 5. If token expired, refresh using refresh_token
 * 6. If refresh fails, user needs to reconnect
 */

import { query } from "../db/client.js";
import {
  encryptJsonForOrg,
  decryptJsonForOrg,
  type EncryptedData,
} from "./crypto.js";
import { logger } from "../utils/logger.js";

// ============================================
// Types
// ============================================

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  expiresAt?: Date;
}

export interface GitHubInstallation {
  installationId: number;
  accessToken?: string;
  accessTokenExpiresAt?: Date;
  permissions: Record<string, string>;
  repositorySelection: "all" | "selected";
  account: {
    id: number;
    login: string;
    type: "User" | "Organization";
    avatarUrl?: string;
  };
}

export interface SlackWorkspace {
  teamId: string;
  teamName: string;
  botUserId: string;
  accessToken: string;
  scope: string;
  incomingWebhook?: {
    channel: string;
    channelId: string;
    configurationUrl: string;
    url: string;
  };
}

export interface IntegrationRecord {
  id: string;
  orgId: string;
  type: string;
  status: "connected" | "disconnected" | "error" | "expired";
  displayName: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
}

// ============================================
// Token Storage
// ============================================

/**
 * Store encrypted OAuth tokens for an integration
 */
export async function storeIntegrationTokens(
  orgId: string,
  type: string,
  tokens: StoredTokens,
  metadata: {
    displayName: string;
    externalId?: string;
    additionalData?: Record<string, unknown>;
  }
): Promise<string> {
  // Encrypt tokens
  const encryptedTokens = encryptJsonForOrg(tokens, orgId);

  const result = await query<{ id: string }>(
    `INSERT INTO integrations (
      org_id, type, status, display_name, external_id,
      encrypted_tokens, metadata, expires_at
    ) VALUES ($1, $2, 'connected', $3, $4, $5, $6, $7)
    ON CONFLICT (org_id, type, external_id) DO UPDATE SET
      status = 'connected',
      display_name = EXCLUDED.display_name,
      encrypted_tokens = EXCLUDED.encrypted_tokens,
      metadata = EXCLUDED.metadata,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
    RETURNING id`,
    [
      orgId,
      type,
      metadata.displayName,
      metadata.externalId || null,
      JSON.stringify(encryptedTokens),
      JSON.stringify(metadata.additionalData || {}),
      tokens.expiresAt || null,
    ]
  );

  logger.info(
    { orgId, type, integrationId: result.rows[0].id },
    "Integration tokens stored"
  );
  return result.rows[0].id;
}

/**
 * Retrieve and decrypt tokens for an integration
 */
export async function getIntegrationTokens(
  orgId: string,
  integrationId: string
): Promise<StoredTokens | null> {
  const result = await query<{ encrypted_tokens: string; org_id: string }>(
    `SELECT encrypted_tokens, org_id FROM integrations
     WHERE id = $1 AND org_id = $2 AND status = 'connected'`,
    [integrationId, orgId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const encryptedTokens = JSON.parse(
    result.rows[0].encrypted_tokens
  ) as EncryptedData;
  return decryptJsonForOrg<StoredTokens>(encryptedTokens, orgId);
}

/**
 * Get tokens by integration type (e.g., "github", "slack")
 */
export async function getIntegrationTokensByType(
  orgId: string,
  type: string
): Promise<{ integrationId: string; tokens: StoredTokens } | null> {
  const result = await query<{ id: string; encrypted_tokens: string }>(
    `SELECT id, encrypted_tokens FROM integrations
     WHERE org_id = $1 AND type = $2 AND status = 'connected'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [orgId, type]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const encryptedTokens = JSON.parse(
    result.rows[0].encrypted_tokens
  ) as EncryptedData;
  const tokens = decryptJsonForOrg<StoredTokens>(encryptedTokens, orgId);

  return {
    integrationId: result.rows[0].id,
    tokens,
  };
}

/**
 * Update tokens (e.g., after refresh)
 */
export async function updateIntegrationTokens(
  orgId: string,
  integrationId: string,
  tokens: StoredTokens
): Promise<void> {
  const encryptedTokens = encryptJsonForOrg(tokens, orgId);

  await query(
    `UPDATE integrations SET
      encrypted_tokens = $1,
      expires_at = $2,
      updated_at = NOW()
     WHERE id = $3 AND org_id = $4`,
    [
      JSON.stringify(encryptedTokens),
      tokens.expiresAt || null,
      integrationId,
      orgId,
    ]
  );

  logger.debug({ orgId, integrationId }, "Integration tokens updated");
}

/**
 * Mark integration as using a specific status
 */
export async function updateIntegrationStatus(
  orgId: string,
  integrationId: string,
  status: IntegrationRecord["status"],
  errorMessage?: string
): Promise<void> {
  await query(
    `UPDATE integrations SET
      status = $1,
      metadata = CASE
        WHEN $2 IS NOT NULL THEN jsonb_set(COALESCE(metadata, '{}'::jsonb), '{lastError}', to_jsonb($2::text))
        ELSE metadata
      END,
      updated_at = NOW()
     WHERE id = $3 AND org_id = $4`,
    [status, errorMessage || null, integrationId, orgId]
  );
}

/**
 * Record when an integration was last used
 */
export async function recordIntegrationUsage(
  orgId: string,
  integrationId: string
): Promise<void> {
  await query(
    `UPDATE integrations SET last_used_at = NOW() WHERE id = $1 AND org_id = $2`,
    [integrationId, orgId]
  );
}

/**
 * Get all integrations for an organization
 */
export async function getOrganizationIntegrations(
  orgId: string
): Promise<IntegrationRecord[]> {
  const result = await query<{
    id: string;
    org_id: string;
    type: string;
    status: string;
    display_name: string;
    external_id: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
    last_used_at: Date | null;
    expires_at: Date | null;
  }>(
    `SELECT id, org_id, type, status, display_name, external_id,
            metadata, created_at, updated_at, last_used_at, expires_at
     FROM integrations
     WHERE org_id = $1
     ORDER BY type, updated_at DESC`,
    [orgId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    type: row.type,
    status: row.status as IntegrationRecord["status"],
    displayName: row.display_name,
    externalId: row.external_id || undefined,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at || undefined,
    expiresAt: row.expires_at || undefined,
  }));
}

/**
 * Disconnect an integration
 */
export async function disconnectIntegration(
  orgId: string,
  integrationId: string
): Promise<boolean> {
  const result = await query(
    `UPDATE integrations SET
      status = 'disconnected',
      encrypted_tokens = NULL,
      updated_at = NOW()
     WHERE id = $1 AND org_id = $2`,
    [integrationId, orgId]
  );

  logger.info({ orgId, integrationId }, "Integration disconnected");
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete an integration completely
 */
export async function deleteIntegration(
  orgId: string,
  integrationId: string
): Promise<boolean> {
  const result = await query(
    `DELETE FROM integrations WHERE id = $1 AND org_id = $2`,
    [integrationId, orgId]
  );

  logger.info({ orgId, integrationId }, "Integration deleted");
  return (result.rowCount ?? 0) > 0;
}

// ============================================
// GitHub App Installation Storage
// ============================================

/**
 * Store a GitHub App installation
 */
export async function storeGitHubInstallation(
  orgId: string,
  installation: GitHubInstallation
): Promise<string> {
  const encryptedData = encryptJsonForOrg(
    { installationId: installation.installationId },
    orgId
  );

  const result = await query<{ id: string }>(
    `INSERT INTO integrations (
      org_id, type, status, display_name, external_id,
      encrypted_tokens, metadata
    ) VALUES ($1, 'github_app', 'connected', $2, $3, $4, $5)
    ON CONFLICT (org_id, type, external_id) DO UPDATE SET
      status = 'connected',
      display_name = EXCLUDED.display_name,
      encrypted_tokens = EXCLUDED.encrypted_tokens,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING id`,
    [
      orgId,
      `${installation.account.login} (${installation.account.type})`,
      installation.installationId.toString(),
      JSON.stringify(encryptedData),
      JSON.stringify({
        accountId: installation.account.id,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        avatarUrl: installation.account.avatarUrl,
        permissions: installation.permissions,
        repositorySelection: installation.repositorySelection,
      }),
    ]
  );

  logger.info(
    {
      orgId,
      installationId: installation.installationId,
      account: installation.account.login,
    },
    "GitHub App installation stored"
  );

  return result.rows[0].id;
}

/**
 * Get GitHub App installation for an organization
 */
export async function getGitHubInstallation(
  orgId: string
): Promise<{
  integrationId: string;
  installationId: number;
  metadata: Record<string, unknown>;
} | null> {
  const result = await query<{
    id: string;
    encrypted_tokens: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT id, encrypted_tokens, metadata FROM integrations
     WHERE org_id = $1 AND type = 'github_app' AND status = 'connected'
     LIMIT 1`,
    [orgId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const encryptedData = JSON.parse(
    result.rows[0].encrypted_tokens
  ) as EncryptedData;
  const data = decryptJsonForOrg<{ installationId: number }>(
    encryptedData,
    orgId
  );

  return {
    integrationId: result.rows[0].id,
    installationId: data.installationId,
    metadata: result.rows[0].metadata,
  };
}

// ============================================
// Slack Workspace Storage
// ============================================

/**
 * Store a Slack workspace connection
 */
export async function storeSlackWorkspace(
  orgId: string,
  workspace: SlackWorkspace
): Promise<string> {
  const tokens: StoredTokens = {
    accessToken: workspace.accessToken,
    tokenType: "bot",
    scope: workspace.scope,
  };

  return storeIntegrationTokens(orgId, "slack", tokens, {
    displayName: workspace.teamName,
    externalId: workspace.teamId,
    additionalData: {
      teamId: workspace.teamId,
      teamName: workspace.teamName,
      botUserId: workspace.botUserId,
      incomingWebhook: workspace.incomingWebhook,
    },
  });
}

/**
 * Get Slack workspace for an organization
 */
export async function getSlackWorkspace(
  orgId: string
): Promise<{ integrationId: string; workspace: SlackWorkspace } | null> {
  const result = await query<{
    id: string;
    encrypted_tokens: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT id, encrypted_tokens, metadata FROM integrations
     WHERE org_id = $1 AND type = 'slack' AND status = 'connected'
     LIMIT 1`,
    [orgId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const encryptedTokens = JSON.parse(
    result.rows[0].encrypted_tokens
  ) as EncryptedData;
  const tokens = decryptJsonForOrg<StoredTokens>(encryptedTokens, orgId);
  const metadata = result.rows[0].metadata;

  return {
    integrationId: result.rows[0].id,
    workspace: {
      teamId: metadata.teamId as string,
      teamName: metadata.teamName as string,
      botUserId: metadata.botUserId as string,
      accessToken: tokens.accessToken,
      scope: tokens.scope || "",
      incomingWebhook:
        metadata.incomingWebhook as SlackWorkspace["incomingWebhook"],
    },
  };
}

// ============================================
// Token Refresh
// ============================================

/**
 * Check if tokens need refresh and return refresh instructions
 */
export async function checkTokensNeedRefresh(
  orgId: string,
  integrationId: string
): Promise<{ needsRefresh: boolean; refreshToken?: string }> {
  const tokens = await getIntegrationTokens(orgId, integrationId);

  if (!tokens) {
    return { needsRefresh: false };
  }

  if (!tokens.expiresAt) {
    return { needsRefresh: false };
  }

  // Refresh if expiring within 5 minutes
  const expiresIn = tokens.expiresAt.getTime() - Date.now();
  const needsRefresh = expiresIn < 5 * 60 * 1000;

  return {
    needsRefresh,
    refreshToken: needsRefresh ? tokens.refreshToken : undefined,
  };
}

logger.info("Integration tokens service initialized");
