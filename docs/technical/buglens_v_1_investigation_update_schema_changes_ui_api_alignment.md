# Buglens v1 Investigation Update (for March 1)

This is the **exact** set of schema changes + API/UI alignment I’d ship to make “Investigation Sessions” real, trustworthy, and shippable.

---

## 0) Brutal take: what’s missing today

Right now your backend is strong on **event ingestion → job orchestration → deterministic analysis → evidence assembly → LLM narrative** (queues, retries, cost controls, multi-tenancy) fileciteturn11file2L24-L30 fileciteturn11file14L58-L72.

But the product will still feel like a demo unless you add a first-class “Investigation Session” layer. Without sessions, users are forced back into the context-switching hell you’re claiming to solve.

Also: your DB schema currently defines **events, rca_jobs, rca_results, repos, code_snapshots, integrations** fileciteturn11file0L42-L95 — but **nothing** that represents:

- the investigation itself (who started it, what it’s about)
- the evolving hypothesis, notes, and decisions
- what evidence was included/excluded and why
- confidence and change-over-time

That’s why I’d prioritize sessions over “more AI.”

---

## 1) Principles for sessions (trust + speed)

1) **Sessions are the unit of work**, not events. Events are raw signals.
2) Every session must be **audit-able** (what evidence did we use, what did we ignore, which jobs ran, what changed).
3) Sessions must support **partial completeness** (investigation can start before all evidence finishes).
4) Keep the DB **normalized** for queryability; keep heavy blobs in object storage.

---

## 2) Exact schema changes (Postgres)

Your multi-tenancy rule is correct: every table includes `org_id` fileciteturn11file0L14-L19.

### 2.1 New table: `investigation_sessions`

Purpose: top-level “case file” that the UI revolves around.

```sql
CREATE TABLE investigation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),

  -- Human meaning
  title TEXT NOT NULL,
  description TEXT,

  -- Why this exists
  trigger_source TEXT NOT NULL,              -- 'sentry' | 'datadog' | 'manual' | ...
  trigger_event_id UUID REFERENCES events(id),
  severity TEXT NOT NULL DEFAULT 'medium',   -- 'low'|'medium'|'high'|'critical'
  environment TEXT,                          -- prod/staging/dev (copy from event)

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'open',        -- 'open'|'triaging'|'investigating'|'mitigated'|'resolved'|'closed'
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,

  -- Ownership
  created_by_user_id UUID REFERENCES users(id),
  owner_user_id UUID REFERENCES users(id),

  -- UI helpers
  tags TEXT[] NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_investigation_sessions_org_status
  ON investigation_sessions(org_id, status, created_at DESC);
```

### 2.2 New table: `investigation_session_events`

Purpose: link many events to one session (because a session is rarely one event).

```sql
CREATE TABLE investigation_session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  session_id UUID NOT NULL REFERENCES investigation_sessions(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  role TEXT NOT NULL DEFAULT 'related',   -- 'trigger'|'related'|'supporting'
  added_by_user_id UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(org_id, session_id, event_id)
);

CREATE INDEX idx_session_events_org_session
  ON investigation_session_events(org_id, session_id, created_at ASC);
```

### 2.3 New table: `investigation_session_jobs`

Purpose: map jobs/results to the session and enable “progress view”.

Your jobs are per event today (`rca_jobs.event_id`) fileciteturn11file0L53-L61. Keep that, but add a session link.

```sql
ALTER TABLE rca_jobs
  ADD COLUMN session_id UUID REFERENCES investigation_sessions(id);

CREATE INDEX idx_rca_jobs_org_session
  ON rca_jobs(org_id, session_id, created_at DESC);

-- Optional (cleaner audit): explicit mapping table
CREATE TABLE investigation_session_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  session_id UUID NOT NULL REFERENCES investigation_sessions(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES rca_jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, session_id, job_id)
);
```

### 2.4 New table: `investigation_notes`

Purpose: let humans do human work. If this doesn’t exist, you lose adoption.

