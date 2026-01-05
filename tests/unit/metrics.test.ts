/**
 * Metrics Service Unit Tests
 *
 * Tests for cache metrics, source map metrics, LLM metrics, and GitHub API metrics.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordCacheLookup,
  getCacheHitRate,
  getCacheStatsByTier,
  recordSourceMapResolution,
  getSourceMapSuccessRate,
  getSourceMapStats,
  recordLLMRequest,
  getLLMStats,
  recordGitHubApiCall,
  getGitHubApiStats,
  getAllStats,
  getMetricsHealth,
  _resetMetricsForTesting,
  _getMetricsForTesting,
} from "../../src/services/metrics.js";

describe("Metrics Service", () => {
  beforeEach(() => {
    _resetMetricsForTesting();
  });

  describe("Cache Metrics", () => {
    it("should record cache lookups", () => {
      recordCacheLookup("redis", true, 5);
      recordCacheLookup("redis", true, 3);
      recordCacheLookup("s3", true, 50);
      recordCacheLookup("github", false, 200);

      // getCacheStatsByTier returns HITS per tier, not total lookups
      const stats = getCacheStatsByTier();
      expect(stats.redis).toBe(2); // 2 hits
      expect(stats.s3).toBe(1); // 1 hit
      expect(stats.github).toBe(0); // 0 hits (was a miss)
      expect(stats.database).toBe(0);
    });

    it("should calculate cache hit rate correctly", () => {
      // 3 hits, 1 miss = 75% hit rate
      recordCacheLookup("redis", true, 5);
      recordCacheLookup("s3", true, 50);
      recordCacheLookup("database", true, 100);
      recordCacheLookup("github", false, 200);

      expect(getCacheHitRate()).toBe(75);
    });

    it("should return 0% hit rate when no lookups", () => {
      expect(getCacheHitRate()).toBe(0);
    });

    it("should return 100% hit rate when all hits", () => {
      recordCacheLookup("redis", true, 5);
      recordCacheLookup("redis", true, 3);

      expect(getCacheHitRate()).toBe(100);
    });

    it("should track latency", () => {
      recordCacheLookup("redis", true, 5);
      recordCacheLookup("redis", true, 15);

      const metrics = _getMetricsForTesting();
      expect(metrics.cacheLookupLatency).toEqual([5, 15]);
    });
  });

  describe("Source Map Metrics", () => {
    it("should record source map resolution outcomes", () => {
      recordSourceMapResolution("resolved", 10, 1000);
      recordSourceMapResolution("inline_resolved", 5, 500);
      recordSourceMapResolution("missing", 2);
      recordSourceMapResolution("malformed", 3);

      const stats = getSourceMapStats();
      expect(stats.outcomes.resolved).toBe(1);
      expect(stats.outcomes.inline_resolved).toBe(1);
      expect(stats.outcomes.missing).toBe(1);
      expect(stats.outcomes.malformed).toBe(1);
    });

    it("should calculate success rate correctly", () => {
      // 2 resolved, 1 failed = 66.67% success
      recordSourceMapResolution("resolved", 10);
      recordSourceMapResolution("external_resolved", 15);
      recordSourceMapResolution("missing", 2);

      expect(getSourceMapSuccessRate()).toBeCloseTo(66.67, 1);
    });

    it("should return 100% when no resolution attempts", () => {
      expect(getSourceMapSuccessRate()).toBe(100);
    });

    it("should track bytes processed", () => {
      recordSourceMapResolution("resolved", 10, 1000);
      recordSourceMapResolution("resolved", 15, 2000);

      const stats = getSourceMapStats();
      expect(stats.totalBytesProcessed).toBe(3000);
    });

    it("should calculate average latency", () => {
      recordSourceMapResolution("resolved", 10);
      recordSourceMapResolution("resolved", 20);
      recordSourceMapResolution("missing", 30);

      const stats = getSourceMapStats();
      expect(stats.avgLatencyMs).toBe(20);
    });
  });

  describe("LLM Metrics", () => {
    it("should record LLM requests", () => {
      recordLLMRequest(500, 1000, "gpt-4o-mini", true);
      recordLLMRequest(300, 800, "gpt-4o-mini", true);
      recordLLMRequest(0, 50, "gpt-4o-mini", false);

      const stats = getLLMStats();
      expect(stats.requests).toBe(3);
      expect(stats.tokensUsed).toBe(800);
      expect(stats.errors).toBe(1);
    });

    it("should calculate error rate", () => {
      recordLLMRequest(500, 1000, "gpt-4o-mini", true);
      recordLLMRequest(500, 1000, "gpt-4o-mini", true);
      recordLLMRequest(0, 50, "gpt-4o-mini", false);

      const stats = getLLMStats();
      expect(stats.errorRate).toBeCloseTo(33.33, 1);
    });

    it("should calculate average latency", () => {
      recordLLMRequest(500, 1000, "gpt-4o-mini");
      recordLLMRequest(500, 2000, "gpt-4o-mini");

      const stats = getLLMStats();
      expect(stats.avgLatencyMs).toBe(1500);
    });
  });

  describe("GitHub API Metrics", () => {
    it("should record GitHub API calls", () => {
      recordGitHubApiCall(100, 4500);
      recordGitHubApiCall(150, 4499);

      const stats = getGitHubApiStats();
      expect(stats.calls).toBe(2);
      expect(stats.rateLimitRemaining).toBe(4499);
    });

    it("should track latest rate limit", () => {
      recordGitHubApiCall(100, 5000);
      recordGitHubApiCall(100, 4999);
      recordGitHubApiCall(100, 4998);

      const stats = getGitHubApiStats();
      expect(stats.rateLimitRemaining).toBe(4998);
    });

    it("should calculate average latency", () => {
      recordGitHubApiCall(100, 5000);
      recordGitHubApiCall(200, 4999);

      const stats = getGitHubApiStats();
      expect(stats.avgLatencyMs).toBe(150);
    });
  });

  describe("Aggregate Stats", () => {
    it("should return all stats together", () => {
      recordCacheLookup("redis", true, 5);
      recordSourceMapResolution("resolved", 10);
      recordLLMRequest(500, 1000, "gpt-4o-mini");
      recordGitHubApiCall(100, 4500);

      const allStats = getAllStats();

      expect(allStats.cache.redis).toBe(1);
      expect(allStats.cache.hitRate).toBe(100);
      expect(allStats.sourceMap.outcomes.resolved).toBe(1);
      expect(allStats.llm.requests).toBe(1);
      expect(allStats.github.calls).toBe(1);
      expect(allStats.collectedAt).toBeInstanceOf(Date);
    });
  });

  describe("Health Check", () => {
    it("should return healthy status when metrics are good", () => {
      // Good cache hit rate
      for (let i = 0; i < 15; i++) {
        recordCacheLookup("redis", true, 5);
      }

      // Good source map resolution
      for (let i = 0; i < 10; i++) {
        recordSourceMapResolution("resolved", 10);
      }

      const health = getMetricsHealth();
      expect(health.status).toBe("healthy");
      expect(health.details.warnings).toHaveLength(0);
    });

    it("should return degraded status with low cache hit rate", () => {
      // Low cache hit rate (30%) with > 10 lookups
      // Need more than 10 lookups for the warning to trigger
      for (let i = 0; i < 8; i++) {
        recordCacheLookup("github", false, 200);
      }
      for (let i = 0; i < 4; i++) {
        recordCacheLookup("redis", true, 5);
      }
      // Now we have 12 lookups with 33% hit rate

      const health = getMetricsHealth();
      expect(health.status).toBe("degraded");
      expect(
        health.details.warnings.some((w) => w.includes("cache hit rate"))
      ).toBe(true);
    });

    it("should warn about low GitHub rate limit", () => {
      recordGitHubApiCall(100, 50);

      const health = getMetricsHealth();
      expect(
        health.details.warnings.some((w) => w.includes("rate limit"))
      ).toBe(true);
    });

    it("should warn about high LLM error rate", () => {
      for (let i = 0; i < 5; i++) {
        recordLLMRequest(500, 1000, "gpt-4o-mini", true);
      }
      for (let i = 0; i < 2; i++) {
        recordLLMRequest(0, 50, "gpt-4o-mini", false);
      }

      const health = getMetricsHealth();
      expect(health.details.warnings.some((w) => w.includes("LLM error"))).toBe(
        true
      );
    });

    it("should return unhealthy status with multiple warnings", () => {
      // Low cache hit rate
      for (let i = 0; i < 15; i++) {
        recordCacheLookup("github", false, 200);
      }

      // Low source map resolution
      for (let i = 0; i < 10; i++) {
        recordSourceMapResolution("missing", 2);
      }

      // High LLM errors
      for (let i = 0; i < 10; i++) {
        recordLLMRequest(0, 50, "gpt-4o-mini", false);
      }

      const health = getMetricsHealth();
      expect(health.status).toBe("unhealthy");
      expect(health.details.warnings.length).toBeGreaterThan(2);
    });
  });

  describe("Reset", () => {
    it("should reset all metrics", () => {
      recordCacheLookup("redis", true, 5);
      recordSourceMapResolution("resolved", 10);
      recordLLMRequest(500, 1000, "gpt-4o-mini");
      recordGitHubApiCall(100, 4500);

      _resetMetricsForTesting();

      const allStats = getAllStats();
      expect(allStats.cache.redis).toBe(0);
      expect(allStats.sourceMap.outcomes.resolved).toBe(0);
      expect(allStats.llm.requests).toBe(0);
      expect(allStats.github.calls).toBe(0);
    });
  });
});
