/**
 * CodeFetcher Service
 *
 * Fetches source code files from GitHub with 3-tier cache support.
 * Handles minified files by resolving source maps to original locations.
 *
 * Data Flow:
 * 1. Check 3-tier cache (Redis → S3 → Database)
 * 2. If cache miss, fetch from GitHub API
 * 3. If minified, fetch and apply source map
 * 4. Store in cache for future requests
 * 5. Return code context with surrounding lines
 */

import {
  getFromRedisCache,
  getFromS3Cache,
  getFromDatabaseCache,
  storeInAllCacheTiers,
  recordCacheHit,
} from "./cache.js";
import {
  fetchFileContent,
  decodeFileContent,
  detectLanguage,
} from "./github.js";
import { logger } from "../utils/logger.js";
import type {
  StackFrame,
  CodeContext,
  CacheKeyParams,
  CachedFileContent,
} from "../types/github.js";
import { pool } from "../db/client.js";
import { SourceMapConsumer, type RawSourceMap } from "source-map";

// ============================================
// Configuration
// ============================================

const CODE_CONTEXT_LINES = 10; // Lines before/after error line
const MINIFIED_DETECTION_THRESHOLD = 200; // Avg chars per line threshold
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB max file size

// ============================================
// Types
// ============================================

interface FetchOptions {
  orgId: string;
  installationId: string;
  repo: string;
  ref: string; // commit SHA or branch
}

/**
 * File data returned from code fetcher
 */
interface FetchedFile {
  path: string;
  content: string;
  sha: string;
  size: number;
  language: string;
}

interface CodeFetchResult {
  file: FetchedFile;
  context: CodeContext;
  wasMinified: boolean;
  sourceMapApplied: boolean;
  cacheHit: boolean;
  cacheTier?: "redis" | "s3" | "database";
}

/**
 * Normalized stack frame for internal use
 */
interface NormalizedFrame {
  file: string;
  line: number;
  column: number;
  functionName: string | null;
}

// ============================================
// CodeFetcher Service
// ============================================

// Common path prefixes to strip from abs_path (container/deployment paths)
const STRIP_PATH_PREFIXES = [
  "/app/",
  "/var/task/",
  "/home/runner/work/",
  "/opt/nodejs/",
  "/workspace/",
  "/build/",
  "/dist/",
];

// Path traversal patterns that indicate malicious input
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//, // ../
  /\.\.\\/, // ..\\
  /^\/etc\//i, // /etc/
  /^\/var\//i, // /var/ (unless in STRIP_PATH_PREFIXES)
  /^\/usr\//i, // /usr/
  /^\/root\//i, // /root/
  /^\/home\/(?!runner)/i, // /home/ (except runner for CI)
  /^~/, // ~ (home directory shortcut)
  /\0/, // null bytes
];

class CodeFetcherService {
  /**
   * Validate that a file path is safe and doesn't attempt path traversal
   * @throws Error if path is potentially malicious
   */
  private validateFilePath(filePath: string): void {
    if (!filePath || typeof filePath !== "string") {
      throw new Error("Invalid file path: empty or non-string");
    }

    // Check for path traversal patterns
    for (const pattern of PATH_TRAVERSAL_PATTERNS) {
      if (pattern.test(filePath)) {
        logger.warn({ filePath }, "Path traversal attempt detected");
        throw new Error("Invalid file path: potential path traversal");
      }
    }

    // Ensure path doesn't have multiple consecutive slashes (normalization attack)
    if (/\/\/+/.test(filePath)) {
      throw new Error("Invalid file path: malformed path");
    }
  }

  /**
   * Strip common deployment path prefixes from absolute paths
   * e.g., /app/src/index.ts -> src/index.ts
   */
  private stripPathPrefix(filePath: string): string {
    for (const prefix of STRIP_PATH_PREFIXES) {
      if (filePath.startsWith(prefix)) {
        return filePath.slice(prefix.length);
      }
    }
    // Also handle paths that start with / but aren't prefixed
    if (filePath.startsWith("/") && !filePath.startsWith("/node_modules")) {
      // Try to find src/, lib/, or similar common directories
      const commonDirs = ["src/", "lib/", "dist/", "build/", "app/"];
      for (const dir of commonDirs) {
        const idx = filePath.indexOf(dir);
        if (idx !== -1) {
          return filePath.slice(idx);
        }
      }
    }
    return filePath;
  }

