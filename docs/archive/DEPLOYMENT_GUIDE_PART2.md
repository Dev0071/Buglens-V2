# Buglens Deployment Guide - Part 2: CI/CD, Monitoring & Production

**Created:** January 5, 2026
**Prerequisite:** Complete [Part 1: Infrastructure & Setup](DEPLOYMENT_GUIDE_PART1.md)

---

## Table of Contents

8. [CI/CD with GitHub Actions](#8-cicd-with-github-actions)
9. [Sentry Error Tracking](#9-sentry-error-tracking)
10. [Datadog Infrastructure Monitoring](#10-datadog-infrastructure-monitoring)
11. [Frontend Deployment (Vercel)](#11-frontend-deployment-vercel)
12. [Production Deployment Checklist](#12-production-deployment-checklist)
13. [Security Hardening](#13-security-hardening)
14. [Disaster Recovery](#14-disaster-recovery)
15. [Runbook & Operations](#15-runbook--operations)

---

## 8. CI/CD with GitHub Actions

### Step 8.1: Create Branch Strategy

```
main (production)
  └── staging (staging environment)
        └── feature/* (development)
```

### Step 8.2: CI Pipeline (Test & Build)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main, staging]

env:
  NODE_VERSION: "20"
  PYTHON_VERSION: "3.11"

jobs:
  # ============================================
  # Lint & Type Check
  # ============================================
  lint:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run ESLint
        run: npm run lint

      - name: Run TypeScript check
        run: npm run typecheck

  # ============================================
  # Backend Tests
  # ============================================
  test-backend:
    name: Backend Tests
    runs-on: ubuntu-latest
    needs: lint

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: buglens_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: "npm"

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
          cache: "pip"

      - name: Install Node dependencies
        run: npm ci

      - name: Install Python dependencies
        run: pip install -r python/requirements.txt

      - name: Run migrations
        run: npm run migrate
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/buglens_test

      - name: Run backend tests
        run: npm run test:coverage
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/buglens_test
          REDIS_URL: redis://localhost:6379
          NODE_ENV: test

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: ./coverage/lcov.info
          fail_ci_if_error: false

  # ============================================
  # Frontend Tests
  # ============================================
  test-frontend:
    name: Frontend Tests
    runs-on: ubuntu-latest
    needs: lint

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: "npm"

      - name: Install dependencies
        working-directory: ./web
        run: npm ci

      - name: Run frontend tests
        working-directory: ./web
        run: npm run test

      - name: Build frontend
        working-directory: ./web
        run: npm run build

  # ============================================
  # Python Analyzer Tests
  # ============================================
  test-python:
    name: Python Analyzer Tests
    runs-on: ubuntu-latest
    needs: lint

    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
          cache: "pip"

      - name: Install dependencies
        run: |
          pip install -r python/requirements.txt
          pip install -r python/requirements-dev.txt

      - name: Run pytest
        run: pytest python/tests -v --cov=python --cov-report=xml

      - name: Upload Python coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage.xml
          flags: python

  # ============================================
  # Security Scan
  # ============================================
  security:
    name: Security Scan
    runs-on: ubuntu-latest
    needs: lint

    steps:
      - uses: actions/checkout@v4

      - name: Run npm audit
        run: npm audit --audit-level=high
        continue-on-error: true

      - name: Run Snyk to check for vulnerabilities
        uses: snyk/actions/node@master
        continue-on-error: true
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

  # ============================================
  # Build Docker Image
  # ============================================
  build:
    name: Build Docker Image
    runs-on: ubuntu-latest
    needs: [test-backend, test-frontend, test-python]
    if: github.event_name == 'push'

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=ref,event=branch
            type=sha,prefix=

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### Step 8.3: CD Pipeline (Deploy to Staging)

```yaml
# .github/workflows/deploy-staging.yml
name: Deploy to Staging

on:
  push:
    branches: [staging]

jobs:
  deploy:
    name: Deploy to DigitalOcean
    runs-on: ubuntu-latest
    environment: staging

    steps:
      - uses: actions/checkout@v4

      - name: Install doctl
        uses: digitalocean/action-doctl@v2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}

      - name: Deploy to App Platform
        run: |
          doctl apps create-deployment ${{ secrets.DO_APP_ID_STAGING }}

      - name: Wait for deployment
        run: |
          # Poll deployment status
          for i in {1..30}; do
            STATUS=$(doctl apps list-deployments ${{ secrets.DO_APP_ID_STAGING }} --format Status --no-header | head -1)
            echo "Deployment status: $STATUS"
            if [ "$STATUS" == "ACTIVE" ]; then
              echo "✅ Deployment successful!"
              exit 0
            elif [ "$STATUS" == "ERROR" ]; then
              echo "❌ Deployment failed!"
              exit 1
            fi
            sleep 30
          done
          echo "⏰ Deployment timed out"
          exit 1

      - name: Run smoke tests
        run: |
          sleep 10
          curl -f https://staging-api.buglens.dev/health || exit 1
          echo "✅ Health check passed"

      - name: Notify Slack
        if: always()
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          channel: "#deployments"
          fields: repo,commit,author,action,workflow
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### Step 8.4: Production Deployment (Manual Approval)

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  # Run all tests first
  test:
    uses: ./.github/workflows/ci.yml

  # Require manual approval
  approve:
    name: Approve Production Deploy
    runs-on: ubuntu-latest
    needs: test
    environment: production # Requires approval in GitHub settings

    steps:
      - name: Approved
        run: echo "Production deployment approved"

  deploy:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: approve
    environment: production

    steps:
      - uses: actions/checkout@v4

      - name: Install doctl
        uses: digitalocean/action-doctl@v2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}

      - name: Create deployment
        run: |
          doctl apps create-deployment ${{ secrets.DO_APP_ID_PRODUCTION }}

      - name: Run E2E tests
        run: |
          npm run test:e2e
        env:
          E2E_BASE_URL: https://api.buglens.dev

      - name: Create Sentry release
        uses: getsentry/action-release@v1
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: buglens
          SENTRY_PROJECT: buglens-api
        with:
          environment: production
          version: ${{ github.sha }}
```

---

## 9. Sentry Error Tracking

### Step 9.1: Activate Sentry Student Pack

1. **Go to Sentry GitHub Students page:**

   ```
   https://sentry.io/for/github-students/
   ```

2. **Connect GitHub account** to verify student status

3. **Free tier includes:**
   - 50,000 errors/month
   - 100,000 transactions/month
   - 1GB attachments
   - 500 session replays
   - Team features

### Step 9.2: Create Sentry Projects

```
Organization: buglens
├── Project: buglens-api (Node.js)
├── Project: buglens-web (React)
└── Project: buglens-worker (Node.js)
```

### Step 9.3: Backend Sentry Integration

Already implemented! Just add DSN to environment:

```typescript
// src/utils/sentry.ts (already exists)
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.COMMIT_SHA,

  // Performance monitoring
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Filter sensitive data
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["x-api-key"];
    }
    return event;
  },

  // Ignore specific errors
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "Network request failed",
  ],
});
```

### Step 9.4: Frontend Sentry Integration

```typescript
// web/src/utils/sentry.ts
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_ENVIRONMENT,

  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],

  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

### Step 9.5: Sentry Alerts Configuration

Create these alerts in Sentry dashboard:

```yaml
# Alert 1: High Error Rate
trigger: error_count > 100 in 5 minutes
action: Slack #alerts + PagerDuty

# Alert 2: New Error Type
trigger: first_seen_issue
action: Slack #errors

# Alert 3: Regression
trigger: regression (previously resolved issue reoccurs)
action: Slack #alerts + Email

# Alert 4: Performance Degradation
trigger: transaction_duration p95 > 5000ms
action: Slack #performance
```

---

## 10. Datadog Infrastructure Monitoring

### Step 10.1: Activate Datadog Student Pack

1. **Go to Datadog GitHub Students:**

   ```
   https://www.datadoghq.com/partner/github-students/
   ```

2. **Free tier includes:**
   - Pro Account
   - 10 servers monitoring
   - 2 years free
   - ~$600/year value

### Step 10.2: Install Datadog Agent

**For DigitalOcean App Platform:**

Add to your Dockerfile:

```dockerfile
# Add Datadog agent
RUN DD_API_KEY=$DD_API_KEY DD_SITE="datadoghq.com" \
    bash -c "$(curl -L https://s3.amazonaws.com/dd-agent/scripts/install_script_agent7.sh)"
```

**Or use APM only (recommended for App Platform):**

```typescript
// src/index.ts - Add at the very top (before other imports)
import tracer from "dd-trace";

tracer.init({
  env: process.env.NODE_ENV,
  service: "buglens-api",
  version: process.env.COMMIT_SHA,
  logInjection: true,
  runtimeMetrics: true,
  profiling: true,
});
```

### Step 10.3: Install dd-trace Package

```bash
npm install dd-trace --save
```

### Step 10.4: Custom Metrics

```typescript
// src/utils/metrics.ts
import tracer from "dd-trace";

const metrics = tracer.dogstatsd;

// Track RCA processing time
export function trackRCAProcessingTime(durationMs: number, orgId: string) {
  metrics.timing("rca.processing_time", durationMs, {
    org_id: orgId,
    environment: process.env.NODE_ENV,
  });
}

// Track cache hit rate
export function trackCacheHit(tier: "redis" | "s3" | "database" | "miss") {
  metrics.increment("cache.hit", 1, {
    tier,
    environment: process.env.NODE_ENV,
  });
}

// Track LLM costs
export function trackLLMCost(tokens: number, costUsd: number, orgId: string) {
  metrics.gauge("llm.tokens_used", tokens, { org_id: orgId });
  metrics.gauge("llm.cost_usd", costUsd, { org_id: orgId });
}

// Track GitHub API rate limit
export function trackGitHubRateLimit(remaining: number, limit: number) {
  metrics.gauge("github.rate_limit.remaining", remaining);
  metrics.gauge("github.rate_limit.total", limit);
}
```

### Step 10.5: Datadog Dashboard

Create a dashboard with these widgets:

```yaml
Dashboard: Buglens Overview
Widgets:
  - Title: "API Request Rate"
    Type: Timeseries
    Query: sum:trace.fastify.request.hits{service:buglens-api}.as_rate()

  - Title: "API Latency (p95)"
    Type: Timeseries
    Query: p95:trace.fastify.request.duration{service:buglens-api}

  - Title: "Error Rate"
    Type: Timeseries
    Query: sum:trace.fastify.request.errors{service:buglens-api}.as_rate()

  - Title: "RCA Processing Time"
    Type: Timeseries
    Query: avg:rca.processing_time{*}

  - Title: "Cache Hit Rate"
    Type: Query Value
    Query: (sum:cache.hit{tier:redis} + sum:cache.hit{tier:s3}) / sum:cache.hit{*} * 100

  - Title: "LLM Cost (24h)"
    Type: Query Value
    Query: sum:llm.cost_usd{*}.rollup(sum, 86400)

  - Title: "Active Jobs"
    Type: Query Value
    Query: avg:bullmq.queue.active{*}

  - Title: "GitHub Rate Limit"
    Type: Timeseries
    Query: avg:github.rate_limit.remaining{*}
```

### Step 10.6: Datadog Alerts

```yaml
# Alert 1: High Error Rate
name: "[Buglens] High API Error Rate"
query: sum(last_5m):sum:trace.fastify.request.errors{service:buglens-api}.as_count() > 50
message: |
  High error rate detected on Buglens API.
  Errors in last 5 minutes: {{value}}
  @slack-buglens-alerts @pagerduty-buglens

# Alert 2: Slow RCA Processing
name: "[Buglens] Slow RCA Processing"
query: avg(last_15m):avg:rca.processing_time{*} > 60000
message: |
  RCA processing taking longer than 60 seconds.
  Current avg: {{value}}ms
  @slack-buglens-alerts

# Alert 3: Low Cache Hit Rate
name: "[Buglens] Low Cache Hit Rate"
query: avg(last_1h):sum:cache.hit{tier:redis OR tier:s3}.as_count() / sum:cache.hit{*}.as_count() * 100 < 70
message: |
  Cache hit rate dropped below 70%.
  Current rate: {{value}}%
  @slack-buglens-alerts

# Alert 4: GitHub Rate Limit Low
name: "[Buglens] GitHub Rate Limit Critical"
query: min(last_5m):avg:github.rate_limit.remaining{*} < 500
message: |
  GitHub API rate limit running low!
  Remaining: {{value}} requests
  @slack-buglens-alerts @pagerduty-buglens
```

---

## 11. Frontend Deployment (Vercel)

### Step 11.1: Why Vercel for Frontend

- **Free tier:** Generous for hobby/student projects
- **GitHub integration:** Automatic deployments on push
- **Preview deployments:** Every PR gets a unique URL
- **Edge network:** Global CDN included
- **Zero config:** Works with Vite out of the box

### Step 11.2: Connect Repository

1. Go to [vercel.com](https://vercel.com) and sign up with GitHub
2. Import repository: `your-username/buglens`
3. Configure:
   - Root Directory: `web`
   - Framework Preset: Vite
   - Build Command: `npm run build`
   - Output Directory: `dist`

### Step 11.3: Environment Variables

```bash
# In Vercel Dashboard → Settings → Environment Variables

# API URL (different per environment)
VITE_API_URL=https://staging-api.buglens.dev  # Staging
VITE_API_URL=https://api.buglens.dev          # Production

# Sentry
VITE_SENTRY_DSN=https://xxxx@sentry.io/xxxx
VITE_ENVIRONMENT=staging

# Feature Flags
VITE_FEATURE_EVIDENCE_GRAPH=false
```

### Step 11.4: Custom Domain

1. Go to Project Settings → Domains
2. Add custom domain: `app.buglens.dev` (or `staging.buglens.dev`)
3. Configure DNS at Name.com:
   ```
   CNAME  app      cname.vercel-dns.com
   CNAME  staging  cname.vercel-dns.com
   ```

### Step 11.5: Preview Deployments

Vercel automatically creates preview URLs for PRs:

- `https://buglens-web-git-feature-xyz.vercel.app`

Configure protection:

```json
// vercel.json
{
  "github": {
    "silent": true
  },
  "headers": [
    {
      "source": "/api/:path*",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" }
      ]
    }
  ]
}
```

---

## 12. Production Deployment Checklist

### Pre-Production Checklist

```markdown
## Infrastructure

- [ ] DigitalOcean App Platform production app created
- [ ] PostgreSQL high-availability cluster (2+ nodes)
- [ ] Redis cluster with replication
- [ ] S3/Spaces bucket with lifecycle policies
- [ ] Domain DNS configured (api.buglens.dev)
- [ ] SSL certificates active and auto-renewing

## Security

- [ ] All secrets stored in Doppler (not in code)
- [ ] Database firewall rules configured
- [ ] API rate limiting enabled
- [ ] CORS configured for production domains only
- [ ] Webhook signatures validated
- [ ] Input validation on all endpoints
- [ ] SQL injection protection verified

## Monitoring

- [ ] Sentry error tracking configured
- [ ] Datadog APM installed and reporting
- [ ] Datadog alerts configured
- [ ] Uptime monitoring enabled
- [ ] Log aggregation working

## Performance

- [ ] Database indexes created for common queries
- [ ] Redis connection pooling configured
- [ ] Cache TTLs appropriate for production
- [ ] API response times < 500ms P95

## CI/CD

- [ ] GitHub Actions workflows passing
- [ ] Production deployment requires approval
- [ ] Rollback procedure documented
- [ ] Database migration strategy tested

## Documentation

- [ ] API documentation up to date
- [ ] Runbook created for common issues
- [ ] On-call rotation established
- [ ] Incident response plan documented
```

### Post-Deployment Verification

```bash
#!/bin/bash
# scripts/verify-production.sh

API_URL="https://api.buglens.dev"

echo "🔍 Verifying production deployment..."

# Health check
echo "Checking health endpoint..."
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" $API_URL/health)
if [ "$HEALTH" != "200" ]; then
  echo "❌ Health check failed: $HEALTH"
  exit 1
fi
echo "✅ Health check passed"

# Database connectivity
echo "Checking database..."
DB_CHECK=$(curl -s $API_URL/health | jq -r '.database')
if [ "$DB_CHECK" != "healthy" ]; then
  echo "❌ Database check failed"
  exit 1
fi
echo "✅ Database healthy"

# Redis connectivity
echo "Checking Redis..."
REDIS_CHECK=$(curl -s $API_URL/health | jq -r '.redis')
if [ "$REDIS_CHECK" != "healthy" ]; then
  echo "❌ Redis check failed"
  exit 1
fi
echo "✅ Redis healthy"

# API response time
echo "Checking API latency..."
LATENCY=$(curl -s -o /dev/null -w "%{time_total}" $API_URL/health)
LATENCY_MS=$(echo "$LATENCY * 1000" | bc)
echo "API latency: ${LATENCY_MS}ms"
if (( $(echo "$LATENCY > 1" | bc -l) )); then
  echo "⚠️ Warning: High latency"
fi

echo ""
echo "🎉 Production verification complete!"
```

---

## 13. Security Hardening

### 13.1: Secrets Management with 1Password

1. **Claim 1Password Student Pack:**

   ```
   https://1password.com/students
   ```

2. **Create Vault Structure:**

   ```
   Vault: Buglens Engineering
   ├── Staging
   │   ├── Database credentials
   │   ├── API keys
   │   └── Service accounts
   └── Production
       ├── Database credentials
       ├── API keys
       └── Service accounts
   ```

3. **Integrate with CI/CD:**
   ```yaml
   # .github/workflows/deploy.yml
   - name: Load secrets from 1Password
     uses: 1password/load-secrets-action@v1
     with:
       export-env: true
     env:
       OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
       DATABASE_URL: op://Buglens/Production/DATABASE_URL
   ```

### 13.2: Security Headers

```typescript
// src/api/plugins/security.ts
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";

export async function registerSecurityPlugins(app: FastifyInstance) {
  // Helmet for security headers
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.buglens.dev"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // CORS
  await app.register(cors, {
    origin: [
      "https://app.buglens.dev",
      "https://staging.buglens.dev",
      process.env.NODE_ENV === "development" && "http://localhost:5173",
    ].filter(Boolean),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });
}
```

### 13.3: AstraSecurity Web Firewall

1. **Claim AstraSecurity Student Pack:**

   ```
   https://www.getastra.com/github-students
   ```

2. **Configure firewall rules:**
   - Block SQL injection attempts
   - Block XSS attempts
   - Rate limit suspicious IPs
   - Geographic blocking (if needed)

### 13.4: Dependency Scanning

```yaml
# .github/workflows/security.yml
name: Security Scan

on:
  schedule:
    - cron: "0 0 * * *" # Daily
  push:
    branches: [main, staging]

jobs:
  dependency-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run npm audit
        run: npm audit --audit-level=high

      - name: Run Snyk
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

      - name: Run CodeQL
        uses: github/codeql-action/analyze@v3
```

---

## 14. Disaster Recovery

### 14.1: Backup Strategy

| Data            | Backup Method            | Frequency | Retention |
| --------------- | ------------------------ | --------- | --------- |
| PostgreSQL      | DO Managed Backups       | Daily     | 7 days    |
| PostgreSQL      | Manual pg_dump to Spaces | Weekly    | 30 days   |
| Redis           | RDB snapshots            | Hourly    | 24 hours  |
| Code Cache (S3) | Cross-region replication | Real-time | 7 days    |
| Config/Secrets  | Doppler versioning       | On change | Forever   |

### 14.2: Database Backup Script

```bash
#!/bin/bash
# scripts/backup-database.sh

set -e

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="buglens_backup_${DATE}.sql.gz"
S3_BUCKET="buglens-backups"

echo "Starting backup at $(date)"

# Dump database
pg_dump $DATABASE_URL | gzip > /tmp/$BACKUP_FILE

# Upload to S3/Spaces
aws s3 cp /tmp/$BACKUP_FILE s3://$S3_BUCKET/postgres/$BACKUP_FILE \
  --endpoint-url https://nyc3.digitaloceanspaces.com

# Clean up local file
rm /tmp/$BACKUP_FILE

# Delete backups older than 30 days
aws s3 ls s3://$S3_BUCKET/postgres/ --endpoint-url https://nyc3.digitaloceanspaces.com | \
  awk '{print $4}' | \
  while read file; do
    file_date=$(echo $file | grep -oP '\d{8}')
    if [[ $(date -d "$file_date" +%s) -lt $(date -d "30 days ago" +%s) ]]; then
      aws s3 rm s3://$S3_BUCKET/postgres/$file \
        --endpoint-url https://nyc3.digitaloceanspaces.com
    fi
  done

echo "Backup completed: $BACKUP_FILE"
```

### 14.3: Recovery Procedures

````markdown
## Database Recovery

### From DigitalOcean Managed Backup

1. Go to DigitalOcean → Databases → buglens-db-prod
2. Click "Restore" → Select backup point
3. Wait for restore (typically 5-15 minutes)
4. Update connection string if needed

### From Manual Backup

1. Download backup from Spaces:
   ```bash
   aws s3 cp s3://buglens-backups/postgres/buglens_backup_YYYYMMDD.sql.gz . \
     --endpoint-url https://nyc3.digitaloceanspaces.com
   ```
````

2. Restore:
   ```bash
   gunzip -c buglens_backup_*.sql.gz | psql $DATABASE_URL
   ```

## Full Recovery (Nuclear Option)

1. Create new DigitalOcean project
2. Run `terraform apply` for infrastructure
3. Restore database from backup
4. Update DNS to point to new infrastructure
5. Verify all services healthy

````

### 14.4: RTO/RPO Targets

| Metric | Target | Current |
|--------|--------|---------|
| RTO (Recovery Time Objective) | < 1 hour | ~30 min |
| RPO (Recovery Point Objective) | < 1 hour | ~1 hour |

---

## 15. Runbook & Operations

### 15.1: Common Issues & Fixes

```markdown
## Issue: High API Latency

### Symptoms
- Datadog alert: API p95 > 500ms
- Users reporting slow responses

### Investigation
1. Check Datadog APM for slow traces
2. Check database query performance
3. Check Redis connectivity
4. Check GitHub API rate limits

### Resolution
1. If database slow:
   - Check for missing indexes
   - Run VACUUM ANALYZE
   - Consider read replicas
2. If cache miss rate high:
   - Check Redis memory usage
   - Clear stale cache entries
3. If GitHub rate limited:
   - Wait for reset
   - Check for cache bypass bugs

---

## Issue: BullMQ Jobs Stuck

### Symptoms
- Jobs in "waiting" state for > 5 minutes
- RCA results not appearing

### Investigation
1. Check Redis connectivity
2. Check worker logs
3. Check job error states

### Resolution
1. Restart workers:
   ```bash
   doctl apps create-deployment $DO_APP_ID --wait
````

2. If jobs corrupted, clear queue:
   ```bash
   redis-cli -u $REDIS_URL KEYS "bull:*" | xargs redis-cli -u $REDIS_URL DEL
   ```

---

## Issue: Database Connection Exhausted

### Symptoms

- "too many connections" errors
- API returning 500 errors

### Investigation

1. Check connection pool stats
2. Check for connection leaks
3. Check PgBouncer status

### Resolution

1. Kill idle connections:
   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE state = 'idle'
   AND query_start < now() - interval '10 minutes';
   ```
2. Increase pool size (temporary)
3. Deploy fix for connection leak

````

### 15.2: On-Call Checklist

```markdown
## Daily Checks (5 minutes)
- [ ] Datadog dashboard green
- [ ] Sentry error rate normal
- [ ] No alerts in Slack
- [ ] Job queue length < 100

## Weekly Checks (30 minutes)
- [ ] Review error trends in Sentry
- [ ] Check database storage usage
- [ ] Review GitHub rate limit usage
- [ ] Check LLM cost metrics
- [ ] Run npm audit

## Monthly Tasks
- [ ] Review and update runbook
- [ ] Test disaster recovery procedure
- [ ] Rotate API keys
- [ ] Review access permissions
- [ ] Update dependencies
````

### 15.3: Useful Commands

```bash
# Check application logs
doctl apps logs $DO_APP_ID --type=run

# SSH into worker (if using Droplets)
ssh root@$WORKER_IP

# Check database connections
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# Check Redis memory
redis-cli -u $REDIS_URL INFO memory

# Check queue status
redis-cli -u $REDIS_URL LLEN bull:rca-queue:waiting

# Force process stuck job
curl -X POST https://api.buglens.dev/admin/jobs/retry-failed \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Quick Start Summary

### To Deploy Staging (First Time):

```bash
# 1. Claim free credits
# - DigitalOcean: $200
# - Name.com: Free .dev domain
# - Sentry: 50K errors
# - Datadog: 2 years free

# 2. Create infrastructure
doctl apps create --spec .do/app.yaml

# 3. Configure secrets
doppler setup --project buglens --config staging
doppler secrets set DATABASE_URL="..."

# 4. Deploy
git push origin staging

# 5. Verify
curl https://staging-api.buglens.dev/health
```

### Total Free Credits Value: ~$5,000/year

| Service            | Value  |
| ------------------ | ------ |
| DigitalOcean       | $200   |
| Datadog            | $600   |
| Sentry             | $300   |
| New Relic (backup) | $3,600 |
| Domain             | $15    |
| SSL                | $10    |
| Other tools        | $275   |

**You can run Buglens for FREE for 3+ months, then ~$60/month for staging!**

---

**Document Version:** 1.0
**Last Updated:** January 5, 2026
**Author:** Buglens Engineering
