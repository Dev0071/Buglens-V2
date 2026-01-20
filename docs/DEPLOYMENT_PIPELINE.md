# Deployment Pipeline Documentation

## Overview

Buglens uses GitHub Actions for CI/CD with automatic deployments to Heroku staging and production environments.

## Pipeline Triggers

### Staging

- **Trigger:** Every push to `staging` branch
- **Workflow:** `.github/workflows/deploy-staging.yml`
- **Manual:** Can be triggered via GitHub Actions UI
- **Deployments:** Single Heroku app (web + worker dynos), Frontend (Vercel)

### Production

- **Trigger:** Every push to `main` branch (or manual trigger)
- **Workflow:** `.github/workflows/deploy-production.yml`
- **Protection:** Requires passing tests and manual approval
- **Deployments:** Single Heroku app (web + worker dynos), Frontend (Vercel)

## Staging Pipeline

### Flow Diagram

```
Push to staging → Run Tests → Generate Build Info → Deploy Heroku App & Frontend (parallel) → Smoke Tests → Notify
                                                      │
                                                      ├── Web dyno (API)
                                                      ├── Worker dyno (Jobs)
                                                      └── Frontend waits for API
```

### Pipeline Steps

#### 1. **Run Tests** (5-10 minutes)

- Spins up PostgreSQL and Redis
- Installs Node.js and Python dependencies
- Runs database migrations
- Executes test suite
- Checks coverage (optional)

**Abort if:** Tests fail

#### 2. **Generate Build Info** (10 seconds)

- Creates version tag: `staging-YYYYMMDD-HHMMSS`
- Captures short commit SHA (first 7 characters)
- Outputs metadata for deployment tracking

#### 3. **Deploy Heroku App** (3-5 minutes)

- Deploys to Heroku app: `${{ secrets.HEROKU_APP_STAGING }}`
- Heroku automatically runs: `release: npm run migrate:up` (see Procfile)
- Starts both process types:
  - `web: npm start` (API server on port $PORT)
  - `worker: npm run worker` (BullMQ job processor)
- Waits 30 seconds for deployment to stabilize
- Health check with retry logic (5 attempts, 10s intervals)

**Abort if:** Health check fails after 5 retries

#### 4. **Deploy Frontend** (2-3 minutes)

- Deploys to Vercel (waits for Heroku app to be healthy)
- Builds React/Vite app with environment variables:
  - `VITE_API_URL`: Points to staging API
  - `VITE_SENTRY_DSN`: Sentry frontend tracking
- Creates preview deployment
- Assigns staging alias: `staging.buglens.com`
- Health check on deployed URL

**Abort if:** Frontend build fails or health check times out

#### 5. **Smoke Tests** (30 seconds)

Tests run automatically after all deployments complete:

**Test 1: Health Endpoint**

```bash
GET /health
✅ Database connected
✅ Redis connected
```

**Test 2: API Endpoints**

```bash
POST /api/auth/login (should return 400, not 404)
✅ Auth endpoints accessible
```

**Test 3: Sentry Tunnel**

```bash
POST /api/sentry-tunnel (should accept request)
✅ Sentry tunnel working
```

**Test 4: CORS Headers**

```bash
OPTIONS /health
✅ CORS configured
```

**Test 5: Frontend Accessibility**

```bash
GET https://staging.buglens.com
✅ Frontend accessible
```

**Abort if:** Any smoke test fails

#### 6. **Notify** (Always runs)

- Prints deployment summary
- Sends Slack notification (if configured)
- Creates GitHub deployment record
- **On Failure:** Mentions @here in Slack

## Environment Configuration

### Required GitHub Secrets

**Heroku:**

- `HEROKU_API_KEY` - Heroku API key for deployments
- `HEROKU_EMAIL` - Heroku account email
- `HEROKU_APP_STAGING` - Staging app name (e.g., `buglens-staging`)
- `HEROKU_APP_PROD` - Production app name (e.g., `buglens-prod`)

**Vercel:**

- `VERCEL_TOKEN` - Vercel deployment token (from Vercel dashboard)
- `VERCEL_ORG_ID` - Vercel organization/team ID
- `VERCEL_PROJECT_ID` - Vercel project ID
- `VITE_SENTRY_DSN` - Sentry DSN for frontend error tracking

**Notifications:**

- `SLACK_WEBHOOK_URL` - Slack webhook for deployment notifications

### Heroku Configuration

Each Heroku app must have these config vars:

