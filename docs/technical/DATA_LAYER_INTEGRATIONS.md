# Data Layer & Integrations - Comprehensive Technical Documentation

> **Buglens V2** - AI-Powered Root Cause Analysis Platform  
> **Document Version**: 1.0.0  
> **Last Updated**: January 3, 2026  
> **Maintainers**: Buglens Engineering Team

---

## Overview

This document covers Buglens' data layer architecture including PostgreSQL database schema with Row-Level Security, integration management (GitHub, Slack, Jira, Teams), type systems with Zod validation, and external service integrations.

### Key Features

1. **Multi-Tenant PostgreSQL**: Every table includes `org_id` with RLS policies for complete data isolation
2. **GitHub Integration**: GitHub App authentication with installation-scoped tokens, 3-tier caching
3. **Type Safety**: Zod schemas for runtime validation, TypeScript types for compile-time safety
4. **Encrypted Tokens**: AES-256-GCM encrypted OAuth tokens stored in database
5. **Integration Flexibility**: Supports multiple GitHub installations per organization

### Technology Stack

| Component              | Technology                           |
| ---------------------- | ------------------------------------ |
| Database               | PostgreSQL 15+ with Row-Level Security |
| Migrations             | node-pg-migrate                      |
| Connection Pool        | pg (node-postgres)                   |
| GitHub API             | Octokit with GitHub App authentication |
| Runtime Validation     | Zod 3.x                              |
| Type System            | TypeScript 5.x strict mode           |
| Secret Management      | AWS Secrets Manager (encrypted_tokens in DB) |

---

## Table of Contents

