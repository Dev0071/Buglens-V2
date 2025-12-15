# BUGLENS — Phase 1 Roadmap (Weeks 1-6)

## Ship Core RCA Pipeline

**Revised: November 2025**

---

## Phase 1 Goal

Build a working end-to-end RCA pipeline for **JavaScript/TypeScript errors from Sentry** with deterministic analysis + GPT-4o-mini reasoning, delivered via Slack and minimal web UI.

**Scope Constraints:**

- **Language:** JS/TS only (Node.js, React, etc.)
- **Error Source:** Sentry only
- **LLM:** GPT-4o-mini only (no local models)
- **Code Source:** GitHub only
- **Delivery:** Slack + basic web UI

---

## Stack Decisions (Fixed & Final)

### Architecture Pattern

**Modular Monolith** — Single Node.js/TypeScript application with embedded Python workers.

**Structure:**

```
buglens/
├── src/
│   ├── api/           # Fastify API server
│   ├── workers/       # BullMQ job processors
│   ├── services/      # Business logic
│   ├── integrations/  # Sentry, GitHub, Slack clients
│   └── db/            # Postgres models & migrations
├── python/
│   ├── analyzers/     # AST analysis, deterministic rules
│   ├── llm/           # GPT-4o-mini orchestration
│   └── timeline/      # Log reconstruction
└── web/               # React frontend (separate deployment)
```

**Why monolith?**

- Simpler deployment (1 service vs 3-5)
- Easier debugging and development
- Lower ops overhead
- Can split later if needed

**Python Integration:**

- Called via child_process from Node.js workers
- Communicates via stdin/stdout JSON
- Python dependencies managed separately (venv)
- Stateless execution (no shared state)

---

### Backend Stack

| Component          | Technology                         | Rationale                                        |
| ------------------ | ---------------------------------- | ------------------------------------------------ |
| **API Server**     | Fastify + TypeScript               | Fast, low overhead, excellent TypeScript support |
| **Queue**          | BullMQ + Redis                     | Battle-tested, built-in retries, good dashboard  |
| **Database**       | PostgreSQL 15+                     | JSONB for flexible schema, robust ACID           |
| **Cache**          | Redis                              | Single instance, shared with BullMQ              |
| **Object Storage** | AWS S3                             | Code snapshots, evidence bundles                 |
| **Search**         | Postgres pg_trgm                   | Avoid ES complexity for MVP                      |
| **Python Runtime** | Python 3.11 + FastAPI (for future) | Tree-sitter, AST libs, LLM clients               |

---

### Frontend Stack

| Component     | Technology            |
| ------------- | --------------------- |
| **Framework** | React 18 + TypeScript |
| **Build**     | Vite                  |
| **Styling**   | Tailwind CSS          |
| **State**     | React Query + Zustand |
| **Routing**   | React Router v6       |

---

### Infrastructure

| Component      | Technology          | Notes                    |
| -------------- | ------------------- | ------------------------ |
| **Hosting**    | AWS ECS Fargate     | Simpler than EKS for MVP |
| **IaC**        | Terraform           | All infra as code        |
| **CI/CD**      | GitHub Actions      | Build, test, deploy      |
| **Secrets**    | AWS Secrets Manager | Never commit tokens      |
| **Monitoring** | CloudWatch + Sentry | Use our own dogfood      |
| **Logs**       | CloudWatch Logs     | Centralized logging      |

---

## Multi-Tenancy Design (Critical)

**Every table gets org_id from Day 1.**

### Core Schema Additions

```sql
-- Organizations table
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'free', -- free, pro, enterprise
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add org_id to ALL tables
ALTER TABLE events ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE rca_jobs ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE rca_results ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE repos ADD COLUMN org_id UUID REFERENCES organizations(id);

-- Indexes for tenant isolation
CREATE INDEX idx_events_org_id ON events(org_id);
CREATE INDEX idx_rca_jobs_org_id ON rca_jobs(org_id);
CREATE INDEX idx_rca_results_org_id ON rca_results(org_id);
```

**Row-level Security:**

```sql
-- Enable RLS on all tables
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_isolation ON events
  USING (org_id = current_setting('app.current_org_id')::UUID);
```

---

## Cost Controls (Critical)

### Week 1 Implementation

**Rate Limits per Organization:**

```typescript
// config/limits.ts
export const RATE_LIMITS = {
  free: {
    events_per_hour: 100,
    rca_jobs_per_day: 50,
    llm_tokens_per_day: 100_000,
    github_api_calls_per_hour: 500,
  },
  pro: {
    events_per_hour: 1000,
    rca_jobs_per_day: 500,
    llm_tokens_per_day: 1_000_000,
    github_api_calls_per_hour: 2000,
  },
  enterprise: {
    events_per_hour: 10000,
    rca_jobs_per_day: 5000,
    llm_tokens_per_day: 10_000_000,
    github_api_calls_per_hour: 5000,
  },
};
```

**Cost Tracking:**

```sql
CREATE TABLE cost_metrics (
  id UUID PRIMARY KEY,
  org_id UUID REFERENCES organizations(id),
  date DATE NOT NULL,
  llm_tokens_used INT DEFAULT 0,
  llm_cost_usd DECIMAL(10,4) DEFAULT 0,
  github_api_calls INT DEFAULT 0,
  s3_storage_gb DECIMAL(10,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, date)
);
```

---

## GitHub Caching Strategy (Critical)

### Week 2 Implementation

**Three-tier cache:**

1. **Redis (hot cache)** — 1 hour TTL
   - Key: `gh:file:{org_id}:{repo}:{sha}:{path}`
   - Stores: file content + metadata

2. **S3 (warm cache)** — 7 day retention
   - Key: `cache/{org_id}/{repo}/{sha}/{path}`
   - Compressed with gzip

3. **Database (cold)** — permanent for analyzed files
   - Table: `code_snapshots`

```typescript
// services/github-fetcher.ts
async function fetchFile(
  repo: string,
  path: string,
  sha: string,
  orgId: string
) {
  // 1. Check Redis
  const cached = await redis.get(`gh:file:${orgId}:${repo}:${sha}:${path}`);
  if (cached) return JSON.parse(cached);

  // 2. Check S3
  const s3Key = `cache/${orgId}/${repo}/${sha}/${path}`;
  const s3File = await s3.getObject(s3Key).catch(() => null);
  if (s3File) {
    const content = await gunzip(s3File.Body);
    await redis.setex(`gh:file:${orgId}:${repo}:${sha}:${path}`, 3600, content);
    return JSON.parse(content);
  }

  // 3. Fetch from GitHub
  const content = await githubAPI.getContent(repo, path, sha);

  // Store in all caches
  await Promise.all([
    redis.setex(
      `gh:file:${orgId}:${repo}:${sha}:${path}`,
      3600,
      JSON.stringify(content)
    ),
    s3.putObject(s3Key, gzip(JSON.stringify(content))),
  ]);

  return content;
}
```

**Rate limit tracking:**

```typescript
// Track GitHub API usage per org
await redis.hincrby(`gh:rate:${orgId}:${currentHour}`, "calls", 1);
const usage = await redis.hget(`gh:rate:${orgId}:${currentHour}`, "calls");
if (usage > limits[org.plan].github_api_calls_per_hour) {
  throw new RateLimitError("GitHub API quota exceeded");
}
```

---

## Data Models (Updated with Multi-Tenancy)

### Core Tables

