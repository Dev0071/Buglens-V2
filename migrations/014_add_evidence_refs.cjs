/* eslint-disable */
exports.shorthands = undefined;

/**
 * Migration: Add evidence_refs column to rca_results
 *
 * The evidence_refs column stores references to specific evidence items
 * that support the causal chain, separate from the full evidence blob.
 */

exports.up = (pgm) => {
  // Add evidence_refs column for LLM reasoning
  pgm.addColumn("rca_results", {
    evidence_refs: {
      type: "jsonb",
      default: "[]",
      comment: "Array of evidence references supporting the causal chain",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("rca_results", "evidence_refs");
};
