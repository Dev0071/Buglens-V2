/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Create users table
  pgm.createTable("users", {
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
    email: { type: "text", notNull: true, unique: true },
    name: { type: "text" },
    role: { type: "text", notNull: true, default: "member" },
    slack_user_id: { type: "text" },
    github_username: { type: "text" },
    is_active: { type: "boolean", notNull: true, default: true },
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
  pgm.createIndex("users", "org_id");
  pgm.createIndex("users", "email");

  // Enable RLS
  pgm.sql("ALTER TABLE users ENABLE ROW LEVEL SECURITY");

  // Create RLS policy
  pgm.sql(`
    CREATE POLICY users_isolation ON users
      USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("users");
};
