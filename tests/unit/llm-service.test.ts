/**
 * LLM Service Unit Tests
 *
 * Tests for LLMService class covering:
 * - RCA generation pipeline
 * - Quota checking and QuotaExceededError
 * - Cost tracking integration
 * - Python bridge communication
 * - Error handling and fallbacks
 * - Cost estimation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before imports
vi.mock("../../src/services/python-bridge.js", () => ({
  PythonBridge: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
  })),
}));

vi.mock("../../src/services/cost-tracker.js", () => ({
  CostTracker: vi.fn().mockImplementation(() => ({
    recordLLMUsage: vi.fn(),
    getDailyLLMTokens: vi.fn().mockResolvedValue(0),
  })),
}));

vi.mock("../../src/utils/rate-limits.js", () => ({
  RATE_LIMITS: {
    free: { llm_tokens_per_day: 10000 },
    pro: { llm_tokens_per_day: 100000 },
    enterprise: { llm_tokens_per_day: 1000000 },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  LLMService,
  QuotaExceededError,
  getLLMService,
  resetLLMService,
} from "../../src/services/llm-service.js";
import { PythonBridge } from "../../src/services/python-bridge.js";
import { CostTracker } from "../../src/services/cost-tracker.js";
import type { EvidenceBundle } from "../../src/types/evidence.js";

// =============================================================================
// TEST FIXTURES
// =============================================================================

const createMockEvidenceBundle = (): EvidenceBundle =>
  ({
    error: {
      message: "Cannot read property 'name' of undefined",
      type: "TypeError",
      value: "Cannot read property 'name' of undefined",
      stack_trace: [
        {
          file: "src/services/user.ts",
          function: "getUser",
          line: 42,
          column: 15,
          in_app: true,
        },
      ],
    },
    code: {
      primary: {
        file_path: "src/services/user.ts",
        line_number: 42,
        column_number: 15,
        snippet:
          "export function getUser(id: string) {\n  const user = db.find(id);\n  return user.name;\n}",
        snippet_start_line: 40,
        snippet_end_line: 45,
        language: "typescript",
        source_map_resolved: false,
      },
      related: [],
      repo: "owner/repo",
      commit_sha: "abc123",
    },
    breadcrumbs: [],
    recent_commits: [],
    timeline: {
      steps: [],
      anomalies_count: 0,
      duration_ms: 0,
      first_timestamp: null,
      last_timestamp: null,
      http_requests: 0,
      errors_before_crash: 0,
    },
    event_id: "event-123",
    org_id: "org-123",
    job_id: "job-123",
    bundle_id: "bundle-123",
    created_at: new Date().toISOString(),
    deterministic_findings: [],
    environment: {
      environment: "production",
      release: "v1.0.0",
      server_name: null,
      user_agent: null,
      browser: null,
      os: null,
      device: null,
      runtime: { name: "node", version: "18.0.0" },
      sdk: { name: "sentry.javascript", version: "7.0.0" },
      tags: {},
    },
    metadata: {
      sentry_event_id: "sentry-123",
      processing_started_at: new Date().toISOString(),
      code_fetch_source: "github",
      source_map_used: false,
      validation_passed: true,
      validation_errors: [],
    },
  }) as unknown as EvidenceBundle;

const createMockLLMResult = (overrides = {}) => ({
  success: true,
  rca: {
    root_cause: {
      summary: "Null reference error due to missing null check",
      technical_explanation:
        "The getUser function does not check if db.find returns null",
      confidence: 0.85,
      evidence_refs: ["code:src/services/user.ts:42"],
    },
    contributing_factors: [],
    timeline_analysis: {
      trigger_point: "db.find returned null",
      sequence: [],
    },
    recommended_fixes: [
      {
        title: "Add null check",
        code_change: "if (!user) return null;",
        priority: "high",
        effort: "low",
      },
    ],
  },
  error: null,
  llm_model: "gpt-4o-mini",
  llm_tokens_used: 1500,
  llm_input_tokens: 1000,
  llm_output_tokens: 500,
  llm_cost_usd: 0.0003,
  processing_time_ms: 2500,
  validation_passed: true,
  validation_errors: [],
  used_fallback: false,
  ...overrides,
});

// =============================================================================
// QUOTA EXCEEDED ERROR TESTS
// =============================================================================

describe("QuotaExceededError", () => {
  it("should create error with correct properties", () => {
    const error = new QuotaExceededError("org-123", 15000, 10000);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(error.name).toBe("QuotaExceededError");
    expect(error.orgId).toBe("org-123");
    expect(error.currentUsage).toBe(15000);
    expect(error.maxAllowed).toBe(10000);
    expect(error.message).toContain("org-123");
    expect(error.message).toContain("15000");
    expect(error.message).toContain("10000");
  });

  it("should be catchable as specific error type", () => {
    const error = new QuotaExceededError("org-456", 20000, 10000);

    try {
      throw error;
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        expect(e.orgId).toBe("org-456");
        expect(e.currentUsage).toBe(20000);
        expect(e.maxAllowed).toBe(10000);
      } else {
        throw new Error("Should have caught QuotaExceededError");
      }
    }
  });
});

// =============================================================================
// LLM SERVICE CONSTRUCTION TESTS
// =============================================================================

describe("LLMService", () => {
  let mockPythonBridge: { execute: ReturnType<typeof vi.fn> };
  let mockCostTracker: {
    recordLLMUsage: ReturnType<typeof vi.fn>;
    getDailyLLMTokens: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetLLMService();

    mockPythonBridge = {
      execute: vi.fn(),
    };

    mockCostTracker = {
      recordLLMUsage: vi.fn().mockResolvedValue(undefined),
      getDailyLLMTokens: vi.fn().mockResolvedValue(0),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create service with default configuration", () => {
      const service = new LLMService();

      expect(service).toBeInstanceOf(LLMService);
    });

    it("should accept custom dependencies", () => {
      const service = new LLMService({
        pythonBridge: mockPythonBridge as unknown as PythonBridge,
        costTracker: mockCostTracker as unknown as CostTracker,
        config: {
          timeoutMs: 60000,
          maxRetries: 5,
          checkQuotaBeforeCall: true,
        },
      });

      expect(service).toBeInstanceOf(LLMService);
    });

    it("should merge config with defaults", () => {
      const service = new LLMService({
        pythonBridge: mockPythonBridge as unknown as PythonBridge,
        costTracker: mockCostTracker as unknown as CostTracker,
        config: { maxRetries: 5 },
      });

      expect(service).toBeInstanceOf(LLMService);
    });
  });

  // ===========================================================================
  // RCA GENERATION TESTS
  // ===========================================================================

  describe("generateRCA", () => {
    let service: LLMService;

    beforeEach(() => {
      service = new LLMService({
        pythonBridge: mockPythonBridge as unknown as PythonBridge,
        costTracker: mockCostTracker as unknown as CostTracker,
        config: { checkQuotaBeforeCall: true },
      });
    });

    it("should generate RCA successfully", async () => {
      const mockResult = createMockLLMResult();
      mockPythonBridge.execute.mockResolvedValue(mockResult);
      mockCostTracker.getDailyLLMTokens.mockResolvedValue(0);

      const evidence = createMockEvidenceBundle();
      const result = await service.generateRCA({
        orgId: "org-123",
        eventId: "event-123",
        jobId: "job-123",
        evidence,
        orgPlan: "free",
      });

      expect(result.success).toBe(true);
      expect(result.rca).not.toBeNull();
      expect(result.llm_model).toBe("gpt-4o-mini");
      expect(result.validation_passed).toBe(true);
      expect(result.processing_time_ms).toBeGreaterThanOrEqual(0);
    });

    it("should check quota before calling LLM", async () => {
      const mockResult = createMockLLMResult();
      mockPythonBridge.execute.mockResolvedValue(mockResult);
      mockCostTracker.getDailyLLMTokens.mockResolvedValue(5000);

      const evidence = createMockEvidenceBundle();
      await service.generateRCA({
        orgId: "org-123",
        eventId: "event-123",
        jobId: "job-123",
        evidence,
        orgPlan: "free",
      });

      expect(mockCostTracker.getDailyLLMTokens).toHaveBeenCalledWith("org-123");
    });

    it("should throw QuotaExceededError when quota is exceeded", async () => {
      mockCostTracker.getDailyLLMTokens.mockResolvedValue(15000); // Over free tier limit

      const evidence = createMockEvidenceBundle();

      await expect(
        service.generateRCA({
          orgId: "org-123",
          eventId: "event-123",
          jobId: "job-123",
          evidence,
          orgPlan: "free",
        })
      ).rejects.toThrow(QuotaExceededError);

      // Should NOT call Python bridge
      expect(mockPythonBridge.execute).not.toHaveBeenCalled();
    });

    it("should use correct quota limit for pro plan", async () => {
      const mockResult = createMockLLMResult();
      mockPythonBridge.execute.mockResolvedValue(mockResult);
      mockCostTracker.getDailyLLMTokens.mockResolvedValue(50000); // Over free, under pro

      const evidence = createMockEvidenceBundle();
      const result = await service.generateRCA({
        orgId: "org-123",
        eventId: "event-123",
        jobId: "job-123",
        evidence,
        orgPlan: "pro",
      });

      // Should succeed - under pro limit
      expect(result.success).toBe(true);
      expect(mockPythonBridge.execute).toHaveBeenCalled();
    });

    it("should track costs after successful RCA", async () => {
      const mockResult = createMockLLMResult({
        llm_tokens_used: 2000,
        llm_input_tokens: 1500,
        llm_output_tokens: 500,
      });
      mockPythonBridge.execute.mockResolvedValue(mockResult);

      const evidence = createMockEvidenceBundle();
      await service.generateRCA({
        orgId: "org-123",
        eventId: "event-123",
        jobId: "job-123",
        evidence,
      });

      expect(mockCostTracker.recordLLMUsage).toHaveBeenCalledWith(
        "org-123",
        2000, // total tokens
        1500, // input tokens
        500 // output tokens
      );
    });

    it("should NOT track costs when tokens is 0", async () => {
      const mockResult = createMockLLMResult({
        llm_tokens_used: 0,
        llm_input_tokens: 0,
        llm_output_tokens: 0,
      });
      mockPythonBridge.execute.mockResolvedValue(mockResult);

      const evidence = createMockEvidenceBundle();
      await service.generateRCA({
        orgId: "org-123",
        eventId: "event-123",
        jobId: "job-123",
        evidence,
      });

      expect(mockCostTracker.recordLLMUsage).not.toHaveBeenCalled();
    });

    it("should handle Python bridge errors gracefully", async () => {
      mockPythonBridge.execute.mockRejectedValue(
        new Error("Python process crashed")
      );

      const evidence = createMockEvidenceBundle();
      const result = await service.generateRCA({
        orgId: "org-123",
        eventId: "event-123",
        jobId: "job-123",
        evidence,
      });

      // Should return error result, not throw
      expect(result.success).toBe(false);
      expect(result.rca).toBeNull();
      expect(result.error).toBe("Python process crashed");
      expect(result.validation_passed).toBe(false);
      expect(result.used_fallback).toBe(false);
      expect(result.processing_time_ms).toBeGreaterThanOrEqual(0);
    });

    it("should handle timeout errors", async () => {
      mockPythonBridge.execute.mockRejectedValue(
        new Error("Execution timed out after 30000ms")
      );

      const evidence = createMockEvidenceBundle();
      const result = await service.generateRCA({
        orgId: "org-123",
        eventId: "event-123",
        jobId: "job-123",
        evidence,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });

    it("should default to free plan when orgPlan not specified", async () => {
      const mockResult = createMockLLMResult();
      mockPythonBridge.execute.mockResolvedValue(mockResult);
      mockCostTracker.getDailyLLMTokens.mockResolvedValue(0);

      const evidence = createMockEvidenceBundle();
      await service.generateRCA({
        orgId: "org-123",
        eventId: "event-123",
        jobId: "job-123",
        evidence,
        // No orgPlan specified
      });

      // Should check quota with free tier limits
      expect(mockCostTracker.getDailyLLMTokens).toHaveBeenCalled();
    });

    it("should handle non-Error exceptions", async () => {
      mockPythonBridge.execute.mockRejectedValue("String error");

      const evidence = createMockEvidenceBundle();
      const result = await service.generateRCA({
        orgId: "org-123",
        eventId: "event-123",
        jobId: "job-123",
        evidence,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("String error");
    });
  });

  // ===========================================================================
  // QUOTA CHECKING TESTS
  // ===========================================================================

  describe("quota checking", () => {
    it("should allow calls when under quota", async () => {
      mockCostTracker.getDailyLLMTokens.mockResolvedValue(5000);
      const mockResult = createMockLLMResult();
      mockPythonBridge.execute.mockResolvedValue(mockResult);

      const service = new LLMService({
        pythonBridge: mockPythonBridge as unknown as PythonBridge,
        costTracker: mockCostTracker as unknown as CostTracker,
        config: { checkQuotaBeforeCall: true },
      });

      const evidence = createMockEvidenceBundle();
      const result = await service.generateRCA({
        orgId: "org-123",
        eventId: "event-123",
        jobId: "job-123",
        evidence,
        orgPlan: "free",
      });

      expect(result.success).toBe(true);
    });

    it("should block calls at exact quota limit", async () => {
      mockCostTracker.getDailyLLMTokens.mockResolvedValue(10000); // Exactly at limit

      const service = new LLMService({
        pythonBridge: mockPythonBridge as unknown as PythonBridge,
        costTracker: mockCostTracker as unknown as CostTracker,
        config: { checkQuotaBeforeCall: true },
      });

      const evidence = createMockEvidenceBundle();

      await expect(
        service.generateRCA({
          orgId: "org-123",
          eventId: "event-123",
          jobId: "job-123",
          evidence,
          orgPlan: "free",
        })
      ).rejects.toThrow(QuotaExceededError);
    });

    it("should skip quota check when disabled", async () => {
      mockCostTracker.getDailyLLMTokens.mockResolvedValue(15000); // Over limit
      const mockResult = createMockLLMResult();
      mockPythonBridge.execute.mockResolvedValue(mockResult);

      const service = new LLMService({
        pythonBridge: mockPythonBridge as unknown as PythonBridge,
        costTracker: mockCostTracker as unknown as CostTracker,
        config: { checkQuotaBeforeCall: false },
      });

      const evidence = createMockEvidenceBundle();
      const result = await service.generateRCA({
        orgId: "org-123",
        eventId: "event-123",
        jobId: "job-123",
        evidence,
        orgPlan: "free",
      });

      // Should NOT check quota
      expect(mockCostTracker.getDailyLLMTokens).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("should handle enterprise tier correctly", async () => {
      mockCostTracker.getDailyLLMTokens.mockResolvedValue(500000); // Over pro, under enterprise
      const mockResult = createMockLLMResult();
      mockPythonBridge.execute.mockResolvedValue(mockResult);

      const service = new LLMService({
        pythonBridge: mockPythonBridge as unknown as PythonBridge,
        costTracker: mockCostTracker as unknown as CostTracker,
        config: { checkQuotaBeforeCall: true },
      });

      const evidence = createMockEvidenceBundle();
      const result = await service.generateRCA({
        orgId: "org-123",
        eventId: "event-123",
        jobId: "job-123",
        evidence,
        orgPlan: "enterprise",
      });

      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // COST ESTIMATION TESTS
  // ===========================================================================

  describe("estimateCost", () => {
    let service: LLMService;

    beforeEach(() => {
      service = new LLMService({
        pythonBridge: mockPythonBridge as unknown as PythonBridge,
        costTracker: mockCostTracker as unknown as CostTracker,
      });
    });

    it("should estimate tokens based on evidence size", () => {
      const estimate = service.estimateCost(4000); // ~1000 tokens + 500 overhead

      expect(estimate.estimatedTokens).toBe(1500);
      expect(estimate.estimatedCost).toBeGreaterThan(0);
    });

    it("should include overhead for small evidence", () => {
      const estimate = service.estimateCost(100); // ~25 tokens + 500 overhead

      expect(estimate.estimatedTokens).toBe(525);
      expect(estimate.estimatedCost).toBeGreaterThan(0);
    });

    it("should scale cost with evidence size", () => {
      const smallEstimate = service.estimateCost(1000);
      const largeEstimate = service.estimateCost(10000);

      expect(largeEstimate.estimatedTokens).toBeGreaterThan(
        smallEstimate.estimatedTokens
      );
      expect(largeEstimate.estimatedCost).toBeGreaterThan(
        smallEstimate.estimatedCost
      );
    });

    it("should return positive cost for any evidence", () => {
      const estimate = service.estimateCost(0);

      expect(estimate.estimatedTokens).toBe(500); // Just overhead
      expect(estimate.estimatedCost).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // FACTORY FUNCTION TESTS
  // ===========================================================================

  describe("getLLMService", () => {
    beforeEach(() => {
      resetLLMService();
    });

    it("should return singleton instance", () => {
      const service1 = getLLMService();
      const service2 = getLLMService();

      expect(service1).toBe(service2);
    });

    it("should create new instance after reset", () => {
      const service1 = getLLMService();
      resetLLMService();
      const service2 = getLLMService();

      expect(service1).not.toBe(service2);
    });
  });

  describe("resetLLMService", () => {
    it("should clear the singleton", () => {
      const service1 = getLLMService();
      resetLLMService();
      const service2 = getLLMService();

      expect(service1).not.toBe(service2);
    });

    it("should be idempotent", () => {
      resetLLMService();
      resetLLMService();
      resetLLMService();

      const service = getLLMService();
      expect(service).toBeInstanceOf(LLMService);
    });
  });
});

// =============================================================================
// INTEGRATION-STYLE TESTS
// =============================================================================

describe("LLMService Integration Scenarios", () => {
  let mockPythonBridge: { execute: ReturnType<typeof vi.fn> };
  let mockCostTracker: {
    recordLLMUsage: ReturnType<typeof vi.fn>;
    getDailyLLMTokens: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetLLMService();

    mockPythonBridge = {
      execute: vi.fn(),
    };

    mockCostTracker = {
      recordLLMUsage: vi.fn().mockResolvedValue(undefined),
      getDailyLLMTokens: vi.fn().mockResolvedValue(0),
    };
  });

  it("should handle burst of requests accumulating usage", async () => {
    let accumulatedTokens = 0;
    mockCostTracker.getDailyLLMTokens.mockImplementation(() =>
      Promise.resolve(accumulatedTokens)
    );

    mockPythonBridge.execute.mockImplementation(() => {
      accumulatedTokens += 2500;
      return Promise.resolve(
        createMockLLMResult({
          llm_tokens_used: 2500,
          llm_input_tokens: 2000,
          llm_output_tokens: 500,
        })
      );
    });

    const service = new LLMService({
      pythonBridge: mockPythonBridge as unknown as PythonBridge,
      costTracker: mockCostTracker as unknown as CostTracker,
      config: { checkQuotaBeforeCall: true },
    });

    const evidence = createMockEvidenceBundle();

    // First 4 requests should succeed (accumulates to 10000 after 4th)
    await service.generateRCA({
      orgId: "org-123",
      eventId: "e1",
      jobId: "j1",
      evidence,
      orgPlan: "free",
    });
    await service.generateRCA({
      orgId: "org-123",
      eventId: "e2",
      jobId: "j2",
      evidence,
      orgPlan: "free",
    });
    await service.generateRCA({
      orgId: "org-123",
      eventId: "e3",
      jobId: "j3",
      evidence,
      orgPlan: "free",
    });
    await service.generateRCA({
      orgId: "org-123",
      eventId: "e4",
      jobId: "j4",
      evidence,
      orgPlan: "free",
    });

    // 5th request should exceed quota (10000 tokens used = at limit)
    await expect(
      service.generateRCA({
        orgId: "org-123",
        eventId: "e5",
        jobId: "j5",
        evidence,
        orgPlan: "free",
      })
    ).rejects.toThrow(QuotaExceededError);

    expect(mockPythonBridge.execute).toHaveBeenCalledTimes(4);
  });

  it("should isolate quota per organization", async () => {
    // Create fresh mocks for this test
    const localMockCostTracker = {
      recordLLMUsage: vi.fn().mockResolvedValue(undefined),
      getDailyLLMTokens: vi.fn().mockImplementation((orgId: string) => {
        if (orgId === "org-1") return Promise.resolve(10000); // At limit
        return Promise.resolve(0); // Under limit
      }),
    };

    const localMockPythonBridge = {
      execute: vi.fn().mockResolvedValue(createMockLLMResult()),
    };

    const service = new LLMService({
      pythonBridge: localMockPythonBridge as unknown as PythonBridge,
      costTracker: localMockCostTracker as unknown as CostTracker,
      config: { checkQuotaBeforeCall: true },
    });

    const evidence = createMockEvidenceBundle();

    // org-1 should be blocked (at limit)
    await expect(
      service.generateRCA({
        orgId: "org-1",
        eventId: "e1",
        jobId: "j1",
        evidence,
        orgPlan: "free",
      })
    ).rejects.toThrow(QuotaExceededError);

    // org-2 should succeed
    const result = await service.generateRCA({
      orgId: "org-2",
      eventId: "e1",
      jobId: "j1",
      evidence,
      orgPlan: "free",
    });

    expect(result.success).toBe(true);
    // Verify org-1 never called execute (blocked at quota check)
    // org-2 should have called execute once
    expect(localMockPythonBridge.execute).toHaveBeenCalledTimes(1);
  });

  it("should handle fallback scenario from Python", async () => {
    const fallbackResult = createMockLLMResult({
      success: true,
      rca: {
        root_cause: {
          summary: "Deterministic analysis only - LLM unavailable",
          technical_explanation: "Based on AST pattern matching",
          confidence: 0.6,
          evidence_refs: [],
        },
        contributing_factors: [],
        timeline_analysis: { trigger_point: "Unknown", sequence: [] },
        recommended_fixes: [],
      },
      used_fallback: true,
      llm_tokens_used: 0,
      llm_cost_usd: 0,
    });

    mockPythonBridge.execute.mockResolvedValue(fallbackResult);

    const service = new LLMService({
      pythonBridge: mockPythonBridge as unknown as PythonBridge,
      costTracker: mockCostTracker as unknown as CostTracker,
    });

    const evidence = createMockEvidenceBundle();
    const result = await service.generateRCA({
      orgId: "org-123",
      eventId: "event-123",
      jobId: "job-123",
      evidence,
    });

    expect(result.success).toBe(true);
    expect(result.used_fallback).toBe(true);
    expect(result.llm_tokens_used).toBe(0);
    expect(mockCostTracker.recordLLMUsage).not.toHaveBeenCalled();
  });
});
