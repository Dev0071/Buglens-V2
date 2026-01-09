import pg from "pg";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  min: config.DATABASE_POOL_MIN,
  max: config.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // Heroku Postgres requires SSL in production and staging
  ssl:
    config.NODE_ENV !== "development"
      ? {
          rejectUnauthorized: false, // Required for Heroku Postgres
        }
      : false,
});

// Test connection on startup
pool.on("connect", () => {
  logger.debug("New database connection established");
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected database pool error");
  process.exit(1);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    logger.debug({ text, duration, rows: result.rowCount }, "Query executed");
    return result;
  } catch (error) {
    logger.error({ text, error }, "Query failed");
    throw error;
  }
}

/**
 * Set organization context for row-level security
 */
export async function setOrgContext(client: pg.PoolClient, orgId: string) {
  await client.query("SELECT set_config('app.current_org_id', $1, true)", [
    orgId,
  ]);
}

/**
 * Execute a transaction with automatic org context
 * @param orgId - Optional organization ID. If null/undefined, no org context is set (useful for signup)
 */
export async function transaction<T>(
  orgId: string | null | undefined,
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (orgId) {
      await setOrgContext(client, orgId);
    }
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
