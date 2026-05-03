/**
 * SentrySourceMapFetcher
 *
 * Fetches source maps that have been uploaded to Sentry (via sentry-cli or
 * webpack-sentry-plugin) when they are not present in the GitHub repo.
 *
 * Used as the second-tier fallback inside CodeFetcher: GitHub repo first,
 * then Sentry releases API.
 *
 * Sentry API ref:
 *   GET /api/0/projects/{org_slug}/{proj_slug}/releases/{version}/files/
 *   GET /api/0/projects/{org_slug}/{proj_slug}/releases/{version}/files/{id}/?download=1
 *
 * Requires the org to have configured a Sentry user auth token with the
 * `project:releases` scope (stored in the integration config).
 */

import type { RawSourceMap } from "source-map";
import { query } from "../db/client.js";
import { redis } from "../db/redis.js";
import { logger } from "../utils/logger.js";

interface SentryReleaseFile {
  id: string;
  name: string;
  size: number;
  sha1: string;
}

interface CachedSentryConfig {
  authToken: string | null;
  organizationSlug: string;
  projectSlug: string;
  apiBaseUrl: string;
}

const CONFIG_CACHE_TTL_MS = 60_000; // 1 minute
const MAP_CACHE_TTL_SECONDS = 60 * 60 * 6; // 6 hours — releases are immutable
const MAP_NEGATIVE_TTL_SECONDS = 60 * 5; // 5 minutes for "not found" so missing maps don't hammer the API
const MAX_PAGES = 5; // hard ceiling on pagination, ~500 files

const configCache = new Map<
  string,
  { config: CachedSentryConfig | null; cachedAt: number }
>();

function configCacheKey(orgId: string): string {
  return `sentry:config:${orgId}`;
}

async function loadSentryConfig(
  orgId: string
): Promise<CachedSentryConfig | null> {
  const cached = configCache.get(configCacheKey(orgId));
  if (cached && Date.now() - cached.cachedAt < CONFIG_CACHE_TTL_MS) {
    return cached.config;
  }

  const result = await query<{ config: Record<string, unknown> | null }>(
    `SELECT config FROM integrations
     WHERE org_id = $1 AND type = 'sentry' AND is_active = true
     ORDER BY updated_at DESC
     LIMIT 1`,
    [orgId]
  );

  let resolved: CachedSentryConfig | null = null;
  if (result.rows.length > 0 && result.rows[0].config) {
    const cfg = result.rows[0].config as Record<string, unknown>;
    const orgSlug = typeof cfg.organization_slug === "string"
      ? cfg.organization_slug
      : null;
    const projSlug = typeof cfg.project_slug === "string"
      ? cfg.project_slug
      : null;
    const authToken = typeof cfg.auth_token === "string" ? cfg.auth_token : null;
    const apiBaseUrl = typeof cfg.api_base_url === "string"
      ? cfg.api_base_url
      : "https://sentry.io";

    if (orgSlug && projSlug) {
      resolved = {
        authToken,
        organizationSlug: orgSlug,
        projectSlug: projSlug,
        apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
      };
    }
  }

  configCache.set(configCacheKey(orgId), {
    config: resolved,
    cachedAt: Date.now(),
  });
  return resolved;
}

/**
 * Invalidate the in-process config cache for an org. Call after the Sentry
 * integration is reconfigured.
 */
export function invalidateSentryConfigCache(orgId: string): void {
  configCache.delete(configCacheKey(orgId));
}

function mapCacheKey(
  orgId: string,
  release: string,
  filename: string
): string {
  return `sentry:sourcemap:v1:${orgId}:${release}:${filename}`;
}

/**
 * Best-effort match: Sentry release files store names like
 * `~/static/js/app.abc.js.map` or absolute URLs. Frames may have absolute URLs
 * or relative paths. Match by suffix.
 */
function fileMatchesCandidate(fileName: string, candidate: string): boolean {
  const normalized = fileName.replace(/^~/, "").toLowerCase();
  const target = candidate.toLowerCase();
  return (
    normalized === target ||
    normalized.endsWith(target) ||
    target.endsWith(normalized)
  );
}

