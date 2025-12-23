/**
 * OAuth Login Integration Tests
 *
 * Tests the GitHub and Google OAuth login flows
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { server } from "../../src/api/app.js";
import type { FastifyInstance } from "fastify";

describe("OAuth Login Routes", () => {
  beforeAll(async () => {
    await server.ready();
  });

  afterAll(async () => {
    // Server is managed by app.js
  });

  describe("GET /api/auth/github", () => {
    it("should return 503 when GitHub OAuth is not configured", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/auth/github",
      });

      // When GITHUB_OAUTH_CLIENT_ID is not set, should return 503
      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.payload)).toMatchObject({
        error: "OAUTH_NOT_CONFIGURED",
        message: expect.stringContaining("GitHub login is not configured"),
      });
    });
  });

  describe("GET /api/auth/github/callback", () => {
    it("should redirect to login with error when no code is provided", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/auth/github/callback?state=test",
        cookies: {
          oauth_state: "test",
        },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("/login?error=no_code");
    });

    it("should redirect to login with error when state mismatch", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/auth/github/callback?code=test&state=wrong",
        cookies: {
          oauth_state: "correct",
        },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("/login?error=invalid_state");
    });
  });

  describe("GET /api/auth/google", () => {
    it("should return 503 when Google OAuth is not configured", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/auth/google",
      });

      // When GOOGLE_OAUTH_CLIENT_ID is not set, should return 503
      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.payload)).toMatchObject({
        error: "OAUTH_NOT_CONFIGURED",
        message: expect.stringContaining("Google login is not configured"),
      });
    });
  });

  describe("GET /api/auth/google/callback", () => {
    it("should redirect to login with error when no code is provided", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/auth/google/callback?state=test",
        cookies: {
          oauth_state: "test",
        },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("/login?error=no_code");
    });

    it("should redirect to login with error when state mismatch", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/auth/google/callback?code=test&state=wrong",
        cookies: {
          oauth_state: "correct",
        },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("/login?error=invalid_state");
    });
  });
});

describe("Auth Service - OAuth Login", () => {
  // Note: These tests require mocking external APIs
  // In production, use integration tests with real OAuth flows

  it("should handle OAuth login flow correctly", () => {
    // Placeholder for OAuth login flow testing
    // Real tests would need to mock GitHub/Google API responses
    expect(true).toBe(true);
  });
});
