/* eslint-disable */
exports.shorthands = undefined;

/**
 * Migration: Add metadata column to integrations table
 *
 * Adds metadata JSONB column for storing integration-specific data
 * that doesn't belong in encrypted_tokens (e.g., repos, permissions, scopes)
 */
exports.up = (pgm) => {
  pgm.addColumn("integrations", {
    metadata: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
  });

  // Create GIN index for efficient JSONB queries
  pgm.addIndex("integrations", "metadata", { method: "gin" });
};

exports.down = (pgm) => {
  pgm.dropIndex("integrations", "metadata");
  pgm.dropColumn("integrations", "metadata");
};