```sql
-- Events (errors from Sentry)
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  source TEXT DEFAULT 'sentry',
  sentry_event_id TEXT UNIQUE,
  signature TEXT NOT NULL, -- error fingerprint
  message TEXT,
  stack_trace JSONB,
  breadcrumbs JSONB,
  context JSONB, -- user, device, env vars (redacted)
  environment TEXT, -- prod, staging, dev
  release TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'received', -- received, queued, processing, done, failed
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_org_status ON events(org_id, status);
CREATE INDEX idx_events_signature ON events(org_id, signature, timestamp DESC);
CREATE INDEX idx_events_timestamp ON events(org_id, timestamp DESC);

-- RCA Jobs
CREATE TABLE rca_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  event_id UUID NOT NULL REFERENCES events(id),
  status TEXT DEFAULT 'pending', -- pending, fetching_code, analyzing, reasoning, done, failed
  code_context_s3_url TEXT,
  deterministic_findings JSONB,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rca_jobs_org_status ON rca_jobs(org_id, status);
CREATE INDEX idx_rca_jobs_event ON rca_jobs(event_id);

-- RCA Results
CREATE TABLE rca_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  event_id UUID NOT NULL REFERENCES events(id),
  job_id UUID NOT NULL REFERENCES rca_jobs(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  causal_chain JSONB NOT NULL, -- [{step, evidence, confidence}]
  suggested_fix JSONB, -- {description, patch, file_path}
  test_intentions JSONB, -- [{description, rationale}]
  evidence JSONB NOT NULL, -- {code_snippet, logs, commits, deterministic_findings}
  confidence FLOAT NOT NULL, -- 0.0 to 1.0
  llm_model TEXT DEFAULT 'gpt-4o-mini',
  llm_tokens_used INT,
  processing_time_ms INT,
  user_feedback TEXT, -- useful, not_useful, partially_useful
  user_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rca_results_org ON rca_results(org_id, created_at DESC);
CREATE INDEX idx_rca_results_event ON rca_results(event_id);

-- Repositories
CREATE TABLE repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  provider TEXT DEFAULT 'github',
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL, -- owner/name
  default_branch TEXT DEFAULT 'main',
  installation_id TEXT, -- GitHub App installation ID
  secret_id TEXT NOT NULL, -- AWS Secrets Manager ID for token
  is_active BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, provider, full_name)
);

CREATE INDEX idx_repos_org ON repos(org_id);

-- Code Snapshots (permanent cache)
CREATE TABLE code_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  repo_id UUID NOT NULL REFERENCES repos(id),
  file_path TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  content TEXT NOT NULL,
  language TEXT,
  size_bytes INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, repo_id, file_path, commit_sha)
);

CREATE INDEX idx_code_snapshots_lookup ON code_snapshots(org_id, repo_id, commit_sha, file_path);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'member', -- owner, admin, member
  slack_user_id TEXT,
  github_username TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Integrations
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL, -- sentry, github, slack
  config JSONB NOT NULL, -- provider-specific config
  secret_id TEXT, -- AWS Secrets Manager ID
  is_active BOOLEAN DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, type)
);
```

---

## Week-by-Week Plan

### Week 1 — Foundation + Multi-Tenancy + Cost Controls

**Goals:**

- Repo setup, CI/CD pipeline
- Database schema with multi-tenancy
- Rate limiting infrastructure
- Basic webhook receiver

**Tasks:**

1. **Project Setup**
   - Create monorepo structure
   - Setup TypeScript + ESLint + Prettier
   - Setup Python venv + dependencies
   - GitHub Actions for lint + test

2. **Infrastructure**
   - Terraform: VPC, RDS (Postgres), Redis, S3 bucket
   - AWS Secrets Manager setup
   - CloudWatch log groups

3. **Database**
   - Implement full schema with org_id
   - Add row-level security policies
   - Create migration scripts (node-pg-migrate)

4. **API Foundation**
   - Fastify server scaffold
   - JWT auth middleware
   - Org context middleware (sets current_org_id)
   - Rate limiting middleware (per org)

5. **Webhook Receiver (Basic)**
   - POST /api/v1/webhooks/sentry
   - HMAC signature validation
   - Store raw payload in events table
   - Return 200 OK

**Deliverables:**

- ✅ Deployed to staging environment
- ✅ Can receive Sentry webhook (validated, stored)
- ✅ Multi-tenancy working (2 test orgs isolated)
- ✅ Rate limits enforced

**Acceptance Criteria:**

- Send 100 events from 2 different orgs → isolated in DB
- Exceed rate limit → 429 response
- CI pipeline green

---

### Week 2 — GitHub Integration + Caching Strategy

**Goals:**

- GitHub App setup
- OAuth flow for repo access
- Three-tier caching implementation
- Code fetcher service with source map support

**Tasks:**

1. **GitHub App**
   - Create GitHub App with `contents:read` permission
   - Implement OAuth flow
   - Store installation tokens in Secrets Manager

2. **Code Fetcher Service**

   ```typescript
   // services/code-fetcher.ts
   class CodeFetcher {
     async fetchFileFromStackFrame(
       frame: StackFrame,
       repo: string,
       sha: string,
       orgId: string
     ): Promise<CodeContext> {
       // 1. Parse source map if minified
       const actualFile = await this.resolveSourceMap(frame);

       // 2. Fetch via cache
       const content = await this.fetchWithCache(
         repo,
         actualFile.path,
         sha,
         orgId
       );

       // 3. Extract surrounding context (50 lines before/after)
       const snippet = this.extractContext(content, actualFile.line, 50);

       return {
         file_path: actualFile.path,
         line_number: actualFile.line,
         column_number: actualFile.column,
         snippet,
         language: this.detectLanguage(actualFile.path),
       };
     }
   }
   ```

3. **Source Map Support**
   - Fetch .map files from GitHub
   - Parse with `source-map` library
   - Map minified → original location
   - Cache parsed source maps

4. **Three-Tier Cache**
   - Implement Redis cache layer
   - Implement S3 cache layer
   - Implement database snapshot layer
   - Cache invalidation strategy

5. **Rate Limit Tracking**
   - Track GitHub API calls per org
   - Exponential backoff on rate limits
   - Queue jobs when limits hit

**Deliverables:**

- ✅ GitHub App installed to test repo
- ✅ Fetch file content via API (cached)
- ✅ Source map parsing working
- ✅ Cache hit rate > 80% on repeated requests

**Acceptance Criteria:**

- Given minified error → resolves to original source
- Cache warm: fetch in <100ms
- Cache cold: fetch in <2s
- GitHub API calls tracked per org

---

### Week 3 — Deterministic Analyzers (JS/TS Only)

**Goals:**

- Implement Python-based AST analysis for JavaScript/TypeScript
- Build deterministic rule engine
- Integrate with job workers

**Tasks:**

1. **Python Analyzer Setup**

   ```python
   # python/analyzers/js_analyzer.py
   import tree_sitter
   from tree_sitter_javascript import language

   class JSAnalyzer:
       def analyze(self, code: str, error_line: int) -> dict:
           tree = self.parser.parse(bytes(code, 'utf8'))
           findings = []

           # Rule 1: Null/undefined access
           findings.extend(self.check_null_access(tree, error_line))

           # Rule 2: Unawaited promises
           findings.extend(self.check_async_patterns(tree, error_line))

           # Rule 3: Unhandled rejections
           findings.extend(self.check_error_handling(tree, error_line))

           # Rule 4: Type mismatches (basic)
           findings.extend(self.check_type_issues(tree, error_line))

           return {
               'findings': findings,
               'confidence': self.calculate_confidence(findings),
               'error_location': self.get_node_at_line(tree, error_line)
           }
   ```

2. **Deterministic Rules**
   - Null/undefined property access
   - Unawaited async functions
   - Missing error handlers
   - Array index out of bounds
   - Promise rejection not caught
   - Function called with wrong arity

