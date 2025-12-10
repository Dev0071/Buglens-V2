# 04 - GitHub Integration

## Overview

The GitHub Integration subsystem manages authentication with GitHub App, fetching repository data, and tracking API rate limits. Buglens uses a **GitHub App** model (not personal access tokens) to enable per-organization installations and fine-grained permissions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        GITHUB INTEGRATION                                    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         GITHUB APP                                      │ │
│  │                                                                         │ │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐ │ │
│  │  │   App Config    │    │  Private Key    │    │   Webhook Secret    │ │ │
│  │  │   GITHUB_APP_ID │    │  (RSA 2048)     │    │   HMAC validation   │ │ │
│  │  └─────────────────┘    └─────────────────┘    └─────────────────────┘ │ │
│  │                                                                         │ │
│  │  Permissions Required:                                                  │ │
│  │  • Repository contents: Read                                           │ │
│  │  • Metadata: Read                                                       │ │
│  │                                                                         │ │
│  │  Events Subscribed:                                                     │ │
│  │  • installation, installation_repositories                             │ │
│  │  • push                                                                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      AUTHENTICATION FLOW                                │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │  1. Generate JWT (App-level)                                    │   │ │
│  │  │     - Sign with RSA private key                                 │   │ │
│  │  │     - Claims: iss (app_id), iat, exp (10 min)                   │   │ │
│  │  └────────────────────────────┬────────────────────────────────────┘   │ │
│  │                               │                                         │ │
│  │                               ▼                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │  2. Exchange JWT for Installation Token                         │   │ │
│  │  │     - POST /app/installations/{id}/access_tokens                │   │ │
│  │  │     - Scoped to specific installation                           │   │ │
│  │  │     - Expires in 1 hour                                         │   │ │
│  │  └────────────────────────────┬────────────────────────────────────┘   │ │
│  │                               │                                         │ │
│  │                               ▼                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │  3. Use Installation Token for API Calls                        │   │ │
│  │  │     - Authorization: Bearer <installation_token>                │   │ │
│  │  │     - Access only repos in that installation                    │   │ │
│  │  │     - Rate limit: 5000 req/hour per installation                │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      TOKEN CACHING (Redis)                              │ │
│  │                                                                         │ │
│  │  Key: gh:token:{installation_id}                                       │ │
│  │  TTL: 55 minutes (5 min before actual expiry)                          │ │
│  │  Value: { token, expires_at }                                          │ │
│  │                                                                         │ │
│  │  Flow:                                                                  │ │
│  │  ┌─── Cache HIT ──▶ Use cached token                                   │ │
│  │  │                                                                      │ │
│  │  └─── Cache MISS ──▶ Generate JWT ──▶ Exchange ──▶ Cache ──▶ Return    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                                | Purpose                           |
| ----------------------------------- | --------------------------------- |
| `src/services/github.ts`            | Main GitHub service class         |
| `src/api/routes/github-webhooks.ts` | Webhook handler for GitHub events |
| `src/types/github.ts`               | Type definitions                  |

---

## GitHub Service

### Class Structure

```typescript
// src/services/github.ts
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";

export class GitHubService {
  private appAuth: ReturnType<typeof createAppAuth>;
  private redis: Redis;

  constructor() {
    this.appAuth = createAppAuth({
      appId: config.GITHUB_APP_ID,
      privateKey: config.GITHUB_APP_PRIVATE_KEY,
    });
  }

  // Authentication
  async getInstallationOctokit(orgId: string): Promise<Octokit>;
  async getInstallationToken(installationId: number): Promise<string>;

  // Repository operations
  async fetchFile(
    orgId: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<string>;
  async getDefaultBranch(orgId: string, repo: string): Promise<string>;
  async checkRefExists(
    orgId: string,
    repo: string,
    ref: string
  ): Promise<boolean>;
  async getRecentCommits(
    orgId: string,
    repo: string,
    path: string
  ): Promise<Commit[]>;

  // Installation management
  async registerRepos(
    orgId: string,
    installationId: number,
    repos: Repo[]
  ): Promise<void>;
  async unregisterRepos(orgId: string, repoIds: string[]): Promise<void>;

  // Rate limiting
  async checkRateLimit(orgId: string): Promise<void>;
  async trackApiCall(orgId: string): Promise<void>;
}
```

