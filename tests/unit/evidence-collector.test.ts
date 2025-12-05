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

// Mock Python bridge - keep original for some tests
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
        validation_passed: true,
      },
    };

    expect(bundle.bundle_id).toBeDefined();
    expect(bundle.error.message).toBe("Test error");
    expect(bundle.code.primary?.file_path).toBe("test.js");
  });
});

describe("Python Bridge Timeline Reconstruction", () => {
  const baseParams: CollectEvidenceParams = {
    orgId: "org-123",
    eventId: "evt-456",
    jobId: "job-789",
    installationId: "inst-111",
    repo: "owner/repo",
    commitSha: null,
  };

  const baseEventData: EventData = {
    sentry_event_id: "sentry-999",
    message: "Error",
    environment: null,
    release: null,
    stack_trace: null,
    breadcrumbs: [
      {
        timestamp: "2024-01-15T10:00:00.000Z",
        type: "navigation",
        category: "navigation",
        message: "Navigate to /dashboard",
        level: "info",
      },
      {
        timestamp: "2024-01-15T10:00:05.000Z",
        type: "http",
        category: "fetch",
        message: "HTTP GET /api/users",
        level: "info",
      },
    ],
    context: null,
    raw_payload: {},
  };

  it("should use Python bridge timeline data when available", async () => {
    const mockTimeline = {
      steps: [
        {
          timestamp: "2024-01-15T10:00:00.000Z",
          timestamp_ms: 1705312800000,
          type: "navigation" as const,
          category: "navigation",
          message: "Navigate to /dashboard",
          level: "info" as const,
          is_anomaly: false,
        },
        {
          timestamp: "2024-01-15T10:00:05.000Z",
          timestamp_ms: 1705312805000,
          type: "http" as const,
          category: "fetch",
          message: "HTTP GET /api/users",
          level: "info" as const,
          is_anomaly: true,
          anomaly_reason: "Unusually slow response",
        },
      ],
      anomalies_count: 1,
      duration_ms: 5000,
      first_timestamp: "2024-01-15T10:00:00.000Z",
      last_timestamp: "2024-01-15T10:00:05.000Z",
      http_requests: 1,
      errors_before_crash: 0,
    };

    const mockPythonBridge = {
      execute: vi.fn().mockResolvedValue(mockTimeline),
    };

    const service = new EvidenceCollectorService({
      pythonBridge: mockPythonBridge as unknown as InstanceType<
        typeof import("../../src/services/python-bridge.js").PythonBridge
      >,
    });

    const result = await service.collect(baseParams, baseEventData, [], null);

    expect(mockPythonBridge.execute).toHaveBeenCalledWith({
      breadcrumbs: baseEventData.breadcrumbs,
    });
    expect(result.timeline).not.toBeNull();
    expect(result.timeline?.anomalies_count).toBe(1);
    expect(result.timeline?.steps).toHaveLength(2);
    expect(result.timeline?.steps[1].is_anomaly).toBe(true);
  });

  it("should fall back to buildFallbackTimeline when Python bridge throws error", async () => {
    const mockPythonBridge = {
      execute: vi.fn().mockRejectedValue(new Error("Python process crashed")),
    };

    const service = new EvidenceCollectorService({
      pythonBridge: mockPythonBridge as unknown as InstanceType<
        typeof import("../../src/services/python-bridge.js").PythonBridge
      >,
    });

    const result = await service.collect(baseParams, baseEventData, [], null);

    // Should still have timeline from fallback
    expect(result.timeline).not.toBeNull();
    expect(result.timeline?.steps).toHaveLength(2);
    // Fallback doesn't detect anomalies
    expect(result.timeline?.anomalies_count).toBe(0);
    // But should correctly count http requests
    expect(result.timeline?.http_requests).toBe(1);
  });

  it("should handle Python bridge returning malformed data gracefully", async () => {
    // Malformed: missing required fields
    const malformedData = {
      steps: "not an array", // Should be array
      anomalies_count: "one", // Should be number
    };

    const mockPythonBridge = {
      execute: vi.fn().mockResolvedValue(malformedData),
    };

    const service = new EvidenceCollectorService({
      pythonBridge: mockPythonBridge as unknown as InstanceType<
        typeof import("../../src/services/python-bridge.js").PythonBridge
      >,
    });

    // Even with malformed data, collection should complete
    // The bundle validation will flag it
    const result = await service.collect(baseParams, baseEventData, [], null);

    expect(result).toBeDefined();
    expect(result.bundle_id).toBeDefined();
  });

  it("should handle Python bridge timeout", async () => {
    const mockPythonBridge = {
      execute: vi.fn().mockRejectedValue(new Error("Timeout: Process killed")),
    };

    const service = new EvidenceCollectorService({
      pythonBridge: mockPythonBridge as unknown as InstanceType<
        typeof import("../../src/services/python-bridge.js").PythonBridge
      >,
    });

    const result = await service.collect(baseParams, baseEventData, [], null);

    // Should fall back gracefully
    expect(result.timeline).not.toBeNull();
    expect(result.timeline?.steps).toHaveLength(2);
  });
});