### Part 1: GitHub Integration (Lines 52-801)
- [GitHub App Architecture](#04---github-integration)
- [Authentication Flow (JWT → Installation Token)](#authentication-flow)
- [File Fetching & Repository Operations](#repository-operations)
- [Rate Limiting & Error Handling](#rate-limiting)
- [Webhook Processing](#webhook-handling)
- [Security Considerations](#security-considerations)

### Part 2: Database Schema (Lines 802-1762)
- [Database Overview](#08---database)
- [Connection Management](#connection-management)
- [Row-Level Security](#row-level-security)
- [Core Migrations](#migrations)
  - Organizations
  - Events
  - RCA Jobs & Results
  - Repos
  - Integrations (with encrypted_tokens)
  - Cost Metrics
- [Common Query Patterns](#common-queries)
- [Multi-Tenant Best Practices](#multi-tenancy-best-practices)

### Part 3: Types & Schemas (Lines 1763-2743)
- [Type System Architecture](#09---types--schemas)
- [Zod Schemas](#zod-schemas-runtime-validation)
  - Sentry Event Schemas
  - GitHub Webhook Schemas
  - Evidence & RCA Schemas
- [TypeScript Types](#typescript-types)
  - Database Models
  - Service Interfaces
  - Type Guards & Utilities
- [Validation Helpers](#validation-helpers)

### Part 4: Integration Schema Deep Dive (Lines 2744-end)
- [Integrations Table DDL](#integration-schema-explained)
- [Column Use Cases](#column-use-cases)
  - config (DEPRECATED)
  - encrypted_tokens (REQUIRED)
  - metadata (REQUIRED)
  - display_name, external_id, status
- [GitHub Integration Strategy](#github-integration-strategy)
  - GitHub OAuth App vs GitHub App comparison
  - Why GitHub App is recommended
- [RCA Process Integration Points](#rca-process-integration-points)
- [Current Implementation Status](#current-implementation-status)

---

## Quick Reference

### Database Connection Example

```typescript
import { pool, withOrgContext, withTransaction } from './db/client';

// Organization-scoped query
const events = await withOrgContext(orgId, async (client) => {
  return client.query('SELECT * FROM events WHERE status = $1', ['received']);
});

// Transaction with org context
await withTransaction(orgId, async (client) => {
  await client.query('INSERT INTO events (...) VALUES (...)');
  await client.query('INSERT INTO rca_jobs (...) VALUES (...)');
});
```

### GitHub App Authentication Flow

```
1. Generate JWT (10min expiry)
   ↓
2. Exchange JWT for Installation Token (1hr expiry)
   ↓
3. Cache token in Redis (55min TTL)
   ↓
4. Use token for GitHub API calls
```

### Integrations Table Schema (Current)

```sql
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL,  -- 'github', 'slack', 'jira', 'teams'
  status TEXT NOT NULL DEFAULT 'connected',  -- 'connected', 'disconnected', 'error'
  display_name TEXT,
  external_id TEXT,  -- e.g., installation_id for GitHub
  encrypted_tokens JSONB NOT NULL DEFAULT '{}',  -- AES-256-GCM encrypted
  metadata JSONB NOT NULL DEFAULT '{}',  -- Non-sensitive queryable data
  config JSONB,  -- DEPRECATED, nullable for migration
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, type, external_id)
);
```

### Zod Validation Pattern

```typescript
import { z } from 'zod';

const SentryEventSchema = z.object({
  event_id: z.string(),
  platform: z.string().optional(),
  exception: z.object({
    values: z.array(z.object({
      type: z.string(),
      value: z.string(),
      stacktrace: z.object({
        frames: z.array(StackFrameSchema)
      }).optional()
    }))
  }).optional()
});

// Runtime validation at API boundary
const validated = SentryEventSchema.safeParse(payload);
if (!validated.success) {
  throw new ValidationError(validated.error);
}

// Infer TypeScript type
type SentryEvent = z.infer<typeof SentryEventSchema>;
```

---

## Document Sections

The following sections contain the complete merged content from individual technical documentation files. All content has been preserved without modification to ensure accuracy and completeness.

---

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
# 08 - Database

## Overview

Buglens uses PostgreSQL with Row-Level Security (RLS) for multi-tenant data isolation. Every table includes `org_id` from Day 1 - this is non-negotiable. The database is designed for:

1. **Multi-tenancy** - Complete data isolation between organizations
2. **Query Performance** - Strategic indexing for common access patterns
3. **Cost Tracking** - Built-in metrics for per-org billing
4. **Audit Trail** - Timestamps and soft deletes where appropriate

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE SCHEMA                                    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        CORE TABLES                                      │ │
│  │                                                                         │ │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐             │ │
│  │  │ organizations│◄───│    users     │    │ integrations │             │ │
│  │  │    (orgs)    │    │              │    │              │             │ │
│  │  └──────┬───────┘    └──────────────┘    └──────────────┘             │ │
│  │         │                                                               │ │
│  │         │ org_id (FK in all tables)                                    │ │
│  │         │                                                               │ │
│  │         ▼                                                               │ │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐             │ │
│  │  │    events    │───▶│   rca_jobs   │───▶│ rca_results  │             │ │
│  │  │   (sentry)   │    │              │    │              │             │ │
│  │  └──────────────┘    └──────────────┘    └──────────────┘             │ │
│  │                                                                         │ │
│  │  ┌──────────────┐    ┌──────────────┐                                  │ │
│  │  │    repos     │    │ cost_metrics │                                  │ │
│  │  │   (github)   │    │   (billing)  │                                  │ │
│  │  └──────────────┘    └──────────────┘                                  │ │
│  │                                                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      ROW-LEVEL SECURITY                                 │ │
│  │                                                                         │ │
│  │  • Every query filtered by org_id automatically                        │ │
│  │  • Set context: SET LOCAL app.current_org_id = '<uuid>'                │ │
│  │  • Policy: org_id = current_setting('app.current_org_id')::uuid        │ │
│  │  • Prevents cross-tenant data access even on bugs                      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                        | Purpose                                            |
| --------------------------- | -------------------------------------------------- |
| `migrations/*.cjs`          | Database migrations (CommonJS for node-pg-migrate) |
| `src/db/client.ts`          | PostgreSQL connection pool                         |
| `src/db/models/`            | Database models and queries (future)               |
| `scripts/seed-dev-data.sql` | Development seed data                              |

---

## Connection Management

```typescript
// src/db/client.ts
import { Pool, PoolClient } from "pg";
import { config } from "../utils/config";
import { logger } from "../utils/logger";

// Connection pool with sensible defaults
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20, // Maximum connections
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail fast on connection issues
});

// Log pool events
pool.on("connect", () => {
  logger.debug("New database connection established");
});

pool.on("error", (error) => {
  logger.error({ error }, "Unexpected database pool error");
});

// Health check
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    return true;
  } catch (error) {
    logger.error({ error }, "Database health check failed");
    return false;
  }
}

// Graceful shutdown
export async function closeDatabase(): Promise<void> {
  await pool.end();
  logger.info("Database pool closed");
}

// Organization-scoped query helper
export async function withOrgContext<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    // Set organization context for RLS
    await client.query("SET LOCAL app.current_org_id = $1", [orgId]);
    return await fn(client);
  } finally {
    client.release();
  }
}

// Transaction helper with org context
export async function withTransaction<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.current_org_id = $1", [orgId]);

    const result = await fn(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

---

## Migrations

### 001 - Organizations

```javascript
// migrations/001_create_organizations.cjs
exports.up = (pgm) => {
  pgm.createTable("organizations", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "varchar(255)", notNull: true },
    slug: { type: "varchar(100)", notNull: true, unique: true },
    plan: { type: "varchar(50)", notNull: true, default: "free" },
    github_installation_id: { type: "integer" },
    sentry_organization_slug: { type: "varchar(255)" },
    settings: { type: "jsonb", default: "{}" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Indexes
  pgm.createIndex("organizations", "slug");
  pgm.createIndex("organizations", "github_installation_id");
};

exports.down = (pgm) => {
  pgm.dropTable("organizations");
};
```

### 002 - Events

```javascript
// migrations/002_create_events.cjs
exports.up = (pgm) => {
  pgm.createTable("events", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    org_id: {
      type: "uuid",
      notNull: true,
      references: "organizations(id)",
      onDelete: "CASCADE",
    },
    sentry_event_id: { type: "varchar(64)", notNull: true },
    sentry_project_slug: { type: "varchar(255)" },
    message: { type: "text", notNull: true },
    platform: { type: "varchar(50)" },
    level: { type: "varchar(20)" },
    environment: { type: "varchar(100)" },
    fingerprint: { type: "varchar(255)" },
    tags: { type: "jsonb", default: "{}" },
    raw_payload: { type: "jsonb", notNull: true },
    received_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Indexes for common queries
  pgm.createIndex("events", "org_id");
  pgm.createIndex("events", ["org_id", "sentry_event_id"], { unique: true });
  pgm.createIndex("events", ["org_id", "fingerprint"]);
  pgm.createIndex("events", ["org_id", "received_at"]);
  pgm.createIndex("events", "sentry_project_slug");

  // Enable RLS
  pgm.sql("ALTER TABLE events ENABLE ROW LEVEL SECURITY");

  // RLS Policy
  pgm.sql(`
    CREATE POLICY events_org_isolation ON events
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("events");
};
```

### 003 - RCA Jobs

```javascript
// migrations/003_create_rca_jobs.cjs
exports.up = (pgm) => {
  pgm.createType("job_status", [
    "pending",
    "processing",
    "completed",
    "failed",
    "cancelled",
  ]);

  pgm.createTable("rca_jobs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    org_id: {
      type: "uuid",
      notNull: true,
      references: "organizations(id)",
      onDelete: "CASCADE",
    },
    event_id: {
      type: "uuid",
      notNull: true,
      references: "events(id)",
      onDelete: "CASCADE",
    },
    status: {
      type: "job_status",
      notNull: true,
      default: "pending",
    },
    priority: { type: "smallint", default: 5 },
    error_message: { type: "text" },
    retry_count: { type: "smallint", default: 0 },
    started_at: { type: "timestamptz" },
    completed_at: { type: "timestamptz" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Indexes
  pgm.createIndex("rca_jobs", "org_id");
  pgm.createIndex("rca_jobs", ["org_id", "status"]);
  pgm.createIndex("rca_jobs", ["org_id", "event_id"], { unique: true });
  pgm.createIndex("rca_jobs", ["status", "priority", "created_at"]);

  // RLS
  pgm.sql("ALTER TABLE rca_jobs ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY rca_jobs_org_isolation ON rca_jobs
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("rca_jobs");
  pgm.dropType("job_status");
};
```

### 004 - RCA Results

```javascript
// migrations/004_create_rca_results.cjs
exports.up = (pgm) => {
  pgm.createTable("rca_results", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    org_id: {
      type: "uuid",
      notNull: true,
      references: "organizations(id)",
      onDelete: "CASCADE",
    },
    event_id: {
      type: "uuid",
      notNull: true,
      references: "events(id)",
      onDelete: "CASCADE",
    },
    root_cause: { type: "text", notNull: true },
    confidence: { type: "decimal(3,2)", notNull: true },
    suggested_fix: { type: "text" },
    evidence_summary: { type: "jsonb" },
    deterministic_findings: { type: "jsonb", default: "[]" },
    llm_response: { type: "jsonb" },
    llm_model: { type: "varchar(100)" },
    llm_tokens_used: { type: "integer" },
    llm_cost_usd: { type: "decimal(10,6)" },
    execution_time_ms: { type: "integer" },
    user_feedback: { type: "smallint" }, // -1, 0, 1 (bad, neutral, good)
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Indexes
  pgm.createIndex("rca_results", "org_id");
  pgm.createIndex("rca_results", ["org_id", "event_id"]);
  pgm.createIndex("rca_results", ["org_id", "created_at"]);
  pgm.createIndex("rca_results", "confidence");

  // RLS
  pgm.sql("ALTER TABLE rca_results ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY rca_results_org_isolation ON rca_results
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("rca_results");
};
```

### 005 - Repos

```javascript
// migrations/005_create_repos.cjs
exports.up = (pgm) => {
  pgm.createTable("repos", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    org_id: {
      type: "uuid",
      notNull: true,
      references: "organizations(id)",
      onDelete: "CASCADE",
    },
    full_name: { type: "varchar(255)", notNull: true }, // owner/repo
    github_installation_id: { type: "integer" },
    default_branch: { type: "varchar(100)", default: "main" },
    is_private: { type: "boolean", default: false },
    last_analyzed_at: { type: "timestamptz" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Indexes
  pgm.createIndex("repos", "org_id");
  pgm.createIndex("repos", ["org_id", "full_name"], { unique: true });
  pgm.createIndex("repos", "github_installation_id");

  // RLS
  pgm.sql("ALTER TABLE repos ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY repos_org_isolation ON repos
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("repos");
};
```

### 008 - Integrations (OAuth & GitHub App)

**Base Table (Migration 008):**

```javascript
// migrations/008_create_integrations.cjs
exports.up = (pgm) => {
  pgm.createTable("integrations", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    org_id: {
      type: "uuid",
      notNull: true,
      references: "organizations(id)",
      onDelete: "CASCADE",
    },
    type: { type: "text", notNull: true }, // github, github_app, slack, jira, etc.
    config: { type: "jsonb", notNull: true, default: "{}" }, // Legacy config storage
    secret_id: { type: "text" }, // AWS Secrets Manager ID (if applicable)
    is_active: { type: "boolean", notNull: true, default: true },
    last_verified_at: { type: "timestamptz" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.addConstraint("integrations", "integrations_org_type_unique", {
    unique: ["org_id", "type"],
  });

  pgm.createIndex("integrations", "org_id");
  pgm.createIndex("integrations", ["org_id", "type"]);

  pgm.sql("ALTER TABLE integrations ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY integrations_isolation ON integrations
      USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};
```

**Migration 020 - Encrypted Tokens:**

```javascript
// migrations/020_add_encrypted_tokens.cjs
exports.up = (pgm) => {
  // Add encrypted_tokens column for OAuth credentials
  pgm.addColumns("integrations", {
    encrypted_tokens: { type: "jsonb" }, // Stores AES-256-GCM encrypted tokens
  });
};
```

**Migration 021 - GitHub App Columns:**

```javascript
// migrations/021_add_github_app_columns.cjs
exports.up = (pgm) => {
  // Add columns for GitHub App and multi-installation support
  pgm.addColumn("integrations", {
    status: {
      type: "text",
      notNull: true,
      default: "connected", // connected | disconnected | error
    },
    display_name: { type: "text" }, // Human-readable name (e.g., "GitHub App - Acme Corp")
    external_id: { type: "text" }, // GitHub installation_id, Slack team_id, etc.
  });

  // Drop old unique constraint (org_id, type)
  pgm.dropConstraint("integrations", "integrations_org_type_unique");

  // New unique constraint allows multiple integrations of same type per org
  pgm.addConstraint("integrations", "integrations_org_type_external_unique", {
    unique: ["org_id", "type", "external_id"],
  });

  pgm.createIndex("integrations", "external_id");
  pgm.createIndex("integrations", ["org_id", "status"]);
};
```

**Migration 022 - Metadata Column:**

```javascript
// migrations/022_add_metadata_column.cjs
exports.up = (pgm) => {
  // Add metadata column for non-sensitive integration data
  pgm.addColumn("integrations", {
    metadata: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
  });

  // GIN index for efficient JSONB queries (e.g., metadata->>'installationId')
  pgm.addIndex("integrations", "metadata", { method: "gin" });
};
```

**Migration 023 - Make config Nullable:**

```javascript
// migrations/023_make_config_nullable.cjs
exports.up = (pgm) => {
  // Make config nullable (transitioning to encrypted_tokens + metadata pattern)
  pgm.alterColumn("integrations", "config", {
    type: "jsonb",
    notNull: false, // No longer required
    default: pgm.func("'{}'::jsonb"),
  });
};
```

**Final Schema (after migrations 008, 020-023):**

```typescript
interface Integration {
  id: string; // UUID
  org_id: string; // UUID (FK to organizations)
  type: string; // 'github' | 'github_app' | 'slack' | 'jira' | 'sentry'
  status: string; // 'connected' | 'disconnected' | 'error'
  display_name: string | null; // Human-readable name
  external_id: string | null; // External identifier (installation_id, team_id)
  config: Record<string, unknown> | null; // Legacy config (nullable)
  encrypted_tokens: EncryptedData | null; // AES-256-GCM encrypted OAuth tokens
  metadata: Record<string, unknown>; // Non-sensitive data (repos, permissions, scopes)
  secret_id: string | null; // AWS Secrets Manager ID (if applicable)
  is_active: boolean; // true = active, false = disconnected
  last_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Unique constraint: (org_id, type, external_id)
// Allows multiple GitHub installations per org, but prevents duplicate installations
```

**Usage Pattern:**

```typescript
// Store GitHub App integration
await pool.query(
  `INSERT INTO integrations (org_id, type, status, display_name, external_id, encrypted_tokens, metadata, is_active)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [
    orgId,
    "github_app",
    "connected",
    "GitHub App - Acme Corp",
    "12345678", // GitHub installation_id
    encryptedTokens, // { data, iv, authTag, version }
    { installationId: "12345678", repos: ["acme/webapp"], permissions: {...} },
    true,
  ]
);

// Query active integrations
await withOrgContext(orgId, async (client) => {
  const result = await client.query(
    `SELECT * FROM integrations WHERE is_active = true AND type = $1`,
    ["github_app"]
  );
  return result.rows;
});
```

### 009 - Cost Metrics

```javascript
// migrations/009_create_cost_metrics.cjs
exports.up = (pgm) => {
  pgm.createTable("cost_metrics", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    org_id: {
      type: "uuid",
      notNull: true,
      references: "organizations(id)",
      onDelete: "CASCADE",
    },
    date: { type: "date", notNull: true },

    // RCA counts
    rca_count: { type: "integer", default: 0 },
    rca_success_count: { type: "integer", default: 0 },
    rca_failure_count: { type: "integer", default: 0 },

    // LLM usage
    llm_tokens_input: { type: "bigint", default: 0 },
    llm_tokens_output: { type: "bigint", default: 0 },
    llm_cost_usd: { type: "decimal(10,6)", default: 0 },

    // GitHub API usage
    github_api_calls: { type: "integer", default: 0 },
    github_cache_hits: { type: "integer", default: 0 },

    // Storage
    evidence_storage_bytes: { type: "bigint", default: 0 },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Unique constraint for daily metrics per org
  pgm.createIndex("cost_metrics", ["org_id", "date"], { unique: true });
  pgm.createIndex("cost_metrics", "date");

  // RLS
  pgm.sql("ALTER TABLE cost_metrics ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY cost_metrics_org_isolation ON cost_metrics
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("cost_metrics");
};
```

---

## Row-Level Security

### Setting Organization Context

```typescript
// src/api/middleware/org-context.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { pool } from "../../db/client";

export async function setOrgContext(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const orgId = request.headers["x-org-id"] as string;

  if (!orgId) {
    // For webhooks, org is determined from payload
    return;
  }

  // Validate org exists and user has access
  const result = await pool.query(
    "SELECT id FROM organizations WHERE id = $1",
    [orgId]
  );

  if (result.rows.length === 0) {
    return reply.status(404).send({ error: "Organization not found" });
  }

  // Store in request for later use
  request.orgId = orgId;
}

// Augment FastifyRequest type
declare module "fastify" {
  interface FastifyRequest {
    orgId?: string;
  }
}
```

### Query Pattern

```typescript
// Always use org context in queries
export async function getEventById(
  orgId: string,
  eventId: string
): Promise<Event | null> {
  // Method 1: Include org_id in WHERE (explicit)
  const result = await pool.query(
    `SELECT * FROM events WHERE org_id = $1 AND id = $2`,
    [orgId, eventId]
  );

  return result.rows[0] || null;
}

// Method 2: Use RLS context (implicit filtering)
export async function getRecentEvents(
  orgId: string,
  limit: number = 20
): Promise<Event[]> {
  return withOrgContext(orgId, async (client) => {
    // RLS automatically filters by org_id
    const result = await client.query(
      `SELECT * FROM events ORDER BY received_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  });
}
```

---

## Common Queries

### Insert Event

```typescript
export async function insertEvent(
  orgId: string,
  event: InsertEventData
): Promise<string> {
  const result = await pool.query(
    `
    INSERT INTO events (
      org_id, sentry_event_id, sentry_project_slug, message,
      platform, level, environment, fingerprint, tags, raw_payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (org_id, sentry_event_id) DO UPDATE SET
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
    RETURNING id
  `,
    [
      orgId,
      event.sentryEventId,
      event.projectSlug,
      event.message,
      event.platform,
      event.level,
      event.environment,
      event.fingerprint,
      JSON.stringify(event.tags),
      JSON.stringify(event.rawPayload),
    ]
  );

  return result.rows[0].id;
}
```

### Update Cost Metrics

```typescript
export async function trackDailyCost(
  orgId: string,
  metrics: {
    rcaCount?: number;
    llmTokensInput?: number;
    llmTokensOutput?: number;
    llmCostUsd?: number;
    githubApiCalls?: number;
    githubCacheHits?: number;
  }
): Promise<void> {
  await pool.query(
    `
    INSERT INTO cost_metrics (
      org_id, date,
      rca_count, llm_tokens_input, llm_tokens_output,
      llm_cost_usd, github_api_calls, github_cache_hits
    ) VALUES (
      $1, CURRENT_DATE,
      $2, $3, $4, $5, $6, $7
    )
    ON CONFLICT (org_id, date) DO UPDATE SET
      rca_count = cost_metrics.rca_count + EXCLUDED.rca_count,
      llm_tokens_input = cost_metrics.llm_tokens_input + EXCLUDED.llm_tokens_input,
      llm_tokens_output = cost_metrics.llm_tokens_output + EXCLUDED.llm_tokens_output,
      llm_cost_usd = cost_metrics.llm_cost_usd + EXCLUDED.llm_cost_usd,
      github_api_calls = cost_metrics.github_api_calls + EXCLUDED.github_api_calls,
      github_cache_hits = cost_metrics.github_cache_hits + EXCLUDED.github_cache_hits,
      updated_at = NOW()
  `,
    [
      orgId,
      metrics.rcaCount || 0,
      metrics.llmTokensInput || 0,
      metrics.llmTokensOutput || 0,
      metrics.llmCostUsd || 0,
      metrics.githubApiCalls || 0,
      metrics.githubCacheHits || 0,
    ]
  );
}
```

### Get Organization Usage

```typescript
export async function getOrgUsage(
  orgId: string,
  days: number = 30
): Promise<UsageSummary> {
  const result = await pool.query(
    `
    SELECT
      SUM(rca_count) as total_rcas,
      SUM(llm_tokens_input + llm_tokens_output) as total_tokens,
      SUM(llm_cost_usd) as total_cost,
      SUM(github_api_calls) as total_api_calls,
      AVG(CASE WHEN github_api_calls > 0
          THEN github_cache_hits::float / github_api_calls
          ELSE 0 END) as cache_hit_rate
    FROM cost_metrics
    WHERE org_id = $1
      AND date >= CURRENT_DATE - $2::interval
  `,
    [orgId, `${days} days`]
  );

  return result.rows[0];
}
```

---

## Running Migrations

```bash
# Run pending migrations
DATABASE_URL=postgres://... npx node-pg-migrate up

# Rollback last migration
DATABASE_URL=postgres://... npx node-pg-migrate down

# Create new migration
npx node-pg-migrate create my_migration_name
```

### Migration Script

```bash
#!/bin/bash
# scripts/migrate.sh

set -e

echo "Running database migrations..."

# Check DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

# Run migrations
npx node-pg-migrate up --migrations-dir migrations --migration-file-language cjs

echo "Migrations complete!"
```

---

## Testing

```typescript
// tests/integration/database.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, withOrgContext } from "../../src/db/client";

describe("Database", () => {
  const testOrgId = "test-org-" + Date.now();

  beforeAll(async () => {
    // Create test org
    await pool.query(
      `
      INSERT INTO organizations (id, name, slug)
      VALUES ($1, 'Test Org', $2)
    `,
      [testOrgId, `test-${Date.now()}`]
    );
  });

  afterAll(async () => {
    // Cleanup
    await pool.query("DELETE FROM organizations WHERE id = $1", [testOrgId]);
  });

  it("RLS prevents cross-org access", async () => {
    // Insert event for test org
    await pool.query(
      `
      INSERT INTO events (org_id, sentry_event_id, message, raw_payload)
      VALUES ($1, 'test-event', 'Test', '{}')
    `,
      [testOrgId]
    );

    // Query with wrong org context should return nothing
    const result = await withOrgContext("wrong-org-id", async (client) => {
      return client.query("SELECT * FROM events");
    });

    expect(result.rows).toHaveLength(0);

    // Query with correct org context should return the event
    const correctResult = await withOrgContext(testOrgId, async (client) => {
      return client.query("SELECT * FROM events");
    });

    expect(correctResult.rows.length).toBeGreaterThan(0);
  });
});
```
# 09 - Types & Schemas

## Overview

Buglens uses a dual validation strategy:

1. **Zod Schemas** - Runtime validation at API boundaries (webhooks, user input)
2. **TypeScript Types** - Compile-time type safety throughout the codebase

This ensures data integrity from external sources while maintaining developer productivity with full IntelliSense support.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TYPE SYSTEM ARCHITECTURE                              │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      EXTERNAL BOUNDARY                                  │ │
│  │                                                                         │ │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                │ │
│  │  │   Sentry    │    │   GitHub    │    │    Slack    │                │ │
│  │  │  Webhook    │    │   Events    │    │  Commands   │                │ │
│  │  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                │ │
│  │         │                  │                  │                        │ │
│  │         └──────────────────┼──────────────────┘                        │ │
│  │                            │                                           │ │
│  │                            ▼                                           │ │
│  │               ┌────────────────────────┐                               │ │
│  │               │    Zod Validation      │                               │ │
│  │               │    (Runtime Check)     │                               │ │
│  │               └────────────┬───────────┘                               │ │
│  │                            │                                           │ │
│  └────────────────────────────┼───────────────────────────────────────────┘ │
│                               │                                             │
│                               ▼                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      INTERNAL DOMAIN                                    │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                    TypeScript Types                              │   │ │
│  │  │                                                                  │   │ │
│  │  │  • Inferred from Zod schemas (z.infer<typeof Schema>)           │   │ │
│  │  │  • Additional internal types (not exposed externally)           │   │ │
│  │  │  • Database model types                                          │   │ │
│  │  │  • Service interfaces                                            │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                    | Purpose                              |
| ----------------------- | ------------------------------------ |
| `src/types/sentry.ts`   | Sentry webhook types and Zod schemas |
| `src/types/models.ts`   | Database model types                 |
| `src/types/evidence.ts` | Evidence bundle types                |
| `src/types/github.ts`   | GitHub integration types             |
| `src/types/rca.ts`      | RCA result types                     |

---

## Sentry Types

```typescript
// src/types/sentry.ts
import { z } from "zod";

// ============================================================================
// ZOD SCHEMAS (Runtime Validation)
// ============================================================================

/**
 * Stack frame from Sentry exception
 */
export const StackFrameSchema = z.object({
  filename: z.string().optional(),
  function: z.string().optional(),
  module: z.string().optional(),
  lineno: z.number().optional(),
  colno: z.number().optional(),
  abs_path: z.string().optional(),
  context_line: z.string().optional(),
  pre_context: z.array(z.string()).optional(),
  post_context: z.array(z.string()).optional(),
  in_app: z.boolean().optional(),
  vars: z.record(z.unknown()).optional(),
});

/**
 * Exception value from Sentry
 */
export const ExceptionValueSchema = z.object({
  type: z.string().optional(),
  value: z.string().optional(),
  module: z.string().optional(),
  thread_id: z.number().optional(),
  mechanism: z
    .object({
      type: z.string().optional(),
      handled: z.boolean().optional(),
    })
    .optional(),
  stacktrace: z
    .object({
      frames: z.array(StackFrameSchema).optional(),
    })
    .optional(),
});

/**
 * Sentry breadcrumb
 */
export const BreadcrumbSchema = z.object({
  timestamp: z.string().or(z.number()),
  type: z.string().optional(),
  category: z.string().optional(),
  level: z.enum(["fatal", "error", "warning", "info", "debug"]).optional(),
  message: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});

/**
 * User information
 */
export const UserSchema = z.object({
  id: z.string().optional(),
  email: z.string().email().optional(),
  username: z.string().optional(),
  ip_address: z.string().optional(),
});

/**
 * Sentry event data (inside webhook)
 */
export const SentryEventDataSchema = z.object({
  event_id: z.string(),
  project: z.number().optional(),
  project_slug: z.string().optional(),
  platform: z.string().optional(),
  level: z.string().optional(),
  environment: z.string().optional(),
  release: z.string().optional(),
  timestamp: z.string().or(z.number()),
  received: z.number().optional(),
  title: z.string().optional(),
  message: z.string().optional(),
  culprit: z.string().optional(),
  tags: z.array(z.tuple([z.string(), z.string()])).optional(),
  exception: z
    .object({
      values: z.array(ExceptionValueSchema).optional(),
    })
    .optional(),
  breadcrumbs: z
    .object({
      values: z.array(BreadcrumbSchema).optional(),
    })
    .optional(),
  contexts: z.record(z.unknown()).optional(),
  user: UserSchema.optional(),
  request: z
    .object({
      url: z.string().optional(),
      method: z.string().optional(),
      headers: z.record(z.string()).optional(),
      query_string: z.string().optional(),
    })
    .optional(),
  extra: z.record(z.unknown()).optional(),
  fingerprint: z.array(z.string()).optional(),
});

/**
 * Sentry webhook payload (top-level)
 */
export const SentryWebhookPayloadSchema = z.object({
  action: z.string(),
  data: z.object({
    event: SentryEventDataSchema,
    triggered_rule: z.string().optional(),
  }),
  actor: z
    .object({
      type: z.string(),
      id: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  installation: z
    .object({
      uuid: z.string(),
    })
    .optional(),
});

// ============================================================================
// TYPESCRIPT TYPES (Inferred from Zod)
// ============================================================================

export type StackFrame = z.infer<typeof StackFrameSchema>;
export type ExceptionValue = z.infer<typeof ExceptionValueSchema>;
export type Breadcrumb = z.infer<typeof BreadcrumbSchema>;
export type SentryUser = z.infer<typeof UserSchema>;
export type SentryEventData = z.infer<typeof SentryEventDataSchema>;
export type SentryWebhookPayload = z.infer<typeof SentryWebhookPayloadSchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate and parse Sentry webhook payload
 * @throws ZodError if validation fails
 */
export function parseSentryWebhook(data: unknown): SentryWebhookPayload {
  return SentryWebhookPayloadSchema.parse(data);
}

/**
 * Safe parse that returns null on failure
 */
export function safeParseSentryWebhook(
  data: unknown
): SentryWebhookPayload | null {
  const result = SentryWebhookPayloadSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Validate webhook signature (HMAC-SHA256)
 */
export function validateSentrySignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const crypto = require("crypto");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

---

## Database Model Types

```typescript
// src/types/models.ts

/**
 * Organization plan tiers
 */
export type PlanTier = "free" | "pro" | "enterprise";

/**
 * Job processing status
 */
export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Organization model
 */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: PlanTier;
  github_installation_id: number | null;
  sentry_organization_slug: string | null;
  settings: OrganizationSettings;
  created_at: Date;
  updated_at: Date;
}

export interface OrganizationSettings {
  slack_channel?: string;
  default_branch?: string;
  auto_analyze?: boolean;
  notification_level?: "all" | "high" | "none";
}

/**
 * Stored Sentry event
 */
export interface Event {
  id: string;
  org_id: string;
  sentry_event_id: string;
  sentry_project_slug: string | null;
  message: string;
  platform: string | null;
  level: string | null;
  environment: string | null;
  fingerprint: string | null;
  tags: Record<string, string>;
  raw_payload: SentryEventData;
  received_at: Date;
  created_at: Date;
}

/**
 * RCA job record
 */
export interface RCAJob {
  id: string;
  org_id: string;
  event_id: string;
  status: JobStatus;
  priority: number;
  error_message: string | null;
  retry_count: number;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * RCA result record
 */
export interface RCAResult {
  id: string;
  org_id: string;
  event_id: string;
  root_cause: string;
  confidence: number;
  suggested_fix: string | null;
  evidence_summary: EvidenceSummary;
  deterministic_findings: DeterministicFinding[];
  llm_response: LLMResponse | null;
  llm_model: string | null;
  llm_tokens_used: number | null;
  llm_cost_usd: number | null;
  execution_time_ms: number | null;
  user_feedback: -1 | 0 | 1 | null;
  created_at: Date;
}

/**
 * Repository record
 */
export interface Repo {
  id: string;
  org_id: string;
  full_name: string;
  github_installation_id: number | null;
  default_branch: string;
  is_private: boolean;
  last_analyzed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Integration record
 */
export interface Integration {
  id: string;
  org_id: string;
  type: "sentry" | "github" | "slack";
  enabled: boolean;
  config: IntegrationConfig;
  created_at: Date;
  updated_at: Date;
}

export type IntegrationConfig =
  | SentryIntegrationConfig
  | GitHubIntegrationConfig
  | SlackIntegrationConfig;

export interface SentryIntegrationConfig {
  webhook_secret: string;
  organization_slug: string;
}

export interface GitHubIntegrationConfig {
  installation_id: number;
  app_id: number;
}

export interface SlackIntegrationConfig {
  webhook_url: string;
  channel: string;
  bot_token?: string;
}

/**
 * Cost metrics record
 */
export interface CostMetrics {
  id: string;
  org_id: string;
  date: Date;
  rca_count: number;
  rca_success_count: number;
  rca_failure_count: number;
  llm_tokens_input: number;
  llm_tokens_output: number;
  llm_cost_usd: number;
  github_api_calls: number;
  github_cache_hits: number;
  evidence_storage_bytes: number;
  created_at: Date;
  updated_at: Date;
}
```

---

## Evidence Types

```typescript
// src/types/evidence.ts
import { z } from "zod";

// ============================================================================
// ERROR INFO
// ============================================================================

export interface ErrorInfo {
  message: string;
  type: string;
  value: string;
  stack_trace: NormalizedStackFrame[];
  tags: Record<string, string>;
  fingerprint?: string;
  timestamp: string;
}

export interface NormalizedStackFrame {
  file: string;
  line: number;
  column?: number;
  function: string;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  in_app: boolean;
}

// ============================================================================
// CODE CONTEXT
// ============================================================================

export interface CodeContext {
  frames: CodeContextFrame[];
  files_fetched: number;
  files_available: number;
}

export interface CodeContextFrame {
  file: string;
  line?: number;
  snippet?: string;
  full_file?: string;
  highlighted_line?: string;
  language?: string;
  error?: string;
}

// ============================================================================
// TIMELINE
// ============================================================================

export interface Timeline {
  events: TimelineEvent[];
  duration_ms: number;
  error_timestamp?: string;
}

export interface TimelineEvent {
  timestamp: string;
  category: string;
  message: string;
  level: string;
  data: Record<string, unknown>;
  relative_ms: number;
}

// ============================================================================
// COMMIT INFO
// ============================================================================

export interface CommitInfo {
  sha: string;
  short_sha: string;
  message: string;
  author: string;
  date: string;
  files_changed: number;
}

// ============================================================================
// AST FINDINGS (Deterministic)
// ============================================================================

export const DeterministicFindingSchema = z.object({
  rule_id: z.string(),
  title: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  confidence: z.number().min(0).max(1),
  message: z.string(),
  line_start: z.number(),
  line_end: z.number(),
  column_start: z.number().optional(),
  column_end: z.number().optional(),
  code_snippet: z.string(),
  suggested_fix: z.string().optional(),
  explanation: z.string().optional(),
});

export type DeterministicFinding = z.infer<typeof DeterministicFindingSchema>;

// ============================================================================
// EVIDENCE METADATA
// ============================================================================

export interface EvidenceMetadata {
  confidence: number;
  completeness: number;
  gaps: string[];
  sources: {
    error: boolean;
    code: boolean;
    ast: boolean;
    timeline: boolean;
    commits: boolean;
  };
}

// ============================================================================
// EVIDENCE BUNDLE (Complete)
// ============================================================================

export interface EvidenceBundle {
  errorInfo: ErrorInfo;
  codeContext: CodeContext;
  timeline: Timeline;
  commits: CommitInfo[];
  astFindings: DeterministicFinding[];
  metadata: EvidenceMetadata;
}

// ============================================================================
// EVIDENCE SUMMARY (Stored in DB)
// ============================================================================

export interface EvidenceSummary {
  error_type: string;
  error_message: string;
  files_analyzed: number;
  deterministic_findings_count: number;
  top_finding: string | null;
  timeline_events_count: number;
  recent_commits_count: number;
  confidence: number;
}
```

---

## RCA Types

```typescript
// src/types/rca.ts
import { z } from "zod";

// ============================================================================
// LLM RESPONSE SCHEMA
// ============================================================================

export const LLMResponseSchema = z.object({
  root_cause: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  evidence_citations: z.array(
    z.object({
      type: z.enum([
        "code",
        "stack_trace",
        "timeline",
        "commit",
        "ast_finding",
      ]),
      reference: z.string(),
      relevance: z.string(),
    })
  ),
  suggested_fix: z.object({
    description: z.string(),
    code: z.string().optional(),
    file: z.string().optional(),
    line: z.number().optional(),
  }),
  related_issues: z.array(z.string()).optional(),
  prevention_advice: z.string().optional(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

// ============================================================================
// RCA OUTPUT
// ============================================================================

export interface RCAOutput {
  rootCause: string;
  confidence: number;
  suggestedFix: string;
  reasoning: string;
  evidenceSummary: EvidenceSummary;
  tokensUsed: number;
  cost: number;
  model: string;
  llmResponse: LLMResponse;
}

// ============================================================================
// RCA REQUEST/RESPONSE
// ============================================================================

export interface GenerateRCARequest {
  evidence: EvidenceBundle;
  options?: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
  };
}

export interface GenerateRCAResponse {
  success: boolean;
  rca?: RCAOutput;
  error?: string;
  executionTimeMs: number;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate LLM response against schema
 */
export function validateLLMResponse(data: unknown): LLMResponse {
  return LLMResponseSchema.parse(data);
}

/**
 * Safe parse LLM response
 */
export function safeParseLLMResponse(data: unknown): LLMResponse | null {
  const result = LLMResponseSchema.safeParse(data);
  if (!result.success) {
    console.error("LLM response validation failed:", result.error.errors);
    return null;
  }
  return result.data;
}
```

---

## GitHub Types

```typescript
// src/types/github.ts
import { z } from "zod";

// ============================================================================
// WEBHOOK SCHEMAS
// ============================================================================

export const InstallationPayloadSchema = z.object({
  action: z.enum([
    "created",
    "deleted",
    "suspend",
    "unsuspend",
    "new_permissions_accepted",
  ]),
  installation: z.object({
    id: z.number(),
    account: z.object({
      login: z.string(),
      id: z.number(),
      type: z.enum(["User", "Organization"]),
    }),
    app_id: z.number(),
  }),
  repositories: z
    .array(
      z.object({
        id: z.number(),
        full_name: z.string(),
        private: z.boolean(),
        default_branch: z.string().optional(),
      })
    )
    .optional(),
  sender: z
    .object({
      login: z.string(),
      id: z.number(),
    })
    .optional(),
});

export const RepositoryEventSchema = z.object({
  action: z.enum(["added", "removed", "renamed"]),
  installation: z.object({
    id: z.number(),
  }),
  repositories_added: z
    .array(
      z.object({
        id: z.number(),
        full_name: z.string(),
        private: z.boolean(),
      })
    )
    .optional(),
  repositories_removed: z
    .array(
      z.object({
        id: z.number(),
        full_name: z.string(),
      })
    )
    .optional(),
});

export type InstallationPayload = z.infer<typeof InstallationPayloadSchema>;
export type RepositoryEvent = z.infer<typeof RepositoryEventSchema>;

// ============================================================================
// API TYPES
// ============================================================================

export interface GitHubFile {
  path: string;
  content: string;
  sha: string;
  size: number;
  encoding: "base64" | "utf-8";
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  files?: Array<{
    filename: string;
    status: "added" | "modified" | "removed";
    additions: number;
    deletions: number;
  }>;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}

// ============================================================================
// SERVICE TYPES
// ============================================================================

export interface FetchFileOptions {
  orgId: string;
  repo: string;
  ref: string;
  filePath: string;
}

export interface FetchFileResult {
  content: string;
  sha: string;
  fromCache: "redis" | "s3" | false;
}

export interface RepoInput {
  fullName: string;
  defaultBranch: string;
  private: boolean;
}
```

---

## Config Types

```typescript
// src/types/config.ts
import { z } from "zod";

/**
 * Environment configuration schema
 */
export const ConfigSchema = z.object({
  // Server
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default("0.0.0.0"),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // AWS
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_EVIDENCE_BUCKET: z.string().optional(),
  S3_CODE_CACHE_BUCKET: z.string().optional(),

  // GitHub App
  GITHUB_APP_ID: z.coerce.number().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // Sentry
  SENTRY_WEBHOOK_SECRET: z.string().optional(),

  // LLM
  LLM_PROVIDER: z.enum(["openai", "deepseek"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  LLM_BASE_URL: z.string().url().optional(),

  // Slack
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // App
  APP_URL: z.string().url().default("http://localhost:3000"),
  ALLOW_DEV_ERRORS: z.coerce.boolean().default(false),

  // Limits
  EVIDENCE_MAX_FRAMES: z.coerce.number().default(5),
  CODE_CONTEXT_LINES: z.coerce.number().default(15),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Validate environment configuration
 */
export function validateConfig(env: NodeJS.ProcessEnv): Config {
  const result = ConfigSchema.safeParse(env);

  if (!result.success) {
    console.error("Configuration validation failed:");
    result.error.errors.forEach((err) => {
      console.error(`  ${err.path.join(".")}: ${err.message}`);
    });
    throw new Error("Invalid configuration");
  }

  return result.data;
}
```

---

## Type Guards

```typescript
// src/types/guards.ts

import { JobStatus, PlanTier } from "./models";

/**
 * Type guard for job status
 */
export function isValidJobStatus(status: string): status is JobStatus {
  return ["pending", "processing", "completed", "failed", "cancelled"].includes(
    status
  );
}

/**
 * Type guard for plan tier
 */
export function isValidPlanTier(plan: string): plan is PlanTier {
  return ["free", "pro", "enterprise"].includes(plan);
}

/**
 * Type guard for checking if value is non-null
 */
export function isNotNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Type guard for checking if error has message
 */
export function isErrorWithMessage(
  error: unknown
): error is { message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  );
}

/**
 * Extract error message safely
 */
export function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}
```

---

## Usage Examples

```typescript
// Validating webhook payload
import { parseSentryWebhook, SentryWebhookPayload } from "./types/sentry";

app.post("/webhooks/sentry", async (req, reply) => {
  let payload: SentryWebhookPayload;

  try {
    payload = parseSentryWebhook(req.body);
  } catch (error) {
    logger.warn({ error }, "Invalid Sentry webhook payload");
    return reply.status(400).send({ error: "Invalid payload" });
  }

  // payload is now fully typed
  const eventId = payload.data.event.event_id;
  const message = payload.data.event.message;
  // ...
});

// Using type guards
import { isNotNull, getErrorMessage } from "./types/guards";

const results = await Promise.all(files.map(fetchFile));
const successfulResults = results.filter(isNotNull);

try {
  await processData(data);
} catch (error) {
  logger.error({ error: getErrorMessage(error) }, "Processing failed");
}
```
# Integration Schema & GitHub Access Strategy

## Database Schema Overview

### Integrations Table Columns

```sql
CREATE TABLE integrations (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL,                    -- 'github_app', 'github', 'slack', etc.

  -- Legacy column (being phased out)
  config JSONB,                          -- Old unstructured config (nullable now)

  -- New structured columns
  status TEXT NOT NULL DEFAULT 'connected',     -- 'connected', 'disconnected', 'error'
  display_name TEXT,                            -- Human-readable name
  external_id TEXT,                             -- Provider's installation/team ID
  encrypted_tokens JSONB NOT NULL,              -- Encrypted OAuth tokens
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,  -- Non-sensitive integration data

  -- State tracking
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Column Use Cases

#### 1. **`config` (DEPRECATED - Legacy)**

- **Purpose**: Originally stored ALL integration data (tokens + metadata)
- **Problem**: Mixed sensitive and non-sensitive data, hard to query
- **Current State**: Nullable, being phased out
- **Migration**: New integrations use `encrypted_tokens` + `metadata`

#### 2. **`encrypted_tokens` (REQUIRED)**

- **Purpose**: Store OAuth tokens and secrets securely
- **Format**: JSONB encrypted with org-specific key
- **Example**:
  ```json
  {
    "data": "ENCRYPTED_BASE64_STRING",
    "encryptedAt": "2025-12-27T22:00:00Z",
    "keyVersion": "1"
  }
  ```
- **Contents (decrypted)**:
  ```json
  {
    "access_token": "ghp_xxx",
    "refresh_token": "ghr_xxx", // If applicable
    "expires_at": 1735344000 // Unix timestamp
  }
  ```

#### 3. **`metadata` (REQUIRED)**

- **Purpose**: Store non-sensitive integration data that's queryable
- **Format**: JSONB (unencrypted)
- **Examples**:

  **GitHub App:**

  ```json
  {
    "installationId": 101500883,
    "accountLogin": "YourOrg",
    "accountId": 12345,
    "accountType": "Organization",
    "permissions": {
      "contents": "read",
      "metadata": "read"
    },
    "repositorySelection": "all",
    "selectedRepos": ["owner/repo1", "owner/repo2"]
  }
  ```

  **Slack:**

  ```json
  {
    "teamId": "T123456",
    "teamName": "Engineering",
    "channel": "#errors",
    "webhookUrl": "https://hooks.slack.com/..."
  }
  ```

#### 4. **`display_name`**

- **Purpose**: Human-readable label for multi-integration scenarios
- **Examples**:
  - "GitHub (YourOrg repos)"
  - "GitHub (Personal)"
  - "Slack (#engineering)"
  - "Slack (#production)"

#### 5. **`external_id`**

- **Purpose**: Provider's unique identifier for this integration
- **Examples**:
  - GitHub App: `"101500883"` (installation_id)
  - Slack: `"T123456"` (team_id)
  - Jira: `"cloud-id-xxx"` (cloud_id)
- **Use Case**: Prevents duplicate installations, enables lookups

#### 6. **`status`**

- **Purpose**: Current connection state
- **Values**:
  - `connected`: Working and verified
  - `disconnected`: User manually disconnected
  - `error`: Token expired or API error
- **Note**: Currently using `is_active` instead (will migrate later)

#### 7. **`is_active`**

- **Purpose**: Boolean flag for active/inactive state
- **Current Use**: Primary source of truth (overrides `status` column)
- **Logic**:
  - `true` → Show "Disconnect" button
  - `false` → Show "Connect" button

---

## GitHub Integration Strategy

### Three GitHub Integration Types

#### 1. **GitHub OAuth App** (User-Level Access)

- **Type in DB**: `github`
- **Scope**: User's personal repos + orgs they belong to
- **Use Case**: Initial MVP, simple setup
- **Token**: User access token (long-lived)
- **Permissions**: Whatever user has on repos
- **Stored in**: `encrypted_tokens`
  ```json
  {
    "access_token": "ghp_usertoken",
    "login": "username",
    "repos": ["user/repo1", "user/repo2"]
  }
  ```

#### 2. **GitHub App** (Org-Level Access) ⭐ **RECOMMENDED**

- **Type in DB**: `github_app`
- **Scope**: Org repos or specific repos
- **Use Case**: Production (better security, fine-grained permissions)
- **Token**: Installation access token (expires hourly, auto-refreshed)
- **Permissions**: Configured at app level (`contents: read`)
- **Stored in**: `encrypted_tokens` + `metadata`

  ```json
  // encrypted_tokens (decrypted)
  {
    "access_token": "ghs_installationtoken",
    "expires_at": 1735344000
  }

  // metadata
  {
    "installationId": 101500883,
    "accountLogin": "YourOrg",
    "permissions": {"contents": "read"}
  }
  ```

#### 3. **GitHub App + JWT** (Platform-Level)

- **Type**: Backend service authentication
- **Use Case**: Buglens backend generates installation tokens on-demand
- **Storage**: Private key in environment variable
- **Process**:
  1. Backend has GitHub App private key
  2. Creates JWT signed with private key
  3. Exchanges JWT for installation access token
  4. Uses token to fetch code
  5. Token expires in 1 hour, regenerate as needed

---

## Code Fetcher Requirements

### What We Need to Fetch Code

The **CodeFetcher** needs to access:

1. **Repository content** (`GET /repos/{owner}/{repo}/contents/{path}`)
2. **Specific commit/ref** (`?ref={sha}`)
3. **Base64 decode** file content

### Required GitHub Permissions

```
contents: read    ✅ REQUIRED - Read repository files
metadata: read    ✅ INCLUDED - Repository metadata
```

### All Three Integration Types Work! ✅

| Integration Type          | Code Fetcher Compatible? | How It Works                                          |
| ------------------------- | ------------------------ | ----------------------------------------------------- |
| **GitHub OAuth App**      | ✅ YES                   | User token → Fetch any repo user has access to        |
| **GitHub App**            | ✅ YES                   | Installation token → Fetch org/repo files             |
| **GitHub App (Platform)** | ✅ YES                   | Backend generates tokens → Fetch using installationId |

### Current Implementation (Platform GitHub App)

**Flow:**

1. User installs GitHub App on their org/repos
2. Backend stores `installation_id` in `metadata.installationId`
3. When code is needed:
   ```typescript
   const installationId = await getInstallationId(orgId, repoFullName);
   const token = await getInstallationAccessToken(installationId);
   const fileContent = await fetchFileContent(token, owner, repo, path, ref);
   ```

**Code Reference:**

```typescript
// src/services/github.ts
export async function fetchFileContent(
  installationId: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  orgId: string
): Promise<GitHubFileContent | null> {
  const octokit = await getInstallationOctokit(installationId);

  const response = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
    ref, // commit SHA
  });

  return response.data; // Base64 encoded content
}
```

---

## RCA Process Integration Points

### 1. **Sentry Webhook** → Event Received

```
Event includes:
- error message
- stack trace (file paths, line numbers)
- release tag (contains commit SHA)
- project name
```

### 2. **Extract Repository Info**

```typescript
// From event.release: "myapp@abc123def"
const commitSha = extractCommitFromRelease(event.release);

// From integration: "YourOrg/myapp"
const repo = await getRepoForProject(orgId, event.project);
```

### 3. **Fetch Code for Stack Frames**

```typescript
const installationId = await getInstallationId(orgId, repo);

for (const frame of event.stacktrace.frames) {
  const codeContext = await codeFetcherService.fetchCodeForFrame(frame, {
    orgId,
    installationId,
    repo,
    ref: commitSha,
  });
}
```

### 4. **Requirements Met?** ✅

| Requirement                          | GitHub App Provides            | Status |
| ------------------------------------ | ------------------------------ | ------ |
| Read file content at specific commit | `repos.getContent({ref: sha})` | ✅     |
| Access private repos                 | Installation permissions       | ✅     |
| Handle source maps                   | Fetch `.map` files             | ✅     |
| Rate limiting                        | 5000/hr per installation       | ✅     |
| Caching                              | 3-tier cache (Redis→S3→DB)     | ✅     |

---

## Decision: Use GitHub App (Platform)

### Why GitHub App > OAuth App?

| Feature            | GitHub OAuth App   | GitHub App                          |
| ------------------ | ------------------ | ----------------------------------- |
| **Scope**          | User-level         | Org/repo-level                      |
| **Permissions**    | User's permissions | Fine-grained (`contents:read` only) |
| **Token Lifetime** | No expiration      | 1 hour (auto-refresh)               |
| **Revocation**     | User can revoke    | Admin controls                      |
| **Rate Limit**     | 5000/hr shared     | 5000/hr per installation            |
| **Security**       | User token in DB   | Installation tokens short-lived     |
| **Multi-Org**      | Separate per user  | Per org installation                |

### Current Implementation Status

✅ **GitHub App is implemented and working**

- Installation ID stored in `metadata.installationId`
- Backend generates short-lived tokens using App private key
- CodeFetcher uses `installationId` to fetch files
- Frontend normalizes `github_app` → `github` for display

### Column Usage Summary

```typescript
// When GitHub App is installed:
INSERT INTO integrations (
  org_id: "uuid",
  type: "github_app",                    // Backend type
  external_id: "101500883",              // Installation ID
  display_name: "GitHub (YourOrg)",      // UI label
  status: "connected",                   // Connection state
  is_active: true,                       // Active flag ⭐ SOURCE OF TRUTH
  encrypted_tokens: {                    // Sensitive data
    data: "ENCRYPTED_ACCESS_TOKEN",
    expiresAt: 1735344000
  },
  metadata: {                            // Queryable data
    installationId: 101500883,
    accountLogin: "YourOrg",
    accountType: "Organization",
    permissions: {"contents": "read"},
    repositorySelection: "all"
  }
)

// Frontend sees:
{
  id: "uuid",
  type: "github",                        // Normalized from github_app
  name: "GitHub",
  status: "connected"                    // Computed from is_active
}
```

---

## Recommendations

### Short Term (Current)

1. ✅ Use `is_active` as source of truth for connection status
2. ✅ Keep `status` column for future use
3. ✅ Normalize `github_app` → `github` in API responses
4. ✅ Store installation tokens in `encrypted_tokens`
5. ✅ Store installation metadata in `metadata`

### Long Term (Phase 2)

1. Migrate away from `config` column entirely
2. Use `status` column for richer states (expiring, refreshing, etc.)
3. Add `status_details` JSONB for error messages/diagnostics
4. Implement token refresh monitoring
5. Add webhook for installation events (repo added/removed)

### For Multi-Integration Support

```sql
-- Allow multiple GitHub installations per org
UNIQUE (org_id, type, external_id)

-- Example: Multiple Slack workspaces
INSERT INTO integrations (org_id, type, external_id, display_name)
VALUES
  ('org1', 'slack', 'T123', 'Slack (#engineering)'),
  ('org1', 'slack', 'T456', 'Slack (#production)');
```

---

## Conclusion

**All three GitHub integration types work for code fetching**, but **GitHub App (Platform)** is the best choice for production:

- ✅ Fine-grained permissions
- ✅ Better security (short-lived tokens)
- ✅ Org-level control
- ✅ Higher rate limits
- ✅ Already implemented and working

The schema supports future expansion with `metadata` for queryable data and `encrypted_tokens` for secrets.
