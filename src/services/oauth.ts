/**
 * OAuth Service
 *
 * Platform-owned OAuth implementation with PKCE support.
 * This service handles OAuth flows for GitHub, Slack, and other integrations.
 *
 * Key Features:
 * - PKCE (Proof Key for Code Exchange) for enhanced security
 * - State parameter for CSRF protection
 * - Platform credentials (users don't configure anything)
 * - Encrypted token storage
 *
 * Architecture:
 * - Auth flows (Google/GitHub): For user sign-in to Buglens
 * - Integration flows (GitHub App/Slack App): For connecting repos/workspaces
 */

import crypto from "crypto";
import { logger } from "../utils/logger.js";
import { query, transaction } from "../db/client.js";
import {
  platformCredentials,
  type IntegrationProvider,
} from "./platform-credentials.js";
import {
  storeGitHubInstallation,
  storeSlackWorkspace,
  type GitHubInstallation,
  type SlackWorkspace,
} from "./integration-tokens.js";
import {
  encryptJsonForOrg,
  decryptJsonForOrg,
  type EncryptedData,
} from "./crypto.js";
import { getOAuthCallbackUrl } from "../utils/url-helpers.js";

// ============================================
// Types
// ============================================

export interface OAuthState {
  state: string;
  codeVerifier?: string;
  codeChallenge?: string;
  orgId: string;
  integrationType: string;
  returnUrl: string;
  action: "login" | "link" | "install";
  nonce: string;
  createdAt: number;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string; // For OIDC
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface SlackTeam {
  id: string;
  name: string;
}

export interface SlackAuthResponse {
  ok: boolean;
  access_token: string;
  token_type: string;
  scope: string;
  bot_user_id: string;
  team: SlackTeam;
  incoming_webhook?: {
    channel: string;
    channel_id: string;
    url: string;
  };
}

// ============================================
// State Management (In-memory for simplicity, use Redis in production)
// ============================================

const oauthStates = new Map<string, OAuthState>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ============================================
// PKCE Utilities
// ============================================

/**
 * Generate a cryptographically secure code verifier for PKCE
 * Must be between 43-128 characters
 */
export function generateCodeVerifier(): string {
  const bytes = crypto.randomBytes(32);
  return bytes.toString("base64url");
}

/**
 * Generate code challenge from verifier using SHA-256 (S256 method)
 */
export function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return hash.toString("base64url");
}

/**
 * Generate a secure state token
 */
export function generateStateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generate a secure OAuth state token and store state data
 * Now supports PKCE for providers that support it
 */
export function generateOAuthState(
  orgId: string,
  integrationType: string,
  returnUrl: string,
  options?: { action?: OAuthState["action"]; usePkce?: boolean }
): string {
  const stateId = generateStateToken();
  const codeVerifier = options?.usePkce ? generateCodeVerifier() : undefined;

  const state: OAuthState = {
    state: stateId,
    codeVerifier,
    codeChallenge: codeVerifier
      ? generateCodeChallenge(codeVerifier)
      : undefined,
    orgId,
    integrationType,
    returnUrl,
    action: options?.action || "install",
    nonce: crypto.randomBytes(16).toString("hex"),
    createdAt: Date.now(),
  };

  oauthStates.set(stateId, state);

  // Clean up expired states periodically
  setTimeout(() => {
    oauthStates.delete(stateId);
  }, STATE_TTL_MS);

  return stateId;
}

/**
 * Validate and consume OAuth state
 */
export function validateOAuthState(stateId: string): OAuthState | null {
  const state = oauthStates.get(stateId);

  if (!state) {
    return null;
  }

  // Check if expired
  if (Date.now() - state.createdAt > STATE_TTL_MS) {
    oauthStates.delete(stateId);
    return null;
  }

  // Consume state (one-time use)
  oauthStates.delete(stateId);
  return state;
}

// ============================================
// GitHub OAuth
// ============================================

const GITHUB_OAUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_URL = "https://api.github.com";

/**
 * Get GitHub OAuth authorization URL
 * Uses platform credentials - no user configuration needed
 */
export function getGitHubAuthUrl(stateId: string): string | null {
  const credentials = platformCredentials.getGitHubOAuth();
  if (!credentials) {
    logger.error("GitHub OAuth not configured");
    return null;
  }

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: getOAuthCallbackUrl("github"),
    scope: "read:user repo",
    state: stateId,
  });

  return `${GITHUB_OAUTH_URL}?${params.toString()}`;
}

