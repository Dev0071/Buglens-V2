/* eslint-disable */
exports.shorthands = undefined;

/**
 * Add expires_at column to integrations table
 * This stores when OAuth tokens expire (for token refresh logic)
 */
exports.up = (pgm) => {
  pgm.addColumn("integrations", {
    expires_at: {
      type: "timestamptz",
      comment: "When the OAuth access token expires (null for non-expiring tokens)",
    },
  });

  // Create index for efficient querying of expiring tokens
  pgm.createIndex("integrations", "expires_at", {
    where: "expires_at IS NOT NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("integrations", "expires_at");
  pgm.dropColumn("integrations", "expires_at");
};
