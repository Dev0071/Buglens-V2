/**
 * Database Query Helpers
 *
 * Standardized database query utilities for multi-tenant queries.
 * Eliminates duplicate org_id patterns across 107+ query locations.
 *
 * Key benefits:
 * - Consistent org_id handling across all queries
 * - Type-safe query builders
 * - Automatic pagination support
 * - Built-in logging and error handling
 * - SQL injection protection via identifier validation
 *
 * SECURITY: All table names, column names, and identifiers are validated
 * against strict patterns to prevent SQL injection attacks.
 *
 * Usage:
 *   import { queryWithOrg, findById, findAll } from '../utils/db-helpers.js';
 *
 *   // Instead of: query("SELECT * FROM events WHERE org_id = $1 AND id = $2", [orgId, id])
 *   const event = await findById<Event>('events', orgId, id);
 */

import type pg from "pg";
import { query, transaction } from "../db/client.js";
import { logger } from "./logger.js";

// ============================================
// Security: SQL Identifier Validation
// ============================================

/**
 * Valid SQL identifier pattern (alphanumeric and underscores only)
 * Prevents SQL injection through table/column names
 */
const VALID_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Allowed table names (whitelist for additional security)
 * Add new tables here as they are created
 */
const ALLOWED_TABLES = new Set([
  "organizations",
  "users",
  "events",
  "rca_jobs",
  "rca_results",
  "repos",
  "code_snapshots",
  "integrations",
  "cost_metrics",
  "audit_logs",
  "user_identities",
]);

/**
 * Mapping of table names to user-friendly resource names
 * Used for error messages to avoid exposing internal schema
 */
const TABLE_TO_RESOURCE: Record<string, string> = {
  organizations: "Organization",
  users: "User",
  events: "Event",
  rca_jobs: "RCA Job",
  rca_results: "RCA Result",
  repos: "Repository",
  code_snapshots: "Code Snapshot",
  integrations: "Integration",
  cost_metrics: "Cost Metric",
  audit_logs: "Audit Log",
  user_identities: "User Identity",
};

/**
 * Get user-friendly resource name from table name
 */
function getResourceName(table: string): string {
  return TABLE_TO_RESOURCE[table] || "Resource";
}

/**
 * Validate a SQL identifier (table name, column name)
 * @throws Error if identifier is invalid
 */
function validateIdentifier(
  identifier: string,
  type: "table" | "column"
): void {
  if (!VALID_IDENTIFIER_PATTERN.test(identifier)) {
    logger.error({ identifier, type }, "Invalid SQL identifier detected");
    throw new Error(`Invalid ${type} name: contains disallowed characters`);
  }
}

/**
 * Validate table name against whitelist
 * @throws Error if table is not in allowed list
 */
function validateTableName(table: string): void {
  validateIdentifier(table, "table");
  if (!ALLOWED_TABLES.has(table)) {
    logger.error({ table }, "Unrecognized table name");
    throw new Error(`Table '${table}' is not in the allowed tables list`);
  }
}

/**
 * Validate multiple column names
 * @throws Error if any column is invalid
 */
function validateColumnNames(columns: string[]): void {
  for (const col of columns) {
    validateIdentifier(col, "column");
  }
}

/**
 * Validate ORDER BY clause (column names only, no expressions)
 * Allows: "created_at DESC", "name ASC, id DESC"
 * @throws Error if orderBy contains invalid patterns
 */
function validateOrderBy(orderBy: string): void {
  // Split by comma for multiple columns
  const parts = orderBy.split(",").map((p) => p.trim());
  for (const part of parts) {
    // Each part should be: column_name [ASC|DESC]
    const match = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(ASC|DESC)?$/i);
    if (!match) {
      logger.error({ orderBy }, "Invalid ORDER BY clause");
      throw new Error(
        "Invalid ORDER BY clause: only column names with ASC/DESC allowed"
      );
    }
  }
}

// ============================================
// Types
// ============================================

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface QueryOptions {
  /** Additional WHERE conditions (will be ANDed with org_id) */
  where?: string;
  /** ORDER BY clause (column names only, validated for security) */
  orderBy?: string;
  /** Extra params for WHERE conditions */
  params?: unknown[];
}

export interface UpdateOptions {
  /**
   * Whether to automatically set updated_at = NOW()
   * Set to false for tables without an updated_at column
   * @default true
   */
  setUpdatedAt?: boolean;
}

// ============================================
// Core Query Functions
// ============================================

/**
 * Execute a query with org_id as the first parameter
 *
 * Ensures consistent org_id filtering for multi-tenant isolation.
 *
 * @param sql - SQL query with $1 reserved for org_id
 * @param orgId - Organization ID
 * @param params - Additional query parameters (starting from $2)
 */
