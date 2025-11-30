import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { server } from "../../src/api/app.js";

describe("Health Endpoints", () => {
  beforeAll(async () => {
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("should return healthy status", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("healthy");
    expect(body.database).toBe("connected");
  });

  it("should return ready status", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/ready",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("ready");
  });
});
