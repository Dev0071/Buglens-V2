/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Create organizations table
  pgm.createTable("organizations", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "text", notNull: true },
    slug: { type: "text", notNull: true, unique: true },
    plan: { type: "text", notNull: true, default: "free" },
    settings: { type: "jsonb", notNull: true, default: "{}" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Create indexes
  pgm.createIndex("organizations", "slug");
  pgm.createIndex("organizations", "plan");

  // Enable RLS
  pgm.sql("ALTER TABLE organizations ENABLE ROW LEVEL SECURITY");
};

exports.down = (pgm) => {
  pgm.dropTable("organizations");
};
