/**
 * Migration 027 — deployments table
 *
 * Stores deploy events so we can answer: "What commit SHA was running in
 * environment E for repo R at the time of this Sentry error?"
 *
 * Sources that write to this table:
 *   - POST /api/v1/track-deploy  (CI/CD webhook from client pipelines)
 *   - GitHub Deployments API sync (polled when a Sentry event arrives)
 *
 * The critical lookup is always:
 *   WHERE org_id = ? AND repo_full_name = ? AND environment = ?
 *   AND deployed_at <= <error_timestamp>
 *   ORDER BY deployed_at DESC LIMIT 1
 */

exports.up = async (pgm) => {
  pgm.createTable("deployments", {
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

    // What was deployed
    repo_full_name: { type: "text", notNull: true },   // "owner/repo"
    commit_sha:     { type: "text", notNull: true },   // full 40-char SHA
    branch:         { type: "text" },                  // "main", "release/2.1"

    // Where it was deployed
    environment: {
      type: "text",
      notNull: true,
      default: "'production'",
    },

    // When — set by the sender, not by us (so rollbacks are ordered correctly)
    deployed_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },

    // Rollback awareness
    // active      — current live deployment
    // superseded  — a newer deploy for same repo+env exists
    // rolled_back — explicitly marked as reverted
    status: {
      type: "text",
      notNull: true,
      default: "'active'",
      check: "status IN ('active', 'superseded', 'rolled_back')",
    },

    // Source of this record (for debugging)
    source: {
      type: "text",
      notNull: true,
      default: "'api'",
      check: "source IN ('api', 'github_deployments_api')",
    },

    // Optional context
    deployer:   { type: "text" },    // "github-actions", "vercel-bot", "alice@co.com"
    deploy_url: { type: "text" },    // Vercel preview URL, etc.
    metadata:   { type: "jsonb", default: "'{}'" },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Primary lookup: find the most recent deployment before error timestamp
  pgm.createIndex("deployments", ["org_id", "repo_full_name", "environment", "deployed_at"], {
    name: "idx_deployments_lookup",
    // DESC on deployed_at so the planner can short-circuit with LIMIT 1
  });

  // Secondary: list all deployments for a repo (dashboard / history view)
  pgm.createIndex("deployments", ["org_id", "repo_full_name", "created_at"], {
    name: "idx_deployments_org_repo",
  });
};

exports.down = async (pgm) => {
  pgm.dropTable("deployments");
};
