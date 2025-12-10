# Buglens V2 - Technical Documentation

## Overview

Buglens is an AI-powered Root Cause Analysis (RCA) copilot for production incidents. The system ingests errors from Sentry, fetches code from GitHub, runs deterministic analysis + LLM reasoning, and delivers insights via Slack and web UI.

## Documentation Index

| Document                                                | Description                                 |
| ------------------------------------------------------- | ------------------------------------------- |
| [01 - API Layer](./01-api-layer.md)                     | Webhook handlers, middleware, routing       |
| [02 - Extraction Pipeline](./02-extraction-pipeline.md) | 3-stage deterministic + LLM extraction      |
| [03 - Code Fetcher](./03-code-fetcher.md)               | 3-tier GitHub caching strategy              |
| [04 - GitHub Integration](./04-github-integration.md)   | GitHub App auth, file fetching, rate limits |
| [05 - Python Analysis](./05-python-analysis.md)         | AST analysis, tree-sitter, rule engine      |
| [06 - Evidence Assembly](./06-evidence-assembly.md)     | Evidence collection, timeline, storage      |
| [07 - Workers & Queues](./07-workers-queues.md)         | BullMQ workers, job processing              |
| [08 - Database](./08-database.md)                       | PostgreSQL schema, RLS, migrations          |
| [09 - Types & Schemas](./09-types-schemas.md)           | Zod validation, TypeScript types            |
| [10 - Configuration](./10-configuration.md)             | Environment variables, rate limits          |

## Architecture Philosophy

### Core Principles

1. **Deterministic-First**: AST analysis runs before LLM. LLM can explain findings but cannot override deterministic evidence.
2. **Multi-Tenancy from Day 1**: Every table has `org_id`. Row-Level Security (RLS) enforced at database level.
3. **Cost Controls**: Per-organization quotas, real-time cost tracking, tiered plans.
4. **3-Tier Caching**: Aggressive GitHub caching (Redis → S3 → API) to prevent rate limit exhaustion.

### Technology Stack

| Layer          | Technology                    |
| -------------- | ----------------------------- |
| API Server     | Node.js + Fastify             |
| Database       | PostgreSQL 15 with RLS        |
| Cache/Queue    | Redis + BullMQ                |
| Object Storage | AWS S3 (LocalStack for dev)   |
| AST Analysis   | Python + tree-sitter          |
| LLM            | OpenAI GPT-4o-mini / DeepSeek |
| Integrations   | Sentry, GitHub App, Slack     |

## System Architecture Diagram