3. **Node.js Integration**

   ```typescript
   // workers/analyzer-worker.ts
   import { spawn } from "child_process";

   async function runPythonAnalyzer(code: string, errorLine: number) {
     const python = spawn("python", ["-m", "analyzers.js_analyzer"]);

     python.stdin.write(JSON.stringify({ code, error_line: errorLine }));
     python.stdin.end();

     const output = await streamToString(python.stdout);
     return JSON.parse(output);
   }
   ```

4. **Job Worker Enhancement**
   - Fetch code context (from Week 2)
   - Run deterministic analyzer
   - Store findings in rca_jobs table
   - Update job status

**Deliverables:**

- ✅ Python analyzer returns structured findings
- ✅ Node worker calls Python analyzer
- ✅ Findings stored in database

**Acceptance Criteria:**

- Build synthetic dataset: 20 seeded JS errors
- Deterministic analyzer catches 15+ (75% accuracy)
- Processing time < 5s per job

---

### Week 4 — Evidence Assembly + Timeline Reconstruction + Hybrid Event Extraction + Confidence Meter

**Goals:**

- Collect all evidence (code, logs, breadcrumbs, commits)
- Build timeline from Sentry breadcrumbs
- **NEW: Implement 3-stage hybrid event extraction pipeline**
- **🔥 NEW (P0): Implement Confidence Meter with explainable breakdown**
- Prepare structured context for LLM

---

#### 🆕 Confidence Meter (Competitive Differentiator - P0)

**Why This Feature:** Sentry Seer's "actionability score" is opaque. Our confidence meter shows exactly WHY we're confident, building trust through transparency.

**Implementation:**

```typescript
// types/confidence.ts
interface ConfidenceBreakdown {
  total: number; // 0.0 - 1.0
  components: {
    ast_pattern_match: { value: number; reason: string };
    stack_trace_clarity: { value: number; reason: string };
    commit_correlation: { value: number; reason: string };
    historical_similarity: { value: number; reason: string };
    code_context_quality: { value: number; reason: string };
  };
  uncertainty_factors: Array<{ factor: string; penalty: number }>;
}

// services/confidence-calculator.ts
export function calculateConfidence(
  findings: Finding[],
  extraction: ExtractionResult,
  evidence: EvidenceBundle
): ConfidenceBreakdown {
  const components = {
    // +40% max: AST pattern matches
    ast_pattern_match: {
      value: Math.min(0.4, findings.length * 0.1),
      reason:
        findings.length > 0
          ? `${findings.length} pattern(s) matched: ${findings.map((f) => f.type).join(", ")}`
          : "No patterns matched",
    },

    // +25% max: Stack trace clarity
    stack_trace_clarity: {
      value:
        extraction.userFrames.user.length === 1
          ? 0.25
          : extraction.userFrames.user.length <= 3
            ? 0.15
            : 0.05,
      reason: `${extraction.userFrames.user.length} user code frames identified`,
    },

    // +15% max: Commit correlation
    commit_correlation: {
      value:
        evidence.recent_commits.length > 0
          ? Math.min(
              0.15,
              0.05 *
                evidence.recent_commits.filter((c) => c.age_days < 7).length
            )
          : 0,
      reason:
        evidence.recent_commits.length > 0
          ? `${evidence.recent_commits.filter((c) => c.age_days < 7).length} recent commits found`
          : "No recent commits",
    },

    // +10% max: Historical similarity (future: from feedback loop)
    historical_similarity: {
      value: 0, // Will be populated when signature database is built
      reason: "Signature database not yet available",
    },

    // +10% max: Code context quality
    code_context_quality: {
      value: evidence.code.snippet ? 0.1 : 0,
      reason: evidence.code.snippet
        ? "Full code context available"
        : "Code context unavailable",
    },
  };

  // Calculate uncertainty penalties
  const uncertainties: Array<{ factor: string; penalty: number }> = [];

  if (extraction.source === "llm_assisted") {
    uncertainties.push({ factor: "LLM-assisted extraction", penalty: -0.05 });
  }
  if (extraction.warnings.length > 0) {
    uncertainties.push({
      factor: `${extraction.warnings.length} extraction warnings`,
      penalty: -0.03,
    });
  }
  if (!evidence.code.snippet) {
    uncertainties.push({ factor: "Missing code context", penalty: -0.1 });
  }

  const componentTotal = Object.values(components).reduce(
    (sum, c) => sum + c.value,
    0
  );
  const penaltyTotal = uncertainties.reduce((sum, u) => sum + u.penalty, 0);

  return {
    total: Math.max(0, Math.min(1, componentTotal + penaltyTotal)),
    components,
    uncertainty_factors: uncertainties,
  };
}
```

**Database Schema:**

```sql
-- Add to migrations
ALTER TABLE rca_results ADD COLUMN confidence_breakdown JSONB;
```

