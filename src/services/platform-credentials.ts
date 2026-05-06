/**
 * Platform Credentials Service
 *
 * Manages OAuth application credentials that Buglens owns.
 * These are NOT user-provided - they are platform secrets.
 *
 * Architecture Philosophy:
 * ========================
 * In a multi-tenant SaaS like Buglens:
 *
 * 1. PLATFORM owns the OAuth Apps (Google, GitHub, Slack, etc.)
 * 2. USERS just click "Sign in with Google" or "Connect GitHub"
 * 3. NO environment variables required from users
 *
 * How it works:
 * - Buglens creates ONE Google OAuth App, ONE GitHub App, ONE Slack App
 * - These credentials are stored as platform secrets (env vars or AWS Secrets Manager)
 * - When users authenticate, they're authorizing against Buglens's apps
 * - Buglens stores the resulting tokens encrypted per-organization
 *
 * This is how Vercel, Netlify, Linear, etc. all work.
 * Users don't create OAuth apps - the platform owns them.
 */

import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { getOAuthCallbackUrl } from "../utils/url-helpers.js";

// ============================================
// Types
// ============================================

export interface OAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

export interface GitHubAppCredentials {
  appId: string;
  appName: string;
  privateKey: string;
  webhookSecret?: string;
}

export interface SlackAppCredentials {
  clientId: string;
  clientSecret: string;
  signingSecret: string;
}

export interface TeamsAppCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

export interface JiraAppCredentials {
  clientId: string;
  clientSecret: string;
}

export type OAuthProvider = "google" | "github";
export type IntegrationProvider =
  | "github"
  | "github_app"
  | "slack"
  | "jira"
  | "teams"
  | "sentry";
export type ProviderType = OAuthProvider | IntegrationProvider;

// ============================================
// Platform Credential Store
// ============================================

/**
 * Platform credentials are loaded from environment variables.
 * In production, these come from AWS Secrets Manager or similar.
 *
 * These are PLATFORM secrets, not user secrets.
 * Users never need to provide these.
 */
class PlatformCredentialsService {
  /**
   * Check if a specific OAuth provider is configured
   */
  isConfigured(provider: ProviderType): boolean {
    switch (provider) {
      case "google":
        return !!(
          config.GOOGLE_OAUTH_CLIENT_ID && config.GOOGLE_OAUTH_CLIENT_SECRET
        );
      case "github":
        return !!(
          config.GITHUB_OAUTH_CLIENT_ID && config.GITHUB_OAUTH_CLIENT_SECRET
        );
      case "github_app":
        // Only app ID + name needed for the install URL; private key is checked separately at token exchange time
        return !!(config.GITHUB_APP_ID && config.GITHUB_APP_NAME);
      case "slack":
        return !!(config.SLACK_CLIENT_ID && config.SLACK_CLIENT_SECRET);
      case "jira":
        return !!(config.JIRA_CLIENT_ID && config.JIRA_CLIENT_SECRET);
      case "teams":
        return !!(config.TEAMS_CLIENT_ID && config.TEAMS_CLIENT_SECRET);
      case "sentry":
        return true; // Sentry uses webhooks, always available
      default:
        return false;
    }
  }

  /**
   * Get Google OAuth credentials (for sign-in)
   */
  getGoogleOAuth(): OAuthAppCredentials | null {
    if (!this.isConfigured("google")) {
      return null;
    }
    return {
      clientId: config.GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET!,
    };
  }

  /**
   * Get GitHub OAuth credentials (for sign-in)
   */
  getGitHubOAuth(): OAuthAppCredentials | null {
    if (!this.isConfigured("github")) {
      return null;
    }
    return {
      clientId: config.GITHUB_OAUTH_CLIENT_ID!,
      clientSecret: config.GITHUB_OAUTH_CLIENT_SECRET!,
    };
  }

