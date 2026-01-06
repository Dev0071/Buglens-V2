# Investigation Sessions — Exact Schema Changes (Buglens V2)

You already have a clean, multi-tenant spine: `organizations → events → rca_jobs → rca_results` with RLS everywhere, plus `repos`, `code_snapshots`, `integrations`, and cost tracking.

The missing abstraction (and the thing that will make Buglens *feel* different from Sentry/Seer) is **an investigation session**: a durable container that groups events, evidence, hypotheses, and outcomes over time.

This document proposes:
- **New tables** (sessions + evidence graph + hypotheses + feedback)
- **Minimal changes** to existing tables (`rca_jobs`, `rca_results`, `events`)
- **Where to update the docs** (DB schema + services + API endpoints)
- **What to remove / simplify** to avoid duplicated concepts

---

## 0) Design rules (non-negotiable)

1. **Sessions are first-class**: UI opens a session; jobs and results attach to a session.
2. **Evidence is first-class** (addressable + queryable) — not only JSON blobs.
3. **Determinism stays sovereign**: graph + findings can exist without any LLM.
4. **Multi-tenancy invariant**: every table has `org_id`, every table has RLS.
5. **Backwards compatible**: you can migrate from `event → job` to `session → events → jobs` without breaking ingestion.

---

## 1) New core tables

### 1.1 `investigation_sessions`
A session is the investigation container.

**Why**: an incident often spans multiple events, services, and time windows.

**Fields**:
- `id` (uuid)
- `org_id` (uuid)
- `title` (text) — editable, can be generated
- `status` (`open` | `triage` | `in_progress` | `resolved` | `archived`)
- `severity` (`unknown` | `sev0` | `sev1` | `sev2` | `sev3`)
- `source` (`auto` | `manual` | `slack` | `pagerduty` | `webhook`)
- `primary_event_id` (uuid, nullable) — for “starting point”
- `time_window_start`, `time_window_end` (timestamptz, nullable)
- `labels` (jsonb, default `{}`)
- `owner_user_id` (uuid, nullable)
- `created_at`, `updated_at`, `resolved_at` (timestamptz)

**DDL (node-pg-migrate style)**

```js
// migrations/00X_create_investigation_sessions.cjs
exports.up = (pgm) => {
  pgm.createType("investigation_status", [
    "open",
    "triage",
    "in_progress",
    "resolved",
    "archived",
  ]);

  pgm.createType("investigation_severity", [
    "unknown",
    "sev0",
    "sev1",
    "sev2",
    "sev3",
  ]);

  pgm.createType("investigation_source", [
    "auto",
    "manual",
    "slack",
    "pagerduty",
    "webhook",
  ]);

  pgm.createTable("investigation_sessions", {
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
    title: { type: "text", notNull: true, default: "New investigation" },
    status: {
      type: "investigation_status",
      notNull: true,
      default: "open",
    },
    severity: {
      type: "investigation_severity",
      notNull: true,
      default: "unknown",
    },
    source: {
      type: "investigation_source",
      notNull: true,
      default: "auto",
    },
    primary_event_id: { type: "uuid", references: "events(id)", onDelete: "SET NULL" },
    time_window_start: { type: "timestamptz" },
    time_window_end: { type: "timestamptz" },
    labels: { type: "jsonb", notNull: true, default: "{}" },
    owner_user_id: { type: "uuid", references: "users(id)", onDelete: "SET NULL" },
    resolved_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
  });

  pgm.createIndex("investigation_sessions", "org_id");
  pgm.createIndex("investigation_sessions", ["org_id", "status", "updated_at"]);

  // RLS
  pgm.sql("ALTER TABLE investigation_sessions ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY investigation_sessions_org_isolation ON investigation_sessions
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("investigation_sessions");
  pgm.dropType("investigation_source");
  pgm.dropType("investigation_severity");
  pgm.dropType("investigation_status");
};
```

---

### 1.2 `investigation_events` (join table)
Sessions can include multiple events; an event can be re-used in another session in rare cases (triage workflows), so make it many-to-many.

**Fields**:
- `id` (uuid)
- `org_id`
- `session_id`
- `event_id`
- `role` (`primary` | `supporting` | `duplicate` | `related`)
- `added_by` (user_id nullable)
- `created_at`

