/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Create events table
  pgm.createTable("events", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    org_id: {
      type: "uuid",
      notNull: true,
      references: "organizations(id)",
      onDelete: "CASCADE",
    },
    source: { type: "text", notNull: true, default: "sentry" },
    sentry_event_id: { type: "text", unique: true },
    signature: { type: "text", notNull: true },
    message: { type: "text" },
    stack_trace: { type: "jsonb" },
    breadcrumbs: { type: "jsonb" },
    context: { type: "jsonb" },
    environment: { type: "text" },
    release: { type: "text" },
    timestamp: { type: "timestamptz", notNull: true },
    status: { type: "text", notNull: true, default: "received" },
    raw_payload: { type: "jsonb" },
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
  pgm.createIndex("events", ["org_id", "status"]);
  pgm.createIndex("events", ["org_id", "signature", "timestamp"]);
  pgm.createIndex("events", ["org_id", "timestamp"]);
  pgm.createIndex("events", "sentry_event_id");

  // Enable RLS
  pgm.sql("ALTER TABLE events ENABLE ROW LEVEL SECURITY");

  // Create RLS policy
  pgm.sql(`
    CREATE POLICY events_isolation ON events
      USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("events");
};
