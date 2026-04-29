/**
 * Costs API Integration Tests
 *
 * Tests for:
 * - GET /api/costs/summary
 * - GET /api/costs/daily
 *
 * Test coverage includes:
 * - Positive cases (valid requests with cost data)
 * - Negative cases (invalid parameters)
 * - Edge cases (no data, date range boundaries)
 * - Security (org isolation, unauthorized access)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { server } from "../../src/api/app.js";
import {
  TEST_ORG_ID,
  SECOND_TEST_ORG_ID,
  createAuthHeaders,
  ensureTestOrg,
  cleanupTestData,
  seedCompleteScenario,
  insertCostMetric,
  createCostMetricData,
  ensureSecondTestOrg,
  cleanupSecondTestOrg,
} from "../helpers/test-utils.js";

describe("Costs API", () => {
  beforeAll(async () => {
    await server.ready();
    await ensureTestOrg();
  });

  afterAll(async () => {
    await cleanupTestData();
    await server.close();
  });

  beforeEach(async () => {
    await cleanupTestData();
    await seedCompleteScenario();
  });

  // ==========================================
  // GET /api/costs/summary
  // ==========================================
  describe("GET /api/costs/summary", () => {
    describe("Positive Cases", () => {
      it("should return cost summary structure", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body).toHaveProperty("currentMonth");
        expect(body).toHaveProperty("previousMonth");
        expect(body).toHaveProperty("costChange");
        expect(body).toHaveProperty("projectedMonthlyCost");
        expect(body).toHaveProperty("dailyMetrics");
      });

      it("should return current month metrics", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        const currentMonth = body.currentMonth;
        expect(currentMonth).toHaveProperty("totalCost");
        expect(currentMonth).toHaveProperty("llmCost");
        expect(currentMonth).toHaveProperty("tokenCount");
        expect(currentMonth).toHaveProperty("eventsProcessed");
        expect(currentMonth).toHaveProperty("avgCostPerRCA");

        expect(typeof currentMonth.totalCost).toBe("number");
        expect(typeof currentMonth.tokenCount).toBe("number");
      });

      it("should return previous month metrics", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        const previousMonth = body.previousMonth;
        expect(previousMonth).toHaveProperty("totalCost");
        expect(previousMonth).toHaveProperty("llmCost");
        expect(previousMonth).toHaveProperty("tokenCount");
        expect(previousMonth).toHaveProperty("eventsProcessed");
      });

      it("should return cost change percentage", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(typeof body.costChange).toBe("number");
        // Cost change is a percentage, can be positive or negative
        expect(body.costChange).toBeGreaterThanOrEqual(-100);
      });

      it("should return daily metrics array", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(Array.isArray(body.dailyMetrics)).toBe(true);
      });

      it("should return positive token counts from seeded data", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // We seeded 30 days of cost metrics
        expect(body.currentMonth.tokenCount).toBeGreaterThan(0);
      });

      it("should calculate projected monthly cost", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(typeof body.projectedMonthlyCost).toBe("number");
        expect(body.projectedMonthlyCost).toBeGreaterThanOrEqual(0);
      });
    });

    describe("Edge Cases", () => {
      it("should return zeros for organization with no cost data", async () => {
        await cleanupTestData();
        await ensureTestOrg();

        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.currentMonth.totalCost).toBe(0);
        expect(body.currentMonth.tokenCount).toBe(0);
        expect(body.previousMonth.totalCost).toBe(0);
      });

      it("should handle organization with only old data", async () => {
        await cleanupTestData();
        await ensureTestOrg();

        // Add cost metric from 60 days ago (outside current and previous month)
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 60);

        await insertCostMetric(
          createCostMetricData(oldDate.toISOString().split("T")[0], {
            llm_tokens_used: 50000,
            llm_cost_usd: 1.5,
          })
        );

        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // Current month should be zero
        expect(body.currentMonth.tokenCount).toBe(0);
      });

      it("should return empty daily metrics when no recent data", async () => {
        await cleanupTestData();
        await ensureTestOrg();

        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.dailyMetrics).toEqual([]);
      });
    });

    describe("Security Cases", () => {
      it("should return 401 without org context", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: { "Content-Type": "application/json" },
        });

        expect(response.statusCode).toBe(401);
      });

      it("should isolate cost data by organization", async () => {
        // Capture org1 baseline before adding org2 data
        const baselineResponse = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(TEST_ORG_ID),
        });
        const baselineTokens = baselineResponse.json().currentMonth.tokenCount;

        // Create second org with a large distinctive token count
        await ensureSecondTestOrg();

        await insertCostMetric(
          createCostMetricData(new Date().toISOString().split("T")[0], {
            org_id: SECOND_TEST_ORG_ID,
            llm_tokens_used: 999999,
            llm_cost_usd: 100.0,
          })
        );

        // Query with test org — count must be unchanged after adding org2 data
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(TEST_ORG_ID),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // org1 count must not have changed: proves org2's 999999 tokens are not leaking in
        expect(body.currentMonth.tokenCount).toBe(baselineTokens);

        // Cleanup
        await cleanupSecondTestOrg();
      });
    });

    describe("Performance", () => {
      it("should respond within acceptable time", async () => {
        const start = Date.now();

        const response = await server.inject({
          method: "GET",
          url: "/api/costs/summary",
          headers: createAuthHeaders(),
        });

        const duration = Date.now() - start;

        expect(response.statusCode).toBe(200);
        expect(duration).toBeLessThan(1000); // Cost calculations may be heavier
      });
    });
  });

  // ==========================================
  // GET /api/costs/daily
  // ==========================================
  describe("GET /api/costs/daily", () => {
    describe("Positive Cases", () => {
      it("should return daily costs for default range", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/daily",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body).toHaveProperty("startDate");
        expect(body).toHaveProperty("endDate");
        expect(body).toHaveProperty("metrics");
        expect(body).toHaveProperty("totals");
      });

      it("should return daily metrics array", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/daily",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(Array.isArray(body.metrics)).toBe(true);
      });

      it("should return metrics with correct structure", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/daily",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        if (body.metrics.length > 0) {
          const metric = body.metrics[0];
          expect(metric).toHaveProperty("date");
          expect(metric).toHaveProperty("llmTokens");
          expect(metric).toHaveProperty("llmCost");
          expect(metric).toHaveProperty("githubApiCalls");
        }
      });

      it("should return totals", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/daily",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.totals).toHaveProperty("llmTokens");
        expect(body.totals).toHaveProperty("llmCost");
        expect(body.totals).toHaveProperty("githubApiCalls");
      });

      it("should respect custom date range", async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        const endDate = new Date();

        const response = await server.inject({
          method: "GET",
          url: `/api/costs/daily?startDate=${startDate.toISOString().split("T")[0]}&endDate=${endDate.toISOString().split("T")[0]}`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.startDate).toBe(startDate.toISOString().split("T")[0]);
        expect(body.endDate).toBe(endDate.toISOString().split("T")[0]);
      });

      it("should return metrics in ascending date order", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/daily",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        if (body.metrics.length > 1) {
          for (let i = 0; i < body.metrics.length - 1; i++) {
            const current = new Date(body.metrics[i].date).getTime();
            const next = new Date(body.metrics[i + 1].date).getTime();
            expect(current).toBeLessThanOrEqual(next);
          }
        }
      });
    });

    describe("Negative Cases", () => {
      it("should reject invalid date format for startDate", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/daily?startDate=invalid-date",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(400);
      });

      it("should reject invalid date format for endDate", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/daily?endDate=2024/01/01",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(400);
      });

      it("should reject date range exceeding 90 days", async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 100);
        const endDate = new Date();

        const response = await server.inject({
          method: "GET",
          url: `/api/costs/daily?startDate=${startDate.toISOString().split("T")[0]}&endDate=${endDate.toISOString().split("T")[0]}`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.message).toContain("90");
      });

      it("should reject startDate after endDate", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/daily?startDate=2024-12-31&endDate=2024-01-01",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.message).toContain("before");
      });
    });

    describe("Edge Cases", () => {
      it("should return empty metrics for organization with no data", async () => {
        await cleanupTestData();
        await ensureTestOrg();

        const response = await server.inject({
          method: "GET",
          url: "/api/costs/daily",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.metrics).toEqual([]);
        expect(body.totals.llmTokens).toBe(0);
        expect(body.totals.llmCost).toBe(0);
      });

      it("should handle single day range", async () => {
        const today = new Date().toISOString().split("T")[0];

        const response = await server.inject({
          method: "GET",
          url: `/api/costs/daily?startDate=${today}&endDate=${today}`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.startDate).toBe(today);
        expect(body.endDate).toBe(today);
      });

      it("should handle future date range (no data)", async () => {
        const futureStart = new Date();
        futureStart.setFullYear(futureStart.getFullYear() + 1);
        const futureEnd = new Date(futureStart);
        futureEnd.setDate(futureEnd.getDate() + 7);

        const response = await server.inject({
          method: "GET",
          url: `/api/costs/daily?startDate=${futureStart.toISOString().split("T")[0]}&endDate=${futureEnd.toISOString().split("T")[0]}`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.metrics).toEqual([]);
      });
    });

    describe("Security Cases", () => {
      it("should return 401 without org context", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/daily",
          headers: { "Content-Type": "application/json" },
        });

        expect(response.statusCode).toBe(401);
      });

      it("should isolate daily metrics by organization", async () => {
        // Create second org with cost data
        await ensureSecondTestOrg();

        const today = new Date().toISOString().split("T")[0];
        await insertCostMetric(
          createCostMetricData(today, {
            org_id: SECOND_TEST_ORG_ID,
            llm_tokens_used: 888888,
          })
        );

        // Query with test org
        const response = await server.inject({
          method: "GET",
          url: "/api/costs/daily",
          headers: createAuthHeaders(TEST_ORG_ID),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // Should not include 888888 tokens from other org
        const hasOtherOrgData = body.metrics.some(
          (m: { llmTokens: number }) => m.llmTokens === 888888
        );
        expect(hasOtherOrgData).toBe(false);

        // Cleanup
        await cleanupSecondTestOrg();
      });
    });

    describe("Performance", () => {
      it("should respond within acceptable time for 30 day range", async () => {
        const start = Date.now();

        const response = await server.inject({
          method: "GET",
          url: "/api/costs/daily",
          headers: createAuthHeaders(),
        });

        const duration = Date.now() - start;

        expect(response.statusCode).toBe(200);
        expect(duration).toBeLessThan(500);
      });

      it("should respond within acceptable time for 90 day range", async () => {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 89);
        const endDate = new Date();

        const start = Date.now();

        const response = await server.inject({
          method: "GET",
          url: `/api/costs/daily?startDate=${startDate.toISOString().split("T")[0]}&endDate=${endDate.toISOString().split("T")[0]}`,
          headers: createAuthHeaders(),
        });

        const duration = Date.now() - start;

        expect(response.statusCode).toBe(200);
        expect(duration).toBeLessThan(1000);
      });
    });
  });
});