**DDL**

```js
// migrations/00X_create_investigation_events.cjs
exports.up = (pgm) => {
  pgm.createType("investigation_event_role", [
    "primary",
    "supporting",
    "duplicate",
    "related",
  ]);

  pgm.createTable("investigation_events", {
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
    session_id: {
      type: "uuid",
      notNull: true,
      references: "investigation_sessions(id)",
      onDelete: "CASCADE",
    },
    event_id: {
      type: "uuid",
      notNull: true,
      references: "events(id)",
      onDelete: "CASCADE",
    },
    role: {
      type: "investigation_event_role",
      notNull: true,
      default: "supporting",
    },
    added_by: { type: "uuid", references: "users(id)", onDelete: "SET NULL" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
  });

  pgm.createIndex("investigation_events", "org_id");
  pgm.createIndex("investigation_events", ["org_id", "session_id"]);
  pgm.createIndex("investigation_events", ["org_id", "event_id"]);
  pgm.createIndex("investigation_events", ["org_id", "session_id", "event_id"], { unique: true });

  // RLS
  pgm.sql("ALTER TABLE investigation_events ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY investigation_events_org_isolation ON investigation_events
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("investigation_events");
  pgm.dropType("investigation_event_role");
};
```

---

## 2) Evidence graph becomes a real DB object

Right now, evidence is mostly carried inside the `EvidenceBundle` and then summarized into `rca_results.evidence_summary` and stored in S3.

That’s fine for v0, but it won’t scale trust.

We introduce **canonical evidence nodes + edges**.

### 2.1 `evidence_nodes`
**Fields**:
- `id` (uuid)
- `org_id`
- `session_id`
- `type` (enum)
- `external_ref` (text nullable) — e.g. sentry event id, commit sha, PR URL
- `title` (text)
- `data` (jsonb) — typed-by-`type`
- `source` (`sentry`|`datadog`|`github`|`ci`|`manual`|`system`)
- `confidence` (decimal(3,2) nullable) — computed deterministically where possible
- `created_at`

**Node types (start minimal)**:
- `error_event`
- `stack_frame`
- `code_file`
- `code_snippet`
- `commit`
- `deploy`
- `log_line`
- `trace_span`
- `deterministic_finding`
- `hypothesis`
- `suggested_fix`

**DDL**

```js
// migrations/00X_create_evidence_nodes.cjs
exports.up = (pgm) => {
  pgm.createType("evidence_node_type", [
    "error_event",
    "stack_frame",
    "code_file",
    "code_snippet",
    "commit",
    "deploy",
    "log_line",
    "trace_span",
    "deterministic_finding",
    "hypothesis",
    "suggested_fix",
  ]);

  pgm.createType("evidence_source", [
    "sentry",
    "datadog",
    "github",
    "ci",
    "manual",
    "system",
  ]);

  pgm.createTable("evidence_nodes", {
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
    session_id: {
      type: "uuid",
      notNull: true,
      references: "investigation_sessions(id)",
      onDelete: "CASCADE",
    },
    type: { type: "evidence_node_type", notNull: true },
    source: { type: "evidence_source", notNull: true, default: "system" },
    external_ref: { type: "text" },
    title: { type: "text", notNull: true },
    data: { type: "jsonb", notNull: true, default: "{}" },
    confidence: { type: "decimal(3,2)" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
  });

  pgm.createIndex("evidence_nodes", "org_id");
  pgm.createIndex("evidence_nodes", ["org_id", "session_id"]);
  pgm.createIndex("evidence_nodes", ["org_id", "session_id", "type"]);
  pgm.createIndex("evidence_nodes", ["org_id", "external_ref"]);

  // RLS
  pgm.sql("ALTER TABLE evidence_nodes ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY evidence_nodes_org_isolation ON evidence_nodes
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("evidence_nodes");
  pgm.dropType("evidence_source");
  pgm.dropType("evidence_node_type");
};
```

---

### 2.2 `evidence_edges`
Edges make the explanation auditable.

**Fields**:
- `id` (uuid)
- `org_id`
- `session_id`
- `from_node_id`
- `to_node_id`
- `type` (enum)
- `weight` (decimal(3,2) nullable)
- `created_at`

