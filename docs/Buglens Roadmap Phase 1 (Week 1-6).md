# BUGLENS — Phase 1 Roadmap (Weeks 1-6)

## Ship Core RCA Pipeline

**Revised: November 2025**

---

## Phase 1 Goal

Build a working end-to-end RCA pipeline for **JavaScript/TypeScript errors from Sentry** with deterministic analysis + GPT-4o-mini reasoning, delivered via Slack and minimal web UI.

**Scope Constraints:**

-   **Language:** JS/TS only (Node.js, React, etc.)
-   **Error Source:** Sentry only
-   **LLM:** GPT-4o-mini only (no local models)
-   **Code Source:** GitHub only
-   **Delivery:** Slack + basic web UI

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

-   Simpler deployment (1 service vs 3-5)
-   Easier debugging and development
-   Lower ops overhead
-   Can split later if needed

**Python Integration:**

-   Called via child_process from Node.js workers
-   Communicates via stdin/stdout JSON
-   Python dependencies managed separately (venv)
-   Stateless execution (no shared state)

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
        await redis.setex(
            `gh:file:${orgId}:${repo}:${sha}:${path}`,
            3600,
            content
        );
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

-   Repo setup, CI/CD pipeline
-   Database schema with multi-tenancy
-   Rate limiting infrastructure
-   Basic webhook receiver

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

-   ✅ Deployed to staging environment
-   ✅ Can receive Sentry webhook (validated, stored)
-   ✅ Multi-tenancy working (2 test orgs isolated)
-   ✅ Rate limits enforced

**Acceptance Criteria:**

-   Send 100 events from 2 different orgs → isolated in DB
-   Exceed rate limit → 429 response
-   CI pipeline green

---

### Week 2 — GitHub Integration + Caching Strategy

**Goals:**

-   GitHub App setup
-   OAuth flow for repo access
-   Three-tier caching implementation
-   Code fetcher service with source map support

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

-   ✅ GitHub App installed to test repo
-   ✅ Fetch file content via API (cached)
-   ✅ Source map parsing working
-   ✅ Cache hit rate > 80% on repeated requests

**Acceptance Criteria:**

-   Given minified error → resolves to original source
-   Cache warm: fetch in <100ms
-   Cache cold: fetch in <2s
-   GitHub API calls tracked per org

---

### Week 3 — Deterministic Analyzers (JS/TS Only)

**Goals:**

-   Implement Python-based AST analysis for JavaScript/TypeScript
-   Build deterministic rule engine
-   Integrate with job workers

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

-   ✅ Python analyzer returns structured findings
-   ✅ Node worker calls Python analyzer
-   ✅ Findings stored in database

**Acceptance Criteria:**

-   Build synthetic dataset: 20 seeded JS errors
-   Deterministic analyzer catches 15+ (75% accuracy)
-   Processing time < 5s per job

---

### Week 4 — Evidence Assembly + Timeline Reconstruction + Hybrid Event Extraction

**Goals:**

-   Collect all evidence (code, logs, breadcrumbs, commits)
-   Build timeline from Sentry breadcrumbs
-   **NEW: Implement 3-stage hybrid event extraction pipeline**
-   Prepare structured context for LLM

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

