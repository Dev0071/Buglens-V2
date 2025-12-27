/* eslint-disable */
exports.shorthands = undefined;

/**
 * Add missing columns to users and rca_results tables
 * - users: avatar_url, last_active_at
 * - rca_results: status, completed_at
 */
exports.up = (pgm) => {
  // Add missing columns to users table
  pgm.addColumns("users", {
    avatar_url: { type: "text" },
    last_active_at: { type: "timestamptz" },
  });

  // Add missing columns to rca_results table
  pgm.addColumns("rca_results", {
    status: {
      type: "text",
      notNull: true,
      default: "'completed'"
    },
    completed_at: { type: "timestamptz" },
  });

  // Create index for status filter
  pgm.createIndex("rca_results", "status");
};

exports.down = (pgm) => {
  pgm.dropColumns("users", ["avatar_url", "last_active_at"]);
  pgm.dropColumns("rca_results", ["status", "completed_at"]);
};
