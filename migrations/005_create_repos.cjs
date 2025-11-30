/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Create repos table
  pgm.createTable("repos", {
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
    provider: { type: "text", notNull: true, default: "github" },
    owner: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    full_name: { type: "text", notNull: true },
    default_branch: { type: "text", notNull: true, default: "main" },
    installation_id: { type: "text" },
    secret_id: { type: "text", notNull: true },
    is_active: { type: "boolean", notNull: true, default: true },
    last_synced_at: { type: "timestamptz" },
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
  pgm.addConstraint("repos", "repos_org_provider_full_name_unique", {
    unique: ["org_id", "provider", "full_name"],
  });

  // Create indexes
  pgm.createIndex("repos", "org_id");
  pgm.createIndex("repos", ["org_id", "is_active"]);

  // Enable RLS
  pgm.sql("ALTER TABLE repos ENABLE ROW LEVEL SECURITY");

  // Create RLS policy
  pgm.sql(`
    CREATE POLICY repos_isolation ON repos
      USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("repos");
};
