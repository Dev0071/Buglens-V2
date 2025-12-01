import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { server } from "../../src/api/app.js";
import { pool } from "../../src/db/client.js";
import crypto from "crypto";

// Test org id (must exist in DB via seed-dev-data.sql)
const TEST_ORG_ID = "00000000-0000-0000-0000-000000000000";
const WEBHOOK_SECRET =
  process.env.SENTRY_WEBHOOK_SECRET || "your-test-secret-for-local-development";

function generateSignature(payload: object): string {
  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
  hmac.update(JSON.stringify(payload));
  return hmac.digest("hex");
}

describe("Sentry Webhook", () => {
  beforeAll(async () => {
    await server.ready();
    // Ensure test org exists
    await pool.query(
      `INSERT INTO organizations (id, name, slug, plan)
       VALUES ($1, 'Test Organization', 'test-org', 'free')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_ORG_ID]
    );
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    // Clean up events table for test org only
    await pool.query("DELETE FROM events WHERE org_id = $1", [TEST_ORG_ID]);
  });

  it("should accept valid Sentry webhook", async () => {
    const payload = {
      event_id: `test-event-${Date.now()}`,
      timestamp: Date.now() / 1000,
      platform: "javascript",
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Cannot read property 'foo' of undefined",
            stacktrace: {
              frames: [
                {
                  filename: "app.js",
                  function: "processUser",
                  lineno: 42,
                  colno: 15,
                },
              ],
            },
          },
        ],
      },
      environment: "production",
    };

    const signature = generateSignature(payload);

    const response = await server.inject({
      method: "POST",
      url: `/api/v1/webhooks/sentry/${TEST_ORG_ID}`,
      payload,
      headers: {
        "sentry-hook-signature": signature,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("received");
    expect(body.event_id).toBeDefined();

    // Verify event stored in database
    const result = await pool.query(
      "SELECT * FROM events WHERE sentry_event_id = $1 AND org_id = $2",
      [payload.event_id, TEST_ORG_ID]
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].environment).toBe("production");
  });

  it("should reject invalid payload", async () => {
    const payload = { invalid: "payload" };
    const signature = generateSignature(payload);

    const response = await server.inject({
      method: "POST",
      url: `/api/v1/webhooks/sentry/${TEST_ORG_ID}`,
      payload,
      headers: {
        "sentry-hook-signature": signature,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("Bad Request");
  });

  it("should reject missing signature", async () => {
    const payload = {
      event_id: "test-event-no-sig",
      timestamp: Date.now() / 1000,
    };

    const response = await server.inject({
      method: "POST",
      url: `/api/v1/webhooks/sentry/${TEST_ORG_ID}`,
      payload,
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.message).toBe("Missing signature");
  });

  it("should reject invalid org_id format", async () => {
    const payload = { event_id: "test", timestamp: Date.now() / 1000 };
    const signature = generateSignature(payload);

    const response = await server.inject({
      method: "POST",
      url: "/api/v1/webhooks/sentry/not-a-uuid",
      payload,
      headers: {
        "sentry-hook-signature": signature,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toBe("Invalid organization ID");
  });

  it("should reject non-existent organization", async () => {
    const payload = { event_id: "test", timestamp: Date.now() / 1000 };
    const signature = generateSignature(payload);

    const response = await server.inject({
      method: "POST",
      url: "/api/v1/webhooks/sentry/99999999-9999-9999-9999-999999999999",
      payload,
      headers: {
        "sentry-hook-signature": signature,
      },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.message).toBe("Organization does not exist");
  });

  it("should handle duplicate events (idempotency)", async () => {
    const payload = {
      event_id: `idempotent-event-${Date.now()}`,
      timestamp: Date.now() / 1000,
      platform: "javascript",
    };
    const signature = generateSignature(payload);

    // First request
    const response1 = await server.inject({
      method: "POST",
      url: `/api/v1/webhooks/sentry/${TEST_ORG_ID}`,
      payload,
      headers: { "sentry-hook-signature": signature },
    });
    expect(response1.statusCode).toBe(200);
    const body1 = JSON.parse(response1.body);
    expect(body1.status).toBe("received");

    // Second request with same event_id
    const response2 = await server.inject({
      method: "POST",
      url: `/api/v1/webhooks/sentry/${TEST_ORG_ID}`,
      payload,
      headers: { "sentry-hook-signature": signature },
    });
    expect(response2.statusCode).toBe(200);
    const body2 = JSON.parse(response2.body);
    expect(body2.status).toBe("duplicate");
    expect(body2.event_id).toBe(body1.event_id);

    // Verify only one event stored
    const result = await pool.query(
      "SELECT COUNT(*) FROM events WHERE sentry_event_id = $1 AND org_id = $2",
      [payload.event_id, TEST_ORG_ID]
    );
    expect(Number(result.rows[0].count)).toBe(1);
  });
});
