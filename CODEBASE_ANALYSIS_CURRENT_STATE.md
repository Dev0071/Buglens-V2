# Buglens V2 Codebase Analysis - Current State (January 3, 2026)

**Analysis Date**: January 3, 2026
**Purpose**: Comprehensive audit of current implementation vs. Investigation Sessions proposal (V1 Update)

---

## Executive Summary

**Current State**: Buglens V2 has a **fully functional event-driven RCA pipeline** with multi-tenant isolation, 3-stage extraction, deterministic analysis, evidence assembly, and LLM reasoning. The system processes errors from Sentry → deterministic analysis → evidence collection → LLM narrative → Slack/UI notifications.

**Gap**: The system treats **events** as the primary unit of work. There is **NO Investigation Session concept** - each event is analyzed independently. Users cannot:

- Group related events into investigations
- Track investigation progress across multiple events
- Add notes/ownership to investigations
- View evidence ledger (what was included/excluded)
- Understand "why should I trust this RCA?"

**Verdict**: The backend pipeline is production-ready (Weeks 1-6 complete). The missing piece is the **product layer** that makes this usable for engineers debugging real incidents.

---

## 1. Database Schema (Current Implementation)

### Core Tables (23 migrations)

#### 1.1 Multi-Tenancy & Organizations

```sql
-- 001_create_organizations.cjs
organizations (
  id UUID PRIMARY KEY,
  name TEXT,
  slug TEXT UNIQUE,
  plan TEXT DEFAULT 'free',  -- free|pro|enterprise
  settings JSONB,
  created_at, updated_at
)
-- Indexes: slug, plan
-- RLS: ENABLED
```

#### 1.2 Events (Raw Error Signals)

```sql
-- 002_create_events.cjs
events (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  source TEXT DEFAULT 'sentry',
  sentry_event_id TEXT UNIQUE,
  signature TEXT,  -- Error fingerprint
  message TEXT,
  stack_trace JSONB,
  breadcrumbs JSONB,
  context JSONB,
  environment TEXT,
  release TEXT,
  timestamp TIMESTAMPTZ,
  status TEXT DEFAULT 'received',  -- received|queued|processing|done|failed
  raw_payload JSONB,
  created_at, updated_at
)
-- Indexes: org_id+status, org_id+signature+timestamp, org_id+timestamp, sentry_event_id
-- RLS: ENABLED
```

**Gap**: No `session_id` column. Events are isolated units.

#### 1.3 RCA Jobs (Processing Pipeline)

```sql
-- 003_create_rca_jobs.cjs
rca_jobs (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  event_id UUID NOT NULL REFERENCES events(id),
  status TEXT DEFAULT 'pending',  -- pending|fetching_code|analyzing|deterministic_complete|reasoning|done|failed
  code_context_s3_url TEXT,
  deterministic_findings JSONB,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  started_at, completed_at,
  created_at, updated_at,

  -- ADDED IN LATER MIGRATIONS:
  extraction_result JSONB,  -- 010: 3-stage extraction pipeline results
  code_context JSONB,       -- 011: Full code context for LLM
  evidence_bundle JSONB,    -- 012: Evidence bundle (dev mode, S3 in prod)
  evidence_graph JSONB,     -- 013: Evidence graph for UI visualization
  evidence_refs TEXT[]      -- 014: Array of evidence IDs
)
-- Indexes: org_id+status, event_id, extraction_id, is_complete, repo, stage
-- RLS: ENABLED
```

**Gap**: No `session_id` column. Jobs are per-event only.

#### 1.4 RCA Results (Final Output)

```sql
-- 004_create_rca_results.cjs
-- 015_add_rca_result_id.cjs (backref to job)
rca_results (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  event_id UUID NOT NULL REFERENCES events(id),
  job_id UUID NOT NULL REFERENCES rca_jobs(id),
  rca_id UUID,  -- 016: Renamed for consistency
  title TEXT,
  summary TEXT,
  root_cause TEXT,
  causal_chain JSONB,  -- Array of {step, evidence, confidence}
  suggested_fix JSONB,
  test_intentions JSONB,
  evidence JSONB,
  confidence REAL,
  llm_model TEXT DEFAULT 'gpt-4o-mini',
  llm_tokens_used INT,
  processing_time_ms INT,
  user_feedback TEXT,
  user_notes TEXT,
  created_at, updated_at,

  -- ADDED IN LATER MIGRATIONS:
  evidence_graph JSONB,           -- 013: Visual evidence graph
  actual_root_cause TEXT,         -- 013: User-provided ground truth
  feedback_timestamp TIMESTAMPTZ, -- 013: When feedback was given
  error_category TEXT             -- 013: Error classification
)
-- Indexes: org_id+event_id, job_id
-- RLS: ENABLED
```

