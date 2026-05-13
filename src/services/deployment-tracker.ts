import { query, transaction } from "../db/client.js";
import { logger } from "../utils/logger.js";
import { getInstallationToken } from "./github.js";
import type {
  Deployment,
  DeploymentMatch,
  TrackDeployInput,
} from "../types/deployment.js";

// ============================================
// Pure helpers
// ============================================

/** Normalise a SHA — trims whitespace, lowercases. */
export function normaliseSha(sha: string): string {
  return sha.trim().toLowerCase();
}

/** True when the SHA looks like a full or abbreviated git hash. */
export function isValidSha(sha: string): boolean {
  return /^[a-f0-9]{7,40}$/i.test(sha.trim());
}

// ============================================
// Database writes
// ============================================

/**
 * Record a deployment event.
 *
 * When a newer deploy for the same org+repo+env arrives we mark previous
 * active records as "superseded" so history stays accurate and the LIMIT 1
 * lookup always finds the right row.
 */
export async function recordDeployment(
  orgId: string,
  input: TrackDeployInput,
  source: "api" | "github_deployments_api" = "api"
): Promise<Deployment> {
  const sha = normaliseSha(input.sha);
  const deployedAt = input.deployed_at ? new Date(input.deployed_at) : new Date();

  return transaction(orgId, async (client) => {
    // Mark any current active deployment for same repo+env as superseded
    await client.query(
      `UPDATE deployments
         SET status = 'superseded'
       WHERE org_id = $1
         AND repo_full_name = $2
         AND environment = $3
         AND status = 'active'`,
      [orgId, input.repo, input.environment]
    );

    const result = await client.query<Deployment>(
      `INSERT INTO deployments
         (org_id, repo_full_name, commit_sha, branch, environment,
          deployed_at, status, source, deployer, deploy_url, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10)
       RETURNING *`,
      [
        orgId,
        input.repo,
        sha,
        input.branch ?? null,
        input.environment,
        deployedAt,
        source,
        input.deployer ?? null,
        input.deploy_url ?? null,
        JSON.stringify(input.metadata ?? {}),
      ]
    );

    return result.rows[0];
  });
}

// ============================================
// Database reads
// ============================================

/**
 * Find the commit SHA that was deployed for a given repo+environment at or
 * before the error timestamp.
 *
 * Returns null when no deployment record exists — callers fall back to the
 * next resolution strategy (Sentry release API, release tag parsing, etc.).
 */
export async function resolveDeploymentAtTime(
  orgId: string,
  repoFullName: string,
  environment: string,
  errorTimestamp: Date
): Promise<DeploymentMatch | null> {
  const result = await query<Deployment>(
    `SELECT commit_sha, repo_full_name, environment, deployed_at, source
       FROM deployments
      WHERE org_id = $1
        AND repo_full_name = $2
        AND environment = $3
        AND deployed_at <= $4
        AND status != 'rolled_back'
      ORDER BY deployed_at DESC
      LIMIT 1`,
    [orgId, repoFullName, environment, errorTimestamp]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    commit_sha:     row.commit_sha,
    repo_full_name: row.repo_full_name,
    environment:    row.environment,
    deployed_at:    row.deployed_at,
    source:         row.source,
  };
}

/**
 * List recent deployments for a repo (used by the dashboard / SDK setup page).
 */
export async function listDeployments(
  orgId: string,
  repoFullName: string,
  limit = 20
): Promise<Deployment[]> {
  const result = await query<Deployment>(
    `SELECT * FROM deployments
      WHERE org_id = $1 AND repo_full_name = $2
      ORDER BY deployed_at DESC
      LIMIT $3`,
    [orgId, repoFullName, limit]
  );
  return result.rows;
}

// ============================================
// GitHub Deployments API sync
// ============================================

interface GitHubDeployment {
  id: number;
  sha: string;
  ref: string;
  environment: string;
  created_at: string;
  statuses_url: string;
  creator: { login: string } | null;
}

