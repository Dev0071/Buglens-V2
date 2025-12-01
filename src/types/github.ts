import { z } from "zod";

// ============================================
// GitHub API Response Types
// ============================================

/**
 * GitHub file content from Contents API
 */
export interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: "file" | "dir" | "symlink" | "submodule";
  content?: string; // Base64 encoded for files
  encoding?: "base64";
}

/**
 * GitHub repository information
 */
export interface GitHubRepository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
  owner: {
    login: string;
    id: number;
    avatar_url: string;
    type: "User" | "Organization";
  };
  html_url: string;
  description: string | null;
  fork: boolean;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  language: string | null;
}

/**
 * GitHub App installation
 */
export interface GitHubInstallation {
  id: number;
  account: {
    login: string;
    id: number;
    type: "User" | "Organization";
  };
  repository_selection: "all" | "selected";
  access_tokens_url: string;
  repositories_url: string;
  app_id: number;
  target_id: number;
  target_type: "User" | "Organization";
  permissions: {
    contents?: "read" | "write";
    metadata?: "read" | "write";
    [key: string]: string | undefined;
  };
  events: string[];
  created_at: string;
  updated_at: string;
  suspended_at: string | null;
}

/**
 * GitHub commit information
 */
export interface GitHubCommit {
  sha: string;
  node_id: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
    tree: {
      sha: string;
      url: string;
    };
    url: string;
    comment_count: number;
  };
  url: string;
  html_url: string;
  author: {
    login: string;
    id: number;
    avatar_url: string;
  } | null;
  committer: {
    login: string;
    id: number;
    avatar_url: string;
  } | null;
  parents: Array<{
    sha: string;
    url: string;
    html_url: string;
  }>;
}

/**
 * Installation access token response
 */
export interface GitHubInstallationToken {
  token: string;
  expires_at: string;
  permissions: Record<string, string>;
  repository_selection: "all" | "selected";
}

// ============================================
// Internal Types
// ============================================

/**
 * Cached file content with metadata
 */
export interface CachedFileContent {
  content: string;
  path: string;
  sha: string;
  repo: string;
  size: number;
  language: string | null;
  cached_at: number;
  cache_source: "redis" | "s3" | "database" | "github";
}

/**
 * Stack frame from error trace
 */
export interface StackFrame {
  filename: string;
  function: string | null;
  lineno: number | null;
  colno: number | null;
  abs_path: string | null;
  context_line: string | null;
  pre_context: string[] | null;
  post_context: string[] | null;
  in_app: boolean;
}

/**
 * Resolved source location after source map mapping
 */
export interface ResolvedSourceLocation {
  file: string;
  line: number;
  column: number;
  name: string | null;
  original_file: string; // The minified file
}

/**
 * Code context extracted around error location
 */
export interface CodeContext {
  file_path: string;
  line_number: number;
  column_number: number | null;
  snippet: string;
  snippet_start_line: number;
  snippet_end_line: number;
  language: string;
  sha: string;
  repo: string;
  source_map_resolved: boolean;
}

/**
 * Repository configuration stored in database
 */
export interface RepoConfig {
  id: string;
  org_id: string;
  provider: "github";
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  installation_id: string | null;
  is_active: boolean;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ============================================
// Zod Schemas for Validation
// ============================================

export const stackFrameSchema = z.object({
  filename: z.string(),
  function: z.string().nullable().optional(),
  lineno: z.number().nullable().optional(),
  colno: z.number().nullable().optional(),
  abs_path: z.string().nullable().optional(),
  context_line: z.string().nullable().optional(),
  pre_context: z.array(z.string()).nullable().optional(),
  post_context: z.array(z.string()).nullable().optional(),
  in_app: z.boolean().optional().default(true),
});

export const gitHubWebhookInstallationSchema = z.object({
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
    repository_selection: z.enum(["all", "selected"]),
    app_id: z.number(),
    target_id: z.number(),
    target_type: z.enum(["User", "Organization"]),
    permissions: z.record(z.string()),
    events: z.array(z.string()),
  }),
  repositories: z
    .array(
      z.object({
        id: z.number(),
        node_id: z.string(),
        name: z.string(),
        full_name: z.string(),
        private: z.boolean(),
      })
    )
    .optional(),
  sender: z.object({
    login: z.string(),
    id: z.number(),
    type: z.enum(["User", "Organization", "Bot"]),
  }),
});