  /**
   * Normalize a StackFrame to a consistent internal format
   */
  private normalizeFrame(frame: StackFrame): NormalizedFrame {
    // Prefer abs_path but strip deployment prefixes, fallback to filename
    const rawPath = frame.abs_path || frame.filename;

    // Validate path before processing (security: prevent path traversal)
    this.validateFilePath(rawPath);

    const cleanPath = this.stripPathPrefix(rawPath);

    // Validate again after stripping (belt and suspenders)
    this.validateFilePath(cleanPath);

    return {
      file: cleanPath,
      line: frame.lineno || 1,
      column: frame.colno || 0,
      functionName: frame.function || null,
    };
  }

  /**
   * Fetch code context for a stack frame
   * Main entry point for the code fetcher service
   */
  async fetchCodeForFrame(
    frame: StackFrame,
    options: FetchOptions
  ): Promise<CodeFetchResult | null> {
    const { orgId, installationId, repo, ref } = options;
    const normalizedFrame = this.normalizeFrame(frame);

    logger.info(
      { file: normalizedFrame.file, line: normalizedFrame.line, repo, ref },
      "Fetching code for stack frame"
    );

    try {
      // 1. Build cache key
      const cacheKey: CacheKeyParams = {
        orgId,
        repo,
        sha: ref,
        path: normalizedFrame.file,
      };

      // 2. Try to get from cache
      const { content: cachedContent, tier } =
        await this.getFromCacheWithTier(cacheKey);

      let fileContent: string;
      let wasMinified = false;
      let sourceMapApplied = false;
      let resolvedFrame = normalizedFrame;

      if (cachedContent) {
        logger.debug(
          { file: normalizedFrame.file, tier },
          "Cache hit for file"
        );
        recordCacheHit(tier!);
        fileContent = cachedContent.content;
      } else {
        // 3. Fetch from GitHub
        logger.debug(
          { file: normalizedFrame.file },
          "Cache miss, fetching from GitHub"
        );
        const fetchResult = await this.fetchFromGitHub(
          normalizedFrame.file,
          installationId,
          repo,
          ref,
          orgId
        );

        if (!fetchResult) {
          logger.warn(
            { file: normalizedFrame.file },
            "File not found on GitHub"
          );
          return null;
        }

        fileContent = fetchResult.content;
        recordCacheHit("github");

        // 4. Check if minified and resolve source map
        if (this.isMinified(fileContent)) {
          wasMinified = true;
          const sourceMapResult = await this.resolveSourceMap(
            normalizedFrame,
            fileContent,
            installationId,
            repo,
            ref,
            orgId
          );

          if (sourceMapResult) {
            sourceMapApplied = true;
            resolvedFrame = sourceMapResult.resolvedFrame;

            // Use embedded source if available, otherwise fetch original file
            if (sourceMapResult.originalSource) {
              fileContent = sourceMapResult.originalSource;
            } else if (
              sourceMapResult.resolvedFrame.file !== normalizedFrame.file
            ) {
              const originalFile = await this.fetchFromGitHub(
                sourceMapResult.resolvedFrame.file,
                installationId,
                repo,
                ref,
                orgId
              );
              if (originalFile) {
                fileContent = originalFile.content;
              }
            }
          }
        }

        // 5. Cache the result
        const cacheData: CachedFileContent = {
          content: fileContent,
          path: normalizedFrame.file,
          sha: ref,
          repo,
          size: fileContent.length,
          language: detectLanguage(resolvedFrame.file),
          cached_at: Date.now(),
          cache_source: "github",
        };

        await storeInAllCacheTiers(cacheKey, cacheData);
      }

      // 6. Extract code context
      const context = this.extractCodeContext(
        fileContent,
        resolvedFrame,
        ref,
        repo,
        sourceMapApplied
      );

      // 7. Build file info
      const file: FetchedFile = {
        path: resolvedFrame.file,
        content: fileContent,
        sha: ref,
        size: fileContent.length,
        language: detectLanguage(resolvedFrame.file),
      };

      return {
        file,
        context,
        wasMinified,
        sourceMapApplied,
        cacheHit: !!cachedContent,
        cacheTier: cachedContent ? tier : undefined,
      };
    } catch (error) {
      logger.error(
        {
          file: normalizedFrame.file,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Failed to fetch code for frame"
      );
      return null;
    }
  }

  /**
   * Fetch code for multiple stack frames in a stack trace
   */
  async fetchCodeForStackTrace(
    frames: StackFrame[],
    options: FetchOptions
  ): Promise<Map<string, CodeFetchResult>> {
    const results = new Map<string, CodeFetchResult>();

    // Deduplicate files (same file might appear multiple times in stack)
    const uniqueFiles = new Map<string, StackFrame>();
    for (const frame of frames) {
      const normalized = this.normalizeFrame(frame);
      const key = `${normalized.file}:${normalized.line}`;
      if (!uniqueFiles.has(key)) {
        uniqueFiles.set(key, frame);
      }
    }

    // Fetch in parallel with concurrency limit
    const CONCURRENCY = 5;
    const frameArray = Array.from(uniqueFiles.entries());

    for (let i = 0; i < frameArray.length; i += CONCURRENCY) {
      const batch = frameArray.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async ([key, frame]) => {
          const result = await this.fetchCodeForFrame(frame, options);
          return { key, result };
        })
      );

      for (const { key, result } of batchResults) {
        if (result) {
          results.set(key, result);
        }
      }
    }