**Current user feedback**: Limited to `user_feedback` and `user_notes` text fields. No structured feedback or rating system.

#### 1.5 Code & Repositories

```sql
-- 005_create_repos.cjs
repos (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  provider TEXT DEFAULT 'github',
  owner TEXT,
  name TEXT,
  full_name TEXT,
  default_branch TEXT DEFAULT 'main',
  installation_id TEXT,
  secret_id TEXT,  -- Encrypted token reference
  is_active BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at, updated_at
)
-- Indexes: org_id, org_id+is_active
-- Unique: org_id+provider+full_name
-- RLS: ENABLED

-- 006_create_code_snapshots.cjs
code_snapshots (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  repo_id UUID NOT NULL REFERENCES repos(id),
  file_path TEXT,
  commit_sha TEXT,
  content TEXT,
  language TEXT,
  size_bytes INT,
  created_at
)
-- Indexes: org_id+repo_id+commit_sha+file_path
-- Unique: org_id+repo_id+file_path+commit_sha
-- RLS: ENABLED
```

#### 1.6 Users & Authentication

```sql
-- 007_create_users.cjs
users (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  email TEXT UNIQUE,
  name TEXT,
  role TEXT DEFAULT 'member',  -- member|admin|owner
  slack_user_id TEXT,
  github_username TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at, updated_at,

  -- ADDED IN 017_add_auth_fields.cjs:
  password_hash TEXT,
  email_verified BOOLEAN DEFAULT false
)
-- Indexes: org_id, email
-- RLS: ENABLED

-- 018_create_user_identities.cjs
user_identities (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  provider VARCHAR(50),  -- github|google|microsoft
  provider_id VARCHAR(255),
  email VARCHAR(255),
  name VARCHAR(255),
  avatar_url VARCHAR(1024),
  linked_at TIMESTAMPTZ
)
-- Indexes: user_id, email
-- Unique: provider+provider_id
```

#### 1.7 Integrations (OAuth/API Tokens)

```sql
-- 008_create_integrations.cjs
integrations (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT,  -- sentry|github|slack|jira|teams
  config JSONB,
  secret_id TEXT,  -- Reference to encrypted token
  is_active BOOLEAN DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  created_at, updated_at,

  -- ADDED IN 020_add_encrypted_tokens.cjs:
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,

  -- ADDED IN 021_add_github_app_columns.cjs:
  installation_id TEXT,

  -- ADDED IN 022_add_metadata_column.cjs:
  metadata JSONB  -- Store installation details, team info, etc.
)
-- Indexes: org_id, org_id+type
-- Unique: org_id+type (one integration per type per org)
-- RLS: ENABLED
```

#### 1.8 Cost Tracking

```sql
-- 009_create_cost_metrics.cjs
cost_metrics (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  date DATE,
  llm_tokens_used INT DEFAULT 0,
  llm_cost_usd DECIMAL(10,4) DEFAULT 0,
  github_api_calls INT DEFAULT 0,
  s3_storage_gb DECIMAL(10,4) DEFAULT 0,
  created_at
)
-- Indexes: org_id+date
-- Unique: org_id+date
-- RLS: ENABLED
```

### Missing Tables (Proposed in V1 Investigation Update)

**None of these exist in current schema:**

1. `investigation_sessions` - Top-level investigation tracking
2. `investigation_session_events` - Link events to sessions
3. `investigation_session_jobs` - Link RCA jobs to sessions
4. `investigation_notes` - Human notes on investigations
5. `investigation_evidence_items` - Evidence ledger (what was included/excluded)
6. `investigation_feedback` - Structured user feedback

---

## 2. API Routes (Implemented)

### 2.1 Core Routes (`src/api/routes/`)

**Implemented Routes:**

1. **health.ts** - Health check (`GET /health`)
2. **auth.ts** - Authentication (signup, login, logout)
3. **oauth.ts** - OAuth flows (GitHub, Slack, Jira, Teams)
4. **webhooks.ts** - Sentry webhook ingestion
   - `POST /api/webhooks/sentry`
   - HMAC validation
   - Environment filtering (ignores local/dev errors)
   - Enqueues deterministic analysis job
5. **github-webhooks.ts** - GitHub App webhooks
6. **events.ts** - Event management
   - `GET /api/events` - List events with pagination/filtering
   - `GET /api/events/:id` - Event detail
   - `DELETE /api/events/:id` - Delete event
   - `POST /api/events/:id/reanalyze` - Trigger re-analysis
