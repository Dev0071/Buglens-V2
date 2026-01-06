/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Migration: Add Secret Versioning
 *
 * Creates tables for:
 * - secret_versions: Stores versioned secrets with encryption
 * - secret_rotation_events: Audit log for all rotation events
 */

exports.up = async (pgm) => {
  // Secret versions table for multi-version secret support
  pgm.createTable("secret_versions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    secret_type: {
      type: "varchar(50)",
      notNull: true,
      comment:
        "Type of secret: jwt_secret, encryption_key, github_webhook_secret, sentry_webhook_secret, openai_api_key",
    },
    version: {
      type: "varchar(20)",
      notNull: true,
      comment: "Version status: current, previous, next",
    },
    key_id: {
      type: "varchar(50)",
      notNull: true,
      comment: "Unique identifier for this key version (e.g., jwt-v1-abc123)",
    },
    secret_value_encrypted: {
      type: "text",
      notNull: true,
      comment: "AES-256-GCM encrypted secret value",
    },
    rotation_interval_days: {
      type: "integer",
      default: 90,
      comment: "How often this secret type should be rotated",
    },
    created_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    activated_at: {
      type: "timestamp with time zone",
      comment: "When this version became current",
    },
    expires_at: {
      type: "timestamp with time zone",
      comment: "When this version should be deleted (for previous versions)",
    },
    metadata: {
      type: "jsonb",
      default: "{}",
      comment: "Additional metadata (e.g., bundler type for webhook secrets)",
    },
  });

  // Indexes for efficient queries
  pgm.createIndex("secret_versions", "secret_type");
  pgm.createIndex("secret_versions", "expires_at", {
    where: "expires_at IS NOT NULL",
  });
  pgm.createIndex("secret_versions", ["secret_type", "version"]);

  // Unique constraint: only one version per type/status combo
  pgm.addConstraint("secret_versions", "unique_secret_type_version", {
    unique: ["secret_type", "version"],
  });

  // Rotation events audit log
  pgm.createTable("secret_rotation_events", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    secret_type: {
      type: "varchar(50)",
      notNull: true,
    },
    old_key_id: {
      type: "varchar(50)",
      comment: "Previous key ID (null for initial creation)",
    },
    new_key_id: {
      type: "varchar(50)",
      notNull: true,
    },
    rotated_by: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
      comment: "User who initiated rotation (null for automated)",
    },
    rotation_status: {
      type: "varchar(20)",
      notNull: true,
      comment: "Status: initiated, completed, failed, rolled_back",
    },
    rotation_reason: {
      type: "varchar(100)",
      comment: "Reason for rotation: scheduled, manual, emergency, compromise",
    },
    error_message: {
      type: "text",
      comment: "Error details if rotation failed",
    },
    affected_records: {
      type: "integer",
      comment: "Number of records affected (e.g., re-encrypted tokens)",
    },
    duration_ms: {
      type: "integer",
      comment: "How long the rotation took",
    },
    metadata: {
      type: "jsonb",
      default: "{}",
    },
    created_at: {
      type: "timestamp with time zone",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Indexes for audit queries
  pgm.createIndex("secret_rotation_events", "secret_type");
  pgm.createIndex("secret_rotation_events", "rotation_status");
  pgm.createIndex("secret_rotation_events", "created_at");
  pgm.createIndex("secret_rotation_events", "rotated_by", {
    where: "rotated_by IS NOT NULL",
  });

  // Add comment to tables
  pgm.sql(`
    COMMENT ON TABLE secret_versions IS 'Stores versioned secrets with multi-version support for zero-downtime rotation';
    COMMENT ON TABLE secret_rotation_events IS 'Audit log for all secret rotation events';
  `);
};

exports.down = async (pgm) => {
  pgm.dropTable("secret_rotation_events");
  pgm.dropTable("secret_versions");
};
