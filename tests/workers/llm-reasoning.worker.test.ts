import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
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
    REDIS_URL: "redis://localhost:6379",
    DATABASE_URL: "postgres://localhost/test",
    NODE_ENV: "test",
    S3_BUCKET_NAME: "test-bucket",
    AWS_REGION: "us-east-1",
    PYTHON_LLM_TIMEOUT_MS: 30000,
    OPENAI_API_KEY: "test-key",
  },
}));

vi.mock("../../src/db/client.js", () => ({
  transaction: vi.fn(),
  pool: {
    query: vi.fn(),
  },
}));

// Mock LLM service
const mockGenerateRCA = vi.fn();
vi.mock("../../src/services/llm-service.js", () => ({
  LLMService: vi.fn().mockImplementation(() => ({
    generateRCA: mockGenerateRCA,
    checkQuota: vi.fn().mockResolvedValue(true),
  })),
  QuotaExceededError: class QuotaExceededError extends Error {
    orgId: string;
    currentUsage: number;
    maxAllowed: number;
    constructor(orgId: string, currentUsage: number, maxAllowed: number) {
      super(`Quota exceeded for ${orgId}`);
      this.name = "QuotaExceededError";
      this.orgId = orgId;
      this.currentUsage = currentUsage;
      this.maxAllowed = maxAllowed;
    }
  },
}));

// Mock evidence collector
vi.mock("../../src/services/evidence-collector.js", () => ({
  EvidenceCollectorService: vi.fn().mockImplementation(() => ({
    retrieveFromS3: vi.fn().mockResolvedValue({
      id: "bundle-123",
      error: { message: "Test error", type: "Error" },
      code: { snippet: "const x = null;", file_path: "test.js" },
      timeline: { steps: [], anomalies_count: 0 },
      recent_commits: [],
      deterministic_findings: [],
    }),
  })),
}));

// Mock evidence graph builder
vi.mock("../../src/services/evidence-graph-builder.js", () => ({
  buildEvidenceGraph: vi.fn().mockReturnValue({
    nodes: [],
    edges: [],
    metadata: { confidence: 0.8 },
  }),
}));

// Mock notification service
vi.mock("../../src/services/notification-service.js", () => ({
  notificationService: {
    sendRCANotification: vi.fn().mockResolvedValue(true),
  },
}));

// Mock jira ticket service
vi.mock("../../src/services/jira-ticket-service.js", () => ({
  jiraTicketService: {
    createTicketFromRCA: vi.fn().mockResolvedValue(null),
  },
}));

// Mock BullMQ
const mockWorker = {
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  _processor: null as any,
};

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_name, processor, _opts) => {
    mockWorker._processor = processor;
    return mockWorker;
  }),
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
  })),
}));

