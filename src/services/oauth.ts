/**
 * OAuth Service
 *
 * Handles OAuth flows for GitHub, Slack, and other integrations.
 * Manages state generation, token exchange, and secure storage.
 */

import crypto from "crypto";
import { logger } from "../utils/logger.js";
import { config } from "../utils/config.js";
import { query, transaction } from "../db/client.js";

// ============================================
// Types
// ============================================

export interface OAuthState {
  orgId: string;
  integrationType: string;
  returnUrl: string;
  nonce: string;
  createdAt: number;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
  refresh_token?: string;
  expires_in?: number;
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

/**
 * Generate a secure OAuth state token
 */
export function generateOAuthState(
  orgId: string,
  integrationType: string,
  returnUrl: string
): string {
  const stateId = crypto.randomBytes(32).toString("hex");
  const state: OAuthState = {
    orgId,
    integrationType,
    returnUrl,
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
 */
export function getGitHubAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.GITHUB_APP_ID || "",
    redirect_uri: `${getBaseUrl()}/api/integrations/github/callback`,
    scope: "read:user repo",
    state,
  });

  return `${GITHUB_OAUTH_URL}?${params.toString()}`;
}

/**
 * Exchange GitHub authorization code for access token
 */
export async function exchangeGitHubCode(
  code: string
): Promise<OAuthTokenResponse> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.GITHUB_APP_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(
      `GitHub OAuth error: ${data.error_description || data.error}`
    );
  }

  return data as OAuthTokenResponse;
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

  return response.json();
}

// ============================================
// Slack OAuth
// ============================================

const SLACK_OAUTH_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const SLACK_API_URL = "https://slack.com/api";

/**
 * Get Slack OAuth authorization URL
 */
export function getSlackAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.SLACK_CLIENT_ID || "",
    redirect_uri: `${getBaseUrl()}/api/integrations/slack/callback`,
    scope: "chat:write,chat:write.public,channels:read,incoming-webhook",
    state,
  });

  return `${SLACK_OAUTH_URL}?${params.toString()}`;
}

/**
 * Exchange Slack authorization code for access token
 */
export async function exchangeSlackCode(
  code: string
): Promise<SlackAuthResponse> {
  const response = await fetch(SLACK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.SLACK_CLIENT_ID || "",
      client_secret: config.SLACK_CLIENT_SECRET || "",
      code,
      redirect_uri: `${getBaseUrl()}/api/integrations/slack/callback`,
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

  const data = await response.json();
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

  const data = await response.json();
  return data.ok === true;
}

// ============================================
// Microsoft Teams OAuth
// ============================================

/**
 * Get Microsoft Teams OAuth authorization URL
 */
export function getTeamsAuthUrl(state: string): string {
  const tenantId = config.TEAMS_TENANT_ID || "common";
  const params = new URLSearchParams({
    client_id: config.TEAMS_CLIENT_ID || "",
    redirect_uri: `${getBaseUrl()}/api/integrations/teams/callback`,
    response_type: "code",
    scope: "https://graph.microsoft.com/.default offline_access",
    state,
  });

  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * Exchange Teams authorization code for access token
 */
export async function exchangeTeamsCode(
  code: string
): Promise<OAuthTokenResponse> {
  const tenantId = config.TEAMS_TENANT_ID || "common";
  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: config.TEAMS_CLIENT_ID || "",
        client_secret: config.TEAMS_CLIENT_SECRET || "",
        code,
        redirect_uri: `${getBaseUrl()}/api/integrations/teams/callback`,
        grant_type: "authorization_code",
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Teams token exchange failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(
      `Teams OAuth error: ${data.error_description || data.error}`
    );
  }

  return data as OAuthTokenResponse;
}

// ============================================
// Jira OAuth
// ============================================

const JIRA_OAUTH_URL = "https://auth.atlassian.com/authorize";
const JIRA_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const JIRA_API_URL = "https://api.atlassian.com";

/**
 * Get Jira OAuth authorization URL
 */
export function getJiraAuthUrl(state: string): string {
  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: config.JIRA_CLIENT_ID || "",
    redirect_uri: `${getBaseUrl()}/api/integrations/jira/callback`,
    scope: "read:jira-work write:jira-work read:jira-user offline_access",
    response_type: "code",
    state,
    prompt: "consent",
  });

  return `${JIRA_OAUTH_URL}?${params.toString()}`;
}

/**
 * Exchange Jira authorization code for access token
 */
export async function exchangeJiraCode(
  code: string
): Promise<OAuthTokenResponse> {
  const response = await fetch(JIRA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.JIRA_CLIENT_ID,
      client_secret: config.JIRA_CLIENT_SECRET,
      code,
      redirect_uri: `${getBaseUrl()}/api/integrations/jira/callback`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Jira token exchange failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(
      `Jira OAuth error: ${data.error_description || data.error}`
    );
  }

  return data as OAuthTokenResponse;
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

  return response.json();
}

// ============================================
// Integration Storage
// ============================================

/**
 * Save integration to database
 */
export async function saveIntegration(
  orgId: string,
  type: string,
  config: Record<string, unknown>
): Promise<string> {
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
             is_active = true,
             last_verified_at = NOW(),
             updated_at = NOW()
         WHERE id = $2 AND org_id = $3`,
        [config, integrationId, orgId]
      );
    });
    logger.info({ integrationId, type, orgId }, "Integration updated");
  } else {
    integrationId = crypto.randomUUID();
    await transaction(orgId, async (client) => {
      await client.query(
        `INSERT INTO integrations (id, org_id, type, config, is_active, last_verified_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, NOW(), NOW(), NOW())`,
        [integrationId, orgId, type, config]
      );
    });
    logger.info({ integrationId, type, orgId }, "Integration created");
  }

  return integrationId;
}

// ============================================
// Helpers
// ============================================

/**
 * Get base URL for OAuth callbacks
 */
function getBaseUrl(): string {
  if (config.NODE_ENV === "production") {
    return process.env.BASE_URL || "https://api.buglens.com";
  }
  return `http://localhost:${config.PORT}`;
}