### Authentication Flow

```typescript
async getInstallationOctokit(orgId: string): Promise<Octokit> {
  // 1. Get installation ID for this org
  const installationId = await this.getInstallationId(orgId);
  if (!installationId) {
    throw new GitHubIntegrationError('No GitHub App installation for organization');
  }

  // 2. Get or refresh installation token
  const token = await this.getInstallationToken(installationId);

  // 3. Create authenticated Octokit instance
  return new Octokit({ auth: token });
}

async getInstallationToken(installationId: number): Promise<string> {
  const cacheKey = `gh:token:${installationId}`;

  // Check cache
  const cached = await this.redis.get(cacheKey);
  if (cached) {
    const { token, expiresAt } = JSON.parse(cached);
    // Use if still valid (with 5 min buffer)
    if (new Date(expiresAt) > new Date(Date.now() + 5 * 60 * 1000)) {
      return token;
    }
  }

  // Generate new token
  const { token, expiresAt } = await this.appAuth({
    type: 'installation',
    installationId,
  });

  // Cache for 55 minutes (tokens last 1 hour)
  await this.redis.set(
    cacheKey,
    JSON.stringify({ token, expiresAt }),
    'EX',
    55 * 60
  );

  return token;
}
```

### Fetching File Content

```typescript
async fetchFile(
  orgId: string,
  repo: string,
  path: string,
  ref: string
): Promise<string> {
  // Rate limit check
  await this.checkRateLimit(orgId);

  const octokit = await this.getInstallationOctokit(orgId);
  const [owner, repoName] = repo.split('/');

  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo: repoName,
      path,
      ref,
    });

    // Track API call
    await this.trackApiCall(orgId);

    if (Array.isArray(response.data)) {
      throw new Error('Path is a directory');
    }

    if (response.data.type !== 'file' || !('content' in response.data)) {
      throw new Error('Not a file');
    }

    // Decode base64 content
    return Buffer.from(response.data.content, 'base64').toString('utf-8');
  } catch (error) {
    if (error.status === 404) {
      throw new FileNotFoundError(path, repo, ref);
    }
    throw error;
  }
}
```

### Checking Ref Existence

```typescript
async checkRefExists(
  orgId: string,
  repo: string,
  ref: string
): Promise<boolean> {
  const octokit = await this.getInstallationOctokit(orgId);
  const [owner, repoName] = repo.split('/');

  try {
    // Try as commit SHA first
    if (/^[a-f0-9]{7,40}$/i.test(ref)) {
      await octokit.rest.repos.getCommit({
        owner,
        repo: repoName,
        ref,
      });
      return true;
    }

    // Try as branch name
    await octokit.rest.repos.getBranch({
      owner,
      repo: repoName,
      branch: ref,
    });
    return true;
  } catch (error) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
}
```

### Getting Recent Commits

```typescript
interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

async getRecentCommits(
  orgId: string,
  repo: string,
  path?: string,
  count: number = 10
): Promise<Commit[]> {
  const octokit = await this.getInstallationOctokit(orgId);
  const [owner, repoName] = repo.split('/');

  const response = await octokit.rest.repos.listCommits({
    owner,
    repo: repoName,
    path,
    per_page: count,
  });

  await this.trackApiCall(orgId);

  return response.data.map(commit => ({
    sha: commit.sha,
    message: commit.commit.message,
    author: commit.commit.author?.name || 'Unknown',
    date: commit.commit.author?.date || '',
  }));
}
```

---

## Webhook Handling

### Installation Events

```typescript
// src/api/routes/github-webhooks.ts
server.post("/webhooks/github", async (request, reply) => {
  // Verify signature
  const signature = request.headers["x-hub-signature-256"] as string;
  if (
    !verifyGitHubSignature(
      request.rawBody,
      signature,
      config.GITHUB_WEBHOOK_SECRET
    )
  ) {
    return reply.status(401).send({ error: "Invalid signature" });
  }

  const event = request.headers["x-github-event"] as string;
  const payload = request.body as GitHubWebhookPayload;

  switch (event) {
    case "installation":
      await handleInstallation(payload);
      break;
    case "installation_repositories":
      await handleRepositoryChange(payload);
      break;
    case "push":
      await handlePush(payload);
      break;
    default:
      logger.debug({ event }, "Ignored GitHub event");
  }

  return reply.status(200).send({ received: true });
});
```

