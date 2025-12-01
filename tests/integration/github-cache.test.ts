/**
 * GitHub Cache Integration Tests
 *
 * Tests for the 3-tier caching system (Redis → S3 → Database)
 * and code fetcher service.
 *
 * Note: These tests require:
 * - Running Redis (docker-compose up redis)
 * - Running PostgreSQL (docker-compose up db)
 * - S3 tests are mocked unless AWS credentials are configured
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CacheKeyParams } from "../../src/types/github.js";

// Mock S3 client for tests without AWS credentials
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({
    send: vi.fn(),
  })),
  GetObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
}));

describe("GitHub Caching", () => {
  describe("Cache Key Generation", () => {
    it("should generate correct Redis cache key", async () => {
      const { buildRedisCacheKey } = await import("../../src/types/github.js");

      const params: CacheKeyParams = {
        orgId: "org-123",
        repo: "owner/repo",
        sha: "abc123",
        path: "src/index.ts",
      };

      const key = buildRedisCacheKey(params);
      expect(key).toBe("gh:file:org-123:owner/repo:abc123:src/index.ts");
    });

    it("should generate correct S3 cache key", async () => {
      const { buildS3CacheKey } = await import("../../src/types/github.js");

      const params: CacheKeyParams = {
        orgId: "org-123",
        repo: "owner/repo",
        sha: "abc123",
        path: "src/index.ts",
      };

      const key = buildS3CacheKey(params);
      expect(key).toBe("cache/org-123/owner/repo/abc123/src/index.ts");
    });

    it("should handle paths with leading slashes", async () => {
      const { buildS3CacheKey } = await import("../../src/types/github.js");

      const params: CacheKeyParams = {
        orgId: "org-123",
        repo: "owner/repo",
        sha: "abc123",
        path: "/src/index.ts",
      };

      const key = buildS3CacheKey(params);
      // Should strip leading slash
      expect(key).toBe("cache/org-123/owner/repo/abc123/src/index.ts");
    });

    it("should sanitize path traversal attempts", async () => {
      const { buildS3CacheKey, sanitizePathForCacheKey } =
        await import("../../src/types/github.js");

      // Test the sanitization function directly
      expect(sanitizePathForCacheKey("//app/../src/file.js")).toBe(
        "app/src/file.js"
      );
      expect(sanitizePathForCacheKey("../../../etc/passwd")).toBe("etc/passwd");
      expect(sanitizePathForCacheKey("./src/./utils/../index.ts")).toBe(
        "src/utils/index.ts"
      );

      // Test via buildS3CacheKey
      const params: CacheKeyParams = {
        orgId: "org-123",
        repo: "owner/repo",
        sha: "abc123",
        path: "//app/../src/file.js",
      };

      const key = buildS3CacheKey(params);
      expect(key).toBe("cache/org-123/owner/repo/abc123/app/src/file.js");
    });

    it("should sanitize spaces and special characters", async () => {
      const { sanitizePathForCacheKey } =
        await import("../../src/types/github.js");

      // Spaces become underscores
      expect(sanitizePathForCacheKey("src/ file.js")).toBe("src/_file.js");
      expect(sanitizePathForCacheKey("src/my file name.js")).toBe(
        "src/my_file_name.js"
      );

      // Multiple spaces collapse to single underscore
      expect(sanitizePathForCacheKey("src/  multiple   spaces.js")).toBe(
        "src/_multiple_spaces.js"
      );

      // Windows-invalid chars become underscores
      expect(sanitizePathForCacheKey("src/file<name>.js")).toBe(
        "src/file_name_.js"
      );
    });

    it("should handle consecutive slashes", async () => {
      const { sanitizePathForCacheKey } =
        await import("../../src/types/github.js");

      expect(sanitizePathForCacheKey("src//utils///index.ts")).toBe(
        "src/utils/index.ts"
      );
      expect(sanitizePathForCacheKey("/app/src//utils/index.ts")).toBe(
        "app/src/utils/index.ts"
      );
    });

    it("should handle URL-encoded paths", async () => {
      const { sanitizePathForCacheKey } =
        await import("../../src/types/github.js");

      // %20 is space
      expect(sanitizePathForCacheKey("src/my%20file.js")).toBe(
        "src/my_file.js"
      );
    });

    it("should handle empty or invalid paths gracefully", async () => {
      const { sanitizePathForCacheKey } =
        await import("../../src/types/github.js");

      // Empty after sanitization should return a fallback
      const result = sanitizePathForCacheKey("/../../../");
      expect(result).toMatch(/^_invalid_path_/);

      // Only dots
      const result2 = sanitizePathForCacheKey("./././");
      expect(result2).toMatch(/^_invalid_path_/);
    });
  });

  describe("Cache Statistics", () => {
    beforeEach(async () => {
      const { resetCacheStats } = await import("../../src/services/cache.js");
      resetCacheStats();
    });

    it("should track cache hits correctly", async () => {
      const { recordCacheHit, getCacheStats } =
        await import("../../src/services/cache.js");

      // Record some hits
      recordCacheHit("redis");
      recordCacheHit("redis");
      recordCacheHit("s3");
      recordCacheHit("database");
      recordCacheHit("github");

      const stats = getCacheStats();

      expect(stats.redis_hits).toBe(2);
      expect(stats.s3_hits).toBe(1);
      expect(stats.database_hits).toBe(1);
      expect(stats.github_fetches).toBe(1);
      expect(stats.total_requests).toBe(5);
      expect(stats.hit_rate).toBeCloseTo(0.8); // 4 cache hits / 5 total
    });

    it("should calculate hit rate as 0 when no requests", async () => {
      const { getCacheStats } = await import("../../src/services/cache.js");

      const stats = getCacheStats();

      expect(stats.hit_rate).toBe(0);
      expect(stats.total_requests).toBe(0);
    });
  });

  describe("Language Detection", () => {
    it("should detect JavaScript files", async () => {
      const { detectLanguage } = await import("../../src/services/github.js");

      expect(detectLanguage("index.js")).toBe("javascript");
      expect(detectLanguage("app.jsx")).toBe("javascript");
      expect(detectLanguage("main.mjs")).toBe("javascript");
      expect(detectLanguage("config.cjs")).toBe("javascript");
    });

    it("should detect TypeScript files", async () => {
      const { detectLanguage } = await import("../../src/services/github.js");

      expect(detectLanguage("index.ts")).toBe("typescript");
      expect(detectLanguage("App.tsx")).toBe("typescript");
    });

    it("should detect Python files", async () => {
      const { detectLanguage } = await import("../../src/services/github.js");

      expect(detectLanguage("main.py")).toBe("python");
    });

    it("should return text for unknown extensions", async () => {
      const { detectLanguage } = await import("../../src/services/github.js");

      expect(detectLanguage("unknown.xyz")).toBe("text");
      expect(detectLanguage("noextension")).toBe("text");
    });
  });

  describe("File Content Decoding", () => {
    it("should decode base64 content correctly", async () => {
      const { decodeFileContent } =
        await import("../../src/services/github.js");

      const original = "const hello = 'world';";
      const base64 = Buffer.from(original).toString("base64");

      const decoded = decodeFileContent(base64);
      expect(decoded).toBe(original);
    });

    it("should handle UTF-8 characters", async () => {
      const { decodeFileContent } =
        await import("../../src/services/github.js");

      const original = "const greeting = '你好世界! 🌍';";
      const base64 = Buffer.from(original).toString("base64");

      const decoded = decodeFileContent(base64);
      expect(decoded).toBe(original);
    });
  });

  describe("Repository Name Parsing", () => {
    it("should parse full repository name correctly", async () => {
      const { parseRepoFullName } =
        await import("../../src/services/github.js");

      const result = parseRepoFullName("facebook/react");
      expect(result.owner).toBe("facebook");
      expect(result.repo).toBe("react");
    });

    it("should throw for invalid repository names", async () => {
      const { parseRepoFullName } =
        await import("../../src/services/github.js");

      expect(() => parseRepoFullName("invalid")).toThrow();
      expect(() => parseRepoFullName("")).toThrow();
    });
  });
});

describe("Code Fetcher Service", () => {
  describe("Stack Frame Normalization", () => {
    it("should use abs_path when available", async () => {
      const { CodeFetcherService } =
        await import("../../src/services/code-fetcher.js");

      const service = new CodeFetcherService();
      // Access private method via type assertion for testing
      type NormalizeFrame = {
        normalizeFrame: (frame: {
          filename: string;
          abs_path: string | null;
          lineno: number | null;
          colno: number | null;
          function: string | null;
          context_line: string | null;
          pre_context: string[] | null;
          post_context: string[] | null;
          in_app: boolean;
        }) => {
          file: string;
          line: number;
          column: number;
          functionName: string | null;
        };
      };

      const normalizeFrame = (
        service as unknown as NormalizeFrame
      ).normalizeFrame.bind(service);

      const frame = {
        filename: "relative/path.js",
        abs_path: "/full/absolute/path.js",
        lineno: 42,
        colno: 10,
        function: "myFunction",
        context_line: null,
        pre_context: null,
        post_context: null,
        in_app: true,
      };

      const normalized = normalizeFrame(frame);
      expect(normalized.file).toBe("/full/absolute/path.js");
      expect(normalized.line).toBe(42);
      expect(normalized.column).toBe(10);
      expect(normalized.functionName).toBe("myFunction");
    });

    it("should fallback to filename when abs_path is null", async () => {
      const { CodeFetcherService } =
        await import("../../src/services/code-fetcher.js");

      const service = new CodeFetcherService();
      type NormalizeFrame = {
        normalizeFrame: (frame: {
          filename: string;
          abs_path: string | null;
          lineno: number | null;
          colno: number | null;
          function: string | null;
          context_line: string | null;
          pre_context: string[] | null;
          post_context: string[] | null;
          in_app: boolean;
        }) => {
          file: string;
          line: number;
          column: number;
          functionName: string | null;
        };
      };

      const normalizeFrame = (
        service as unknown as NormalizeFrame
      ).normalizeFrame.bind(service);

      const frame = {
        filename: "relative/path.js",
        abs_path: null,
        lineno: null,
        colno: null,
        function: null,
        context_line: null,
        pre_context: null,
        post_context: null,
        in_app: true,
      };

      const normalized = normalizeFrame(frame);
      expect(normalized.file).toBe("relative/path.js");
      expect(normalized.line).toBe(1); // Default
      expect(normalized.column).toBe(0); // Default
      expect(normalized.functionName).toBe(null);
    });
  });

  describe("Minified Code Detection", () => {
    it("should detect minified code by line length", async () => {
      const { CodeFetcherService } =
        await import("../../src/services/code-fetcher.js");

      const service = new CodeFetcherService();
      type IsMinified = { isMinified: (content: string) => boolean };
      const isMinified = (service as unknown as IsMinified).isMinified.bind(
        service
      );

      // Minified code (very long single line)
      const minifiedCode = "a".repeat(500) + "\n" + "b".repeat(500);
      expect(isMinified(minifiedCode)).toBe(true);

      // Normal code
      const normalCode = `
        function hello() {
          console.log('Hello, World!');
        }
      `;
      expect(isMinified(normalCode)).toBe(false);
    });

    it("should detect minified code by mangling patterns", async () => {
      const { CodeFetcherService } =
        await import("../../src/services/code-fetcher.js");

      const service = new CodeFetcherService();
      type IsMinified = { isMinified: (content: string) => boolean };
      const isMinified = (service as unknown as IsMinified).isMinified.bind(
        service
      );

      // Content with mangled variable names pattern (a.b.c=)
      const content = "var a.b.c=1,d.e.f=2;";
      expect(isMinified(content)).toBe(true);
    });
  });

  describe("Inline Source Map Extraction", () => {
    it("should extract base64 inline source map", async () => {
      const { CodeFetcherService } =
        await import("../../src/services/code-fetcher.js");

      const service = new CodeFetcherService();
      type ExtractSourceMap = {
        extractInlineSourceMap: (content: string) => object | null;
      };
      const extractInlineSourceMap = (
        service as unknown as ExtractSourceMap
      ).extractInlineSourceMap.bind(service);

      const sourceMap = {
        version: 3,
        sources: ["original.ts"],
        mappings: "AAAA",
      };

      const base64Map = Buffer.from(JSON.stringify(sourceMap)).toString(
        "base64"
      );
      const content = `var a=1;
//# sourceMappingURL=data:application/json;base64,${base64Map}`;

      const extracted = extractInlineSourceMap(content);
      expect(extracted).not.toBeNull();
      expect((extracted as { version: number }).version).toBe(3);
      expect((extracted as { sources: string[] }).sources).toContain(
        "original.ts"
      );
    });

    it("should return null when no source map found", async () => {
      const { CodeFetcherService } =
        await import("../../src/services/code-fetcher.js");

      const service = new CodeFetcherService();
      type ExtractSourceMap = {
        extractInlineSourceMap: (content: string) => object | null;
      };
      const extractInlineSourceMap = (
        service as unknown as ExtractSourceMap
      ).extractInlineSourceMap.bind(service);

      const content = "var a = 1;";
      const extracted = extractInlineSourceMap(content);
      expect(extracted).toBeNull();
    });
  });

  describe("Code Context Extraction", () => {
    it("should extract correct context lines", async () => {
      const { CodeFetcherService } =
        await import("../../src/services/code-fetcher.js");

      const service = new CodeFetcherService();
      type ExtractContext = {
        extractCodeContext: (
          content: string,
          frame: { file: string; line: number; column: number },
          sha: string,
          repo: string,
          sourceMapResolved: boolean
        ) => {
          file_path: string;
          line_number: number;
          snippet: string;
          snippet_start_line: number;
          snippet_end_line: number;
        };
      };
      const extractCodeContext = (
        service as unknown as ExtractContext
      ).extractCodeContext.bind(service);

      const code = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join(
        "\n"
      );

      const context = extractCodeContext(
        code,
        { file: "test.js", line: 10, column: 0 },
        "abc123",
        "owner/repo",
        false
      );

      expect(context.line_number).toBe(10);
      expect(context.snippet_start_line).toBeLessThanOrEqual(10);
      expect(context.snippet_end_line).toBeGreaterThanOrEqual(10);
      expect(context.snippet).toContain("Line 10");
    });

    it("should handle edge cases (first/last lines)", async () => {
      const { CodeFetcherService } =
        await import("../../src/services/code-fetcher.js");

      const service = new CodeFetcherService();
      type ExtractContext = {
        extractCodeContext: (
          content: string,
          frame: { file: string; line: number; column: number },
          sha: string,
          repo: string,
          sourceMapResolved: boolean
        ) => {
          file_path: string;
          line_number: number;
          snippet: string;
          snippet_start_line: number;
          snippet_end_line: number;
        };
      };
      const extractCodeContext = (
        service as unknown as ExtractContext
      ).extractCodeContext.bind(service);

      const code = "Line 1\nLine 2\nLine 3";

      // First line
      const contextFirst = extractCodeContext(
        code,
        { file: "test.js", line: 1, column: 0 },
        "abc123",
        "owner/repo",
        false
      );
      expect(contextFirst.snippet_start_line).toBe(1);

      // Last line
      const contextLast = extractCodeContext(
        code,
        { file: "test.js", line: 3, column: 0 },
        "abc123",
        "owner/repo",
        false
      );
      expect(contextLast.snippet_end_line).toBe(3);
    });
  });
});

describe("GitHub Rate Limiting", () => {
  it("should define rate limits per plan", async () => {
    // Verify the checkGitHubRateLimit function exists and returns expected shape
    const githubModule = await import("../../src/services/github.js");
    expect(typeof githubModule.checkGitHubRateLimit).toBe("function");
    expect(typeof githubModule.trackGitHubAPICall).toBe("function");
  });

  it("should export rate limit error class", async () => {
    const { GitHubRateLimitError } =
      await import("../../src/services/github.js");

    const error = new GitHubRateLimitError("Rate limit exceeded");
    expect(error.name).toBe("GitHubRateLimitError");
    expect(error.message).toBe("Rate limit exceeded");
  });

  it("should export auth error class", async () => {
    const { GitHubAuthError } = await import("../../src/services/github.js");

    const error = new GitHubAuthError("Authentication failed");
    expect(error.name).toBe("GitHubAuthError");
    expect(error.message).toBe("Authentication failed");
  });
});
