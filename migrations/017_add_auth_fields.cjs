/* eslint-disable */
exports.shorthands = undefined;

/**
 * Add authentication fields to users table
 * - password_hash: bcrypt hashed password
 * - email_verified: whether email has been verified
 * - verification_token: for email verification
 * - reset_token: for password reset
 * - reset_token_expires: expiry time for reset token
 * - last_login_at: track last login time
 */
exports.up = (pgm) => {
  // Add auth-related columns to users table
  pgm.addColumns("users", {
    password_hash: { type: "text" }, // Nullable - OAuth users won't have password
    email_verified: { type: "boolean", notNull: true, default: false },
    verification_token: { type: "text" },
    verification_token_expires: { type: "timestamptz" },
    reset_token: { type: "text" },
    reset_token_expires: { type: "timestamptz" },
    last_login_at: { type: "timestamptz" },
    auth_provider: { type: "text", default: "'email'" }, // 'email', 'github', 'google'
    provider_user_id: { type: "text" }, // External provider user ID
  });

  // Create sessions table for refresh tokens
  pgm.createTable("sessions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    refresh_token: { type: "text", notNull: true, unique: true },
    user_agent: { type: "text" },
    ip_address: { type: "inet" },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    last_used_at: { type: "timestamptz" },
  });

  // Create indexes
  pgm.createIndex("sessions", "user_id");
  pgm.createIndex("sessions", "refresh_token");
  pgm.createIndex("sessions", "expires_at");
  pgm.createIndex("users", "verification_token");
  pgm.createIndex("users", "reset_token");
  pgm.createIndex("users", "auth_provider");
};

exports.down = (pgm) => {
  pgm.dropTable("sessions");
  pgm.dropColumns("users", [
    "password_hash",
    "email_verified",
    "verification_token",
    "verification_token_expires",
    "reset_token",
    "reset_token_expires",
    "last_login_at",
    "auth_provider",
    "provider_user_id",
  ]);
};
