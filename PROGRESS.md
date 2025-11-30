# Buglens - Week 1 Progress

## Completed ✅

### 1. Project Setup

- ✅ Package.json with all dependencies
- ✅ TypeScript configuration (strict mode enabled)
- ✅ ESLint + Prettier
- ✅ GitHub Actions CI/CD pipeline
- ✅ Python venv + dependencies
- ✅ `.env.example` and configuration validation

### 2. Database Schema

- ✅ 9 migration files created
- ✅ Multi-tenancy: `org_id` on all tables
- ✅ Row-level security (RLS) policies
- ✅ Indexes optimized for tenant isolation
- ✅ Tables: organizations, events, rca_jobs, rca_results, repos, code_snapshots, users, integrations, cost_metrics

### 3. API Foundation

- ✅ Fastify server with logger
- ✅ CORS + JWT + Rate limiting plugins
- ✅ Health check endpoints
- ✅ Error handling middleware
- ✅ TypeScript types for all models
- ✅ Sentry webhook receiver (with HMAC validation)
- ✅ Organization context middleware
- ✅ Per-org rate limiting middleware

### 4. Testing

- ✅ Vitest configuration
- ✅ Unit tests for health endpoints
- ✅ Integration tests for Sentry webhook

## TODO 🚧

### Week 1 Remaining

1. **Infrastructure (Terraform)**
   - VPC + Security Groups
   - RDS (PostgreSQL)
   - ElastiCache (Redis)
   - S3 buckets
   - Secrets Manager
   - CloudWatch

2. **Local Development**
   - Docker Compose for local Postgres + Redis
   - Setup instructions in README

### Week 2 (Next)

- GitHub App setup
- OAuth flows
- Three-tier caching implementation
- Code fetcher service
- Source map support

## How to Run

### Install Dependencies

```bash
npm install
cd python && python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
```

### Setup Database

1. Create PostgreSQL database
2. Update `.env` with `DATABASE_URL`
3. Run migrations:

```bash
npm run migrate:up
```

### Start Server

```bash
npm run dev
```

### Run Tests

```bash
npm test
```

## Architecture Notes

- **Modular Monolith**: Single Node.js app, Python via child_process
- **Multi-Tenancy**: org_id + RLS from Day 1
- **Cost Controls**: Rate limits enforced per org
- **LLM**: GPT-4o-mini only (no local models for MVP)

## Next Steps

1. Setup local Docker Compose (Postgres + Redis)
2. Create seed data (test organization)
3. Test webhook end-to-end
4. Begin Week 2: GitHub integration
