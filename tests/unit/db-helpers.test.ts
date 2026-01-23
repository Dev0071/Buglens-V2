/**
 * Database Helpers Unit Tests
 *
 * Tests for SQL injection protection, multi-tenant query helpers,
 * and identifier validation in db-helpers.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database client before importing db-helpers
vi.mock("../../src/db/client.js", () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  queryWithOrg,
  findById,
  findAll,
  findPaginated,
  existsInOrg,
  countForOrg,
  insertWithOrg,
  updateInOrg,
  deleteFromOrg,
  requireOrgId,
  validateOrgOwnership,
  _addAllowedTable,
  _isTableAllowed,
} from "../../src/utils/db-helpers.js";
import { query } from "../../src/db/client.js";

const mockedQuery = vi.mocked(query);

describe("db-helpers", () => {
  const testOrgId = "org_12345";
  const testRecordId = "rec_67890";

  beforeEach(() => {
    mockedQuery.mockReset();
  });

  // ============================================
  // SQL Injection Protection Tests
  // ============================================
  describe("SQL Injection Protection", () => {
    describe("Table Name Validation", () => {
      it("should reject table names with SQL injection attempts", async () => {
        const maliciousNames = [
          "users; DROP TABLE users;--",
          "users' OR '1'='1",
          "users; DELETE FROM users;",
          "users UNION SELECT * FROM passwords",
          "users--",
          "users/*",
          "users\n",
          "users\t",
          "users;",
        ];

        for (const tableName of maliciousNames) {
          await expect(
            findById(tableName, testOrgId, testRecordId)
          ).rejects.toThrow(/Invalid|not in the allowed/);
        }
      });

      it("should reject tables not in allowlist", async () => {
        await expect(
          findById("unknown_table", testOrgId, testRecordId)
        ).rejects.toThrow("not in the allowed tables list");
      });

      it("should accept valid table names from allowlist", async () => {
        mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

        const result = await findById("events", testOrgId, testRecordId);
        expect(result).toBeNull();
        expect(mockedQuery).toHaveBeenCalled();
      });
    });

    describe("Column Name Validation", () => {
      it("should reject column names with SQL injection", async () => {
        const maliciousColumns = [
          "id; DROP TABLE users;",
          "id' OR '1'='1",
          "id--",
          "id/*comment*/",
          "1=1",
          "id, password FROM users WHERE '1'='1",
        ];

        for (const columnName of maliciousColumns) {
          await expect(
            findById("events", testOrgId, testRecordId, columnName)
          ).rejects.toThrow(/Invalid column name|disallowed characters/);
        }
      });

      it("should accept valid column names", async () => {
        mockedQuery.mockResolvedValueOnce({
          rows: [{ id: "123" }],
          rowCount: 1,
        } as never);

        const result = await findById(
          "events",
          testOrgId,
          testRecordId,
          "id, name, created_at"
        );
        expect(result).toEqual({ id: "123" });
      });
    });

    describe("ORDER BY Validation", () => {
      it("should reject malicious ORDER BY clauses", async () => {
        const maliciousOrderBy = [
          "created_at; DROP TABLE users;",
          "CASE WHEN (1=1) THEN name ELSE id END",
          "(SELECT password FROM users LIMIT 1)",
          "1--",
          "created_at; --",
        ];

        for (const orderBy of maliciousOrderBy) {
          mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

          await expect(
            findAll("events", testOrgId, { orderBy })
          ).rejects.toThrow(/Invalid ORDER BY/);
        }
      });

      it("should accept valid ORDER BY clauses", async () => {
        mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

        await findAll("events", testOrgId, { orderBy: "created_at DESC" });
        expect(mockedQuery).toHaveBeenCalled();
      });

      it("should accept multi-column ORDER BY", async () => {
        mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

        await findAll("events", testOrgId, {
          orderBy: "created_at DESC, name ASC, id",
        });
        expect(mockedQuery).toHaveBeenCalled();
      });
    });
  });

  // ============================================
  // Query Helper Tests
  // ============================================
  describe("queryWithOrg", () => {
    it("should prepend org_id to params", async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      await queryWithOrg("SELECT * FROM events WHERE org_id = $1", testOrgId);
      expect(mockedQuery).toHaveBeenCalledWith(
        "SELECT * FROM events WHERE org_id = $1",
        [testOrgId]
      );
    });

    it("should handle additional params", async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      await queryWithOrg(
        "SELECT * FROM events WHERE org_id = $1 AND status = $2",
        testOrgId,
        ["active"]
      );
      expect(mockedQuery).toHaveBeenCalledWith(
        "SELECT * FROM events WHERE org_id = $1 AND status = $2",
        [testOrgId, "active"]
      );
    });
  });

  describe("findById", () => {
    it("should return record when found", async () => {
      const mockRecord = { id: testRecordId, name: "Test Event" };
      mockedQuery.mockResolvedValueOnce({
        rows: [mockRecord],
        rowCount: 1,
      } as never);

      const result = await findById("events", testOrgId, testRecordId);
      expect(result).toEqual(mockRecord);
    });

    it("should return null when not found", async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const result = await findById("events", testOrgId, testRecordId);
      expect(result).toBeNull();
    });

    it("should use org_id in WHERE clause", async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      await findById("events", testOrgId, testRecordId);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE org_id = $1 AND id = $2"),
        [testOrgId, testRecordId]
      );
    });
  });

  describe("findAll", () => {
    it("should return all records for org", async () => {
      const mockRecords = [
        { id: "1", name: "Event 1" },
        { id: "2", name: "Event 2" },
      ];
      mockedQuery.mockResolvedValueOnce({
        rows: mockRecords,
        rowCount: 2,
      } as never);

      const result = await findAll("events", testOrgId);
      expect(result).toEqual(mockRecords);
    });

    it("should apply WHERE conditions", async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      await findAll("events", testOrgId, {
        where: "status = $2",
        params: ["active"],
      });

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("AND status = $2"),
        [testOrgId, "active"]
      );
    });

    it("should apply ORDER BY when provided", async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      await findAll("events", testOrgId, { orderBy: "created_at DESC" });

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY created_at DESC"),
        [testOrgId]
      );
    });
  });

  describe("findPaginated", () => {
    it("should return paginated results", async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: "100" }],
          rowCount: 1,
        } as never)
        .mockResolvedValueOnce({
          rows: [{ id: "1" }, { id: "2" }],
          rowCount: 2,
        } as never);

      const result = await findPaginated("events", testOrgId, {
        page: 2,
        limit: 10,
      });

      expect(result.data).toHaveLength(2);
      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 100,
        totalPages: 10,
      });
    });

    it("should use default pagination values", async () => {
      mockedQuery
        .mockResolvedValueOnce({
          rows: [{ count: "50" }],
          rowCount: 1,
        } as never)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const result = await findPaginated("events", testOrgId);

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });
  });

  describe("existsInOrg", () => {
    it("should return true when record exists", async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ exists: true }],
        rowCount: 1,
      } as never);

      const result = await existsInOrg("events", testOrgId, testRecordId);
      expect(result).toBe(true);
    });

    it("should return false when record does not exist", async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ exists: false }],
        rowCount: 1,
      } as never);

      const result = await existsInOrg("events", testOrgId, testRecordId);
      expect(result).toBe(false);
    });
  });

  describe("countForOrg", () => {
    it("should return count for org", async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ count: "42" }],
        rowCount: 1,
      } as never);

      const result = await countForOrg("events", testOrgId);
      expect(result).toBe(42);
    });

    it("should apply WHERE conditions", async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ count: "10" }],
        rowCount: 1,
      } as never);

      await countForOrg("events", testOrgId, "status = $2", ["active"]);

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("AND status = $2"),
        [testOrgId, "active"]
      );
    });
  });

  // ============================================
  // Mutation Helper Tests
  // ============================================
  describe("insertWithOrg", () => {
    it("should insert record with org_id", async () => {
      const mockInserted = { id: "new_123", name: "Test", org_id: testOrgId };
      mockedQuery.mockResolvedValueOnce({
        rows: [mockInserted],
        rowCount: 1,
      } as never);

      const result = await insertWithOrg("events", testOrgId, { name: "Test" });
      expect(result).toEqual(mockInserted);
    });

    it("should reject invalid column names in data", async () => {
      await expect(
        insertWithOrg("events", testOrgId, { "bad;column": "value" })
      ).rejects.toThrow(/Invalid column name|disallowed characters/);
    });
  });

  describe("updateInOrg", () => {
    it("should update record with updated_at by default", async () => {
      const mockUpdated = { id: testRecordId, name: "Updated" };
      mockedQuery.mockResolvedValueOnce({
        rows: [mockUpdated],
        rowCount: 1,
      } as never);

      const result = await updateInOrg("events", testOrgId, testRecordId, {
        name: "Updated",
      });

      expect(result).toEqual(mockUpdated);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("updated_at = NOW()"),
        expect.any(Array)
      );
    });

    it("should skip updated_at when setUpdatedAt is false", async () => {
      const mockUpdated = { id: testRecordId, viewed: true };
      mockedQuery.mockResolvedValueOnce({
        rows: [mockUpdated],
        rowCount: 1,
      } as never);

      await updateInOrg(
        "audit_logs",
        testOrgId,
        testRecordId,
        { viewed: true },
        { setUpdatedAt: false }
      );

      expect(mockedQuery).toHaveBeenCalledWith(
        expect.not.stringContaining("updated_at = NOW()"),
        expect.any(Array)
      );
    });

    it("should return null when record not found", async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const result = await updateInOrg("events", testOrgId, testRecordId, {
        name: "Updated",
      });
      expect(result).toBeNull();
    });
  });

  describe("deleteFromOrg", () => {
    it("should return true when deleted", async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

      const result = await deleteFromOrg("events", testOrgId, testRecordId);
      expect(result).toBe(true);
    });

    it("should return false when not found", async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

      const result = await deleteFromOrg("events", testOrgId, testRecordId);
      expect(result).toBe(false);
    });
  });

  // ============================================
  // Validation Helper Tests
  // ============================================
  describe("requireOrgId", () => {
    it("should return orgId when valid", () => {
      const result = requireOrgId(testOrgId, "events");
      expect(result).toBe(testOrgId);
    });

    it("should throw when orgId is null", () => {
      expect(() => requireOrgId(null, "events")).toThrow(
        "Organization context required"
      );
    });

    it("should throw when orgId is undefined", () => {
      expect(() => requireOrgId(undefined, "events")).toThrow(
        "Organization context required"
      );
    });

    it("should include resource name in error", () => {
      expect(() => requireOrgId(null, "events")).toThrow("events");
    });
  });

  describe("validateOrgOwnership", () => {
    it("should not throw when record exists", async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ exists: true }],
        rowCount: 1,
      } as never);

      await expect(
        validateOrgOwnership("events", testOrgId, testRecordId)
      ).resolves.not.toThrow();
    });

    it("should throw when record does not exist", async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ exists: false }],
        rowCount: 1,
      } as never);

      await expect(
        validateOrgOwnership("events", testOrgId, testRecordId)
      ).rejects.toThrow("not found or access denied");
    });

    it("should use friendly resource name in error (not table name)", async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{ exists: false }],
        rowCount: 1,
      } as never);

      await expect(
        validateOrgOwnership("events", testOrgId, testRecordId)
      ).rejects.toThrow("Event not found or access denied");
    });
  });

  // ============================================
  // Internal Utility Tests
  // ============================================
  describe("_isTableAllowed", () => {
    it("should return true for allowed tables", () => {
      expect(_isTableAllowed("events")).toBe(true);
      expect(_isTableAllowed("users")).toBe(true);
      expect(_isTableAllowed("organizations")).toBe(true);
    });

    it("should return false for unknown tables", () => {
      expect(_isTableAllowed("hacked_table")).toBe(false);
    });
  });

  describe("_addAllowedTable", () => {
    it("should add valid table to allowlist", () => {
      _addAllowedTable("test_custom_table");
      expect(_isTableAllowed("test_custom_table")).toBe(true);
    });

    it("should reject invalid table names", () => {
      expect(() => _addAllowedTable("bad;table")).toThrow(/Invalid table name/);
    });
  });
});
