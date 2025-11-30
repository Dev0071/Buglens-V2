/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Create rca_jobs table
  pgm.createTable("rca_jobs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    org_id: {
      type: "uuid",
      notNull: true,
      references: "organizations(id)",
      onDelete: "CASCADE",
    },
    event_id: {
      type: "uuid",
      notNull: true,
      references: "events(id)",
      onDelete: "CASCADE",
    },
    status: { type: "text", notNull: true, default: "pending" },
    code_context_s3_url: { type: "text" },
    deterministic_findings: { type: "jsonb" },
    error_message: { type: "text" },
    retry_count: { type: "integer", notNull: true, default: 0 },
    started_at: { type: "timestamptz" },
    completed_at: { type: "timestamptz" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Create indexes
  pgm.createIndex("rca_jobs", ["org_id", "status"]);
  pgm.createIndex("rca_jobs", "event_id");

  // Enable RLS
  pgm.sql("ALTER TABLE rca_jobs ENABLE ROW LEVEL SECURITY");

  // Create RLS policy
  pgm.sql(`
    CREATE POLICY rca_jobs_isolation ON rca_jobs
      USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("rca_jobs");
};
