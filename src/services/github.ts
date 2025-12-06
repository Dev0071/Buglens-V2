import { App, Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import {
  getCachedInstallationToken,
  cacheInstallationToken,
  incrementRateLimit,
  getRateLimitCount,
  buildGitHubRateLimitKey,
} from "../db/redis.js";
import { pool } from "../db/client.js";
import type {
  GitHubFileContent,
  GitHubRepository,
  GitHubCommit,
  GitHubRateLimitResponse,
  RepoConfig,
} from "../types/github.js";

// ============================================
// Rate Limit Configuration
// ============================================

const RATE_LIMITS_PER_PLAN = {
  free: 500,
  pro: 2000,
  enterprise: 5000,
} as const;

type Plan = keyof typeof RATE_LIMITS_PER_PLAN;

// ============================================
// GitHub App Client
// ============================================

let githubApp: App | null = null;

/**
 * Initialize GitHub App instance
 * Requires GITHUB_APP_ID and private key
 */
async function getGitHubApp(): Promise<App> {
  if (githubApp) {
    return githubApp;
  }

  if (!config.GITHUB_APP_ID) {
    throw new Error("GITHUB_APP_ID is required for GitHub integration");
  }

  // Get private key from Secrets Manager or env
  let privateKey: string;

  if (config.GITHUB_APP_PRIVATE_KEY_SECRET_ID) {
    // TODO: Fetch from AWS Secrets Manager
    // For now, fall back to environment variable
    privateKey = process.env.GITHUB_APP_PRIVATE_KEY || "";
  } else {
    privateKey = process.env.GITHUB_APP_PRIVATE_KEY || "";
  }

  if (!privateKey) {
    throw new Error(
      "GitHub App private key not found. Set GITHUB_APP_PRIVATE_KEY or configure Secrets Manager."
    );
  }

  // Normalize PEM format (replace escaped newlines)
  const normalizedKey = privateKey.replace(/\\n/g, "\n");

  githubApp = new App({
    appId: config.GITHUB_APP_ID,
    privateKey: normalizedKey,
    webhooks: {
      secret: config.GITHUB_WEBHOOK_SECRET || "development-secret",
    },
  });

  logger.info({ appId: config.GITHUB_APP_ID }, "GitHub App initialized");
  return githubApp;
}

// ============================================
// Installation Token Management
// ============================================

/**
 * Get an Octokit instance authenticated for a specific installation
 */
export async function getInstallationOctokit(
  installationId: string
): Promise<Octokit> {
  const app = await getGitHubApp();
  return app.getInstallationOctokit(Number(installationId));
}

/**
 * Get installation access token (cached)
 */
export async function getInstallationToken(
  installationId: string
): Promise<string> {
  // Check cache first
  const cached = await getCachedInstallationToken(installationId);
  if (cached) {
    logger.debug({ installationId }, "Using cached installation token");
    return cached;
  }

  // Generate new token using App instance
  await getGitHubApp(); // Ensure app is initialized
  const auth = createAppAuth({
    appId: config.GITHUB_APP_ID!,
    privateKey: (process.env.GITHUB_APP_PRIVATE_KEY || "").replace(
      /\\n/g,
      "\n"
    ),
    installationId: Number(installationId),
  });

  const authResult = await auth({ type: "installation" });
  const token = authResult.token;
  const expiresAt =
    (authResult as { expiresAt?: string }).expiresAt ||
    new Date(Date.now() + 3600000).toISOString();

  // Cache the token
  await cacheInstallationToken(installationId, token, new Date(expiresAt));

  logger.info({ installationId }, "Generated new installation token");
  return token;
}

// ============================================
// Rate Limit Checking
// ============================================

/**
 * Check if org has exceeded GitHub API rate limit
 */
export async function checkGitHubRateLimit(
  orgId: string,
  plan: Plan = "free"
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const key = buildGitHubRateLimitKey(orgId);
  const currentUsage = await getRateLimitCount(key);
  const limit = RATE_LIMITS_PER_PLAN[plan];

  return {
    allowed: currentUsage < limit,
    remaining: Math.max(0, limit - currentUsage),
    limit,
  };
}

/**
 * Increment GitHub API call counter for org
 */
export async function trackGitHubAPICall(orgId: string): Promise<number> {
  const key = buildGitHubRateLimitKey(orgId);
  return incrementRateLimit(key, 3600); // 1 hour window
}

// ============================================
// GitHub API Methods
// ============================================

/**
 * Retry configuration for GitHub API calls
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a GitHub API call with exponential backoff retry
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  context: { operation: string; owner?: string; repo?: string; path?: string }
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      const e = error as { status?: number; message?: string };
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on non-retryable errors
      if (e.status && !RETRY_CONFIG.retryableStatuses.includes(e.status)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === RETRY_CONFIG.maxRetries) {
        logger.error(
          { ...context, attempt, error: e.message },
          "GitHub API call failed after all retries"
        );
        throw error;
      }

      // Calculate exponential backoff delay
      const delay = Math.min(
        RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
        RETRY_CONFIG.maxDelayMs
      );

      logger.warn(
        { ...context, attempt, delay, status: e.status },
        "GitHub API call failed, retrying"
      );

      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError || new Error("Unexpected retry failure");
}

/**
 * Check if a git ref (commit SHA or branch) exists in a repository
 * Uses GitHub's proper commit API endpoint for validation
 */
export async function checkRefExists(
  installationId: string,
  owner: string,
  repo: string,
  ref: string,
  orgId: string
): Promise<boolean> {
  // Check rate limit
  const rateLimit = await checkGitHubRateLimit(orgId);
  if (!rateLimit.allowed) {
    logger.warn(
      { orgId, remaining: rateLimit.remaining },
      "GitHub rate limit exceeded"
    );
    throw new GitHubRateLimitError(
      `GitHub API rate limit exceeded. Remaining: ${rateLimit.remaining}`
    );
  }

  const octokit = await getInstallationOctokit(installationId);

  try {
    // Use the commits endpoint which validates both commits and branch refs
    // GET /repos/{owner}/{repo}/commits/{ref}
    // This is more efficient than fetching file content and works for all repos
    await withRetry(
      () =>
        octokit.rest.repos.getCommit({
          owner,
          repo,
          ref,
        }),
      { operation: "getCommit", owner, repo }
    );

    // Track API call
    await trackGitHubAPICall(orgId);

    return true;
  } catch (error: unknown) {
    const e = error as { status?: number };
    if (e.status === 404 || e.status === 422) {
      // 404 = ref not found, 422 = invalid ref format
      logger.debug({ owner, repo, ref }, "Git ref not found");
      return false;
    }
    // Rethrow other errors
    logger.error({ error, owner, repo, ref }, "Failed to check git ref");
    throw error;
  }
}

/**
 * Fetch file content from GitHub repository
 */
export async function fetchFileContent(
  installationId: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  orgId: string
): Promise<GitHubFileContent | null> {
  // Check rate limit
  const rateLimit = await checkGitHubRateLimit(orgId);
  if (!rateLimit.allowed) {
    logger.warn(
      { orgId, remaining: rateLimit.remaining },
      "GitHub rate limit exceeded"
    );
    throw new GitHubRateLimitError(
      `GitHub API rate limit exceeded. Remaining: ${rateLimit.remaining}`
    );
  }

  const octokit = await getInstallationOctokit(installationId);

  try {
    const response = await withRetry(
      () =>
        octokit.rest.repos.getContent({
          owner,
          repo,
          path,
          ref,
        }),
      { operation: "getContent", owner, repo, path }
    );

    // Track API call
    await trackGitHubAPICall(orgId);

    // Handle file vs directory
    if (Array.isArray(response.data)) {
      logger.warn({ path }, "Path is a directory, not a file");
      return null;
    }

    const data = response.data as GitHubFileContent;

    if (data.type !== "file") {
      logger.warn({ path, type: data.type }, "Path is not a file");
      return null;
    }

    return data;
  } catch (error: unknown) {
    const e = error as { status?: number; message?: string };
    if (e.status === 404) {
      logger.debug({ owner, repo, path, ref }, "File not found");
      return null;
    }
    logger.error({ error, owner, repo, path, ref }, "Failed to fetch file");
    throw error;
  }
}

/**
 * Fetch recent commits for a file
 */
export async function fetchRecentCommits(
  installationId: string,
  owner: string,
  repo: string,
  path: string,
  count: number = 5,
  orgId: string
): Promise<GitHubCommit[]> {
  const rateLimit = await checkGitHubRateLimit(orgId);
  if (!rateLimit.allowed) {
    throw new GitHubRateLimitError("GitHub API rate limit exceeded");
  }

  const octokit = await getInstallationOctokit(installationId);

  try {
    const response = await withRetry(
      () =>
        octokit.rest.repos.listCommits({
          owner,
          repo,
          path,
          per_page: count,
        }),
      { operation: "listCommits", owner, repo, path }
    );

    await trackGitHubAPICall(orgId);

    return response.data as GitHubCommit[];
  } catch (error: unknown) {
    const e = error as { status?: number };
    if (e.status === 404) {
      return [];
    }
    logger.error({ error, owner, repo, path }, "Failed to fetch commits");
    throw error;
  }
}

/**
 * List repositories accessible to an installation
 */
export async function listInstallationRepos(
  installationId: string,
  orgId: string
): Promise<GitHubRepository[]> {
  const rateLimit = await checkGitHubRateLimit(orgId);
  if (!rateLimit.allowed) {
    throw new GitHubRateLimitError("GitHub API rate limit exceeded");
  }

  const octokit = await getInstallationOctokit(installationId);

  try {
    const repos: GitHubRepository[] = [];

    // Paginate through all repos
    for await (const response of octokit.paginate.iterator(
      octokit.rest.apps.listReposAccessibleToInstallation,
      { per_page: 100 }
    )) {
      await trackGitHubAPICall(orgId);
      repos.push(...(response.data as unknown as GitHubRepository[]));
    }

    return repos;
  } catch (error) {
    logger.error({ error, installationId }, "Failed to list repos");
    throw error;
  }
}

/**
 * Get GitHub API rate limit status
 */
export async function getGitHubRateLimitStatus(
  installationId: string
): Promise<GitHubRateLimitResponse> {
  const octokit = await getInstallationOctokit(installationId);

  const response = await octokit.rest.rateLimit.get();
  return response.data as GitHubRateLimitResponse;
}

// ============================================
// Repository Management
// ============================================

/**
 * Save repository configuration to database
 */
export async function saveRepoConfig(
  orgId: string,
  repo: GitHubRepository,
  installationId: string
): Promise<RepoConfig> {
  const result = await pool.query<RepoConfig>(
    `
    INSERT INTO repos (org_id, provider, owner, name, full_name, default_branch, installation_id, is_active)
    VALUES ($1, 'github', $2, $3, $4, $5, $6, true)
    ON CONFLICT (org_id, provider, full_name) DO UPDATE SET
      default_branch = EXCLUDED.default_branch,
      installation_id = EXCLUDED.installation_id,
      is_active = true,
      updated_at = NOW()
    RETURNING *
  `,
    [
      orgId,
      repo.owner.login,
      repo.name,
      repo.full_name,
      repo.default_branch,
      installationId,
    ]
  );

  return result.rows[0];
}

/**
 * Get repository by full name for an organization
 */
export async function getRepoByFullName(
  orgId: string,
  fullName: string
): Promise<RepoConfig | null> {
  const result = await pool.query<RepoConfig>(
    `SELECT * FROM repos WHERE org_id = $1 AND full_name = $2 AND is_active = true`,
    [orgId, fullName]
  );

  return result.rows[0] || null;
}

/**
 * Get all active repos for an organization
 */
export async function getOrgRepos(orgId: string): Promise<RepoConfig[]> {
  const result = await pool.query<RepoConfig>(
    `SELECT * FROM repos WHERE org_id = $1 AND is_active = true ORDER BY full_name`,
    [orgId]
  );

  return result.rows;
}

// ============================================
// Error Classes
// ============================================

export class GitHubRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubRateLimitError";
  }
}

export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Decode base64 file content from GitHub API
 */
export function decodeFileContent(content: string): string {
  return Buffer.from(content, "base64").toString("utf-8");
}

/**
 * Parse repository full name into owner and repo
 */
export function parseRepoFullName(fullName: string): {
  owner: string;
  repo: string;
} {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repository name: ${fullName}`);
  }
  return { owner, repo };
}

/**
 * Detect language from file path
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();

  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    h: "c",
    hpp: "cpp",
    php: "php",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    sql: "sql",
    sh: "shell",
    bash: "shell",
  };

  return languageMap[ext || ""] || "text";
}