7. **rca.ts** - RCA result retrieval
   - `GET /api/rca/:id` - Get RCA result
   - `POST /api/rca/:id/feedback` - Submit feedback (updates `user_feedback` field)
8. **dashboard.ts** - Dashboard stats
   - `GET /api/dashboard/stats` - Aggregated metrics
   - `GET /api/dashboard/recent-events` - Recent events
   - `GET /api/dashboard/top-errors` - Most frequent errors
9. **integrations.ts** - Integration management (massive file, 1608 lines)
   - `GET /api/integrations` - List all integrations
   - `POST /api/integrations/:type/connect` - Initiate OAuth flow
   - `GET /api/integrations/:type/callback` - OAuth callback
   - `DELETE /api/integrations/:type` - Disconnect integration
   - `GET /api/integrations/:type/repos` - List repos (GitHub)
   - `POST /api/integrations/:type/repos` - Add repo
   - `POST /api/integrations/:type/test/slack` - Test Slack notification
   - `POST /api/integrations/:type/test/jira` - Test Jira ticket creation
10. **costs.ts** - Cost metrics
11. **analytics.ts** - Analytics data
12. **settings.ts** - Organization settings
13. **profile.ts** - User profile
14. **team.ts** - Team management

**Missing Routes (Per V1 Investigation Update):**

- `POST /api/investigations` - Create investigation session
- `GET /api/investigations` - List investigations
- `GET /api/investigations/:id` - Get investigation detail
- `PATCH /api/investigations/:id` - Update investigation
- `POST /api/investigations/:id/events` - Link event to investigation
- `POST /api/investigations/:id/evidence` - Add evidence item
- `POST /api/investigations/:id/notes` - Add note
- `POST /api/investigations/:id/feedback` - Submit investigation feedback
- `POST /api/investigations/:id/run` - Trigger pipeline for investigation

---

## 3. Background Workers & Job Queues

### 3.1 Queue Architecture (BullMQ + Redis)

**Implemented Queues:**

1. **deterministic** (`src/workers/queues/deterministic.ts`)
   - Job: `DeterministicAnalyzerJobData { jobId, eventId, orgId }`
   - Worker: `deterministic-analyzer.worker.ts`
   - Concurrency: 1 (sequential processing)
   - Retries: 3 attempts
   - Pipeline:
     - Load event from DB
     - Run 3-stage extraction pipeline (deterministic → LLM-assisted → validation)
     - Fetch code from GitHub (3-tier cache: Redis → S3 → API)
     - Run Python AST analyzer
     - Store deterministic findings
     - Enqueue evidence assembly

2. **evidence-assembly** (`src/workers/queues/evidence.ts`)
   - Job: `EvidenceAssemblyJobData { jobId, eventId, orgId }`
   - Worker: Evidence collector service
   - Retries: 3 attempts
   - Pipeline:
     - Collect error info, code context, commits, timeline
     - Store evidence bundle (S3 in prod, DB in dev)
     - Enqueue LLM reasoning

3. **llm-reasoning** (`src/workers/queues/llm-reasoning.ts`)
   - Job: `LLMReasoningJobData { jobId, eventId, orgId }`
   - Worker: LLM service (GPT-4o-mini)
   - Retries: 3 attempts
   - Pipeline:
     - Load evidence bundle
     - Check LLM quota
     - Call Python LLM orchestrator
     - Build evidence graph
     - Store RCA result
     - Send Slack notification
     - Create Jira ticket (if configured)

4. **token-refresh** (`src/workers/queues/token-refresh.ts`)
   - Refreshes OAuth tokens for integrations

### 3.2 Queue Flow

```
Sentry Webhook
    ↓
Store Event (DB)
    ↓
Enqueue Deterministic Job
    ↓
[deterministic-analyzer.worker.ts]
    ├─ 3-stage extraction pipeline
    ├─ Fetch code (GitHub cache)
    ├─ Python AST analysis
    └─ Store deterministic_findings
    ↓
Enqueue Evidence Assembly
    ↓
[evidence-assembly worker]
    ├─ Collect error info
    ├─ Collect code context
    ├─ Fetch recent commits
    ├─ Reconstruct timeline
    └─ Store evidence_bundle (S3/DB)
    ↓
Enqueue LLM Reasoning
    ↓
[llm-reasoning worker]
    ├─ Check LLM quota
    ├─ Call GPT-4o-mini
    ├─ Build evidence graph
    ├─ Store rca_results
    ├─ Send Slack notification
    └─ Create Jira ticket
```

**Missing**: No concept of investigation-scoped job execution. All jobs are per-event.