```sql
CREATE TABLE investigation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  session_id UUID NOT NULL REFERENCES investigation_sessions(id) ON DELETE CASCADE,

  author_user_id UUID REFERENCES users(id),
  body TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_investigation_notes_org_session
  ON investigation_notes(org_id, session_id, created_at ASC);
```

### 2.5 New table: `investigation_evidence_items`

Purpose: a session needs an **evidence ledger** so the system is explainable.

Store pointers, not blobs.

```sql
CREATE TABLE investigation_evidence_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  session_id UUID NOT NULL REFERENCES investigation_sessions(id) ON DELETE CASCADE,

  -- Evidence identity
  kind TEXT NOT NULL,             -- 'stack_frame'|'code_file'|'commit'|'deploy'|'log'|'trace'|'config'|'link'
  source TEXT NOT NULL,           -- 'sentry'|'github'|'datadog'|'manual'

  -- Minimal addressable pointer
  ref JSONB NOT NULL,             -- e.g. {repo_full_name, sha, path, start_line, end_line}

  -- Presentation
  title TEXT,
  summary TEXT,

  -- Trust controls
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50,
  included BOOLEAN NOT NULL DEFAULT true,
  exclusion_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evidence_items_org_session
  ON investigation_evidence_items(org_id, session_id, created_at ASC);
```

### 2.6 New table: `investigation_feedback`

Purpose: the learning loop without auto-fixing. Also critical for trust.

```sql
CREATE TABLE investigation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  session_id UUID NOT NULL REFERENCES investigation_sessions(id) ON DELETE CASCADE,

  user_id UUID REFERENCES users(id),

  -- What was rated
  target TEXT NOT NULL,           -- 'rca_summary'|'suggested_fix'|'evidence'|'overall'
  rating INT NOT NULL,            -- 1..5
  reason TEXT,

  -- Optional: capture what was accepted/ignored
  accepted BOOLEAN,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_org_session
  ON investigation_feedback(org_id, session_id, created_at DESC);
```

---

## 3) What to remove / change in existing schema

### 3.1 Stop stuffing “session-like” things into `rca_results.result`

You already have `rca_results.result JSONB` fileciteturn11file0L63-L72. That’s fine for the model output, but **do not** let it become the canonical store for:

- notes
- ownership
- session state
- evidence inclusion/exclusion

Those need first-class tables for queryability and trust.

### 3.2 Add `session_id` to `events` (optional but useful)

If you expect 80% of events to be “unassigned noise,” don’t do this.

If you expect you’ll group events into sessions often, add:

```sql
ALTER TABLE events ADD COLUMN session_id UUID REFERENCES investigation_sessions(id);
CREATE INDEX idx_events_org_session ON events(org_id, session_id, created_at DESC);
```

But keep the mapping table either way (`investigation_session_events`) because one event can be relevant to multiple sessions.

---

## 4) Backend APIs (minimum set for March 1)

You already have the webhook/event pipeline storing events + jobs fileciteturn11file0L42-L61. Now expose sessions as a product surface.

### 4.1 Session CRUD

- `POST /api/orgs/:orgId/investigations`
  - body: `{ title, description?, trigger_source, trigger_event_id?, severity?, environment? }`
  - creates session, optionally links trigger event

- `GET /api/orgs/:orgId/investigations?status=&q=&severity=&env=`
  - list view

- `GET /api/orgs/:orgId/investigations/:sessionId`
  - returns session + summary counts + latest RCA state

- `PATCH /api/orgs/:orgId/investigations/:sessionId`
  - update title/status/owner/tags

### 4.2 Evidence + events linking

- `POST /api/orgs/:orgId/investigations/:sessionId/events`
  - body: `{ event_id, role }`

- `POST /api/orgs/:orgId/investigations/:sessionId/evidence`
  - body: `{ kind, source, ref, title?, summary?, included?, confidence? }`

- `PATCH /api/orgs/:orgId/investigations/:sessionId/evidence/:id`
  - toggle included/exclusion_reason

### 4.3 Notes + feedback