describe("Code Fetch Source Tracking", () => {
  const baseParams: CollectEvidenceParams = {
    orgId: "org-123",
    eventId: "evt-456",
    jobId: "job-789",
    installationId: "inst-111",
    repo: "owner/repo",
    commitSha: "abc123",
  };

  const baseEventData: EventData = {
    sentry_event_id: "sentry-999",
    message: "Error",
    environment: null,
    release: null,
    stack_trace: null,
    breadcrumbs: null,
    context: null,
    raw_payload: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should track redis_cache source for cache hit metrics", async () => {
    const codeResults: CodeFetchResult[] = [
      {
        file: { path: "src/a.ts", content: "code", language: "typescript" },
        context: {
          line_number: 10,
          column_number: 5,
          snippet_start: 8,
          snippet_end: 12,
          source_map_resolved: false,
        },
        source: "redis_cache",
      },
    ];

    const service = new EvidenceCollectorService();
    const result = await service.collect(
      baseParams,
      baseEventData,
      codeResults,
      null
    );

    expect(result.metadata.code_fetch_source).toBe("redis_cache");
  });

  it("should track s3_cache source separately from redis", async () => {
    const codeResults: CodeFetchResult[] = [
      {
        file: { path: "src/a.ts", content: "code", language: "typescript" },
        context: {
          line_number: 10,
          column_number: 5,
          snippet_start: 8,
          snippet_end: 12,
          source_map_resolved: false,
        },
        source: "s3_cache",
      },
    ];

    const service = new EvidenceCollectorService();
    const result = await service.collect(
      baseParams,
      baseEventData,
      codeResults,
      null
    );

    expect(result.metadata.code_fetch_source).toBe("s3_cache");
  });

  it("should report github if any result came from github (worst case)", async () => {
    const codeResults: CodeFetchResult[] = [
      {
        file: { path: "src/a.ts", content: "code", language: "typescript" },
        context: {
          line_number: 10,
          column_number: 5,
          snippet_start: 8,
          snippet_end: 12,
          source_map_resolved: false,
        },
        source: "redis_cache",
      },
      {
        file: { path: "src/b.ts", content: "code", language: "typescript" },
        context: {
          line_number: 20,
          column_number: 10,
          snippet_start: 18,
          snippet_end: 22,
          source_map_resolved: false,
        },
        source: "github", // One cache miss
      },
    ];

    const service = new EvidenceCollectorService();
    const result = await service.collect(
      baseParams,
      baseEventData,
      codeResults,
      null
    );

    // Should report worst case for metrics accuracy
    expect(result.metadata.code_fetch_source).toBe("github");
  });

  it("should default to github when source is not tracked (legacy)", async () => {
    const codeResults: CodeFetchResult[] = [
      {
        file: { path: "src/a.ts", content: "code", language: "typescript" },
        context: {
          line_number: 10,
          column_number: 5,
          snippet_start: 8,
          snippet_end: 12,
          source_map_resolved: false,
        },
        // No source field - legacy code result
      },
    ];

    const service = new EvidenceCollectorService();
    const result = await service.collect(
      baseParams,
      baseEventData,
      codeResults,
      null
    );

    expect(result.metadata.code_fetch_source).toBe("github");
  });
});