```
                                 ┌──────────────────────────────────────┐
                                 │         External Services            │
                                 │  ┌─────────┐ ┌────────┐ ┌─────────┐  │
                                 │  │ Sentry  │ │ GitHub │ │ OpenAI  │  │
                                 │  └────┬────┘ └───┬────┘ └────┬────┘  │
                                 └───────┼─────────┼───────────┼───────┘
                                         │         │           │
                    Webhooks ────────────┤         │           │
                                         ▼         │           │
┌────────────────────────────────────────────────────────────────────────────┐
│                              BUGLENS API SERVER                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        API Layer (Fastify)                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │   │
│  │  │   Webhooks   │  │  Middleware  │  │      Rate Limiting       │   │   │
│  │  │ /sentry/:org │  │  org-context │  │  (per-org, per-resource) │   │   │
│  │  │ /github      │  │  rate-limit  │  │                          │   │   │
│  │  └──────┬───────┘  └──────────────┘  └──────────────────────────┘   │   │
│  └─────────┼───────────────────────────────────────────────────────────┘   │
│            │                                                                │
│            ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Services Layer                                │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐     │   │
│  │  │   Extraction   │  │  Code Fetcher  │  │  Evidence          │     │   │
│  │  │   Pipeline     │  │  (3-tier cache)│  │  Collector         │     │   │
│  │  │  ┌──────────┐  │  │                │  │                    │     │   │
│  │  │  │ Stage 1  │  │  │  Redis(L1)     │  │  Timeline          │     │   │
│  │  │  │ Determ.  │  │  │     ↓          │  │  Reconstruction    │     │   │
│  │  │  ├──────────┤  │  │  S3(L2)        │  │                    │     │   │
│  │  │  │ Stage 2  │  │  │     ↓          │  │  Commit History    │     │   │
│  │  │  │ LLM Asst │──┼──┼─▶ GitHub API   │  │                    │     │   │
│  │  │  ├──────────┤  │  │                │  │  Environment       │     │   │
│  │  │  │ Stage 3  │  │  └────────────────┘  │  Context           │     │   │
│  │  │  │ Validate │  │                      └────────────────────┘     │   │
│  │  │  └──────────┘  │                                                  │   │
│  │  └────────────────┘                                                  │   │
│  │                                                                      │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐     │   │
│  │  │  GitHub        │  │  Cost          │  │  Python Bridge     │     │   │
│  │  │  Integration   │  │  Tracker       │  │  (subprocess)      │     │   │
│  │  │                │  │                │  │       │            │     │   │
│  │  │  App Auth      │  │  Token Usage   │  │       ▼            │     │   │
│  │  │  Rate Limits   │  │  Daily Costs   │  │  ┌─────────────┐   │     │   │
│  │  │  Repo Registry │  │                │  │  │ AST Analyzer│   │     │   │
│  │  └────────────────┘  └────────────────┘  │  │ LLM Extract │   │     │   │
│  │                                          │  │ Timeline    │   │     │   │
│  │                                          │  └─────────────┘   │     │   │
│  │                                          └────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Workers Layer (BullMQ)                        │   │
│  │  ┌────────────────────────┐    ┌────────────────────────────────┐   │   │
│  │  │  Deterministic Worker  │    │     Evidence Assembly Worker   │   │   │
│  │  │  - Code fetching       │───▶│     - Bundle creation          │   │   │
│  │  │  - AST analysis        │    │     - S3 storage               │   │   │
│  │  │  - Finding extraction  │    │     - Timeline reconstruction  │   │   │
│  │  └────────────────────────┘    └────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
                          │                    │
                          ▼                    ▼
     ┌─────────────────────────────────────────────────────────────────┐
     │                      Data Layer                                  │
     │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
     │  │  PostgreSQL  │  │    Redis     │  │         S3             │ │
     │  │  (with RLS)  │  │  (Cache/Q)   │  │  (Evidence Bundles)    │ │
     │  │              │  │              │  │                        │ │
     │  │ organizations│  │ gh:tokens:*  │  │ evidence/{date}/       │ │
     │  │ events       │  │ gh:file:*    │  │   {org_id}/{job_id}/   │ │
     │  │ rca_jobs     │  │ rate:*       │  │   {bundle}.json.gz     │ │
     │  │ rca_results  │  │ bull:*       │  │                        │ │
     │  │ repos        │  │              │  │ cache/github/          │ │
     │  │ code_snaps   │  │              │  │   {org}/{repo}/{sha}/  │ │
     │  │ cost_metrics │  │              │  │   {path}.gz            │ │
     │  └──────────────┘  └──────────────┘  └────────────────────────┘ │
     └─────────────────────────────────────────────────────────────────┘
```

## Documentation Index

### Subsystem Documentation

| Document                                                 | Description                              |
| -------------------------------------------------------- | ---------------------------------------- |
| [01-api-layer.md](./01-api-layer.md)                     | Fastify API server, webhooks, middleware |
| [02-extraction-pipeline.md](./02-extraction-pipeline.md) | 3-stage hybrid extraction system         |
| [03-code-fetcher.md](./03-code-fetcher.md)               | Code fetching with 3-tier caching        |
| [04-github-integration.md](./04-github-integration.md)   | GitHub App, authentication, API          |
| [05-python-analyzers.md](./05-python-analyzers.md)       | AST analysis, rules engine               |
| [06-evidence-collector.md](./06-evidence-collector.md)   | Evidence bundle assembly                 |
| [07-workers.md](./07-workers.md)                         | BullMQ job processing                    |
| [08-database.md](./08-database.md)                       | PostgreSQL schema, RLS, migrations       |
| [09-cost-tracking.md](./09-cost-tracking.md)             | LLM costs, rate limiting                 |
| [10-type-system.md](./10-type-system.md)                 | TypeScript types, Zod schemas            |