async function findReleaseFile(
  config: CachedSentryConfig,
  release: string,
  candidates: string[]
): Promise<SentryReleaseFile | null> {
  if (!config.authToken) {
    return null;
  }

  const headers = {
    Authorization: `Bearer ${config.authToken}`,
    "User-Agent": "buglens-source-map-fetcher/1.0",
  };

  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(
      `/api/0/projects/${config.organizationSlug}/${config.projectSlug}/releases/${encodeURIComponent(release)}/files/`,
      config.apiBaseUrl
    );
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      logger.debug(
        {
          status: response.status,
          release,
          page,
        },
        "Sentry release files request failed"
      );
      return null;
    }

    const files = (await response.json()) as SentryReleaseFile[];
    for (const candidate of candidates) {
      const match = files.find((f) => fileMatchesCandidate(f.name, candidate));
      if (match) {
        return match;
      }
    }

    cursor = parseNextCursor(response.headers.get("link"));
    if (!cursor) {
      return null;
    }
  }

  return null;
}

function parseNextCursor(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // Sentry follows RFC 5988: `<url>; rel="next"; results="true"; cursor="abc"`
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const isNext = /rel="next"/.test(part);
    const hasResults = /results="true"/.test(part);
    if (!isNext || !hasResults) continue;
    const cursorMatch = part.match(/cursor="([^"]+)"/);
    if (cursorMatch) return cursorMatch[1];
  }
  return null;
}

async function downloadFile(
  config: CachedSentryConfig,
  fileId: string
): Promise<string | null> {
  if (!config.authToken) {
    return null;
  }

  const url = new URL(
    `/api/0/projects/${config.organizationSlug}/${config.projectSlug}/files/source-maps/${fileId}/?download=1`,
    config.apiBaseUrl
  );

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.authToken}`,
      "User-Agent": "buglens-source-map-fetcher/1.0",
    },
  });

  if (!response.ok) {
    logger.debug(
      { status: response.status, fileId },
      "Sentry source map download failed"
    );
    return null;
  }

  return await response.text();
}

/**
 * Fetch a source map from Sentry's release files API.
 *
 * Returns null if:
 *  - Sentry is not configured for this org
 *  - No auth token is configured
 *  - No release info is available on the event
 *  - No matching file is found in the release
 *  - The download fails
 */
export async function fetchSourceMapFromSentry(opts: {
  orgId: string;
  release: string | null;
  candidates: string[];
}): Promise<RawSourceMap | null> {
  const { orgId, release, candidates } = opts;

  if (!release || candidates.length === 0) {
    return null;
  }

  const config = await loadSentryConfig(orgId);
  if (!config || !config.authToken) {
    return null;
  }

  // Cache lookup: hit on the first candidate (they all map to the same logical resource)
  const cacheKey = mapCacheKey(orgId, release, candidates[0]);
  try {
    const cached = await redis.client.get(cacheKey);
    if (cached === "__not_found__") {
      return null;
    }
    if (cached) {
      return JSON.parse(cached) as RawSourceMap;
    }
  } catch (err) {
    logger.debug({ err }, "Sentry source map cache read failed, continuing");
  }

  try {
    const file = await findReleaseFile(config, release, candidates);
    if (!file) {
      await safeSetCache(cacheKey, "__not_found__", MAP_NEGATIVE_TTL_SECONDS);
      return null;
    }

    const content = await downloadFile(config, file.id);
    if (!content) {
      await safeSetCache(cacheKey, "__not_found__", MAP_NEGATIVE_TTL_SECONDS);
      return null;
    }

    let parsed: RawSourceMap;
    try {
      parsed = JSON.parse(content) as RawSourceMap;
    } catch (err) {
      logger.warn(
        { err, fileId: file.id, release },
        "Sentry returned non-JSON for source map file"
      );
      await safeSetCache(cacheKey, "__not_found__", MAP_NEGATIVE_TTL_SECONDS);
      return null;
    }

    await safeSetCache(cacheKey, content, MAP_CACHE_TTL_SECONDS);

    logger.info(
      {
        orgId,
        release,
        candidate: candidates[0],
        sentryFileId: file.id,
      },
      "Resolved source map from Sentry release files"
    );

    return parsed;
  } catch (err) {
    logger.warn(
      { err, orgId, release },
      "Sentry source map fetch threw, falling back to null"
    );
    return null;
  }
}

async function safeSetCache(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  try {
    await redis.client.set(key, value, "EX", ttlSeconds);
  } catch (err) {
    logger.debug({ err, key }, "Sentry source map cache write failed");
  }
}
