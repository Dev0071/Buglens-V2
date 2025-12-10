# 03 - Code Fetcher

## Overview

The Code Fetcher is responsible for retrieving source code from GitHub repositories for stack trace analysis. It implements a **3-tier caching strategy** to minimize GitHub API calls and avoid rate limiting.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CODE FETCHER                                        │
│                                                                              │
│  Input: StackFrame { file_path, line_number, repo, commit_sha }             │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         3-TIER CACHE                                   │ │
│  │                                                                        │ │
│  │   ┌─────────────────────────────────────────────────────────────────┐ │ │
│  │   │  TIER 1: REDIS (Hot Cache)                                      │ │ │
│  │   │  ─────────────────────────                                      │ │ │
│  │   │  • TTL: 1 hour                                                  │ │ │
│  │   │  • Key: gh:file:{org}:{repo}:{sha}:{path}                       │ │ │
│  │   │  • Latency: ~1ms                                                │ │ │
│  │   │  • For: Recently accessed files                                 │ │ │
│  │   │                                                                 │ │ │
│  │   │  ┌─── HIT ──▶ Return immediately                               │ │ │
│  │   │  │                                                              │ │ │
│  │   │  └─── MISS ─▶ Continue to Tier 2                               │ │ │
│  │   └─────────────────────────────────────────────────────────────────┘ │ │
│  │                              │                                         │ │
│  │                              ▼                                         │ │
│  │   ┌─────────────────────────────────────────────────────────────────┐ │ │
│  │   │  TIER 2: S3 (Warm Cache)                                        │ │ │
│  │   │  ──────────────────────                                         │ │ │
│  │   │  • TTL: 7 days                                                  │ │ │
│  │   │  • Path: cache/github/{org}/{repo}/{sha}/{path}.gz              │ │ │
│  │   │  • Compression: gzip                                            │ │ │
│  │   │  • Latency: ~50-100ms                                           │ │ │
│  │   │  • For: Cross-instance sharing, persistence                     │ │ │
│  │   │                                                                 │ │ │
│  │   │  ┌─── HIT ──▶ Populate Redis ──▶ Return                        │ │ │
│  │   │  │                                                              │ │ │
│  │   │  └─── MISS ─▶ Continue to Tier 3                               │ │ │
│  │   └─────────────────────────────────────────────────────────────────┘ │ │
│  │                              │                                         │ │
│  │                              ▼                                         │ │
│  │   ┌─────────────────────────────────────────────────────────────────┐ │ │
│  │   │  TIER 3: DATABASE (code_snapshots table)                        │ │ │
│  │   │  ─────────────────────────────────────                          │ │ │
│  │   │  • TTL: Indefinite (commit-based)                               │ │ │
│  │   │  • Latency: ~5-20ms                                             │ │ │
│  │   │  • For: Permanent storage by commit SHA                         │ │ │
│  │   │                                                                 │ │ │
│  │   │  ┌─── HIT ──▶ Populate S3 + Redis ──▶ Return                   │ │ │
│  │   │  │                                                              │ │ │
│  │   │  └─── MISS ─▶ Continue to GitHub API                           │ │ │
│  │   └─────────────────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                              │                                               │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                       GITHUB API (Last Resort)                         │ │
│  │                                                                        │ │
│  │  • Rate limit: 5000/hour per installation                             │ │
│  │  • Endpoint: GET /repos/{owner}/{repo}/contents/{path}?ref={sha}      │ │
│  │  • Response: Base64 encoded content                                   │ │
│  │                                                                        │ │
│  │  ┌─── SUCCESS ──▶ Populate ALL caches ──▶ Return                      │ │
│  │  │                                                                    │ │
│  │  └─── ERROR ──▶ Return error or source map fallback                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  Output: { content: string, source: 'redis'|'s3'|'database'|'github' }      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                           | Purpose                     |
| ------------------------------ | --------------------------- |
| `src/services/code-fetcher.ts` | Main code fetcher service   |
| `src/services/cache.ts`        | 3-tier cache implementation |
| `src/services/github.ts`       | GitHub API integration      |
| `src/types/github.ts`          | Type definitions            |

---

## Code Fetcher Service

### Class Structure

```typescript
// src/services/code-fetcher.ts
export class CodeFetcher {
  private cache: CacheService;
  private github: GitHubService;

  constructor(deps?: { cache?: CacheService; github?: GitHubService }) {
    this.cache = deps?.cache ?? new CacheService();
    this.github = deps?.github ?? new GitHubService();
  }

  async fetchCodeForFrame(params: FetchParams): Promise<CodeFetchResult> {
    const { orgId, repo, commitSha, filePath } = params;

    // Validate and clean file path
    const cleanedPath = this.cleanFilePath(filePath);
    this.validateFilePath(cleanedPath);

    // Try 3-tier cache
    const cached = await this.cache.get(orgId, repo, commitSha, cleanedPath);
    if (cached) {
      return { content: cached.content, source: cached.source, cached: true };
    }

    // Fetch from GitHub
    const content = await this.fetchFromGitHub(
      orgId,
      repo,
      commitSha,
      cleanedPath
    );

    // Store in all cache tiers
    await this.cache.store(orgId, repo, commitSha, cleanedPath, content);

    return { content, source: "github", cached: false };
  }
}
```

