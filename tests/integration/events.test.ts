/**
 * Events API Integration Tests
 *
 * Tests for:
 * - GET /api/events (list with filters and pagination)
 * - GET /api/events/:id (single event)
 * - DELETE /api/events/:id (archive event)
 *
 * Test coverage includes:
 * - Positive cases (valid requests, filters, pagination)
 * - Negative cases (invalid parameters, not found)
 * - Edge cases (empty results, boundary values)
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
  insertEvent,
  createEventData,
  type SeedScenarioResult,
  ensureSecondTestOrg,
  cleanupSecondTestOrg,
} from "../helpers/test-utils.js";
import { query } from "../../src/db/client.js";

// Response types (matching API output)
interface EventListItem {
  id: string;
  sentry_event_id: string | null;
  message: string;
  platform: string | null;
  severity: "low" | "medium" | "high" | "critical";
  environment: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  created_at: string;
  rca_result_id?: string;
}

describe("Events API", () => {
  let seedData: SeedScenarioResult;

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
    seedData = await seedCompleteScenario();
  });

  // ==========================================
  // GET /api/events
  // ==========================================
  describe("GET /api/events", () => {
    describe("Positive Cases", () => {
      it("should return paginated events list", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body).toHaveProperty("events");
        expect(body).toHaveProperty("page");
        expect(body).toHaveProperty("pageSize");
        expect(body).toHaveProperty("total");
        expect(body).toHaveProperty("totalPages");
        expect(Array.isArray(body.events)).toBe(true);
      });

      it("should return events with correct structure", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        if (body.events.length > 0) {
          const event = body.events[0];
          expect(event).toHaveProperty("id");
          expect(event).toHaveProperty("message");
          expect(event).toHaveProperty("severity");
          expect(event).toHaveProperty("environment");
          expect(event).toHaveProperty("created_at");
          expect(event).toHaveProperty("status");
        }
      });

      it("should respect page parameter", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events?page=2&pageSize=3",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.page).toBe(2);
        expect(body.events.length).toBeLessThanOrEqual(3);
      });

      it("should respect pageSize parameter", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events?pageSize=5",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.events.length).toBeLessThanOrEqual(5);
        expect(body.pageSize).toBe(5);
      });

      it("should filter by severity (critical - UnhandledRejection in production)", async () => {
        // Seed data creates UnhandledRejection errors which map to 'critical' severity
        const response = await server.inject({
          method: "GET",
          url: "/api/events?severity=critical",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // All returned events should have critical severity
        body.events.forEach((e: EventListItem) => {
          expect(e.severity).toBe("critical");
        });
      });

      it("should filter by environment", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events?environment=production",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(
          body.events.every(
            (e: EventListItem) => e.environment === "production"
          )
        ).toBe(true);
      });

      it("should filter by search term in message", async () => {
        // Create event with specific message
        await insertEvent(
          createEventData({
            message: "UNIQUE_SEARCH_TERM_XYZ error occurred",
          })
        );

        const response = await server.inject({
          method: "GET",
          url: "/api/events?search=UNIQUE_SEARCH_TERM_XYZ",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.events.length).toBeGreaterThan(0);
        expect(
          body.events.every((e: EventListItem) =>
            e.message.includes("UNIQUE_SEARCH_TERM_XYZ")
          )
        ).toBe(true);
      });

      it("should combine multiple filters", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events?severity=high&environment=production",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(
          body.events.every(
            (e: EventListItem) =>
              e.severity === "high" && e.environment === "production"
          )
        ).toBe(true);
      });

      it("should filter by RCA status", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events?status=completed",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // All events should have completed status
        expect(
          body.events.every((e: EventListItem) => e.status === "completed")
        ).toBe(true);
      });

      it("should return events sorted by created_at descending", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        if (body.events.length > 1) {
          for (let i = 0; i < body.events.length - 1; i++) {
            const current = new Date(body.events[i].created_at).getTime();
            const next = new Date(body.events[i + 1].created_at).getTime();
            expect(current).toBeGreaterThanOrEqual(next);
          }
        }
      });
    });

    describe("Edge Cases", () => {
      it("should return empty list for organization with no events", async () => {
        await cleanupTestData();

        const response = await server.inject({
          method: "GET",
          url: "/api/events",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.events).toEqual([]);
        expect(body.total).toBe(0);
      });

      it("should return empty results for page beyond available data", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events?page=1000",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.events).toEqual([]);
      });

      it("should handle filter with no matches", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events?search=NONEXISTENT_STRING_12345",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.events).toEqual([]);
        expect(body.total).toBe(0);
      });

      it("should handle maximum pageSize", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events?pageSize=100",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // Should be capped at max (100)
        expect(body.pageSize).toBeLessThanOrEqual(100);
      });
    });

    describe("Negative Cases", () => {
      it("should reject invalid severity filter", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events?severity=invalid",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBe("Bad Request");
      });

      it("should reject invalid page parameter", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events?page=-1",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(400);
      });

      it("should reject invalid pageSize parameter", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events?pageSize=0",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(400);
      });

      it("should handle non-numeric page gracefully", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events?page=abc",
          headers: createAuthHeaders(),
        });

        expect([200, 400]).toContain(response.statusCode);
      });
    });

    describe("Security Cases", () => {
      it("should return 401 without org context", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events",
          headers: { "Content-Type": "application/json" },
        });

        expect(response.statusCode).toBe(401);
      });

      it("should isolate events by organization", async () => {
        // Create second org with event
        await ensureSecondTestOrg();

        await insertEvent(
          createEventData({
            org_id: SECOND_TEST_ORG_ID,
            message: "HIDDEN_SECRET_EVENT",
          })
        );

        const response = await server.inject({
          method: "GET",
          url: "/api/events",
          headers: createAuthHeaders(TEST_ORG_ID),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        const hasHiddenEvent = body.events.some((e: EventListItem) =>
          e.message.includes("HIDDEN_SECRET_EVENT")
        );
        expect(hasHiddenEvent).toBe(false);

        // Cleanup
        await cleanupSecondTestOrg();
      });
    });

    describe("Performance", () => {
      it("should respond within acceptable time", async () => {
        const start = Date.now();

        const response = await server.inject({
          method: "GET",
          url: "/api/events",
          headers: createAuthHeaders(),
        });

        const duration = Date.now() - start;

        expect(response.statusCode).toBe(200);
        expect(duration).toBeLessThan(500);
      });
    });
  });

  // ==========================================
  // GET /api/events/:id
  // ==========================================
  describe("GET /api/events/:id", () => {
    describe("Positive Cases", () => {
      it("should return single event by ID", async () => {
        const eventId = seedData.events[0].id;

        const response = await server.inject({
          method: "GET",
          url: `/api/events/${eventId}`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body.id).toBe(eventId);
        expect(body).toHaveProperty("message");
        expect(body).toHaveProperty("severity");
        expect(body).toHaveProperty("environment");
        expect(body).toHaveProperty("created_at");
      });

      it("should include RCA job data when available", async () => {
        const eventId = seedData.events[0].id;

        const response = await server.inject({
          method: "GET",
          url: `/api/events/${eventId}`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body).toHaveProperty("status");
      });

      it("should include raw_payload data", async () => {
        const eventId = seedData.events[0].id;

        const response = await server.inject({
          method: "GET",
          url: `/api/events/${eventId}`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body).toHaveProperty("raw_payload");
        expect(typeof body.raw_payload).toBe("object");
      });
    });

    describe("Negative Cases", () => {
      it("should return 404 for non-existent event", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events/00000000-0000-0000-0000-000000000001",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(404);
        const body = response.json();
        expect(body.error).toBe("Not Found");
      });

      it("should return 400 for invalid UUID format", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/events/not-a-valid-uuid",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe("Security Cases", () => {
      it("should return 401 without org context", async () => {
        const eventId = seedData.events[0].id;

        const response = await server.inject({
          method: "GET",
          url: `/api/events/${eventId}`,
          headers: { "Content-Type": "application/json" },
        });

        expect(response.statusCode).toBe(401);
      });

      it("should return 404 for event from different organization", async () => {
        // Create event in second org
        await ensureSecondTestOrg();

        const otherOrgEvent = await insertEvent(
          createEventData({
            org_id: SECOND_TEST_ORG_ID,
          })
        );

        // Try to access with test org credentials
        const response = await server.inject({
          method: "GET",
          url: `/api/events/${otherOrgEvent.id}`,
          headers: createAuthHeaders(TEST_ORG_ID),
        });

        expect(response.statusCode).toBe(404);

        // Cleanup
        await cleanupSecondTestOrg();
      });
    });
  });

  // ==========================================
  // DELETE /api/events/:id
  // Note: DELETE endpoint is not implemented yet
  // ==========================================
  describe.skip("DELETE /api/events/:id (not implemented)", () => {
    describe("Positive Cases", () => {
      it("should delete/archive event successfully", async () => {
        const eventId = seedData.events[0].id;

        const response = await server.inject({
          method: "DELETE",
          url: `/api/events/${eventId}`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.message).toContain("archived");

        // Verify event is no longer returned in list
        const listResponse = await server.inject({
          method: "GET",
          url: "/api/events",
          headers: createAuthHeaders(),
        });

        const listBody = listResponse.json();
        const eventStillExists = listBody.events.some(
          (e: EventListItem) => e.id === eventId
        );
        expect(eventStillExists).toBe(false);
      });

      it("should return confirmation message", async () => {
        const eventId = seedData.events[1].id;

        const response = await server.inject({
          method: "DELETE",
          url: `/api/events/${eventId}`,
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body).toHaveProperty("message");
        expect(body).toHaveProperty("id");
        expect(body.id).toBe(eventId);
      });
    });

    describe("Negative Cases", () => {
      it("should return 404 for non-existent event", async () => {
        const response = await server.inject({
          method: "DELETE",
          url: "/api/events/00000000-0000-0000-0000-000000000001",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(404);
      });

      it("should return 400 for invalid UUID format", async () => {
        const response = await server.inject({
          method: "DELETE",
          url: "/api/events/invalid-uuid",
          headers: createAuthHeaders(),
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe("Security Cases", () => {
      it("should return 401 without org context", async () => {
        const eventId = seedData.events[0].id;

        const response = await server.inject({
          method: "DELETE",
          url: `/api/events/${eventId}`,
          headers: { "Content-Type": "application/json" },
        });

        expect(response.statusCode).toBe(401);
      });

      it("should not allow deleting event from different organization", async () => {
        // Create event in second org
        await ensureSecondTestOrg();

        const otherOrgEvent = await insertEvent(
          createEventData({
            org_id: SECOND_TEST_ORG_ID,
          })
        );

        // Try to delete with test org credentials
        const response = await server.inject({
          method: "DELETE",
          url: `/api/events/${otherOrgEvent.id}`,
          headers: createAuthHeaders(TEST_ORG_ID),
        });

        expect(response.statusCode).toBe(404);

        // Verify event still exists
        const checkResult = await query("SELECT id FROM events WHERE id = $1", [
          otherOrgEvent.id,
        ]);
        expect(checkResult.rows.length).toBe(1);

        // Cleanup
        await cleanupSecondTestOrg();
      });
    });

    describe("Idempotency", () => {
      it("should return 404 on second delete of same event", async () => {
        const eventId = seedData.events[0].id;

        // First delete
        const firstResponse = await server.inject({
          method: "DELETE",
          url: `/api/events/${eventId}`,
          headers: createAuthHeaders(),
        });
        expect(firstResponse.statusCode).toBe(200);

        // Second delete
        const secondResponse = await server.inject({
          method: "DELETE",
          url: `/api/events/${eventId}`,
          headers: createAuthHeaders(),
        });
        expect(secondResponse.statusCode).toBe(404);
      });
    });
  });
});