/**
 * Exchange GitHub authorization code for access token
 * Uses platform credentials
 */
export async function exchangeGitHubCode(
  code: string
): Promise<OAuthTokenResponse> {
  const credentials = platformCredentials.getGitHubOAuth();
  if (!credentials) {
    throw new Error("GitHub OAuth not configured");
  }

  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as OAuthTokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (data.error) {
    throw new Error(
      `GitHub OAuth error: ${data.error_description || data.error}`
    );
  }

  return data;
}

/**
 * Get GitHub user info
 */
export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get GitHub user: ${response.status}`);
  }

  return response.json() as Promise<GitHubUser>;
}

/**
 * Get GitHub user repositories
 */
export async function getGitHubRepos(
  accessToken: string
): Promise<Array<{ id: number; full_name: string; private: boolean }>> {
  const response = await fetch(
    `${GITHUB_API_URL}/user/repos?per_page=100&sort=updated`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get GitHub repos: ${response.status}`);
  }

  return response.json() as Promise<
    Array<{ id: number; full_name: string; private: boolean }>
  >;
}

// ============================================
// Slack OAuth
// ============================================

const SLACK_OAUTH_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const SLACK_API_URL = "https://slack.com/api";

/**
 * Get Slack OAuth authorization URL
 * Uses platform credentials - no user configuration needed
 */
export function getSlackAuthUrl(stateId: string): string | null {
  const credentials = platformCredentials.getSlackApp();
  if (!credentials) {
    logger.error("Slack App not configured");
    return null;
  }

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: getOAuthCallbackUrl("slack"),
    scope: "chat:write,chat:write.public,channels:read,incoming-webhook",
    state: stateId,
  });

  return `${SLACK_OAUTH_URL}?${params.toString()}`;
}

/**
 * Exchange Slack authorization code for access token
 * Uses platform credentials
 */
export async function exchangeSlackCode(
  code: string
): Promise<SlackAuthResponse> {
  const credentials = platformCredentials.getSlackApp();
  if (!credentials) {
    throw new Error("Slack App not configured");
  }

  const response = await fetch(SLACK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: getOAuthCallbackUrl("slack"),
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as SlackAuthResponse;

  if (!data.ok) {
    throw new Error(
      `Slack OAuth error: ${(data as unknown as { error: string }).error}`
    );
  }

  return data;
}

/**
 * Get Slack channels for workspace
 */
export async function getSlackChannels(
  accessToken: string
): Promise<Array<{ id: string; name: string; is_private: boolean }>> {
  const response = await fetch(
    `${SLACK_API_URL}/conversations.list?types=public_channel,private_channel&limit=200`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get Slack channels: ${response.status}`);
  }

  const data = (await response.json()) as {
    channels?: Array<{ id: string; name: string; is_private: boolean }>;
  };
  return data.channels || [];
}

/**
 * Send test message to Slack channel
 */
export async function sendSlackTestMessage(
  accessToken: string,
  channel: string
): Promise<boolean> {
  const response = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text: "🔍 Buglens integration connected! You'll receive RCA notifications here.",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🔍 *Buglens Integration Connected*\n\nYou'll receive Root Cause Analysis notifications in this channel when errors are detected.",
          },
        },
      ],
    }),
  });

  const data = (await response.json()) as { ok?: boolean };
  return data.ok === true;
}

// ============================================
// Microsoft Teams OAuth
// ============================================

/**
 * Get Microsoft Teams OAuth authorization URL
 * Uses platform credentials - no user configuration needed
 */
export function getTeamsAuthUrl(stateId: string): string | null {
  const credentials = platformCredentials.getTeamsOAuth();
  if (!credentials) {
    logger.error("Teams App not configured");
    return null;
  }

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: getOAuthCallbackUrl("teams"),
    response_type: "code",
    scope: "https://graph.microsoft.com/.default offline_access",
    state: stateId,
  });

  return `https://login.microsoftonline.com/${credentials.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * Exchange Teams authorization code for access token
 * Uses platform credentials
 */
export async function exchangeTeamsCode(
  code: string
): Promise<OAuthTokenResponse> {
  const credentials = platformCredentials.getTeamsOAuth();
  if (!credentials) {
    throw new Error("Teams App not configured");
  }

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
        code,
        redirect_uri: getOAuthCallbackUrl("teams"),
        grant_type: "authorization_code",
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Teams token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as OAuthTokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (data.error) {
    throw new Error(
      `Teams OAuth error: ${data.error_description || data.error}`
    );
  }

  return data;
}

// ============================================
// Jira OAuth
// ============================================

const JIRA_OAUTH_URL = "https://auth.atlassian.com/authorize";
const JIRA_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const JIRA_API_URL = "https://api.atlassian.com";

/**
 * Get Jira OAuth authorization URL
 * Uses platform credentials - no user configuration needed
 */
export function getJiraAuthUrl(stateId: string): string | null {
  const credentials = platformCredentials.getJiraOAuth();
  if (!credentials) {
    logger.error("Jira App not configured");
    return null;
  }

  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: credentials.clientId,
    redirect_uri: getOAuthCallbackUrl("jira"),
    scope: "read:jira-work write:jira-work read:jira-user offline_access",
    response_type: "code",
    state: stateId,
    prompt: "consent",
  });

  return `${JIRA_OAUTH_URL}?${params.toString()}`;
}

/**
 * Exchange Jira authorization code for access token
 * Uses platform credentials
 */
export async function exchangeJiraCode(
  code: string
): Promise<OAuthTokenResponse> {
  const credentials = platformCredentials.getJiraOAuth();
  if (!credentials) {
    throw new Error("Jira App not configured");
  }

  const response = await fetch(JIRA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: getOAuthCallbackUrl("jira"),
    }),
  });

  if (!response.ok) {
    throw new Error(`Jira token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as OAuthTokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (data.error) {
    throw new Error(
      `Jira OAuth error: ${data.error_description || data.error}`
    );
  }

  return data;
}

/**
 * Get accessible Jira resources (sites/projects)
 */
export async function getJiraResources(
  accessToken: string
): Promise<Array<{ id: string; name: string; url: string }>> {
  const response = await fetch(
    `${JIRA_API_URL}/oauth/token/accessible-resources`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get Jira resources: ${response.status}`);
  }

  return response.json() as Promise<
    Array<{ id: string; name: string; url: string }>
  >;
}