interface GitHubDeploymentStatus {
  state: string; // "success" | "failure" | "pending" | ...
}

/**
 * Pull the most recent successful GitHub Deployments for a repo and upsert
 * them into our table.
 *
 * Called when a Sentry event arrives and our table has no match — gives us
 * zero-config coverage for clients deploying via Vercel, Railway, Render,
 * or GitHub Actions (all of which write to the GitHub Deployments API).
 */
export async function syncGitHubDeployments(
  orgId: string,
  installationId: string,
  repoFullName: string,
  environment: string
): Promise<DeploymentMatch | null> {
  try {
    const token = await getInstallationToken(installationId, orgId);
    const [owner, repo] = repoFullName.split("/");

    // Fetch the 5 most recent deployments for this environment
    const deploymentsRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/deployments?environment=${encodeURIComponent(environment)}&per_page=5`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
    );

    if (!deploymentsRes.ok) {
      logger.debug(
        { status: deploymentsRes.status, repoFullName, environment },
        "GitHub Deployments API returned non-200"
      );
      return null;
    }

    const deployments: GitHubDeployment[] = await deploymentsRes.json();

    for (const deployment of deployments) {
      if (!isValidSha(deployment.sha)) continue;

      // Verify the deployment actually succeeded
      const statusRes = await fetch(deployment.statuses_url + "?per_page=1", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });

      if (!statusRes.ok) continue;
      const statuses: GitHubDeploymentStatus[] = await statusRes.json();
      if (statuses[0]?.state !== "success") continue;

      // Upsert into our table so future lookups hit the DB, not GitHub API
      const recorded = await recordDeployment(
        orgId,
        {
          repo:        repoFullName,
          sha:         deployment.sha,
          branch:      deployment.ref,
          environment: deployment.environment,
          deployed_at: deployment.created_at,
          deployer:    deployment.creator?.login ?? undefined,
        },
        "github_deployments_api"
      );

      logger.info(
        { repoFullName, sha: recorded.commit_sha, environment },
        "Synced deployment from GitHub Deployments API"
      );

      return {
        commit_sha:     recorded.commit_sha,
        repo_full_name: recorded.repo_full_name,
        environment:    recorded.environment,
        deployed_at:    recorded.deployed_at,
        source:         "github_deployments_api",
      };
    }

    return null;
  } catch (error) {
    logger.warn({ error, repoFullName, environment }, "GitHub Deployments API sync failed");
    return null;
  }
}

// ============================================
// Main resolver — called by the event extractor
// ============================================

/**
 * Resolve the commit SHA for a Sentry error using the layered strategy:
 *
 *   1. Our deployments table (populated by /track-deploy or GitHub sync)
 *   2. GitHub Deployments API (on-demand sync if table has no match)
 *
 * Returns null if neither source has data — callers fall back to Sentry
 * release tag parsing.
 */
export async function resolveCommitForEvent(params: {
  orgId: string;
  repoFullName: string;
  environment: string;
  errorTimestamp: Date;
  installationId: string | null;
}): Promise<DeploymentMatch | null> {
  const { orgId, repoFullName, environment, errorTimestamp, installationId } = params;

  // Layer 1 — our own table
  const fromDb = await resolveDeploymentAtTime(orgId, repoFullName, environment, errorTimestamp);
  if (fromDb) {
    logger.debug({ repoFullName, sha: fromDb.commit_sha, source: "deployments_table" }, "Resolved commit from deployment table");
    return fromDb;
  }

  // Layer 2 — GitHub Deployments API (only if we have an installation token)
  if (installationId) {
    const fromGitHub = await syncGitHubDeployments(orgId, installationId, repoFullName, environment);
    if (fromGitHub) return fromGitHub;
  }

  logger.debug({ repoFullName, environment }, "No deployment record found for commit resolution");
  return null;
}
