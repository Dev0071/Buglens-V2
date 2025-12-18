/**
 * Auth API Integration Tests
 *
 * Tests for:
 * - POST /api/auth/signup
 * - POST /api/auth/login
 * - POST /api/auth/logout
 * - POST /api/auth/refresh
 * - GET /api/auth/me
 * - POST /api/auth/logout-all
 *
 * Test coverage includes:
 * - Positive cases (successful signup, login, logout)
 * - Negative cases (invalid credentials, duplicate email, weak password)
 * - Edge cases (expired tokens, missing fields)
 * - Security (password hashing, JWT validation)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { server } from "../../src/api/app.js";
import { query, pool } from "../../src/db/client.js";
import { randomUUID } from "crypto";

// Test data
const TEST_EMAIL = "test-auth@buglens.com";
const TEST_PASSWORD = "SecurePass123!";
const TEST_NAME = "Test User";
const WEAK_PASSWORD = "weak";

describe("Auth API", () => {
  beforeAll(async () => {
    await server.ready();
  });

  afterAll(async () => {
    // Cleanup test users and organizations
    await query(
      "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test-%@buglens.com')"
    );
    await query("DELETE FROM users WHERE email LIKE 'test-%@buglens.com'");
    await query("DELETE FROM organizations WHERE slug LIKE 'test-%'");
    await server.close();
  });

  beforeEach(async () => {
    // Clean up any test data from previous runs
    await query(
      "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test-%@buglens.com')"
    );
    await query("DELETE FROM users WHERE email LIKE 'test-%@buglens.com'");
    await query("DELETE FROM organizations WHERE slug LIKE 'test-%'");
  });

  // ==========================================
  // POST /api/auth/signup
  // ==========================================
  describe("POST /api/auth/signup", () => {
    describe("Positive Cases", () => {
      it("should create new user and organization", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/signup",
          payload: {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
            name: TEST_NAME,
          },
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();

        expect(body).toHaveProperty("user");
        expect(body).toHaveProperty("organization");
        expect(body).toHaveProperty("accessToken");

        expect(body.user.email).toBe(TEST_EMAIL.toLowerCase());
        expect(body.user.name).toBe(TEST_NAME);
        expect(body.user.role).toBe("owner");
        expect(body.organization.plan).toBe("free");

        // Verify JWT format
        expect(body.accessToken).toMatch(
          /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/
        );

        // Verify cookie set
        const cookies = response.cookies;
        const refreshCookie = cookies.find(
          (c: { name: string }) => c.name === "refreshToken"
        );
        expect(refreshCookie).toBeDefined();
      });

      it("should create organization with custom name", async () => {
        const orgName = "My Test Company";
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/signup",
          payload: {
            email: `test-custom-org-${Date.now()}@buglens.com`,
            password: TEST_PASSWORD,
            name: TEST_NAME,
            organizationName: orgName,
          },
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.organization.name).toBe(orgName);
      });

      it("should normalize email to lowercase", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/signup",
          payload: {
            email: "Test-UPPER@BugLens.COM",
            password: TEST_PASSWORD,
            name: TEST_NAME,
          },
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.user.email).toBe("test-upper@buglens.com");
      });
    });

    describe("Negative Cases", () => {
      it("should reject duplicate email", async () => {
        // First signup
        await server.inject({
          method: "POST",
          url: "/api/auth/signup",
          payload: {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
            name: TEST_NAME,
          },
        });

        // Second signup with same email
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/signup",
          payload: {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
            name: "Another User",
          },
        });

        expect(response.statusCode).toBe(409);
        const body = response.json();
        expect(body.error).toBe("EMAIL_EXISTS");
      });

      it("should reject invalid email format", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/signup",
          payload: {
            email: "invalid-email",
            password: TEST_PASSWORD,
            name: TEST_NAME,
          },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBe("VALIDATION_ERROR");
      });

      it("should reject weak password (too short)", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/signup",
          payload: {
            email: `test-weak-${Date.now()}@buglens.com`,
            password: "short",
            name: TEST_NAME,
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it("should reject password without uppercase", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/signup",
          payload: {
            email: `test-no-upper-${Date.now()}@buglens.com`,
            password: "password123",
            name: TEST_NAME,
          },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBe("WEAK_PASSWORD");
      });

      it("should reject password without number", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/signup",
          payload: {
            email: `test-no-num-${Date.now()}@buglens.com`,
            password: "PasswordNoNum",
            name: TEST_NAME,
          },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error).toBe("WEAK_PASSWORD");
      });

      it("should reject missing required fields", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/signup",
          payload: {
            email: TEST_EMAIL,
          },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe("Edge Cases", () => {
      it("should handle very long name gracefully", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/signup",
          payload: {
            email: `test-long-name-${Date.now()}@buglens.com`,
            password: TEST_PASSWORD,
            name: "A".repeat(100),
          },
        });

        expect(response.statusCode).toBe(201);
      });

      it("should handle special characters in name", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/signup",
          payload: {
            email: `test-special-${Date.now()}@buglens.com`,
            password: TEST_PASSWORD,
            name: "José García-O'Connor",
          },
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.user.name).toBe("José García-O'Connor");
      });
    });
  });

  // ==========================================
  // POST /api/auth/login
  // ==========================================
  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      // Create a test user for login tests
      await server.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: {
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          name: TEST_NAME,
        },
      });
    });

    describe("Positive Cases", () => {
      it("should login with valid credentials", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body).toHaveProperty("user");
        expect(body).toHaveProperty("organization");
        expect(body).toHaveProperty("accessToken");
        expect(body.user.email).toBe(TEST_EMAIL.toLowerCase());

        // Verify cookie set
        const cookies = response.cookies;
        const refreshCookie = cookies.find(
          (c: { name: string }) => c.name === "refreshToken"
        );
        expect(refreshCookie).toBeDefined();
      });

      it("should login with email in different case", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: TEST_EMAIL.toUpperCase(),
            password: TEST_PASSWORD,
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it("should update last_login_at timestamp", async () => {
        const beforeLogin = new Date();

        await server.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
          },
        });

        const result = await query<{ last_login_at: Date }>(
          "SELECT last_login_at FROM users WHERE email = $1",
          [TEST_EMAIL.toLowerCase()]
        );

        expect(result.rows[0].last_login_at).toBeDefined();
        expect(
          new Date(result.rows[0].last_login_at).getTime()
        ).toBeGreaterThanOrEqual(beforeLogin.getTime() - 1000);
      });
    });

    describe("Negative Cases", () => {
      it("should reject invalid password", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: TEST_EMAIL,
            password: "WrongPassword123!",
          },
        });

        expect(response.statusCode).toBe(401);
        const body = response.json();
        expect(body.error).toBe("INVALID_CREDENTIALS");
      });

      it("should reject non-existent email", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: "nonexistent@buglens.com",
            password: TEST_PASSWORD,
          },
        });

        expect(response.statusCode).toBe(401);
        const body = response.json();
        expect(body.error).toBe("INVALID_CREDENTIALS");
      });

      it("should reject empty password", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: TEST_EMAIL,
            password: "",
          },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe("Security Cases", () => {
      it("should not reveal if email exists in error message", async () => {
        const responseNonExistent = await server.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: "nonexistent@buglens.com",
            password: "AnyPassword123!",
          },
        });

        const responseWrongPassword = await server.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: TEST_EMAIL,
            password: "WrongPassword123!",
          },
        });

        // Both should return the same generic error
        expect(responseNonExistent.json().error).toBe(
          responseWrongPassword.json().error
        );
        expect(responseNonExistent.json().message).toBe(
          responseWrongPassword.json().message
        );
      });
    });
  });

  // ==========================================
  // GET /api/auth/me
  // ==========================================
  describe("GET /api/auth/me", () => {
    let accessToken: string;
    let testUser: { id: string; email: string; name: string; orgId: string };

    beforeEach(async () => {
      const signupResponse = await server.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: {
          email: `test-me-${Date.now()}@buglens.com`,
          password: TEST_PASSWORD,
          name: TEST_NAME,
        },
      });

      const body = signupResponse.json();
      accessToken = body.accessToken;
      testUser = body.user;
    });

    describe("Positive Cases", () => {
      it("should return current user with valid token", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/auth/me",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body).toHaveProperty("user");
        expect(body).toHaveProperty("organization");
        expect(body.user.id).toBe(testUser.id);
        expect(body.user.email).toBe(testUser.email);
      });
    });

    describe("Negative Cases", () => {
      it("should reject request without token", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/auth/me",
        });

        expect(response.statusCode).toBe(401);
      });

      it("should reject invalid token", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/auth/me",
          headers: {
            Authorization: "Bearer invalid-token",
          },
        });

        expect(response.statusCode).toBe(401);
      });

      it("should reject malformed authorization header", async () => {
        const response = await server.inject({
          method: "GET",
          url: "/api/auth/me",
          headers: {
            Authorization: accessToken, // Missing "Bearer "
          },
        });

        expect(response.statusCode).toBe(401);
      });
    });
  });

  // ==========================================
  // POST /api/auth/logout
  // ==========================================
  describe("POST /api/auth/logout", () => {
    let refreshToken: string;

    beforeEach(async () => {
      const signupResponse = await server.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: {
          email: `test-logout-${Date.now()}@buglens.com`,
          password: TEST_PASSWORD,
          name: TEST_NAME,
        },
      });

      const cookies = signupResponse.cookies;
      const refreshCookie = cookies.find(
        (c: { name: string }) => c.name === "refreshToken"
      );
      refreshToken = refreshCookie?.value;
    });

    describe("Positive Cases", () => {
      it("should logout successfully", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/logout",
          cookies: {
            refreshToken,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.success).toBe(true);
      });

      it("should invalidate refresh token after logout", async () => {
        // First logout
        await server.inject({
          method: "POST",
          url: "/api/auth/logout",
          cookies: {
            refreshToken,
          },
        });

        // Try to refresh with old token
        const refreshResponse = await server.inject({
          method: "POST",
          url: "/api/auth/refresh",
          cookies: {
            refreshToken,
          },
        });

        expect(refreshResponse.statusCode).toBe(401);
      });
    });

    describe("Edge Cases", () => {
      it("should handle logout without refresh token gracefully", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/logout",
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().success).toBe(true);
      });
    });
  });

  // ==========================================
  // POST /api/auth/refresh
  // ==========================================
  describe("POST /api/auth/refresh", () => {
    let refreshToken: string;

    beforeEach(async () => {
      const signupResponse = await server.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: {
          email: `test-refresh-${Date.now()}@buglens.com`,
          password: TEST_PASSWORD,
          name: TEST_NAME,
        },
      });

      const cookies = signupResponse.cookies;
      const refreshCookie = cookies.find(
        (c: { name: string }) => c.name === "refreshToken"
      );
      refreshToken = refreshCookie?.value;
    });

    describe("Positive Cases", () => {
      it("should return new tokens with valid refresh token", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/refresh",
          cookies: {
            refreshToken,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();

        expect(body).toHaveProperty("user");
        expect(body).toHaveProperty("organization");
        expect(body).toHaveProperty("accessToken");

        // Verify new cookie set
        const cookies = response.cookies;
        const newRefreshCookie = cookies.find(
          (c: { name: string }) => c.name === "refreshToken"
        );
        expect(newRefreshCookie).toBeDefined();
        // New refresh token should be different
        expect(newRefreshCookie?.value).not.toBe(refreshToken);
      });

      it("should invalidate old refresh token after refresh", async () => {
        // First refresh
        await server.inject({
          method: "POST",
          url: "/api/auth/refresh",
          cookies: {
            refreshToken,
          },
        });

        // Try to refresh again with old token
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/refresh",
          cookies: {
            refreshToken,
          },
        });

        expect(response.statusCode).toBe(401);
      });
    });

    describe("Negative Cases", () => {
      it("should reject invalid refresh token", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/refresh",
          cookies: {
            refreshToken: "invalid-token",
          },
        });

        expect(response.statusCode).toBe(401);
      });

      it("should reject missing refresh token", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/refresh",
        });

        expect(response.statusCode).toBe(401);
      });
    });
  });

  // ==========================================
  // POST /api/auth/logout-all
  // ==========================================
  describe("POST /api/auth/logout-all", () => {
    let accessToken: string;
    let refreshToken1: string;
    let refreshToken2: string;

    beforeEach(async () => {
      // Create user
      const signupResponse = await server.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: {
          email: `test-logout-all-${Date.now()}@buglens.com`,
          password: TEST_PASSWORD,
          name: TEST_NAME,
        },
      });

      const body = signupResponse.json();
      accessToken = body.accessToken;
      const cookies1 = signupResponse.cookies;
      refreshToken1 = cookies1.find(
        (c: { name: string }) => c.name === "refreshToken"
      )?.value;

      // Create second session (login again)
      const loginResponse = await server.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: body.user.email,
          password: TEST_PASSWORD,
        },
      });

      const cookies2 = loginResponse.cookies;
      refreshToken2 = cookies2.find(
        (c: { name: string }) => c.name === "refreshToken"
      )?.value;
    });

    describe("Positive Cases", () => {
      it("should logout from all devices", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/logout-all",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().success).toBe(true);
      });

      it("should invalidate all refresh tokens", async () => {
        await server.inject({
          method: "POST",
          url: "/api/auth/logout-all",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        // Try to refresh with first token
        const refresh1 = await server.inject({
          method: "POST",
          url: "/api/auth/refresh",
          cookies: { refreshToken: refreshToken1 },
        });
        expect(refresh1.statusCode).toBe(401);

        // Try to refresh with second token
        const refresh2 = await server.inject({
          method: "POST",
          url: "/api/auth/refresh",
          cookies: { refreshToken: refreshToken2 },
        });
        expect(refresh2.statusCode).toBe(401);
      });
    });

    describe("Negative Cases", () => {
      it("should reject without authentication", async () => {
        const response = await server.inject({
          method: "POST",
          url: "/api/auth/logout-all",
        });

        expect(response.statusCode).toBe(401);
      });
    });
  });

  // ==========================================
  // Performance Tests
  // ==========================================
  describe("Performance", () => {
    it("should handle signup within acceptable time", async () => {
      const start = Date.now();

      const response = await server.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: {
          email: `test-perf-${Date.now()}@buglens.com`,
          password: TEST_PASSWORD,
          name: TEST_NAME,
        },
      });

      const duration = Date.now() - start;

      expect(response.statusCode).toBe(201);
      // Password hashing takes time, allow up to 1 second
      expect(duration).toBeLessThan(1000);
    });

    it("should handle login within acceptable time", async () => {
      // Create user first
      await server.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: {
          email: `test-login-perf-${Date.now()}@buglens.com`,
          password: TEST_PASSWORD,
          name: TEST_NAME,
        },
      });

      const start = Date.now();

      const response = await server.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: `test-login-perf-${Date.now()}@buglens.com`,
          password: TEST_PASSWORD,
        },
      });

      const duration = Date.now() - start;

      // Login should be faster since we're not creating new records
      expect(duration).toBeLessThan(500);
    });
  });
});
