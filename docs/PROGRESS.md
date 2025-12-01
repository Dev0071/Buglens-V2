# Buglens V2 — Progress Report

**Last Updated:** November 30, 2025
**Current Phase:** Week 2 (GitHub Integration + Caching) ✅ COMPLETE
**Next Phase:** Week 3 (Deterministic Analyzers)

---

## Executive Summary

Week 2 GitHub integration and caching is **complete and validated**. The GitHub service, three-tier cache, code fetcher with source map support, and rate limiting per org are all working and tested. 32 tests passing. Ready to proceed to Week 3.

---

## Week 2 Status: ✅ COMPLETE

### Acceptance Criteria (from Roadmap)

| Criteria                                    | Status | Evidence                                |
| ------------------------------------------- | ------ | --------------------------------------- |
| GitHub App authentication working           | ✅     | Octokit integration, token caching      |
| Three-tier cache (Redis → S3 → DB)          | ✅     | CacheService with gzip compression      |
| Code fetcher retrieves files from GitHub    | ✅     | CodeFetcherService with cache fallback  |
| Source map resolution (minified → original) | ✅     | SourceMapConsumer integration           |
| GitHub rate limit tracking per org          | ✅     | Redis-based tracking, plan-based limits |
| Cache statistics tracking                   | ✅     | Hit rate calculation, tier tracking     |

### Components Implemented

#### 1. GitHub Types (`src/types/github.ts`) ✅

- [x] GitHub API response types (file, repo, commit, installation)
- [x] Stack frame types (Sentry format)
- [x] Code context types
- [x] Cache key builders (Redis, S3)
- [x] Rate limit types
- [x] Zod schemas for validation

#### 2. Redis Client (`src/db/redis.ts`) ✅

- [x] ioredis client singleton with retry strategy
- [x] Generic cache operations (get, set, exists, delete)
- [x] Hash operations (hset, hget, hincrby)
- [x] Installation token caching (55 min TTL)
- [x] Rate limit counter support
- [x] Reconnection logic

#### 3. Three-Tier Cache (`src/services/cache.ts`) ✅

- [x] Redis layer (1 hour TTL, hot cache)
- [x] S3 layer (7 day retention, gzip compressed)
- [x] Database layer (permanent, code_snapshots table)
- [x] Cache promotion (DB → S3 → Redis)
- [x] Statistics tracking (hits, misses, hit rate)
- [x] Key format: `gh:file:{orgId}:{repo}:{sha}:{path}`

#### 4. GitHub Service (`src/services/github.ts`) ✅

- [x] GitHub App authentication (Octokit)
- [x] Installation token management (cached 55 min)
- [x] File content fetching from GitHub API
- [x] Recent commits fetching
- [x] Repository listing for installations
- [x] Rate limit checking per org per plan
- [x] API call tracking
- [x] Error classes (GitHubRateLimitError, GitHubAuthError)
- [x] Utility functions (decodeFileContent, parseRepoFullName, detectLanguage)

#### 5. Code Fetcher (`src/services/code-fetcher.ts`) ✅

- [x] Stack frame normalization (abs_path → filename fallback)
- [x] 3-tier cache lookup with tier tracking
- [x] GitHub API fetch on cache miss
- [x] Minified code detection (line length + patterns)
- [x] Source map resolution (external + inline)
- [x] Code context extraction (±10 lines around error)
- [x] Language detection from content
- [x] Batch processing for stack traces (5 concurrent)

#### 6. Source Map Support ✅

- [x] `source-map` package installed
- [x] External `.map` file fetching
- [x] Inline source map extraction (base64)
- [x] Original position resolution
- [x] Embedded source content extraction
- [x] Resource cleanup (consumer.destroy())

### Test Results

```
Total Tests: 32
Passed: 32
Failed: 0

Test Files:
✓ tests/unit/health.test.ts (2)
✓ tests/integration/sentry-webhook.test.ts (6)
✓ tests/integration/github-cache.test.ts (24)
```

### Performance Metrics

| Metric                  | Target  | Actual  | Status |
| ----------------------- | ------- | ------- | ------ |
| Cache hit tracking      | ✓       | 4 tiers | ✅     |
| Source map parsing      | ✓       | Working | ✅     |
| Rate limit enforcement  | per-org | 3 tiers | ✅     |
| Context lines extracted | ±10     | ±10     | ✅     |
| Concurrent file fetches | 5       | 5       | ✅     |

---

