/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Create integrations table
  pgm.createTable("integrations", {
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
    type: { type: "text", notNull: true },
    config: { type: "jsonb", notNull: true },
    secret_id: { type: "text" },
    is_active: { type: "boolean", notNull: true, default: true },
    last_verified_at: { type: "timestamptz" },
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

  // Create unique constraint
  pgm.addConstraint("integrations", "integrations_org_type_unique", {
    unique: ["org_id", "type"],
  });

  // Create indexes
  pgm.createIndex("integrations", "org_id");
  pgm.createIndex("integrations", ["org_id", "type"]);

  // Enable RLS
  pgm.sql("ALTER TABLE integrations ENABLE ROW LEVEL SECURITY");

  // Create RLS policy
  pgm.sql(`
    CREATE POLICY integrations_isolation ON integrations
      USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("integrations");
};
