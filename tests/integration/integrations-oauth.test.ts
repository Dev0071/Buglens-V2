/**
 * Integrations OAuth Tests
 *
 * Tests for:
 * - GitHub integration OAuth flow
 * - Slack integration OAuth flow
 * - Jira integration OAuth flow
 * - Teams integration OAuth flow
 * - Sentry configuration flow
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { server } from "../../src/api/app.js";
import type { FastifyInstance } from "fastify";

describe("Integrations OAuth Routes", () => {
  beforeAll(async () => {
    await server.ready();
  });

  afterAll(async () => {
    // Server is managed by app.js
  });

  // ============================================
  // GitHub Integration OAuth
  // ============================================

  describe("GitHub Integration OAuth", () => {
    it("should redirect to login when not authenticated", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/github/connect",
      });

      // Without auth, should redirect to login
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("/login");
    });

    it("should handle callback without code parameter", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/github/callback?state=invalid",
      });

      // Should redirect with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("error=");
    });

    it("should handle callback with invalid state", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/github/callback?code=test&state=invalid-state",
      });

      // Should redirect with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("error=");
    });

    it("should handle callback with OAuth error", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/github/callback?error=access_denied&error_description=User%20denied%20access",
      });

      // Should redirect with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("error=");
    });
  });

  // ============================================
  // Slack Integration OAuth
  // ============================================

  describe("Slack Integration OAuth", () => {
    it("should redirect to login when not authenticated", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/slack/connect",
      });

      // Without auth, should redirect to login
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("/login");
    });

    it("should handle callback without code parameter", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/slack/callback?state=invalid",
      });

      // Should redirect with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("error=");
    });

    it("should handle callback with invalid state", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/slack/callback?code=test&state=invalid-state",
      });

      // Should redirect with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("error=");
    });

    it("should handle callback with OAuth error", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/slack/callback?error=access_denied",
      });

      // Should redirect with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("error=");
    });
  });

  // ============================================
  // Jira Integration OAuth
  // ============================================

  describe("Jira Integration OAuth", () => {
    it("should redirect to login when not authenticated", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/jira/connect",
      });

      // Without auth, should redirect to login
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("/login");
    });

    it("should handle callback without code parameter", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/jira/callback?state=invalid",
      });

      // Should redirect with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("error=");
    });

    it("should handle callback with invalid state", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/jira/callback?code=test&state=invalid-state",
      });

      // Should redirect with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("error=");
    });

    it("should handle callback with OAuth error", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/jira/callback?error=access_denied",
      });

      // Should redirect with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("error=");
    });
  });

  // ============================================
  // Teams Integration OAuth
  // ============================================

  describe("Teams Integration OAuth", () => {
    it("should redirect to login when not authenticated", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/teams/connect",
      });

      // Without auth, should redirect to login
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("/login");
    });

    it("should handle callback without code parameter", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/teams/callback?state=invalid",
      });

      // Should redirect with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("error=");
    });

    it("should handle callback with invalid state", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/teams/callback?code=test&state=invalid-state",
      });

      // Should redirect with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("error=");
    });

    it("should handle callback with OAuth error", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations/teams/callback?error=access_denied",
      });

      // Should redirect with error
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain("error=");
    });
  });

  // ============================================
  // Sentry Integration (Config-based, not OAuth)
  // ============================================

  describe("Sentry Integration", () => {
    it("should reject unauthenticated Sentry config", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/integrations/sentry/configure",
        payload: {
          projectSlug: "test-project",
          organizationSlug: "test-org",
        },
      });

      // Without auth, should return 401
      expect(response.statusCode).toBe(401);
    });
  });

  // ============================================
  // Integration Management Routes
  // ============================================

  describe("Integration Management", () => {
    it("should reject unauthenticated listing of integrations", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/integrations",
      });

      // Without auth, should return 401
      expect(response.statusCode).toBe(401);
    });

    it("should reject unauthenticated disconnect request", async () => {
      const response = await server.inject({
        method: "DELETE",
        url: "/api/integrations/test-id",
      });

      // Without auth, should return 401
      expect(response.statusCode).toBe(401);
    });
  });
});
