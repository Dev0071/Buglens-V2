/**
 * Analytics API Routes Tests
 *
 * Tests for:
 * - GET /api/analytics/summary
 * - GET /api/analytics/daily
 * - Period filtering (7d, 30d, 90d)
 * - Authorization
 * - Error handling
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { analyticsRoutes } from "../../src/api/routes/analytics.js";

// Mock database
vi.mock("../../src/db/client.js", () => ({
  query: vi.fn(),
  pool: { query: vi.fn() },
}));

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { query } from "../../src/db/client.js";

describe("Analytics Routes", () => {
  let app: FastifyInstance;
  const mockQuery = query as ReturnType<typeof vi.fn>;
  const testOrgId = "550e8400-e29b-41d4-a716-446655440000";

  beforeAll(async () => {
    app = Fastify();

    // Add org context decorator
    app.decorateRequest("getOrgId", function () {
      return this.headers["x-org-id"] || null;
    });

    await app.register(analyticsRoutes, { prefix: "/api" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper function to mock all analytics summary queries in sequence
   */
  function mockSummaryQueries(options: {
    plan?: string;
    totalCost?: string;
    totalTokens?: string;
    totalEvents?: string;
    prevCost?: string;
    prevTokens?: string;
    totalRCAs?: string;
    avgConfidence?: string;
    highConfidence?: string;
    mediumConfidence?: string;
    lowConfidence?: string;
    prevRCAs?: string;
    avgTimeSeconds?: string;
  }) {
    const defaults = {
      plan: "free",
      totalCost: "0",
      totalTokens: "0",
      totalEvents: "0",
      prevCost: "0",
      prevTokens: "0",
      totalRCAs: "0",
      avgConfidence: null,
      highConfidence: "0",
      mediumConfidence: "0",
      lowConfidence: "0",
      prevRCAs: "0",
      avgTimeSeconds: null,
    };
    const opts = { ...defaults, ...options };

    // 1. Organization plan query
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: opts.plan }],
    });

    // 2. Current period cost_metrics
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          total_tokens: opts.totalTokens,
          total_cost: opts.totalCost,
          total_events: opts.totalEvents,
        },
      ],
    });

    // 3. Previous period cost_metrics
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          total_tokens: opts.prevTokens,
          total_cost: opts.prevCost,
        },
      ],
    });

    // 4. RCA metrics
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          total_rcas: opts.totalRCAs,
          avg_confidence: opts.avgConfidence,
          high_confidence: opts.highConfidence,
          medium_confidence: opts.mediumConfidence,
          low_confidence: opts.lowConfidence,
        },
      ],
    });

    // 5. Previous period RCA count
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_rcas: opts.prevRCAs }],
    });

    // 6. Average resolution time
    mockQuery.mockResolvedValueOnce({
      rows: [{ avg_time_seconds: opts.avgTimeSeconds }],
    });
  }

  describe("GET /api/analytics/summary", () => {
    it("should return 401 when org_id is missing", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/summary",
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: "Unauthorized",
        message: "Organization context required",
      });
    });

    it("should return summary with all metrics", async () => {
      mockSummaryQueries({
        plan: "pro",
        totalCost: "25.50",
        totalTokens: "255000",
        totalEvents: "100",
        prevCost: "20.00",
        prevTokens: "200000",
        totalRCAs: "30",
        avgConfidence: "0.75",
        highConfidence: "20",
        mediumConfidence: "7",
        lowConfidence: "3",
        prevRCAs: "25",
        avgTimeSeconds: "45",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/summary",
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Verify cost metrics
      expect(body.totalCost).toBe(25.5);
      expect(body.totalTokens).toBe(255000);
      expect(body.totalRCAs).toBe(30);

      // Verify change calculations: (current - previous) / previous * 100
      expect(body.costChange).toBeCloseTo(27.5, 0); // (25.5 - 20) / 20 * 100 = 27.5
      expect(body.tokenChange).toBeCloseTo(27.5, 0); // (255000 - 200000) / 200000 * 100 = 27.5
      expect(body.rcaChange).toBeCloseTo(20, 0); // (30 - 25) / 25 * 100 = 20

      // Verify quality breakdown
      expect(body.qualityBreakdown.highConfidence).toBe(20);
      expect(body.qualityBreakdown.mediumConfidence).toBe(7);
      expect(body.qualityBreakdown.lowConfidence).toBe(3);

      // Verify averages
      expect(body.avgCostPerRCA).toBeCloseTo(0.85, 1); // 25.5 / 30 = 0.85
      expect(body.avgTimePerRCA).toBe(45);

      // Verify budget (pro plan = 100)
      expect(body.budgetLimit).toBe(100);
      expect(body.budgetUsed).toBe(25.5);
    });

    it("should handle 7d period query parameter", async () => {
      mockSummaryQueries({});

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/summary?period=7d",
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should handle 90d period query parameter", async () => {
      mockSummaryQueries({});

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/summary?period=90d",
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should calculate positive ROI correctly", async () => {
      // ROI formula: ((RCAs * 2 hours * $75) - cost) / cost * 100
      // With 30 RCAs and $25 cost: ((30 * 2 * 75) - 25) / 25 * 100 = ((4500) - 25) / 25 * 100 = 17900%
      mockSummaryQueries({
        totalCost: "25.00",
        totalRCAs: "30",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/summary",
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // ROI should be very high because we're saving $4500 (30 RCAs * 2hr * $75) but only spending $25
      expect(body.roi).toBeGreaterThan(0);
    });

    it("should handle empty data gracefully (zeros)", async () => {
      mockSummaryQueries({});

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/summary",
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.totalCost).toBe(0);
      expect(body.totalTokens).toBe(0);
      expect(body.totalRCAs).toBe(0);
      expect(body.costChange).toBe(0);
      expect(body.roi).toBe(0);
    });

    it("should return correct budget limits by plan", async () => {
      // Free plan
      mockSummaryQueries({ plan: "free" });
      const freeResponse = await app.inject({
        method: "GET",
        url: "/api/analytics/summary",
        headers: { "x-org-id": testOrgId },
      });
      expect(JSON.parse(freeResponse.body).budgetLimit).toBe(10);

      // Pro plan
      mockSummaryQueries({ plan: "pro" });
      const proResponse = await app.inject({
        method: "GET",
        url: "/api/analytics/summary",
        headers: { "x-org-id": testOrgId },
      });
      expect(JSON.parse(proResponse.body).budgetLimit).toBe(100);

      // Enterprise plan
      mockSummaryQueries({ plan: "enterprise" });
      const enterpriseResponse = await app.inject({
        method: "GET",
        url: "/api/analytics/summary",
        headers: { "x-org-id": testOrgId },
      });
      expect(JSON.parse(enterpriseResponse.body).budgetLimit).toBe(1000);
    });

    it("should return 500 on database error", async () => {
      mockQuery.mockRejectedValueOnce(new Error("Database connection failed"));

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/summary",
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({
        error: "Internal Server Error",
        message: "Failed to fetch analytics summary",
      });
    });
  });

  describe("GET /api/analytics/daily", () => {
    it("should return 401 when org_id is missing", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/daily",
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: "Unauthorized",
        message: "Organization context required",
      });
    });

    it("should return daily analytics array", async () => {
      // Mock cost_metrics daily data
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            date: "2024-12-20",
            events_processed: "10",
            llm_tokens_used: "5000",
            llm_cost_usd: "0.50",
          },
        ],
      });

      // Mock RCA daily data
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            date: "2024-12-20",
            rca_count: "5",
            avg_confidence: "0.85",
          },
        ],
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/daily",
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(Array.isArray(body)).toBe(true);
      // Default period is 30d, so we expect 30 entries
      expect(body.length).toBe(30);

      // Each entry should have expected structure
      const entry = body.find((d: { date: string }) => d.date === "2024-12-20");
      if (entry) {
        expect(entry.events).toBe(10);
        expect(entry.tokens).toBe(5000);
        expect(entry.cost).toBe(0.5);
        expect(entry.rcas).toBe(5);
        expect(entry.avgConfidence).toBeCloseTo(0.85, 1);
      }
    });

    it("should handle 7d period returning 7 days", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // cost_metrics
      mockQuery.mockResolvedValueOnce({ rows: [] }); // RCA

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/daily?period=7d",
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(7);
    });

    it("should fill gaps with zeros for dates without data", async () => {
      // Return empty results to test gap filling
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/daily?period=7d",
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // All entries should have zero values
      for (const entry of body) {
        expect(entry.events).toBe(0);
        expect(entry.tokens).toBe(0);
        expect(entry.cost).toBe(0);
        expect(entry.rcas).toBe(0);
        expect(entry.avgConfidence).toBe(0);
      }
    });

    it("should return entries ordered by date ascending", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/daily?period=7d",
        headers: { "x-org-id": testOrgId },
      });

      const body = JSON.parse(response.body);

      // Verify ascending order
      for (let i = 1; i < body.length; i++) {
        expect(new Date(body[i].date).getTime()).toBeGreaterThan(
          new Date(body[i - 1].date).getTime()
        );
      }
    });

    it("should return 500 on database error", async () => {
      mockQuery.mockRejectedValueOnce(new Error("Database connection failed"));

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/daily",
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({
        error: "Internal Server Error",
        message: "Failed to fetch daily analytics",
      });
    });
  });

  describe("Organization isolation", () => {
    it("should only return data for the requesting org", async () => {
      mockSummaryQueries({});

      await app.inject({
        method: "GET",
        url: "/api/analytics/summary",
        headers: { "x-org-id": testOrgId },
      });

      // Verify all queries include org_id filter (except org lookup which uses id)
      for (const call of mockQuery.mock.calls) {
        const sql = call[0] as string;
        const params = call[1] as string[];

        // Every query should include the org_id parameter value
        expect(params).toContain(testOrgId);

        // All queries filter by org (either org_id or id for organizations table)
        const hasOrgFilter =
          sql.toLowerCase().includes("org_id") ||
          sql.toLowerCase().includes("organizations where id");
        expect(hasOrgFilter).toBe(true);
      }
    });
  });

  describe("Change calculations", () => {
    it("should handle zero previous values (avoid division by zero)", async () => {
      mockSummaryQueries({
        totalCost: "100",
        totalTokens: "50000",
        totalRCAs: "10",
        prevCost: "0",
        prevTokens: "0",
        prevRCAs: "0",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/summary",
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // With zero previous values, change should be 0 (not NaN or Infinity)
      expect(body.costChange).toBe(0);
      expect(body.tokenChange).toBe(0);
      expect(body.rcaChange).toBe(0);
    });

    it("should calculate percentage change correctly", async () => {
      mockSummaryQueries({
        totalCost: "150",
        totalTokens: "75000",
        totalRCAs: "15",
        prevCost: "100",
        prevTokens: "50000",
        prevRCAs: "10",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/analytics/summary",
        headers: { "x-org-id": testOrgId },
      });

      const body = JSON.parse(response.body);

      // (current - previous) / previous * 100
      expect(body.costChange).toBeCloseTo(50, 0); // (150 - 100) / 100 * 100 = 50%
      expect(body.tokenChange).toBeCloseTo(50, 0); // (75000 - 50000) / 50000 * 100 = 50%
      expect(body.rcaChange).toBeCloseTo(50, 0); // (15 - 10) / 10 * 100 = 50%
    });
  });
});