  /**
   * Get GitHub App credentials (for repo integration)
   * GitHub App is different from OAuth App:
   * - OAuth App: For user authentication
   * - GitHub App: For repo/org integration with installation tokens
   */
  getGitHubApp(): GitHubAppCredentials | null {
    if (!config.GITHUB_APP_ID) {
      return null;
    }

    // Accept plain PEM or base64-encoded PEM (required for DO App Platform which
    // can't store multi-line env vars). Also normalize escaped \n → real newlines
    // since DO sometimes stores them as literals.
    const rawKey = process.env.GITHUB_APP_PRIVATE_KEY_BASE64
      ? Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64, "base64").toString("utf8")
      : (process.env.GITHUB_APP_PRIVATE_KEY || "");
    const privateKey = rawKey
      .replace(/\\n/g, "\n")       // literal \n → real newline
      .replace(/\r\n/g, "\n")       // CRLF → LF
      .replace(/\r/g, "\n")         // bare CR → LF
      .trim()
      .replace(/^["']|["']$/g, "")  // strip wrapping quotes if present
      .trim();
    const appName = config.GITHUB_APP_NAME || "buglens";

    return {
      appId: config.GITHUB_APP_ID,
      appName,
      privateKey,
      webhookSecret: config.GITHUB_WEBHOOK_SECRET,
    };
  }

  /**
   * Get Slack App credentials (for workspace integration)
   */
  getSlackApp(): SlackAppCredentials | null {
    if (!this.isConfigured("slack")) {
      return null;
    }
    return {
      clientId: config.SLACK_CLIENT_ID!,
      clientSecret: config.SLACK_CLIENT_SECRET!,
      signingSecret: process.env.SLACK_SIGNING_SECRET || "",
    };
  }

  /**
   * Get Jira OAuth credentials
   */
  getJiraOAuth(): OAuthAppCredentials | null {
    if (!this.isConfigured("jira")) {
      return null;
    }
    return {
      clientId: config.JIRA_CLIENT_ID!,
      clientSecret: config.JIRA_CLIENT_SECRET!,
    };
  }

  /**
   * Get Jira App credentials (alias for getJiraOAuth)
   */
  getJiraApp(): JiraAppCredentials | null {
    return this.getJiraOAuth();
  }

  /**
   * Get Microsoft Teams OAuth credentials
   */
  getTeamsOAuth(): TeamsAppCredentials | null {
    if (!this.isConfigured("teams")) {
      return null;
    }
    return {
      clientId: config.TEAMS_CLIENT_ID!,
      clientSecret: config.TEAMS_CLIENT_SECRET!,
      tenantId: config.TEAMS_TENANT_ID || "common",
    };
  }

  /**
   * Get Microsoft Teams App credentials (alias for getTeamsOAuth)
   */
  getTeamsApp(): TeamsAppCredentials | null {
    return this.getTeamsOAuth();
  }

  /**
   * Get all configured providers (for UI display)
   */
  getConfiguredProviders(): ProviderType[] {
    const providers: ProviderType[] = [];
    if (this.isConfigured("google")) providers.push("google");
    if (this.isConfigured("github")) providers.push("github");
    if (this.isConfigured("github_app")) providers.push("github_app");
    if (this.isConfigured("slack")) providers.push("slack");
    if (this.isConfigured("jira")) providers.push("jira");
    if (this.isConfigured("teams")) providers.push("teams");
    if (this.isConfigured("sentry")) providers.push("sentry");
    return providers;
  }

  /**
   * Log which providers are configured (for debugging)
   */
  logConfiguredProviders(): void {
    const providers = this.getConfiguredProviders();
    if (providers.length === 0) {
      logger.warn(
        "No OAuth providers configured. Users won't be able to use social login or integrations."
      );
    } else {
      logger.info({ providers }, "Configured OAuth providers");
    }
  }

  /**
   * Get the OAuth callback URL for a provider
   */
  getCallbackUrl(
    provider: ProviderType,
    type: "auth" | "integration" = "auth"
  ): string {
    return getOAuthCallbackUrl(provider, type);
  }

  /**
   * Get the frontend URL for redirects after OAuth
   */
  getFrontendUrl(): string {
    return process.env.FRONTEND_URL || "http://localhost:3001";
  }
}

// Singleton instance
export const platformCredentials = new PlatformCredentialsService();

// Log configured providers on startup
platformCredentials.logConfiguredProviders();