**UI Display:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Root Cause Confidence: 87%                                     │
├─────────────────────────────────────────────────────────────────┤
│  ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░                  │
│                                                                 │
│  Breakdown:                                                     │
│  ├─ AST Pattern Match:     +40% (null access without guard)    │
│  ├─ Stack Trace Clarity:   +25% (single user_code frame)       │
│  ├─ Commit Correlation:    +15% (line changed 2 days ago)      │
│  └─ Code Context:          +10% (full snippet available)       │
│                                                                 │
│  ⚠️ Uncertainty: LLM-assisted extraction (-5%)                 │
└─────────────────────────────────────────────────────────────────┘
```

---

#### 🆕 Hybrid LLM-Assisted Event Extractor (Critical Architecture)

**Problem Solved:** Source maps, file paths, and malformed Sentry events prevent reliable code fetching.

**Solution:** A three-stage extraction pipeline that uses LLM only when deterministic extraction fails.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HYBRID EVENT EXTRACTION PIPELINE                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Stage 1: DETERMINISTIC EXTRACTOR (Primary - handles 80% of events)     │
│  ════════════════════════════════════════════════════════════════════   │
│  • Rule-based, schema-driven field extraction                           │
│  • Extracts: filenames, line numbers, commit SHA, repo name,            │
│    release tags, environment, platform                                  │
│  • If all required fields present → STOP HERE (fast path)              │
│                                                                          │
│                              ↓ (if data incomplete)                      │
│                                                                          │
│  Stage 2: LLM ASSIST LAYER (When data missing/malformed)                │
│  ════════════════════════════════════════════════════════════════════   │
│  • Uses GPT-4o-mini (or local model: DeepSeek-R1 7B / Qwen-7B)         │
│  • RESTRICTED SCOPE - LLM can ONLY:                                     │
│    ✔ Identify existing fields in payload                                │
│    ✔ Suggest likely commit/branch when missing                          │
│    ✔ Repair malformed JSON                                              │
│    ✔ Interpret custom Sentry contexts                                   │
│    ✔ Deminify filenames using sourcemaps                                │
│    ✔ Clean path noise (node_modules, polyfills, etc.)                   │
│    ✔ Pick the most likely "true" frame among 20-100 frames              │
│  • LLM CANNOT invent or assume repo/commit                              │
│                                                                          │
│                              ↓ (all outputs)                             │
│                                                                          │
│  Stage 3: VERIFICATION / SANITY CHECKER (Always runs)                   │
│  ════════════════════════════════════════════════════════════════════   │
│  • Deterministic validator confirms:                                    │
│    ✔ Does this repo exist in the org's GitHub?                          │
│    ✔ Does this commit exist?                                            │
│    ✔ Does this filepath exist in the fetched repo tree?                 │
│    ✔ Does this line number exist in the file?                           │
│  • If validation fails → fallback strategies:                           │
│    - Branch inference                                                   │
│    - HEAD fallback                                                      │
│    - Default branch                                                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Why This Architecture:**

| Benefit             | Description                                    |
| ------------------- | ---------------------------------------------- |
| **Safety**          | LLM never invents data, only cleans/interprets |
| **Proof**           | Every extraction has audit trail               |
| **Reproducibility** | Deterministic stage gives consistent results   |
| **Coverage**        | Handle malformed events competitors can't      |
| **Cross-platform**  | React Native, Electron, mobile all work        |

---

#### What the LLM is Safe For (Stage 2)

**✔ Cleaning stacktrace noise:**

- Node internal frames
- Browser polyfills
- Native frames
- Vendor libs
- Eval frames
- Minified bundles
- Android/iOS frameworks

**✔ Grouping frames into "user code vs library code":**

- Critical for RCA accuracy
- Filters out noise before analysis

**✔ Detecting missing release configuration:**

- Enterprises constantly misconfigure this
- LLM can suggest corrections

**✔ Determining the root crash location vs. the last logged frame:**

- Most raw Sentry events misrepresent this
- LLM can correctly reorder or interpret

**✔ Bridging ecosystems:**

- Python logs look nothing like JS logs
- JS bundles look nothing like Java stacktraces
- React Native errors look like hell
- LLM provides universal extraction path

---

**Tasks:**

1. **Hybrid Event Extractor (NEW)**

   ```typescript
   // services/event-extractor/extraction-pipeline.ts
   class ExtractionPipeline {
     async extract(
       sentryEvent: SentryEvent,
       orgId: string
     ): Promise<ExtractionResult> {
       // Stage 1: Deterministic extraction
       const deterministicResult =
         await this.deterministicExtractor.extract(sentryEvent);

       if (deterministicResult.isComplete) {
         return this.verify(deterministicResult, orgId);
       }

       // Stage 2: LLM-assisted extraction (only if needed)
       const llmResult = await this.llmAssistExtractor.enhance(
         sentryEvent,
         deterministicResult
       );

       // Stage 3: Verification
       return this.verify(llmResult, orgId);
     }

     private async verify(
       result: ExtractionResult,
       orgId: string
     ): Promise<ExtractionResult> {
       // Verify repo exists
       const repoExists = await this.github.repoExists(orgId, result.repo);
       if (!repoExists) {
         result.warnings.push("Repository not found, using fallback");
         result.repo = await this.inferRepo(orgId, result);
       }

       // Verify commit exists
       const commitExists = await this.github.commitExists(
         orgId,
         result.repo,
         result.commitSha
       );
       if (!commitExists) {
         result.commitSha = await this.fallbackToDefaultBranch(
           orgId,
           result.repo
         );
       }

       // Verify file exists
       const fileExists = await this.github.fileExists(
         orgId,
         result.repo,
         result.commitSha,
         result.filePath
       );
       if (!fileExists) {
         result.warnings.push("File not found at specified path");
       }

       return result;
     }
   }
   ```

2. **Deterministic Extractor (Stage 1)**

   ```typescript
   // services/event-extractor/deterministic-extractor.ts
   class DeterministicExtractor {
     extract(event: SentryEvent): ExtractionResult {
       return {
         filePath: this.extractFilePath(event),
         lineNumber: this.extractLineNumber(event),
         columnNumber: this.extractColumnNumber(event),
         commitSha: this.extractCommitSha(event),
         repo: this.extractRepo(event),
         release: this.extractRelease(event),
         environment: event.environment ?? "production",
         platform: event.platform ?? "javascript",
         userFrames: this.classifyFrames(
           event.exception?.values?.[0]?.stacktrace?.frames
         ),
         isComplete: this.checkCompleteness(),
         source: "deterministic",
         warnings: [],
       };
     }

     private classifyFrames(frames: StackFrame[]): ClassifiedFrames {
       const userFrames =
         frames?.filter(
           (f) =>
             f.in_app &&
             !f.filename?.includes("node_modules") &&
             !f.filename?.startsWith("node:")
         ) ?? [];

       return {
         user: userFrames,
         vendor: frames?.filter((f) => !userFrames.includes(f)) ?? [],
         total: frames?.length ?? 0,
       };
     }
   }
   ```

3. **LLM Assist Extractor (Stage 2)**

   ```python
   # python/extractors/llm_assist_extractor.py
   class LLMAssistExtractor:
       """LLM-assisted extraction for incomplete/malformed events"""

       EXTRACTION_PROMPT = """You are extracting structured data from a Sentry error event.

       STRICT RULES:
       1. ONLY identify fields that exist in the payload
       2. NEVER invent repository or commit information
       3. If you cannot find a field, return null
       4. Clean and normalize paths, but don't create them

       Your task:
       - Identify the most likely user code frame (not vendor/internal)
       - Clean minified file paths if source map hints exist
       - Extract release/version information
       - Classify frames as user vs vendor code

       Return JSON: {
           "primary_frame": {"file": str, "line": int, "function": str} | null,
           "suggested_repo": str | null,
           "suggested_commit": str | null,
           "user_frames": [{"file": str, "line": int, "confidence": float}],
           "cleaned_paths": {"original": str, "cleaned": str}[],
           "reasoning": str
       }
       """

       def enhance(self, event: dict, deterministic_result: dict) -> dict:
           # Only process what's missing
           missing_fields = self.identify_missing(deterministic_result)

           if not missing_fields:
               return deterministic_result

           response = self.llm.complete(
               system=self.EXTRACTION_PROMPT,
               user=json.dumps({
                   'event': event,
                   'missing_fields': missing_fields,
                   'partial_extraction': deterministic_result
               }),
               temperature=0.1,  # Low for consistency
               response_format={'type': 'json_object'}
           )

           # Merge LLM suggestions (but mark as lower confidence)
           return self.merge_results(deterministic_result, response, confidence=0.7)
   ```

4. **Evidence Collector (Updated)**

   ```typescript
   // services/evidence-collector.ts
   class EvidenceCollector {
     async collect(
       event: Event,
       extraction: ExtractionResult, // Now uses extraction pipeline
       findings: Finding[]
     ) {
       // Use extraction result for code fetching
       const codeContext = await this.codeFetcher.fetch({
         repo: extraction.repo,
         commitSha: extraction.commitSha,
         filePath: extraction.filePath,
         lineNumber: extraction.lineNumber,
         orgId: event.org_id,
       });

       return {
         error: {
           message: event.message,
           type: event.exception.type,
           stack_trace: event.stack_trace,
         },
         code: {
           file_path: codeContext.file_path,
           line_number: codeContext.line_number,
           snippet: codeContext.snippet,
           language: codeContext.language,
         },
         extraction_metadata: {
           source: extraction.source, // 'deterministic' or 'llm_assisted'
           warnings: extraction.warnings,
           user_frames_count: extraction.userFrames.user.length,
           vendor_frames_filtered: extraction.userFrames.vendor.length,
         },
         deterministic_findings: findings,
         timeline: await this.buildTimeline(event.breadcrumbs),
         recent_commits: await this.getRecentCommits(codeContext.file_path, 5),
         environment: {
           release: extraction.release ?? event.release,
           environment: extraction.environment,
           user_agent: event.context?.user_agent,
         },
       };
     }
   }
   ```

5. **Timeline Builder**

   ```python
   # python/timeline/reconstructor.py
   def reconstruct_timeline(breadcrumbs: list) -> dict:
       """
       Sentry breadcrumbs are already ordered by timestamp.
       We enhance with:
       - Type categorization (navigation, http, console, etc.)
       - Anomaly detection (timing gaps, errors)
       - Clustering related events
       """
       timeline = []

       for i, crumb in enumerate(breadcrumbs):
           step = {
               'timestamp': crumb['timestamp'],
               'type': crumb['type'],
               'message': crumb.get('message', ''),
               'data': crumb.get('data', {}),
               'is_anomaly': detect_anomaly(crumb, breadcrumbs[max(0,i-3):i])
           }
           timeline.append(step)

       return {
           'steps': timeline,
           'anomalies_count': sum(1 for s in timeline if s['is_anomaly']),
           'duration_ms': calculate_duration(breadcrumbs)
       }
   ```

6. **Commit History**
   - Fetch last 5 commits touching the error file
   - Extract commit message, author, timestamp
   - Include diff if small (<500 lines)

7. **Evidence Bundling**
   - Compress all evidence to JSON
   - Store in S3 for LLM processing
   - Keep reference in rca_jobs table

---

**New Files to Create:**

```
src/services/event-extractor/
├── extraction-pipeline.ts      # Orchestrates 3 stages
├── deterministic-extractor.ts  # Stage 1 - rule-based
├── llm-assist-extractor.ts     # Stage 2 - LLM enhancement
├── extraction-validator.ts     # Stage 3 - GitHub verification
└── prompts/
    ├── frame-classifier.txt    # User vs vendor frames
    └── path-cleaner.txt        # Demangle minified paths

