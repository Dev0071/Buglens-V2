/* eslint-disable */
exports.shorthands = undefined;

/**
 * Add encrypted_tokens column to integrations table
 * This stores encrypted OAuth tokens and secrets separately from config
 */
exports.up = (pgm) => {
  pgm.addColumns("integrations", {
    encrypted_tokens: { type: "jsonb" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("integrations", ["encrypted_tokens"]);
};
