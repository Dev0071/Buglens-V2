/**
 * Vitest Setup File
 *
 * Initializes source-map WASM before tests run
 * Sets up test environment variables
 */
import { SourceMapConsumer } from "source-map";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

// Set test environment variables BEFORE any config is loaded
if (!process.env.PLATFORM_ADMIN_TOKEN) {
  process.env.PLATFORM_ADMIN_TOKEN = "test-platform-admin-token-32-chars-min";
}

// Initialize source-map WASM loader
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(
  __dirname,
  "../node_modules/source-map/lib/mappings.wasm"
);

if (fs.existsSync(wasmPath)) {
  const wasmBuffer = fs.readFileSync(wasmPath);
  (SourceMapConsumer as any).initialize({
    "lib/mappings.wasm": wasmBuffer,
  });
}

/**
 * Helper to clean up test data in correct order (respecting foreign keys)
 * Call this in afterAll/beforeEach to ensure clean state
 *
 * Order: audit_logs -> sessions -> users -> organizations
 *
 * @param pool - Database pool
 * @param orgIdOrSlugPattern - Either a UUID for exact match or a pattern for LIKE
 */
export async function cleanupTestOrganization(
  pool: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  orgIdOrSlugPattern: string
): Promise<void> {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      orgIdOrSlugPattern
    );

  if (isUuid) {
    // Exact org ID match
    await pool.query("DELETE FROM audit_logs WHERE org_id = $1", [
      orgIdOrSlugPattern,
    ]);
    await pool.query(
      "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)",
      [orgIdOrSlugPattern]
    );
    await pool.query("DELETE FROM users WHERE org_id = $1", [
      orgIdOrSlugPattern,
    ]);
    await pool.query("DELETE FROM organizations WHERE id = $1", [
      orgIdOrSlugPattern,
    ]);
  } else {
    // Slug pattern match
    await pool.query(
      `DELETE FROM audit_logs WHERE org_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`,
      [orgIdOrSlugPattern]
    );
    await pool.query(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id IN (SELECT id FROM organizations WHERE slug LIKE $1))`,
      [orgIdOrSlugPattern]
    );
    await pool.query(
      `DELETE FROM users WHERE org_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`,
      [orgIdOrSlugPattern]
    );
    await pool.query(`DELETE FROM organizations WHERE slug LIKE $1`, [
      orgIdOrSlugPattern,
    ]);
  }
}

export {};
