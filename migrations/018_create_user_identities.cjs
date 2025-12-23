/* eslint-disable */
exports.shorthands = undefined;

/**
 * User Identities Migration
 * Stores OAuth identities linked to user accounts
 */
exports.up = (pgm) => {
  // Create user_identities table
  pgm.createTable("user_identities", {
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
    provider: {
      type: "varchar(50)",
      notNull: true,
    },
    provider_id: {
      type: "varchar(255)",
      notNull: true,
    },
    email: {
      type: "varchar(255)",
      notNull: true,
    },
    name: {
      type: "varchar(255)",
    },
    avatar_url: {
      type: "varchar(1024)",
    },
    linked_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
  });

  // Unique constraint on provider + provider_id
  pgm.addConstraint("user_identities", "unique_provider_identity", {
    unique: ["provider", "provider_id"],
  });

  // Indexes
  pgm.createIndex("user_identities", "user_id", { name: "idx_user_identities_user" });
  pgm.createIndex("user_identities", "email", { name: "idx_user_identities_email" });
};

exports.down = (pgm) => {
  pgm.dropTable("user_identities");
};