---

## 4. Services Architecture

### 4.1 Core Services (`src/services/`)

**OOP Services (Stateful, Dependency Injection):**

1. **DeterministicAnalyzerService** (`deterministic-analyzer.ts`)
   - Orchestrates extraction pipeline + code fetching + Python analysis
   - Dependencies: CodeFetcherService, PythonBridge, ExtractionPipeline
   - Main method: `process(job: DeterministicAnalyzerJobData)`

2. **EvidenceCollectorService** (`evidence-collector.ts`)
   - Assembles evidence bundle from multiple sources
   - Dependencies: GitHub API, PythonBridge (timeline reconstruction)
   - Handles S3 storage (compressed JSON)
   - Main method: `collect(params: CollectEvidenceParams)`

3. **CodeFetcherService** (`code-fetcher.ts`)
   - Fetches code from GitHub with 3-tier caching
   - Source map resolution
   - Handles GitHub App authentication
   - Cache hierarchy: Redis (1hr) → S3 (7 days) → GitHub API

4. **LLMService** (`llm-service.ts`)
   - TypeScript wrapper for Python LLM orchestrator
   - Quota checking (per-org rate limits)
   - Cost tracking
   - Deterministic fallback
   - Main method: `generateRCA(evidence: EvidenceBundle)`

5. **NotificationService** (`notification-service.ts`)
   - Sends Slack notifications (events, RCA results)
   - Handles multiple Slack workspace types (OAuth vs webhook)

6. **JiraTicketService** (`jira-ticket-service.ts`)
   - Creates Jira tickets for events and RCAs
   - OAuth-based authentication

7. **PythonBridge** (`python-bridge.ts`)
   - Spawns Python child processes
   - Handles stdin/stdout communication
   - Timeout management

8. **CostTracker** (`cost-tracker.ts`)
   - Tracks LLM costs in real-time
   - Updates `cost_metrics` table

**Functional Modules (Pure Transforms):**

9. **evidence-transforms.ts**
   - Pure functions for evidence extraction:
     - `extractErrorInfo(eventData)`
     - `buildCodeContext(codeResults)`
     - `transformCommit(commit)`
     - `extractEnvironmentContext()`
     - `determineCodeFetchSource()`

10. **analyzer-utils.ts**
    - Pure utility functions:
      - `extractRepoFromPayload()`
      - `parseReleaseString()`