export async function queryWithOrg<T extends pg.QueryResultRow>(
  sql: string,
  orgId: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  return query<T>(sql, [orgId, ...params]);
}

/**
 * Find a single record by ID within an organization
 *
 * @param table - Table name (must be in ALLOWED_TABLES)
 * @param orgId - Organization ID
 * @param id - Record ID
 * @param columns - Columns to select (default: *, validated for SQL injection)
 * @throws Error if table name is not in allowed list
 * @throws Error if column names contain invalid characters
 */
export async function findById<T extends pg.QueryResultRow>(
  table: string,
  orgId: string,
  id: string,
  columns = "*"
): Promise<T | null> {
  validateTableName(table);
  if (columns !== "*") {
    validateColumnNames(columns.split(",").map((c) => c.trim()));
  }

  const result = await query<T>(
    `SELECT ${columns} FROM ${table} WHERE org_id = $1 AND id = $2`,
    [orgId, id]
  );
  return result.rows[0] || null;
}

/**
 * Find all records for an organization with optional filtering
 *
 * @param table - Table name (must be in ALLOWED_TABLES)
 * @param orgId - Organization ID
 * @param options - Query options (where, orderBy, params)
 * @throws Error if table name is not in allowed list
 * @throws Error if orderBy contains invalid patterns
 */
export async function findAll<T extends pg.QueryResultRow>(
  table: string,
  orgId: string,
  options: QueryOptions = {}
): Promise<T[]> {
  validateTableName(table);
  const { where, orderBy, params = [] } = options;

  let sql = `SELECT * FROM ${table} WHERE org_id = $1`;
  const queryParams: unknown[] = [orgId];

  if (where) {
    sql += ` AND ${where}`;
    queryParams.push(...params);
  }

  if (orderBy) {
    validateOrderBy(orderBy);
    sql += ` ORDER BY ${orderBy}`;
  }

  const result = await query<T>(sql, queryParams);
  return result.rows;
}

/**
 * Find records with pagination
 *
 * @param table - Table name (must be in ALLOWED_TABLES)
 * @param orgId - Organization ID
 * @param pagination - Pagination parameters
 * @param options - Query options
 * @throws Error if table name is not in allowed list
 * @throws Error if orderBy contains invalid patterns
 */
export async function findPaginated<T extends pg.QueryResultRow>(
  table: string,
  orgId: string,
  pagination: PaginationParams = {},
  options: QueryOptions = {}
): Promise<PaginatedResult<T>> {
  validateTableName(table);
  const { page = 1, limit = 20 } = pagination;
  const { where, orderBy = "created_at DESC", params = [] } = options;
  const offset = (page - 1) * limit;

  validateOrderBy(orderBy);

  // Build WHERE clause
  let whereClause = "org_id = $1";
  const queryParams: unknown[] = [orgId];

  if (where) {
    whereClause += ` AND ${where}`;
    queryParams.push(...params);
  }

  // Get total count
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) FROM ${table} WHERE ${whereClause}`,
    queryParams
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Get paginated data
  const dataResult = await query<T>(
    `SELECT * FROM ${table} WHERE ${whereClause} ORDER BY ${orderBy} LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`,
    [...queryParams, limit, offset]
  );

  return {
    data: dataResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Check if a record exists within an organization
 *
 * @param table - Table name (must be in ALLOWED_TABLES)
 * @param orgId - Organization ID
 * @param id - Record ID
 * @throws Error if table name is not in allowed list
 */
export async function existsInOrg(
  table: string,
  orgId: string,
  id: string
): Promise<boolean> {
  validateTableName(table);
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2) as exists`,
    [orgId, id]
  );
  return result.rows[0].exists;
}

/**
 * Count records for an organization with optional filtering
 *
 * @param table - Table name (must be in ALLOWED_TABLES)
 * @param orgId - Organization ID
 * @param where - Additional WHERE conditions
 * @param params - Parameters for WHERE conditions
 * @throws Error if table name is not in allowed list
 */
export async function countForOrg(
  table: string,
  orgId: string,
  where?: string,
  params: unknown[] = []
): Promise<number> {
  validateTableName(table);
  let sql = `SELECT COUNT(*) FROM ${table} WHERE org_id = $1`;
  const queryParams: unknown[] = [orgId];

  if (where) {
    sql += ` AND ${where}`;
    queryParams.push(...params);
  }

  const result = await query<{ count: string }>(sql, queryParams);
  return parseInt(result.rows[0].count, 10);
}

// ============================================
// Mutation Helpers
// ============================================

/**
 * Insert a record with automatic org_id
 *
 * @param table - Table name (must be in ALLOWED_TABLES)
 * @param orgId - Organization ID
 * @param data - Record data (org_id will be added automatically, column names validated)
 * @returns Inserted record
 * @throws Error if table name is not in allowed list
 * @throws Error if column names contain invalid characters
 */