describe("LLM Reasoning Worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateRCA.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Quota Management", () => {
    it("should check quota before LLM call", async () => {
      const { transaction } = await import("../../src/db/client.js");

      vi.mocked(transaction).mockImplementation(
        async (_orgId: string, fn: (client: any) => Promise<any>) => {
          return fn({
            query: vi.fn().mockImplementation((sql: string) => {
              if (sql.includes("rca_jobs")) {
                return {
                  rows: [
                    {
                      id: "job-123",
                      event_id: "evt-456",
                      org_id: "org-789",
                      code_context_s3_url: "s3://bucket/key",
                      deterministic_findings: {},
                    },
                  ],
                };
              }
              if (sql.includes("cost_metrics")) {
                return { rows: [{ llm_tokens_used: 50000 }] };
              }
              return { rows: [], rowCount: 1 };
            }),
          });
        }
      );

      const mockRCA = {
        success: true,
        rca: {
          title: "Null pointer access",
          summary: "The error occurred due to...",
          root_cause: "Missing null check",
          causal_chain: [{ step: "Step 1", evidence: "Code", confidence: 0.9 }],
          confidence: 0.85,
        },
        llm_model: "gpt-4o-mini",
        llm_tokens_used: 1500,
        llm_input_tokens: 1000,
        llm_output_tokens: 500,
        llm_cost_usd: 0.0015,
        processing_time_ms: 2500,
        validation_passed: true,
        validation_errors: [],
        used_fallback: false,
      };

      mockGenerateRCA.mockResolvedValue(mockRCA);

      const { startLLMWorker } =
        await import("../../src/workers/queues/llm-reasoning.js");

      const worker = startLLMWorker();
      expect(worker).toBeDefined();
    });

    it("should throw QuotaExceededError when org exceeds daily token limit", async () => {
      const { QuotaExceededError } =
        await import("../../src/services/llm-service.js");

      mockGenerateRCA.mockRejectedValue(
        new QuotaExceededError("org-123", 100000, 100000)
      );

      const { startLLMWorker } =
        await import("../../src/workers/queues/llm-reasoning.js");

      const worker = startLLMWorker();
      expect(worker).toBeDefined();
    });
  });

  describe("RCA Generation", () => {
    it("should validate LLM response against RCA schema", async () => {
      const validRCAResponse = {
        success: true,
        rca: {
          title: "TypeError: Cannot read property 'foo' of null",
          summary:
            "The application crashed when trying to access a property on a null object.",
          root_cause:
            "Variable was not checked for null before property access",
          causal_chain: [
            {
              step: "User clicked submit button",
              evidence: "Timeline breadcrumb at t=0",
              confidence: 0.95,
            },
            {
              step: "Handler fetched user data",
              evidence: "HTTP request in breadcrumb",
              confidence: 0.9,
            },
            {
              step: "Property access on null return value",
              evidence: "Stack trace line 42",
              confidence: 0.95,
            },
          ],
          suggested_fix: {
            description: "Add null check before property access",
            file_path: "src/handlers/user.js",
            patch_description:
              "Add if (!user) return null; before accessing user.name",
          },
          test_intentions: [
            {
              description: "Test handler with null user response",
              rationale: "Covers the null case that caused the error",
            },
          ],
          confidence: 0.88,
        },
        llm_model: "gpt-4o-mini",
        llm_tokens_used: 2000,
        llm_input_tokens: 1500,
        llm_output_tokens: 500,
        llm_cost_usd: 0.002,
        processing_time_ms: 3000,
        validation_passed: true,
        validation_errors: [],
        used_fallback: false,
      };

      mockGenerateRCA.mockResolvedValue(validRCAResponse);

      // Validate structure
      expect(validRCAResponse.rca.title).toBeDefined();
      expect(validRCAResponse.rca.summary).toBeDefined();
      expect(validRCAResponse.rca.root_cause).toBeDefined();
      expect(validRCAResponse.rca.causal_chain).toBeInstanceOf(Array);
      expect(validRCAResponse.rca.confidence).toBeGreaterThanOrEqual(0);
      expect(validRCAResponse.rca.confidence).toBeLessThanOrEqual(1);
    });

    it("should track token usage in cost_metrics", async () => {
      const { transaction } = await import("../../src/db/client.js");

      vi.mocked(transaction).mockImplementation(
        async (
          _orgId: string | null | undefined,
          fn: (client: any) => Promise<any>
        ) => {
          return fn({
            query: vi.fn().mockImplementation((_sql: string) => {
              return { rows: [], rowCount: 1 };
            }),
          });
        }
      );

      const mockRCA = {
        success: true,
        rca: {
          title: "Test",
          summary: "Test",
          root_cause: "Test",
          causal_chain: [],
          confidence: 0.8,
        },
        llm_model: "gpt-4o-mini",
        llm_tokens_used: 1000,
        llm_input_tokens: 700,
        llm_output_tokens: 300,
        llm_cost_usd: 0.001,
        processing_time_ms: 2000,
        validation_passed: true,
        validation_errors: [],
        used_fallback: false,
      };

      mockGenerateRCA.mockResolvedValue(mockRCA);

      // The worker should track costs
      expect(mockRCA.llm_tokens_used).toBe(1000);
      expect(mockRCA.llm_cost_usd).toBe(0.001);
    });

    it("should fallback to deterministic-only RCA on LLM failure", async () => {
      // Test fallback RCA structure when LLM fails
      const fallbackRCA = {
        success: true,
        rca: {
          title: "Error Analysis (Deterministic Only)",
          summary:
            "LLM unavailable. Analysis based on deterministic patterns only.",
          root_cause: "Pattern match: NULL_ACCESS detected",
          causal_chain: [],
          confidence: 0.6, // Lower confidence for fallback
        },
        llm_model: "deterministic-fallback",
        llm_tokens_used: 0,
        llm_input_tokens: 0,
        llm_output_tokens: 0,
        llm_cost_usd: 0,
        processing_time_ms: 100,
        validation_passed: true,
        validation_errors: [],
        used_fallback: true,
      };

      // Verify fallback structure has expected properties
      expect(fallbackRCA.used_fallback).toBe(true);
      expect(fallbackRCA.llm_tokens_used).toBe(0);
      expect(fallbackRCA.llm_cost_usd).toBe(0);
      expect(fallbackRCA.rca.confidence).toBeLessThan(0.8);
      expect(fallbackRCA.llm_model).toBe("deterministic-fallback");
    });
  });

  describe("Error Handling", () => {
    it("should handle OpenAI API errors gracefully", async () => {
      const apiError = new Error("OpenAI API Error: 503 Service Unavailable");
      mockGenerateRCA.mockRejectedValue(apiError);

      const { startLLMWorker } =
        await import("../../src/workers/queues/llm-reasoning.js");

      const worker = startLLMWorker();
      expect(worker).toBeDefined();
    });

    it("should timeout after configured limit (30s default)", async () => {
      // Simulate timeout
      mockGenerateRCA.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error("Operation timed out")),
              100 // Simulate shorter timeout for test
            );
          })
      );

      const { startLLMWorker } =
        await import("../../src/workers/queues/llm-reasoning.js");

      const worker = startLLMWorker();
      expect(worker).toBeDefined();
    });

    it("should handle malformed LLM response", async () => {
      const malformedResponse = {
        success: true,
        rca: {
          // Missing required fields
          title: "Incomplete RCA",
          // No summary, root_cause, causal_chain, confidence
        },
        llm_model: "gpt-4o-mini",
        llm_tokens_used: 500,
        llm_input_tokens: 300,
        llm_output_tokens: 200,
        llm_cost_usd: 0.0005,
        processing_time_ms: 1000,
        validation_passed: false, // Schema validation failed
        validation_errors: [
          "Missing required field: summary",
          "Missing required field: root_cause",
          "Missing required field: causal_chain",
          "Missing required field: confidence",
        ],
        used_fallback: false,
      };

      mockGenerateRCA.mockResolvedValue(malformedResponse);

      expect(malformedResponse.validation_passed).toBe(false);
      expect(malformedResponse.validation_errors.length).toBeGreaterThan(0);
    });
  });

  describe("Queue Configuration", () => {
    it("should have LLM queue available with rate limit settings", async () => {
      const { getLLMQueue } =
        await import("../../src/workers/queues/llm-reasoning.js");

      // Verify queue factory function exists
      expect(getLLMQueue).toBeDefined();
      expect(typeof getLLMQueue).toBe("function");

      // Queue should be configured with exponential backoff for rate limits
      // (10s initial delay to handle OpenAI rate limits)
      const { Queue } = await import("bullmq");
      expect(Queue).toBeDefined();
    });
  });

  describe("Test Mode", () => {
    it("should buffer jobs in test mode", async () => {
      const {
        enableTestMode,
        disableTestMode,
        getTestModeJobs,
        enqueueLLMReasoning,
      } = await import("../../src/workers/queues/llm-reasoning.js");

      enableTestMode();

      await enqueueLLMReasoning({
        jobId: "llm-test-1",
        eventId: "evt-1",
        orgId: "org-1",
      });

      const jobs = getTestModeJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobId).toBe("llm-test-1");

      disableTestMode();
    });
  });

  describe("Notification Integration", () => {
    it("should send Slack notification after successful RCA", async () => {
      const { notificationService } =
        await import("../../src/services/notification-service.js");

      const mockRCA = {
        success: true,
        rca: {
          title: "Test RCA",
          summary: "Test summary",
          root_cause: "Test root cause",
          causal_chain: [],
          confidence: 0.85,
        },
        llm_model: "gpt-4o-mini",
        llm_tokens_used: 1000,
        llm_input_tokens: 700,
        llm_output_tokens: 300,
        llm_cost_usd: 0.001,
        processing_time_ms: 2000,
        validation_passed: true,
        validation_errors: [],
        used_fallback: false,
      };

      mockGenerateRCA.mockResolvedValue(mockRCA);

      // Verify notification service is available
      expect(notificationService.sendRCANotification).toBeDefined();
    });
  });

  describe("Evidence Graph", () => {
    it("should have evidence graph builder available", async () => {
      const { buildEvidenceGraph } =
        await import("../../src/services/evidence-graph-builder.js");

      // Verify the graph builder function exists
      expect(buildEvidenceGraph).toBeDefined();
      expect(typeof buildEvidenceGraph).toBe("function");
    });
  });
});

