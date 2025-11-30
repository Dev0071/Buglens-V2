/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Create rca_results table
  pgm.createTable("rca_results", {
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
    job_id: {
      type: "uuid",
      notNull: true,
      references: "rca_jobs(id)",
      onDelete: "CASCADE",
    },
    title: { type: "text", notNull: true },
    summary: { type: "text", notNull: true },
    root_cause: { type: "text", notNull: true },
    causal_chain: { type: "jsonb", notNull: true },
    suggested_fix: { type: "jsonb" },
    test_intentions: { type: "jsonb" },
    evidence: { type: "jsonb", notNull: true },
    confidence: { type: "real", notNull: true },
    llm_model: { type: "text", default: "gpt-4o-mini" },
    llm_tokens_used: { type: "integer" },
    processing_time_ms: { type: "integer" },
    user_feedback: { type: "text" },
    user_notes: { type: "text" },
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
  pgm.createIndex("rca_results", ["org_id", "created_at"]);
  pgm.createIndex("rca_results", "event_id");
  pgm.createIndex("rca_results", "job_id");

  // Enable RLS
  pgm.sql("ALTER TABLE rca_results ENABLE ROW LEVEL SECURITY");

  // Create RLS policy
  pgm.sql(`
    CREATE POLICY rca_results_isolation ON rca_results
      USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("rca_results");
};