export async function insertWithOrg<T extends pg.QueryResultRow>(
  table: string,
  orgId: string,
  data: Record<string, unknown>
): Promise<T> {
  validateTableName(table);
  const dataWithOrg = { ...data, org_id: orgId };
  const columns = Object.keys(dataWithOrg);
  validateColumnNames(columns);

  const values = Object.values(dataWithOrg);
  const placeholders = columns.map((_, i) => `$${i + 1}`);

  const result = await query<T>(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * Update a record within an organization
 *
 * @param table - Table name (must be in ALLOWED_TABLES)
 * @param orgId - Organization ID
 * @param id - Record ID
 * @param data - Fields to update (column names validated)
 * @param options - Update options (setUpdatedAt: boolean)
 * @returns Updated record or null if not found
 * @throws Error if table name is not in allowed list
 * @throws Error if column names contain invalid characters
 *
 * @example
 * // With automatic updated_at (default)
 * await updateInOrg('events', orgId, id, { status: 'processed' });
 *
 * // Without updated_at (for tables without this column)
 * await updateInOrg('audit_logs', orgId, id, { viewed: true }, { setUpdatedAt: false });
 */
export async function updateInOrg<T extends pg.QueryResultRow>(
  table: string,
  orgId: string,
  id: string,
  data: Record<string, unknown>,
  options: UpdateOptions = {}
): Promise<T | null> {
  validateTableName(table);
  const { setUpdatedAt = true } = options;

  const columns = Object.keys(data);
  validateColumnNames(columns);

  const values = Object.values(data);
  let setClause = columns.map((col, i) => `${col} = $${i + 3}`).join(", ");

  // Optionally add updated_at
  if (setUpdatedAt) {
    setClause += ", updated_at = NOW()";
  }

  const result = await query<T>(
    `UPDATE ${table} SET ${setClause} WHERE org_id = $1 AND id = $2 RETURNING *`,
    [orgId, id, ...values]
  );

  return result.rows[0] || null;
}

/**
 * Delete a record within an organization
 *
 * @param table - Table name (must be in ALLOWED_TABLES)
 * @param orgId - Organization ID
 * @param id - Record ID
 * @returns true if deleted, false if not found
 * @throws Error if table name is not in allowed list
 */
export async function deleteFromOrg(
  table: string,
  orgId: string,
  id: string
): Promise<boolean> {
  validateTableName(table);
  const result = await query(
    `DELETE FROM ${table} WHERE org_id = $1 AND id = $2`,
    [orgId, id]
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================
// Transaction Helpers
// ============================================

/**
 * Execute multiple operations in a transaction with org context
 *
 * @param orgId - Organization ID
 * @param operations - Array of operations to execute
 */
export async function batchWithOrg<T>(
  orgId: string,
  operations: ((client: pg.PoolClient) => Promise<T>)[]
): Promise<T[]> {
  return transaction(orgId, async (client) => {
    const results: T[] = [];
    for (const op of operations) {
      results.push(await op(client));
    }
    return results;
  });
}

// ============================================
// Validation Helpers
// ============================================

/**
 * Validate org access and return orgId or throw
 *
 * @param orgId - Organization ID (possibly undefined)
 * @param resourceName - Name of resource for error message
 * @throws Error if orgId is not provided
 */
export function requireOrgId(
  orgId: string | undefined | null,
  resourceName = "resource"
): string {
  if (!orgId) {
    logger.warn({ resourceName }, "Organization context required but missing");
    throw new Error(`Organization context required to access ${resourceName}`);
  }
  return orgId;
}

/**
 * Validate that a record belongs to the organization
 *
 * @param table - Table name (must be in ALLOWED_TABLES)
 * @param orgId - Organization ID
 * @param id - Record ID
 * @throws Error if record doesn't exist or doesn't belong to org
 *
 * Note: Error messages use friendly resource names to avoid exposing
 * internal database schema to end users.
 */
export async function validateOrgOwnership(
  table: string,
  orgId: string,
  id: string
): Promise<void> {
  validateTableName(table);
  const exists = await existsInOrg(table, orgId, id);
  if (!exists) {
    const resourceName = getResourceName(table);
    throw new Error(`${resourceName} not found or access denied`);
  }
}

// ============================================
// Utility Exports for Testing
// ============================================

/**
 * Add a table to the allowed tables list (for testing or dynamic tables)
 * @internal
 */
export function _addAllowedTable(table: string): void {
  validateIdentifier(table, "table");
  ALLOWED_TABLES.add(table);
}

/**
 * Check if a table is allowed
 * @internal
 */
export function _isTableAllowed(table: string): boolean {
  return ALLOWED_TABLES.has(table);
}
