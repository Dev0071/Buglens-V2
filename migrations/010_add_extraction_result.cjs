/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Add extraction_result column to rca_jobs table
  // Stores the 3-stage extraction pipeline results
  pgm.addColumn("rca_jobs", {
    extraction_result: {
      type: "jsonb",
      notNull: false,
      comment: "Extraction pipeline results (3-stage hybrid extraction)",
    },
  });

  // Create specific GIN indexes for common query patterns:
  // 1. Index on extraction_id for correlation with logs/metrics
  // 2. Index on is_complete for filtering incomplete extractions
  // 3. Index on repo for finding all extractions for a repository
  // 4. Index on extraction_stage for debugging pipeline issues
  //
  // Using jsonb_path_ops for better performance on containment queries
  pgm.sql(`
    CREATE INDEX idx_rca_jobs_extraction_id ON rca_jobs
    USING btree ((extraction_result->>'extraction_id'))
    WHERE extraction_result IS NOT NULL;

    CREATE INDEX idx_rca_jobs_is_complete ON rca_jobs
    USING btree (((extraction_result->>'is_complete')::boolean))
    WHERE extraction_result IS NOT NULL;

    CREATE INDEX idx_rca_jobs_extraction_repo ON rca_jobs
    USING btree ((extraction_result->>'repo'))
    WHERE extraction_result IS NOT NULL AND extraction_result->>'repo' IS NOT NULL;

    CREATE INDEX idx_rca_jobs_extraction_stage ON rca_jobs
    USING btree ((extraction_result->>'extraction_stage'))
    WHERE extraction_result IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_rca_jobs_extraction_id;
    DROP INDEX IF EXISTS idx_rca_jobs_is_complete;
    DROP INDEX IF EXISTS idx_rca_jobs_extraction_repo;
    DROP INDEX IF EXISTS idx_rca_jobs_extraction_stage;
  `);
  pgm.dropColumn("rca_jobs", "extraction_result");
};
