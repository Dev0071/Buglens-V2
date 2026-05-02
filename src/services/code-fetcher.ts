/**
 * CodeFetcher Service
 *
 * Fetches source code files from GitHub for production/staging errors.
 * Designed for hosted environments where:
 * - Release tags contain commit SHAs
 * - Source maps may be embedded or uploaded to Sentry
 * - Code exists in the repository at the specified commit
 *
 * Data Flow:
 * 1. Normalize file path from stack frame (strip deployment prefixes)
 * 2. Check 3-tier cache (Redis → S3 → Database)
 * 3. If cache miss, fetch from GitHub API
 * 4. If minified, resolve via inline source map
 * 5. Store in cache for future requests
 * 6. Return code context with surrounding lines
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
import path from "node:path";
import { fetchSourceMapFromSentry } from "./sentry-sourcemap-fetcher.js";

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
  release?: string | null; // Sentry release (used to look up uploaded source maps)
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

export function normalizeBundlerPath(
  rawPath: string | null | undefined
): string {
  if (!rawPath) {
    return "";
  }

  const schemeMatch = rawPath.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//);
  if (!schemeMatch) {
    return rawPath;
  }

  const withoutScheme = rawPath.slice(schemeMatch[0].length);
  return withoutScheme.replace(/^\/+/g, "").replace(/\/{2,}/g, "/");
}

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
    if (
      /\/{2,}/.test(filePath) &&
      !filePath.startsWith(".next/") &&
      !filePath.startsWith("_next/")
    ) {
      throw new Error("Invalid file path: malformed path");
    }
  }

  /**
   * Strip common deployment path prefixes from absolute paths
   * e.g., /app/src/index.ts -> src/index.ts
   */
  private stripPathPrefix(filePath: string): string {
    let normalized = normalizeBundlerPath(filePath);
    if (normalized.startsWith("_next/")) {
      normalized = `.next/${normalized.slice("_next/".length)}`;
    }
    if (normalized.startsWith("./")) {
      normalized = normalized.slice(2);
    }

    for (const prefix of STRIP_PATH_PREFIXES) {
      if (normalized.startsWith(prefix)) {
        return normalized.slice(prefix.length);
      }
    }
    // Also handle paths that start with / but aren't prefixed
    if (normalized.startsWith("/") && !normalized.startsWith("/node_modules")) {
      // Try to find src/, lib/, or similar common directories
      const commonDirs = ["src/", "lib/", "dist/", "build/", "app/", ".next/"];
      for (const dir of commonDirs) {
        const idx = normalized.indexOf(dir);
        if (idx !== -1) {
          return normalized.slice(idx);
        }
      }
    }
    return normalized;
  }

  /**
   * Normalize a StackFrame to a consistent internal format
   */
  private normalizeFrame(frame: StackFrame): NormalizedFrame {
    // Prefer abs_path but strip deployment prefixes, fallback to filename
    const rawPath = frame.abs_path || frame.filename;

    // Strip deployment prefixes before validating (security: prevent path traversal)
    const cleanPath = this.stripPathPrefix(rawPath);

    // Validate only after stripping
    this.validateFilePath(cleanPath);

    return {
      file: cleanPath,
      line: frame.lineno || 1,
      column: frame.colno || 0,
      functionName: frame.function || null,
    };
  }

  private isBundledPath(filePath: string): boolean {
    const lower = (filePath || "").toLowerCase();

    // These are build artifacts that don't exist in the repo
    // Production builds should have source maps that resolve to original files
    return (
      // Absolute URLs from production deployments (CDN, hosting providers)
      // e.g. https://cdn.example.com/static/js/app.abc.js — never lives in the repo
      /^https?:\/\//.test(lower) ||
      // Next.js build artifacts
      lower.includes(".next/") ||
      lower.includes("_next/") ||
      lower.includes("[root-of-the-server]") ||
      // Webpack/Turbopack chunked bundles
      lower.includes("node_modules_") ||
      lower.includes("webpack") ||
      lower.includes(".chunk.") ||
      // Minified bundles
      lower.endsWith(".min.js") ||
      lower.endsWith(".bundle.js") ||
      // Vercel/serverless artifacts
      lower.includes("/var/task/") ||
      lower.includes("/__vc_") ||
      // Vite production output (default `assets/` directory with hashed names)
      /\/assets\/[^/]+\.[a-z0-9]+\.js$/i.test(lower) ||
      // CRA / generic static-bundle layouts
      /\/static\/(js|css)\//.test(lower) ||
      // Generic build output (not source)
      /\.[a-f0-9]{8,}\.js$/i.test(lower) // hash in filename like app.abc12345.js
    );
  }

  /**
   * Check if this looks like an actual source file path that should exist in repo
   */
  private isSourceFilePath(filePath: string): boolean {
    const lower = (filePath || "").toLowerCase();

    // Common source file patterns
    const sourcePatterns = [
      /^src\//,
      /^lib\//,
      /^app\//,
      /^pages\//,
      /^components\//,
      /^utils\//,
      /^services\//,
      /^api\//,
    ];

    // Check if path matches source patterns
    if (sourcePatterns.some((p) => p.test(lower))) {
      return true;
    }

    // Check file extensions (source files)
    const sourceExtensions = [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
    ];
    const hasSourceExt = sourceExtensions.some((ext) => lower.endsWith(ext));

    // Not a build artifact and has source extension
    return hasSourceExt && !this.isBundledPath(filePath);
  }

  private normalizeOriginalSourcePath(
    sourcePath: string | null | undefined
  ): string {
    if (!sourcePath) {
      return "";
    }

    let normalized = normalizeBundlerPath(sourcePath);
    normalized = normalized.replace(/^_n_e\//i, "");
    normalized = normalized.replace(/^_next\//i, ".next/");
    normalized = normalized.replace(/^\.\/+/, "");
    normalized = normalized.replace(/^~\//, "");

    normalized = path.posix.normalize(normalized);
    normalized = normalized.replace(/^(\.\.\/)+/, "");

    return normalized;
  }

  private buildSourceMapCandidates(filePath: string): string[] {
    if (!filePath) {
      return [];
    }

    const candidates = new Set<string>();

    if (filePath.endsWith(".map")) {
      candidates.add(filePath);
      return Array.from(candidates);
    }

    candidates.add(`${filePath}.map`);

    if (filePath.endsWith(".js")) {
      candidates.add(filePath.replace(/\.js$/, ".js.map"));
    } else {
      candidates.add(`${filePath}.js.map`);
    }

    return Array.from(candidates);
  }

  private async resolveBundledFrameWithSourceMap(
    frame: NormalizedFrame,
    installationId: string,
    repo: string,
    ref: string,
    orgId: string,
    release: string | null
  ): Promise<{
    resolvedFrame: NormalizedFrame;
    originalSource?: string;
  } | null> {
    const mapCandidates = this.buildSourceMapCandidates(frame.file);

    // Tier 1: try GitHub repo for sibling .map files
    for (const candidate of mapCandidates) {
      const mapFile = await this.fetchFromGitHub(
        candidate,
        installationId,
        repo,
        ref,
        orgId
      );

      if (!mapFile) {
        continue;
      }

      try {
        const rawMap = JSON.parse(mapFile.content) as RawSourceMap;
        const resolved = await this.applyAndNormalizeMap(
          frame,
          rawMap,
          candidate,
          "github"
        );
        if (resolved) {
          return resolved;
        }
      } catch (error) {
        logger.debug(
          {
            source_map_path: candidate,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "Failed to parse source map JSON from GitHub"
        );
      }
    }

    // Tier 2: fall back to Sentry release files API (where most prod maps actually live)
    if (release) {
      const sentryMap = await fetchSourceMapFromSentry({
        orgId,
        release,
        candidates: mapCandidates,
      });

      if (sentryMap) {
        const resolved = await this.applyAndNormalizeMap(
          frame,
          sentryMap,
          mapCandidates[0],
          "sentry"
        );
        if (resolved) {
          return resolved;
        }
      }
    }

    return null;
  }

  private async applyAndNormalizeMap(
    frame: NormalizedFrame,
    rawMap: RawSourceMap,
    candidate: string,
    source: "github" | "sentry"
  ): Promise<{
    resolvedFrame: NormalizedFrame;
    originalSource?: string;
  } | null> {
    const mapped = await this.applySourceMap(frame, rawMap);
    if (!mapped) return null;

    const normalizedSource = this.normalizeOriginalSourcePath(
      mapped.resolvedFrame.file
    );
    if (!normalizedSource) return null;

    try {
      this.validateFilePath(normalizedSource);
    } catch {
      return null;
    }

    logger.debug(
      {
        bundler_file: frame.file,
        original_file: normalizedSource,
        source_map_path: candidate,
        source,
      },
      "Resolved bundled frame via source map"
    );

    return {
      resolvedFrame: {
        file: normalizedSource,
        line: mapped.resolvedFrame.line,
        column: mapped.resolvedFrame.column,
        functionName: mapped.resolvedFrame.functionName,
      },
      originalSource: mapped.originalSource,
    };
  }

  /**
   * Fetch code context for a stack frame
   * Main entry point for the code fetcher service
   *
   * For production/staging errors:
   * - Source files (src/app/lib/*.ts) are fetched directly from GitHub
   * - Bundled files (.next/chunks/*) need source map resolution
   * - If path is bundled and no source map, returns null (rely on Sentry embedded context)
   */
  async fetchCodeForFrame(
    frame: StackFrame,
    options: FetchOptions
  ): Promise<CodeFetchResult | null> {
    const { orgId, installationId, repo, ref, release } = options;
    const normalizedFrame = this.normalizeFrame(frame);
    let resolvedFrame = normalizedFrame;
    let preResolvedContent: string | null = null;
    let sourceMapApplied = false;

    logger.info(
      { file: normalizedFrame.file, line: normalizedFrame.line, repo, ref },
      "Fetching code for stack frame"
    );

    // If this is a bundled path, try to resolve via source map first
    if (this.isBundledPath(normalizedFrame.file)) {
      logger.debug(
        { file: normalizedFrame.file },
        "Detected bundled file, attempting source map resolution"
      );

      const bundlerResolution = await this.resolveBundledFrameWithSourceMap(
        normalizedFrame,
        installationId,
        repo,
        ref,
        orgId,
        release ?? null
      );

      if (bundlerResolution) {
        resolvedFrame = bundlerResolution.resolvedFrame;
        preResolvedContent = bundlerResolution.originalSource ?? null;
        sourceMapApplied = true;
        logger.info(
          { bundled: normalizedFrame.file, resolved: resolvedFrame.file },
          "Resolved bundled file to source via source map"
        );
      } else {
        // Bundled file with no source map available - can't fetch from GitHub
        // Let caller fall back to Sentry's embedded context
        logger.debug(
          { file: normalizedFrame.file },
          "Bundled file has no source map in repo, skipping GitHub fetch"
        );
        return null;
      }
    }

    // Verify the resolved path looks like a source file
    if (!this.isSourceFilePath(resolvedFrame.file) && !sourceMapApplied) {
      logger.debug(
        { file: resolvedFrame.file },
        "Path does not appear to be a source file, skipping"
      );
      return null;
    }

    let cachePath = resolvedFrame.file || normalizedFrame.file;
    let cacheKey: CacheKeyParams = {
      orgId,
      repo,
      sha: ref,
      path: cachePath,
    };

    try {
      // 1. Try to get from cache
      const { content: cachedContent, tier } =
        await this.getFromCacheWithTier(cacheKey);

      let fileContent: string;
      let wasMinified = false;

      if (cachedContent) {
        logger.debug({ file: cachePath, tier }, "Cache hit for file");
        recordCacheHit(tier!);
        fileContent = cachedContent.content;
      } else {
        // 2. Fetch from GitHub (or use pre-resolved source)
        if (preResolvedContent) {
          fileContent = preResolvedContent;
        } else {
          logger.debug({ file: cachePath }, "Cache miss, fetching from GitHub");
          const fetchResult = await this.fetchFromGitHub(
            cachePath,
            installationId,
            repo,
            ref,
            orgId
          );

          if (!fetchResult) {
            logger.warn({ file: cachePath }, "File not found on GitHub");
            return null;
          }

          fileContent = fetchResult.content;
          recordCacheHit("github");
        }

        // 3. Check if minified and resolve source map if we fetched bundled file
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
            cachePath = resolvedFrame.file || normalizedFrame.file;
            cacheKey = {
              orgId,
              repo,
              sha: ref,
              path: cachePath,
            };

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

        // 4. Cache the result
        const cacheData: CachedFileContent = {
          content: fileContent,
          path: cachePath,
          sha: ref,
          repo,
          size: fileContent.length,
          language: detectLanguage(resolvedFrame.file),
          cached_at: Date.now(),
          cache_source: "github",
        };

        await storeInAllCacheTiers(cacheKey, cacheData);
      }

      // 5. Extract code context
      const context = this.extractCodeContext(
        fileContent,
        resolvedFrame,
        ref,
        repo,
        sourceMapApplied
      );

      // 6. Build file info
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
      // Validate source map has minimum required fields
      if (!sourceMap || !sourceMap.mappings || !sourceMap.sources) {
        logger.debug(
          { hasMap: !!sourceMap, hasMappings: !!sourceMap?.mappings },
          "Invalid source map structure"
        );
        return null;
      }

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
    } catch (error) {
      logger.debug(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          frame: frame.file,
        },
        "Failed to apply source map"
      );
      return null;
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
