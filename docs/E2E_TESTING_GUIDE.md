# Buglens E2E Testing Guide

This guide documents how to test Buglens end-to-end using ngrok to receive real webhooks from Sentry and GitHub.

## Prerequisites

1. **ngrok installed**: `brew install ngrok` or download from [ngrok.com](https://ngrok.com)
2. **Docker running**: For PostgreSQL and Redis
3. **Node.js 18+**: For running the application
4. **Python 3.10+**: For the analysis workers (with virtual environment)
5. **GitHub App created**: With webhook URL pointing to ngrok
6. **Sentry project**: With webhook integration configured
7. **LLM API key**: OpenAI or DeepSeek API key for LLM-assisted extraction

---

## System Architecture

Buglens consists of multiple components that need to run together:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   PostgreSQL    │     │      Redis      │     │      S3         │
│   (Database)    │     │   (Job Queues)  │     │   (Storage)     │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   API Server    │     │  BullMQ Worker  │     │  Python Bridge  │
│   (Fastify)     │────▶│  (Job Processor)│────▶│  (Analyzers)    │
│   Port 3000     │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         ▲
         │
    ┌────┴────┐
    │  ngrok  │
    │ Tunnel  │
    └─────────┘
         ▲
    ┌────┴────┐
    │ Sentry  │
    │ GitHub  │
    └─────────┘
```

---

## Quick Start (Automated)

The fastest way to get started:

```bash
# Make setup script executable and run
chmod +x scripts/setup-dev.sh
./scripts/setup-dev.sh
```

This script will:

1. Start Docker containers (PostgreSQL, Redis)
2. Wait for PostgreSQL to be ready
3. Run database migrations
4. Seed development data

---

## Manual Setup (Step-by-Step)

### Step 1: Start Infrastructure Services

```bash
# Start PostgreSQL and Redis containers
docker-compose up -d

# Verify containers are running
docker ps

# Expected output:
# CONTAINER ID   IMAGE          STATUS          PORTS                    NAMES
# xxxx           postgres:15    Up xx seconds   0.0.0.0:5432->5432/tcp   buglens-postgres
# xxxx           redis:7        Up xx seconds   0.0.0.0:6379->6379/tcp   buglens-redis
```

### Step 2: Run Database Migrations

```bash
# Run all pending migrations
npm run migrate:up

# Expected output:
# > node-pg-migrate up
# Migrations up to 010_add_extraction_result executed successfully

# To check migration status
npm run migrate:up -- --dry-run

# To rollback last migration (if needed)
npm run migrate:down
```

**Migration files location:** `migrations/`

- `001_create_organizations.cjs` - Organizations table
- `002_create_events.cjs` - Events table
- `003_create_rca_jobs.cjs` - RCA jobs queue
- `004_create_rca_results.cjs` - Analysis results
- `005_create_repos.cjs` - GitHub repositories
- `006_create_code_snapshots.cjs` - Code cache
- `007_create_users.cjs` - Users table
- `008_create_integrations.cjs` - Third-party integrations
- `009_create_cost_metrics.cjs` - Cost tracking
- `010_add_extraction_result.cjs` - Extraction pipeline results

### Step 3: Seed Development Data (Optional)

```bash
# Connect to database and run seed script
psql postgresql://buglens:buglens_dev@localhost:5432/buglens_dev < scripts/seed-dev-data.sql

# Or connect interactively
psql postgresql://buglens:buglens_dev@localhost:5432/buglens_dev

# List tables
\dt

# Check organizations
SELECT * FROM organizations;
```

### Step 4: Set Up Python Environment

```bash
# Navigate to Python directory
cd python

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate  # macOS/Linux
# or: .\venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Verify installation
python -c "import tree_sitter; print('tree-sitter OK')"

# Return to project root
cd ..
```

### Step 5: Configure Environment Variables

Create `.env` file in project root:

```bash
# Copy example and edit
cp .env.example .env  # If exists, otherwise create new

# Edit with your values
nano .env
```

**Required Environment Variables:**

```bash
# ====================================
# Core Configuration
# ====================================
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# ====================================
# Database (PostgreSQL)
# ====================================
DATABASE_URL=postgresql://buglens:buglens_dev@localhost:5432/buglens_dev
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# ====================================
# Redis (Job Queues)
# ====================================
REDIS_URL=redis://localhost:6379

# ====================================
# AWS / S3 (or LocalStack for dev)
# ====================================
AWS_REGION=us-east-1
S3_BUCKET_NAME=buglens-dev
# For LocalStack (local S3):
S3_ENDPOINT=http://localhost:4566

# ====================================
# Authentication
# ====================================
JWT_SECRET=your-32-character-or-longer-jwt-secret-key-here

# ====================================
# Development Testing
# ====================================
ALLOW_DEV_ERRORS=true  # Process local/dev environment errors

# ====================================
# Sentry Integration
# ====================================
SENTRY_WEBHOOK_SECRET=your-sentry-webhook-secret

# ====================================
# GitHub App
# ====================================
GITHUB_APP_ID=your-github-app-id
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-github-webhook-secret

# ====================================
# LLM Configuration
# ====================================
# Option A: OpenAI
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-proj-your-openai-api-key

# Option B: DeepSeek (uncomment and comment above)
# LLM_PROVIDER=deepseek
# LLM_MODEL=deepseek-chat
# LLM_BASE_URL=https://api.deepseek.com
# OPENAI_API_KEY=sk-your-deepseek-api-key

# ====================================
# Python Integration
# ====================================
PYTHON_BIN=python3  # or path to venv python
PYTHON_ANALYZER_TIMEOUT_MS=10000
```

### Step 6: Start ngrok Tunnel

```bash
# In a NEW terminal window
ngrok http 3000

# Note the forwarding URL, e.g.:
# Forwarding: https://abc123.ngrok-free.app -> http://localhost:3000
```

Keep this terminal open - you'll need the ngrok URL for webhook configuration.

### Step 7: Start Application Components

You need **3 terminal windows** to run all components:

**Terminal 1: API Server**

```bash
# Start the Fastify API server
npm run dev

# Expected output:
# {"level":30,"time":xxx,"msg":"Server listening at http://0.0.0.0:3000"}
```

**Terminal 2: BullMQ Worker**

```bash
# Start the job processor worker
npm run worker

# Expected output:
# {"level":30,"time":xxx,"msg":"Deterministic analyzer worker online"}
```

**Terminal 3: ngrok (already running from Step 6)**

### Step 8: Verify All Components

```bash
# Check API health
curl http://localhost:3000/health
# Expected: {"status":"healthy","timestamp":"..."}

# Check ready endpoint (database + redis)
curl http://localhost:3000/ready
# Expected: {"status":"ready","checks":{"database":"ok","redis":"ok"}}

# Check ngrok is forwarding
curl https://YOUR-NGROK-URL.ngrok-free.app/health
# Expected: {"status":"healthy","timestamp":"..."}
```

---

## Running Components Summary

| Component      | Command                | Purpose                    | Terminal   |
| -------------- | ---------------------- | -------------------------- | ---------- |
| Infrastructure | `docker-compose up -d` | PostgreSQL + Redis         | Background |
| Migrations     | `npm run migrate:up`   | Database schema            | One-time   |
| API Server     | `npm run dev`          | Webhook receiver, REST API | Terminal 1 |
| Worker         | `npm run worker`       | Job processing, analysis   | Terminal 2 |
| ngrok          | `ngrok http 3000`      | External webhook tunnel    | Terminal 3 |

---

## Useful Commands Reference

```bash
# === Database ===
npm run migrate:up          # Run pending migrations
npm run migrate:down        # Rollback last migration
npm run migrate:create name # Create new migration

# === Development ===
npm run dev                 # Start API server (hot reload)
npm run worker              # Start job worker
npm run build               # Compile TypeScript
npm run start               # Run compiled code

# === Testing ===
npm test                    # Run all tests
npm run test:ui             # Run tests with UI

# === Code Quality ===
npm run lint                # Run ESLint
npm run format              # Run Prettier

# === Docker ===
docker-compose up -d        # Start services
docker-compose down         # Stop services
docker-compose logs -f      # View logs
docker-compose ps           # List running containers

# === Database Access ===
psql postgresql://buglens:buglens_dev@localhost:5432/buglens_dev
```

---

## Webhook Configuration

### Sentry Webhook Setup

1. Go to **Sentry → Settings → Integrations → Webhooks**
2. Add webhook URL: `https://YOUR-NGROK-URL.ngrok-free.app/api/v1/webhooks/sentry/{org_id}`
3. Enable events: `issue.created`, `event.alert`
4. Copy the **Client Secret** to `SENTRY_WEBHOOK_SECRET`

**Important:** Replace `{org_id}` with your test organization UUID. You can create one:

```bash
# In psql
INSERT INTO organizations (id, slug, name, plan, sentry_webhook_secret)
VALUES (
  'test-org-uuid-here',
  'my-test-org',
  'My Test Organization',
  'pro',
  'your-sentry-webhook-secret'
);
```

### GitHub App Setup

1. Go to **GitHub → Settings → Developer Settings → GitHub Apps**
2. Create or edit your app:
   - **Webhook URL**: `https://YOUR-NGROK-URL.ngrok-free.app/api/v1/webhooks/github`
   - **Webhook secret**: Your `GITHUB_WEBHOOK_SECRET`
3. Required permissions:
   - Repository contents: **Read**
   - Metadata: **Read**
4. Subscribe to events:
   - `Push`
   - `Installation` and `Installation repositories`

---

## Test Scenarios

### Scenario 1: Basic Error Flow (Sentry → Database)

**Goal:** Verify errors from Sentry are stored correctly.

**Steps:**

1. Trigger an error in your Sentry-integrated app
2. Watch server logs for incoming webhook
3. Verify database storage

**Expected Logs:**

```
incoming request POST /api/v1/webhooks/sentry/{org_id}
Received Sentry event
Event received { org_id, event_id, sentry_event_id }
request completed { statusCode: 200 }
```

**Database Verification:**

```sql
-- Check event was stored
SELECT id, sentry_event_id, message, platform, environment,
       error_type, created_at
FROM events
WHERE org_id = 'your-org-id'
ORDER BY created_at DESC
LIMIT 5;

-- Verify raw payload stored
SELECT id, raw_payload->'exception'->'values'->0->>'type' as error_type,
       raw_payload->'exception'->'values'->0->>'value' as error_message
FROM events
WHERE org_id = 'your-org-id'
ORDER BY created_at DESC
LIMIT 5;
```

---

### Scenario 2: GitHub Integration Flow

**Goal:** Verify GitHub App installation and repo sync.

**Steps:**

1. Install your GitHub App on a test repository
2. Watch server logs for installation webhook
3. Verify organization and repos are stored

**Expected Logs:**

```
Received GitHub webhook { event: "installation" }
GitHub App installed { installationId, account, repoCount }
Created new organization { slug, id }
Repositories registered { orgId, repoCount }
```

**Database Verification:**

```sql
-- Check organization was created
SELECT id, slug, github_installation_id, plan, created_at
FROM organizations
WHERE slug = 'your-github-username-or-org';

-- Check repos were registered
SELECT id, full_name, default_branch, last_analyzed_at
FROM repos
WHERE org_id = (SELECT id FROM organizations WHERE slug = 'your-github-username-or-org')
ORDER BY full_name;
```

---

### Scenario 3: Full RCA Pipeline

**Goal:** Test complete error → code fetch → analysis → RCA flow.

**Prerequisites:**

- GitHub App installed on repo with error source
- Sentry configured with repo context (using Sentry's GitHub integration)

**Steps:**

1. Trigger an error in your app with proper stack trace
2. Verify RCA job is created
3. Monitor job processing

**Database Verification:**

```sql
-- Check RCA job created
SELECT j.id, j.status, j.priority, j.attempts, j.created_at,
       e.message, e.error_type
FROM rca_jobs j
JOIN events e ON j.event_id = e.id
WHERE j.org_id = 'your-org-id'
ORDER BY j.created_at DESC
LIMIT 5;

-- Check job progress
SELECT id, status, started_at, completed_at,
       error_message, extraction_result
FROM rca_jobs
WHERE org_id = 'your-org-id'
ORDER BY created_at DESC
LIMIT 1;

-- Check RCA results (if completed)
SELECT r.id, r.root_cause_summary, r.confidence_score,
       r.suggested_fix, r.llm_tokens_used, r.created_at
FROM rca_results r
JOIN rca_jobs j ON r.job_id = j.id
WHERE j.org_id = 'your-org-id'
ORDER BY r.created_at DESC
LIMIT 5;
```

---

### Scenario 4: Code Fetching Pipeline

**Goal:** Verify code is fetched from GitHub for stack frames.

**Database Verification:**

```sql
-- Check code snapshots cached
SELECT cs.id, cs.repo_id, cs.file_path, cs.commit_sha,
       cs.fetch_duration_ms, cs.cached, cs.created_at
FROM code_snapshots cs
JOIN repos r ON cs.repo_id = r.id
WHERE r.org_id = 'your-org-id'
ORDER BY cs.created_at DESC
LIMIT 10;

-- Check cache effectiveness
SELECT
  COUNT(*) as total_fetches,
  SUM(CASE WHEN cached THEN 1 ELSE 0 END) as cache_hits,
  ROUND(100.0 * SUM(CASE WHEN cached THEN 1 ELSE 0 END) / COUNT(*), 2) as hit_rate
FROM code_snapshots cs
JOIN repos r ON cs.repo_id = r.id
WHERE r.org_id = 'your-org-id'
AND cs.created_at > NOW() - INTERVAL '1 day';
```

---

### Scenario 5: Extraction Pipeline Stages

**Goal:** Verify three-stage extraction (Deterministic → LLM Assist → Validation).

**Database Verification:**

```sql
-- Check extraction results table
SELECT er.extraction_id, er.extraction_stage, er.is_complete,
       er.repo, er.file_path, er.function_name, er.error_context,
       er.created_at
FROM extraction_results er
JOIN rca_jobs j ON er.job_id = j.id
WHERE j.org_id = 'your-org-id'
ORDER BY er.created_at DESC
LIMIT 10;

-- Check stage progression
SELECT
  extraction_stage,
  COUNT(*) as count,
  AVG(CASE WHEN is_complete THEN 1 ELSE 0 END) * 100 as completion_rate
FROM extraction_results er
JOIN rca_jobs j ON er.job_id = j.id
WHERE j.org_id = 'your-org-id'
GROUP BY extraction_stage;
```

---

### Scenario 6: Cost Tracking

**Goal:** Verify LLM costs are tracked correctly.

**Database Verification:**

```sql
-- Check daily cost metrics
SELECT date, llm_tokens_used, llm_cost_usd,
       github_api_calls, rca_jobs_completed
FROM cost_metrics
WHERE org_id = 'your-org-id'
ORDER BY date DESC
LIMIT 7;

-- Check cumulative costs
SELECT
  SUM(llm_cost_usd) as total_llm_cost,
  SUM(llm_tokens_used) as total_tokens,
  SUM(rca_jobs_completed) as total_rcas,
  ROUND(SUM(llm_cost_usd) / NULLIF(SUM(rca_jobs_completed), 0), 4) as cost_per_rca
FROM cost_metrics
WHERE org_id = 'your-org-id';
```

---

### Scenario 7: Rate Limiting

**Goal:** Verify rate limits protect the system.

**Test Method:**

```bash
# Send rapid requests to trigger rate limit
for i in {1..150}; do
  curl -X POST https://YOUR-NGROK-URL/api/v1/webhooks/sentry/your-org-id \
    -H "Content-Type: application/json" \
    -H "sentry-hook-signature: dummy" \
    -d '{"event_id":"test-'$i'"}' &
done
wait
```

**Expected Response (after limit):**

```json
{
  "error": "Rate Limit Exceeded",
  "message": "Too many requests. Try again later.",
  "resource": "events",
  "limit": 100,
  "retryAfter": 3600
}
```

**Database Verification:**

```sql
-- Check rate limit was applied
SELECT date, events_today, rca_jobs_today
FROM cost_metrics
WHERE org_id = 'your-org-id'
ORDER BY date DESC
LIMIT 1;
```

---

## Verification Checklist

### ✅ Webhook Reception

- [ ] Sentry webhooks received with valid HMAC signature
- [ ] GitHub webhooks received with valid signature
- [ ] Invalid signatures rejected (401)
- [ ] Invalid org_id rejected (404)

### ✅ Data Storage

- [ ] Events stored with correct `org_id`
- [ ] Raw payload preserved in JSONB
- [ ] Stack traces extracted correctly
- [ ] Duplicate events detected and skipped

### ✅ GitHub Integration

- [ ] Organization created on App installation
- [ ] Repositories synced correctly
- [ ] Code fetched with installation token
- [ ] Source maps handled (if applicable)

### ✅ RCA Processing

- [ ] Jobs created with correct priority
- [ ] Extraction pipeline runs all 3 stages
- [ ] Code context assembled correctly
- [ ] LLM called only when needed (if API key present)

### ✅ Cost Controls

- [ ] Token usage tracked per job
- [ ] Daily costs aggregated
- [ ] Rate limits enforced per org
- [ ] Plan limits respected (free vs pro)

### ✅ Security

- [ ] No secrets in logs
- [ ] HMAC signatures verified
- [ ] SQL injection prevented (parameterized queries)
- [ ] Path traversal blocked

---

## Troubleshooting

### Webhook Not Received

1. Check ngrok is running and URL is correct
2. Verify webhook configuration in Sentry/GitHub
3. Check ngrok inspector: `http://localhost:4040`

### HMAC Signature Invalid

1. Verify `SENTRY_WEBHOOK_SECRET` matches Sentry configuration
2. Check raw body is preserved (not parsed before HMAC)
3. Look for encoding issues in the secret

### GitHub API Rate Limited

1. Check Redis cache is working
2. Verify installation token refresh
3. Check `cost_metrics.github_api_calls`

### RCA Job Stuck

```sql
-- Find stuck jobs
SELECT id, status, attempts, created_at, started_at, error_message
FROM rca_jobs
WHERE status IN ('queued', 'processing')
AND created_at < NOW() - INTERVAL '5 minutes';

-- Reset stuck job
UPDATE rca_jobs
SET status = 'queued', started_at = NULL, attempts = 0
WHERE id = 'stuck-job-id';
```

### LLM Errors

1. Check `OPENAI_API_KEY` is set and valid
2. Look for error in `rca_jobs.error_message`
3. Check Python logs for detailed error

---

## Useful SQL Queries

### System Health Overview

```sql
SELECT
  (SELECT COUNT(*) FROM organizations) as orgs,
  (SELECT COUNT(*) FROM events WHERE created_at > NOW() - INTERVAL '24 hours') as events_24h,
  (SELECT COUNT(*) FROM rca_jobs WHERE status = 'queued') as jobs_queued,
  (SELECT COUNT(*) FROM rca_jobs WHERE status = 'processing') as jobs_processing,
  (SELECT COUNT(*) FROM rca_jobs WHERE status = 'completed' AND created_at > NOW() - INTERVAL '24 hours') as completed_24h,
  (SELECT COUNT(*) FROM rca_jobs WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours') as failed_24h;
```

### Recent Activity

```sql
SELECT
  e.created_at,
  e.message,
  j.status as job_status,
  r.confidence_score
FROM events e
LEFT JOIN rca_jobs j ON j.event_id = e.id
LEFT JOIN rca_results r ON r.job_id = j.id
ORDER BY e.created_at DESC
LIMIT 20;
```

### Cost Summary

```sql
SELECT
  o.slug,
  o.plan,
  COALESCE(SUM(cm.llm_cost_usd), 0) as total_cost,
  COALESCE(SUM(cm.rca_jobs_completed), 0) as total_rcas
FROM organizations o
LEFT JOIN cost_metrics cm ON cm.org_id = o.id
GROUP BY o.id
ORDER BY total_cost DESC;
```

---

## Next Steps After E2E Testing

1. **Document any issues found** in GitHub issues
2. **Update test fixtures** if payload structure changed
3. **Add integration tests** for new scenarios discovered
4. **Tune rate limits** based on observed patterns
5. **Optimize caching** based on hit rates