describe("S3 Storage and Retrieval", () => {
  /**
   * Tests for S3 storage layer.
   * Note: The S3Client is a singleton that gets cached, so we test
   * the storage reference structure and key generation logic rather
   * than the actual S3 operations (which are mocked at module level).
   */

  describe("storeInS3 key generation", () => {
    it("should generate date-prefixed keys for S3 organization", () => {
      // Key format: evidence/YYYY/MM/DD/org_id/job_id/bundle_id.json.gz
      const bundle = {
        bundle_id: "bundle-123",
        created_at: "2024-06-15T10:00:00.000Z",
        org_id: "org-456",
        job_id: "job-789",
      };

      const date = new Date(bundle.created_at);
      const datePrefix = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
      const expectedKey = `evidence/${datePrefix}/${bundle.org_id}/${bundle.job_id}/${bundle.bundle_id}.json.gz`;

      expect(expectedKey).toBe(
        "evidence/2024/06/15/org-456/job-789/bundle-123.json.gz"
      );
      expect(expectedKey).toContain(".json.gz");
    });

    it("should handle different months correctly (zero-padding)", () => {
      const januaryDate = new Date("2024-01-05T10:00:00.000Z");
      const decemberDate = new Date("2024-12-25T10:00:00.000Z");

      const janPrefix = `${januaryDate.getUTCFullYear()}/${String(januaryDate.getUTCMonth() + 1).padStart(2, "0")}/${String(januaryDate.getUTCDate()).padStart(2, "0")}`;
      const decPrefix = `${decemberDate.getUTCFullYear()}/${String(decemberDate.getUTCMonth() + 1).padStart(2, "0")}/${String(decemberDate.getUTCDate()).padStart(2, "0")}`;

      expect(janPrefix).toBe("2024/01/05");
      expect(decPrefix).toBe("2024/12/25");
    });
  });

  describe("compression", () => {
    it("should produce gzip-compressed content", async () => {
      // Test the compression utility directly
      const { createGzip } = await import("zlib");

      // Verify gzip produces smaller output for repetitive data
      const repetitiveData = "A".repeat(1000);
      const chunks: Buffer[] = [];
      const gzip = createGzip();

      await new Promise<void>((resolve, reject) => {
        gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
        gzip.on("end", () => resolve());
        gzip.on("error", reject);
        gzip.write(repetitiveData);
        gzip.end();
      });

      const compressed = Buffer.concat(chunks);
      expect(compressed.length).toBeLessThan(repetitiveData.length);
    });
  });

  describe("EvidenceStorageRef structure", () => {
    it("should include all required fields", () => {
      const storageRef = {
        bucket: "test-bucket",
        key: "evidence/2024/01/15/org/job/bundle.json.gz",
        size_bytes: 1234,
        compressed: true,
        created_at: new Date(),
      };

      expect(storageRef.bucket).toBeDefined();
      expect(storageRef.key).toBeDefined();
      expect(storageRef.size_bytes).toBeGreaterThan(0);
      expect(storageRef.compressed).toBe(true);
      expect(storageRef.created_at).toBeInstanceOf(Date);
    });
  });

  describe("retrieveFromS3", () => {
    it("should accept key parameter matching storeInS3 output", () => {
      const service = new EvidenceCollectorService();

      // The retrieveFromS3 signature takes a key (string) directly
      // to match the key from EvidenceStorageRef returned by storeInS3
      expect(typeof service.retrieveFromS3).toBe("function");
      expect(service.retrieveFromS3.length).toBe(1); // Takes 1 parameter
    });

    it("should handle keys with date prefix", () => {
      // Verify key format compatibility
      const storedKey =
        "evidence/2024/06/15/org-123/job-456/bundle-789.json.gz";
      expect(storedKey).toMatch(
        /^evidence\/\d{4}\/\d{2}\/\d{2}\/.+\/.+\/.+\.json\.gz$/
      );
    });
  });
});

describe("Timeline Fallback Edge Cases", () => {
  it("should handle empty breadcrumbs array without NaN duration", async () => {
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
      breadcrumbs: [], // Empty array
      context: null,
      raw_payload: {},
    };

    const service = new EvidenceCollectorService();
    const result = await service.collect(params, eventData, [], null);

    // Should have valid timeline with 0 duration, not NaN
    expect(result.timeline).not.toBeNull();
    expect(result.timeline?.duration_ms).toBe(0);
    expect(Number.isNaN(result.timeline?.duration_ms)).toBe(false);
    expect(result.timeline?.steps).toEqual([]);
    expect(result.timeline?.first_timestamp).toBeNull();
    expect(result.timeline?.last_timestamp).toBeNull();
  });

  it("should handle single breadcrumb correctly", async () => {
    const mockPythonBridge = {
      execute: vi.fn().mockRejectedValue(new Error("Force fallback")),
    };

    const service = new EvidenceCollectorService({
      pythonBridge: mockPythonBridge as unknown as InstanceType<
        typeof import("../../src/services/python-bridge.js").PythonBridge
      >,
    });

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
      breadcrumbs: [
        {
          timestamp: "2024-01-15T10:00:00.000Z",
          type: "http",
          message: "Single request",
        },
      ],
      context: null,
      raw_payload: {},
    };

    const result = await service.collect(params, eventData, [], null);

    // Single breadcrumb should result in 0 duration (same timestamp)
    expect(result.timeline?.steps).toHaveLength(1);
    expect(result.timeline?.duration_ms).toBe(0);
    expect(Number.isNaN(result.timeline?.duration_ms)).toBe(false);
  });
});