**Edge types (start minimal)**:
- `causes`
- `supports`
- `contradicts`
- `references`
- `introduced_by`
- `fixed_by`
- `triggered_by`
- `correlates_with`

**DDL**

```js
// migrations/00X_create_evidence_edges.cjs
exports.up = (pgm) => {
  pgm.createType("evidence_edge_type", [
    "causes",
    "supports",
    "contradicts",
    "references",
    "introduced_by",
    "fixed_by",
    "triggered_by",
    "correlates_with",
  ]);

  pgm.createTable("evidence_edges", {
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
    session_id: {
      type: "uuid",
      notNull: true,
      references: "investigation_sessions(id)",
      onDelete: "CASCADE",
    },
    from_node_id: {
      type: "uuid",
      notNull: true,
      references: "evidence_nodes(id)",
      onDelete: "CASCADE",
    },
    to_node_id: {
      type: "uuid",
      notNull: true,
      references: "evidence_nodes(id)",
      onDelete: "CASCADE",
    },
    type: { type: "evidence_edge_type", notNull: true },
    weight: { type: "decimal(3,2)" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
  });

  pgm.createIndex("evidence_edges", "org_id");
  pgm.createIndex("evidence_edges", ["org_id", "session_id"]);
  pgm.createIndex("evidence_edges", ["org_id", "session_id", "type"]);
  pgm.createIndex("evidence_edges", ["from_node_id"]);
  pgm.createIndex("evidence_edges", ["to_node_id"]);

  // RLS
  pgm.sql("ALTER TABLE evidence_edges ENABLE ROW LEVEL SECURITY");
  pgm.sql(`
    CREATE POLICY evidence_edges_org_isolation ON evidence_edges
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("evidence_edges");
  pgm.dropType("evidence_edge_type");
};
```

---

## 3) Hypotheses + decision trail (trust builder)

### 3.1 `investigation_hypotheses`
This makes the “thinking” explicit without requiring LLMs.

**Fields**:
- `id`, `org_id`, `session_id`
- `statement` (text)
- `status` (`proposed` | `active` | `rejected` | `confirmed`)
- `created_by` (`system` | `user` | `llm`) — keep it explicit
- `confidence` (decimal(3,2) nullable)
- `supporting_node_ids` (jsonb array of UUIDs) — minimal; edges can also represent this
- timestamps

**Note**: you can model hypotheses as nodes too (`evidence_nodes.type = hypothesis`).
If you do that, keep this table minimal or skip it.

My recommendation:
- **Represent hypothesis as a node** (so it appears in graph)
- Keep a thin `investigation_hypotheses` table only if you need fast listing + status filters.

If you want to keep it clean: **skip the extra table** and use `evidence_nodes` + edges.

---

## 4) Minimal changes to existing tables

### 4.1 `rca_jobs`: add `session_id`
Right now jobs are `org_id + event_id` unique.
That’s the event-centric constraint.

**Change**:
- add `session_id` (uuid) referencing `investigation_sessions`
- remove/relax unique constraint `UNIQUE(org_id, event_id)` to either:
  - `UNIQUE(org_id, session_id, event_id)` (recommended)
  - or allow multiple jobs per event per session (if you want retries to be new rows)

**DDL**

```js
// migrations/00X_add_session_id_to_rca_jobs.cjs
exports.up = (pgm) => {
  pgm.addColumn("rca_jobs", {
    session_id: {
      type: "uuid",
      references: "investigation_sessions(id)",
      onDelete: "CASCADE",
      // initially nullable for backfill
    },
  });

  pgm.createIndex("rca_jobs", ["org_id", "session_id"]);

  // Replace unique index if you have it
  // NOTE: node-pg-migrate names may differ depending on your index naming
  // Drop old unique constraint/index for (org_id,event_id) and create new one
  // pgm.dropIndex("rca_jobs", ["org_id", "event_id"], { unique: true });
  // pgm.createIndex("rca_jobs", ["org_id", "session_id", "event_id"], { unique: true });
};