python/extractors/
├── __init__.py
├── llm_assist_extractor.py     # LLM-assisted extraction
└── frame_classifier.py         # Frame classification
```

---

**Deliverables:**

- ✅ Evidence bundle created for each job
- ✅ Timeline shows chronological steps
- ✅ Recent commits included
- ✅ **NEW: 3-stage extraction pipeline implemented**
- ✅ **NEW: LLM-assisted frame classification**
- ✅ **NEW: GitHub verification for all extractions**

**Acceptance Criteria:**

- Timeline has clear ordering
- Anomalies highlighted (timing gaps > 5s)
- Evidence bundle < 50KB compressed
- **NEW: Stage 2 (LLM) triggers for <20% of events**
- **NEW: Stage 3 verification passes for >90% of events**
- **NEW: Cross-platform events (React Native, Electron) extract correctly**

---

**Metrics to Track:**

```typescript
// Add to cost_metrics table
extraction_stage_1_count: number; // Deterministic only (target: >80%)
extraction_stage_2_count: number; // LLM triggered (target: <20%)
extraction_stage_3_failures: number; // Verification failed (target: <10%)
extraction_llm_tokens: number;
extraction_latency_ms: number;
```

**Alert Thresholds:**

- Stage 2 trigger rate > 30% → Source map issues in customer config
- Stage 3 failure rate > 10% → LLM quality degradation
- LLM latency P95 > 5s → Model performance issue

---

### Week 5 — LLM Orchestration + Evidence Graph + Feedback Loop (GPT-4o-mini)

**Goals:**

- Implement LLM reasoning layer
- Build structured prompts
- Parse and validate LLM responses
- Integrate with job pipeline
- **🔥 NEW (P0): Build Evidence Graph for visual reasoning**
- **🔥 NEW (P0): Implement RCA Feedback Loop**

---

#### 🆕 Evidence Graph (Competitive Differentiator - P0)

**Why This Feature:** Seer shows "reasoning steps" in text. Our evidence graph is an interactive visualization showing exactly how conclusions were reached - instantly scannable and verifiable.

**Data Model:**

```typescript
// types/evidence-graph.ts
interface EvidenceNode {
  id: string;
  type:
    | "error"
    | "code_location"
    | "commit"
    | "developer"
    | "pattern"
    | "timeline_event";
  label: string;
  data: Record<string, unknown>;
  confidence: number;
}

interface EvidenceEdge {
  id: string;
  source: string;
  target: string;
  type:
    | "caused_by"
    | "introduced_in"
    | "triggered_when"
    | "similar_to"
    | "authored_by";
  label: string;
  evidence: string; // Reference to actual data
}

interface EvidenceGraph {
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
  metadata: {
    created_at: string;
    confidence: number;
    deterministic_score: number;
  };
}
```

**Graph Builder:**

```typescript
// services/evidence-graph-builder.ts
export function buildEvidenceGraph(
  event: Event,
  extraction: ExtractionResult,
  findings: Finding[],
  evidence: EvidenceBundle
): EvidenceGraph {
  const nodes: EvidenceNode[] = [];
  const edges: EvidenceEdge[] = [];

  // 1. Error node (root)
  const errorNode: EvidenceNode = {
    id: "error",
    type: "error",
    label: event.message.substring(0, 100),
    data: { type: event.exception?.type, occurrences: event.count },
    confidence: 1.0,
  };
  nodes.push(errorNode);

  // 2. Code location nodes from extraction
  extraction.userFrames.user.forEach((frame, i) => {
    const codeNode: EvidenceNode = {
      id: `code_${i}`,
      type: "code_location",
      label: `${frame.file_path}:${frame.line_number}`,
      data: { function: frame.function_name, context: frame.context_line },
      confidence: frame.is_entry_point ? 0.95 : 0.7,
    };
    nodes.push(codeNode);

    edges.push({
      id: `error_to_code_${i}`,
      source: "error",
      target: `code_${i}`,
      type: frame.is_entry_point ? "caused_by" : "triggered_when",
      label: frame.is_entry_point ? "originated at" : "propagated through",
      evidence: `Stack frame ${i}`,
    });
  });

  // 3. Commit nodes from recent commits
  evidence.recent_commits.forEach((commit, i) => {
    const commitNode: EvidenceNode = {
      id: `commit_${i}`,
      type: "commit",
      label: commit.sha.substring(0, 7),
      data: {
        message: commit.message,
        author: commit.author,
        date: commit.date,
      },
      confidence: commit.age_days < 7 ? 0.8 : 0.4,
    };
    nodes.push(commitNode);

    // Link to code locations that the commit touched
    const primaryCode = nodes.find(
      (n) => n.type === "code_location" && n.data.is_entry_point
    );
    if (primaryCode) {
      edges.push({
        id: `code_to_commit_${i}`,
        source: primaryCode.id,
        target: `commit_${i}`,
        type: "introduced_in",
        label: `changed ${commit.age_days} days ago`,
        evidence: `Commit ${commit.sha}`,
      });
    }
  });

  // 4. Pattern nodes from findings
  findings.forEach((finding, i) => {
    const patternNode: EvidenceNode = {
      id: `pattern_${i}`,
      type: "pattern",
      label: finding.type,
      data: { description: finding.message, severity: finding.severity },
      confidence: finding.confidence,
    };
    nodes.push(patternNode);

    edges.push({
      id: `code_to_pattern_${i}`,
      source: `code_0`, // Primary code location
      target: `pattern_${i}`,
      type: "similar_to",
      label: "matches pattern",
      evidence: `AST analysis: ${finding.type}`,
    });
  });

  return {
    nodes,
    edges,
    metadata: {
      created_at: new Date().toISOString(),
      confidence: calculateOverallConfidence(nodes, edges),
      deterministic_score: findings.length / Math.max(1, nodes.length),
    },
  };
}
```

**Database Schema:**

```sql
ALTER TABLE rca_results ADD COLUMN evidence_graph JSONB;
```

---

#### 🆕 RCA Feedback Loop (Competitive Differentiator - P0)

**Why This Feature:** Creates a flywheel - better data → better analysis → more trust → more usage. Also feeds the Bug Signature Database (Week 7-8).

**Feedback Form:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Was this RCA helpful?                                          │
│                                                                 │
│  [ 👍 Accurate ]  [ 🔧 Partially Helpful ]  [ ❌ Wrong ]        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ What was the actual root cause? (optional)              │   │
│  │ [________________________________________________]      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Error type was: [ Select: null_access, async, type, other ]   │
│                                                                 │
│  [ Submit Feedback ]                                            │
└─────────────────────────────────────────────────────────────────┘
```