## Week 1 Status: ✅ COMPLETE (Previous)

### Acceptance Criteria (from Roadmap)

| Criteria                                               | Status | Evidence                                    |
| ------------------------------------------------------ | ------ | ------------------------------------------- |
| API accepts Sentry webhook with valid HMAC signature   | ✅     | 9/9 E2E tests passing                       |
| Invalid signature → 401 response                       | ✅     | Timing-safe comparison implemented          |
| Multi-tenancy: 100 events from 2 orgs → isolated in DB | ✅     | 50+50 events, 0 cross-contamination         |
| Rate limiting: Exceed limit → 429 response             | ✅     | 105/105 requests rejected                   |
| Events table contains all required fields              | ✅     | platform, org_id, event_id, signature, etc. |
| CI pipeline green                                      | ✅     | 8/8 vitest tests passing                    |

### Components Implemented

#### 1. Project Infrastructure ✅

- [x] TypeScript + ESLint + Prettier configuration
- [x] Vitest test framework
- [x] Docker Compose (Postgres + Redis)
- [x] Environment variable validation (Zod)
- [x] Structured logging (Pino)

#### 2. Database Schema ✅

- [x] 9 migrations created:
  - `organizations` (multi-tenancy root)
  - `events` (Sentry webhooks)
  - `rca_jobs` (job queue)
  - `rca_results` (analysis output)
  - `repos` (GitHub repositories)
  - `code_snapshots` (cached code)
  - `users` (org members)
  - `integrations` (Sentry/GitHub/Slack configs)
  - `cost_metrics` (usage tracking)
- [x] All tables have `org_id` column
- [x] Indexes optimized for tenant queries
- [x] Row-level security policies defined

#### 3. API Foundation ✅

- [x] Fastify server with middleware
- [x] CORS + JWT + Rate limiting plugins
- [x] Health check endpoints (`/health`, `/ready`)
- [x] Organization context middleware
- [x] Per-org rate limiting (100 req/min)

#### 4. Webhook Receiver ✅

- [x] `POST /api/v1/webhooks/sentry/:org_id`
- [x] HMAC signature validation (timing-safe)
- [x] Raw body fallback for signature verification
- [x] Organization existence validation (404 if missing)
- [x] Idempotency check (duplicate event detection)
- [x] Zod schema validation for Sentry payloads
- [x] Event stored with full context (stack trace, breadcrumbs, etc.)

#### 5. Testing ✅

- [x] Unit tests: 2/2 passing (health endpoints)
- [x] Integration tests: 6/6 passing (webhook scenarios)
- [x] E2E tests: 9/9 passing (`scripts/test-webhook.cjs`)
- [x] Multi-tenant tests: 2/2 passing (`scripts/test-multi-tenant-rate-limits.cjs`)

### Performance Metrics

| Metric                 | Target  | Actual  | Status       |
| ---------------------- | ------- | ------- | ------------ |
| Webhook response time  | <50ms   | ~6-12ms | ✅ 8x better |
| Rate limit enforcement | 100/min | 100/min | ✅           |
| Multi-tenant isolation | 100%    | 100%    | ✅           |
| Test coverage          | >80%    | ~90%    | ✅           |

---

## Week 2 DONE — GitHub Integration + Caching ✅

See "Week 2 Status" section above for details.

---

## Week 3 TODO: Deterministic Analyzers (JS/TS Only)

### Goals

- Python AST analyzer setup
- Deterministic rules for common JS/TS bugs
- Node.js → Python integration
- Target: 75% accuracy on synthetic dataset

### Tasks

#### 1. Python Analyzer Setup

```
python/analyzers/
├── __init__.py
├── base.py              # Base analyzer class
├── js_analyzer.py       # JavaScript/TypeScript analyzer
└── rules/
    ├── null_access.py   # Null/undefined access detection
    ├── unawaited.py     # Unawaited promise detection
    └── error_handler.py # Missing error handler detection
```

- [ ] Create base analyzer class with common utilities
- [ ] Set up tree-sitter for JS/TS parsing
- [ ] Implement rule engine for pattern matching
- [ ] Create output schema for findings

#### 2. Deterministic Rules (JS/TS)

- [ ] **Null Access Detection**
  - Property access on potentially null/undefined
  - Optional chaining violations
  - Missing null checks

- [ ] **Unawaited Promise Detection**
  - Missing await on async functions
  - Fire-and-forget promise patterns
  - Promise.all misuse

