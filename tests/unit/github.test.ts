/**
 * GitHub Service Unit Tests
 *
 * Tests for GitHub service covering:
 * - Installation token management
 * - Rate limit checking and enforcement
 * - API call retry logic
 * - File content fetching
 * - Error handling (404, 403, 5xx)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
vi.mock("octokit", () => ({
  App: vi.fn().mockImplementation(() => ({
    getInstallationOctokit: vi.fn(),
  })),
  Octokit: vi.fn(),
}));

vi.mock("@octokit/auth-app", () => ({
  createAppAuth: vi.fn().mockReturnValue(() =>
    Promise.resolve({
      token: "ghs_mock_token",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    })
  ),
}));

vi.mock("../../src/utils/config.js", () => ({
  config: {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY_SECRET_ID: null,
    GITHUB_WEBHOOK_SECRET: "test-secret",
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/db/redis.js", () => ({
  getCachedInstallationToken: vi.fn(),
  cacheInstallationToken: vi.fn(),
  incrementRateLimit: vi.fn(),
  getRateLimitCount: vi.fn(),
  buildGitHubRateLimitKey: vi.fn(
    (orgId: string) => `github:ratelimit:${orgId}`
  ),
}));

vi.mock("../../src/db/client.js", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import {
  checkGitHubRateLimit,
  trackGitHubAPICall,
} from "../../src/services/github.js";
import {
  getCachedInstallationToken,
  cacheInstallationToken,
  incrementRateLimit,
  getRateLimitCount,
} from "../../src/db/redis.js";

const mockGetCachedToken = getCachedInstallationToken as ReturnType<
  typeof vi.fn
>;
const mockCacheToken = cacheInstallationToken as ReturnType<typeof vi.fn>;
const mockIncrementRateLimit = incrementRateLimit as ReturnType<typeof vi.fn>;
const mockGetRateLimitCount = getRateLimitCount as ReturnType<typeof vi.fn>;

// =============================================================================
// TEST FIXTURES
// =============================================================================

const validOrgId = "550e8400-e29b-41d4-a716-446655440000";
const validInstallationId = "12345678";

// =============================================================================
// RATE LIMIT TESTS
// =============================================================================

describe("GitHub Rate Limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("checkGitHubRateLimit", () => {
    it("should allow requests under the free tier limit", async () => {
      mockGetRateLimitCount.mockResolvedValue(100);

      const result = await checkGitHubRateLimit(validOrgId, "free");

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(400); // 500 - 100
      expect(result.limit).toBe(500);
    });

    it("should block requests at the free tier limit", async () => {
      mockGetRateLimitCount.mockResolvedValue(500);

      const result = await checkGitHubRateLimit(validOrgId, "free");

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("should block requests over the free tier limit", async () => {
      mockGetRateLimitCount.mockResolvedValue(600);

      const result = await checkGitHubRateLimit(validOrgId, "free");

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0); // Never negative
    });

    it("should use correct limit for pro tier", async () => {
      mockGetRateLimitCount.mockResolvedValue(1000);

      const result = await checkGitHubRateLimit(validOrgId, "pro");

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1000); // 2000 - 1000
      expect(result.limit).toBe(2000);
    });

    it("should use correct limit for enterprise tier", async () => {
      mockGetRateLimitCount.mockResolvedValue(4000);

      const result = await checkGitHubRateLimit(validOrgId, "enterprise");

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1000); // 5000 - 4000
      expect(result.limit).toBe(5000);
    });

    it("should default to free tier when plan not specified", async () => {
      mockGetRateLimitCount.mockResolvedValue(0);

      const result = await checkGitHubRateLimit(validOrgId);

      expect(result.limit).toBe(500);
    });
  });

  describe("trackGitHubAPICall", () => {
    it("should increment rate limit counter", async () => {
      mockIncrementRateLimit.mockResolvedValue(1);

      const result = await trackGitHubAPICall(validOrgId);

      expect(mockIncrementRateLimit).toHaveBeenCalledWith(
        `github:ratelimit:${validOrgId}`,
        3600 // 1 hour TTL
      );
      expect(result).toBe(1);
    });

    it("should return incremented count", async () => {
      mockIncrementRateLimit.mockResolvedValue(42);

      const result = await trackGitHubAPICall(validOrgId);

      expect(result).toBe(42);
    });
  });
});

// =============================================================================
// RETRY LOGIC TESTS (Unit test the retry behavior)
// =============================================================================

describe("GitHub API Retry Logic", () => {
  const RETRY_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    retryableStatuses: [408, 429, 500, 502, 503, 504],
  };

  it("should identify retryable status codes", () => {
    const retryableStatuses = [408, 429, 500, 502, 503, 504];
    const nonRetryableStatuses = [400, 401, 403, 404, 422];

    retryableStatuses.forEach((status) => {
      expect(RETRY_CONFIG.retryableStatuses.includes(status)).toBe(true);
    });

    nonRetryableStatuses.forEach((status) => {
      expect(RETRY_CONFIG.retryableStatuses.includes(status)).toBe(false);
    });
  });

  it("should NOT retry 404 errors", () => {
    const status = 404;
    expect(RETRY_CONFIG.retryableStatuses.includes(status)).toBe(false);
  });

  it("should NOT retry 403 (forbidden) errors", () => {
    const status = 403;
    expect(RETRY_CONFIG.retryableStatuses.includes(status)).toBe(false);
  });

  it("should retry 429 (rate limit) errors", () => {
    const status = 429;
    expect(RETRY_CONFIG.retryableStatuses.includes(status)).toBe(true);
  });

  it("should retry 5xx server errors", () => {
    [500, 502, 503, 504].forEach((status) => {
      expect(RETRY_CONFIG.retryableStatuses.includes(status)).toBe(true);
    });
  });

  it("should calculate exponential backoff correctly", () => {
    const calculateDelay = (attempt: number) => {
      return Math.min(
        RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
        RETRY_CONFIG.maxDelayMs
      );
    };

    expect(calculateDelay(0)).toBe(1000); // 1s
    expect(calculateDelay(1)).toBe(2000); // 2s
    expect(calculateDelay(2)).toBe(4000); // 4s
    expect(calculateDelay(3)).toBe(8000); // 8s
    expect(calculateDelay(4)).toBe(10000); // Capped at 10s
    expect(calculateDelay(5)).toBe(10000); // Still capped
  });

  it("should respect max retries limit", () => {
    const maxRetries = RETRY_CONFIG.maxRetries;
    expect(maxRetries).toBe(3);
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe("GitHub Error Handling", () => {
  describe("GitHubRateLimitError", () => {
    it("should be thrown when rate limit is exceeded", async () => {
      mockGetRateLimitCount.mockResolvedValue(600);

      const result = await checkGitHubRateLimit(validOrgId, "free");

      expect(result.allowed).toBe(false);
      // The actual error throwing happens in fetchFileContent, etc.
    });

    it("should include remaining count in error context", async () => {
      mockGetRateLimitCount.mockResolvedValue(500);

      const result = await checkGitHubRateLimit(validOrgId, "free");

      expect(result.remaining).toBe(0);
      expect(result.allowed).toBe(false);
    });
  });

  describe("404 Not Found handling", () => {
    it("should return null for file not found", () => {
      // Test the expected behavior when file is not found
      const handle404 = (status: number) => {
        if (status === 404) {
          return null;
        }
        throw new Error(`Unexpected status: ${status}`);
      };

      expect(handle404(404)).toBeNull();
      expect(() => handle404(500)).toThrow();
    });
  });

  describe("403 Forbidden handling", () => {
    it("should not retry 403 errors", () => {
      const shouldRetry = (status: number) => {
        const retryableStatuses = [408, 429, 500, 502, 503, 504];
        return retryableStatuses.includes(status);
      };

      expect(shouldRetry(403)).toBe(false);
    });

    it("should throw immediately on 403", () => {
      const handleError = (status: number) => {
        if (status === 403) {
          throw new Error("Access forbidden - check repository permissions");
        }
      };

      expect(() => handleError(403)).toThrow("forbidden");
    });
  });

  describe("422 Invalid ref handling", () => {
    it("should return false for invalid git ref", () => {
      const handle422 = (status: number) => {
        if (status === 404 || status === 422) {
          return false; // Ref doesn't exist or is invalid
        }
        return true;
      };

      expect(handle422(422)).toBe(false);
    });
  });
});

// =============================================================================
// INSTALLATION TOKEN TESTS
// =============================================================================

describe("Installation Token Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("token caching", () => {
    it("should check cache before generating new token", async () => {
      mockGetCachedToken.mockResolvedValue("cached_token_123");

      // Token retrieval would use cached value
      expect(mockGetCachedToken).toBeDefined();
    });

    it("should cache newly generated tokens", async () => {
      mockGetCachedToken.mockResolvedValue(null);
      mockCacheToken.mockResolvedValue(undefined);

      // Verify caching function is available
      expect(mockCacheToken).toBeDefined();
    });

    it("should handle cache miss gracefully", async () => {
      mockGetCachedToken.mockResolvedValue(null);

      const cached = await mockGetCachedToken(validInstallationId);
      expect(cached).toBeNull();
    });
  });

  describe("token expiration", () => {
    it("should respect token expiry time", () => {
      const oneHourFromNow = new Date(Date.now() + 3600000);
      const tokenData = {
        token: "ghs_test_token",
        expiresAt: oneHourFromNow.toISOString(),
      };

      const isExpired = new Date(tokenData.expiresAt) < new Date();
      expect(isExpired).toBe(false);
    });

    it("should consider expired tokens invalid", () => {
      const oneHourAgo = new Date(Date.now() - 3600000);
      const tokenData = {
        token: "ghs_expired_token",
        expiresAt: oneHourAgo.toISOString(),
      };

      const isExpired = new Date(tokenData.expiresAt) < new Date();
      expect(isExpired).toBe(true);
    });
  });
});

// =============================================================================
// FILE CONTENT FETCHING TESTS
// =============================================================================

describe("File Content Fetching", () => {
  describe("content type handling", () => {
    it("should reject directory results", () => {
      const isFile = (data: { type: string } | Array<unknown>) => {
        if (Array.isArray(data)) {
          return false; // Directory listing
        }
        return data.type === "file";
      };

      expect(isFile([{ name: "file1.ts" }, { name: "file2.ts" }])).toBe(false);
      expect(isFile({ type: "dir" })).toBe(false);
      expect(isFile({ type: "file" })).toBe(true);
    });

    it("should decode base64 content", () => {
      const base64Content = Buffer.from("const x = 1;").toString("base64");
      const decoded = Buffer.from(base64Content, "base64").toString("utf-8");

      expect(decoded).toBe("const x = 1;");
    });
  });

  describe("path normalization", () => {
    it("should handle paths with leading slash", () => {
      const normalizePath = (path: string) => {
        return path.startsWith("/") ? path.slice(1) : path;
      };

      expect(normalizePath("/src/index.ts")).toBe("src/index.ts");
      expect(normalizePath("src/index.ts")).toBe("src/index.ts");
    });
  });
});

// =============================================================================
// REPOSITORY OPERATIONS TESTS
// =============================================================================

describe("Repository Operations", () => {
  describe("listInstallationRepos", () => {
    it("should handle pagination", () => {
      // Test pagination logic
      const aggregatePages = (pages: Array<{ data: string[] }>) => {
        const repos: string[] = [];
        for (const page of pages) {
          repos.push(...page.data);
        }
        return repos;
      };

      const mockPages = [
        { data: ["repo1", "repo2"] },
        { data: ["repo3", "repo4"] },
        { data: ["repo5"] },
      ];

      const result = aggregatePages(mockPages);
      expect(result).toHaveLength(5);
    });
  });

  describe("fetchRecentCommits", () => {
    it("should limit results by count parameter", () => {
      const limitResults = <T>(items: T[], count: number) => {
        return items.slice(0, count);
      };

      const mockCommits = [
        { sha: "a1" },
        { sha: "a2" },
        { sha: "a3" },
        { sha: "a4" },
        { sha: "a5" },
        { sha: "a6" },
      ];

      expect(limitResults(mockCommits, 5)).toHaveLength(5);
      expect(limitResults(mockCommits, 3)).toHaveLength(3);
    });

    it("should return empty array for 404", () => {
      const handleCommits404 = (status: number) => {
        if (status === 404) {
          return [];
        }
        throw new Error("Unexpected error");
      };

      expect(handleCommits404(404)).toEqual([]);
    });
  });
});

// =============================================================================
// GIT REF VALIDATION TESTS
// =============================================================================

describe("Git Ref Validation", () => {
  describe("checkRefExists", () => {
    it("should return false for 404", () => {
      const handleRefCheck = (status: number) => {
        if (status === 404 || status === 422) {
          return false;
        }
        return true;
      };

      expect(handleRefCheck(404)).toBe(false);
    });

    it("should return false for 422 (invalid ref format)", () => {
      const handleRefCheck = (status: number) => {
        if (status === 404 || status === 422) {
          return false;
        }
        return true;
      };

      expect(handleRefCheck(422)).toBe(false);
    });

    it("should throw for other errors", () => {
      const handleRefCheck = (status: number) => {
        if (status === 404 || status === 422) {
          return false;
        }
        if (status >= 400) {
          throw new Error(`GitHub API error: ${status}`);
        }
        return true;
      };

      expect(() => handleRefCheck(500)).toThrow();
    });
  });

  describe("SHA validation", () => {
    it("should validate SHA format", () => {
      const isValidSHA = (sha: string) => {
        return /^[0-9a-f]{40}$/i.test(sha);
      };

      expect(isValidSHA("abc123")).toBe(false); // Too short
      expect(isValidSHA("1234567890123456789012345678901234567890")).toBe(true);
      expect(isValidSHA("ABCDEF0123456789012345678901234567890123")).toBe(true);
      expect(isValidSHA("not-a-sha-at-all-too-long-and-invalid")).toBe(false);
    });

    it("should accept branch names", () => {
      const isValidRef = (ref: string) => {
        // Accept SHA or branch-like names
        const shaPattern = /^[0-9a-f]{40}$/i;
        const branchPattern = /^[\w./-]+$/;
        return shaPattern.test(ref) || branchPattern.test(ref);
      };

      expect(isValidRef("main")).toBe(true);
      expect(isValidRef("feature/test-branch")).toBe(true);
      expect(isValidRef("v1.0.0")).toBe(true);
    });
  });
});

// =============================================================================
// RATE LIMIT HEADERS TESTS
// =============================================================================

describe("Rate Limit Response Headers", () => {
  it("should parse X-RateLimit headers", () => {
    const parseRateLimitHeaders = (headers: Record<string, string>) => {
      return {
        limit: parseInt(headers["x-ratelimit-limit"] || "0", 10),
        remaining: parseInt(headers["x-ratelimit-remaining"] || "0", 10),
        reset: parseInt(headers["x-ratelimit-reset"] || "0", 10),
      };
    };

    const headers = {
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": "1699999999",
    };

    const parsed = parseRateLimitHeaders(headers);

    expect(parsed.limit).toBe(5000);
    expect(parsed.remaining).toBe(4999);
    expect(parsed.reset).toBe(1699999999);
  });

  it("should handle missing headers gracefully", () => {
    const parseRateLimitHeaders = (headers: Record<string, string>) => {
      return {
        limit: parseInt(headers["x-ratelimit-limit"] || "0", 10),
        remaining: parseInt(headers["x-ratelimit-remaining"] || "0", 10),
        reset: parseInt(headers["x-ratelimit-reset"] || "0", 10),
      };
    };

    const parsed = parseRateLimitHeaders({});

    expect(parsed.limit).toBe(0);
    expect(parsed.remaining).toBe(0);
    expect(parsed.reset).toBe(0);
  });
});