// ============================================
// Integration Storage
// ============================================

/**
 * Save integration to database.
 *
 * Two-tier storage:
 * - publicConfig is persisted plaintext in the `config` column for fast reads
 *   (slugs, URLs, IDs, anything an admin can see in the dashboard).
 * - secrets is merged with publicConfig, encrypted, and stored in
 *   `encrypted_tokens`. Sensitive fields (API tokens, refresh tokens) MUST go
 *   here so they never appear in plaintext on disk or in admin tooling.
 *
 * Reads:
 * - For non-sensitive fields, query the `config` column directly.
 * - For secrets, use getIntegrationSecrets() which decrypts encrypted_tokens.
 */
export async function saveIntegration(
  orgId: string,
  type: string,
  publicConfig: Record<string, unknown>,
  secrets: Record<string, unknown> = {}
): Promise<string> {
  // Encrypted blob carries both public + secret fields so callers can decrypt
  // everything in one shot. The plaintext `config` column carries public-only.
  const fullConfig = { ...publicConfig, ...secrets };
  const encryptedConfig = encryptJsonForOrg(fullConfig, orgId);

  const existing = await query<{ id: string }>(
    `SELECT id FROM integrations WHERE org_id = $1 AND type = $2`,
    [orgId, type]
  );

  let integrationId: string;

  if (existing.rows.length > 0) {
    integrationId = existing.rows[0].id;
    await transaction(orgId, async (client) => {
      await client.query(
        `UPDATE integrations
         SET config = $1,
             encrypted_tokens = $2,
             is_active = true,
             last_verified_at = NOW(),
             updated_at = NOW()
         WHERE id = $3 AND org_id = $4`,
        [
          publicConfig,
          JSON.stringify(encryptedConfig),
          integrationId,
          orgId,
        ]
      );
    });
    logger.info({ integrationId, type, orgId }, "Integration updated");
  } else {
    integrationId = crypto.randomUUID();
    await transaction(orgId, async (client) => {
      await client.query(
        `INSERT INTO integrations (id, org_id, type, config, encrypted_tokens, is_active, last_verified_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW(), NOW())`,
        [
          integrationId,
          orgId,
          type,
          publicConfig,
          JSON.stringify(encryptedConfig),
        ]
      );
    });
    logger.info({ integrationId, type, orgId }, "Integration created");
  }

  return integrationId;
}