### File Path Cleaning

Stack traces often contain non-standard paths that need normalization:

```typescript
private cleanFilePath(rawPath: string): string {
  let path = rawPath;

  // 1. Remove webpack:// prefix
  path = path.replace(/^webpack:\/\/[^/]*\//, '');

  // 2. Remove file:// prefix
  path = path.replace(/^file:\/\//, '');

  // 3. Remove container paths
  const containerPatterns = [
    '/var/task/',          // AWS Lambda
    '/app/',               // Docker common
    '/home/runner/work/',  // GitHub Actions
    '/opt/nodejs/',        // Lambda layers
  ];
  for (const prefix of containerPatterns) {
    if (path.startsWith(prefix)) {
      path = path.slice(prefix.length);
      break;
    }
  }

  // 4. Normalize to repo-relative path
  const srcIndex = path.indexOf('src/');
  if (srcIndex > 0) {
    path = path.slice(srcIndex);
  }

  // 5. Remove leading slashes
  path = path.replace(/^\/+/, '');

  return path;
}
```

### Path Traversal Protection

```typescript
private readonly PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//, // ../
  /\.\.\\/, // ..\\
  /^\/etc\//i,
  /^\/var\//i,
  /^\/proc\//i,
  /\0/, // null bytes
];

private validateFilePath(filePath: string): void {
  for (const pattern of this.PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(filePath)) {
      logger.warn({ filePath }, 'Path traversal attempt detected');
      throw new Error('Invalid file path: potential path traversal');
    }
  }

  // Must be relative path
  if (filePath.startsWith('/')) {
    throw new Error('Absolute paths not allowed');
  }
}
```

---

## 3-Tier Cache Service

### Cache Key Structure

```typescript
// Redis key
const redisKey = `gh:file:${orgId}:${repo}:${sha}:${path}`;

// S3 path
const s3Path = `cache/github/${orgId}/${repo}/${sha}/${sanitizePath(path)}.gz`;

// Database query
const dbQuery = `
  SELECT content FROM code_snapshots
  WHERE org_id = $1 AND repo_full_name = $2 AND commit_sha = $3 AND file_path = $4
`;
```

### Implementation

```typescript
// src/services/cache.ts
export class CacheService {
  private redis: Redis;
  private s3: S3Client;

  async get(
    orgId: string,
    repo: string,
    sha: string,
    path: string
  ): Promise<CacheResult | null> {
    // Tier 1: Redis
    const redisKey = this.buildRedisKey(orgId, repo, sha, path);
    const redisResult = await this.redis.get(redisKey);
    if (redisResult) {
      return { content: redisResult, source: "redis" };
    }

    // Tier 2: S3
    const s3Result = await this.getFromS3(orgId, repo, sha, path);
    if (s3Result) {
      // Populate Redis
      await this.setRedis(redisKey, s3Result, 3600); // 1 hour
      return { content: s3Result, source: "s3" };
    }

    // Tier 3: Database
    const dbResult = await this.getFromDatabase(orgId, repo, sha, path);
    if (dbResult) {
      // Populate S3 and Redis
      await this.storeInS3(orgId, repo, sha, path, dbResult);
      await this.setRedis(redisKey, dbResult, 3600);
      return { content: dbResult, source: "database" };
    }

    return null;
  }

  async store(
    orgId: string,
    repo: string,
    sha: string,
    path: string,
    content: string
  ): Promise<void> {
    // Store in all tiers in parallel
    await Promise.all([
      this.setRedis(this.buildRedisKey(orgId, repo, sha, path), content, 3600),
      this.storeInS3(orgId, repo, sha, path, content),
      this.storeInDatabase(orgId, repo, sha, path, content),
    ]);
  }
}
```

### S3 Storage (Gzip Compressed)