**Database Schema:**

```sql
-- Update rca_results
ALTER TABLE rca_results ADD COLUMN actual_root_cause TEXT;
ALTER TABLE rca_results ADD COLUMN feedback_timestamp TIMESTAMPTZ;
ALTER TABLE rca_results ADD COLUMN error_category TEXT;

-- Track corrections for signature database
CREATE TABLE rca_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rca_id UUID REFERENCES rca_results(id),
  org_id UUID REFERENCES organizations(id),
  original_root_cause TEXT NOT NULL,
  corrected_root_cause TEXT NOT NULL,
  error_signature TEXT,
  error_category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rca_corrections_signature ON rca_corrections(error_signature);
CREATE INDEX idx_rca_corrections_category ON rca_corrections(error_category);
```

**API Endpoints:**

```typescript
// api/routes/feedback.ts
app.post("/v1/rca/:id/feedback", async (req, res) => {
  const { id } = req.params;
  const { feedback, actual_root_cause, error_category } = req.body;

  // Update RCA result
  await db.query(
    `
    UPDATE rca_results
    SET user_feedback = $1,
        actual_root_cause = $2,
        error_category = $3,
        feedback_timestamp = NOW()
    WHERE id = $4 AND org_id = $5
  `,
    [feedback, actual_root_cause, error_category, id, req.orgId]
  );

  // If wrong, create correction record for signature learning
  if (feedback === "wrong" && actual_root_cause) {
    await db.query(
      `
      INSERT INTO rca_corrections (rca_id, org_id, original_root_cause, corrected_root_cause, error_signature, error_category)
      SELECT $1, $2, root_cause, $3,
             (SELECT signature FROM events WHERE id = rca_results.event_id), $4
      FROM rca_results WHERE id = $1
    `,
      [id, req.orgId, actual_root_cause, error_category]
    );
  }

  res.json({ success: true });
});
```

**Feedback Metrics:**

```typescript
// Track feedback for quality monitoring
interface FeedbackMetrics {
  total_rcas: number;
  feedback_rate: number; // % of RCAs with feedback
  accuracy_rate: number; // % accurate / (accurate + wrong)
  partial_rate: number; // % partially helpful
  correction_count: number; // Total corrections received
  by_category: Record<string, { total: number; accurate: number }>;
}
```

---

**Tasks:**

1. **LLM Service**

   ```python
   # python/llm/orchestrator.py
   from openai import OpenAI

   class RCAOrchestrator:
       def __init__(self):
           self.client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
           self.model = 'gpt-4o-mini'

       def generate_rca(self, evidence: dict) -> dict:
           prompt = self.build_prompt(evidence)

           response = self.client.chat.completions.create(
               model=self.model,
               messages=[
                   {'role': 'system', 'content': SYSTEM_PROMPT},
                   {'role': 'user', 'content': prompt}
               ],
               temperature=0.1,  # Low for consistency
               response_format={'type': 'json_object'},
               max_tokens=2000
           )

           result = json.loads(response.choices[0].message.content)

           # Validate schema
           self.validate_response(result)

           # Add metadata
           result['llm_model'] = self.model
           result['llm_tokens_used'] = response.usage.total_tokens

           return result
   ```

2. **Prompt Engineering**

   ```python
   SYSTEM_PROMPT = """You are an expert debugging assistant. Analyze production errors with precision.

   Your output must be JSON with this exact schema:
   {
     "title": "Brief error title",
     "summary": "2-3 sentence overview",
     "root_cause": "Specific root cause based on evidence",
     "causal_chain": [
       {"step": "What happened", "evidence": "Log/code reference", "confidence": 0.9}
     ],
     "suggested_fix": {
       "description": "What to fix",
       "patch": "Code change suggestion",
       "file_path": "path/to/file.js"
     },
     "test_intentions": [
       {"description": "Test to add", "rationale": "Why it prevents recurrence"}
     ],
     "confidence": 0.85
   }

   Rules:
   - Every claim must reference evidence (code line, log, commit)
   - If uncertain, lower confidence score
   - Never hallucinate: if no evidence, state "insufficient data"
   - Be specific: include line numbers, variable names, function names
   """

   def build_prompt(evidence: dict) -> str:
       return f"""
   Analyze this production error:

   ERROR:
   {evidence['error']['message']}
   Type: {evidence['error']['type']}

   STACK TRACE (top 3 frames):
   {format_stack_trace(evidence['error']['stack_trace'][:3])}

   CODE CONTEXT:
   File: {evidence['code']['file_path']}
   Line: {evidence['code']['line_number']}
   ```

   {evidence['code']['snippet']}

   ```

   DETERMINISTIC FINDINGS:
   {format_findings(evidence['deterministic_findings'])}

   TIMELINE (last 5 events):
   {format_timeline(evidence['timeline']['steps'][-5:])}

   RECENT COMMITS:
   {format_commits(evidence['recent_commits'])}

   Provide root cause analysis in JSON format.
   """
   ```

3. **Response Validation**

   ```python
   from jsonschema import validate

   RCA_SCHEMA = {
       "type": "object",
       "required": ["title", "summary", "root_cause", "causal_chain", "confidence"],
       "properties": {
           "title": {"type": "string", "maxLength": 200},
           "summary": {"type": "string"},
           "root_cause": {"type": "string"},
           "causal_chain": {
               "type": "array",
               "items": {
                   "type": "object",
                   "required": ["step", "evidence", "confidence"]
               }
           },
           "confidence": {"type": "number", "minimum": 0, "maximum": 1}
       }
   }
   ```

4. **Cost Tracking**

   ```typescript
   // Track token usage per org
   await db.query(
     `
     INSERT INTO cost_metrics (org_id, date, llm_tokens_used, llm_cost_usd)
     VALUES ($1, CURRENT_DATE, $2, $3)
     ON CONFLICT (org_id, date)
     DO UPDATE SET
       llm_tokens_used = cost_metrics.llm_tokens_used + $2,
       llm_cost_usd = cost_metrics.llm_cost_usd + $3
   `,
     [orgId, tokensUsed, (tokensUsed * 0.00015) / 1000]
   ); // GPT-4o-mini pricing
   ```

5. **Worker Integration**

   ```typescript
   // workers/rca-worker.ts
   async function processRCAJob(job: Job) {
     const { event, codeContext, findings } = job.data;

     // 1. Collect evidence
     const evidence = await evidenceCollector.collect(
       event,
       codeContext,
       findings
     );

     // 2. Call Python LLM service
     const rca = await runPythonLLM(evidence);

     // 3. Store result
     await db.rca_results.create({
       org_id: event.org_id,
       event_id: event.id,
       job_id: job.id,
       ...rca,
     });

     // 4. Track costs
     await trackCosts(event.org_id, rca.llm_tokens_used);

     return rca;
   }
   ```

**Deliverables:**

- ✅ LLM returns structured RCA
- ✅ Schema validation passes
- ✅ Cost tracking working
- ✅ End-to-end pipeline: webhook → RCA result

**Acceptance Criteria:**

- Process 10 synthetic events end-to-end
- All RCAs have confidence scores
- Token usage tracked per org
- Average processing time < 30s

---

### Week 6 — Slack Delivery + Basic Web UI + Cost Analytics Dashboard

**Goals:**

