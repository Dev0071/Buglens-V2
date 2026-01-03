# 08 - Database

## Overview

Buglens uses PostgreSQL with Row-Level Security (RLS) for multi-tenant data isolation. Every table includes `org_id` from Day 1 - this is non-negotiable. The database is designed for:

1. **Multi-tenancy** - Complete data isolation between organizations
2. **Query Performance** - Strategic indexing for common access patterns
3. **Cost Tracking** - Built-in metrics for per-org billing
4. **Audit Trail** - Timestamps and soft deletes where appropriate

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE SCHEMA                                    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        CORE TABLES                                      │ │
│  │                                                                         │ │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐             │ │
│  │  │ organizations│◄───│    users     │    │ integrations │             │ │
│  │  │    (orgs)    │    │              │    │              │             │ │
│  │  └──────┬───────┘    └──────────────┘    └──────────────┘             │ │
│  │         │                                                               │ │
│  │         │ org_id (FK in all tables)                                    │ │
│  │         │                                                               │ │
│  │         ▼                                                               │ │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐             │ │
│  │  │    events    │───▶│   rca_jobs   │───▶│ rca_results  │             │ │
│  │  │   (sentry)   │    │              │    │              │             │ │
│  │  └──────────────┘    └──────────────┘    └──────────────┘             │ │
│  │                                                                         │ │
│  │  ┌──────────────┐    ┌──────────────┐                                  │ │
│  │  │    repos     │    │ cost_metrics │                                  │ │
│  │  │   (github)   │    │   (billing)  │                                  │ │
│  │  └──────────────┘    └──────────────┘                                  │ │
│  │                                                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      ROW-LEVEL SECURITY                                 │ │
│  │                                                                         │ │
│  │  • Every query filtered by org_id automatically                        │ │
│  │  • Set context: SET LOCAL app.current_org_id = '<uuid>'                │ │
│  │  • Policy: org_id = current_setting('app.current_org_id')::uuid        │ │
│  │  • Prevents cross-tenant data access even on bugs                      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                        | Purpose                                            |
| --------------------------- | -------------------------------------------------- |
| `migrations/*.cjs`          | Database migrations (CommonJS for node-pg-migrate) |
| `src/db/client.ts`          | PostgreSQL connection pool                         |
| `src/db/models/`            | Database models and queries (future)               |
| `scripts/seed-dev-data.sql` | Development seed data                              |

---

## Connection Management

```typescript
// src/db/client.ts
import { Pool, PoolClient } from "pg";
import { config } from "../utils/config";
import { logger } from "../utils/logger";

// Connection pool with sensible defaults
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20, // Maximum connections
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail fast on connection issues
});

// Log pool events
pool.on("connect", () => {
  logger.debug("New database connection established");
});

pool.on("error", (error) => {
  logger.error({ error }, "Unexpected database pool error");
});

// Health check
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    return true;
  } catch (error) {
    logger.error({ error }, "Database health check failed");
    return false;
  }
}

// Graceful shutdown
export async function closeDatabase(): Promise<void> {
  await pool.end();
  logger.info("Database pool closed");
}

// Organization-scoped query helper
export async function withOrgContext<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    // Set organization context for RLS
    await client.query("SET LOCAL app.current_org_id = $1", [orgId]);
    return await fn(client);
  } finally {
    client.release();
  }
}

// Transaction helper with org context
export async function withTransaction<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.current_org_id = $1", [orgId]);

    const result = await fn(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

---

## Migrations

### 001 - Organizations

```javascript
// migrations/001_create_organizations.cjs
exports.up = (pgm) => {
  pgm.createTable("organizations", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "varchar(255)", notNull: true },
    slug: { type: "varchar(100)", notNull: true, unique: true },
    plan: { type: "varchar(50)", notNull: true, default: "free" },
    github_installation_id: { type: "integer" },
    sentry_organization_slug: { type: "varchar(255)" },
    settings: { type: "jsonb", default: "{}" },
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

  // Indexes
  pgm.createIndex("organizations", "slug");
  pgm.createIndex("organizations", "github_installation_id");
};

