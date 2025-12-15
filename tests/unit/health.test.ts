import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { server } from "../../src/api/app.js";

describe("Health Endpoints", () => {
  beforeAll(async () => {
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("should return healthy status with checks", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("healthy");
    expect(body.checks).toBeDefined();
    expect(body.checks.database).toBe("connected");
    expect(body.checks.redis).toBe("connected");
    expect(body.timestamp).toBeDefined();
    expect(body.uptime).toBeGreaterThan(0);
  });

  it("should return ready status with comprehensive checks", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/ready",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("ready");
    expect(body.checks).toBeDefined();
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.redis.status).toBe("ok");
    expect(body.checks.queues.status).toBe("ok");
    // Check latency metrics are included
    expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.checks.redis.latencyMs).toBeGreaterThanOrEqual(0);
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