/**
 * Decrypt and return the secrets stored in an integration's encrypted_tokens
 * column. Returns null when the integration doesn't exist, isn't active, or
 * has no encrypted blob.
 */
export async function getIntegrationSecrets(
  orgId: string,
  type: string
): Promise<Record<string, unknown> | null> {
  const result = await query<{ encrypted_tokens: unknown }>(
    `SELECT encrypted_tokens FROM integrations
     WHERE org_id = $1 AND type = $2 AND is_active = true
     ORDER BY updated_at DESC
     LIMIT 1`,
    [orgId, type]
  );

  if (result.rows.length === 0 || !result.rows[0].encrypted_tokens) {
    return null;
  }

  try {
    const raw = result.rows[0].encrypted_tokens;
    const parsed: EncryptedData =
      typeof raw === "string" ? (JSON.parse(raw) as EncryptedData) : (raw as EncryptedData);
    return decryptJsonForOrg<Record<string, unknown>>(parsed, orgId);
  } catch (err) {
    logger.warn(
      { err, type, orgId },
      "Failed to decrypt integration secrets"
    );
    return null;
  }
}

// ============================================
// GitHub App Installation
// ============================================

/**
 * Get GitHub App installation URL
 * Users click this to install the Buglens GitHub App
 */
export function getGitHubAppInstallUrl(stateId: string): string | null {
  const appConfig = platformCredentials.getGitHubApp();
  if (!appConfig) {
    logger.error("GitHub App not configured");
    return null;
  }

  // GitHub App installation URL format
  const url = new URL(
    `https://github.com/apps/${appConfig.appName}/installations/new`
  );
  url.searchParams.set("state", stateId);

  return url.toString();
}

/**
 * Get installation access token for a GitHub App installation
 * This is needed to make API calls on behalf of the installation
 */
export async function getGitHubAppInstallationToken(
  installationId: number
): Promise<{ token: string; expiresAt: Date } | null> {
  const appConfig = platformCredentials.getGitHubApp();
  if (!appConfig?.privateKey) {
    logger.error("GitHub App private key not configured");
    return null;
  }

  try {
    // Generate JWT for GitHub App authentication
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60, // Issued 60 seconds ago to account for clock drift
      exp: now + 10 * 60, // Expires in 10 minutes
      iss: appConfig.appId,
    };

    // Sign JWT with RS256 algorithm
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT" })
    ).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    // Normalize line endings — DO App Platform may store env vars with \r\n or literal \n
    const normalizedKey = appConfig.privateKey
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();

    // Explicitly declare format+type so OpenSSL 3 can decode GitHub's PKCS#1 RSA keys
    const privateKeyObject = crypto.createPrivateKey({
      key: normalizedKey,
      format: "pem",
      type: "pkcs1",
    });
    const signature = crypto
      .createSign("RSA-SHA256")
      .update(`${header}.${body}`)
      .sign(privateKeyObject, "base64url");

    const jwt = `${header}.${body}.${signature}`;

    // Exchange JWT for installation access token
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error(
        { status: response.status, error },
        "Failed to get installation token"
      );
      return null;
    }

    const data = (await response.json()) as {
      token: string;
      expires_at: string;
    };

    return {
      token: data.token,
      expiresAt: new Date(data.expires_at),
    };
  } catch (error) {
    logger.error({ error }, "GitHub App installation token error");
    return null;
  }
}

/**
 * Immediately fetch and register repositories for a GitHub App installation.
 * Called right after the OAuth callback so repos are available without waiting for webhooks.
 */
