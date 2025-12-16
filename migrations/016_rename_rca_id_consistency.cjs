/**
 * Migration 016: Rename rca_id to rca_result_id in rca_corrections
 *
 * Consistency fix: All foreign key columns referencing rca_results
 * should be named rca_result_id to match the pattern in rca_jobs.
 */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // Rename column for consistency with rca_jobs.rca_result_id
  pgm.renameColumn("rca_corrections", "rca_id", "rca_result_id");
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.renameColumn("rca_corrections", "rca_result_id", "rca_id");
};
