# Buglens V2 — Progress Report

**Last Updated:** November 30, 2025
**Current Phase:** Week 1 (Foundation) ✅ COMPLETE
**Next Phase:** Week 2 (GitHub Integration + Caching)

---

## Executive Summary

Week 1 foundation is **complete and validated**. The webhook receiver, multi-tenant architecture, rate limiting, and database schema are all working and tested. Ready to proceed to Week 2.

---

## Week 1 Status: ✅ COMPLETE

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

## Week 2 TODO: GitHub Integration + Caching

### Goals

- GitHub App setup and OAuth flow
- Three-tier caching implementation (Redis → S3 → DB)
- Code fetcher service with source map support
- Rate limit tracking per organization

### Tasks

#### 1. GitHub App Setup

- [ ] Create GitHub App with `contents:read` permission
- [ ] Implement OAuth flow for repo access
- [ ] Store installation tokens in AWS Secrets Manager (or env for local dev)
- [ ] Add `github_installation_id` to repos table

#### 2. Code Fetcher Service

```
src/services/code-fetcher.ts
├── fetchFile(repo, path, sha, orgId)
├── resolveSourceMap(frame)
├── extractContext(content, line, radius)
└── detectLanguage(filePath)
```

- [ ] Create `CodeFetcher` class
- [ ] Implement source map resolution (for minified JS)
- [ ] Extract surrounding code context (50 lines before/after)
- [ ] Language detection by file extension

#### 3. Three-Tier Cache

```
Cache Priority:
1. Redis (hot) - 1 hour TTL
2. S3 (warm) - 7 day retention
3. Database (cold) - permanent for analyzed files
```

- [ ] Implement Redis cache layer (`gh:file:{org}:{repo}:{sha}:{path}`)
- [ ] Implement S3 cache layer (gzipped, 7-day lifecycle policy)
- [ ] Implement database snapshot layer
- [ ] Cache invalidation strategy
- [ ] Target: >80% cache hit rate

#### 4. GitHub Rate Limit Tracking

- [ ] Track API calls per org per hour
- [ ] Implement exponential backoff on rate limits
- [ ] Queue jobs when limits hit
- [ ] Add alerts for high usage

#### 5. Source Map Support

- [ ] Fetch `.map` files from GitHub
- [ ] Parse with `source-map` library (already in package.json)
- [ ] Map minified → original location
- [ ] Cache parsed source maps

### Week 2 Acceptance Criteria

- [ ] GitHub App installed to test repo
- [ ] Fetch file content via API (cached)
- [ ] Source map parsing working
- [ ] Cache hit rate > 80% on repeated requests
- [ ] GitHub API calls tracked per org

---

## Weeks 3-6 Overview

### Week 3: Deterministic Analyzers (JS/TS Only)

- Python AST analyzer setup (`python/analyzers/js_analyzer.py`)
- Deterministic rules: null access, unawaited promises, missing error handlers
- Node.js → Python integration via child_process
- Target: 75% accuracy on synthetic dataset

### Week 4: Evidence Assembly + Timeline

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
│   │   └── client.ts           ✅ PostgreSQL connection
│   ├── services/               ⏳ Week 2: CodeFetcher, etc.
│   ├── types/
│   │   ├── models.ts           ✅ Database types
│   │   └── sentry.ts           ✅ Sentry webhook schema
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
│   ├── unit/                   ✅ 2 tests
│   └── integration/            ✅ 6 tests
├── scripts/
│   ├── test-webhook.cjs        ✅ E2E webhook tests
│   └── test-multi-tenant-rate-limits.cjs ✅ Multi-tenant tests
└── web/                        ⏳ Week 6: React UI
```

---

## Test Results Summary

### Vitest (Unit + Integration)

```
✓ tests/unit/health.test.ts (2)
✓ tests/integration/sentry-webhook.test.ts (6)

Test Files  2 passed (2)
     Tests  8 passed (8)
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
| GitHub API rate limits  | High       | High     | 3-tier caching (Week 2) | ⏳ Pending     |
| LLM cost overruns       | Medium     | High     | Token quotas per org    | ⏳ Week 5      |
| Multi-tenant data leaks | Low        | Critical | RLS + org_id everywhere | ✅ Implemented |
| Source map complexity   | Medium     | Medium   | Week 2 dedicated effort | ⏳ Pending     |
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

**Next Action:** Start Week 2 — GitHub App setup and code fetcher service.
