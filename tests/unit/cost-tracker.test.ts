/**
 * Cost Tracker Service Tests
 *
 * Tests for:
 * - LLM cost calculation
 * - Extraction metrics recording
 * - GitHub API call tracking
 * - LLM token recording
 * - Quota checking
 * - Monthly cost summaries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the database client
vi.mock("../../src/db/client.js", () => ({
  query: vi.fn(),
}));

// Mock the logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { CostTracker } from "../../src/services/cost-tracker.js";
import { query } from "../../src/db/client.js";
import { logger } from "../../src/utils/logger.js";

describe("CostTracker", () => {
  let costTracker: CostTracker;
  const mockQuery = query as ReturnType<typeof vi.fn>;
  const mockLogger = logger as { [key: string]: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    costTracker = new CostTracker();
    // Default mock for successful queries
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("LLM Cost Calculation", () => {
    it("should calculate cost with actual input/output tokens", async () => {
      // GPT-4o-mini: $0.15/1M input, $0.60/1M output
      // 1000 input tokens = $0.00015
      // 500 output tokens = $0.0003
      // Total = $0.00045

      await costTracker.recordLLMTokens(
        "org-123",
        1500, // total
        1000, // input
        500 // output
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO cost_metrics"),
        expect.arrayContaining([
          "org-123",
          expect.any(String), // date
          1500, // tokens
          expect.closeTo(0.00045, 6), // cost
        ])
      );
    });

    it("should use fallback ratio when actual tokens not provided", async () => {
      // 1000 total tokens with 70/30 ratio
      // Input: 700 * 0.00000015 = 0.000105
      // Output: 300 * 0.0000006 = 0.00018
      // Total = 0.000285

      await costTracker.recordLLMTokens("org-123", 1000);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO cost_metrics"),
        expect.arrayContaining([
          "org-123",
          expect.any(String),
          1000,
          expect.closeTo(0.000285, 6),
        ])
      );
    });

    it("should log debug when using fallback ratio", async () => {
      await costTracker.recordLLMTokens("org-123", 1000);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        { totalTokens: 1000 },
        expect.stringContaining("Using estimated token ratio")
      );
    });

    it("should handle zero tokens", async () => {
      await costTracker.recordLLMTokens("org-123", 0);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO cost_metrics"),
        expect.arrayContaining(["org-123", expect.any(String), 0, 0])
      );
    });

    it("should handle large token counts without overflow", async () => {
      // 10M tokens = $1.50 input + $6.00 output (estimated)
      await costTracker.recordLLMTokens("org-123", 10_000_000);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO cost_metrics"),
        expect.arrayContaining([
          "org-123",
          expect.any(String),
          10_000_000,
          expect.closeTo(2.85, 2), // $2.85 at 70/30 ratio
        ])
      );
    });
  });

  describe("recordExtraction", () => {
    it("should record extraction metrics with LLM usage", async () => {
      await costTracker.recordExtraction({
        org_id: "org-123",
        stage_reached: 2,
        is_complete: true,
        extraction_ms: 1500,
        llm_tokens_used: 2000,
        llm_input_tokens: 1500,
        llm_output_tokens: 500,
        validation_passed: true,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO cost_metrics"),
        expect.arrayContaining([
          "org-123",
          expect.any(String),
          2000,
          expect.any(Number), // cost
        ])
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          org_id: "org-123",
          stage_reached: 2,
          is_complete: true,
          extraction_ms: 1500,
          llm_tokens_used: 2000,
          validation_passed: true,
        }),
        "Extraction metrics recorded"
      );
    });

    it("should record extraction metrics without LLM usage (stage 1 only)", async () => {
      await costTracker.recordExtraction({
        org_id: "org-123",
        stage_reached: 1,
        is_complete: true,
        extraction_ms: 50,
        validation_passed: true,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO cost_metrics"),
        expect.arrayContaining([
          "org-123",
          expect.any(String),
          0, // no tokens
          0, // no cost
        ])
      );
    });

    it("should not throw on database errors", async () => {
      mockQuery.mockRejectedValue(new Error("DB connection failed"));

      // Should not throw
      await expect(
        costTracker.recordExtraction({
          org_id: "org-123",
          stage_reached: 1,
          is_complete: true,
          extraction_ms: 50,
          validation_passed: true,
        })
      ).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ org_id: "org-123" }),
        "Failed to record extraction metrics"
      );
    });
  });

  describe("recordGitHubAPICall", () => {
    it("should record single API call", async () => {
      await costTracker.recordGitHubAPICall("org-123");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("github_api_calls"),
        expect.arrayContaining(["org-123", expect.any(String), 1])
      );
    });

    it("should record multiple API calls", async () => {
      await costTracker.recordGitHubAPICall("org-123", 5);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("github_api_calls"),
        expect.arrayContaining(["org-123", expect.any(String), 5])
      );
    });

    it("should not throw on database errors", async () => {
      mockQuery.mockRejectedValue(new Error("DB error"));

      await expect(
        costTracker.recordGitHubAPICall("org-123")
      ).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ org_id: "org-123" }),
        "Failed to record GitHub API call"
      );
    });
  });

  describe("getDailyMetrics", () => {
    it("should return metrics when found", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            org_id: "org-123",
            date: "2024-12-21",
            llm_tokens_used: 5000,
            llm_cost_usd: "0.50",
            github_api_calls: 100,
            s3_storage_gb: 0.1,
          },
        ],
      });

      const metrics = await costTracker.getDailyMetrics("org-123");

      expect(metrics).toEqual({
        org_id: "org-123",
        date: "2024-12-21",
        stage_1_count: 0,
        stage_2_count: 0,
        stage_3_failures: 0,
        llm_tokens_used: 5000,
        llm_cost_usd: 0.5,
        github_api_calls: 100,
        complete_extractions: 0,
        incomplete_extractions: 0,
        extraction_avg_ms: 0,
        extraction_total_ms: 0,
      });
    });

    it("should return null when no metrics found", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const metrics = await costTracker.getDailyMetrics("org-123");

      expect(metrics).toBeNull();
    });

    it("should accept custom date parameter", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await costTracker.getDailyMetrics("org-123", "2024-01-15");

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        "org-123",
        "2024-01-15",
      ]);
    });

    it("should return null on database errors", async () => {
      mockQuery.mockRejectedValue(new Error("DB error"));

      const metrics = await costTracker.getDailyMetrics("org-123");

      expect(metrics).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("getDailyLLMTokens", () => {
    it("should return token count from metrics", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            org_id: "org-123",
            date: "2024-12-21",
            llm_tokens_used: 15000,
            llm_cost_usd: "1.50",
            github_api_calls: 50,
            s3_storage_gb: 0,
          },
        ],
      });

      const tokens = await costTracker.getDailyLLMTokens("org-123");

      expect(tokens).toBe(15000);
    });

    it("should return 0 when no metrics exist", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const tokens = await costTracker.getDailyLLMTokens("org-123");

      expect(tokens).toBe(0);
    });
  });

  describe("checkLLMQuota", () => {
    it("should allow when under quota", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            org_id: "org-123",
            date: "2024-12-21",
            llm_tokens_used: 50000,
            llm_cost_usd: "5.00",
            github_api_calls: 0,
            s3_storage_gb: 0,
          },
        ],
      });

      const result = await costTracker.checkLLMQuota(
        "org-123",
        10000, // tokens needed
        100000 // daily limit
      );

      expect(result).toEqual({
        allowed: true,
        current: 50000,
        limit: 100000,
        remaining: 50000,
      });
    });

    it("should deny when quota exceeded", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            org_id: "org-123",
            date: "2024-12-21",
            llm_tokens_used: 95000,
            llm_cost_usd: "9.50",
            github_api_calls: 0,
            s3_storage_gb: 0,
          },
        ],
      });

      const result = await costTracker.checkLLMQuota(
        "org-123",
        10000, // tokens needed
        100000 // daily limit
      );

      expect(result).toEqual({
        allowed: false,
        current: 95000,
        limit: 100000,
        remaining: 5000,
      });
    });

    it("should allow when no previous usage", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await costTracker.checkLLMQuota("org-123", 10000, 100000);

      expect(result).toEqual({
        allowed: true,
        current: 0,
        limit: 100000,
        remaining: 100000,
      });
    });

    it("should deny when exactly at limit", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            org_id: "org-123",
            date: "2024-12-21",
            llm_tokens_used: 100000,
            llm_cost_usd: "10.00",
            github_api_calls: 0,
            s3_storage_gb: 0,
          },
        ],
      });

      const result = await costTracker.checkLLMQuota(
        "org-123",
        1, // even 1 token should be denied
        100000
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe("checkGitHubQuota", () => {
    it("should allow when under quota", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            org_id: "org-123",
            date: "2024-12-21",
            llm_tokens_used: 0,
            llm_cost_usd: "0",
            github_api_calls: 100,
            s3_storage_gb: 0,
          },
        ],
      });

      const result = await costTracker.checkGitHubQuota(
        "org-123",
        50, // calls needed
        500 // daily limit
      );

      expect(result).toEqual({
        allowed: true,
        current: 100,
        limit: 500,
        remaining: 400,
      });
    });

    it("should deny when quota exceeded", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            org_id: "org-123",
            date: "2024-12-21",
            llm_tokens_used: 0,
            llm_cost_usd: "0",
            github_api_calls: 480,
            s3_storage_gb: 0,
          },
        ],
      });

      const result = await costTracker.checkGitHubQuota("org-123", 50, 500);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(20);
    });
  });

  describe("getMonthlyCostSummary", () => {
    it("should return monthly aggregated costs", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            total_cost_usd: "25.50",
            llm_tokens_used: "255000",
            github_api_calls: "1500",
            days_active: "15",
          },
        ],
      });

      const summary = await costTracker.getMonthlyCostSummary(
        "org-123",
        2024,
        12
      );

      expect(summary).toEqual({
        total_cost_usd: 25.5,
        llm_tokens_used: 255000,
        github_api_calls: 1500,
        days_active: 15,
      });
    });

    it("should handle date range correctly for mid-year month", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            total_cost_usd: "0",
            llm_tokens_used: "0",
            github_api_calls: "0",
            days_active: "0",
          },
        ],
      });

      await costTracker.getMonthlyCostSummary("org-123", 2024, 6);

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        "org-123",
        "2024-06-01",
        "2024-07-01",
      ]);
    });

    it("should handle December to January transition", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            total_cost_usd: "0",
            llm_tokens_used: "0",
            github_api_calls: "0",
            days_active: "0",
          },
        ],
      });

      await costTracker.getMonthlyCostSummary("org-123", 2024, 12);

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        "org-123",
        "2024-12-01",
        "2025-01-01",
      ]);
    });

    it("should return zeros on database error", async () => {
      mockQuery.mockRejectedValue(new Error("DB error"));

      const summary = await costTracker.getMonthlyCostSummary(
        "org-123",
        2024,
        12
      );

      expect(summary).toEqual({
        total_cost_usd: 0,
        llm_tokens_used: 0,
        github_api_calls: 0,
        days_active: 0,
      });
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should return zeros when no data exists", async () => {
      // When COALESCE is used in SQL, it returns '0' as a string for no matching rows
      // The function then parseFloat/parseInt these values
      mockQuery.mockResolvedValue({
        rows: [
          {
            total_cost_usd: "0",
            llm_tokens_used: "0",
            github_api_calls: "0",
            days_active: "0",
          },
        ],
      });

      const summary = await costTracker.getMonthlyCostSummary(
        "org-123",
        2024,
        1
      );

      // COALESCE in SQL should return 0 for nulls
      expect(summary.total_cost_usd).toBe(0);
      expect(summary.llm_tokens_used).toBe(0);
      expect(summary.github_api_calls).toBe(0);
      expect(summary.days_active).toBe(0);
    });
  });

  describe("Date handling", () => {
    it("should use correct date format YYYY-MM-DD", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-12-21T15:30:00Z"));

      await costTracker.recordGitHubAPICall("org-123");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["org-123", "2024-12-21", 1])
      );
    });

    it("should handle timezone correctly (UTC)", async () => {
      vi.useFakeTimers();
      // Set to 11 PM UTC on Dec 21 - should still be Dec 21
      vi.setSystemTime(new Date("2024-12-21T23:59:59Z"));

      await costTracker.recordGitHubAPICall("org-123");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["org-123", "2024-12-21", 1])
      );
    });

    it("should handle date rollover at midnight UTC", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-12-22T00:00:01Z"));

      await costTracker.recordGitHubAPICall("org-123");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["org-123", "2024-12-22", 1])
      );
    });
  });

  describe("recordLLMUsage alias", () => {
    it("should be an alias for recordLLMTokens", async () => {
      await costTracker.recordLLMUsage("org-123", 1000, 700, 300);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO cost_metrics"),
        expect.arrayContaining(["org-123", expect.any(String), 1000])
      );
    });
  });

  describe("Concurrent operations", () => {
    it("should handle concurrent token recordings", async () => {
      const promises = [
        costTracker.recordLLMTokens("org-123", 1000),
        costTracker.recordLLMTokens("org-123", 2000),
        costTracker.recordLLMTokens("org-123", 3000),
      ];

      await Promise.all(promises);

      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it("should handle concurrent API call recordings", async () => {
      const promises = [
        costTracker.recordGitHubAPICall("org-123", 1),
        costTracker.recordGitHubAPICall("org-123", 2),
        costTracker.recordGitHubAPICall("org-123", 3),
      ];

      await Promise.all(promises);

      expect(mockQuery).toHaveBeenCalledTimes(3);
    });
  });
});
