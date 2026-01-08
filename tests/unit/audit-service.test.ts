/**
 * Audit Service Tests
 *
 * Tests for the audit logging service used for SOC2 compliance.
 * Validates that all audit functions correctly write to the database.
 *
 * @module tests/unit/audit-service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AuditLogEntry } from "../../src/services/audit.js";

// Mock the database client - must use inline function for hoisting
vi.mock("../../src/db/client.js", () => ({
  query: vi.fn(),
}));

// Mock the logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks are set up
import { query } from "../../src/db/client.js";
import { logger } from "../../src/utils/logger.js";
import {
  logAuditEvent,
  logLogin,
  logLoginFailed,
  logLogout,
  logSignup,
  logOrgCreated,
  logRoleChange,
  logUserSuspend,
  logOrgSuspend,
  logIntegrationConnect,
  logIntegrationDisconnect,
  logAdminAccess,
  logSettingsUpdate,
  logExportRequest,
  logSecretRotation,
  logUserInvite,
  logUserRemove,
  logPasswordChange,
  logOrgDelete,
  logPlanChange,
  logAccountDeletion,
  auditService,
} from "../../src/services/audit.js";

// Get mocked function references
const mockQuery = vi.mocked(query);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockLogger = logger as any;

describe("AuditService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({
      rows: [],
      rowCount: 0,
      command: "",
      oid: 0,
      fields: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // Core logAuditEvent
  // ==========================================
  describe("logAuditEvent", () => {
    it("should insert audit log entry with all fields", async () => {
      const entry: AuditLogEntry = {
        actorId: "user-123",
        actorType: "user",
        action: "user.login",
        resourceType: "user",
        resourceId: "user-123",
        details: { method: "password" },
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        orgId: "org-456",
      };

      await logAuditEvent(entry);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO audit_logs"),
        [
          "user-123", // actorId
          "user", // actorType
          "user.login", // action
          "user", // resourceType
          "user-123", // resourceId
          JSON.stringify({ method: "password" }), // details
          "192.168.1.1", // ipAddress
          "Mozilla/5.0", // userAgent
          "org-456", // orgId
        ]
      );
    });

    it("should handle null details", async () => {
      const entry: AuditLogEntry = {
        actorId: "user-123",
        actorType: "user",
        action: "user.logout",
        resourceType: "user",
        resourceId: "user-123",
      };

      await logAuditEvent(entry);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO audit_logs"),
        expect.arrayContaining([null]) // details should be null
      );
    });

    it("should log error but not throw on database failure", async () => {
      mockQuery.mockRejectedValue(new Error("Database connection failed"));

      const entry: AuditLogEntry = {
        actorId: "user-123",
        actorType: "user",
        action: "user.login",
        resourceType: "user",
        resourceId: "user-123",
      };

      // Should not throw
      await expect(logAuditEvent(entry)).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        "Failed to write audit log"
      );
    });
  });

  // ==========================================
  // Authentication Events
  // ==========================================
  describe("Authentication Events", () => {
    describe("logLogin", () => {
      it("should log successful login with all parameters", async () => {
        await logLogin("user-123", "org-456", "192.168.1.1", "Mozilla/5.0", {
          method: "oauth",
        });

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[0]).toBe("user-123"); // actorId
        expect(params[2]).toBe("user.login"); // action
        expect(params[8]).toBe("org-456"); // orgId
        expect(JSON.parse(params[5] as string)).toEqual({ method: "oauth" });
      });

      it("should default to password method when not specified", async () => {
        await logLogin("user-123", "org-456");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(JSON.parse(params[5] as string)).toEqual({ method: "password" });
      });
    });

    describe("logLoginFailed", () => {
      it("should log failed login attempt", async () => {
        await logLoginFailed(
          "test@example.com",
          "192.168.1.1",
          "Mozilla/5.0",
          "invalid_password"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[0]).toBeNull(); // actorId is null for failed login
        expect(params[2]).toBe("user.login.failed"); // action
        expect(JSON.parse(params[5] as string)).toEqual({
          email: "test@example.com",
          reason: "invalid_password",
        });
      });

      it("should default reason to invalid_credentials", async () => {
        await logLoginFailed("test@example.com");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(JSON.parse(params[5] as string)).toEqual({
          email: "test@example.com",
          reason: "invalid_credentials",
        });
      });
    });

    describe("logLogout", () => {
      it("should log single device logout", async () => {
        await logLogout("user-123", "org-456", "192.168.1.1");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("user.logout");
      });

      it("should log all devices logout", async () => {
        await logLogout(
          "user-123",
          "org-456",
          "192.168.1.1",
          "Mozilla/5.0",
          true
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("user.logout.all");
      });
    });

    describe("logSignup", () => {
      it("should log new user signup", async () => {
        await logSignup(
          "user-123",
          "org-456",
          "test@example.com",
          "192.168.1.1",
          "Mozilla/5.0"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("user.signup");
        expect(JSON.parse(params[5] as string)).toEqual({
          email: "test@example.com",
        });
      });
    });
  });

  // ==========================================
  // User Management Events
  // ==========================================
  describe("User Management Events", () => {
    describe("logUserInvite", () => {
      it("should log user invitation", async () => {
        await logUserInvite(
          "admin-123",
          "newuser@example.com",
          "member",
          "org-456",
          "192.168.1.1"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[0]).toBe("admin-123"); // actorId
        expect(params[2]).toBe("user.invite"); // action
        expect(params[4]).toBeNull(); // resourceId is null for invites
        expect(JSON.parse(params[5] as string)).toEqual({
          email: "newuser@example.com",
          role: "member",
        });
      });
    });

    describe("logUserRemove", () => {
      it("should log user removal from organization", async () => {
        await logUserRemove(
          "admin-123",
          "user-456",
          "removed@example.com",
          "org-789",
          "192.168.1.1"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[0]).toBe("admin-123"); // actorId
        expect(params[2]).toBe("user.remove"); // action
        expect(params[4]).toBe("user-456"); // resourceId (target user)
        expect(JSON.parse(params[5] as string)).toEqual({
          email: "removed@example.com",
        });
      });
    });

    describe("logRoleChange", () => {
      it("should log user role change", async () => {
        await logRoleChange(
          "admin-123",
          "user-456",
          "org-789",
          "member",
          "admin",
          "192.168.1.1"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("user.role.change");
        expect(JSON.parse(params[5] as string)).toEqual({
          oldRole: "member",
          newRole: "admin",
        });
      });
    });

    describe("logUserSuspend", () => {
      it("should log user suspension", async () => {
        await logUserSuspend(
          "admin-123",
          "user-456",
          "org-789",
          "Policy violation",
          "192.168.1.1"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("user.suspend");
        expect(JSON.parse(params[5] as string)).toEqual({
          reason: "Policy violation",
        });
      });
    });

    describe("logPasswordChange", () => {
      it("should log password change", async () => {
        await logPasswordChange(
          "user-123",
          "org-456",
          "192.168.1.1",
          "Mozilla/5.0"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("user.password.change");
        expect(params[0]).toBe("user-123"); // actorId is the user themselves
        expect(params[4]).toBe("user-123"); // resourceId is also the user
      });
    });

    describe("logAccountDeletion", () => {
      it("should log self-initiated account deletion", async () => {
        await logAccountDeletion(
          "user-123",
          "org-456",
          "user@example.com",
          "192.168.1.1",
          "Mozilla/5.0"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("user.suspend"); // Uses suspend action
        expect(JSON.parse(params[5] as string)).toEqual({
          email: "user@example.com",
          reason: "self_deletion",
        });
      });
    });
  });

  // ==========================================
  // Organization Events
  // ==========================================
  describe("Organization Events", () => {
    describe("logOrgCreated", () => {
      it("should log organization creation", async () => {
        await logOrgCreated("user-123", "org-456", "My Org", "192.168.1.1");

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("organization.created");
        expect(JSON.parse(params[5] as string)).toEqual({ name: "My Org" });
      });
    });

    describe("logOrgSuspend", () => {
      it("should log organization suspension", async () => {
        await logOrgSuspend(
          "admin-123",
          "org-456",
          "Payment failed",
          "192.168.1.1"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("organization.suspend");
        expect(JSON.parse(params[5] as string)).toEqual({
          reason: "Payment failed",
        });
      });
    });

    describe("logOrgDelete", () => {
      it("should log organization deletion", async () => {
        await logOrgDelete(
          "admin-123",
          "org-456",
          "Deleted Org",
          "192.168.1.1"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("organization.deleted");
        expect(JSON.parse(params[5] as string)).toEqual({
          name: "Deleted Org",
        });
      });
    });

    describe("logPlanChange", () => {
      it("should log organization plan change", async () => {
        await logPlanChange(
          "admin-123",
          "org-456",
          "free",
          "pro",
          "192.168.1.1"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("organization.plan.change");
        expect(JSON.parse(params[5] as string)).toEqual({
          oldPlan: "free",
          newPlan: "pro",
        });
      });
    });
  });

  // ==========================================
  // Integration Events
  // ==========================================
  describe("Integration Events", () => {
    describe("logIntegrationConnect", () => {
      it("should log integration connection", async () => {
        await logIntegrationConnect(
          "user-123",
          "org-456",
          "github",
          "int-789",
          "192.168.1.1"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("integration.oauth.connect");
        expect(params[4]).toBe("int-789"); // integrationId
        expect(JSON.parse(params[5] as string)).toEqual({ type: "github" });
      });
    });

    describe("logIntegrationDisconnect", () => {
      it("should log integration disconnection", async () => {
        await logIntegrationDisconnect(
          "user-123",
          "org-456",
          "slack",
          "int-789",
          "192.168.1.1"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("integration.oauth.disconnect");
        expect(params[4]).toBe("int-789"); // integrationId
        expect(JSON.parse(params[5] as string)).toEqual({ type: "slack" });
      });
    });
  });

  // ==========================================
  // Admin & Settings Events
  // ==========================================
  describe("Admin & Settings Events", () => {
    describe("logAdminAccess", () => {
      it("should log admin panel access", async () => {
        await logAdminAccess(
          "admin-123",
          "user_management",
          "192.168.1.1",
          "Mozilla/5.0"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("admin.access");
        expect(JSON.parse(params[5] as string)).toEqual({
          context: "user_management",
        });
      });
    });

    describe("logSettingsUpdate", () => {
      it("should log settings update", async () => {
        const changes = { theme: "dark", notifications: true };
        await logSettingsUpdate(
          "user-123",
          "org-456",
          "organization",
          changes,
          "192.168.1.1"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("settings.updated");
        expect(JSON.parse(params[5] as string)).toEqual({
          settingType: "organization",
          changes: { theme: "dark", notifications: true },
        });
      });
    });

    describe("logExportRequest", () => {
      it("should log export request", async () => {
        await logExportRequest(
          "user-123",
          "org-456",
          "audit_logs",
          "csv",
          "192.168.1.1"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("export.requested");
        expect(JSON.parse(params[5] as string)).toEqual({
          exportType: "audit_logs",
          format: "csv",
        });
      });
    });

    describe("logSecretRotation", () => {
      it("should log secret rotation", async () => {
        await logSecretRotation(
          "admin-123",
          "api_key",
          "Scheduled rotation",
          "192.168.1.1"
        );

        expect(mockQuery).toHaveBeenCalledTimes(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [, params] = mockQuery.mock.calls[0] as [string, any[]];
        expect(params[2]).toBe("secret.rotated");
        expect(params[4]).toBe("api_key"); // secretName as resourceId
        expect(JSON.parse(params[5] as string)).toEqual({
          reason: "Scheduled rotation",
        });
      });
    });
  });

  // ==========================================
  // auditService Object Export
  // ==========================================
  describe("auditService Export", () => {
    it("should export all audit functions", () => {
      expect(auditService).toHaveProperty("logAuditEvent");
      expect(auditService).toHaveProperty("logLogin");
      expect(auditService).toHaveProperty("logLoginFailed");
      expect(auditService).toHaveProperty("logLogout");
      expect(auditService).toHaveProperty("logSignup");
      expect(auditService).toHaveProperty("logOrgCreated");
      expect(auditService).toHaveProperty("logRoleChange");
      expect(auditService).toHaveProperty("logUserSuspend");
      expect(auditService).toHaveProperty("logOrgSuspend");
      expect(auditService).toHaveProperty("logIntegrationConnect");
      expect(auditService).toHaveProperty("logIntegrationDisconnect");
      expect(auditService).toHaveProperty("logAdminAccess");
      expect(auditService).toHaveProperty("logSettingsUpdate");
      expect(auditService).toHaveProperty("logExportRequest");
      expect(auditService).toHaveProperty("logSecretRotation");
      expect(auditService).toHaveProperty("logUserInvite");
      expect(auditService).toHaveProperty("logUserRemove");
      expect(auditService).toHaveProperty("logPasswordChange");
      expect(auditService).toHaveProperty("logOrgDelete");
      expect(auditService).toHaveProperty("logPlanChange");
      expect(auditService).toHaveProperty("logAccountDeletion");
    });

    it("should have callable functions", () => {
      expect(typeof auditService.logLogin).toBe("function");
      expect(typeof auditService.logUserInvite).toBe("function");
      expect(typeof auditService.logPlanChange).toBe("function");
    });
  });
});