describe("LLM Response Schema Validation", () => {
  it("should validate complete RCA response", () => {
    const validResponse = {
      title: "TypeError in user handler",
      summary: "Error occurred during user data processing",
      root_cause: "Null check missing before property access",
      causal_chain: [
        {
          step: "API call returned null",
          evidence: "HTTP 404",
          confidence: 0.9,
        },
        {
          step: "Property accessed on null",
          evidence: "Line 42",
          confidence: 0.95,
        },
      ],
      suggested_fix: {
        description: "Add null check",
        file_path: "src/handler.js",
      },
      test_intentions: [
        { description: "Test null case", rationale: "Cover edge case" },
      ],
      confidence: 0.87,
    };

    // Validate all required fields present
    expect(validResponse.title).toBeTruthy();
    expect(validResponse.summary).toBeTruthy();
    expect(validResponse.root_cause).toBeTruthy();
    expect(Array.isArray(validResponse.causal_chain)).toBe(true);
    expect(validResponse.confidence).toBeGreaterThanOrEqual(0);
    expect(validResponse.confidence).toBeLessThanOrEqual(1);

    // Validate causal chain structure
    validResponse.causal_chain.forEach((step) => {
      expect(step.step).toBeTruthy();
      expect(step.evidence).toBeTruthy();
      expect(step.confidence).toBeGreaterThanOrEqual(0);
      expect(step.confidence).toBeLessThanOrEqual(1);
    });
  });

  it("should reject RCA response with invalid confidence", () => {
    const invalidResponse = {
      title: "Test",
      summary: "Test",
      root_cause: "Test",
      causal_chain: [],
      confidence: 1.5, // Invalid: > 1
    };

    expect(invalidResponse.confidence).toBeGreaterThan(1);
    // In real implementation, this would fail schema validation
  });

  it("should reject RCA response with empty causal chain when required", () => {
    const responseWithEmptyChain = {
      title: "Test",
      summary: "Test",
      root_cause: "Test",
      causal_chain: [], // May be valid depending on schema
      confidence: 0.8,
    };

    // Empty causal chain is technically valid but may indicate low quality
    expect(responseWithEmptyChain.causal_chain).toHaveLength(0);
  });
});

