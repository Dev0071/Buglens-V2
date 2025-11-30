/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Create cost_metrics table
  pgm.createTable("cost_metrics", {
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
    date: { type: "date", notNull: true },
    llm_tokens_used: { type: "integer", notNull: true, default: 0 },
    llm_cost_usd: { type: "decimal(10,4)", notNull: true, default: 0 },
    github_api_calls: { type: "integer", notNull: true, default: 0 },
    s3_storage_gb: { type: "decimal(10,4)", notNull: true, default: 0 },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Create unique constraint
  pgm.addConstraint("cost_metrics", "cost_metrics_org_date_unique", {
    unique: ["org_id", "date"],
  });

  // Create indexes
  pgm.createIndex("cost_metrics", ["org_id", "date"]);

  // Enable RLS
  pgm.sql("ALTER TABLE cost_metrics ENABLE ROW LEVEL SECURITY");

  // Create RLS policy
  pgm.sql(`
    CREATE POLICY cost_metrics_isolation ON cost_metrics
      USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("cost_metrics");
};