### Installation Created

```typescript
async function handleInstallation(payload: InstallationPayload): Promise<void> {
  const { action, installation, repositories } = payload;

  if (action === "created") {
    // Find or create organization
    const org = await findOrCreateOrg({
      slug: installation.account.login,
      name: installation.account.login,
      githubInstallationId: installation.id,
    });

    // Register all repositories
    if (repositories?.length) {
      await githubService.registerRepos(
        org.id,
        installation.id,
        repositories.map((r) => ({
          fullName: r.full_name,
          defaultBranch: r.default_branch || "main",
          private: r.private,
        }))
      );
    }

    logger.info(
      {
        orgId: org.id,
        installationId: installation.id,
        repoCount: repositories?.length,
      },
      "GitHub App installed"
    );
  }

  if (action === "deleted") {
    // Mark all repos as uninstalled
    await pool.query(
      `
      UPDATE repos
      SET github_installation_id = NULL, updated_at = NOW()
      WHERE github_installation_id = $1
    `,
      [installation.id]
    );

    logger.info({ installationId: installation.id }, "GitHub App uninstalled");
  }
}
```

### Repository Registration

```typescript
async registerRepos(
  orgId: string,
  installationId: number,
  repos: RepoInput[]
): Promise<void> {
  // Batch insert with upsert
  const values = repos.map((repo, i) =>
    `($${i*5+1}, $${i*5+2}, $${i*5+3}, $${i*5+4}, $${i*5+5})`
  ).join(', ');

  const params = repos.flatMap(repo => [
    orgId,
    repo.fullName,
    installationId,
    repo.defaultBranch,
    repo.private,
  ]);

  await pool.query(`
    INSERT INTO repos (org_id, full_name, github_installation_id, default_branch, is_private)
    VALUES ${values}
    ON CONFLICT (org_id, full_name) DO UPDATE SET
      github_installation_id = EXCLUDED.github_installation_id,
      default_branch = EXCLUDED.default_branch,
      updated_at = NOW()
  `, params);

  logger.info({
    orgId,
    installationId,
    repoCount: repos.length,
    repos: repos.map(r => r.fullName),
  }, 'Repositories registered');
}
```

---

## Rate Limiting

### Per-Organization Tracking

```typescript
async checkRateLimit(orgId: string): Promise<void> {
  const plan = await this.getOrgPlan(orgId);
  const limit = RATE_LIMITS[plan].github_api_calls_per_hour;

  const key = `gh:ratelimit:${orgId}`;
  const usage = await this.redis.get(key);

  if (usage && parseInt(usage) >= limit) {
    const ttl = await this.redis.ttl(key);
    throw new RateLimitError({
      message: `GitHub API rate limit exceeded`,
      limit,
      remaining: 0,
      resetInSeconds: ttl,
    });
  }
}

async trackApiCall(orgId: string): Promise<void> {
  const key = `gh:ratelimit:${orgId}`;
  const count = await this.redis.incr(key);

  // Set 1-hour expiry on first call
  if (count === 1) {
    await this.redis.expire(key, 3600);
  }

  // Log when approaching limit
  const plan = await this.getOrgPlan(orgId);
  const limit = RATE_LIMITS[plan].github_api_calls_per_hour;

  if (count >= limit * 0.8) {
    logger.warn({
      orgId,
      usage: count,
      limit,
    }, 'Approaching GitHub API rate limit');
  }
}
```

### Rate Limit Headers

```typescript
// Parse GitHub's rate limit headers
function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  return {
    limit: parseInt(headers["x-ratelimit-limit"] || "5000"),
    remaining: parseInt(headers["x-ratelimit-remaining"] || "5000"),
    reset: parseInt(headers["x-ratelimit-reset"] || "0"),
    used: parseInt(headers["x-ratelimit-used"] || "0"),
  };
}
```

---

## Error Handling

### Custom Error Classes

