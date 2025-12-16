/**
 * Migration 013: Add evidence graph and RCA feedback columns
 *
 * Week 5 additions:
 * 1. evidence_graph JSONB column for visual RCA representation
 * 2. Feedback fields for RCA quality tracking
 * 3. RCA corrections table for signature learning
 */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // ==========================================================================
  // 1. ADD EVIDENCE GRAPH COLUMN TO RCA_RESULTS
  // ==========================================================================
  pgm.addColumn("rca_results", {
    evidence_graph: {
      type: "jsonb",
      comment: "Visual evidence graph showing RCA reasoning chain",
    },
  });

  // ==========================================================================
  // 2. ADD FEEDBACK COLUMNS TO RCA_RESULTS
  // ==========================================================================
  pgm.addColumn("rca_results", {
    actual_root_cause: {
      type: "text",
      comment: "User-provided actual root cause when RCA was wrong",
    },
    feedback_timestamp: {
      type: "timestamptz",
      comment: "When feedback was submitted",
    },
    error_category: {
      type: "text",
      comment: "User-categorized error type (null_access, async, type, etc)",
    },
  });

  // ==========================================================================
  // 3. CREATE RCA_CORRECTIONS TABLE
  // ==========================================================================
  pgm.createTable("rca_corrections", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    rca_id: {
      type: "uuid",
      notNull: true,
      references: "rca_results(id)",
      onDelete: "CASCADE",
    },
    org_id: {
      type: "uuid",
      notNull: true,
      references: "organizations(id)",
      onDelete: "CASCADE",
    },
    original_root_cause: {
      type: "text",
      notNull: true,
      comment: "What Buglens originally said was the root cause",
    },
    corrected_root_cause: {
      type: "text",
      notNull: true,
      comment: "What the user says was actually the root cause",
    },
    error_signature: {
      type: "text",
      comment: "Error fingerprint for signature database learning",
    },
    error_category: {
      type: "text",
      comment: "User-categorized error type",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // ==========================================================================
  // 4. CREATE INDEXES
  // ==========================================================================

  // Index for finding corrections by signature (for learning)
  pgm.createIndex("rca_corrections", "error_signature", {
    name: "idx_rca_corrections_signature",
  });

  // Index for finding corrections by category (for analytics)
  pgm.createIndex("rca_corrections", "error_category", {
    name: "idx_rca_corrections_category",
  });

  // Index for org isolation
  pgm.createIndex("rca_corrections", "org_id", {
    name: "idx_rca_corrections_org_id",
  });

  // Index for feedback timestamp queries
  pgm.createIndex("rca_results", "feedback_timestamp", {
    name: "idx_rca_results_feedback_timestamp",
    where: "feedback_timestamp IS NOT NULL",
  });

  // ==========================================================================
  // 5. ADD COMMENTS
  // ==========================================================================
  pgm.sql(`
    COMMENT ON TABLE rca_corrections IS
    'Stores user corrections when RCA was wrong. Used for signature database learning in Week 7-8.';
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // Drop indexes
  pgm.dropIndex("rca_results", "feedback_timestamp", {
    name: "idx_rca_results_feedback_timestamp",
    ifExists: true,
  });
  pgm.dropIndex("rca_corrections", "org_id", {
    name: "idx_rca_corrections_org_id",
    ifExists: true,
  });
  pgm.dropIndex("rca_corrections", "error_category", {
    name: "idx_rca_corrections_category",
    ifExists: true,
  });
  pgm.dropIndex("rca_corrections", "error_signature", {
    name: "idx_rca_corrections_signature",
    ifExists: true,
  });

  // Drop table
  pgm.dropTable("rca_corrections", { ifExists: true });

  // Drop columns
  pgm.dropColumn("rca_results", ["error_category", "feedback_timestamp", "actual_root_cause", "evidence_graph"], {
    ifExists: true,
  });
};
