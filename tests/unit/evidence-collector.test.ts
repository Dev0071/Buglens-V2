import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EvidenceCollectorService,
  type CollectEvidenceParams,
  type EventData,
  type CodeFetchResult,
} from "../../src/services/evidence-collector.js";
import type { AnalyzerResult } from "../../src/types/analyzer.js";
import type { EvidenceBundle } from "../../src/types/evidence.js";

// Mock dependencies
vi.mock("../../src/services/github.js", () => ({
  fetchRecentCommits: vi.fn().mockResolvedValue([]),
  parseRepoFullName: vi.fn((fullName: string) => {
    const [owner, repo] = fullName.split("/");
    return { owner, repo };
  }),
  GitHubRateLimitError: class GitHubRateLimitError extends Error {},
}));

vi.mock("../../src/services/cache.js", () => ({
  cacheService: {
    getFromS3: vi.fn(),
    storeInS3: vi.fn(),
  },
}));

vi.mock("../../src/db/client.js", () => ({
  transaction: vi.fn((_orgId: string, fn: (client: unknown) => unknown) => {
    // Simulate a client with a query method
    return fn({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    });
  }),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/utils/config.js", () => ({
  config: {
    AWS_REGION: "us-east-1",
    S3_BUCKET_NAME: "test-bucket",
    S3_ENDPOINT: "",
    AWS_ACCESS_KEY_ID: "test-key",
    AWS_SECRET_ACCESS_KEY: "test-secret",
  },
}));

// Mock S3 client
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
}));

// Mock Python bridge
vi.mock("../../src/services/python-bridge.js", () => ({
  PythonBridge: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({
      steps: [],
      anomalies_count: 0,
      duration_ms: 0,
      first_timestamp: null,
      last_timestamp: null,
      http_requests: 0,
      errors_before_crash: 0,
    }),
  })),
}));

