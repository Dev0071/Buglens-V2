import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { server } from "../../src/api/app.js";

/**
 * Health Endpoint Tests
 *
 * Note: Full health/ready checks require database and Redis connections.
 * In unit test runs, these tests verify the endpoint exists and returns
 * a valid response structure. Integration tests with infrastructure
 * will verify the actual health status.
 */
describe("Health Endpoints", () => {
  beforeAll(async () => {
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("should return health endpoint response", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/health",
    });

    // Health endpoint should always respond
    expect([200, 503]).toContain(response.statusCode);
    const body = JSON.parse(response.body);
    expect(body.status).toBeDefined();
    expect(body.checks).toBeDefined();
    expect(body.timestamp).toBeDefined();
    expect(body.uptime).toBeGreaterThan(0);
  });

  it("should return ready endpoint response", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/ready",
    });

    // Ready endpoint should return either ready or not ready
    expect([200, 503]).toContain(response.statusCode);
    const body = JSON.parse(response.body);
    expect(body.status).toBeDefined();
    expect(body.checks).toBeDefined();
  });

  it("should return startup status", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/startup",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("started");
    expect(body.environment).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });
});