```typescript
export class GitHubIntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubIntegrationError";
  }
}

export class FileNotFoundError extends Error {
  constructor(
    public readonly path: string,
    public readonly repo: string,
    public readonly ref: string
  ) {
    super(`File not found: ${path} in ${repo}@${ref}`);
    this.name = "FileNotFoundError";
  }
}

export class RateLimitError extends Error {
  constructor(
    public readonly details: {
      message: string;
      limit: number;
      remaining: number;
      resetInSeconds: number;
    }
  ) {
    super(details.message);
    this.name = "RateLimitError";
  }

  get retryAfter(): number {
    return this.details.resetInSeconds;
  }
}

export class NoInstallationError extends Error {
  constructor(orgId: string) {
    super(`No GitHub App installation found for organization ${orgId}`);
    this.name = "NoInstallationError";
  }
}
```

### Error Recovery

```typescript
async fetchFileWithRetry(
  orgId: string,
  repo: string,
  path: string,
  ref: string,
  retries = 3
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await this.fetchFile(orgId, repo, path, ref);
    } catch (error) {
      // Don't retry 404s
      if (error instanceof FileNotFoundError) {
        throw error;
      }

      // Rate limit - wait and retry
      if (error instanceof RateLimitError) {
        if (attempt < retries) {
          const waitTime = Math.min(error.retryAfter * 1000, 60000);
          logger.info({ waitTime, attempt }, 'Rate limited, waiting');
          await sleep(waitTime);
          continue;
        }
      }

      // Network errors - exponential backoff
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn({ error, attempt, delay }, 'GitHub API error, retrying');
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}
```

---

## Types

```typescript
// src/types/github.ts
export interface InstallationPayload {
  action: "created" | "deleted" | "suspend" | "unsuspend";
  installation: {
    id: number;
    account: {
      login: string;
      id: number;
      type: "User" | "Organization";
    };
  };
  repositories?: Array<{
    id: number;
    full_name: string;
    private: boolean;
    default_branch?: string;
  }>;
}

export interface RepoInput {
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
}
```

---

## Database Schema

```sql
-- Organization GitHub installation
ALTER TABLE organizations
ADD COLUMN github_installation_id INTEGER;

-- Repository registry
CREATE TABLE repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  full_name VARCHAR(255) NOT NULL,
  github_installation_id INTEGER,
  default_branch VARCHAR(100) DEFAULT 'main',
  is_private BOOLEAN DEFAULT false,
  last_analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, full_name)
);

CREATE INDEX idx_repos_org_id ON repos(org_id);
CREATE INDEX idx_repos_installation ON repos(github_installation_id);
```

---

## Security Considerations

1. **Private Key Storage**: Store `GITHUB_APP_PRIVATE_KEY` in AWS Secrets Manager for production
2. **Webhook Verification**: Always verify `x-hub-signature-256` before processing
3. **Token Caching**: Cache installation tokens to reduce API calls, but with proper expiry
4. **Scope Limitation**: Request minimum permissions (contents: read, metadata: read)
5. **Installation Isolation**: Each org's installation has separate rate limits

---

## Testing

```typescript
describe("GitHubService", () => {
  describe("getInstallationToken", () => {
    it("returns cached token if valid", async () => {
      const futureExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          token: "cached-token",
          expiresAt: futureExpiry,
        })
      );

      const token = await service.getInstallationToken(123);

      expect(token).toBe("cached-token");
      expect(mockAppAuth).not.toHaveBeenCalled();
    });

    it("refreshes token when expired", async () => {
      const pastExpiry = new Date(Date.now() - 60 * 1000).toISOString();
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          token: "old-token",
          expiresAt: pastExpiry,
        })
      );
      mockAppAuth.mockResolvedValue({
        token: "new-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      const token = await service.getInstallationToken(123);

      expect(token).toBe("new-token");
      expect(mockRedis.set).toHaveBeenCalled();
    });
  });

  describe("checkRefExists", () => {
    it("returns true for existing commit", async () => {
      mockOctokit.rest.repos.getCommit.mockResolvedValue({ data: {} });

      const exists = await service.checkRefExists(
        orgId,
        "owner/repo",
        "abc123"
      );

      expect(exists).toBe(true);
    });

    it("returns false for 404", async () => {
      mockOctokit.rest.repos.getCommit.mockRejectedValue({ status: 404 });

      const exists = await service.checkRefExists(
        orgId,
        "owner/repo",
        "invalid"
      );

      expect(exists).toBe(false);
    });
  });
});
```