exports.down = (pgm) => {
  pgm.dropTable("organizations");
};
```

### 002 - Events

```javascript
// migrations/002_create_events.cjs
exports.up = (pgm) => {
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
    sentry_event_id: { type: "varchar(64)", notNull: true },
    sentry_project_slug: { type: "varchar(255)" },
    message: { type: "text", notNull: true },
    platform: { type: "varchar(50)" },
    level: { type: "varchar(20)" },
    environment: { type: "varchar(100)" },
    fingerprint: { type: "varchar(255)" },
    tags: { type: "jsonb", default: "{}" },
    raw_payload: { type: "jsonb", notNull: true },
    received_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Indexes for common queries
  pgm.createIndex("events", "org_id");
  pgm.createIndex("events", ["org_id", "sentry_event_id"], { unique: true });
  pgm.createIndex("events", ["org_id", "fingerprint"]);
  pgm.createIndex("events", ["org_id", "received_at"]);
  pgm.createIndex("events", "sentry_project_slug");

  // Enable RLS
  pgm.sql("ALTER TABLE events ENABLE ROW LEVEL SECURITY");

  // RLS Policy
  pgm.sql(`
    CREATE POLICY events_org_isolation ON events
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("events");
};
```

### 003 - RCA Jobs

```javascript
// migrations/003_create_rca_jobs.cjs
exports.up = (pgm) => {
  pgm.createType("job_status", [
    "pending",
    "processing",
    "completed",
    "failed",
    "cancelled",
  ]);

  pgm.createTable("rca_jobs", {
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
    event_id: {
      type: "uuid",
      notNull: true,
      references: "events(id)",
      onDelete: "CASCADE",
    },
    status: {
      type: "job_status",
      notNull: true,
      default: "pending",
    },
    priority: { type: "smallint", default: 5 },
    error_message: { type: "text" },
    retry_count: { type: "smallint", default: 0 },
    started_at: { type: "timestamptz" },
    completed_at: { type: "timestamptz" },
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

  // Indexes
  pgm.createIndex("rca_jobs", "org_id");
  pgm.createIndex("rca_jobs", ["org_id", "status"]);
  pgm.createIndex("rca_jobs", ["org_id", "event_id"], { unique: true });
  pgm.createIndex("rca_jobs", ["status", "priority", "created_at"]);

  // RLS
  pgm.sql("ALTER TABLE rca_jobs ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY rca_jobs_org_isolation ON rca_jobs
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("rca_jobs");
  pgm.dropType("job_status");
};
```

### 004 - RCA Results

```javascript
// migrations/004_create_rca_results.cjs
exports.up = (pgm) => {
  pgm.createTable("rca_results", {
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
    event_id: {
      type: "uuid",
      notNull: true,
      references: "events(id)",
      onDelete: "CASCADE",
    },
    root_cause: { type: "text", notNull: true },
    confidence: { type: "decimal(3,2)", notNull: true },
    suggested_fix: { type: "text" },
    evidence_summary: { type: "jsonb" },
    deterministic_findings: { type: "jsonb", default: "[]" },
    llm_response: { type: "jsonb" },
    llm_model: { type: "varchar(100)" },
    llm_tokens_used: { type: "integer" },
    llm_cost_usd: { type: "decimal(10,6)" },
    execution_time_ms: { type: "integer" },
    user_feedback: { type: "smallint" }, // -1, 0, 1 (bad, neutral, good)
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Indexes
  pgm.createIndex("rca_results", "org_id");
  pgm.createIndex("rca_results", ["org_id", "event_id"]);
  pgm.createIndex("rca_results", ["org_id", "created_at"]);
  pgm.createIndex("rca_results", "confidence");

  // RLS
  pgm.sql("ALTER TABLE rca_results ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY rca_results_org_isolation ON rca_results
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("rca_results");
};
```

### 005 - Repos

```javascript
// migrations/005_create_repos.cjs
exports.up = (pgm) => {
  pgm.createTable("repos", {
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
    full_name: { type: "varchar(255)", notNull: true }, // owner/repo
    github_installation_id: { type: "integer" },
    default_branch: { type: "varchar(100)", default: "main" },
    is_private: { type: "boolean", default: false },
    last_analyzed_at: { type: "timestamptz" },
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

  // Indexes
  pgm.createIndex("repos", "org_id");
  pgm.createIndex("repos", ["org_id", "full_name"], { unique: true });
  pgm.createIndex("repos", "github_installation_id");

  // RLS
  pgm.sql("ALTER TABLE repos ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY repos_org_isolation ON repos
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("repos");
};
```

### 008 - Integrations (OAuth & GitHub App)

**Base Table (Migration 008):**

```javascript
// migrations/008_create_integrations.cjs
exports.up = (pgm) => {
  pgm.createTable("integrations", {
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
    type: { type: "text", notNull: true }, // github, github_app, slack, jira, etc.
    config: { type: "jsonb", notNull: true, default: "{}" }, // Legacy config storage
    secret_id: { type: "text" }, // AWS Secrets Manager ID (if applicable)
    is_active: { type: "boolean", notNull: true, default: true },
    last_verified_at: { type: "timestamptz" },
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

  pgm.addConstraint("integrations", "integrations_org_type_unique", {
    unique: ["org_id", "type"],
  });

  pgm.createIndex("integrations", "org_id");
  pgm.createIndex("integrations", ["org_id", "type"]);

  pgm.sql("ALTER TABLE integrations ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY integrations_isolation ON integrations
      USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};
```

**Migration 020 - Encrypted Tokens:**

```javascript
// migrations/020_add_encrypted_tokens.cjs
exports.up = (pgm) => {
  // Add encrypted_tokens column for OAuth credentials
  pgm.addColumns("integrations", {
    encrypted_tokens: { type: "jsonb" }, // Stores AES-256-GCM encrypted tokens
  });
};
```

**Migration 021 - GitHub App Columns:**

```javascript
// migrations/021_add_github_app_columns.cjs
exports.up = (pgm) => {
  // Add columns for GitHub App and multi-installation support
  pgm.addColumn("integrations", {
    status: {
      type: "text",
      notNull: true,
      default: "connected", // connected | disconnected | error
    },
    display_name: { type: "text" }, // Human-readable name (e.g., "GitHub App - Acme Corp")
    external_id: { type: "text" }, // GitHub installation_id, Slack team_id, etc.
  });

  // Drop old unique constraint (org_id, type)
  pgm.dropConstraint("integrations", "integrations_org_type_unique");

  // New unique constraint allows multiple integrations of same type per org
  pgm.addConstraint("integrations", "integrations_org_type_external_unique", {
    unique: ["org_id", "type", "external_id"],
  });

  pgm.createIndex("integrations", "external_id");
  pgm.createIndex("integrations", ["org_id", "status"]);
};
```

**Migration 022 - Metadata Column:**

```javascript
// migrations/022_add_metadata_column.cjs
exports.up = (pgm) => {
  // Add metadata column for non-sensitive integration data
  pgm.addColumn("integrations", {
    metadata: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
  });

  // GIN index for efficient JSONB queries (e.g., metadata->>'installationId')
  pgm.addIndex("integrations", "metadata", { method: "gin" });
};
```

**Migration 023 - Make config Nullable:**

```javascript
// migrations/023_make_config_nullable.cjs
exports.up = (pgm) => {
  // Make config nullable (transitioning to encrypted_tokens + metadata pattern)
  pgm.alterColumn("integrations", "config", {
    type: "jsonb",
    notNull: false, // No longer required
    default: pgm.func("'{}'::jsonb"),
  });
};
```

**Final Schema (after migrations 008, 020-023):**

```typescript
interface Integration {
  id: string; // UUID
  org_id: string; // UUID (FK to organizations)
  type: string; // 'github' | 'github_app' | 'slack' | 'jira' | 'sentry'
  status: string; // 'connected' | 'disconnected' | 'error'
  display_name: string | null; // Human-readable name
  external_id: string | null; // External identifier (installation_id, team_id)
  config: Record<string, unknown> | null; // Legacy config (nullable)
  encrypted_tokens: EncryptedData | null; // AES-256-GCM encrypted OAuth tokens
  metadata: Record<string, unknown>; // Non-sensitive data (repos, permissions, scopes)
  secret_id: string | null; // AWS Secrets Manager ID (if applicable)
  is_active: boolean; // true = active, false = disconnected
  last_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Unique constraint: (org_id, type, external_id)
// Allows multiple GitHub installations per org, but prevents duplicate installations
```

**Usage Pattern:**

```typescript
// Store GitHub App integration
await pool.query(
  `INSERT INTO integrations (org_id, type, status, display_name, external_id, encrypted_tokens, metadata, is_active)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [
    orgId,
    "github_app",
    "connected",
    "GitHub App - Acme Corp",
    "12345678", // GitHub installation_id
    encryptedTokens, // { data, iv, authTag, version }
    { installationId: "12345678", repos: ["acme/webapp"], permissions: {...} },
    true,
  ]
);

// Query active integrations
await withOrgContext(orgId, async (client) => {
  const result = await client.query(
    `SELECT * FROM integrations WHERE is_active = true AND type = $1`,
    ["github_app"]
  );
  return result.rows;
});
```

### 009 - Cost Metrics

```javascript
// migrations/009_create_cost_metrics.cjs
exports.up = (pgm) => {
  pgm.createTable("cost_metrics", {
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
    date: { type: "date", notNull: true },

    // RCA counts
    rca_count: { type: "integer", default: 0 },
    rca_success_count: { type: "integer", default: 0 },
    rca_failure_count: { type: "integer", default: 0 },

    // LLM usage
    llm_tokens_input: { type: "bigint", default: 0 },
    llm_tokens_output: { type: "bigint", default: 0 },
    llm_cost_usd: { type: "decimal(10,6)", default: 0 },

    // GitHub API usage
    github_api_calls: { type: "integer", default: 0 },
    github_cache_hits: { type: "integer", default: 0 },

    // Storage
    evidence_storage_bytes: { type: "bigint", default: 0 },

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

  // Unique constraint for daily metrics per org
  pgm.createIndex("cost_metrics", ["org_id", "date"], { unique: true });
  pgm.createIndex("cost_metrics", "date");

  // RLS
  pgm.sql("ALTER TABLE cost_metrics ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY cost_metrics_org_isolation ON cost_metrics
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("cost_metrics");
};
```

---

## Row-Level Security

### Setting Organization Context

```typescript
// src/api/middleware/org-context.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { pool } from "../../db/client";

export async function setOrgContext(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const orgId = request.headers["x-org-id"] as string;

  if (!orgId) {
    // For webhooks, org is determined from payload
    return;
  }

  // Validate org exists and user has access
  const result = await pool.query(
    "SELECT id FROM organizations WHERE id = $1",
    [orgId]
  );

  if (result.rows.length === 0) {
    return reply.status(404).send({ error: "Organization not found" });
  }

  // Store in request for later use
  request.orgId = orgId;
}

// Augment FastifyRequest type
declare module "fastify" {
  interface FastifyRequest {
    orgId?: string;
  }
}
```

### Query Pattern

```typescript
// Always use org context in queries
export async function getEventById(
  orgId: string,
  eventId: string
): Promise<Event | null> {
  // Method 1: Include org_id in WHERE (explicit)
  const result = await pool.query(
    `SELECT * FROM events WHERE org_id = $1 AND id = $2`,
    [orgId, eventId]
  );

  return result.rows[0] || null;
}

// Method 2: Use RLS context (implicit filtering)
export async function getRecentEvents(
  orgId: string,
  limit: number = 20
): Promise<Event[]> {
  return withOrgContext(orgId, async (client) => {
    // RLS automatically filters by org_id
    const result = await client.query(
      `SELECT * FROM events ORDER BY received_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  });
}
```

---

## Common Queries

### Insert Event

```typescript
export async function insertEvent(
  orgId: string,
  event: InsertEventData
): Promise<string> {
  const result = await pool.query(
    `
    INSERT INTO events (
      org_id, sentry_event_id, sentry_project_slug, message,
      platform, level, environment, fingerprint, tags, raw_payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (org_id, sentry_event_id) DO UPDATE SET
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
    RETURNING id
  `,
    [
      orgId,
      event.sentryEventId,
      event.projectSlug,
      event.message,
      event.platform,
      event.level,
      event.environment,
      event.fingerprint,
      JSON.stringify(event.tags),
      JSON.stringify(event.rawPayload),
    ]
  );

  return result.rows[0].id;
}
```

### Update Cost Metrics

```typescript
export async function trackDailyCost(
  orgId: string,
  metrics: {
    rcaCount?: number;
    llmTokensInput?: number;
    llmTokensOutput?: number;
    llmCostUsd?: number;
    githubApiCalls?: number;
    githubCacheHits?: number;
  }
): Promise<void> {
  await pool.query(
    `
    INSERT INTO cost_metrics (
      org_id, date,
      rca_count, llm_tokens_input, llm_tokens_output,
      llm_cost_usd, github_api_calls, github_cache_hits
    ) VALUES (
      $1, CURRENT_DATE,
      $2, $3, $4, $5, $6, $7
    )
    ON CONFLICT (org_id, date) DO UPDATE SET
      rca_count = cost_metrics.rca_count + EXCLUDED.rca_count,
      llm_tokens_input = cost_metrics.llm_tokens_input + EXCLUDED.llm_tokens_input,
      llm_tokens_output = cost_metrics.llm_tokens_output + EXCLUDED.llm_tokens_output,
      llm_cost_usd = cost_metrics.llm_cost_usd + EXCLUDED.llm_cost_usd,
      github_api_calls = cost_metrics.github_api_calls + EXCLUDED.github_api_calls,
      github_cache_hits = cost_metrics.github_cache_hits + EXCLUDED.github_cache_hits,
      updated_at = NOW()
  `,
    [
      orgId,
      metrics.rcaCount || 0,
      metrics.llmTokensInput || 0,
      metrics.llmTokensOutput || 0,
      metrics.llmCostUsd || 0,
      metrics.githubApiCalls || 0,
      metrics.githubCacheHits || 0,
    ]
  );
}
```

### Get Organization Usage

```typescript
export async function getOrgUsage(
  orgId: string,
  days: number = 30
): Promise<UsageSummary> {
  const result = await pool.query(
    `
    SELECT
      SUM(rca_count) as total_rcas,
      SUM(llm_tokens_input + llm_tokens_output) as total_tokens,
      SUM(llm_cost_usd) as total_cost,
      SUM(github_api_calls) as total_api_calls,
      AVG(CASE WHEN github_api_calls > 0
          THEN github_cache_hits::float / github_api_calls
          ELSE 0 END) as cache_hit_rate
    FROM cost_metrics
    WHERE org_id = $1
      AND date >= CURRENT_DATE - $2::interval
  `,
    [orgId, `${days} days`]
  );

  return result.rows[0];
}
```

---

## Running Migrations

```bash
# Run pending migrations
DATABASE_URL=postgres://... npx node-pg-migrate up

# Rollback last migration
DATABASE_URL=postgres://... npx node-pg-migrate down

# Create new migration
npx node-pg-migrate create my_migration_name
```

### Migration Script

```bash
#!/bin/bash
# scripts/migrate.sh

set -e

echo "Running database migrations..."

# Check DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

# Run migrations
npx node-pg-migrate up --migrations-dir migrations --migration-file-language cjs

echo "Migrations complete!"
```

---

## Testing

```typescript
// tests/integration/database.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, withOrgContext } from "../../src/db/client";

describe("Database", () => {
  const testOrgId = "test-org-" + Date.now();

  beforeAll(async () => {
    // Create test org
    await pool.query(
      `
      INSERT INTO organizations (id, name, slug)
      VALUES ($1, 'Test Org', $2)
    `,
      [testOrgId, `test-${Date.now()}`]
    );
  });

  afterAll(async () => {
    // Cleanup
    await pool.query("DELETE FROM organizations WHERE id = $1", [testOrgId]);
  });

  it("RLS prevents cross-org access", async () => {
    // Insert event for test org
    await pool.query(
      `
      INSERT INTO events (org_id, sentry_event_id, message, raw_payload)
      VALUES ($1, 'test-event', 'Test', '{}')
    `,
      [testOrgId]
    );

    // Query with wrong org context should return nothing
    const result = await withOrgContext("wrong-org-id", async (client) => {
      return client.query("SELECT * FROM events");
    });

    expect(result.rows).toHaveLength(0);

    // Query with correct org context should return the event
    const correctResult = await withOrgContext(testOrgId, async (client) => {
      return client.query("SELECT * FROM events");
    });

    expect(correctResult.rows.length).toBeGreaterThan(0);
  });
});
```
