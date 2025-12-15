/* eslint-disable */
exports.shorthands = undefined;

/**
 * Migration: Add evidence_bundle column to rca_jobs
 *
 * This column stores the evidence bundle as JSONB when S3 is not available
 * (development mode). In production, S3 is used and this column remains NULL.
 *
 * Structure matches EvidenceBundle type from evidence-collector.ts
 */
exports.up = (pgm) => {
  // Add evidence_bundle column for development mode storage
  pgm.addColumn("rca_jobs", {
    evidence_bundle: {
      type: "jsonb",
      comment:
        "Evidence bundle stored as JSONB in development mode (S3 used in production)",
    },
  });

  // Partial index for jobs that have evidence stored locally
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_rca_jobs_has_evidence_bundle
    ON rca_jobs ((evidence_bundle IS NOT NULL))
    WHERE evidence_bundle IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP INDEX IF EXISTS idx_rca_jobs_has_evidence_bundle;");
  pgm.dropColumn("rca_jobs", "evidence_bundle");
};