- [ ] **Missing Error Handlers**
  - Uncaught try/catch blocks
  - Missing .catch() on promises
  - EventEmitter error handlers

#### 3. Node.js → Python Integration

- [ ] Create `python-bridge.ts` service
- [ ] Use `child_process.spawn` for Python calls
- [ ] JSON-based input/output protocol
- [ ] Error handling and timeouts
- [ ] Health check for Python process

#### 4. Evidence Bundling

- [ ] Collect code context from code-fetcher
- [ ] Parse stack trace frames
- [ ] Bundle findings with evidence
- [ ] Store analysis results

### Week 3 Acceptance Criteria

- [ ] Python analyzers detect null access bugs
- [ ] Python analyzers detect unawaited promises
- [ ] Node → Python bridge working
- [ ] 75% accuracy on synthetic null-access test cases
- [ ] Analysis results stored in DB

---

## Week 4 TODO: Evidence Assembly + Timeline

- Evidence collector service
- Timeline builder from Sentry breadcrumbs
- Recent commits fetcher
- Evidence bundling to S3

### Week 5: LLM Orchestration (GPT-4o-mini)

- Python LLM service (`python/llm/orchestrator.py`)
- Structured prompts with evidence
- Response validation (JSON schema)
- Cost tracking per org

### Week 6: Slack + Web UI

- Slack notification with RCA summary
- Feedback buttons (👍/👎)
- Basic React web UI (event list, RCA detail)
- End-to-end demo

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Buglens V2 Architecture                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────────┐   │
│  │  Sentry  │───▶│  Webhook API │───▶│  PostgreSQL (RDS)   │   │
│  │ Webhook  │    │  (Fastify)   │    │  - events           │   │
│  └──────────┘    └──────────────┘    │  - rca_jobs         │   │
│                         │            │  - rca_results      │   │
│                         ▼            │  - organizations    │   │
│                  ┌──────────────┐    └─────────────────────┘   │
│                  │   BullMQ     │                               │
│                  │ Job Queue    │◀──── Redis                   │
│                  └──────────────┘                               │
│                         │                                       │
│     ┌───────────────────┼───────────────────┐                   │
│     ▼                   ▼                   ▼                   │
│ ┌────────────┐   ┌────────────┐   ┌────────────┐               │
│ │ Code       │   │ Analyzer   │   │ LLM        │               │
│ │ Fetcher    │   │ Worker     │   │ Worker     │               │
│ │ (GitHub)   │   │ (Python)   │   │ (GPT-4o)   │               │
│ └────────────┘   └────────────┘   └────────────┘               │
│       │                │                 │                      │
│       ▼                ▼                 ▼                      │
│ ┌────────────────────────────────────────────────┐             │
│ │                 3-Tier Cache                    │             │
│ │  Redis (1hr) → S3 (7d) → PostgreSQL (permanent) │             │
│ └────────────────────────────────────────────────┘             │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐                              │
│  │  Slack   │◀───│  Notifier    │                              │
│  │  Bot     │    │  Service     │                              │
│  └──────────┘    └──────────────┘                              │
│                                                                 │
│  ┌──────────────────────────────────────────────────┐          │
│  │              React Web UI (Vite)                  │          │
│  │  - Event List  - RCA Detail  - Feedback Panel    │          │
│  └──────────────────────────────────────────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure (Current)

```
buglens/
├── src/
│   ├── api/
│   │   ├── app.ts              ✅ Fastify server setup
│   │   ├── server.ts           ✅ Server entry point
│   │   ├── middleware/
│   │   │   ├── org-context.ts  ✅ Org context setter
│   │   │   └── rate-limit.ts   ✅ Per-org rate limiting
│   │   └── routes/
│   │       ├── health.ts       ✅ Health endpoints
│   │       └── webhooks.ts     ✅ Sentry webhook receiver
│   ├── db/
│   │   ├── client.ts           ✅ PostgreSQL connection
│   │   └── redis.ts            ✅ Redis client singleton
│   ├── services/
│   │   ├── cache.ts            ✅ Three-tier cache (Redis → S3 → DB)
│   │   ├── github.ts           ✅ GitHub App integration
│   │   └── code-fetcher.ts     ✅ Code fetching + source maps
│   ├── types/
│   │   ├── models.ts           ✅ Database types
│   │   ├── sentry.ts           ✅ Sentry webhook schema
│   │   └── github.ts           ✅ GitHub API types + cache keys
│   ├── utils/
│   │   ├── config.ts           ✅ Environment validation
│   │   ├── logger.ts           ✅ Pino logger
│   │   └── rate-limits.ts      ✅ Rate limit config
│   └── workers/                ⏳ Week 3: BullMQ workers
├── python/
│   ├── analyzers/              ⏳ Week 3: JS/TS analyzer
│   ├── llm/                    ⏳ Week 5: GPT-4o-mini
│   └── timeline/               ⏳ Week 4: Breadcrumb parser
├── migrations/                 ✅ 9 migrations complete
├── tests/
│   ├── unit/
│   │   └── health.test.ts      ✅ 2 tests
│   └── integration/
│       ├── sentry-webhook.test.ts  ✅ 6 tests
│       └── github-cache.test.ts    ✅ 24 tests
├── scripts/
│   ├── test-webhook.cjs        ✅ E2E webhook tests
│   └── test-multi-tenant-rate-limits.cjs ✅ Multi-tenant tests
├── docs/
│   └── PROGRESS.md             ✅ This file
└── web/                        ⏳ Week 6: React UI
```