```typescript
private async storeInS3(
  orgId: string,
  repo: string,
  sha: string,
  path: string,
  content: string
): Promise<void> {
  const s3Path = this.buildS3Path(orgId, repo, sha, path);

  // Compress content
  const compressed = await gzip(Buffer.from(content, 'utf-8'));

  await this.s3.send(new PutObjectCommand({
    Bucket: config.S3_BUCKET_NAME,
    Key: s3Path,
    Body: compressed,
    ContentEncoding: 'gzip',
    ContentType: 'text/plain',
    Metadata: {
      'x-buglens-org-id': orgId,
      'x-buglens-repo': repo,
      'x-buglens-sha': sha,
    },
  }));
}

private async getFromS3(
  orgId: string,
  repo: string,
  sha: string,
  path: string
): Promise<string | null> {
  const s3Path = this.buildS3Path(orgId, repo, sha, path);

  try {
    const response = await this.s3.send(new GetObjectCommand({
      Bucket: config.S3_BUCKET_NAME,
      Key: s3Path,
    }));

    const body = await response.Body?.transformToByteArray();
    if (!body) return null;

    // Decompress
    const decompressed = await gunzip(Buffer.from(body));
    return decompressed.toString('utf-8');
  } catch (error) {
    if (error.name === 'NoSuchKey') return null;
    throw error;
  }
}
```

### Database Storage

```typescript
private async storeInDatabase(
  orgId: string,
  repo: string,
  sha: string,
  path: string,
  content: string
): Promise<void> {
  await pool.query(`
    INSERT INTO code_snapshots (org_id, repo_full_name, commit_sha, file_path, content)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (org_id, repo_full_name, commit_sha, file_path)
    DO UPDATE SET content = $5, updated_at = NOW()
  `, [orgId, repo, sha, path, content]);
}
```

---

## Source Map Resolution

When the fetched file is minified, we attempt to resolve the original source:

```typescript
import { SourceMapConsumer } from "source-map";

export class CodeFetcher {
  async fetchWithSourceMap(params: FetchParams): Promise<CodeFetchResult> {
    const result = await this.fetchCodeForFrame(params);

    // Check if content looks minified
    if (!this.looksMinified(result.content)) {
      return result;
    }

    // Try to fetch source map
    const mapPath = `${params.filePath}.map`;
    try {
      const mapResult = await this.fetchCodeForFrame({
        ...params,
        filePath: mapPath,
      });

      const consumer = await new SourceMapConsumer(mapResult.content);

      // Map to original position
      const original = consumer.originalPositionFor({
        line: params.lineNumber,
        column: params.columnNumber || 0,
      });

      if (original.source) {
        // Fetch the original source
        const originalResult = await this.fetchCodeForFrame({
          ...params,
          filePath: original.source,
        });

        return {
          ...originalResult,
          sourceMapped: true,
          originalLine: original.line,
          originalColumn: original.column,
        };
      }
    } catch (error) {
      logger.debug({ error, path: mapPath }, "Source map resolution failed");
    }

    return result;
  }

  private looksMinified(content: string): boolean {
    const lines = content.split("\n");

    // Minified files typically have very long lines
    const avgLineLength = content.length / lines.length;
    if (avgLineLength > 500) return true;

    // Very few lines for large content
    if (content.length > 10000 && lines.length < 50) return true;

    return false;
  }
}
```

---

## GitHub API Integration

### Fetching File Content

```typescript
private async fetchFromGitHub(
  orgId: string,
  repo: string,
  sha: string,
  path: string
): Promise<string> {
  const octokit = await this.github.getInstallationOctokit(orgId);
  const [owner, repoName] = repo.split('/');

  // Check rate limit before request
  await this.github.checkRateLimit(orgId);

  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo: repoName,
      path,
      ref: sha,
    });

    // Track API call for rate limiting
    await this.github.trackApiCall(orgId);

    if (Array.isArray(response.data)) {
      throw new Error('Path is a directory, not a file');
    }

    if (response.data.type !== 'file') {
      throw new Error(`Unexpected content type: ${response.data.type}`);
    }

    // Decode base64 content
    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
    return content;
  } catch (error) {
    if (error.status === 404) {
      throw new FileNotFoundError(path, repo, sha);
    }
    if (error.status === 403 && error.message.includes('rate limit')) {
      throw new RateLimitError(orgId);
    }
    throw error;
  }
}
```

### Rate Limit Handling

```typescript
async checkRateLimit(orgId: string): Promise<void> {
  const usage = await redis.get(`gh:ratelimit:${orgId}`);
  const plan = await this.getOrgPlan(orgId);
  const limit = RATE_LIMITS[plan].github_api_calls_per_hour;

  if (usage && parseInt(usage) >= limit) {
    throw new RateLimitError(
      `GitHub API rate limit exceeded (${usage}/${limit} calls/hour)`
    );
  }
}

async trackApiCall(orgId: string): Promise<void> {
  const key = `gh:ratelimit:${orgId}`;
  const count = await redis.incr(key);

  // Set expiry on first increment
  if (count === 1) {
    await redis.expire(key, 3600); // 1 hour
  }
}
```

---

## Batch Fetching