    return results;
  }

  /**
   * Get installation ID for a repository
   */
  async getInstallationId(
    orgId: string,
    repoFullName: string
  ): Promise<string | null> {
    try {
      const result = await pool.query<{ installation_id: string }>(
        `SELECT installation_id FROM repos
         WHERE org_id = $1 AND full_name = $2`,
        [orgId, repoFullName]
      );

      if (result.rows.length === 0) {
        logger.warn(
          { orgId, repo: repoFullName },
          "No installation found for repo"
        );
        return null;
      }

      return result.rows[0].installation_id;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to get installation ID"
      );
      return null;
    }
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Get from cache and track which tier it came from
   */
  private async getFromCacheWithTier(key: CacheKeyParams): Promise<{
    content: CachedFileContent | null;
    tier?: "redis" | "s3" | "database";
  }> {
    // Check Redis first
    const redisResult = await getFromRedisCache(key);
    if (redisResult) {
      return { content: redisResult, tier: "redis" };
    }

    // Check S3
    const s3Result = await getFromS3Cache(key);
    if (s3Result) {
      return { content: s3Result, tier: "s3" };
    }

    // Check DB
    const dbResult = await getFromDatabaseCache(key);
    if (dbResult) {
      return { content: dbResult, tier: "database" };
    }

    return { content: null };
  }

  /**
   * Fetch file content from GitHub API
   */
  private async fetchFromGitHub(
    path: string,
    installationId: string,
    repo: string,
    ref: string,
    orgId: string
  ): Promise<{ content: string; sha: string } | null> {
    try {
      const [owner, repoName] = repo.split("/");

      const fileData = await fetchFileContent(
        installationId,
        owner,
        repoName,
        path,
        ref,
        orgId
      );

      if (!fileData || !fileData.content) {
        return null;
      }

      // Check file size
      if (fileData.size > MAX_FILE_SIZE) {
        logger.warn({ path, size: fileData.size }, "File too large");
        return null;
      }

      // Decode base64 content
      const content = decodeFileContent(fileData.content);

      return {
        content,
        sha: fileData.sha,
      };
    } catch (error) {
      logger.error(
        {
          path,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "GitHub API error"
      );
      return null;
    }
  }

  /**
   * Detect if file content is minified
   */
  private isMinified(content: string): boolean {
    const lines = content.split("\n");
    if (lines.length === 0) return false;

    // Calculate average line length
    const totalChars = content.length;
    const avgLineLength = totalChars / lines.length;

    // Minified files typically have very long lines
    if (avgLineLength > MINIFIED_DETECTION_THRESHOLD) {
      return true;
    }

    // Check for common minification patterns
    const minificationPatterns = [
      /\.min\.js$/,
      /\.bundle\.js$/,
      /[a-z]\.[a-z]\.[a-z]=/, // Mangled variable names
      /function\([a-z],[a-z],[a-z]\)/, // Short parameter names
    ];

    return minificationPatterns.some((pattern) => pattern.test(content));
  }

  /**
   * Resolve source map to get original location
   */
  private async resolveSourceMap(
    frame: NormalizedFrame,
    minifiedContent: string,
    installationId: string,
    repo: string,
    ref: string,
    orgId: string
  ): Promise<{
    resolvedFrame: NormalizedFrame;
    originalSource?: string;
  } | null> {
    try {
      // Try to fetch source map file
      const sourceMapPath = `${frame.file}.map`;
      const sourceMapResult = await this.fetchFromGitHub(
        sourceMapPath,
        installationId,
        repo,
        ref,
        orgId
      );

      if (!sourceMapResult) {
        // Try inline source map
        const inlineSourceMap = this.extractInlineSourceMap(minifiedContent);
        if (!inlineSourceMap) {
          logger.debug({ file: frame.file }, "No source map found");
          return null;
        }
        return await this.applySourceMap(frame, inlineSourceMap);
      }

      const sourceMapData = JSON.parse(sourceMapResult.content) as RawSourceMap;
      return await this.applySourceMap(frame, sourceMapData);
    } catch (error) {
      logger.warn(
        {
          file: frame.file,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Failed to resolve source map"
      );
      return null;
    }
  }

  /**
   * Extract inline source map from file content
   */
  private extractInlineSourceMap(content: string): RawSourceMap | null {
    // Look for inline source map comment
    const inlinePattern =
      /\/\/[@#]\s*sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)/;
    const match = content.match(inlinePattern);

    if (!match) {
      return null;
    }

    try {
      const decoded = Buffer.from(match[1], "base64").toString("utf-8");
      return JSON.parse(decoded) as RawSourceMap;
    } catch {
      return null;
    }
  }

  /**
   * Apply source map to resolve original location
   */
  private async applySourceMap(
    frame: NormalizedFrame,
    sourceMap: RawSourceMap
  ): Promise<{
    resolvedFrame: NormalizedFrame;
    originalSource?: string;
  } | null> {
    let consumer: SourceMapConsumer | null = null;

    try {
      consumer = await new SourceMapConsumer(sourceMap);

      const original = consumer.originalPositionFor({
        line: frame.line,
        column: frame.column || 0,
      });

      if (!original.source || original.line === null) {
        return null;
      }

      const resolvedFrame: NormalizedFrame = {
        file: original.source,
        line: original.line,
        column: original.column || 0,
        functionName: original.name || frame.functionName,
      };

      // Try to get the original source content if embedded
      let originalSource: string | undefined;
      const sourceContent = consumer.sourceContentFor(original.source, true);
      if (sourceContent) {
        originalSource = sourceContent;
      }

      return { resolvedFrame, originalSource };
    } finally {
      if (consumer) {
        consumer.destroy();
      }
    }
  }

  /**
   * Extract code context (lines before/after error line)
   */
  private extractCodeContext(
    content: string,
    frame: NormalizedFrame,
    sha: string,
    repo: string,
    sourceMapResolved: boolean
  ): CodeContext {
    const lines = content.split("\n");
    const startLine = Math.max(1, frame.line - CODE_CONTEXT_LINES);
    const endLine = Math.min(lines.length, frame.line + CODE_CONTEXT_LINES);

    // Extract the relevant lines (1-indexed)
    const snippetLines = lines.slice(startLine - 1, endLine);

    return {
      file_path: frame.file,
      line_number: frame.line,
      column_number: frame.column || null,
      snippet: snippetLines.join("\n"),
      snippet_start_line: startLine,
      snippet_end_line: endLine,
      language: detectLanguage(frame.file),
      sha,
      repo,
      source_map_resolved: sourceMapResolved,
    };
  }
}

// ============================================
// Singleton Export
// ============================================

export const codeFetcherService = new CodeFetcherService();
export { CodeFetcherService };
export type { CodeFetchResult, FetchOptions, FetchedFile };