---

## Test Results Summary

### Vitest (Unit + Integration)

```
✓ tests/unit/health.test.ts (2)
✓ tests/integration/sentry-webhook.test.ts (6)
✓ tests/integration/github-cache.test.ts (24)

Test Files  3 passed (3)
     Tests  32 passed (32)
```

### E2E Webhook Tests

```
Total Tests: 9
Passed: 9
Failed: 0

🎉 All tests passed!
```

### Multi-Tenant & Rate Limit Tests

```
Tests Passed: 2
Tests Failed: 0

✅ Multi-tenancy isolation verified
✅ Rate limiting working correctly
```

---

## Risk Register

| Risk                    | Likelihood | Impact   | Mitigation              | Status         |
| ----------------------- | ---------- | -------- | ----------------------- | -------------- |
| GitHub API rate limits  | High       | High     | 3-tier caching          | ✅ Implemented |
| LLM cost overruns       | Medium     | High     | Token quotas per org    | ⏳ Week 5      |
| Multi-tenant data leaks | Low        | Critical | RLS + org_id everywhere | ✅ Implemented |
| Source map complexity   | Medium     | Medium   | Week 2 dedicated effort | ✅ Implemented |
| Job failures            | Medium     | Medium   | Retry logic + DLQ       | ⏳ Week 3      |

---

## Cost Projections

### Infrastructure (Monthly)

| Component    | MVP      | Growth   | Scale    |
| ------------ | -------- | -------- | -------- |
| ECS Fargate  | $100     | $150     | $300     |
| RDS Postgres | $50      | $100     | $200     |
| Redis        | $30      | $50      | $100     |
| S3           | $20      | $50      | $150     |
| CloudWatch   | $20      | $50      | $100     |
| **Subtotal** | **$220** | **$400** | **$850** |

### LLM Costs (Monthly)

| Volume    | GPT-4o-mini        |
| --------- | ------------------ |
| 1K RCAs   | $150-300           |
| 10K RCAs  | $1.5K-3K           |
| 50K+ RCAs | Consider local LLM |

**Target Cost per RCA:** <$0.15

---

## Key Decisions Made

1. **Architecture:** Modular monolith (NOT microservices)
2. **LLM:** GPT-4o-mini only for MVP (no local models)
3. **Languages:** JS/TS only in Phase 1 (Python in Week 8)
4. **Caching:** 3-tier mandatory from Week 2
5. **Multi-tenancy:** org_id + RLS from Day 1
6. **Source maps:** Required (not optional)

---

## Team Notes

**Current:** Solo development
**Recommended for Week 2+:**

- 1 Full-stack Engineer (Node.js/React)
- 0.5 Backend/ML Engineer (Python analyzers)
- 0.25 DevOps (AWS/Terraform)

---

## References

- [Phase 1 Roadmap](<./Buglens%20Roadmap%20Phase%201%20(Week%201-6).md>)
- [Phase 2 Roadmap](<./Buglens%20Roadmap%20Phase%202%20(Week%207-12).md>)
- [Architecture Document](./Buglens%20Architecture%20UPDATED.md)
- [LLM Architecture](./buglens%20llm%20architecture%20UPDATED.md)
- [PRD](./buglens_prd.md)
- [Founder Notes](./Founders%20note.md)

---

**Next Action:** Start Week 3 — Python deterministic analyzers for JS/TS bugs (null access, unawaited promises).
