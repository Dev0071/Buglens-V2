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
  /** ORDER BY clause */
  orderBy?: string;
  /** Extra params for WHERE conditions */
  params?: unknown[];
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
 * @param table - Table name
 * @param orgId - Organization ID
 * @param id - Record ID
 * @param columns - Columns to select (default: *)
 */
export async function findById<T extends pg.QueryResultRow>(
  table: string,
  orgId: string,
  id: string,
  columns = "*"
): Promise<T | null> {
  const result = await query<T>(
    `SELECT ${columns} FROM ${table} WHERE org_id = $1 AND id = $2`,
    [orgId, id]
  );
  return result.rows[0] || null;
}

/**
 * Find all records for an organization with optional filtering
 *
 * @param table - Table name
 * @param orgId - Organization ID
 * @param options - Query options (where, orderBy, params)
 */
export async function findAll<T extends pg.QueryResultRow>(
  table: string,
  orgId: string,
  options: QueryOptions = {}
): Promise<T[]> {
  const { where, orderBy, params = [] } = options;

  let sql = `SELECT * FROM ${table} WHERE org_id = $1`;
  const queryParams: unknown[] = [orgId];

  if (where) {
    sql += ` AND ${where}`;
    queryParams.push(...params);
  }

  if (orderBy) {
    sql += ` ORDER BY ${orderBy}`;
  }

  const result = await query<T>(sql, queryParams);
  return result.rows;
}

/**
 * Find records with pagination
 *
 * @param table - Table name
 * @param orgId - Organization ID
 * @param pagination - Pagination parameters
 * @param options - Query options
 */
export async function findPaginated<T extends pg.QueryResultRow>(
  table: string,
  orgId: string,
  pagination: PaginationParams = {},
  options: QueryOptions = {}
): Promise<PaginatedResult<T>> {
  const { page = 1, limit = 20 } = pagination;
  const { where, orderBy = "created_at DESC", params = [] } = options;
  const offset = (page - 1) * limit;

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
 * @param table - Table name
 * @param orgId - Organization ID
 * @param id - Record ID
 */
export async function existsInOrg(
  table: string,
  orgId: string,
  id: string
): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2) as exists`,
    [orgId, id]
  );
  return result.rows[0].exists;
}

/**
 * Count records for an organization with optional filtering
 *
 * @param table - Table name
 * @param orgId - Organization ID
 * @param where - Additional WHERE conditions
 * @param params - Parameters for WHERE conditions
 */
export async function countForOrg(
  table: string,
  orgId: string,
  where?: string,
  params: unknown[] = []
): Promise<number> {
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
 * @param table - Table name
 * @param orgId - Organization ID
 * @param data - Record data (org_id will be added automatically)
 * @returns Inserted record
 */
export async function insertWithOrg<T extends pg.QueryResultRow>(
  table: string,
  orgId: string,
  data: Record<string, unknown>
): Promise<T> {
  const dataWithOrg = { ...data, org_id: orgId };
  const columns = Object.keys(dataWithOrg);
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
 * @param table - Table name
 * @param orgId - Organization ID
 * @param id - Record ID
 * @param data - Fields to update
 * @returns Updated record or null if not found
 */
export async function updateInOrg<T extends pg.QueryResultRow>(
  table: string,
  orgId: string,
  id: string,
  data: Record<string, unknown>
): Promise<T | null> {
  const columns = Object.keys(data);
  const values = Object.values(data);
  const setClause = columns.map((col, i) => `${col} = $${i + 3}`).join(", ");

  const result = await query<T>(
    `UPDATE ${table} SET ${setClause}, updated_at = NOW() WHERE org_id = $1 AND id = $2 RETURNING *`,
    [orgId, id, ...values]
  );

  return result.rows[0] || null;
}

/**
 * Delete a record within an organization
 *
 * @param table - Table name
 * @param orgId - Organization ID
 * @param id - Record ID
 * @returns true if deleted, false if not found
 */
export async function deleteFromOrg(
  table: string,
  orgId: string,
  id: string
): Promise<boolean> {
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
 * @param table - Table name
 * @param orgId - Organization ID
 * @param id - Record ID
 * @throws Error if record doesn't exist or doesn't belong to org
 */
export async function validateOrgOwnership(
  table: string,
  orgId: string,
  id: string
): Promise<void> {
  const exists = await existsInOrg(table, orgId, id);
  if (!exists) {
    throw new Error(`${table} with ID ${id} not found in organization`);
  }
}