export async function syncGitHubAppRepos(
  installationId: number,
  orgId: string
): Promise<void> {
  logger.info({ installationId, orgId }, "Repo sync: starting");

  const tokenResult = await getGitHubAppInstallationToken(installationId);
  if (!tokenResult) {
    logger.warn({ installationId, orgId }, "Repo sync: no installation token — private key missing or JWT failed");
    return;
  }
  logger.info({ installationId, orgId }, "Repo sync: token obtained, fetching repos from GitHub");

  try {
    const repos: { full_name: string; name: string; private: boolean; default_branch: string }[] = [];
    let page = 1;

    while (true) {
      const response = await fetch(
        `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `token ${tokenResult.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      if (!response.ok) {
        const body = await response.text();
        logger.error({ status: response.status, body, installationId }, "Repo sync: GitHub API error listing repos");
        break;
      }

      const data = (await response.json()) as {
        total_count: number;
        repositories: { full_name: string; name: string; private: boolean; default_branch: string }[];
      };

      logger.info({ page, fetched: data.repositories.length, total: data.total_count, installationId }, "Repo sync: page fetched");
      repos.push(...data.repositories);
      if (repos.length >= data.total_count) break;
      page++;
    }

    if (repos.length === 0) {
      logger.warn({ installationId, orgId }, "Repo sync: GitHub returned 0 repositories — check App installation scope");
      return;
    }

    logger.info({ installationId, orgId, repoCount: repos.length }, "Repo sync: inserting repos into DB");

    const installationIdText = installationId.toString();
    const values = repos.flatMap((repo) => {
      const [owner, name] = repo.full_name.split("/", 2);
      return [orgId, owner ?? repo.full_name, name ?? repo.name, repo.full_name, repo.default_branch ?? "main", installationIdText];
    });
    const placeholders = repos
      .map((_, i) => {
        const o = i * 6;
        return `($${o + 1}, 'github', $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, 'auto-registered', true)`;
      })
      .join(", ");

    await transaction(orgId, async (client) => {
      await client.query(
        `INSERT INTO repos (org_id, provider, owner, name, full_name, default_branch, installation_id, secret_id, is_active)
         VALUES ${placeholders}
         ON CONFLICT (org_id, provider, full_name) DO UPDATE SET
           installation_id = EXCLUDED.installation_id,
           default_branch = EXCLUDED.default_branch,
           is_active = true,
           updated_at = NOW()`,
        values
      );
    });

    logger.info({ orgId, installationId, repoCount: repos.length }, "Repo sync: complete");
  } catch (error) {
    logger.error({ error, installationId, orgId }, "Repo sync: failed");
  }
}

/**
 * Process GitHub App installation callback
 */
export async function processGitHubAppInstallation(
  installationId: number,
  orgId: string,
  account: {
    login: string;
    id: number;
    type: "User" | "Organization";
    avatar_url?: string;
  },
  permissions: Record<string, string>,
  repositorySelection: "all" | "selected"
): Promise<string | null> {
  const installation: GitHubInstallation = {
    installationId,
    permissions,
    repositorySelection,
    account: {
      id: account.id,
      login: account.login,
      type: account.type,
      avatarUrl: account.avatar_url,
    },
  };

  try {
    const integrationId = await storeGitHubInstallation(orgId, installation);
    // Proactively fetch repos — don't wait for the webhook which may arrive late or not at all
    syncGitHubAppRepos(installationId, orgId).catch((err) =>
      logger.error({ err, orgId, installationId }, "Background repo sync failed")
    );
    logger.info({ orgId, installationId }, "GitHub App installation processed");
    return integrationId;
  } catch (error) {
    logger.error({ error, orgId }, "Failed to store GitHub App installation");
    return null;
  }
}

/**
 * Process Slack OAuth callback and store workspace connection
 */
export async function processSlackInstallation(
  slackResponse: SlackAuthResponse,
  orgId: string
): Promise<string | null> {
  const workspace: SlackWorkspace = {
    teamId: slackResponse.team.id,
    teamName: slackResponse.team.name,
    botUserId: slackResponse.bot_user_id,
    accessToken: slackResponse.access_token,
    scope: slackResponse.scope,
    incomingWebhook: slackResponse.incoming_webhook
      ? {
          channel: slackResponse.incoming_webhook.channel,
          channelId: slackResponse.incoming_webhook.channel_id,
          configurationUrl: "", // Not provided by Slack
          url: slackResponse.incoming_webhook.url,
        }
      : undefined,
  };

  try {
    const integrationId = await storeSlackWorkspace(orgId, workspace);
    logger.info(
      { orgId, teamId: slackResponse.team.id },
      "Slack workspace installation processed"
    );
    return integrationId;
  } catch (error) {
    logger.error({ error, orgId }, "Failed to store Slack workspace");
    return null;
  }
}

// ============================================
// Available Providers Check
// ============================================

/**
 * Get available integration providers (configured at platform level)
 */
export function getAvailableIntegrationProviders(): IntegrationProvider[] {
  return platformCredentials
    .getConfiguredProviders()
    .filter((p): p is IntegrationProvider =>
      ["github", "github_app", "slack", "teams", "jira", "sentry"].includes(p)
    );
}

/**
 * Check if a specific integration provider is available
 */
export function isIntegrationProviderAvailable(
  provider: IntegrationProvider
): boolean {
  return platformCredentials.isConfigured(provider);
}