describe("EvidenceCollectorService", () => {
  let service: EvidenceCollectorService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EvidenceCollectorService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("collect", () => {
    it("should collect evidence bundle with all required fields", async () => {
      const params: CollectEvidenceParams = {
        orgId: "org-123",
        eventId: "evt-456",
        jobId: "job-789",
        installationId: "inst-111",
        repo: "owner/repo",
        commitSha: "abc123def456",
      };

      const eventData: EventData = {
        sentry_event_id: "sentry-999",
        message: "TypeError: Cannot read property 'name' of undefined",
        environment: "production",
        release: "app@1.2.3",
        stack_trace: {
          frames: [
            {
              filename: "src/services/user.ts",
              lineno: 42,
              colno: 10,
              function: "getUser",
              in_app: true,
            },
          ],
        },
        breadcrumbs: [],
        context: null,
        raw_payload: {
          exception: {
            values: [
              {
                type: "TypeError",
                value: "Cannot read property 'name' of undefined",
              },
            ],
          },
        },
      };

      const codeResults: CodeFetchResult[] = [
        {
          file: {
            path: "src/services/user.ts",
            content:
              "async function getUser(id) {\n  const user = await db.find(id);\n  return user.name;\n}",
            language: "typescript",
          },
          context: {
            line_number: 42,
            column_number: 10,
            snippet_start: 40,
            snippet_end: 45,
            source_map_resolved: false,
          },
        },
      ];

      const analyzerResult: AnalyzerResult = {
        analyzer: { name: "js_analyzer", version: "0.1.0", runtime_ms: 150 },
        findings: [],
        stats: { frames_analyzed: 1, code_segments: 1 },
      };

      const result = await service.collect(
        params,
        eventData,
        codeResults,
        analyzerResult
      );

      expect(result.org_id).toBe("org-123");
      expect(result.event_id).toBe("evt-456");
      expect(result.job_id).toBe("job-789");
      expect(result.error.message).toBe(
        "TypeError: Cannot read property 'name' of undefined"
      );
      expect(result.error.type).toBe("TypeError");
      expect(result.code.primary).not.toBeNull();
      expect(result.code.primary?.file_path).toBe("src/services/user.ts");
      expect(result.metadata.sentry_event_id).toBe("sentry-999");
    });

    it("should handle missing code results gracefully", async () => {
      const params: CollectEvidenceParams = {
        orgId: "org-123",
        eventId: "evt-456",
        jobId: "job-789",
        installationId: "inst-111",
        repo: "owner/repo",
        commitSha: null,
      };

      const eventData: EventData = {
        sentry_event_id: "sentry-999",
        message: "Error occurred",
        environment: null,
        release: null,
        stack_trace: null,
        breadcrumbs: null,
        context: null,
        raw_payload: {},
      };

      const result = await service.collect(params, eventData, [], null);

      expect(result.code.primary).toBeNull();
      expect(result.code.related).toEqual([]);
      expect(result.deterministic_findings).toEqual([]);
    });

    it("should extract stack trace from event data", async () => {
      const params: CollectEvidenceParams = {
        orgId: "org-123",
        eventId: "evt-456",
        jobId: "job-789",
        installationId: "inst-111",
        repo: "owner/repo",
        commitSha: "abc123",
      };

      const eventData: EventData = {
        sentry_event_id: "sentry-999",
        message: "ReferenceError: x is not defined",
        environment: "staging",
        release: "app@2.0.0",
        stack_trace: {
          frames: [
            {
              filename: "a.js",
              lineno: 10,
              colno: 5,
              function: "foo",
              in_app: true,
            },
            {
              filename: "b.js",
              lineno: 20,
              colno: 8,
              function: "bar",
              in_app: true,
            },
            {
              filename: "node_modules/lib.js",
              lineno: 100,
              colno: 1,
              function: "baz",
              in_app: false,
            },
          ],
        },
        breadcrumbs: [],
        context: null,
        raw_payload: {
          exception: {
            values: [{ type: "ReferenceError", value: "x is not defined" }],
          },
        },
      };

      const result = await service.collect(params, eventData, [], null);

      expect(result.error.stack_trace).toHaveLength(3);
      expect(result.error.stack_trace[0].file).toBe("a.js");
      expect(result.error.stack_trace[0].in_app).toBe(true);
      expect(result.error.stack_trace[2].in_app).toBe(false);
    });
  });

  describe("timeline reconstruction", () => {
    it("should handle empty breadcrumbs", async () => {
      const params: CollectEvidenceParams = {
        orgId: "org-123",
        eventId: "evt-456",
        jobId: "job-789",
        installationId: "inst-111",
        repo: "owner/repo",
        commitSha: null,
      };

      const eventData: EventData = {
        sentry_event_id: "sentry-999",
        message: "Error",
        environment: null,
        release: null,
        stack_trace: null,
        breadcrumbs: [],
        context: null,
        raw_payload: {},
      };

      const result = await service.collect(params, eventData, [], null);

      // Should have timeline even if empty
      expect(result.timeline).not.toBeNull();
      expect(result.timeline?.steps).toEqual([]);
    });

    it("should process breadcrumbs through Python bridge", async () => {
      const params: CollectEvidenceParams = {
        orgId: "org-123",
        eventId: "evt-456",
        jobId: "job-789",
        installationId: "inst-111",
        repo: "owner/repo",
        commitSha: null,
      };

      const breadcrumbs = [
        {
          timestamp: "2024-01-15T10:00:00.000Z",
          type: "navigation",
          category: "navigation",
          message: "Navigate to /dashboard",
        },
        {
          timestamp: "2024-01-15T10:00:05.000Z",
          type: "http",
          category: "fetch",
          message: "HTTP GET /api/users",
        },
      ];

      const eventData: EventData = {
        sentry_event_id: "sentry-999",
        message: "Error",
        environment: null,
        release: null,
        stack_trace: null,
        breadcrumbs,
        context: null,
        raw_payload: {},
      };

      const result = await service.collect(params, eventData, [], null);

      expect(result.timeline).toBeDefined();
    });
  });

  describe("environment context extraction", () => {
    it("should extract environment context from event", async () => {
      const params: CollectEvidenceParams = {
        orgId: "org-123",
        eventId: "evt-456",
        jobId: "job-789",
        installationId: "inst-111",
        repo: "owner/repo",
        commitSha: null,
      };

      const eventData: EventData = {
        sentry_event_id: "sentry-999",
        message: "Error",
        environment: "production",
        release: "app@3.0.0",
        stack_trace: null,
        breadcrumbs: null,
        context: {
          contexts: {
            browser: { name: "Chrome", version: "120.0.0" },
            os: { name: "macOS", version: "14.0" },
            runtime: { name: "node", version: "20.11.0" },
          },
          tags: { deployment: "blue" },
        },
        raw_payload: {},
      };

      const result = await service.collect(params, eventData, [], null);

      expect(result.environment.environment).toBe("production");
      expect(result.environment.release).toBe("app@3.0.0");
      expect(result.environment.browser?.name).toBe("Chrome");
      expect(result.environment.os?.name).toBe("macOS");
      expect(result.environment.runtime?.name).toBe("node");
    });

    it("should handle missing environment context", async () => {
      const params: CollectEvidenceParams = {
        orgId: "org-123",
        eventId: "evt-456",
        jobId: "job-789",
        installationId: "inst-111",
        repo: "owner/repo",
        commitSha: null,
      };

      const eventData: EventData = {
        sentry_event_id: "sentry-999",
        message: "Error",
        environment: null,
        release: null,
        stack_trace: null,
        breadcrumbs: null,
        context: null,
        raw_payload: {},
      };

      const result = await service.collect(params, eventData, [], null);

      expect(result.environment.environment).toBeNull();
      expect(result.environment.release).toBeNull();
      expect(result.environment.browser).toBeNull();
    });
  });

  describe("code context building", () => {
    it("should build code context from multiple code results", async () => {
      const params: CollectEvidenceParams = {
        orgId: "org-123",
        eventId: "evt-456",
        jobId: "job-789",
        installationId: "inst-111",
        repo: "owner/repo",
        commitSha: "abc123",
      };

      const eventData: EventData = {
        sentry_event_id: "sentry-999",
        message: "Error",
        environment: null,
        release: null,
        stack_trace: null,
        breadcrumbs: null,
        context: null,
        raw_payload: {},
      };

      const codeResults: CodeFetchResult[] = [
        {
          file: {
            path: "src/primary.ts",
            content: "// primary code",
            language: "typescript",
          },
          context: {
            line_number: 10,
            column_number: 5,
            snippet_start: 8,
            snippet_end: 12,
            source_map_resolved: true,
          },
        },
        {
          file: {
            path: "src/secondary.ts",
            content: "// secondary code",
            language: "typescript",
          },
          context: {
            line_number: 20,
            column_number: 10,
            snippet_start: 18,
            snippet_end: 22,
            source_map_resolved: false,
          },
        },
      ];

      const result = await service.collect(
        params,
        eventData,
        codeResults,
        null
      );

      expect(result.code.primary?.file_path).toBe("src/primary.ts");
      expect(result.code.primary?.source_map_resolved).toBe(true);
      expect(result.code.related).toHaveLength(1);
      expect(result.code.related[0].file_path).toBe("src/secondary.ts");
      expect(result.metadata.source_map_used).toBe(true);
    });
  });
});

