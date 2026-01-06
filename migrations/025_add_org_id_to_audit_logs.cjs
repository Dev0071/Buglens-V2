/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // Add org_id column to audit_logs for multi-tenant filtering
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'org_id') THEN
        ALTER TABLE audit_logs ADD COLUMN org_id UUID REFERENCES organizations(id);
      END IF;
    END $$;
  `);

  // Create index for org_id if not exists
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'audit_logs_org_id_idx') THEN
        CREATE INDEX audit_logs_org_id_idx ON audit_logs(org_id);
      END IF;
    END $$;
  `);

  // Make resource_id nullable for events that don't have a specific resource
  pgm.sql(`
    ALTER TABLE audit_logs ALTER COLUMN resource_id DROP NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.dropIndex("audit_logs", "org_id", { ifExists: true, name: "audit_logs_org_id_idx" });
  pgm.dropColumn("audit_logs", "org_id", { ifExists: true });
};