### Data Flow

```
Sentry Webhook
      │
      ▼
┌─────────────────┐
│ 1. HMAC Verify  │
│ 2. Env Filter   │
│ 3. Rate Check   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│   Store Event   │────▶│  Create Job     │
│   (PostgreSQL)  │     │  (BullMQ)       │
└─────────────────┘     └────────┬────────┘
                                 │
         ┌───────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│           EXTRACTION PIPELINE                │
│  ┌─────────────────────────────────────────┐│
│  │ Stage 1: Deterministic                  ││
│  │ - Parse release tag for repo/commit     ││
│  │ - Extract from Sentry contexts/tags     ││
│  │ - Classify stack frames                 ││
│  └─────────────────────────────────────────┘│
│                    │                         │
│          Is complete? ──No──┐               │
│                    │        │               │
│                   Yes       ▼               │
│                    │  ┌─────────────────────┐│
│                    │  │ Stage 2: LLM Assist ││
│                    │  │ - Clean noise frames││
│                    │  │ - Identify root     ││
│                    │  │ - Infer branch      ││
│                    │  └─────────────────────┘│
│                    │        │               │
│                    ▼        ▼               │
│  ┌─────────────────────────────────────────┐│
│  │ Stage 3: Validation                     ││
│  │ - Verify repo exists (GitHub API)       ││
│  │ - Verify commit/branch exists           ││
│  │ - Apply fallbacks                       ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│           CODE FETCHING                      │
│  ┌─────────────────────────────────────────┐│
│  │ For each stack frame:                   ││
│  │ 1. Check Redis (L1) ──Hit──▶ Return     ││
│  │ 2. Check S3 (L2) ──Hit──▶ Return        ││
│  │ 3. Check DB (L3) ──Hit──▶ Return        ││
│  │ 4. Fetch GitHub API ─────▶ Cache & Ret  ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│           AST ANALYSIS (Python)              │
│  - tree-sitter parsing                       │
│  - Rule evaluation:                          │
│    • NULL_ACCESS                             │
│    • UNAWAITED_PROMISE                       │
│    • MISSING_ERROR_HANDLER                   │
│  - Finding extraction with confidence        │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│           EVIDENCE ASSEMBLY                  │
│  - Error info extraction                     │
│  - Code context building                     │
│  - Timeline reconstruction                   │
│  - Recent commits fetching                   │
│  - Environment context                       │
│  - Store bundle in S3 (gzipped)             │
└─────────────────────────────────────────────┘
                    │
                    ▼
            [Week 5: LLM RCA]
                    │
                    ▼
            [Week 6: Slack/UI]
```

## Quick Reference

### Key Configuration (Environment Variables)

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# Redis
REDIS_URL=redis://localhost:6379

# GitHub App
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA..."
GITHUB_WEBHOOK_SECRET=secret

# Sentry
SENTRY_WEBHOOK_SECRET=secret

# LLM
LLM_PROVIDER=openai|deepseek
LLM_MODEL=gpt-4o-mini|deepseek-chat
OPENAI_API_KEY=sk-...

# Development
ALLOW_DEV_ERRORS=true|false
```

### Rate Limits by Plan

| Resource        | Free | Pro   | Enterprise |
| --------------- | ---- | ----- | ---------- |
| Events/hour     | 100  | 1,000 | 10,000     |
| RCA jobs/day    | 50   | 500   | 5,000      |
| LLM tokens/day  | 100K | 1M    | 10M        |
| GitHub API/hour | 500  | 2,000 | 5,000      |

### RCA Job Status Flow

```
pending → fetching_code → analyzing → deterministic_complete → reasoning → done
                                                                      ↘
                                                                    failed
```

## Development Setup

See [E2E Testing Guide](../E2E_TESTING_GUIDE.md) for complete setup instructions.

```bash
# Quick start
./scripts/setup-dev.sh

# Manual start
docker-compose up -d     # Infrastructure
npm run migrate:up       # Database
npm run dev              # API server (Terminal 1)
npm run worker           # Job worker (Terminal 2)
ngrok http 3000          # Webhook tunnel (Terminal 3)
```