exports.down = (pgm) => {
  // reverse carefully
  pgm.dropColumn("rca_jobs", "session_id");
};
```

---

### 4.2 `rca_results`: make it job-linked + session-linked
Your docs currently show *two different shapes* across files:
- One version links `rca_results.job_id` → `rca_jobs`
- Another version links `rca_results.event_id` → `events`

That mismatch will keep biting you.

**Change**:
- Add `job_id` FK → `rca_jobs(id)` (NOT NULL once backfilled)
- Add `session_id` FK → `investigation_sessions(id)` (NOT NULL once backfilled)
- Keep `event_id` optional only if you need direct lookup; otherwise derive via job.

**Recommended final state**:
- `rca_results.job_id` = required
- `rca_results.session_id` = required
- `rca_results.event_id` = optional (or remove later)

---

### 4.3 `events`: optional “hint” fields (don’t overdo)
Keep events as immutable receipts.

Optional additions (if they help mapping / grouping):
- `fingerprint` (already in your migrations)
- `release` / `environment` / `sentry_project_slug` (already there)

Do **not** add `session_id` to events unless you want to force 1:1 assignment.
Use `investigation_events` instead.

---

## 5) How the pipeline changes (minimal code disruption)

### 5.1 Ingestion
Current: webhook → `events` insert → `rca_job` created

New:
1) webhook → insert `events`
2) **session resolution**:
   - if `fingerprint` matches an open session in recent window → attach
   - else create new `investigation_session` and attach
3) create `rca_job` with `session_id`

This can be deterministic:
- fingerprint + environment + project slug + time window

### 5.2 Evidence Collector
Current signature looks like it collects per job/event.

New: `collect({ orgId, sessionId, eventId, repo, ref })` and:
- stores canonical evidence nodes/edges
- still writes the S3 EvidenceBundle as a snapshot (great for audit and replay)

### 5.3 UI
UI becomes session-first:
- `/investigations` lists sessions
- session page shows:
  - events timeline
  - graph
  - latest RCA result (or per-event results)
  - confidence over time

---

## 6) What to remove / simplify (and where)

### Remove / de-emphasize: “RCA result is the product”
**Where**:
- Anywhere in the docs/UI that frames the output as a single final RCA.

**Replace with**:
- Investigation session with evolving state, hypotheses, and evidence.

Why:
- This is how you build trust.
- This is how you avoid “LLM oracle” perception.

---

### Simplify: duplicate evidence representations
You’ll now have:
- S3 EvidenceBundle (snapshot)
- Postgres evidence_nodes/evidence_edges (queryable canonical)

That’s okay, but don’t build a third representation.

Specifically:
- keep `rca_results.evidence_summary` as a *UI summary* only
- but the graph API should pull from `evidence_nodes/evidence_edges`

---

## 7) Where to update the docs (exact sections)

### A) Data Layer & Integrations docs
Update the “Core Tables” diagram and list to include:
- `investigation_sessions`
- `investigation_events`
- `evidence_nodes`
- `evidence_edges`

Also update RCA table definitions:
- `rca_jobs.session_id`
- `rca_results.job_id` + `rca_results.session_id`

### B) Backend Architecture & Services docs
Update the lifecycle:
- ingestion resolves/creates session
- orchestrator runs jobs within session
- evidence collector writes graph

### C) Dashboard/API docs
Add endpoints:
- `GET /api/v1/investigations`
- `POST /api/v1/investigations` (manual)
- `GET /api/v1/investigations/:id`
- `POST /api/v1/investigations/:id/events` (attach event)
- `GET /api/v1/investigations/:id/evidence-graph`

And shift existing:
- `GET /api/v1/rca-results/:id/evidence-graph` → prefer session graph endpoint

---

## 8) Migration plan (safe, incremental)

1) Create session + join + evidence tables (no changes to ingestion yet)
2) Add `session_id` nullable to `rca_jobs` and `rca_results`
3) Backfill:
   - create 1 session per existing event/job
   - attach event to session
   - set job.session_id and result.session_id
4) Flip ingestion to always create/attach sessions
5) Make `session_id` NOT NULL on jobs/results
6) Replace UI routing: session-first

---

## 9) Hard stance: what I would NOT add yet

- A complex “incident manager” (PagerDuty clone) inside Buglens
- Auto-fix PR creation (you already chose not to)
- Full microservice dependency graphs

Those are future.

Your v2 win condition is:
**“Investigation sessions + deterministic evidence + explainable reasoning.”**

That alone is enough to sell.

