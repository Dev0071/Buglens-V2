/**
 * Events API Integration Tests
 *
 * Tests the events endpoint with filtering and pagination
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { server } from "../../src/api/app.js";
import { query } from "../../src/db/client.js";

describe("Events API", () => {
  let testOrgId: string;
  let accessToken: string;

  beforeAll(async () => {
    await server.ready();

    // Create test organization and user
    const orgResult = await query<{ id: string }>(
      `INSERT INTO organizations (name, slug, plan)
       VALUES ('Events Test Org', 'events-test-org-${Date.now()}', 'free')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    testOrgId = orgResult.rows[0].id;

    // Create test user
    const userResult = await query<{ id: string }>(
      `INSERT INTO users (org_id, email, name, role, password_hash, auth_provider)
       VALUES ($1, 'events-test-${Date.now()}@test.com', 'Events Test User', 'owner',
               '$2b$12$test-hash-for-testing', 'email')
       RETURNING id`,
      [testOrgId]
    );

    // Generate JWT token for testing
    accessToken = server.jwt.sign(
      { userId: userResult.rows[0].id, orgId: testOrgId },
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    // Clean up test data
    if (testOrgId) {
      await query("DELETE FROM rca_jobs WHERE org_id = $1", [testOrgId]);
      await query("DELETE FROM events WHERE org_id = $1", [testOrgId]);
      await query("DELETE FROM users WHERE org_id = $1", [testOrgId]);
      await query("DELETE FROM organizations WHERE id = $1", [testOrgId]);
    }
    // Server is managed by app.js
  });

  beforeEach(async () => {
    // Clean up events and jobs before each test
    await query("DELETE FROM rca_jobs WHERE org_id = $1", [testOrgId]);
    await query("DELETE FROM events WHERE org_id = $1", [testOrgId]);
  });

  describe("GET /api/events", () => {
    it("should return events with pagination", async () => {
      // Create test events
      for (let i = 0; i < 5; i++) {
        await query(
          `INSERT INTO events (org_id, message, platform, signature, timestamp)
           VALUES ($1, $2, 'javascript', $3, NOW())`,
          [testOrgId, `Test event ${i}`, `test-sig-${i}-${Date.now()}`]
        );
      }

      const response = await server.inject({
        method: "GET",
        url: "/api/events?page=1&pageSize=3",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.events).toHaveLength(3);
      expect(data.total).toBe(5);
      expect(data.page).toBe(1);
      expect(data.pageSize).toBe(3);
      expect(data.totalPages).toBe(2);
    });

    it("should filter by status via RCA job status", async () => {
      // Create events with different statuses via rca_jobs
      const event1 = await query<{ id: string }>(
        `INSERT INTO events (org_id, message, signature, timestamp)
         VALUES ($1, 'Pending event', 'sig-pending-${Date.now()}', NOW())
         RETURNING id`,
        [testOrgId]
      );

      const event2 = await query<{ id: string }>(
        `INSERT INTO events (org_id, message, signature, timestamp)
         VALUES ($1, 'Done event', 'sig-done-${Date.now()}', NOW())
         RETURNING id`,
        [testOrgId]
      );

      // Create RCA jobs with different statuses
      await query(
        `INSERT INTO rca_jobs (org_id, event_id, status, retry_count)
         VALUES ($1, $2, 'pending', 0)`,
        [testOrgId, event1.rows[0].id]
      );

      await query(
        `INSERT INTO rca_jobs (org_id, event_id, status, retry_count)
         VALUES ($1, $2, 'done', 0)`,
        [testOrgId, event2.rows[0].id]
      );

      // Filter for completed (maps to 'done' job status)
      const response = await server.inject({
        method: "GET",
        url: "/api/events?status=completed",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.events).toHaveLength(1);
      expect(data.events[0].status).toBe("completed");
    });

    it("should filter by comma-separated status values (quick filter pattern)", async () => {
      // Create events with different statuses
      const event1 = await query<{ id: string }>(
        `INSERT INTO events (org_id, message, signature, timestamp)
         VALUES ($1, 'Pending event', 'sig-p-${Date.now()}', NOW())
         RETURNING id`,
        [testOrgId]
      );

      const event2 = await query<{ id: string }>(
        `INSERT INTO events (org_id, message, signature, timestamp)
         VALUES ($1, 'Processing event', 'sig-pr-${Date.now()}', NOW())
         RETURNING id`,
        [testOrgId]
      );

      const event3 = await query<{ id: string }>(
        `INSERT INTO events (org_id, message, signature, timestamp)
         VALUES ($1, 'Done event', 'sig-d-${Date.now()}', NOW())
         RETURNING id`,
        [testOrgId]
      );

      // Create RCA jobs
      await query(
        `INSERT INTO rca_jobs (org_id, event_id, status, retry_count)
         VALUES ($1, $2, 'pending', 0), ($1, $3, 'analyzing', 0), ($1, $4, 'done', 0)`,
        [testOrgId, event1.rows[0].id, event2.rows[0].id, event3.rows[0].id]
      );

      // Quick filter pattern: status=pending,processing
      const response = await server.inject({
        method: "GET",
        url: "/api/events?status=pending,processing",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.events).toHaveLength(2);
      expect(
        data.events.every((e: { status: string }) =>
          ["pending", "processing"].includes(e.status)
        )
      ).toBe(true);
    });

    it("should handle search parameter", async () => {
      await query(
        `INSERT INTO events (org_id, message, signature, timestamp) VALUES
         ($1, 'TypeError: Cannot read property', 'sig-type-${Date.now()}', NOW()),
         ($1, 'ReferenceError: x is not defined', 'sig-ref-${Date.now()}', NOW())`,
        [testOrgId]
      );

      const response = await server.inject({
        method: "GET",
        url: "/api/events?search=TypeError",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.events).toHaveLength(1);
      expect(data.events[0].message).toContain("TypeError");
    });

    it("should reject invalid status values", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/events?status=invalid",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should require authentication", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/events",
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