describe("Evidence Bundle Schema Validation", () => {
  it("should validate a complete evidence bundle structure", () => {
    const bundle: EvidenceBundle = {
      bundle_id: "00000000-0000-0000-0000-000000000001",
      created_at: new Date().toISOString(),
      org_id: "00000000-0000-0000-0000-000000000002",
      event_id: "00000000-0000-0000-0000-000000000003",
      job_id: "00000000-0000-0000-0000-000000000004",
      error: {
        message: "Test error",
        type: "TypeError",
        value: "Test error value",
        stack_trace: [
          {
            file: "test.js",
            line: 10,
            column: 5,
            function: "testFn",
            in_app: true,
          },
        ],
      },
      code: {
        primary: {
          file_path: "test.js",
          line_number: 10,
          column_number: 5,
          snippet: "const x = null; x.foo();",
          snippet_start_line: 8,
          snippet_end_line: 12,
          language: "javascript",
          source_map_resolved: false,
        },
        related: [],
        repo: "owner/repo",
        commit_sha: "abc123",
      },
      deterministic_findings: [],
      timeline: {
        steps: [],
        anomalies_count: 0,
        duration_ms: 0,
        first_timestamp: null,
        last_timestamp: null,
        http_requests: 0,
        errors_before_crash: 0,
      },
      recent_commits: [],
      environment: {
        environment: "production",
        release: "1.0.0",
        server_name: null,
        user_agent: null,
        browser: null,
        os: null,
        device: null,
        runtime: { name: "node", version: "20.0.0" },
        sdk: null,
        tags: {},
      },
      metadata: {
        sentry_event_id: "sentry-123",
        processing_started_at: new Date().toISOString(),
        code_fetch_source: "github",
        source_map_used: false,
      },
    };

    expect(bundle.bundle_id).toBeDefined();
    expect(bundle.error.message).toBe("Test error");
    expect(bundle.code.primary?.file_path).toBe("test.js");
  });
});