export type GitHubWebhookInstallationPayload = z.infer<
  typeof gitHubWebhookInstallationSchema
>;

// ============================================
// Cache Key Types
// ============================================

export interface CacheKeyParams {
  orgId: string;
  repo: string;
  sha: string;
  path: string;
}

/**
 * Sanitize a file path to be safe for cache keys (S3 and Redis).
 * Handles:
 * - Path traversal attempts (../)
 * - Leading/trailing slashes
 * - Consecutive slashes
 * - Spaces and special characters
 * - URL-encoded characters
 *
 * @example
 * sanitizePathForCacheKey("//app/../src/file.js") -> "src/file.js"
 * sanitizePathForCacheKey("src/ file.js") -> "src/_file.js"
 * sanitizePathForCacheKey("/app/src//utils/index.ts") -> "app/src/utils/index.ts"
 */
export function sanitizePathForCacheKey(path: string): string {
  let sanitized = path;

  // 1. Decode URL-encoded characters first (e.g., %20 -> space)
  try {
    sanitized = decodeURIComponent(sanitized);
  } catch {
    // If decoding fails, continue with original
  }

  // 2. Normalize path separators (handle Windows-style backslashes)
  sanitized = sanitized.replace(/\\/g, "/");

  // 3. Remove path traversal sequences (../ and ./)
  // Split by /, filter out .. and . segments, rejoin
  const segments = sanitized.split("/").filter((segment) => {
    return segment !== ".." && segment !== "." && segment !== "";
  });

  // 4. Rejoin and handle edge cases
  sanitized = segments.join("/");

  // 5. Replace problematic characters:
  //    - Spaces -> underscores
  //    - Control characters -> removed
  //    - Multiple consecutive special chars -> single
  sanitized = sanitized
    .replace(/\s+/g, "_") // Spaces to underscores
    // eslint-disable-next-line no-control-regex -- Intentional: remove control chars for security
    .replace(/[\x00-\x1f\x7f]/g, "") // Remove control characters (ASCII 0-31 and 127)
    .replace(/[<>:"|?*]/g, "_") // Replace Windows-invalid chars
    .replace(/_+/g, "_") // Collapse multiple underscores
    .replace(/\/+/g, "/"); // Collapse multiple slashes

  // 6. Remove leading/trailing slashes and underscores
  sanitized = sanitized.replace(/^[/_]+|[/_]+$/g, "");

  // 7. Ensure we have a valid path (fallback to hash if empty)
  if (!sanitized) {
    // Generate a safe fallback from original path
    sanitized = `_invalid_path_${Buffer.from(path).toString("base64url").slice(0, 32)}`;
  }

  return sanitized;
}

export function buildRedisCacheKey(params: CacheKeyParams): string {
  const safePath = sanitizePathForCacheKey(params.path);
  return `gh:file:${params.orgId}:${params.repo}:${params.sha}:${safePath}`;
}

export function buildS3CacheKey(params: CacheKeyParams): string {
  const safePath = sanitizePathForCacheKey(params.path);
  return `cache/${params.orgId}/${params.repo}/${params.sha}/${safePath}`;
}

// ============================================
// GitHub API Rate Limit Types
// ============================================

export interface GitHubRateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
  used: number;
}

export interface GitHubRateLimitResponse {
  resources: {
    core: GitHubRateLimitInfo;
    search: GitHubRateLimitInfo;
    graphql: GitHubRateLimitInfo;
    integration_manifest: GitHubRateLimitInfo;
  };
  rate: GitHubRateLimitInfo;
}