For efficiency, we support fetching multiple files in parallel:

```typescript
async fetchBatch(frames: StackFrame[], orgId: string): Promise<Map<string, CodeFetchResult>> {
  const results = new Map<string, CodeFetchResult>();

  // Deduplicate by unique file path
  const uniqueFrames = this.deduplicateFrames(frames);

  // Fetch in parallel with concurrency limit
  const limit = pLimit(5); // Max 5 concurrent requests

  await Promise.all(
    uniqueFrames.map(frame =>
      limit(async () => {
        try {
          const result = await this.fetchCodeForFrame({
            orgId,
            repo: frame.repo,
            commitSha: frame.commitSha,
            filePath: frame.filePath,
            lineNumber: frame.lineNumber,
          });
          results.set(this.frameKey(frame), result);
        } catch (error) {
          logger.warn({ error, frame }, 'Failed to fetch code for frame');
          results.set(this.frameKey(frame), {
            content: null,
            error: error.message,
            cached: false,
          });
        }
      })
    )
  );

  return results;
}
```

---

## Types

```typescript
// src/types/github.ts
export interface FetchParams {
  orgId: string;
  repo: string;
  commitSha: string;
  filePath: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface CodeFetchResult {
  content: string | null;
  source: "redis" | "s3" | "database" | "github";
  cached: boolean;
  sourceMapped?: boolean;
  originalLine?: number;
  originalColumn?: number;
  error?: string;
  fetchDurationMs?: number;
}

export interface CacheResult {
  content: string;
  source: "redis" | "s3" | "database";
}

// Custom errors
export class FileNotFoundError extends Error {
  constructor(
    public readonly path: string,
    public readonly repo: string,
    public readonly sha: string
  ) {
    super(`File not found: ${path} in ${repo}@${sha}`);
    this.name = "FileNotFoundError";
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}
```

---

## Metrics & Monitoring

### Cache Hit Rate

```typescript
async trackCacheMetrics(orgId: string, hit: boolean, tier: string): Promise<void> {
  const date = new Date().toISOString().split('T')[0];
  const key = `cache:metrics:${orgId}:${date}`;

  await redis.hincrby(key, 'total', 1);
  if (hit) {
    await redis.hincrby(key, `hits:${tier}`, 1);
  } else {
    await redis.hincrby(key, 'misses', 1);
  }
}

// Expected: >80% cache hit rate
async getCacheHitRate(orgId: string): Promise<number> {
  const date = new Date().toISOString().split('T')[0];
  const metrics = await redis.hgetall(`cache:metrics:${orgId}:${date}`);

  const total = parseInt(metrics.total || '0');
  const hits = parseInt(metrics['hits:redis'] || '0') +
               parseInt(metrics['hits:s3'] || '0') +
               parseInt(metrics['hits:database'] || '0');

  return total > 0 ? hits / total : 0;
}
```

---

## Testing

```typescript
describe("CodeFetcher", () => {
  describe("cleanFilePath", () => {
    it("removes webpack prefix", () => {
      const fetcher = new CodeFetcher();
      expect(fetcher.cleanFilePath("webpack://myapp/src/index.ts")).toBe(
        "src/index.ts"
      );
    });

    it("removes container paths", () => {
      const fetcher = new CodeFetcher();
      expect(fetcher.cleanFilePath("/var/task/src/handler.ts")).toBe(
        "src/handler.ts"
      );
    });
  });

  describe("validateFilePath", () => {
    it("rejects path traversal", () => {
      const fetcher = new CodeFetcher();
      expect(() => fetcher.validateFilePath("../../../etc/passwd")).toThrow(
        "potential path traversal"
      );
    });
  });

  describe("3-tier cache", () => {
    it("returns from Redis on hit", async () => {
      mockRedis.get.mockResolvedValue("cached content");

      const result = await cache.get(orgId, repo, sha, path);

      expect(result).toEqual({
        content: "cached content",
        source: "redis",
      });
      expect(mockS3.send).not.toHaveBeenCalled();
    });

    it("populates Redis after S3 hit", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockS3.send.mockResolvedValue({ Body: gzippedContent });

      await cache.get(orgId, repo, sha, path);

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.any(String),
        "decompressed content",
        "EX",
        3600
      );
    });
  });
});
```

---

## Performance Considerations

1. **Cache warming**: On first error from a repo, consider pre-fetching common files
2. **Compression**: S3 storage uses gzip to reduce storage costs and transfer time
3. **Batch requests**: Fetch multiple frames in parallel with concurrency limits
4. **Source map caching**: Cache resolved source maps separately from minified files
5. **TTL strategy**:
   - Redis: 1 hour (memory is expensive)
   - S3: 7 days (storage is cheap)
   - Database: Indefinite (commit SHA is immutable)
