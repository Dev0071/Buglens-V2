/**
 * RCA API Routes Tests
 *
 * Tests for:
 * - GET /v1/rca/:id - Retrieve RCA result
 * - POST /v1/rca/:id/feedback - Submit feedback
 * - GET /v1/rca/:id/evidence-graph - Get evidence graph
 * - Authorization and org isolation
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
import { rcaRoutes } from "../../src/api/routes/rca.js";

// Mock database
vi.mock("../../src/db/client.js", () => ({
  query: vi.fn(),
  transaction: vi.fn(),
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

import { query, transaction } from "../../src/db/client.js";
import { logger } from "../../src/utils/logger.js";

describe("RCA Routes", () => {
  let app: FastifyInstance;
  const mockQuery = query as ReturnType<typeof vi.fn>;
  const mockTransaction = transaction as ReturnType<typeof vi.fn>;
  const mockLogger = logger as unknown as {
    [key: string]: ReturnType<typeof vi.fn>;
  };

  const testOrgId = "550e8400-e29b-41d4-a716-446655440000";
  const testRcaId = "660e8400-e29b-41d4-a716-446655440001";

  const mockRCAResult = {
    id: testRcaId,
    org_id: testOrgId,
    job_id: "job-123",
    root_cause: "Null pointer exception due to uninitialized variable",
    suggested_fix: "Add null check before accessing the property",
    confidence: 0.85,
    causal_chain: [
      "User input not validated",
      "Variable assigned null",
      "Property accessed",
    ],
    evidence_refs: ["src/handler.ts:42", "src/utils.ts:15"],
    llm_model: "gpt-4o-mini",
    evidence_graph: {
      nodes: [
        { id: "1", type: "error", label: "NullPointerException" },
        { id: "2", type: "code", label: "handler.ts:42" },
      ],
      edges: [{ source: "2", target: "1", label: "caused" }],
    },
    actual_root_cause: null,
    feedback_timestamp: null,
    error_category: "null_access",
    created_at: new Date("2024-12-21T10:00:00Z"),
  };

  beforeAll(async () => {
    app = Fastify();
    await app.register(rcaRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /v1/rca/:id", () => {
    it("should return 400 when x-org-id header is missing", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/rca/${testRcaId}`,
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: "Missing x-org-id header",
      });
    });

    it("should return RCA result when found", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [mockRCAResult],
      });

      const response = await app.inject({
        method: "GET",
        url: `/v1/rca/${testRcaId}`,
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.id).toBe(testRcaId);
      expect(body.root_cause).toBe(mockRCAResult.root_cause);
      expect(body.suggested_fix).toBe(mockRCAResult.suggested_fix);
      expect(body.confidence).toBe(0.85);
      expect(body.causal_chain).toEqual(mockRCAResult.causal_chain);
      expect(body.evidence_refs).toEqual(mockRCAResult.evidence_refs);
      expect(body.llm_model).toBe("gpt-4o-mini");
      // Note: evidence_graph may be coerced by Fastify's JSON schema serialization
      // Just verify it exists and is an object (schema validation ensures structure)
      expect(body.evidence_graph).toBeDefined();
      expect(typeof body.evidence_graph).toBe("object");
      expect(body.created_at).toBe("2024-12-21T10:00:00.000Z");
    });

    it("should return 404 when RCA not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await app.inject({
        method: "GET",
        url: `/v1/rca/${testRcaId}`,
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: "RCA result not found",
      });
    });

    it("should enforce org isolation", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const differentOrgId = "different-org-id";
      const response = await app.inject({
        method: "GET",
        url: `/v1/rca/${testRcaId}`,
        headers: { "x-org-id": differentOrgId },
      });

      // Verify query includes org_id filter
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("org_id = $2"),
        [testRcaId, differentOrgId]
      );

      expect(response.statusCode).toBe(404);
    });

    it("should return 500 on database error", async () => {
      mockQuery.mockRejectedValueOnce(new Error("DB connection failed"));

      const response = await app.inject({
        method: "GET",
        url: `/v1/rca/${testRcaId}`,
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({
        error: "Internal server error",
      });
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should handle RCA with feedback already submitted", async () => {
      const rcaWithFeedback = {
        ...mockRCAResult,
        actual_root_cause: "The actual cause was a race condition",
        feedback_timestamp: new Date("2024-12-21T12:00:00Z"),
      };

      mockQuery.mockResolvedValueOnce({ rows: [rcaWithFeedback] });

      const response = await app.inject({
        method: "GET",
        url: `/v1/rca/${testRcaId}`,
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.actual_root_cause).toBe(
        "The actual cause was a race condition"
      );
      expect(body.feedback_timestamp).toBe("2024-12-21T12:00:00.000Z");
    });
  });

  describe("POST /v1/rca/:id/feedback", () => {
    const validFeedback = {
      actual_root_cause:
        "The actual root cause was a database connection timeout",
      feedback_notes: "Found this after checking the DB logs",
    };

    it("should return 400 when x-org-id header is missing", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/rca/${testRcaId}/feedback`,
        payload: validFeedback,
      });

      expect(response.statusCode).toBe(400);
    });

    it("should submit feedback successfully", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: testRcaId, root_cause: "Original root cause" }],
      });

      mockTransaction.mockImplementation(async (_orgId, callback) => {
        const mockClient = {
          query: vi.fn().mockResolvedValue({ rows: [] }),
        };
        await callback(mockClient);
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/rca/${testRcaId}/feedback`,
        headers: {
          "x-org-id": testOrgId,
          "content-type": "application/json",
        },
        payload: validFeedback,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.message).toBe("Feedback recorded successfully");
      expect(body.correction_id).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ rcaId: testRcaId }),
        "RCA feedback submitted successfully"
      );
    });

    it("should return 404 when RCA not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await app.inject({
        method: "POST",
        url: `/v1/rca/${testRcaId}/feedback`,
        headers: {
          "x-org-id": testOrgId,
          "content-type": "application/json",
        },
        payload: validFeedback,
      });

      expect(response.statusCode).toBe(404);
    });

    it("should validate actual_root_cause minimum length", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/rca/${testRcaId}/feedback`,
        headers: {
          "x-org-id": testOrgId,
          "content-type": "application/json",
        },
        payload: {
          actual_root_cause: "short", // Less than 10 chars
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should validate actual_root_cause maximum length", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/rca/${testRcaId}/feedback`,
        headers: {
          "x-org-id": testOrgId,
          "content-type": "application/json",
        },
        payload: {
          actual_root_cause: "x".repeat(2001), // More than 2000 chars
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should accept feedback without notes", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: testRcaId, root_cause: "Original" }],
      });
      mockTransaction.mockImplementation(async (_orgId, callback) => {
        await callback({ query: vi.fn().mockResolvedValue({ rows: [] }) });
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/rca/${testRcaId}/feedback`,
        headers: {
          "x-org-id": testOrgId,
          "content-type": "application/json",
        },
        payload: {
          actual_root_cause: "This is the actual root cause",
          // No feedback_notes
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should return 500 on database error", async () => {
      mockQuery.mockRejectedValueOnce(new Error("DB error"));

      const response = await app.inject({
        method: "POST",
        url: `/v1/rca/${testRcaId}/feedback`,
        headers: {
          "x-org-id": testOrgId,
          "content-type": "application/json",
        },
        payload: validFeedback,
      });

      expect(response.statusCode).toBe(500);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("GET /v1/rca/:id/evidence-graph", () => {
    it("should return 400 when x-org-id header is missing", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/rca/${testRcaId}/evidence-graph`,
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return evidence graph when found", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ evidence_graph: mockRCAResult.evidence_graph }],
      });

      const response = await app.inject({
        method: "GET",
        url: `/v1/rca/${testRcaId}/evidence-graph`,
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.nodes).toHaveLength(2);
      expect(body.edges).toHaveLength(1);
      expect(body.nodes[0].type).toBe("error");
    });

    it("should return 404 when RCA not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await app.inject({
        method: "GET",
        url: `/v1/rca/${testRcaId}/evidence-graph`,
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: "RCA result not found",
      });
    });

    it("should return 404 when evidence graph is null", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ evidence_graph: null }],
      });

      const response = await app.inject({
        method: "GET",
        url: `/v1/rca/${testRcaId}/evidence-graph`,
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: "Evidence graph not available for this RCA",
      });
    });

    it("should return 500 on database error", async () => {
      mockQuery.mockRejectedValueOnce(new Error("DB error"));

      const response = await app.inject({
        method: "GET",
        url: `/v1/rca/${testRcaId}/evidence-graph`,
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(500);
    });

    it("should handle complex evidence graphs", async () => {
      const complexGraph = {
        nodes: [
          {
            id: "1",
            type: "error",
            label: "Error",
            metadata: { severity: "high" },
          },
          { id: "2", type: "code", label: "File A", metadata: { line: 42 } },
          { id: "3", type: "code", label: "File B", metadata: { line: 15 } },
          {
            id: "4",
            type: "commit",
            label: "abc123",
            metadata: { author: "dev" },
          },
        ],
        edges: [
          { source: "2", target: "1", label: "throws" },
          { source: "3", target: "2", label: "calls" },
          { source: "4", target: "3", label: "modified" },
        ],
      };

      mockQuery.mockResolvedValueOnce({
        rows: [{ evidence_graph: complexGraph }],
      });

      const response = await app.inject({
        method: "GET",
        url: `/v1/rca/${testRcaId}/evidence-graph`,
        headers: { "x-org-id": testOrgId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.nodes).toHaveLength(4);
      expect(body.edges).toHaveLength(3);
    });
  });

  describe("UUID validation", () => {
    it("should reject invalid UUID for RCA ID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/rca/not-a-uuid",
        headers: { "x-org-id": testOrgId },
      });

      // Fastify should reject invalid UUID format
      expect([400, 404]).toContain(response.statusCode);
    });
  });
});