**Required:**

- `DATABASE_URL` - PostgreSQL connection string (auto-provisioned)
- `REDIS_URL` - Redis connection string (auto-provisioned)
- `NODE_ENV` - `staging` or `production`
- `JWT_SECRET` - Secret for JWT token signing
- `SENTRY_DSN` - Sentry error tracking DSN

**Integrations:**

- `GITHUB_CLIENT_ID` - GitHub OAuth app client ID
- `GITHUB_CLIENT_SECRET` - GitHub OAuth app secret
- `SLACK_CLIENT_ID` - Slack OAuth app client ID
- `SLACK_CLIENT_SECRET` - Slack OAuth app secret

**Optional:**

- `SENTRY_WEBHOOK_SECRET` - HMAC secret for Sentry webhooks
- `GITHUB_WEBHOOK_SECRET` - HMAC secret for GitHub webhooks

## Deployment Architecture

### Backend (Heroku)

```
Staging Environment:
└── buglens-staging
    ├── web dyno (Fastify API)
    └── worker dyno (BullMQ job processor)

Production Environment:
└── buglens-prod
    ├── web dyno (Fastify API + autoscaling)
    └── worker dyno (BullMQ job processor + autoscaling)
```

**Benefits:**

- Single codebase deployment
- Shared environment variables (DATABASE_URL, REDIS_URL auto-shared)
- 50% cost savings vs separate apps
- Simplified configuration and monitoring

### Frontend (Vercel)

```
Staging:
├── Preview URL: https://buglens-[hash].vercel.app
└── Alias: https://staging.buglens.com

Production:
├── Production URL: https://buglens.vercel.app
└── Custom Domain: https://app.buglens.com
```

### Procfile Processes

**API (web):**

```
release: npm run migrate:up  # Runs before deployment
web: npm start               # Starts Fastify server
```

**Worker:**

```
worker: npm run worker       # Starts BullMQ worker
```

## Deployment Workflow (Developer)

### Standard Flow

```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Make changes and commit
git add .
git commit -m "feat: add new feature"

# 3. Push to GitHub (opens PR)
git push origin feature/my-feature

# 4. After PR review, merge to staging
git checkout staging
git merge feature/my-feature
git push origin staging
# → Triggers automatic staging deployment

# 5. Test in staging
# Visit: https://staging.buglens.com (frontend)
# API: https://buglens-staging-api.herokuapp.com

# 6. If staging looks good, merge to main
git checkout main
git merge staging
git push origin main
# → Triggers production deployment (with approval)
```

### Hotfix Flow

```bash
# 1. Create hotfix from main
git checkout main
git pull
git checkout -b hotfix/critical-bug

# 2. Fix and commit
git add .
git commit -m "fix: critical security patch"

# 3. Deploy to staging first
git checkout staging
git cherry-pick hotfix/critical-bug
git push origin staging
# → Auto-deploys to staging

# 4. Test, then deploy to production
git checkout main
git merge hotfix/critical-bug
git push origin main
# → Triggers production deployment
```

## Monitoring Deployments

### GitHub Actions UI

1. Navigate to **Actions** tab in GitHub
2. Select **Deploy Staging** workflow
3. View real-time logs for each step
4. Check smoke test results

### Heroku Dashboard

1. Visit https://dashboard.heroku.com
2. Select app (e.g., `buglens-staging-api`)
3. Check **Activity** tab for deployment history
4. View **Metrics** for dyno health
5. Check **Logs** for runtime errors

### Slack Notifications

Deployments post to `#deployments` channel:

**Success:**

```
🚀 Staging Deployment success
Version: staging-20260119-203045
Commit: abc1234
URL: https://buglens-staging-api.herokuapp.com
```

**Failure:**

```
@here ❌ Staging Deployment failure
Version: staging-20260119-203045
Commit: abc1234
Check: https://github.com/buglens/buglens/actions
```

## Rollback Procedures

### Automatic Rollback (Heroku)

Heroku keeps the last 15 releases. To rollback:

```bash
# List recent releases
heroku releases --app buglens-staging-api

# Rollback to previous version
heroku rollback v123 --app buglens-staging-api

# Verify
heroku ps --app buglens-staging-api
```

### Manual Rollback (GitHub)

```bash
# Find the last good commit
git log --oneline

# Revert to that commit
git revert <bad-commit-sha>
git push origin staging
# → Triggers new deployment with reverted code
```