- Send RCA summaries to Slack
- Build minimal web UI to view RCAs
- Implement feedback mechanism
- **🔥 NEW (P1): Build Cost Analytics Dashboard**

---

#### 🆕 Cost Analytics Dashboard (Competitive Differentiator - P1)

**Why This Feature:** Engineering leaders love ROI metrics. Sentry's usage is opaque. We show exact costs and value delivered.

**Dashboard Display:**

```
┌─────────────────────────────────────────────────────────────────┐
│  RCA Cost Summary (December 2025)                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Total RCAs This Month:        347                              │
│  LLM Tokens Used:              2.1M (~$4.20)                    │
│  GitHub API Calls:             12,450 (within quota)            │
│  Avg Cost per RCA:             $0.12                            │
│                                                                 │
│  ────────────────────────────────────────────────────────────   │
│                                                                 │
│  Quality Metrics:                                               │
│  ├─ Accurate RCAs:             287 (82.7%)                      │
│  ├─ Partially Helpful:         42 (12.1%)                       │
│  └─ Wrong/Not Helpful:         18 (5.2%)                        │
│                                                                 │
│  ────────────────────────────────────────────────────────────   │
│                                                                 │
│  ROI Estimate:                                                  │
│  ├─ Avg Resolution Time:       12 min (was ~45 min)             │
│  ├─ Time Saved per RCA:        33 min                           │
│  ├─ Engineering Hours Saved:   191 hours                        │
│  └─ Est. Value Delivered:      $14,325 (at $75/hr)              │
│                                                                 │
│  ⚡ ROI This Month:            3,400% ($14,325 / $420 cost)     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**API Endpoints:**

```typescript
// api/routes/analytics.ts
app.get("/v1/analytics/costs", async (req, res) => {
  const { startDate, endDate } = req.query;
  const orgId = req.orgId;

  const costs = await db.query(
    `
    SELECT
      SUM(llm_tokens_used) as total_tokens,
      SUM(llm_cost_usd) as total_llm_cost,
      SUM(github_api_calls) as total_github_calls,
      COUNT(DISTINCT date) as days_active
    FROM cost_metrics
    WHERE org_id = $1
      AND date BETWEEN $2 AND $3
  `,
    [orgId, startDate, endDate]
  );

  const rcaStats = await db.query(
    `
    SELECT
      COUNT(*) as total_rcas,
      AVG(processing_time_ms) as avg_processing_time,
      COUNT(CASE WHEN user_feedback = 'useful' THEN 1 END) as accurate_count,
      COUNT(CASE WHEN user_feedback = 'partially_useful' THEN 1 END) as partial_count,
      COUNT(CASE WHEN user_feedback = 'not_useful' THEN 1 END) as wrong_count
    FROM rca_results
    WHERE org_id = $1
      AND created_at BETWEEN $2 AND $3
  `,
    [orgId, startDate, endDate]
  );

  // Calculate ROI estimate
  const avgTimeWithoutBuglens = 45 * 60 * 1000; // 45 min in ms
  const timeSavedMs =
    (avgTimeWithoutBuglens - rcaStats.avg_processing_time) *
    rcaStats.total_rcas;
  const hoursSaved = timeSavedMs / (1000 * 60 * 60);
  const engineeringRate = 75; // $/hr estimate
  const valueSaved = hoursSaved * engineeringRate;

  res.json({
    costs: {
      total_tokens: costs.total_tokens,
      total_llm_cost: costs.total_llm_cost,
      total_github_calls: costs.total_github_calls,
      avg_cost_per_rca: costs.total_llm_cost / rcaStats.total_rcas,
    },
    quality: {
      total_rcas: rcaStats.total_rcas,
      accurate_rate: rcaStats.accurate_count / rcaStats.total_rcas,
      partial_rate: rcaStats.partial_count / rcaStats.total_rcas,
      wrong_rate: rcaStats.wrong_count / rcaStats.total_rcas,
    },
    roi: {
      hours_saved: hoursSaved,
      value_saved_usd: valueSaved,
      roi_percentage: (valueSaved / costs.total_llm_cost) * 100,
    },
  });
});