- `POST /api/orgs/:orgId/investigations/:sessionId/notes`
- `GET /api/orgs/:orgId/investigations/:sessionId/notes`

- `POST /api/orgs/:orgId/investigations/:sessionId/feedback`

### 4.4 Trigger pipelines from session (key UX)

- `POST /api/orgs/:orgId/investigations/:sessionId/run`
  - enqueues deterministic → evidence assembly → llm reasoning using existing queues/workers fileciteturn11file2L63-L85

---

## 5) UI changes to “nail the investigation update”

I’m not guessing the visuals; I’m telling you what matters for adoption.

### 5.1 Your UI must center on **one screen**

If users still need to bounce between:
- Sentry issue
- GitHub file
- deploy log
- Slack thread

…you haven’t shipped the product.

So the Investigation page needs **a fixed layout**:

#### Left rail (always visible)
- Session status + owner + severity
- Linked events count + “add event”
- Evidence health indicator (how complete is context?)
- Job progress (deterministic done? evidence done? narrative done?)

#### Main panel (tabs)
- **Summary**: narrative + top 3 causal signals + recommended next action
- **Evidence**: ledger view (what we used / what we ignored)
- **Code context**: file snippets, stack frames, jump links
- **Timeline**: event spikes + deploy markers
- **Findings**: deterministic findings first; LLM narrative second

### 5.2 Trust UI (non-negotiable)

Add an explicit “Why should I believe this?” card:
- Evidence count by type (commits/files/events)
- Confidence score + what drove it (deterministic hits, stack confidence, sourcemap resolved, etc.)
- “Missing context” checklist (repo not linked, no sourcemaps, no deploy data)

This aligns with your deterministic-first philosophy fileciteturn11file11L11-L15.

### 5.3 Kill auto-fix fantasies in v1 UI

You can suggest patches later, but for March 1:
- show *suggested change* as a constrained snippet
- show *test intent* (what to verify)
- require explicit user action (copy/apply)

Anything more destroys trust.

---

## 6) Mapping UI sections to backend APIs + schemas

### Investigation List
- API: `GET /investigations`
- Schema: `investigation_sessions`
- Derived fields:
  - `open_findings_count` (from latest `rca_results` for session)
  - `linked_events_count` (from `investigation_session_events`)

### Investigation Detail (header)
- API: `GET /investigations/:id`
- Schema: `investigation_sessions`

### Evidence Ledger
- API: `GET /investigations/:id` (embed evidence) or `GET /investigations/:id/evidence`
- Schema: `investigation_evidence_items`

### Notes
- API: `/notes`
- Schema: `investigation_notes`

### Feedback
- API: `/feedback`
- Schema: `investigation_feedback`

---

## 7) Implementation order (best sequence)

If you do this in the wrong order you’ll thrash.

1) **Schema + migrations + RLS policies** (sessions + mapping tables)
2) **Session APIs** (CRUD + link events)
3) **Wire session_id into job creation** (rca_jobs.session_id)
4) **Evidence ledger writes** (EvidenceAssemblerWorker writes evidence items)
5) **UI list + detail page** (even if summary is placeholder)
6) **Trust indicators + progress states** (job pipeline surfaced)
7) **Notes + feedback**

---

## 8) Caveats you should know before building

- **Evidence will be incomplete often.** Design for “partial truth,” not “perfect RCA.”
- **Sourcemaps/repo mapping is the real unlock** (you’ve already hit this with Next.js bundled paths). Your session model must display “can’t resolve source → here’s why.”
- **Don’t let the LLM become your integration glue.** Use deterministic extractors for: repo, commit SHA, file paths.
- **Cost control must be visible in admin**, since you already track cost metrics fileciteturn11file6L122-L131.

---

## 9) What I’d cut before March 1 (to ship)

Cut anything not required for the “single investigation screen”:

- evidence graph visualization (store ledger first; graph later)
- IDE extensions
- prediction
- auto PRs

If March 1 is real, your wedge is:

**Investigation Sessions + Evidence Ledger + Deterministic Findings + Clear Suggested Next Steps.**

That’s a product.

