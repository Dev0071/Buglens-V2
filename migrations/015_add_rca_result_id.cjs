/**
 * Migration 015: Add rca_result_id to rca_jobs
 *
 * Links completed RCA jobs to their results for easy lookup.
 */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // Add rca_result_id column to rca_jobs
  pgm.addColumn("rca_jobs", {
    rca_result_id: {
      type: "uuid",
      references: "rca_results(id)",
      onDelete: "SET NULL",
      comment: "Reference to the completed RCA result",
    },
  });

  // Add index for faster lookups
  pgm.createIndex("rca_jobs", "rca_result_id", {
    where: "rca_result_id IS NOT NULL",
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumn("rca_jobs", "rca_result_id");
};