### Emergency Production Rollback

```bash
# 1. Rollback Heroku immediately
heroku rollback --app buglens-api

# 2. Revert Git commit
git revert <bad-commit>
git push origin main

# 3. Notify team
# Post in Slack: "Production rolled back to v122 due to [issue]"
```

## Troubleshooting

### Deployment Fails at Health Check

**Symptom:** API deploys but health check returns 500 or times out

**Check:**

```bash
# View Heroku logs
heroku logs --tail --app buglens-staging-api

# Common issues:
# - Database migration failed
# - Missing environment variable
# - Redis connection error
```

**Fix:**

```bash
# Run migrations manually
heroku run npm run migrate:up --app buglens-staging-api

# Check config vars
heroku config --app buglens-staging-api

# Restart dynos
heroku restart --app buglens-staging-api
```

### Smoke Tests Fail

**Symptom:** Deployment succeeds but smoke tests fail

**Check:**

```bash
# Test endpoints manually
curl https://buglens-staging-api.herokuapp.com/health
curl -X POST https://buglens-staging-api.herokuapp.com/api/auth/login

# Check CORS
curl -I -X OPTIONS https://buglens-staging-api.herokuapp.com/health
```

**Fix:**

- Update smoke test expectations
- Fix API endpoint issues
- Re-deploy

### Worker Not Processing Jobs

**Symptom:** Jobs queue up but aren't processed

**Check:**

```bash
# View worker logs
heroku logs --tail --app buglens-staging-worker

# Scale worker dynos
heroku ps:scale worker=1 --app buglens-staging-worker

# Check BullMQ dashboard (if configured)
```

**Fix:**

```bash
# Restart worker
heroku restart --app buglens-staging-worker

# Check Redis connection
heroku config:get REDIS_URL --app buglens-staging-worker
```

### Sentry Tunnel Returns 415

**Symptom:** Frontend Sentry events fail with "Unsupported Media Type"

**Fix:** Already fixed in `src/api/app.ts`:

```typescript
server.addContentTypeParser(
  "application/x-sentry-envelope",
  { parseAs: "string" },
  (request, body, done) => done(null, body)
);
```

Re-deploy if this was recently added.

## Performance Benchmarks

### Expected Deployment Times

| Step          | Staging   | Production |
| ------------- | --------- | ---------- |
| Tests         | 5-8 min   | 5-8 min    |
| API Deploy    | 3-5 min   | 3-5 min    |
| Worker Deploy | 3-5 min   | 3-5 min    |
| Smoke Tests   | 30 sec    | 1 min      |
| **Total**     | 12-18 min | 15-20 min  |

### Success Metrics

- **Build Success Rate:** >95%
- **Health Check Success:** >99%
- **Smoke Test Pass Rate:** >98%
- **Rollback Frequency:** <1% of deployments

## Best Practices

### ✅ Do

- Always deploy to staging first
- Wait for smoke tests to pass before merging to main
- Test Sentry integration after deployment
- Monitor logs for 15 minutes after deploy
- Use semantic commit messages (`feat:`, `fix:`, `docs:`)

### ❌ Don't

- Skip staging deployments for "small" changes
- Deploy to production on Fridays (unless emergency)
- Ignore failing smoke tests
- Deploy without testing locally first
- Commit directly to `main` branch

## Cost Optimization

### Heroku Dyno Usage

**Staging:**

- API: 1x Standard-1X dyno ($25/month)
- Worker: 1x Standard-1X dyno ($25/month)
- **Total:** $50/month

**Production:**

- API: 2x Standard-2X dynos ($50/month each) = $100/month
- Worker: 2x Standard-2X dynos ($50/month each) = $100/month
- **Total:** $200/month + autoscaling

### CI/CD Minutes

- Tests: ~8 minutes per deployment
- GitHub Actions Free Tier: 2,000 minutes/month
- Average deployments: 50/month
- **Usage:** 400 minutes/month (well under limit)

## Changelog

- **2026-01-19:** Added Sentry tunnel smoke test
- **2026-01-19:** Enhanced health check with retry logic
- **2026-01-19:** Added build versioning
- **2026-01-19:** Improved Slack notifications
- **2026-01-15:** Initial staging pipeline setup

## Support

- **Documentation Issues:** Create GitHub issue with `docs` label
- **Pipeline Failures:** Check Slack `#deployments` or GitHub Actions logs
- **Emergency Escalation:** Page on-call engineer via PagerDuty
