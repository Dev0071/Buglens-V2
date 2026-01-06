# CloudWatch Metrics Coverage Analysis

## Overview

The Buglens MVP tracks comprehensive metrics across all critical system components. This document analyzes the current metrics coverage and identifies any gaps.

## Current Metrics Implementation

### Location: `src/services/metrics.ts`

The metrics service provides:

- **Namespace**: `Buglens/MVP`
- **Flush Interval**: 60 seconds
- **Integration**: AWS CloudWatch (production/staging), In-memory (development)

---

## Metrics Categories

### 1. Cache Metrics ✅ COMPLETE

| Metric             | Type      | Unit         | Dimensions                      | Status |
| ------------------ | --------- | ------------ | ------------------------------- | ------ |
| CacheHitRate       | Gauge     | Percent      | -                               | ✅     |
| CacheHits          | Counter   | Count        | Tier (redis/s3/database/github) | ✅     |
| CacheLookupLatency | Histogram | Milliseconds | -                               | ✅     |

**Functions**:

- `recordCacheLookup(tier, hit, latencyMs, orgId?)`
- `getCacheHitRate()`
- `getCacheStatsByTier()`

**Coverage Analysis**: Full coverage of 3-tier caching (Redis → S3 → GitHub API)

---

### 2. Source Map Metrics ✅ COMPLETE

| Metric                  | Type      | Unit         | Dimensions | Status |
| ----------------------- | --------- | ------------ | ---------- | ------ |
| SourceMapSuccessRate    | Gauge     | Percent      | -          | ✅     |
| SourceMapOutcome        | Counter   | Count        | Outcome    | ✅     |
| SourceMapLatency        | Histogram | Milliseconds | -          | ✅     |
| SourceMapBytesProcessed | Counter   | Bytes        | -          | ✅     |

**Outcomes Tracked**:

- `resolved` - Successfully resolved from external file
- `inline_resolved` - Successfully resolved from inline map
- `external_resolved` - Successfully resolved from external file
- `missing` - Source map not found
- `malformed` - Source map parsing failed
- `parse_error` - Source map consumer error

**Functions**:

- `recordSourceMapResolution(outcome, latencyMs, bytesProcessed?, bundlerType?)`
- `getSourceMapSuccessRate()`
- `getSourceMapStats()`

---

### 3. LLM Metrics ✅ COMPLETE

| Metric        | Type      | Unit         | Dimensions | Status |
| ------------- | --------- | ------------ | ---------- | ------ |
| LLMRequests   | Counter   | Count        | -          | ✅     |
| LLMTokensUsed | Counter   | Count        | -          | ✅     |
| LLMErrors     | Counter   | Count        | -          | ✅     |
| LLMLatency    | Histogram | Milliseconds | -          | ✅     |

**Functions**:

- `recordLLMRequest(tokensUsed, latencyMs, model, success)`
- `getLLMStats()`

**Derived Metrics**:

- Error Rate: `llmErrors / llmRequests * 100`
- Average Latency: `sum(latencies) / count`

---

### 4. GitHub API Metrics ✅ COMPLETE

| Metric                   | Type      | Unit         | Dimensions | Status |
| ------------------------ | --------- | ------------ | ---------- | ------ |
| GitHubApiCalls           | Counter   | Count        | -          | ✅     |
| GitHubRateLimitRemaining | Gauge     | Count        | -          | ✅     |
| GitHubApiLatency         | Histogram | Milliseconds | -          | ✅     |

**Functions**:

- `recordGitHubApiCall(latencyMs, rateLimitRemaining)`
- `getGitHubApiStats()`

**Alert Threshold**: Rate limit < 100 triggers warning log

---

## Health Check Integration

The metrics service provides health status via `getMetricsHealth()`:

```typescript
interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  details: {
    cloudWatchEnabled: boolean;
    cacheHitRate: number;
    sourceMapSuccessRate: number;
    warnings: string[];
  };
}
```

**Warning Thresholds**:

- Cache hit rate < 50% (with > 10 lookups)
- Source map success rate < 70% (with > 5 attempts)
- GitHub rate limit < 100
- LLM error rate > 10% (with > 5 requests)

**Status Determination**:

- `healthy`: No warnings
- `degraded`: 1-2 warnings
- `unhealthy`: 3+ warnings

---

## CloudWatch Dashboard Recommendations

### Recommended Alarms

1. **Cache Performance**
   - Alarm when CacheHitRate < 50% for 5 minutes
   - Alarm when CacheLookupLatency p95 > 500ms

2. **Source Map Resolution**
   - Alarm when SourceMapSuccessRate < 60%
   - Alarm when missing > 50% of outcomes

3. **LLM Costs**
   - Alarm when LLMTokensUsed > 1M/day
   - Alarm when LLMErrors > 10% error rate

4. **GitHub Rate Limit**
   - Alarm when GitHubRateLimitRemaining < 200
   - Critical when < 50

### Recommended Dashboard Widgets

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Buglens MVP Dashboard                        │
├─────────────────────────────────────────────────────────────────────┤
│  [Cache Hit Rate %]     [Source Map Success %]   [LLM Error Rate %] │
│                                                                     │
│  [GitHub Rate Limit]    [LLM Tokens/Hour]        [Avg Latency ms]   │
│                                                                     │
│  [Cache Hits by Tier]   [Source Map Outcomes]    [API Latency p95]  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Gaps Identified

### Current Gaps (Non-Critical)

1. **RCA Job Metrics** - Not yet tracked:
   - Job success/failure rate
   - Job processing time
   - Queue depth/wait time

2. **Organization-level Metrics** - Partially implemented:
   - `orgId` passed but not used as dimension
   - Cost tracking per-org would benefit from CloudWatch dimensions

3. **Database Connection Pool Metrics**:
   - Pool utilization
   - Connection wait time
   - Query execution time

### Recommendations for Phase 2

1. Add `OrgId` dimension to metrics for per-tenant analysis
2. Implement job queue metrics via BullMQ events
3. Add database pool metrics from pg pool events
4. Create CloudWatch Insights queries for cost attribution

---

## Summary

| Category               | Coverage | Status      |
| ---------------------- | -------- | ----------- |
| Cache Metrics          | 100%     | ✅ Complete |
| Source Map Metrics     | 100%     | ✅ Complete |
| LLM Metrics            | 100%     | ✅ Complete |
| GitHub API Metrics     | 100%     | ✅ Complete |
| Health Checks          | 100%     | ✅ Complete |
| CloudWatch Integration | 100%     | ✅ Complete |

**Overall Assessment**: The metrics implementation is **production-ready** with comprehensive coverage of all critical MVP components. The gaps identified are for Phase 2 enhancements.
