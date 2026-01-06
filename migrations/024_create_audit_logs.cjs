/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Create audit_logs table for SOC2 compliance
  pgm.createTable("audit_logs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    actor_id: { type: "text" }, // Can be user ID or system identifier
    actor_type: { type: "text", notNull: true, default: "user" }, // user, system, api_key
    action: { type: "text", notNull: true }, // e.g., user.created, secret.rotated
    resource_type: { type: "text", notNull: true }, // e.g., user, organization, secret
    resource_id: { type: "text", notNull: true },
    details: { type: "jsonb", notNull: true, default: "{}" }, // Additional context
    ip_address: { type: "inet" },
    user_agent: { type: "text" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Create indexes for common queries
  pgm.createIndex("audit_logs", "actor_id");
  pgm.createIndex("audit_logs", "action");
  pgm.createIndex("audit_logs", "resource_type");
  pgm.createIndex("audit_logs", "resource_id");
  pgm.createIndex("audit_logs", "created_at");

  // Composite index for common filter patterns
  pgm.createIndex("audit_logs", ["resource_type", "resource_id"]);
  pgm.createIndex("audit_logs", ["action", "created_at"]);

  // Add suspended_at and suspended_reason columns to organizations (if not exists)
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'suspended_at') THEN
        ALTER TABLE organizations ADD COLUMN suspended_at TIMESTAMPTZ;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'suspended_reason') THEN
        ALTER TABLE organizations ADD COLUMN suspended_reason TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_login_at') THEN
        ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
      END IF;
    END $$;
  `);
};

exports.down = (pgm) => {
  pgm.dropColumn("users", "last_login_at");
  pgm.dropColumn("organizations", ["suspended_at", "suspended_reason"]);
  pgm.dropTable("audit_logs");
};