// Get cost trends over time
app.get("/v1/analytics/costs/trends", async (req, res) => {
  const orgId = req.orgId;

  const trends = await db.query(
    `
    SELECT
      date,
      llm_tokens_used,
      llm_cost_usd,
      github_api_calls,
      (SELECT COUNT(*) FROM rca_results WHERE org_id = $1 AND DATE(created_at) = cost_metrics.date) as rca_count
    FROM cost_metrics
    WHERE org_id = $1
    ORDER BY date DESC
    LIMIT 30
  `,
    [orgId]
  );

  res.json({ trends });
});
```

**React Component:**

```tsx
// web/src/pages/CostAnalytics.tsx
export function CostAnalytics() {
  const { data } = useQuery(["analytics", "costs"], () =>
    api.getCostAnalytics()
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Cost & ROI Analytics</h1>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="Total RCAs"
          value={data.quality.total_rcas}
          trend={+12}
        />
        <MetricCard
          title="LLM Cost"
          value={`$${data.costs.total_llm_cost.toFixed(2)}`}
        />
        <MetricCard
          title="Accuracy Rate"
          value={`${(data.quality.accurate_rate * 100).toFixed(1)}%`}
          trend={+3.2}
        />
        <MetricCard
          title="ROI"
          value={`${data.roi.roi_percentage.toFixed(0)}%`}
          highlight
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card title="Cost per RCA Trend">
          <LineChart data={costTrendData} />
        </Card>
        <Card title="Quality Breakdown">
          <PieChart
            data={[
              { label: "Accurate", value: data.quality.accurate_rate },
              { label: "Partial", value: data.quality.partial_rate },
              { label: "Wrong", value: data.quality.wrong_rate },
            ]}
          />
        </Card>
      </div>

      <Card title="Value Delivered" className="mt-6">
        <div className="text-center py-4">
          <p className="text-4xl font-bold text-green-600">
            ${data.roi.value_saved_usd.toLocaleString()}
          </p>
          <p className="text-gray-600">
            Estimated engineering time saved: {data.roi.hours_saved.toFixed(0)}{" "}
            hours
          </p>
        </div>
      </Card>
    </div>
  );
}
```

---

**Tasks:**

1. **Slack Integration**

   ```typescript
   // integrations/slack-notifier.ts
   import { WebClient } from "@slack/web-api";

   class SlackNotifier {
     async sendRCA(rca: RCAResult, event: Event, org: Organization) {
       const config = await this.getSlackConfig(org.id);
       const client = new WebClient(config.bot_token);

       const blocks = this.formatRCABlocks(rca, event);

       await client.chat.postMessage({
         channel: config.channel_id,
         text: `🐛 New RCA: ${rca.title}`,
         blocks,
         unfurl_links: false,
       });
     }

     formatRCABlocks(rca: RCAResult, event: Event) {
       return [
         {
           type: "header",
           text: { type: "plain_text", text: `🐛 ${rca.title}` },
         },
         {
           type: "section",
           text: { type: "mrkdwn", text: rca.summary },
         },
         {
           type: "section",
           fields: [
             {
               type: "mrkdwn",
               text: `*Confidence:*\n${(rca.confidence * 100).toFixed(0)}%`,
             },
             {
               type: "mrkdwn",
               text: `*Environment:*\n${event.environment}`,
             },
           ],
         },
         {
           type: "section",
           text: {
             type: "mrkdwn",
             text: `*Root Cause:*\n${rca.root_cause}`,
           },
         },
         {
           type: "actions",
           elements: [
             {
               type: "button",
               text: { type: "plain_text", text: "View Details" },
               url: `${config.app_url}/rca/${rca.id}`,
             },
             {
               type: "button",
               text: { type: "plain_text", text: "👍 Helpful" },
               action_id: "rca_helpful",
               value: rca.id,
             },
             {
               type: "button",
               text: {
                 type: "plain_text",
                 text: "👎 Not Helpful",
               },
               action_id: "rca_not_helpful",
               value: rca.id,
             },
           ],
         },
       ];
     }
   }
   ```

2. **Slack Actions Handler**

   ```typescript
   // api/routes/slack-actions.ts
   app.post("/api/v1/slack/actions", async (req, res) => {
     const payload = JSON.parse(req.body.payload);

     if (payload.type === "block_actions") {
       const action = payload.actions[0];
       const rcaId = action.value;

       if (action.action_id === "rca_helpful") {
         await db.rca_results.update(rcaId, { user_feedback: "useful" });
       } else if (action.action_id === "rca_not_helpful") {
         await db.rca_results.update(rcaId, {
           user_feedback: "not_useful",
         });
       }

       // Update message
       await slackClient.chat.update({
         channel: payload.channel.id,
         ts: payload.message.ts,
         text: "Feedback recorded ✓",
       });
     }

     res.send();
   });
   ```

3. **Web UI - Core Pages**

   ```tsx
   // web/src/pages/RCADetail.tsx
   export function RCADetail() {
     const { rcaId } = useParams();
     const { data: rca } = useQuery(["rca", rcaId], () => api.getRCA(rcaId));

     return (
       <div className="max-w-4xl mx-auto p-6">
         <h1 className="text-3xl font-bold mb-4">{rca.title}</h1>

         <div className="bg-blue-50 p-4 rounded mb-6">
           <p className="text-lg">{rca.summary}</p>
         </div>

         <Section title="Root Cause">
           <p className="text-gray-800">{rca.root_cause}</p>
         </Section>

         <Section title="Causal Chain">
           <Timeline steps={rca.causal_chain} />
         </Section>

         <Section title="Code Context">
           <CodeViewer
             code={rca.evidence.code.snippet}
             language={rca.evidence.code.language}
             highlightLine={rca.evidence.code.line_number}
           />
         </Section>

         <Section title="Suggested Fix">
           {rca.suggested_fix && (
             <div>
               <p className="mb-2">{rca.suggested_fix.description}</p>
               <CodeDiff patch={rca.suggested_fix.patch} />
             </div>
           )}
         </Section>

         <Section title="Test Intentions">
           <ul className="list-disc pl-6">
             {rca.test_intentions?.map((test, i) => (
               <li key={i}>
                 <strong>{test.description}</strong>
                 <p className="text-sm text-gray-600">{test.rationale}</p>
               </li>
             ))}
           </ul>
         </Section>

         <FeedbackPanel rcaId={rca.id} currentFeedback={rca.user_feedback} />
       </div>
     );
   }
   ```

4. **Events List Page**

   ```tsx
   // web/src/pages/EventsList.tsx
   export function EventsList() {
     const [filters, setFilters] = useState({
       environment: "all",
       status: "all",
     });
     const { data } = useQuery(["events", filters], () =>
       api.getEvents(filters)
     );

     return (
       <div className="p-6">
         <h1 className="text-2xl font-bold mb-4">Recent Errors</h1>

         <Filters filters={filters} onChange={setFilters} />

         <table className="w-full">
           <thead>
             <tr>
               <th>Error</th>
               <th>Environment</th>
               <th>Time</th>
               <th>Status</th>
               <th>Actions</th>
             </tr>
           </thead>
           <tbody>
             {data?.events.map((event) => (
               <tr key={event.id}>
                 <td>{event.message}</td>
                 <td>
                   <Badge>{event.environment}</Badge>
                 </td>
                 <td>{formatTime(event.timestamp)}</td>
                 <td>
                   <StatusBadge status={event.status} />
                 </td>
                 <td>
                   <Link to={`/events/${event.id}`}>View</Link>
                 </td>
               </tr>
             ))}
           </tbody>
         </table>
       </div>
     );
   }
   ```

5. **Deployment**
   - Build web UI (Vite)
   - Deploy to S3 + CloudFront (static hosting)
   - Setup API routes in Fastify
   - Configure CORS

**Deliverables:**

- ✅ Slack messages sent for new RCAs
- ✅ Web UI shows RCA details with code highlighting
- ✅ Feedback buttons work (Slack + Web)
- ✅ Events list with filtering

**Acceptance Criteria:**

- Send test RCA → appears in Slack < 5s
- Click "View Details" → opens web UI
- Feedback buttons update database
- UI responsive on mobile

---

## Phase 1 Success Metrics

### Technical Metrics

- ✅ End-to-end latency: webhook → Slack < 45s (P95)
- ✅ Job success rate: > 90%
- ✅ Cache hit rate: > 75%
- ✅ Cost per RCA: < $0.15 (including LLM + infra)

### Quality Metrics

- ✅ RCA accuracy on synthetic dataset: > 70%
- ✅ User feedback "helpful" rate: > 60%
- ✅ False positive rate: < 15%

### Scale Metrics

- ✅ Handle 1000 events/hour per org
- ✅ Support 10 concurrent organizations
- ✅ GitHub API usage within limits

---

## Risk Mitigation Summary

| Risk                      | Mitigation in Phase 1                                      |
| ------------------------- | ---------------------------------------------------------- |
| **LLM Costs**             | Token limits per org, caching, GPT-4o-mini only            |
| **GitHub Rate Limits**    | Three-tier cache, per-org tracking, backoff                |
| **Multi-tenancy Bugs**    | Row-level security, org_id everywhere, tests               |
| **Source Map Complexity** | Support common bundlers (webpack, vite), graceful fallback |
| **Job Failures**          | Retry logic, dead letter queue, alerting                   |
| **Security**              | Secrets Manager, least privilege, HMAC validation          |

---

## What's NOT in Phase 1

- ❌ Python language support (Phase 2)
- ❌ Datadog integration (Phase 2)
- ❌ Local LLM models (Phase 2)
- ❌ Advanced vector search (Phase 2)
- ❌ On-premise deployment (Phase 2)
- ❌ SSO/SCIM (Phase 2)
- ❌ Custom deployment tracking (Phase 2)
- ❌ Auto-PR generation (Phase 2+)

---

## Team & Resources

**Required Team:**

- 1 Full-stack Engineer (TS/React) — API, workers, UI
- 1 Backend/ML Engineer (Python) — Analyzers, LLM orchestration
- 0.5 DevOps/SRE — Infrastructure, monitoring

**Infrastructure Costs (MVP):**

- ECS Fargate: ~$100/month
- RDS Postgres: ~$50/month
- Redis: ~$30/month
- S3: ~$20/month
- LLM (GPT-4o-mini): ~$50-200/month (depends on volume)
- **Total: ~$250-400/month**

**Development Time:**

- Phase 1: 6 weeks with 2.5 engineers = ~15 person-weeks
- Assumes no major blockers
- Includes buffer for debugging and iteration

---

## Phase 1 Completion Checklist

- [ ] Sentry webhook successfully processed
- [ ] GitHub code fetched with source map resolution
- [ ] Deterministic analyzer catches common patterns
- [ ] LLM generates structured RCA
- [ ] Slack notification delivered
- [ ] Web UI displays RCA with syntax highlighting
- [ ] Multi-tenancy verified (2+ orgs isolated)
- [ ] Rate limits enforced
- [ ] Cost tracking working
- [ ] Monitoring dashboards live
- [ ] Documentation complete
- [ ] Demo-ready with real Sentry events