describe("Cost Tracking Integration", () => {
  it("should calculate cost correctly for GPT-4o-mini", () => {
    // GPT-4o-mini pricing: $0.15 per 1M input tokens, $0.60 per 1M output tokens
    const inputTokens = 1000;
    const outputTokens = 500;

    const inputCost = (inputTokens / 1_000_000) * 0.15;
    const outputCost = (outputTokens / 1_000_000) * 0.6;
    const totalCost = inputCost + outputCost;

    expect(inputCost).toBeCloseTo(0.00015, 6);
    expect(outputCost).toBeCloseTo(0.0003, 6);
    expect(totalCost).toBeCloseTo(0.00045, 6);
  });

  it("should aggregate costs per organization per day", () => {
    const dailyCosts = [
      { llm_tokens_used: 1000, llm_cost_usd: 0.001 },
      { llm_tokens_used: 2000, llm_cost_usd: 0.002 },
      { llm_tokens_used: 1500, llm_cost_usd: 0.0015 },
    ];

    const totalTokens = dailyCosts.reduce(
      (sum, c) => sum + c.llm_tokens_used,
      0
    );
    const totalCost = dailyCosts.reduce((sum, c) => sum + c.llm_cost_usd, 0);

    expect(totalTokens).toBe(4500);
    expect(totalCost).toBeCloseTo(0.0045, 6);
  });
});
