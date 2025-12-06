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

  // Create index for querying extraction results
  pgm.createIndex("rca_jobs", ["org_id", "extraction_result"], {
    name: "idx_rca_jobs_extraction_result",
    where: "extraction_result IS NOT NULL",
    method: "gin",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("rca_jobs", [], { name: "idx_rca_jobs_extraction_result" });
  pgm.dropColumn("rca_jobs", "extraction_result");
};
