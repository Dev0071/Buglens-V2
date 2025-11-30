/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Create code_snapshots table
  pgm.createTable("code_snapshots", {
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
    repo_id: {
      type: "uuid",
      notNull: true,
      references: "repos(id)",
      onDelete: "CASCADE",
    },
    file_path: { type: "text", notNull: true },
    commit_sha: { type: "text", notNull: true },
    content: { type: "text", notNull: true },
    language: { type: "text" },
    size_bytes: { type: "integer" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Create unique constraint
  pgm.addConstraint(
    "code_snapshots",
    "code_snapshots_org_repo_file_sha_unique",
    {
      unique: ["org_id", "repo_id", "file_path", "commit_sha"],
    }
  );

  // Create indexes
  pgm.createIndex("code_snapshots", [
    "org_id",
    "repo_id",
    "commit_sha",
    "file_path",
  ]);

  // Enable RLS
  pgm.sql("ALTER TABLE code_snapshots ENABLE ROW LEVEL SECURITY");

  // Create RLS policy
  pgm.sql(`
    CREATE POLICY code_snapshots_isolation ON code_snapshots
      USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("code_snapshots");
};
