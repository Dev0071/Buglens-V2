/* eslint-disable */
exports.shorthands = undefined;

/**
 * Migration: Add code_context column to rca_jobs
 *
 * This stores the full code content fetched during deterministic analysis,
 * so evidence assembly can provide complete context to the LLM.
 *
 * Previously, we only stored snippets from findings which lacked:
 * - Full file content for understanding context
 * - Import statements
 * - Related function definitions
 * - Surrounding code structure
 *
 * The code_context JSONB structure:
 * {
 *   "fetched_at": "ISO timestamp",
 *   "files": [{
 *     "path": "src/example.ts",
 *     "content": "full file content...",
 *     "language": "typescript",
 *     "line_number": 42,
 *     "column_number": 10,
 *     "snippet_start": 32,
 *     "snippet_end": 52,
 *     "source_map_resolved": false,
 *     "fetch_source": "github" | "embedded" | "cache"
 *   }]
 * }
 */
exports.up = (pgm) => {
  // Add code_context column to store fetched code from deterministic phase
  pgm.addColumn("rca_jobs", {
    code_context: {
      type: "jsonb",
      comment:
        "Full code context fetched during deterministic analysis for LLM reasoning",
    },
  });

  // Index for querying jobs that have code context vs those pending
  // Using regular CREATE INDEX (not CONCURRENTLY) since we're in a transaction
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_rca_jobs_has_code_context
    ON rca_jobs ((code_context IS NOT NULL))
    WHERE code_context IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP INDEX IF EXISTS idx_rca_jobs_has_code_context;");
  pgm.dropColumn("rca_jobs", "code_context");
};
