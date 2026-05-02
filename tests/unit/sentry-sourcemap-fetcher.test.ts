/**
 * Sentry Source Map Fetcher Tests
 *
 * Mocks `query` (DB), `redis.client` (cache), and global `fetch` to verify the
 * resolution flow without hitting Sentry or the database.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

vi.mock("../../src/db/client.js", () => ({
  query: vi.fn(),
}));

vi.mock("../../src/db/redis.js", () => ({
  redis: {
    client: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
}));

vi.mock("../../src/services/oauth.js", () => ({
  getIntegrationSecrets: vi.fn(),
}));

import { query } from "../../src/db/client.js";
import { redis } from "../../src/db/redis.js";
import { getIntegrationSecrets } from "../../src/services/oauth.js";
import {
  fetchSourceMapFromSentry,
  invalidateSentryConfigCache,
} from "../../src/services/sentry-sourcemap-fetcher.js";

const mockedQuery = query as unknown as Mock;
const mockedRedisGet = redis.client.get as unknown as Mock;
const mockedRedisSet = redis.client.set as unknown as Mock;
const mockedGetSecrets = getIntegrationSecrets as unknown as Mock;
const ORG_ID = "org-test-123";

const VALID_MAP_JSON = JSON.stringify({
  version: 3,
  file: "app.min.js",
  sources: ["src/app.ts"],
  names: [],
  mappings: "AAAA",
});

function mockSentryConfig(
  overrides: Partial<{
    authToken: string | null;
    organizationSlug: string;
    projectSlug: string;
    apiBaseUrl: string;
  }> = {}
) {
  // The plaintext config row (no auth_token here — secrets live elsewhere now).
  mockedQuery.mockResolvedValueOnce({
    rows: [
      {
        config: {
          organization_slug: overrides.organizationSlug ?? "acme",
          project_slug: overrides.projectSlug ?? "frontend",
          api_base_url: overrides.apiBaseUrl ?? "https://sentry.io",
        },
      },
    ],
  });
  // Encrypted secrets returned by getIntegrationSecrets.
  const tokenValue =
    overrides.authToken === undefined ? "sntrys_test_token" : overrides.authToken;
  mockedGetSecrets.mockResolvedValueOnce(
    tokenValue === null ? {} : { auth_token: tokenValue }
  );
}

describe("fetchSourceMapFromSentry", () => {
  beforeEach(() => {
    invalidateSentryConfigCache(ORG_ID);
    mockedQuery.mockReset();
    mockedRedisGet.mockReset();
    mockedRedisSet.mockReset();
    mockedGetSecrets.mockReset();
    mockedRedisGet.mockResolvedValue(null);
    mockedRedisSet.mockResolvedValue("OK");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when release is missing", async () => {
    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: null,
      candidates: ["app.min.js.map"],
    });

    expect(result).toBeNull();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("returns null when no candidates are provided", async () => {
    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: [],
    });

    expect(result).toBeNull();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("returns null when no Sentry integration is configured", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: ["app.min.js.map"],
    });

    expect(result).toBeNull();
  });

  it("returns null when integration exists but has no auth token", async () => {
    mockSentryConfig({ authToken: null });

    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: ["app.min.js.map"],
    });

    expect(result).toBeNull();
    // Should not have hit fetch
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches and parses a source map on cache miss", async () => {
    mockSentryConfig();

    const fetchMock = global.fetch as unknown as Mock;
    // First call: list release files
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "file-abc", name: "~/app.min.js.map", size: 100, sha1: "x" }],
      headers: { get: () => null },
    });
    // Second call: download file
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => VALID_MAP_JSON,
    });

    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: ["app.min.js.map"],
    });

    expect(result).not.toBeNull();
    expect(result?.version).toBe(3);
    expect(result?.sources).toContain("src/app.ts");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Should have written to positive cache
    expect(mockedRedisSet).toHaveBeenCalledWith(
      expect.stringContaining("sentry:sourcemap:v1:"),
      VALID_MAP_JSON,
      "EX",
      expect.any(Number)
    );
  });

  it("returns cached map without hitting Sentry", async () => {
    mockSentryConfig();
    mockedRedisGet.mockResolvedValueOnce(VALID_MAP_JSON);

    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: ["app.min.js.map"],
    });

    expect(result).not.toBeNull();
    expect(result?.version).toBe(3);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("respects negative cache and skips Sentry call", async () => {
    mockSentryConfig();
    mockedRedisGet.mockResolvedValueOnce("__not_found__");

    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: ["app.min.js.map"],
    });

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("writes a negative cache entry when no matching file is found", async () => {
    mockSentryConfig();
    const fetchMock = global.fetch as unknown as Mock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "x", name: "~/something-else.js.map", size: 1, sha1: "x" }],
      headers: { get: () => null },
    });

    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: ["app.min.js.map"],
    });

    expect(result).toBeNull();
    expect(mockedRedisSet).toHaveBeenCalledWith(
      expect.stringContaining("sentry:sourcemap:v1:"),
      "__not_found__",
      "EX",
      expect.any(Number)
    );
  });

  it("matches release file names with the leading ~/ prefix Sentry uses", async () => {
    mockSentryConfig();

    const fetchMock = global.fetch as unknown as Mock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      // Sentry stores `~/static/js/app.min.js.map`, frame asks for `static/js/app.min.js.map`
      json: async () => [{ id: "f1", name: "~/static/js/app.min.js.map", size: 1, sha1: "x" }],
      headers: { get: () => null },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => VALID_MAP_JSON,
    });

    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: ["static/js/app.min.js.map"],
    });

    expect(result).not.toBeNull();
  });

  it("returns null and recovers gracefully when Sentry returns 401", async () => {
    mockSentryConfig();
    const fetchMock = global.fetch as unknown as Mock;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
      headers: { get: () => null },
    });

    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: ["app.min.js.map"],
    });

    expect(result).toBeNull();
  });

  it("returns null when the downloaded map is not valid JSON", async () => {
    mockSentryConfig();
    const fetchMock = global.fetch as unknown as Mock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "f1", name: "~/app.min.js.map", size: 1, sha1: "x" }],
      headers: { get: () => null },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => "<html>not a source map</html>",
    });

    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: ["app.min.js.map"],
    });

    expect(result).toBeNull();
    // Should write negative cache so we don't keep trying
    expect(mockedRedisSet).toHaveBeenCalledWith(
      expect.stringContaining("sentry:sourcemap:v1:"),
      "__not_found__",
      "EX",
      expect.any(Number)
    );
  });

  it("rejects a non-allowlisted api_base_url defensively at read time", async () => {
    // Even if a stale row has a malicious base URL (e.g. from a pre-allowlist
    // write), the fetcher must refuse to fire requests against it.
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          config: {
            organization_slug: "acme",
            project_slug: "frontend",
            api_base_url: "https://attacker.example.com",
          },
        },
      ],
    });

    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: ["app.min.js.map"],
    });

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    // Should not have decrypted secrets either, since the host failed first.
    expect(mockedGetSecrets).not.toHaveBeenCalled();
  });

  it("accepts an *.sentry.io subdomain like eu.sentry.io", async () => {
    mockSentryConfig({ apiBaseUrl: "https://eu.sentry.io" });

    const fetchMock = global.fetch as unknown as Mock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
      headers: { get: () => null },
    });

    await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: ["app.min.js.map"],
    });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("https://eu.sentry.io");
    expect(calledUrl).toContain(
      "/api/0/projects/acme/frontend/releases/v1.0.0/files/"
    );
  });

  it("downloads from the release-files endpoint, not the org source-maps endpoint", async () => {
    mockSentryConfig();
    const fetchMock = global.fetch as unknown as Mock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: "file-xyz", name: "~/app.min.js.map", size: 1, sha1: "x" },
      ],
      headers: { get: () => null },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => VALID_MAP_JSON,
    });

    await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v2.0.0",
      candidates: ["app.min.js.map"],
    });

    const downloadUrl = fetchMock.mock.calls[1][0] as string;
    expect(downloadUrl).toContain(
      "/api/0/projects/acme/frontend/releases/v2.0.0/files/file-xyz/"
    );
    expect(downloadUrl).toContain("download=1");
  });

  it("paginates through release files using the link header cursor", async () => {
    mockSentryConfig();
    const fetchMock = global.fetch as unknown as Mock;

    // Page 1: no match, has next cursor
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "x", name: "~/other.js.map", size: 1, sha1: "x" }],
      headers: {
        get: (h: string) =>
          h === "link"
            ? '<https://sentry.io/api/0/.../files/?cursor=PAGE2>; rel="next"; results="true"; cursor="PAGE2"'
            : null,
      },
    });

    // Page 2: match found
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "f1", name: "~/app.min.js.map", size: 1, sha1: "x" }],
      headers: { get: () => null },
    });

    // Download
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => VALID_MAP_JSON,
    });

    const result = await fetchSourceMapFromSentry({
      orgId: ORG_ID,
      release: "v1.0.0",
      candidates: ["app.min.js.map"],
    });

    expect(result).not.toBeNull();
    // 2 list calls + 1 download
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Second list call should include the cursor
    const secondUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondUrl).toContain("cursor=PAGE2");
  });
});
