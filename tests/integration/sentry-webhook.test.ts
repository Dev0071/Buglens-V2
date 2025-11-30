import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { server } from "../../src/api/app.js";
import { pool } from "../../src/db/client.js";

describe("Sentry Webhook", () => {
  beforeAll(async () => {
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    // Clean up events table
    await pool.query("DELETE FROM events");
  });

  it("should accept valid Sentry webhook", async () => {
    const payload = {
      event_id: "test-event-123",
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

    const response = await server.inject({
      method: "POST",
      url: "/api/v1/webhooks/sentry",
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("received");
    expect(body.event_id).toBeDefined();

    // Verify event stored in database
    const result = await pool.query(
      "SELECT * FROM events WHERE sentry_event_id = $1",
      [payload.event_id]
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].environment).toBe("production");
  });

  it("should reject invalid payload", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/webhooks/sentry",
      payload: {
        invalid: "payload",
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("Bad Request");
  });
});
