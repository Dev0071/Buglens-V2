/* eslint-disable */
exports.shorthands = undefined;

/**
 * Migration: Make config column nullable
 *
 * The config column is no longer required since we use:
 * - encrypted_tokens: For sensitive OAuth tokens
 * - metadata: For integration-specific data
 *
 * This allows new integrations to use the modern schema without
 * needing to populate the legacy config column.
 */
exports.up = (pgm) => {
  // Make config nullable and set default to empty object
  pgm.alterColumn("integrations", "config", {
    type: "jsonb",
    notNull: false,
    default: pgm.func("'{}'::jsonb"),
  });
};

exports.down = (pgm) => {
  // Revert to NOT NULL (may fail if NULL values exist)
  pgm.alterColumn("integrations", "config", {
    type: "jsonb",
    notNull: true,
  });
};