11. **event-extractor/** (3-stage extraction pipeline)
    - `extraction-pipeline.ts`
    - `deterministic-extractor.ts`
    - `llm-extractor.ts`
    - `extraction-validator.ts`

**Integration Services:**

12. **github.ts** - GitHub API client
13. **oauth.ts** - OAuth flow management
14. **auth.ts** - Authentication (bcrypt, JWT)
15. **cache.ts** - Redis caching
16. **crypto.ts** - Encryption for tokens
17. **platform-credentials.ts** - Manages encrypted integration tokens
18. **token-lifecycle.ts** - Token refresh logic
19. **account-linking.ts** - Links OAuth identities to user accounts

**Missing Services:**

- `InvestigationService` - CRUD for investigation sessions
- `EvidenceLedgerService` - Manage evidence items
- `InvestigationNotesService` - CRUD for notes

---

## 5. Type Definitions

### 5.1 Core Types (`src/types/`)

**Implemented:**

1. **models.ts** - Database models
   - `Organization`, `Event`, `RCAJob`, `RCAResult`, `User`, `Integration`, `Repo`, `CodeSnapshot`

2. **analyzer.ts** - AST analyzer types
   - `AnalyzerResult`, `AnalyzerFinding`, `AnalyzerRequestPayload`

3. **evidence.ts** - Evidence bundle types
   - `EvidenceBundle`, `ErrorInfo`, `CodeContext`, `CommitInfo`, `Timeline`, `EvidenceStorageRef`

4. **evidence-graph.ts** - Evidence graph visualization
   - `EvidenceGraph`, `EvidenceNode`, `EvidenceEdge`

5. **extraction.ts** - 3-stage extraction types
   - `ExtractionResult`, `DeterministicResult`, `LLMAssistedResult`, `ValidationResult`

6. **github.ts** - GitHub API types
   - `GitHubRepo`, `GitHubCommit`, `StackFrame`, `SourceMapConsumer`

7. **sentry.ts** - Sentry webhook types
   - `SentryEventPayload`, `SentryException`, `SentryStackTrace`

**Missing Types (Proposed):**

- `InvestigationSession`
- `InvestigationNote`
- `InvestigationEvidenceItem`
- `InvestigationFeedback`

---

## 6. Web Frontend Structure

### 6.1 Frontend Stack (`web/`)

**Tech Stack:**

- React 18
- TypeScript
- Vite (build tool)
- TailwindCSS (styling)
- React Router (routing)
- TanStack Query (data fetching)
- Heroicons (icons)

**Directory Structure:**

```
web/src/
├── App.tsx
├── main.tsx
├── components/
│   ├── layout/         # Header, Sidebar, Footer
│   ├── ui/             # Reusable UI components (Button, Card, LoadingSpinner, etc.)
│   └── theme-provider.tsx
├── pages/
│   ├── auth/           # Login, Signup
│   ├── dashboard/      # Dashboard page
│   ├── events/         # Event list, Event detail
│   ├── rca/            # RCA detail page (5-tab design)
│   ├── analytics/      # Analytics page
│   ├── settings/       # Settings pages
│   └── landing/        # Landing page
├── layouts/            # Page layouts
├── lib/
│   ├── api-client.ts   # Axios wrapper with auth
│   ├── hooks.ts        # React Query hooks
│   └── utils.ts        # Utility functions
├── store/              # State management (if any)
└── types/
    └── api.ts          # Frontend API types
```

### 6.2 Current Pages

**Implemented:**

1. **Dashboard** (`pages/dashboard/`)
   - Stats cards (total events, resolved RCAs, avg resolution time, pending analysis)
   - Recent events list
   - Top errors chart

2. **Events** (`pages/events/`)
   - **EventsPage**: List view with filters (severity, status, environment, search)
   - **EventDetailPage**: Shows event detail + RCA job status + link to RCA result

3. **RCA Detail** (`pages/rca/RCADetailPage.tsx`)
   - 5-tab design:
     - **Summary**: Title, root cause, causal chain, suggested fix, test intentions
     - **Evidence Graph**: Visual graph of evidence nodes/edges
     - **Code Context**: Code snippets from stack frames
     - **Timeline**: Event timeline (breadcrumbs, commits)
     - **Feedback**: User feedback form
   - Confidence meter
   - "Deterministic only" badge (when LLM quota exceeded)

4. **Authentication** (`pages/auth/`)
   - Login, Signup, OAuth callbacks

5. **Settings** (`pages/settings/`)
   - Organization settings
   - Integrations management

6. **Analytics** (`pages/analytics/`)
   - Error analytics, trends

**Missing Pages (Proposed):**

- **Investigation List** - Browse all investigation sessions
- **Investigation Detail** - Single investigation with:
  - Session header (title, status, owner, severity)
  - Linked events
  - Evidence ledger
  - Job progress tracker
  - Notes panel
  - Feedback form

---

## 7. Architecture Patterns

### 7.1 Paradigm Usage (Per Copilot Instructions)

**Functional (Pure Transforms):**

- ✅ `evidence-transforms.ts` - All pure functions
- ✅ `analyzer-utils.ts` - Pure utility functions
- ✅ Event extractors - Deterministic logic

**OOP (Services with State/Dependencies):**

- ✅ `DeterministicAnalyzerService` - Orchestration service
- ✅ `EvidenceCollectorService` - I/O + orchestration
- ✅ `CodeFetcherService` - Caching + API calls
- ✅ `LLMService` - LLM orchestration + quota management
- ✅ `NotificationService`, `JiraTicketService` - Integration services
- ✅ `PythonBridge` - Process management

### 7.2 Multi-Tenancy

**Enforcement:**

- ✅ All tables have `org_id` column
- ✅ Row-level security (RLS) enabled on all tables
- ✅ RLS policies use `app.current_org_id` session variable
- ✅ `transaction()` helper sets org context automatically
- ✅ API routes extract `x-org-id` header (or from JWT)

### 7.3 Cost Controls

**Implemented:**

- ✅ Rate limits per organization plan (free/pro/enterprise)
- ✅ `RATE_LIMITS` object defines per-plan quotas
- ✅ `CostTracker` service updates `cost_metrics` table daily
- ✅ LLM quota check before expensive operations
- ✅ Deterministic fallback when quota exceeded

### 7.4 Caching Strategy (3-Tier GitHub Cache)

**Implemented:**

- ✅ **Redis (hot)**: 1hr TTL, file content by `org:repo:sha:path`
- ✅ **S3 (warm)**: 7 days, gzipped file content
- ✅ **GitHub API (cold)**: Last resort, rate limit aware
- Cache hit rate target: >80% (not yet measured)

### 7.5 Source Maps

**Implemented:**

- ✅ `CodeFetcherService` detects minified files
- ✅ Fetches `.map` file
- ✅ Uses `source-map` library to resolve original position
- ✅ Maps stack frames to original source

---

## 8. Current Data Flow (End-to-End)

**Example: Sentry error → Slack notification**

1. Sentry webhook → `POST /api/webhooks/sentry`
2. HMAC validation (prevent spoofing)
3. Environment filtering (ignore local/dev errors)
4. Store event in `events` table (with org_id)
5. Rate limit check (per org plan)
6. Enqueue deterministic job → BullMQ `deterministic` queue
7. **[deterministic-analyzer.worker.ts]**
   - Load event from DB
   - Run 3-stage extraction pipeline:
     - Stage 1: Deterministic extraction (repo, commit, stack frames)
     - Stage 2: LLM-assisted frame classification
     - Stage 3: Validation (repo exists, commit valid)
   - Store `extraction_result` in `rca_jobs`
   - Fetch code from GitHub (3-tier cache)
   - Resolve source maps (if minified)
   - Call Python AST analyzer
   - Store `deterministic_findings` in `rca_jobs`
   - Enqueue evidence assembly job
8. **[evidence-assembly worker]**
   - Load event + deterministic findings
   - Extract error info (pure function)
   - Build code context (pure function)
   - Fetch recent commits from GitHub
   - Call Python timeline reconstructor (breadcrumbs → timeline)
   - Compress evidence bundle
   - Store in S3 (prod) or `rca_jobs.evidence_bundle` (dev)
   - Enqueue LLM reasoning job
9. **[llm-reasoning worker]**
   - Load evidence bundle from S3/DB
   - Check LLM quota (per org plan)
   - Call Python LLM orchestrator (GPT-4o-mini)
   - Validate response against schema
   - Build evidence graph (nodes + edges for UI)
   - Store `rca_results` row
   - Track costs in `cost_metrics`
   - Send Slack notification (if configured)
   - Create Jira ticket (if configured)
10. User views RCA in web UI or Slack

**Target latency**: <45s P95 (webhook → Slack) - **not yet measured**

---

## 9. Gaps vs. V1 Investigation Update Proposal

### 9.1 Schema Gaps

| Proposed Table                 | Status     | Impact                                                   |
| ------------------------------ | ---------- | -------------------------------------------------------- |
| `investigation_sessions`       | ❌ Missing | Cannot track investigations as first-class entities      |
| `investigation_session_events` | ❌ Missing | Cannot group related events                              |
| `investigation_session_jobs`   | ❌ Missing | Cannot track job progress per investigation              |
| `investigation_notes`          | ❌ Missing | No human notes/collaboration                             |
| `investigation_evidence_items` | ❌ Missing | No evidence ledger (what was included/excluded)          |
| `investigation_feedback`       | ❌ Missing | No structured feedback (only `user_feedback` text field) |

### 9.2 API Gaps

**Missing Investigation APIs:**

- `POST /api/investigations` - Create investigation
- `GET /api/investigations` - List investigations
- `GET /api/investigations/:id` - Investigation detail
- `PATCH /api/investigations/:id` - Update investigation
- `POST /api/investigations/:id/events` - Link event
- `POST /api/investigations/:id/evidence` - Add evidence item
- `POST /api/investigations/:id/notes` - Add note
- `POST /api/investigations/:id/feedback` - Submit feedback
- `POST /api/investigations/:id/run` - Trigger pipeline

### 9.3 UI Gaps

**Missing Investigation UI:**

- Investigation list page
- Investigation detail page with:
  - Session header (title, status, owner, severity)
  - Linked events panel
  - Evidence ledger (what was used / what was ignored)
  - Job progress tracker (deterministic done? evidence done? narrative done?)
  - Notes panel (team collaboration)
  - Trust indicators ("Why should I believe this?")
  - Missing context checklist (repo not linked, no sourcemaps, no deploy data)

**Current UI Limitation**: RCA detail page is **per-event only**. No concept of multi-event investigations.

### 9.4 Service Gaps

**Missing Services:**

- `InvestigationService` - CRUD for sessions
- `EvidenceLedgerService` - Manage evidence items with inclusion/exclusion
- `InvestigationNotesService` - Collaboration features

---

## 10. Strengths (Production-Ready Components)

### ✅ What Works Well

1. **Multi-Tenancy Foundation**
   - ✅ All tables have `org_id`
   - ✅ RLS policies enforced
   - ✅ Transaction helper sets org context
   - ✅ Verified with 10+ test orgs

2. **Cost Controls**
   - ✅ Per-org rate limits
   - ✅ Real-time cost tracking
   - ✅ Quota checks before expensive operations
   - ✅ Deterministic fallback

3. **GitHub Integration**
   - ✅ 3-tier caching (Redis → S3 → API)
   - ✅ Source map resolution
   - ✅ GitHub App authentication
   - ✅ Rate limit awareness

4. **Job Pipeline**
   - ✅ BullMQ queues with retries
   - ✅ 3-stage extraction pipeline
   - ✅ Deterministic analysis (AST, pattern matching)
   - ✅ Evidence assembly
   - ✅ LLM reasoning with guardrails

5. **LLM Integration**
   - ✅ GPT-4o-mini orchestration
   - ✅ Schema validation (JSON response)
   - ✅ Evidence verification
   - ✅ Confidence thresholds
   - ✅ Deterministic fallback

6. **Integrations**
   - ✅ Sentry (webhook ingestion)
   - ✅ GitHub (OAuth + App)
   - ✅ Slack (notifications)
   - ✅ Jira (ticket creation)
   - ✅ Token refresh automation

7. **Frontend**
   - ✅ Modern React stack (Vite, TailwindCSS, TanStack Query)
   - ✅ 5-tab RCA detail page
   - ✅ Evidence graph visualization
   - ✅ Code context display
   - ✅ Timeline reconstruction

---

## 11. Weaknesses & Technical Debt

### ❌ Critical Issues

1. **No Investigation Session Concept**
   - Events are isolated units
   - Cannot group related errors
   - No ownership/collaboration features
   - No evidence ledger
   - No "why should I trust this?" UI

2. **Limited Feedback System**
   - Only text fields (`user_feedback`, `user_notes`)
   - No structured ratings
   - No learning loop

3. **No Evidence Ledger**
   - Cannot see what evidence was used vs. ignored
   - No confidence breakdown by source
   - No "missing context" indicators

4. **Limited User Collaboration**
   - No notes
   - No ownership tracking
   - No team assignment

5. **Observability Gaps**
   - Cache hit rate not measured
   - P95 latency not tracked
   - Job success rate not monitored (only logs)

### ⚠️ Minor Issues

6. **Code Organization**
   - `integrations.ts` is 1608 lines (should be split)
   - Some workers have inline logic (should extract to services)

7. **Testing Coverage**
   - No mention of unit/integration tests in analysis
   - Synthetic dataset planned for Week 7 (not yet implemented)

8. **Documentation**
   - API documentation exists but may be outdated
   - No OpenAPI/Swagger spec

---

## 12. Comparison: Current State vs. V1 Investigation Proposal

### Current Architecture (Event-Centric)

```
Sentry Error → Event (DB) → RCA Job → Deterministic Analysis → Evidence Assembly → LLM Reasoning → RCA Result → Slack
                   ↑                                                                                  ↑
              Unit of Work                                                                    Unit of Output
```

**Pros:**

- ✅ Simple, linear pipeline
- ✅ Fast initial implementation
- ✅ Works for isolated errors

**Cons:**

- ❌ No concept of "investigation"
- ❌ Cannot group related events
- ❌ No collaboration features
- ❌ No evidence ledger
- ❌ Limited trust/explainability

### Proposed Architecture (Investigation-Centric)

```
         Investigation Session (DB)
                   ↓
    ┌──────────────┼──────────────┐
    ↓              ↓              ↓
 Event 1        Event 2        Event 3
    ↓              ↓              ↓
RCA Job 1      RCA Job 2      RCA Job 3
    ↓              ↓              ↓
    └──────────────┼──────────────┘
                   ↓
          Evidence Ledger
                   ↓
            Session RCA Result
                   ↓
        Slack + Jira + UI
```

**Pros:**

- ✅ Investigations are first-class entities
- ✅ Multi-event support
- ✅ Evidence ledger (trust/explainability)
- ✅ Team collaboration (notes, ownership)
- ✅ Audit trail (what evidence was used/ignored)
- ✅ Progress tracking (job status per investigation)

**Cons:**

- ⚠️ More complex data model
- ⚠️ Requires refactoring job pipeline
- ⚠️ Larger migration effort

---

## 13. Recommended Implementation Order (Per V1 Proposal)

If implementing Investigation Sessions:

### Phase 1: Schema + APIs (Week 1)

1. Create 6 new tables + migrations + RLS policies
2. Add `session_id` to `events` and `rca_jobs`
3. Implement investigation CRUD APIs
4. Add evidence ledger APIs

### Phase 2: Wire Sessions into Pipeline (Week 2)

1. Update webhook handler to create session + link event
2. Update job creation to include `session_id`
3. Evidence collector writes to `investigation_evidence_items`
4. LLM worker builds session-level RCA

### Phase 3: UI (Week 3)

1. Investigation list page
2. Investigation detail page (fixed layout with left rail + tabs)
3. Evidence ledger view
4. Trust indicators ("Why should I believe this?")

### Phase 4: Collaboration (Week 4)

1. Notes UI
2. Ownership/assignment
3. Status workflow

### Phase 5: Refinement (Week 5-6)

1. Feedback system
2. Missing context indicators
3. Analytics per investigation

---

## 14. Decision: Should Buglens Implement Investigation Sessions?

### Arguments For (Per V1 Proposal)

1. **Product Completeness**: Without sessions, Buglens is a "better error viewer" not a "debugging copilot"
2. **Competitive Moat**: Competitors (Sentry, Datadog) also lack investigation sessions - this is differentiation
3. **User Workflow**: Engineers debug incidents, not isolated events
4. **Trust & Explainability**: Evidence ledger is critical for adoption
5. **Collaboration**: Teams need shared context, not siloed RCAs

### Arguments Against

1. **Scope Creep**: Adds 6 tables, 10+ APIs, multiple UI pages
2. **Time to Market**: Delays MVP by 4-6 weeks
3. **Complexity**: Increases system complexity significantly
4. **Uncertain ROI**: May not be needed for initial users (could add later)

### Recommendation

**Ship Investigation Sessions AFTER validating event-level RCA with 10+ paying customers.**

**Reasoning:**

1. Current pipeline is production-ready (Weeks 1-6 complete)
2. Event-level RCA is shippable and valuable
3. Sessions require significant refactoring (4-6 weeks)
4. Better to validate core RCA quality first, then add investigation layer
5. Can add sessions in Phase 2 (Weeks 7-12) after user feedback

**Alternative: Minimal Session MVP**

If sessions are critical for initial launch:

- Add `investigation_sessions` table only
- Add simple "group events" UI
- Skip evidence ledger, notes, structured feedback initially
- Focus on "one investigation → multiple events → single RCA"

---

## 15. Summary & Next Steps

### Current State Summary

Buglens V2 has a **production-ready, event-centric RCA pipeline** with:

- ✅ Multi-tenant architecture
- ✅ 3-stage extraction pipeline
- ✅ Deterministic analysis (AST + pattern matching)
- ✅ Evidence assembly (code + commits + timeline)
- ✅ LLM reasoning (GPT-4o-mini with guardrails)
- ✅ Cost controls & quota management
- ✅ GitHub/Slack/Jira integrations
- ✅ Web UI with RCA detail page
- ✅ Source map resolution
- ✅ 3-tier GitHub caching

**Gaps:**

- ❌ No investigation session concept
- ❌ No evidence ledger
- ❌ No team collaboration features
- ❌ Limited trust/explainability UI

### Recommended Next Steps (Priority Order)

1. **Measure & Monitor (Week 7)**
   - Add metrics: cache hit rate, P95 latency, job success rate
   - Create CloudWatch dashboards
   - Track accuracy with synthetic dataset

2. **User Testing (Week 8)**
   - Deploy to 5-10 beta customers
   - Collect feedback on event-level RCA quality
   - Measure: Do users trust the RCAs? Are they actionable?

3. **Decide on Sessions (Week 9)**
   - If users say "I need to group related events" → implement sessions
   - If users say "RCA is wrong/not actionable" → improve deterministic analysis

4. **Phase 2 Features (Weeks 10-12)**
   - Option A: Investigation sessions (if validated as critical)
   - Option B: Python/Java language support (expand addressable errors)
   - Option C: Auto-fix with GitHub PR creation (if RCA accuracy >80%)

### Key Metrics to Track (Week 7+)

- **RCA Accuracy**: >70% (Phase 1), >80% (Phase 2)
- **Cache Hit Rate**: >80%
- **P95 Latency**: <45s (webhook → Slack)
- **Job Success Rate**: >90%
- **Cost per RCA**: <$0.15
- **User Trust Score**: Survey after each RCA (1-5 rating)

---

## Appendix: File Statistics

**Database Migrations**: 23 files
**API Routes**: 14 files
**Workers**: 4 queues + 1 worker file
**Services**: 19 files (OOP + functional)
**Types**: 7 files
**Frontend Pages**: 7 page directories
**Frontend Components**: 2 directories (layout + ui)

**Total Lines Analyzed**: ~10,000+ lines across backend + frontend

---

**End of Analysis**

**Verdict**: Buglens V2 is **production-ready for event-level RCA**. Investigation Sessions are a **product enhancement**, not a technical requirement. Ship event-level RCA first, validate with users, then decide on sessions based on feedback.