| Benefit | Description |
|---------|-------------|
| **Safety** | LLM never invents data, only cleans/interprets |
| **Proof** | Every extraction has audit trail |
| **Reproducibility** | Deterministic stage gives consistent results |
| **Coverage** | Handle malformed events competitors can't |
| **Cross-platform** | React Native, Electron, mobile all work |

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
        async extract(sentryEvent: SentryEvent, orgId: string): Promise<ExtractionResult> {
            // Stage 1: Deterministic extraction
            const deterministicResult = await this.deterministicExtractor.extract(sentryEvent);
            
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
        
        private async verify(result: ExtractionResult, orgId: string): Promise<ExtractionResult> {
            // Verify repo exists
            const repoExists = await this.github.repoExists(orgId, result.repo);
            if (!repoExists) {
                result.warnings.push('Repository not found, using fallback');
                result.repo = await this.inferRepo(orgId, result);
            }
            
            // Verify commit exists
            const commitExists = await this.github.commitExists(
                orgId, result.repo, result.commitSha
            );
            if (!commitExists) {
                result.commitSha = await this.fallbackToDefaultBranch(orgId, result.repo);
            }
            
            // Verify file exists
            const fileExists = await this.github.fileExists(
                orgId, result.repo, result.commitSha, result.filePath
            );
            if (!fileExists) {
                result.warnings.push('File not found at specified path');
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
                environment: event.environment ?? 'production',
                platform: event.platform ?? 'javascript',
                userFrames: this.classifyFrames(event.exception?.values?.[0]?.stacktrace?.frames),
                isComplete: this.checkCompleteness(),
                source: 'deterministic',
                warnings: []
            };
        }
        
        private classifyFrames(frames: StackFrame[]): ClassifiedFrames {
            const userFrames = frames?.filter(f => 
                f.in_app && 
                !f.filename?.includes('node_modules') &&
                !f.filename?.startsWith('node:')
            ) ?? [];
            
            return {
                user: userFrames,
                vendor: frames?.filter(f => !userFrames.includes(f)) ?? [],
                total: frames?.length ?? 0
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
            extraction: ExtractionResult,  // Now uses extraction pipeline
            findings: Finding[]
        ) {
            // Use extraction result for code fetching
            const codeContext = await this.codeFetcher.fetch({
                repo: extraction.repo,
                commitSha: extraction.commitSha,
                filePath: extraction.filePath,
                lineNumber: extraction.lineNumber,
                orgId: event.org_id
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
                    source: extraction.source,  // 'deterministic' or 'llm_assisted'
                    warnings: extraction.warnings,
                    user_frames_count: extraction.userFrames.user.length,
                    vendor_frames_filtered: extraction.userFrames.vendor.length
                },
                deterministic_findings: findings,
                timeline: await this.buildTimeline(event.breadcrumbs),
                recent_commits: await this.getRecentCommits(
                    codeContext.file_path,
                    5
                ),
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

-   ✅ Evidence bundle created for each job
-   ✅ Timeline shows chronological steps
-   ✅ Recent commits included
-   ✅ **NEW: 3-stage extraction pipeline implemented**
-   ✅ **NEW: LLM-assisted frame classification**
-   ✅ **NEW: GitHub verification for all extractions**

**Acceptance Criteria:**

-   Timeline has clear ordering
-   Anomalies highlighted (timing gaps > 5s)
-   Evidence bundle < 50KB compressed
-   **NEW: Stage 2 (LLM) triggers for <20% of events**
-   **NEW: Stage 3 verification passes for >90% of events**
-   **NEW: Cross-platform events (React Native, Electron) extract correctly**

---

**Metrics to Track:**

```typescript
// Add to cost_metrics table
extraction_stage_1_count: number;  // Deterministic only (target: >80%)
extraction_stage_2_count: number;  // LLM triggered (target: <20%)
extraction_stage_3_failures: number;  // Verification failed (target: <10%)
extraction_llm_tokens: number;
extraction_latency_ms: number;
```

**Alert Thresholds:**
- Stage 2 trigger rate > 30% → Source map issues in customer config
- Stage 3 failure rate > 10% → LLM quality degradation
- LLM latency P95 > 5s → Model performance issue

---

### Week 5 — LLM Orchestration (GPT-4o-mini)

**Goals:**

-   Implement LLM reasoning layer
-   Build structured prompts
-   Parse and validate LLM responses
-   Integrate with job pipeline

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

-   ✅ LLM returns structured RCA
-   ✅ Schema validation passes
-   ✅ Cost tracking working
-   ✅ End-to-end pipeline: webhook → RCA result

**Acceptance Criteria:**

-   Process 10 synthetic events end-to-end
-   All RCAs have confidence scores
-   Token usage tracked per org
-   Average processing time < 30s

---

### Week 6 — Slack Delivery + Basic Web UI

**Goals:**

-   Send RCA summaries to Slack
-   Build minimal web UI to view RCAs
-   Implement feedback mechanism

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
                            text: `*Confidence:*\n${(
                                rca.confidence * 100
                            ).toFixed(0)}%`,
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
                            <p className="mb-2">
                                {rca.suggested_fix.description}
                            </p>
                            <CodeDiff patch={rca.suggested_fix.patch} />
                        </div>
                    )}
                </Section>

                <Section title="Test Intentions">
                    <ul className="list-disc pl-6">
                        {rca.test_intentions?.map((test, i) => (
                            <li key={i}>
                                <strong>{test.description}</strong>
                                <p className="text-sm text-gray-600">
                                    {test.rationale}
                                </p>
                            </li>
                        ))}
                    </ul>
                </Section>

                <FeedbackPanel
                    rcaId={rca.id}
                    currentFeedback={rca.user_feedback}
                />
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

-   ✅ Slack messages sent for new RCAs
-   ✅ Web UI shows RCA details with code highlighting
-   ✅ Feedback buttons work (Slack + Web)
-   ✅ Events list with filtering

**Acceptance Criteria:**

-   Send test RCA → appears in Slack < 5s
-   Click "View Details" → opens web UI
-   Feedback buttons update database
-   UI responsive on mobile

---

## Phase 1 Success Metrics

### Technical Metrics

-   ✅ End-to-end latency: webhook → Slack < 45s (P95)
-   ✅ Job success rate: > 90%
-   ✅ Cache hit rate: > 75%
-   ✅ Cost per RCA: < $0.15 (including LLM + infra)

### Quality Metrics

-   ✅ RCA accuracy on synthetic dataset: > 70%
-   ✅ User feedback "helpful" rate: > 60%
-   ✅ False positive rate: < 15%

### Scale Metrics

-   ✅ Handle 1000 events/hour per org
-   ✅ Support 10 concurrent organizations
-   ✅ GitHub API usage within limits

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

-   ❌ Python language support (Phase 2)
-   ❌ Datadog integration (Phase 2)
-   ❌ Local LLM models (Phase 2)
-   ❌ Advanced vector search (Phase 2)
-   ❌ On-premise deployment (Phase 2)
-   ❌ SSO/SCIM (Phase 2)
-   ❌ Custom deployment tracking (Phase 2)
-   ❌ Auto-PR generation (Phase 2+)

---

## Team & Resources

**Required Team:**

-   1 Full-stack Engineer (TS/React) — API, workers, UI
-   1 Backend/ML Engineer (Python) — Analyzers, LLM orchestration
-   0.5 DevOps/SRE — Infrastructure, monitoring

**Infrastructure Costs (MVP):**

-   ECS Fargate: ~$100/month
-   RDS Postgres: ~$50/month
-   Redis: ~$30/month
-   S3: ~$20/month
-   LLM (GPT-4o-mini): ~$50-200/month (depends on volume)
-   **Total: ~$250-400/month**

**Development Time:**

-   Phase 1: 6 weeks with 2.5 engineers = ~15 person-weeks
-   Assumes no major blockers
-   Includes buffer for debugging and iteration

---

## Phase 1 Completion Checklist

-   [ ] Sentry webhook successfully processed
-   [ ] GitHub code fetched with source map resolution
-   [ ] Deterministic analyzer catches common patterns
-   [ ] LLM generates structured RCA
-   [ ] Slack notification delivered
-   [ ] Web UI displays RCA with syntax highlighting
-   [ ] Multi-tenancy verified (2+ orgs isolated)
-   [ ] Rate limits enforced
-   [ ] Cost tracking working
-   [ ] Monitoring dashboards live
-   [ ] Documentation complete
-   [ ] Demo-ready with real Sentry events
