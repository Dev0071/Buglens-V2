/* eslint-disable */
exports.shorthands = undefined;

/**
 * Migration: Add columns for GitHub App and enhanced OAuth integrations
 *
 * Adds:
 * - status: Integration connection status ('connected', 'disconnected', 'error')
 * - display_name: Human-readable name for the integration
 * - external_id: External identifier (e.g., GitHub installation_id, Slack team_id)
 *
 * Also updates constraints to support multiple integrations of same type per org
 * (e.g., multiple GitHub App installations)
 */
exports.up = (pgm) => {
  // Add new columns
  pgm.addColumn("integrations", {
    status: {
      type: "text",
      notNull: true,
      default: "connected",
    },
    display_name: {
      type: "text",
    },
    external_id: {
      type: "text",
    },
  });

  // Drop old unique constraint (org_id, type)
  pgm.dropConstraint("integrations", "integrations_org_type_unique");

  // Add new unique constraint (org_id, type, external_id)
  // This allows multiple integrations of same type per org (e.g., multiple GitHub installations)
  // but prevents duplicates of the same external resource
  pgm.addConstraint("integrations", "integrations_org_type_external_unique", {
    unique: ["org_id", "type", "external_id"],
  });

  // Create index on external_id for faster lookups
  pgm.createIndex("integrations", "external_id");

  // Create index on status for filtering
  pgm.createIndex("integrations", ["org_id", "status"]);
};

exports.down = (pgm) => {
  // Drop new constraint
  pgm.dropConstraint("integrations", "integrations_org_type_external_unique");

  // Restore old constraint
  pgm.addConstraint("integrations", "integrations_org_type_unique", {
    unique: ["org_id", "type"],
  });

  // Drop indexes
  pgm.dropIndex("integrations", "external_id");
  pgm.dropIndex("integrations", ["org_id", "status"]);

  // Drop columns
  pgm.dropColumn("integrations", "status");
  pgm.dropColumn("integrations", "display_name");
  pgm.dropColumn("integrations", "external_id");
};
