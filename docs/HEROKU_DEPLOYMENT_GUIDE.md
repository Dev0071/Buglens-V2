# Buglens Heroku Deployment Guide

Complete guide for deploying Buglens to Heroku using the web interface (Dashboard) with staging and production environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Initial Setup](#initial-setup)
4. [Staging Deployment](#staging-deployment)
5. [Production Deployment](#production-deployment)
6. [CI/CD with GitHub Actions](#cicd-with-github-actions)
7. [Environment Variables](#environment-variables)
8. [Database Migrations](#database-migrations)
9. [Monitoring & Logging](#monitoring--logging)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Accounts

- **Heroku account** with Student Pack ($13/month credit) or paid plan
  - Sign up at https://signup.heroku.com/
  - Verify your email address
  - Enable two-factor authentication (recommended)
- **GitHub repository** with the Buglens codebase
  - Fork or clone the Buglens repository
  - Ensure you have admin access
- **Sentry account** for error tracking
- **OpenAI API key** for GPT-4o-mini access
- **AWS account** for S3 and CloudWatch (optional, can use Heroku alternatives)

### Optional: Heroku CLI (For Advanced Operations)

The Heroku CLI is **not required** for deployment but can be useful for debugging:

```bash
# Install Heroku CLI (optional)
brew install heroku/brew/heroku

# Login to Heroku
heroku login
```

> **Note**: This guide focuses on the Heroku Dashboard (web interface). CLI commands are provided as optional alternatives in collapsible sections.

---

## Architecture Overview

Buglens runs as two separate Heroku apps:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Heroku Platform                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐          ┌─────────────────┐              │
│  │   buglens-api   │          │  buglens-worker │              │
│  │   (web dyno)    │◄────────►│  (worker dyno)  │              │
│  └────────┬────────┘          └────────┬────────┘              │
│           │                            │                        │
│           └────────────┬───────────────┘                        │
│                        │                                        │
│           ┌────────────▼───────────────┐                        │
│           │      Heroku Postgres       │                        │
│           │   (Shared Redis via URL)   │                        │
│           └────────────────────────────┘                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Components

| Component  | Heroku Service         | Purpose                       |
| ---------- | ---------------------- | ----------------------------- |
| API Server | web dyno               | Fastify API, webhook receiver |
| Worker     | worker dyno            | BullMQ job processor          |
| PostgreSQL | Heroku Postgres        | Main database                 |
| Redis      | Heroku Key-Value Store | Job queue, caching            |
| Logs       | Heroku Logging         | Application logs              |

---

## Initial Setup

### Step 1: Create Heroku Apps via Dashboard

#### Create Staging Apps

1. **Go to Heroku Dashboard**: https://dashboard.heroku.com/apps
2. **Click "New" → "Create new app"**
3. **Create API app**:
   - App name: `buglens-api-staging`
   - Region: `United States` (or `Europe` if closer to your users)
   - Click **"Create app"**
4. **Repeat for Worker app**:
   - App name: `buglens-worker-staging`
   - Region: Same as API app
   - Click **"Create app"**

#### Create Production Apps

5. **Repeat the process for production**:
   - App name: `buglens-api-prod`
   - Region: Same as staging
   - Click **"Create app"**
6. **Create production worker**:
   - App name: `buglens-worker-prod`
   - Region: Same as API app
   - Click **"Create app"**

> **Result**: You should now have 4 apps in your dashboard: `buglens-api-staging`, `buglens-worker-staging`, `buglens-api-prod`, `buglens-worker-prod`

---

### Step 2: Add PostgreSQL Database

#### For Staging API App

1. **Go to** `buglens-api-staging` app page
2. **Click "Resources" tab**
3. **In "Add-ons" search box**, type: `Heroku Postgres`
4. **Select**: `Heroku Postgres`
5. **Choose plan**: `Essential-0` ($5/month - suitable for development)
6. **Click "Submit Order Form"**
7. **Verify**: You should see `Heroku Postgres` listed under "Add-ons"

#### For Production API App

1. **Go to** `buglens-api-prod` app page
2. **Click "Resources" tab**
3. **Add Heroku Postgres**
4. **Choose plan**: `Essential-1` ($15/month - better performance for production)
5. **Click "Submit Order Form"**

> **Note**: The `DATABASE_URL` environment variable is automatically set when you add Postgres.

---

### Step 3: Add Redis (Key-Value Store)

#### For Staging API App

1. **Stay on** `buglens-api-staging` → **Resources** tab
2. **In "Add-ons" search box**, type: `Heroku Data for Redis`
3. **Select**: `Heroku Data for Redis`
4. **Choose plan**: `Mini` ($3/month)
5. **Click "Submit Order Form"**

#### For Production API App

1. **Go to** `buglens-api-prod` → **Resources** tab
2. **Add Heroku Data for Redis**
3. **Choose plan**: `Premium-0` ($15/month - better for production)
4. **Click "Submit Order Form"**

> **Note**: The `REDIS_URL` environment variable is automatically set.

---

### Step 4: Share Add-ons with Worker Apps

Worker apps need access to the same database and Redis as the API apps.

#### Share Staging Add-ons

1. **Go to** `buglens-api-staging` app page
2. **Click "Resources" tab**
3. **Click on "Heroku Postgres"** (this opens the add-on dashboard)
4. **Go to "Settings" tab** in the Postgres add-on
5. **Scroll to "Attached as"** section
6. **Click "Attach to another app"**
7. **Select**: `buglens-worker-staging`
8. **Click "Attach database"**
9. **Go back** to `buglens-api-staging` → Resources
10. **Click on "Heroku Data for Redis"**
11. **Repeat the attach process** for Redis to `buglens-worker-staging`

#### Share Production Add-ons

1. **Repeat the same process** for production:
   - Attach `buglens-api-prod` Postgres to `buglens-worker-prod`
   - Attach `buglens-api-prod` Redis to `buglens-worker-prod`

> **Verification**: Go to `buglens-worker-staging` → Resources. You should see both add-ons listed with a note "(attached as DATABASE)" and "(attached as REDIS)".

---

### Step 5: Connect GitHub Repository

#### For Staging Apps

1. **Go to** `buglens-api-staging` app page
2. **Click "Deploy" tab**
3. **Deployment method**: Click **"GitHub"**
4. **Connect to GitHub**: Click **"Connect to GitHub"** button
5. **Authorize Heroku** if prompted
6. **Search for repository**: Type `buglens` (or your fork name)
7. **Click "Connect"** next to the correct repository
8. **Enable Automatic Deploys** (optional but recommended):
   - Branch: `staging`
   - Click **"Enable Automatic Deploys"**
9. **Repeat** for `buglens-worker-staging`

#### For Production Apps

1. **Go to** `buglens-api-prod` app page
2. **Follow same steps** but use branch: `main`
3. **Important**: For production, consider enabling **"Wait for CI to pass before deploy"** checkbox
4. **Repeat** for `buglens-worker-prod`

<details>
<summary><strong>Alternative: Manual Deployment via Git (CLI Required)</strong></summary>

```bash
# Add Heroku remotes
git remote add staging-api https://git.heroku.com/buglens-api-staging.git
git remote add staging-worker https://git.heroku.com/buglens-worker-staging.git
git remote add prod-api https://git.heroku.com/buglens-api-prod.git
git remote add prod-worker https://git.heroku.com/buglens-worker-prod.git

# Deploy manually
git push staging-api staging:main
git push staging-worker staging:main
```

</details>

---

## Staging Deployment

### Step 1: Configure Environment Variables

#### Navigate to Settings

1. **Go to** `buglens-api-staging` app page
2. **Click "Settings" tab**
3. **Scroll to "Config Vars" section**
4. **Click "Reveal Config Vars"**

> **Note**: `DATABASE_URL` and `REDIS_URL` should already be present from add-ons.

#### Add Required Variables for API App

Click **"Add"** for each variable and enter:

| Key                         | Value                                                    | Notes                                            |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------ |
| `NODE_ENV`                  | `staging`                                                | Environment identifier                           |
| `APP_BASE_URL`              | `https://buglens-api-staging.herokuapp.com`              | Your staging app URL                             |
| `JWT_SECRET`                | Generate: `openssl rand -base64 32`                      | Keep this secret! (32+ characters)               |
| `ENCRYPTION_KEY`            | Generate: `openssl rand -hex 32`                         | 64 character hex string                          |
| `GITHUB_APP_ID`             | `123456`                                                 | From GitHub App settings                         |
| `GITHUB_APP_PRIVATE_KEY`    | `-----BEGIN RSA PRIVATE KEY-----\n...`                   | Copy entire PEM file content                     |
| `GITHUB_APP_WEBHOOK_SECRET` | Your webhook secret                                      | From GitHub App webhook config                   |
| `SENTRY_DSN`                | `https://...@sentry.io/...`                              | From Sentry project settings                     |
| `SENTRY_WEBHOOK_SECRET`     | Generate: `openssl rand -hex 20`                         | For validating Sentry webhooks                   |
| `OPENAI_API_KEY`            | `sk-proj-...`                                            | From OpenAI dashboard                            |
| `LOG_LEVEL`                 | `debug`                                                  | `debug` for staging, `info` for prod             |
| `CORS_ORIGINS`              | `http://localhost:5173,https://staging.buglens.com`      | Comma-separated allowed origins                  |
| `ADMIN_TOKEN`               | Generate: `openssl rand -hex 32`                         | For admin API access (64+ chars)                 |
| `RATE_LIMIT_ENABLED`        | `true`                                                   | Enable rate limiting                             |
| `RATE_LIMIT_MAX_REQUESTS`   | `100`                                                    | Max requests per window                          |
| `RATE_LIMIT_WINDOW_MS`      | `60000`                                                  | Rate limit window (1 minute)                     |
| `WEBHOOK_TIMEOUT_MS`        | `30000`                                                  | Webhook processing timeout                       |
| `MAX_STACK_FRAMES`          | `50`                                                     | Max frames to analyze                            |
| `GITHUB_CACHE_TTL`          | `3600`                                                   | Redis cache TTL (1 hour)                         |
| `S3_CACHE_BUCKET`           | `buglens-cache-staging`                                  | Optional: S3 bucket for file caching             |
| `AWS_ACCESS_KEY_ID`         | Your AWS key (if using S3)                               | Optional: For S3 cache                           |
| `AWS_SECRET_ACCESS_KEY`     | Your AWS secret (if using S3)                            | Optional: For S3 cache                           |
| `AWS_REGION`                | `us-east-1`                                              | Optional: AWS region                             |
| `PYTHON_ANALYZER_TIMEOUT`   | `45000`                                                  | Python analyzer timeout (45s)                    |
| `LLM_TIMEOUT_MS`            | `60000`                                                  | LLM request timeout (60s)                        |
| `LLM_MODEL`                 | `gpt-4o-mini`                                            | OpenAI model to use                              |
| `LLM_TEMPERATURE`           | `0.1`                                                    | Low temperature for consistency                  |
| `LLM_MAX_TOKENS`            | `2000`                                                   | Max tokens per LLM response                      |
| `LLM_DAILY_TOKEN_LIMIT`     | `1000000`                                                | Daily token limit per org                        |
| `ENABLE_PROMETHEUS`         | `false`                                                  | Enable Prometheus metrics (optional)             |
| `ENABLE_HEALTH_CHECKS`      | `true`                                                   | Enable /health endpoint                          |
| `SLACK_ENABLED`             | `true`                                                   | Enable Slack notifications                       |
| `SLACK_DEFAULT_CHANNEL`     | `#buglens-alerts`                                        | Default channel for alerts                       |
| `ENABLE_SOURCE_MAPS`        | `true`                                                   | Enable source map resolution                     |
| `SOURCE_MAP_CACHE_SIZE`     | `100`                                                    | Number of source maps to cache                   |
| `ENABLE_COST_TRACKING`      | `true`                                                   | Track LLM/API costs                              |
| `COST_ALERT_THRESHOLD`      | `10.00`                                                  | USD threshold for cost alerts                    |

> **Security Tips**:
> - Never commit secrets to Git
> - Use different secrets for staging vs production
> - Store secrets in a password manager
> - Rotate secrets regularly (quarterly)

#### Generate Secrets Locally

Open a terminal and run these commands to generate secure random values:

```bash
# JWT Secret (32 bytes base64)
openssl rand -base64 32

# Encryption Key (32 bytes hex = 64 chars)
openssl rand -hex 32

# Webhook Secret (20 bytes hex = 40 chars)
openssl rand -hex 20

# Admin Token (32 bytes hex = 64 chars)
openssl rand -hex 32
```

Copy each output and paste into the corresponding Config Var in the Heroku Dashboard.

#### Configure Worker App Variables

1. **Go to** `buglens-worker-staging` → **Settings** → **Config Vars**
2. **Add these variables**:

| Key                         | Value                                 | Notes                                      |
| --------------------------- | ------------------------------------- | ------------------------------------------ |
| `NODE_ENV`                  | `staging`                             | Same as API                                |
| `WORKER_MODE`               | `true`                                | Enables worker-specific behavior           |
| `GITHUB_APP_ID`             | Same as API                           | Copy from API app                          |
| `GITHUB_APP_PRIVATE_KEY`    | Same as API                           | Copy from API app                          |
| `OPENAI_API_KEY`            | Same as API                           | Copy from API app                          |
| `LOG_LEVEL`                 | `debug`                               | Same as API                                |
| `PYTHON_ANALYZER_TIMEOUT`   | `45000`                               | Same as API                                |
| `LLM_TIMEOUT_MS`            | `60000`                               | Same as API                                |
| `LLM_MODEL`                 | `gpt-4o-mini`                         | Same as API                                |
| `LLM_TEMPERATURE`           | `0.1`                                 | Same as API                                |
| `LLM_MAX_TOKENS`            | `2000`                                | Same as API                                |
| `GITHUB_CACHE_TTL`          | `3600`                                | Same as API                                |
| `S3_CACHE_BUCKET`           | `buglens-cache-staging`               | Same as API (if using S3)                  |
| `AWS_ACCESS_KEY_ID`         | Same as API (if using S3)             | Optional                                   |
| `AWS_SECRET_ACCESS_KEY`     | Same as API (if using S3)             | Optional                                   |
| `AWS_REGION`                | `us-east-1`                           | Same as API (if using S3)                  |
| `ENABLE_COST_TRACKING`      | `true`                                | Same as API                                |
| `MAX_CONCURRENT_JOBS`       | `5`                                   | Worker-specific: Max concurrent RCA jobs   |
| `JOB_TIMEOUT_MS`            | `300000`                              | Worker-specific: Job timeout (5 minutes)   |
| `RETRY_ATTEMPTS`            | `3`                                   | Worker-specific: Failed job retry count    |
| `RETRY_DELAY_MS`            | `5000`                                | Worker-specific: Delay between retries (5s)|

> **Note**: `DATABASE_URL` and `REDIS_URL` are already present from the attached add-ons.

<details>
<summary><strong>Alternative: Set Variables via CLI</strong></summary>

```bash
# Set variables for API
heroku config:set \
  NODE_ENV=staging \
  APP_BASE_URL=https://buglens-api-staging.herokuapp.com \
  JWT_SECRET="$(openssl rand -base64 32)" \
  ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -a buglens-api-staging

# Set variables for Worker
heroku config:set \
  NODE_ENV=staging \
  WORKER_MODE=true \
  -a buglens-worker-staging

# View all variables
heroku config -a buglens-api-staging
```

</details>

---

### Step 2: Configure Buildpacks

Buglens requires both Node.js and Python.

#### For API App

1. **Go to** `buglens-api-staging` → **Settings** tab
2. **Scroll to "Buildpacks" section**
3. **Click "Add buildpack"**
4. **Add Python buildpack**:
   - Select: `heroku/python`
   - Click **"Save changes"**
5. **Click "Add buildpack" again**
6. **Add Node.js buildpack**:
   - Select: `heroku/nodejs`
   - Click **"Save changes"**
7. **Ensure order** (drag to reorder if needed):
   - 1. `heroku/python`
   - 2. `heroku/nodejs`

> **Why this order?** Python must be installed first so Node.js can call Python scripts.

#### For Worker App

1. **Repeat the same process** for `buglens-worker-staging`
2. **Buildpack order**:
   - 1. `heroku/python`
   - 2. `heroku/nodejs`

<details>
<summary><strong>Alternative: Use Docker Container (Advanced)</strong></summary>

If you prefer Docker:

1. **Go to** `buglens-api-staging` → **Settings**
2. **Stack**: Change to `container`
3. **Ensure** you have `heroku.yml` or `Dockerfile` in your repository
4. **Heroku will automatically detect and use container deployment**

</details>

---

### Step 3: Deploy to Staging

#### Trigger Manual Deploy

1. **Go to** `buglens-api-staging` → **Deploy** tab
2. **Scroll to "Manual deploy" section**
3. **Select branch**: `staging` (or `main` if you haven't created a staging branch)
4. **Click "Deploy Branch"**
5. **Wait for build** - You'll see real-time logs in the browser
6. **Watch for**:
   ```
   -----> Building on the Heroku-20 stack
   -----> Using buildpacks:
          1. heroku/python
          2. heroku/nodejs
   -----> Python app detected
   -----> Node.js app detected
   -----> Build succeeded!
   -----> Launching...
          Released v3
          https://buglens-api-staging.herokuapp.com/ deployed to Heroku
   ```

#### Deploy Worker App

1. **Go to** `buglens-worker-staging` → **Deploy** tab
2. **Manual deploy** → Select branch: `staging`
3. **Click "Deploy Branch"**
4. **Wait for build**

> **Automatic Deploys**: If you enabled automatic deploys in Step 5 of Initial Setup, every push to the `staging` branch will auto-deploy.

<details>
<summary><strong>Alternative: Deploy via Git Push (CLI)</strong></summary>

```bash
# Deploy API
git push staging-api staging:main

# Deploy Worker
git push staging-worker staging:main
```

</details>

---

### Step 4: Configure Dyno Formation

By default, Heroku starts a `web` dyno but not a `worker` dyno.

#### For API App

1. **Go to** `buglens-api-staging` → **Resources** tab
2. **Under "Dynos"**, you should see:
   - `web npm start` - Toggle **ON** (should be on by default)
3. **If you see** `release` process:
   - Toggle **OFF** (release is for one-time migrations, not continuous running)

#### For Worker App

1. **Go to** `buglens-worker-staging` → **Resources** tab
2. **Under "Dynos"**, you should see:
   - `worker node dist/workers/rca-worker.js`
3. **Toggle worker to "ON"** (click the pencil icon or toggle switch)
4. **Click "Confirm"**

> **Verify**: Both apps should show "1 dyno" running in the overview.

<details>
<summary><strong>Alternative: Scale via CLI</strong></summary>

```bash
# Scale API
heroku ps:scale web=1 -a buglens-api-staging

# Scale Worker
heroku ps:scale worker=1 -a buglens-worker-staging
```

</details>

---

### Step 5: Run Database Migrations

Migrations create the database tables.

#### Via Heroku Dashboard (One-Off Dyno)

1. **Go to** `buglens-api-staging` → **More** (top right) → **Run console**
2. **Enter command**: `npm run migrate:up`
3. **Click "Run"**
4. **Watch output** - You should see:
   ```
   Running migrations...
   ✓ 001_create_organizations.cjs
   ✓ 002_create_events.cjs
   ✓ 003_create_rca_jobs.cjs
   ...
   ✓ All migrations complete
   ```

> **Important**: Migrations must run **after** the first successful deploy, not before. Heroku needs to build the app first.

<details>
<summary><strong>Alternative: Run Migrations via CLI</strong></summary>

```bash
heroku run npm run migrate:up -a buglens-api-staging
```

</details>

#### Enable Automatic Migrations (Optional)

To run migrations automatically on every deploy:

1. **Ensure** your `Procfile` contains:
   ```
   release: npm run migrate:up
   web: node dist/api/server.js
   worker: node dist/workers/rca-worker.js
   ```
2. **Migrations will run** during the "release" phase before the app starts

---

### Step 6: Verify Deployment

#### Check Health Endpoint

1. **Open your browser** and go to:
   ```
   https://buglens-api-staging.herokuapp.com/health
   ```
2. **Expected response**:
   ```json
   {
     "status": "ok",
     "database": "connected",
     "redis": "connected",
     "timestamp": "2026-01-08T12:34:56.789Z",
     "version": "1.0.0"
   }
   ```

#### View Application Logs

1. **Go to** `buglens-api-staging` → **More** → **View logs**
2. **You should see**:
   ```
   2026-01-08T12:34:56.789Z app[web.1]: Server started on port 3000
   2026-01-08T12:34:56.790Z app[web.1]: Database connected
   2026-01-08T12:34:56.791Z app[web.1]: Redis connected
   ```

3. **For Worker app**:
   - Go to `buglens-worker-staging` → **More** → **View logs**
   - You should see:
   ```
   2026-01-08T12:35:01.123Z app[worker.1]: Worker started
   2026-01-08T12:35:01.124Z app[worker.1]: Connected to Redis
   2026-01-08T12:35:01.125Z app[worker.1]: Waiting for jobs...
   ```

#### Test Webhook Integration

1. **Configure Sentry webhook** to point to:
   ```
   https://buglens-api-staging.herokuapp.com/api/webhooks/sentry
   ```
2. **Trigger a test error** in your monitored app
3. **Check Buglens logs** for webhook receipt
4. **Check worker logs** for job processing

<details>
<summary><strong>Alternative: View Logs via CLI</strong></summary>

```bash
# Tail API logs
heroku logs --tail -a buglens-api-staging

# Tail Worker logs
heroku logs --tail -a buglens-worker-staging

# Filter by process type
heroku logs --tail --ps web -a buglens-api-staging
```

</details>
curl https://buglens-api-staging.herokuapp.com/health

# Check logs
heroku logs --tail -a buglens-api-staging
heroku logs --tail -a buglens-worker-staging
```

---

## Production Deployment

> **⚠️ CRITICAL**: Production deployment requires extra care. Review this entire section before deploying.

### Step 1: Production Environment Variables

Production must use **different secrets** than staging for security.

#### Configure API App Variables

1. **Go to** `buglens-api-prod` → **Settings** → **Config Vars**
2. **Click "Reveal Config Vars"**
3. **Add all required variables** (same keys as staging, but **different values**):

| Key                         | Value                                              | Notes                                            |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| `NODE_ENV`                  | `production`                                       | **MUST** be `production` (not `staging`)         |
| `APP_BASE_URL`              | `https://api.buglens.com`                          | Your production domain (or Heroku URL)           |
| `JWT_SECRET`                | Generate **NEW**: `openssl rand -base64 32`        | **DO NOT** reuse staging secret                  |
| `ENCRYPTION_KEY`            | Generate **NEW**: `openssl rand -hex 32`           | **DO NOT** reuse staging secret                  |
| `GITHUB_APP_ID`             | Production GitHub App ID                           | Can be same app or separate prod app             |
| `GITHUB_APP_PRIVATE_KEY`    | Production private key PEM                         | If using separate prod app                       |
| `GITHUB_APP_WEBHOOK_SECRET` | Production webhook secret                          | **DO NOT** reuse staging secret                  |
| `SENTRY_DSN`                | Production Sentry DSN                              | Use separate Sentry project for prod             |
| `SENTRY_WEBHOOK_SECRET`     | Generate **NEW**: `openssl rand -hex 20`           | **DO NOT** reuse staging secret                  |
| `OPENAI_API_KEY`            | Production OpenAI key                              | Consider separate key for cost tracking          |
| `LOG_LEVEL`                 | `info`                                             | Less verbose than staging                        |
| `CORS_ORIGINS`              | `https://app.buglens.com,https://buglens.com`      | **Only** production domains (no localhost)       |
| `ADMIN_TOKEN`               | Generate **NEW**: `openssl rand -hex 32`           | **DO NOT** reuse staging token                   |
| `RATE_LIMIT_MAX_REQUESTS`   | `1000`                                             | Higher limits for production                     |
| `LLM_DAILY_TOKEN_LIMIT`     | `10000000`                                         | Higher for production traffic                    |
| `COST_ALERT_THRESHOLD`      | `50.00`                                            | USD threshold for production alerts              |

**Critical Production-Only Variables:**

| Key                        | Value                        | Purpose                                    |
| -------------------------- | ---------------------------- | ------------------------------------------ |
| `DATABASE_POOL_MIN`        | `2`                          | Minimum DB connections                     |
| `DATABASE_POOL_MAX`        | `20`                         | Maximum DB connections                     |
| `DATABASE_SSL`             | `true`                       | Force SSL for database connections         |
| `FORCE_HTTPS`              | `true`                       | Redirect HTTP to HTTPS                     |
| `TRUST_PROXY`              | `true`                       | Required for Heroku behind load balancer   |
| `HELMET_ENABLED`           | `true`                       | Enable security headers                    |
| `ENABLE_REQUEST_LOGGING`   | `true`                       | Log all requests (for audit)               |
| `ENABLE_ERROR_NOTIFICATIONS`| `true`                      | Send critical errors to Slack/email        |
| `SLACK_WEBHOOK_URL`        | Your Slack webhook           | For critical alerts                        |
| `ALERT_EMAIL`              | `alerts@buglens.com`         | Email for critical alerts                  |
| `BACKUP_ENABLED`           | `true`                       | Enable automated backups                   |
| `MAINTENANCE_MODE`         | `false`                      | Emergency maintenance toggle               |

#### Configure Worker App Variables

1. **Go to** `buglens-worker-prod` → **Settings** → **Config Vars**
2. **Add worker-specific variables** (same as staging but with production values):

| Key                         | Value                                 | Notes                                      |
| --------------------------- | ------------------------------------- | ------------------------------------------ |
| `NODE_ENV`                  | `production`                          | **MUST** be `production`                   |
| `WORKER_MODE`               | `true`                                | Enables worker mode                        |
| `GITHUB_APP_ID`             | Same as API                           | Copy from API config                       |
| `GITHUB_APP_PRIVATE_KEY`    | Same as API                           | Copy from API config                       |
| `OPENAI_API_KEY`            | Same as API                           | Copy from API config                       |
| `LOG_LEVEL`                 | `info`                                | Same as API                                |
| `MAX_CONCURRENT_JOBS`       | `10`                                  | Higher for production (vs 5 in staging)    |
| `JOB_TIMEOUT_MS`            | `600000`                              | 10 minutes (vs 5 in staging)               |
| `RETRY_ATTEMPTS`            | `3`                                   | Same as staging                            |
| `ENABLE_JOB_METRICS`        | `true`                                | Production-specific: Track job performance |
| `ENABLE_DEAD_LETTER_QUEUE`  | `true`                                | Production-specific: Failed job handling   |

<details>
<summary><strong>Alternative: Set Production Variables via CLI</strong></summary>

```bash
# Generate new secrets
export PROD_JWT_SECRET=$(openssl rand -base64 32)
export PROD_ENCRYPTION_KEY=$(openssl rand -hex 32)
export PROD_WEBHOOK_SECRET=$(openssl rand -hex 20)
export PROD_ADMIN_TOKEN=$(openssl rand -hex 32)

# Set API variables
heroku config:set \
  NODE_ENV=production \
  APP_BASE_URL=https://api.buglens.com \
  JWT_SECRET="$PROD_JWT_SECRET" \
  ENCRYPTION_KEY="$PROD_ENCRYPTION_KEY" \
  LOG_LEVEL=info \
  FORCE_HTTPS=true \
  -a buglens-api-prod

# Set Worker variables
heroku config:set \
  NODE_ENV=production \
  WORKER_MODE=true \
  MAX_CONCURRENT_JOBS=10 \
  -a buglens-worker-prod
```

</details>

---

### Step 2: Configure Custom Domain (Optional but Recommended)

#### Add Domain to Heroku

1. **Go to** `buglens-api-prod` → **Settings** tab
2. **Scroll to "Domains" section**
3. **Click "Add domain"**
4. **Enter domain**: `api.buglens.com`
5. **Click "Save changes"**
6. **Copy the "DNS Target"** (e.g., `your-app-123.herokudns.com`)

#### Configure DNS Provider

1. **Go to your DNS provider** (e.g., Namecheap, Cloudflare, Route 53)
2. **Add CNAME record**:
   - **Type**: `CNAME`
   - **Name**: `api` (or `@` for root domain)
   - **Target**: `your-app-123.herokudns.com` (from Heroku)
   - **TTL**: `Automatic` or `300`
3. **Save DNS changes** (propagation takes 5-60 minutes)

#### Verify Domain

1. **Go to** `buglens-api-prod` → **Settings** → **Domains**
2. **Wait for** "ACM Status" to show **"OK"** (SSL certificate provisioned)
3. **Test**: Open `https://api.buglens.com/health`

> **Automatic SSL**: Heroku provides free SSL via Let's Encrypt for custom domains on paid dynos.

<details>
<summary><strong>Alternative: Add Domain via CLI</strong></summary>

```bash
# Add domain
heroku domains:add api.buglens.com -a buglens-api-prod

# Get DNS target
heroku domains:info api.buglens.com -a buglens-api-prod

# Enable automatic SSL
heroku certs:auto:enable -a buglens-api-prod
```

</details>

---

### Step 3: Upgrade to Production Dynos

Free/Eco dynos sleep after 30 minutes of inactivity. Production apps need always-on dynos.

#### Upgrade API Dyno

1. **Go to** `buglens-api-prod` → **Resources** tab
2. **Under "Dynos"**, click the **pencil icon** next to `web`
3. **Change dyno type**:
   - **Basic**: $7/month (always-on, but limited resources)
   - **Standard-1X**: $25/month (recommended for production)
   - **Standard-2X**: $50/month (more RAM/CPU)
4. **Click "Confirm"**

#### Upgrade Worker Dyno

1. **Go to** `buglens-worker-prod` → **Resources** tab
2. **Click pencil icon** next to `worker`
3. **Change to**: `Standard-1X` (or higher based on load)
4. **Click "Confirm"**

> **Cost**: Standard-1X = $25/month per dyno. Total for API + Worker = $50/month.

<details>
<summary><strong>Alternative: Scale via CLI</strong></summary>

```bash
# Scale to Standard-1X dynos
heroku ps:scale web=1:standard-1x -a buglens-api-prod
heroku ps:scale worker=1:standard-1x -a buglens-worker-prod

# Check dyno status
heroku ps -a buglens-api-prod
```

</details>

---

### Step 4: Enable Preboot (Zero-Downtime Deploys)

Preboot starts new dynos before stopping old ones, preventing downtime during deploys.

1. **Go to** `buglens-api-prod` → **Settings** tab
2. **Scroll to "Dyno Features"**
3. **Enable "Preboot"** toggle
4. **Click "Confirm"**

> **Note**: Preboot is only available for Standard and Performance dynos (not Basic/Eco).

<details>
<summary><strong>Alternative: Enable via CLI</strong></summary>

```bash
heroku features:enable preboot -a buglens-api-prod
```

</details>

---

### Step 5: Configure Database Backups

Heroku Postgres automatically backs up Essential and Premium plans, but you should verify settings.

1. **Go to** `buglens-api-prod` → **Resources** → Click **"Heroku Postgres"**
2. **In add-on dashboard**, click **"Durability" tab**
3. **Verify**:
   - **Automated Backups**: **Enabled** (should be on by default)
   - **Frequency**: Daily at 02:00 UTC
   - **Retention**: 7 days (Essential-1), 30 days (Premium)
4. **Create manual backup** (optional):
   - Click **"Create Manual Backup"**
   - Click **"Create Backup"**

> **Best Practice**: Schedule backups during low-traffic hours (e.g., 2-4 AM in your timezone).

<details>
<summary><strong>Alternative: Manage Backups via CLI</strong></summary>

```bash
# Create manual backup
heroku pg:backups:capture -a buglens-api-prod

# Schedule daily backups
heroku pg:backups:schedule DATABASE_URL --at '02:00 UTC' -a buglens-api-prod

# List backups
heroku pg:backups -a buglens-api-prod

# Download backup
heroku pg:backups:download -a buglens-api-prod
```

</details>

---

### Step 6: Deploy to Production

#### Deploy via GitHub (Recommended)

1. **Go to** `buglens-api-prod` → **Deploy** tab
2. **Ensure** GitHub is connected
3. **Manual deploy section**:
   - **Select branch**: `main`
   - **✅ Check**: "Wait for CI to pass before deploy"
4. **Click "Deploy Branch"**
5. **Monitor build** in real-time
6. **Wait for**:
   ```
   -----> Build succeeded!
   -----> Launching...
          Released v5
          https://buglens-api-prod.herokuapp.com/ deployed to Heroku
   ```

#### Deploy Worker

1. **Go to** `buglens-worker-prod` → **Deploy** tab
2. **Manual deploy** → Branch: `main`
3. **Click "Deploy Branch"**

> **⚠️ Production Checklist Before Deploy**:
> - [ ] All secrets are different from staging
> - [ ] Custom domain configured and SSL verified
> - [ ] Dynos upgraded to Standard or higher
> - [ ] Preboot enabled
> - [ ] Database backups scheduled
> - [ ] Monitoring/alerts configured
> - [ ] Tested on staging successfully

<details>
<summary><strong>Alternative: Deploy via Git Push (CLI)</strong></summary>

```bash
# Deploy API (from main branch)
git push prod-api main

# Deploy Worker
git push prod-worker main
```

</details>

---

### Step 7: Run Production Migrations

1. **Go to** `buglens-api-prod` → **More** → **Run console**
2. **Enter**: `npm run migrate:up`
3. **Click "Run"**
4. **Verify** all migrations complete successfully

> **⚠️ Critical**: Always test migrations on staging first. Never run untested migrations in production.

---

### Step 8: Verify Production Deployment

#### Health Check

1. **Open browser**: `https://api.buglens.com/health` (or Heroku URL)
2. **Expected**:
   ```json
   {
     "status": "ok",
     "database": "connected",
     "redis": "connected",
     "environment": "production",
     "version": "1.0.0"
   }
   ```

#### Load Test (Optional)

Use a tool like Apache Bench to verify performance:

```bash
# Install Apache Bench (if not already installed)
brew install httpd

# Run simple load test (100 requests, 10 concurrent)
ab -n 100 -c 10 https://api.buglens.com/health
```

#### Monitor Logs

1. **Go to** `buglens-api-prod` → **More** → **View logs**
2. **Look for**:
   - No error messages
   - Server started successfully
   - Database/Redis connected
   - No memory/CPU warnings

---

### Step 9: Set Up Monitoring Alerts (Highly Recommended)

#### Enable Dyno Metadata

1. **Go to** `buglens-api-prod` → **Settings** → **Config Vars**
2. **Add**:
   - `HEROKU_APP_NAME`: `buglens-api-prod`
   - `HEROKU_DYNO_ID`: Automatically set by Heroku
   - `HEROKU_RELEASE_VERSION`: Automatically set by Heroku

#### Add Monitoring Add-on (Optional)

Heroku offers several monitoring add-ons:

1. **Go to** `buglens-api-prod` → **Resources** → **Add-ons**
2. **Search for**:
   - **Papertrail** (Log management) - Free tier available
   - **New Relic APM** (Performance monitoring) - Free tier available
   - **Logentries** (Log analysis) - Paid
3. **Select** and **provision** desired add-on

<details>
<summary><strong>Alternative: Add Monitoring via CLI</strong></summary>

```bash
# Add Papertrail for logs
heroku addons:create papertrail:choklad -a buglens-api-prod

# Add New Relic for APM
heroku addons:create newrelic:wayne -a buglens-api-prod
```

</details>

---

## CI/CD with GitHub Actions

Buglens includes pre-configured GitHub Actions workflows for automated testing and deployment.

### Workflow Overview

1. **Test Workflow** (`.github/workflows/test.yml`) - Runs on every PR and push
2. **Deploy Staging** (`.github/workflows/deploy-staging.yml`) - Auto-deploys `staging` branch
3. **Deploy Production** (`.github/workflows/deploy-production.yml`) - Deploys `main` with manual approval

### Step 1: Generate Heroku API Key

#### Via Heroku Dashboard

1. **Go to**: https://dashboard.heroku.com/account
2. **Scroll to "API Key" section**
3. **Click "Reveal"** to see your API key
4. **Copy** the key (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

> **Security**: Treat this like a password. Anyone with this key can deploy to your Heroku apps.

<details>
<summary><strong>Alternative: Generate via CLI</strong></summary>

```bash
# Create authorization token
heroku authorizations:create --description "GitHub Actions"

# Copy the "Token" value
```

</details>

---

### Step 2: Add GitHub Secrets

1. **Go to your GitHub repository**
2. **Click**: Settings → Secrets and variables → Actions
3. **Click "New repository secret"**
4. **Add each secret** (click "Add secret" after each):

| Secret Name                   | Value                         | Example/Notes                     |
| ----------------------------- | ----------------------------- | --------------------------------- |
| `HEROKU_API_KEY`              | Your Heroku API key           | `xxxxxxxx-xxxx-...`               |
| `HEROKU_EMAIL`                | Your Heroku account email     | `you@example.com`                 |
| `HEROKU_APP_STAGING_API`      | `buglens-api-staging`         | Exact app name                    |
| `HEROKU_APP_STAGING_WORKER`   | `buglens-worker-staging`      | Exact app name                    |
| `HEROKU_APP_PROD_API`         | `buglens-api-prod`            | Exact app name                    |
| `HEROKU_APP_PROD_WORKER`      | `buglens-worker-prod`         | Exact app name                    |

---

### Step 3: Enable GitHub Actions

1. **In your repository**: Go to **Actions** tab
2. **If disabled**: Click **"I understand my workflows, go ahead and enable them"**
3. **Verify workflows** are listed:
   - Test
   - Deploy to Staging
   - Deploy to Production

---

### Step 4: Test Automated Deployment

#### Test Staging Auto-Deploy

1. **Create a staging branch** (if not exists):
   ```bash
   git checkout -b staging
   git push origin staging
   ```
2. **Make a small change** (e.g., update README)
3. **Commit and push**:
   ```bash
   git add .
   git commit -m "Test staging deploy"
   git push origin staging
   ```
4. **Go to GitHub Actions tab**
5. **Watch** "Deploy to Staging" workflow run
6. **Verify** deployment completes successfully

#### Test Production Deploy (Manual Trigger)

1. **Merge staging to main**:
   ```bash
   git checkout main
   git merge staging
   git push origin main
   ```
2. **Go to GitHub Actions tab**
3. **Click** "Deploy to Production" workflow
4. **Click** "Run workflow" dropdown
5. **Select branch**: `main`
6. **Click "Run workflow"**
7. **Approve deployment** when prompted (if approval required)

---

### Workflow Customization

#### Add Deployment Approval (Recommended for Production)

1. **Go to GitHub repository** → **Settings** → **Environments**
2. **Click "New environment"**
3. **Name**: `production`
4. **Check** "Required reviewers"
5. **Add reviewers** (team members who must approve prod deploys)
6. **Save protection rules**

Now production deploys will require manual approval.

#### Modify Workflow Triggers

Edit `.github/workflows/deploy-production.yml`:

```yaml
# Current: Manual trigger only
on:
  workflow_dispatch:

# Option 1: Auto-deploy on push to main (not recommended for prod)
on:
  push:
    branches: [main]

# Option 2: Auto-deploy on tags
on:
  push:
    tags:
      - 'v*.*.*'  # Trigger on version tags like v1.0.0
```

---

### Troubleshooting CI/CD

#### Workflow Fails: "Error: Invalid credentials"

**Solution**: Verify GitHub secrets:
1. Go to Settings → Secrets → Actions
2. Check `HEROKU_API_KEY` is correct
3. Re-generate API key if needed

#### Workflow Fails: "Error: App not found"

**Solution**: Check app names in secrets match Heroku:
1. Go to Heroku Dashboard
2. Verify exact app names
3. Update GitHub secrets if misspelled

#### Deployment Succeeds but App Crashes

**Solution**: Check Heroku logs:
1. Go to Heroku app → More → View logs
2. Look for error messages
3. Common issues:
   - Missing environment variables
   - Database migration failures
   - Build errors

<details>
<summary><strong>View Workflow Logs</strong></summary>

1. **Go to GitHub Actions tab**
2. **Click on failed workflow run**
3. **Click on failing job** (e.g., "deploy")
4. **Expand steps** to see detailed logs
5. **Look for red X** indicating failure point

</details>

---

## Environment Variables

### Complete Variable Reference

| Variable                    | Required    | Description           | Example                   |
| --------------------------- | ----------- | --------------------- | ------------------------- |
| `NODE_ENV`                  | Yes         | Environment name      | `production`              |
| `PORT`                      | Auto        | Heroku sets this      | `3000`                    |
| `DATABASE_URL`              | Auto        | Heroku Postgres URL   | auto-configured           |
| `REDIS_URL`                 | Auto        | Heroku Redis URL      | auto-configured           |
| `JWT_SECRET`                | Yes         | JWT signing key       | 32+ char random           |
| `ENCRYPTION_KEY`            | Yes         | Token encryption      | 64 char hex               |
| `APP_BASE_URL`              | Yes         | Public API URL        | `https://api.buglens.com` |
| `GITHUB_APP_ID`             | Yes         | GitHub App ID         | `123456`                  |
| `GITHUB_APP_PRIVATE_KEY`    | Yes         | GitHub App key        | PEM content               |
| `GITHUB_APP_WEBHOOK_SECRET` | Yes         | Webhook signing       | random string             |
| `SENTRY_DSN`                | Yes         | Sentry error tracking | DSN URL                   |
| `SENTRY_WEBHOOK_SECRET`     | Yes         | Sentry webhook auth   | random string             |
| `OPENAI_API_KEY`            | Yes         | GPT-4o-mini access    | `sk-...`                  |
| `WORKER_MODE`               | Worker only | Enable worker mode    | `true`                    |
| `AWS_ACCESS_KEY_ID`         | Optional    | For S3/CloudWatch     | AWS key                   |
| `AWS_SECRET_ACCESS_KEY`     | Optional    | For S3/CloudWatch     | AWS secret                |
| `AWS_REGION`                | Optional    | AWS region            | `us-east-1`               |

### Verify Configuration

```bash
# List all config vars
heroku config -a buglens-api-prod

# Check specific variable
heroku config:get DATABASE_URL -a buglens-api-prod
```

---

## Database Migrations

### Running Migrations via Dashboard

#### Run Migrations on Staging/Production

1. **Go to app** (e.g., `buglens-api-staging`)
2. **Click "More"** (top right) → **"Run console"**
3. **Enter command**: `npm run migrate:up`
4. **Click "Run"**
5. **Monitor output**:
   ```
   Running migrations...
   ✓ 001_create_organizations.cjs
   ✓ 002_create_events.cjs
   ✓ 003_create_rca_jobs.cjs
   ...
   ✓ All migrations complete (25 applied)
   ```

#### Rollback Last Migration

1. **Run console** (same as above)
2. **Enter**: `npm run migrate:down`
3. **Confirm** when prompted
4. **Verify** rollback succeeded

#### Check Migration Status

1. **Run console**
2. **Enter**: `npm run migrate:status`
3. **Output shows**:
   ```
   ┌─────────────────────────────────────┬──────────────────────┐
   │ Migration                            │ Status               │
   ├─────────────────────────────────────┼──────────────────────┤
   │ 001_create_organizations.cjs        │ Applied 2026-01-08   │
   │ 002_create_events.cjs               │ Applied 2026-01-08   │
   │ 003_create_rca_jobs.cjs             │ Pending              │
   └─────────────────────────────────────┴──────────────────────┘
   ```

<details>
<summary><strong>Alternative: Run Migrations via CLI</strong></summary>

```bash
# Run pending migrations
heroku run npm run migrate:up -a buglens-api-prod

# Rollback last migration
heroku run npm run migrate:down -a buglens-api-prod

# Check status
heroku run npm run migrate:status -a buglens-api-prod
```

</details>

---

### Automatic Migrations (Release Phase)

Configure Heroku to run migrations automatically before each deploy.

#### Enable Release Phase

1. **Ensure** your `Procfile` contains:
   ```
   release: npm run migrate:up
   web: node dist/api/server.js
   worker: node dist/workers/rca-worker.js
   ```

2. **Commit and push** `Procfile`:
   ```bash
   git add Procfile
   git commit -m "Enable automatic migrations via release phase"
   git push origin main
   ```

3. **Deploy** to Heroku (via GitHub or manual deploy)

4. **Verify** release phase runs:
   - Go to **Activity** tab
   - Look for "Release phase" in deploy log
   - Should show migration output

> **⚠️ Warning**: Failed migrations will prevent deployment. Always test migrations on staging first.

---

### Database Backup Before Migrations

**Critical**: Always backup production database before running migrations.

#### Create Manual Backup via Dashboard

1. **Go to** `buglens-api-prod` → **Resources**
2. **Click** "Heroku Postgres" add-on
3. **Click "Durability" tab** in add-on dashboard
4. **Click "Create Manual Backup"**
5. **Click "Create Backup"** to confirm
6. **Wait** for backup to complete (1-5 minutes)
7. **Verify** backup appears in list

#### Download Backup (Optional)

1. **In Postgres add-on dashboard** → **Durability** tab
2. **Click** "..." menu next to backup
3. **Click "Download"**
4. **Save** .dump file locally

<details>
<summary><strong>Alternative: Backup via CLI</strong></summary>

```bash
# Create backup
heroku pg:backups:capture -a buglens-api-prod

# Download backup
heroku pg:backups:download -a buglens-api-prod

# Restore from backup (if needed)
heroku pg:backups:restore b001 DATABASE_URL -a buglens-api-prod
```

</details>

---

### Schedule Automatic Backups

1. **In Postgres add-on dashboard** → **Durability** tab
2. **Scroll to "Backup Schedule"**
3. **Click "Change Schedule"**
4. **Set schedule**:
   - **Frequency**: Daily
   - **Time**: `02:00 UTC` (or low-traffic hour)
5. **Click "Save Schedule"**

> **Best Practice**: Schedule backups during low-traffic periods to minimize performance impact.

---

### Troubleshooting Migrations

#### Migration Fails: "Database connection error"

**Solution**:
1. Check `DATABASE_URL` is set:
   - Go to Settings → Config Vars
   - Verify `DATABASE_URL` exists
2. Check database status:
   - Resources → Click Postgres → Settings → Status

#### Migration Fails: "Permission denied"

**Solution**: Verify database credentials:
1. Go to Postgres add-on → Settings → Credentials
2. Check user has necessary permissions
3. For Heroku Postgres, default user should have all permissions

#### Migration Stuck/Timeout

**Solution**:
1. **Cancel** the stuck migration (Ctrl+C in console)
2. **Check** for locked tables:
   - Run console: `heroku run bash -a APP_NAME`
   - Connect to DB: `psql $DATABASE_URL`
   - Check locks: `SELECT * FROM pg_locks;`
3. **Restart** database if needed:
   - Postgres add-on → Settings → "Restart Database"

<details>
<summary><strong>Alternative: CLI Migration Troubleshooting</strong></summary>

```bash
# Run migration with verbose output
heroku run npm run migrate:up -- --verbose -a buglens-api-prod

# Check database connection
heroku pg:info -a buglens-api-prod

# Connect to database directly
heroku pg:psql -a buglens-api-prod

# List tables
\dt

# Check migration table
SELECT * FROM migrations ORDER BY applied_at DESC;
```

</details>

---

## Monitoring & Logging

### View Logs via Dashboard

#### Real-Time Logs

1. **Go to app** (e.g., `buglens-api-prod`)
2. **Click "More"** (top right) → **"View logs"**
3. **Logs stream in real-time**
4. **Look for**:
   - Server startup messages
   - Request logs
   - Error messages
   - Performance warnings

#### Filter Logs

In the log viewer:
- **Process filter**: Shows only `web`, `worker`, or `release` processes
- **Time range**: View historical logs (last 1500 lines by default)
- **Search**: Use browser's find function (Cmd+F / Ctrl+F)

#### Download Logs

1. **In log viewer**, logs are displayed but **cannot be downloaded** directly from dashboard
2. **For persistent logs**, use a logging add-on (see below)

<details>
<summary><strong>Alternative: View Logs via CLI</strong></summary>

```bash
# Tail all logs
heroku logs --tail -a buglens-api-prod

# Filter by process type
heroku logs --tail --ps web -a buglens-api-prod
heroku logs --tail --ps worker -a buglens-worker-prod

# Filter by source
heroku logs --source app -a buglens-api-prod

# Last 1000 lines
heroku logs -n 1000 -a buglens-api-prod

# Search for errors
heroku logs -a buglens-api-prod | grep ERROR
```

</details>

---

### Metrics Dashboard

#### View Application Metrics

1. **Go to app** → **Metrics** tab
2. **View real-time metrics**:
   - **Dyno Load**: CPU/memory usage
   - **Response Time**: P50, P95, P99 latencies
   - **Throughput**: Requests per minute
   - **Errors**: 4xx/5xx error rates
   - **Memory**: Memory consumption over time

#### Dyno Metrics

1. **Click** on a specific dyno (e.g., `web.1`)
2. **View**:
   - CPU percentage
   - Memory usage (MB)
   - Load average
   - Swap usage (should be 0 for healthy app)

> **Warning Signs**:
> - CPU consistently >80%: Consider scaling up dyno size
> - Memory >80% of limit: Risk of R14 errors (memory quota exceeded)
> - Response time >1s P95: Performance issue

---

### Add Logging Add-on (Recommended for Production)

Heroku retains only ~1500 lines of logs. For production, use a logging add-on.

#### Option 1: Papertrail (Recommended - Free Tier Available)

1. **Go to** `buglens-api-prod` → **Resources** tab
2. **In "Add-ons" search**, type: `Papertrail`
3. **Select**: `Papertrail`
4. **Choose plan**:
   - **Choklad** (Free): 50 MB/month, 7-day retention
   - **Fixa** ($7/month): 100 MB/month, 7-day retention
   - **Volym** ($25/month): 1 GB/month, 30-day retention
5. **Click "Submit Order Form"**
6. **Access Papertrail**:
   - Go to Resources → Click "Papertrail"
   - Opens Papertrail dashboard with searchable logs

**Papertrail Features**:
- Search logs with regex
- Create saved searches
- Set up alerts (email/Slack on specific log patterns)
- Tail logs in browser

#### Option 2: Logentries

1. **Add-ons** → Search: `Logentries`
2. **Plans**: Starting at $16/month
3. **Features**: Advanced analytics, dashboards, anomaly detection

#### Option 3: Splunk

1. **Add-ons** → Search: `Splunk`
2. **Plans**: Enterprise-grade logging
3. **For**: Large-scale production deployments

<details>
<summary><strong>Alternative: Add Papertrail via CLI</strong></summary>

```bash
# Add Papertrail
heroku addons:create papertrail:choklad -a buglens-api-prod

# Open Papertrail dashboard
heroku addons:open papertrail -a buglens-api-prod
```

</details>

---

### Health Check Monitoring

#### Built-in Health Endpoint

Buglens exposes `/health` endpoint for monitoring:

```bash
curl https://api.buglens.com/health
```

**Expected response**:
```json
{
  "status": "ok",
  "database": "connected",
  "redis": "connected",
  "timestamp": "2026-01-08T12:34:56.789Z",
  "version": "1.0.0",
  "uptime": 3600
}
```

#### Set Up External Monitoring

Use third-party services to monitor uptime:

**Option 1: UptimeRobot (Free)**
1. Sign up at https://uptimerobot.com
2. Add monitor: `https://api.buglens.com/health`
3. Set check interval: 5 minutes
4. Configure alerts: Email/Slack on downtime

**Option 2: Pingdom (Paid)**
1. More detailed monitoring
2. Global monitoring locations
3. Advanced alerting

**Option 3: Heroku's Built-in Monitoring (Threshold Alerts)**
1. Go to app → **Metrics** tab
2. **Click "..." menu** → **"Create Alert"**
3. **Configure**:
   - Metric: Response Time P95
   - Threshold: >1000ms
   - Duration: 10 minutes
   - Notification: Email
4. **Save alert**

---

### Application Performance Monitoring (APM)

#### Option 1: New Relic (Free Tier Available)

1. **Go to** `buglens-api-prod` → **Resources**
2. **Add-ons** → Search: `New Relic APM`
3. **Choose plan**:
   - **Wayne** (Free): 100 GB data/month
   - **Starter** ($99/month): Advanced features
4. **Click "Submit Order Form"**
5. **Configure**:
   - New Relic automatically injects agent via buildpack
   - No code changes needed
6. **Access**: Resources → Click "New Relic APM"

**New Relic Features**:
- Transaction tracing
- Slow query detection
- Error analytics
- Dependency mapping

#### Option 2: Scout APM

1. **Add-ons** → Search: `Scout APM`
2. **Plans**: Starting at $29/month
3. **Features**: Request tracing, N+1 query detection

<details>
<summary><strong>Alternative: Add New Relic via CLI</strong></summary>

```bash
# Add New Relic
heroku addons:create newrelic:wayne -a buglens-api-prod

# Open New Relic dashboard
heroku addons:open newrelic -a buglens-api-prod
```

</details>

---

### Error Tracking

Buglens uses **Sentry** for error tracking (already configured via `SENTRY_DSN`).

#### Verify Sentry Integration

1. **Go to Sentry dashboard** (https://sentry.io)
2. **Select** your Buglens project
3. **Check** for incoming errors
4. **Set up alerts**:
   - Go to Alerts → Create Alert Rule
   - Trigger: "Number of events"
   - Threshold: >10 errors in 5 minutes
   - Notification: Email/Slack

---

### Log Analysis Best Practices

#### Search for Common Issues

**Database connection errors**:
```
# In Papertrail or Heroku logs
search: "database connection" OR "ECONNREFUSED"
```

**Memory issues**:
```
search: "R14" OR "memory quota exceeded"
```

**Slow requests**:
```
search: "slow query" OR "timeout"
```

**Failed jobs**:
```
search: "job failed" OR "retry" in app:buglens-worker-prod
```

#### Set Up Log-Based Alerts

**In Papertrail**:
1. **Create search** for critical errors
2. **Click "Save Search"**
3. **Add alert**:
   - Name: "Production Critical Errors"
   - Search: `ERROR AND severity:critical`
   - Frequency: If count >5 in 5 minutes
   - Notify: Email/Slack
4. **Save alert**

---

### Performance Optimization Tips

#### Identify Slow Endpoints

1. **View Metrics** tab
2. **Look at** "Response Time" graph
3. **Click** on spike to see details
4. **Identify** slow endpoints
5. **Optimize**:
   - Add database indexes
   - Implement caching
   - Optimize queries

#### Monitor Database Performance

1. **Go to Postgres add-on dashboard**
2. **Click "Metrics" tab**
3. **Monitor**:
   - Connection count (should be <80% of max)
   - Cache hit rate (should be >90%)
   - Slow queries (use `pg:outliers`)

<details>
<summary><strong>Alternative: Database Metrics via CLI</strong></summary>

```bash
# Connection stats
heroku pg:info -a buglens-api-prod

# Slow queries
heroku pg:outliers -a buglens-api-prod

# Cache hit rate
heroku pg:diagnose -a buglens-api-prod
```

</details>

---

## Troubleshooting

### Common Issues

#### 1. Build Fails

**Symptoms**:
- Deployment fails during build phase
- Error: "Build failed"

**Solution via Dashboard**:
1. **Go to** app → **Activity** tab
2. **Click** on failed build
3. **Review build log** for errors
4. **Common causes**:
   - Missing dependencies in `package.json` or `requirements.txt`
   - Node.js version mismatch (specify in `package.json` `engines`)
   - Python version issues (specify in `runtime.txt`)

**Fix**:
1. **Check `package.json`**:
   ```json
   "engines": {
     "node": "20.x",
     "npm": "10.x"
   }
   ```
2. **Ensure `requirements.txt` exists in root**:
   - Heroku's Python buildpack requires `requirements.txt` in the **root directory**
   - The file should list all Python dependencies
   - Example:
     ```
     tree-sitter==0.21.0
     openai>=1.50.0,<2.0.0
     pydantic==2.5.0
     ```
3. **Check `runtime.txt`** (specifies Python version):
   ```
   python-3.11.0
   ```
4. **Verify files are committed**:
   ```bash
   git add requirements.txt runtime.txt
   git commit -m "Add Python buildpack files"
   git push origin main
   ```
5. **Clear build cache** (if rebuilding):
   - Go to Settings → scroll to "Build Cache"
   - Click "Purge build cache"
   - Re-deploy

> **Note**: Buglens requires both Node.js and Python buildpacks. The `requirements.txt` must be in the root directory even if your Python code is in a subdirectory (`python/`).

<details>
<summary><strong>Alternative: Troubleshoot via CLI</strong></summary>

```bash
# View build info
heroku builds:info -a buglens-api-prod

# Clear cache
heroku builds:cache:purge -a buglens-api-prod

# Retry build
git commit --allow-empty -m "Trigger rebuild"
git push heroku main
```

</details>

---

#### 2. App Crashes on Start (R10 Boot Timeout)

**Symptoms**:
- App crashes immediately after deploy
- Error: "R10 - Boot timeout"
- Logs show: "Error R10 (Boot timeout) -> Web process failed to bind to $PORT within 60 seconds"

**Solution**:
1. **Go to** app → **More** → **View logs**
2. **Look for** error messages
3. **Common causes**:
   - App not listening on `process.env.PORT`
   - Missing environment variables
   - Database connection timeout

**Fix**:
1. **Verify** `src/api/server.ts` uses:
   ```typescript
   const PORT = process.env.PORT || 3000;
   app.listen(PORT, '0.0.0.0', () => {
     console.log(`Server started on port ${PORT}`);
   });
   ```
2. **Check Config Vars**:
   - Settings → Config Vars
   - Verify `DATABASE_URL`, `REDIS_URL`, `NODE_ENV` are set
3. **Increase boot timeout** (if legitimate slow start):
   - Not configurable in dashboard
   - Use CLI: `heroku config:set BOOT_TIMEOUT=120 -a APP_NAME`

---

#### 3. Database Connection Issues

**Symptoms**:
- Error: "ECONNREFUSED" or "Connection timeout"
- Health check shows `"database": "error"`

**Solution via Dashboard**:
1. **Check database status**:
   - Go to Resources → Click "Heroku Postgres"
   - Settings tab → Status should be "Available"
2. **Verify DATABASE_URL**:
   - Go to Settings → Config Vars
   - `DATABASE_URL` should exist (format: `postgres://...`)
3. **Check connection limits**:
   - In Postgres dashboard → Metrics tab
   - Current connections should be < max connections
4. **Restart database** (last resort):
   - Postgres dashboard → Settings → "Restart Database"
   - **Warning**: Causes ~30s downtime

<details>
<summary><strong>Alternative: Troubleshoot via CLI</strong></summary>

```bash
# Check database status
heroku pg:info -a buglens-api-prod

# Check connections
heroku pg:ps -a buglens-api-prod

# Kill long-running queries (if stuck)
heroku pg:killall -a buglens-api-prod

# Restart database
heroku pg:restart -a buglens-api-prod

# Test connection
heroku pg:psql -a buglens-api-prod -c "SELECT 1;"
```

</details>

---

#### 4. Redis Connection Issues

**Symptoms**:
- Worker not processing jobs
- Error: "Redis connection refused"
- Health check shows `"redis": "error"`

**Solution via Dashboard**:
1. **Check Redis status**:
   - Go to Resources → Click "Heroku Data for Redis"
   - Status should be "Available"
2. **Verify REDIS_URL**:
   - Settings → Config Vars
   - `REDIS_URL` should exist (format: `redis://...`)
3. **Check memory usage**:
   - Redis dashboard → Metrics
   - Memory used should be < max memory
4. **Clear Redis** (if full):
   - Go to Redis dashboard
   - Click "..." menu → "Restart Redis"

<details>
<summary><strong>Alternative: Troubleshoot via CLI</strong></summary>

```bash
# Check Redis status
heroku redis:info -a buglens-api-prod

# Check memory usage
heroku redis:maxmemory -a buglens-api-prod

# Connect to Redis CLI
heroku redis:cli -a buglens-api-prod

# Check keys (in Redis CLI)
> KEYS *
> INFO memory
> DBSIZE

# Clear all keys (DANGEROUS - use carefully)
> FLUSHALL
```

</details>

---

#### 5. Worker Not Processing Jobs

**Symptoms**:
- Jobs queued but not processed
- No worker logs in dashboard
- Worker dyno shows "down"

**Solution via Dashboard**:
1. **Check worker dyno is running**:
   - Go to `buglens-worker-prod` → **Resources** tab
   - Verify `worker` dyno is **toggled ON**
   - Should show "1 dyno" running
2. **View worker logs**:
   - More → View logs
   - Look for startup messages and errors
3. **Restart worker**:
   - Resources tab → Click "..." next to worker dyno
   - Click "Restart"
4. **Check for job errors**:
   - View logs for "job failed" or "retry"
   - Check Redis for failed jobs (use CLI or Redis dashboard)

**Common Causes**:
- Worker dyno not enabled
- Missing environment variables on worker app
- Redis connection issues
- Code errors in job processor

<details>
<summary><strong>Alternative: Troubleshoot via CLI</strong></summary>

```bash
# Check worker status
heroku ps -a buglens-worker-prod

# Restart worker
heroku ps:restart worker -a buglens-worker-prod

# View worker logs
heroku logs --tail --ps worker -a buglens-worker-prod

# Check Redis queue
heroku redis:cli -a buglens-api-prod
> KEYS bull:*
> LLEN bull:rca-jobs:waiting
> LRANGE bull:rca-jobs:failed 0 10
```

</details>

---

#### 6. High Memory Usage (R14 Error)

**Symptoms**:
- Error: "R14 - Memory quota exceeded"
- App slows down or crashes
- Metrics show memory near 100%

**Solution**:
1. **Check metrics**:
   - Metrics tab → Memory graph
   - Identify when memory spikes
2. **Identify memory leak**:
   - Add New Relic APM (see Monitoring section)
   - Profile memory usage
3. **Short-term fix - Restart app**:
   - More → Restart all dynos
4. **Long-term fix**:
   - Optimize code (e.g., limit cache size, fix leaks)
   - Or upgrade dyno size:
     - Resources tab → Change dyno type to higher tier
     - Standard-2X has 1GB RAM (vs 512MB for Standard-1X)

---

#### 7. Slow Performance / High CPU

**Symptoms**:
- Slow response times (>1s P95)
- Timeout errors
- Metrics show CPU >80%

**Solution**:
1. **Identify slow endpoints**:
   - Metrics tab → Response Time graph
   - Click on spike to see details
2. **Check database performance**:
   - Postgres dashboard → Metrics
   - Look for slow queries
   - Use `pg:outliers` (CLI) to find inefficient queries
3. **Optimize**:
   - Add database indexes
   - Implement caching (Redis)
   - Optimize expensive operations
4. **Scale horizontally** (add more dynos):
   - Resources tab → Change dyno count
   - Example: web=2 (runs 2 web dynos for load balancing)
5. **Scale vertically** (bigger dynos):
   - Resources tab → Change dyno type
   - Standard-2X has 2x CPU of Standard-1X

---

#### 8. SSL Certificate Issues (Custom Domain)

**Symptoms**:
- "Not secure" warning in browser
- SSL certificate not provisioned
- "ACM Status: Failing" in Domains section

**Solution**:
1. **Check ACM status**:
   - Settings → Domains section
   - Status should be "OK"
2. **If "Failing"**:
   - Verify DNS CNAME is correct:
     - Should point to `your-app-123.herokudns.com`
   - Wait for DNS propagation (up to 24 hours)
   - Check DNS propagation: https://www.whatsmydns.net
3. **Manual SSL** (if ACM fails):
   - Contact Heroku support
   - Or use Cloudflare for SSL termination

---

#### 9. Config Var Changes Not Applied

**Symptoms**:
- Updated config var but app still uses old value
- Environment variable undefined in app

**Solution**:
1. **Restart app**:
   - Config var changes should auto-restart, but verify:
   - Activity tab → Check for "Config add" event followed by restart
2. **Manual restart**:
   - More → Restart all dynos
3. **Verify var is set**:
   - Settings → Config Vars → Reveal
   - Check exact key name (case-sensitive)
4. **Check app code**:
   - Ensure code reads `process.env.VAR_NAME`
   - Not hardcoded value

---

### Performance Optimization Tips

#### Enable HTTP/2

HTTP/2 is automatically enabled for HTTPS connections on Heroku. No config needed.

#### Enable Compression

Ensure your app uses compression middleware:

```typescript
// In src/api/server.ts
import compress from '@fastify/compress';
app.register(compress);
```

#### Optimize Database Queries

1. **Add indexes** for frequently queried columns:
   ```sql
   CREATE INDEX idx_events_org_id ON events(org_id);
   CREATE INDEX idx_events_created_at ON events(created_at);
   ```
2. **Use connection pooling** (already configured in Buglens)
3. **Monitor slow queries**:
   - Postgres dashboard → Metrics → Slow queries

#### Implement Caching

Buglens uses Redis for caching. Verify cache hit rate:
1. Check Redis metrics in dashboard
2. Increase cache TTL for frequently accessed data
3. Monitor cache eviction rate

---

### Emergency Procedures

#### Rollback to Previous Release

If a deployment causes issues:

1. **Go to** app → **Activity** tab
2. **Find** the last working release (e.g., "Release v42")
3. **Click "Roll back to this release"**
4. **Confirm rollback**
5. **Verify** app works after rollback

<details>
<summary><strong>Alternative: Rollback via CLI</strong></summary>

```bash
# View releases
heroku releases -a buglens-api-prod

# Rollback to previous release
heroku rollback -a buglens-api-prod

# Rollback to specific version
heroku rollback v42 -a buglens-api-prod
```

</details>

#### Enable Maintenance Mode

For emergency maintenance:

1. **Go to** app → **Settings** tab
2. **Scroll to** "Maintenance Mode"
3. **Toggle** "Enable maintenance mode"
4. **Users will see**: "Application Unavailable - We'll be back soon"
5. **Disable** after maintenance complete

<details>
<summary><strong>Alternative: Maintenance Mode via CLI</strong></summary>

```bash
# Enable
heroku maintenance:on -a buglens-api-prod

# Disable
heroku maintenance:off -a buglens-api-prod
```

</details>

#### Contact Heroku Support

For critical issues:

1. **Go to**: https://help.heroku.com
2. **Click** "Submit a ticket"
3. **Select** severity:
   - **Critical**: Production down
   - **High**: Major feature broken
   - **Normal**: General issues
4. **Provide**:
   - App name
   - Error messages
   - Steps to reproduce
   - Recent changes

---

### Getting Help

**Heroku Resources**:
- Dev Center: https://devcenter.heroku.com
- Status Page: https://status.heroku.com
- Community Forums: https://discussion.heroku.com

**Buglens Resources**:
- Documentation: `docs/` folder
- GitHub Issues: Report bugs/issues
- Team Slack: Internal support channel

---

## Cost Estimation

### Student Pack Pricing

| Resource    | Plan        | Cost/Month     |
| ----------- | ----------- | -------------- |
| API Dyno    | Eco         | $5             |
| Worker Dyno | Eco         | $5             |
| PostgreSQL  | Essential-0 | $5             |
| Redis       | Mini        | $3             |
| **Total**   |             | **~$18/month** |

With Student Pack credits ($13/month × 24 months = $312), you get ~17 months free.

### Production Pricing

| Resource    | Plan        | Cost/Month     |
| ----------- | ----------- | -------------- |
| API Dyno    | Standard-1x | $25            |
| Worker Dyno | Standard-1x | $25            |
| PostgreSQL  | Essential-1 | $15            |
| Redis       | Premium-0   | $15            |
| **Total**   |             | **~$80/month** |

---

## Security Checklist

Before going live with production:

- [ ] **Secrets Management**
  - [ ] All secrets stored in Heroku Config Vars (never in code)
  - [ ] Different secrets for staging vs production
  - [ ] JWT_SECRET is 32+ characters random
  - [ ] ENCRYPTION_KEY is 64 characters hex
  - [ ] All webhook secrets are random and strong
  - [ ] Secrets documented in password manager

- [ ] **SSL/TLS**
  - [ ] Custom domain configured (if using)
  - [ ] ACM Status shows "OK" in Domains section
  - [ ] FORCE_HTTPS config var set to `true`
  - [ ] All webhooks use HTTPS URLs

- [ ] **Database Security**
  - [ ] DATABASE_SSL config var set to `true`
  - [ ] Row-level security (RLS) policies enabled in migrations
  - [ ] Automated backups scheduled (daily at minimum)
  - [ ] Backup retention configured (7+ days for production)
  - [ ] Database credentials rotated (if applicable)

- [ ] **Access Control**
  - [ ] Two-factor authentication enabled on Heroku account
  - [ ] Team members have appropriate roles (Admin, Member, Viewer)
  - [ ] API admin token (ADMIN_TOKEN) is 64+ characters
  - [ ] Rate limiting enabled (RATE_LIMIT_ENABLED=true)
  - [ ] CORS configured for production domains only

- [ ] **Monitoring & Alerting**
  - [ ] Logging add-on provisioned (Papertrail or similar)
  - [ ] Error tracking configured (Sentry DSN set)
  - [ ] Uptime monitoring set up (UptimeRobot or similar)
  - [ ] Critical error alerts configured (Slack/email)
  - [ ] Cost alerts enabled (COST_ALERT_THRESHOLD set)

- [ ] **Heroku Account Security**
  - [ ] Heroku account password is strong and unique
  - [ ] Two-factor authentication enabled
  - [ ] Recovery email configured
  - [ ] Heroku API key rotated regularly (quarterly)
  - [ ] GitHub Actions secrets verified

- [ ] **Application Security**
  - [ ] Helmet enabled for security headers (HELMET_ENABLED=true)
  - [ ] Trust proxy enabled (TRUST_PROXY=true)
  - [ ] Input validation on all endpoints
  - [ ] SQL injection prevention (parameterized queries)
  - [ ] XSS prevention (sanitized inputs)
  - [ ] CSRF protection enabled

- [ ] **Compliance**
  - [ ] Privacy policy published
  - [ ] Terms of service published
  - [ ] Data retention policy documented
  - [ ] GDPR compliance verified (if EU users)
  - [ ] Audit logs enabled (via audit_logs table)

---

## Cost Estimation

### Student Pack Deployment (Staging)

**With GitHub Student Developer Pack** ($13/month credit × 24 months):

| Resource              | Plan        | Cost/Month | Notes                          |
| --------------------- | ----------- | ---------- | ------------------------------ |
| API Dyno (Staging)    | Eco         | $5         | Shared, may sleep              |
| Worker Dyno (Staging) | Eco         | $5         | Shared, may sleep              |
| PostgreSQL            | Essential-0 | $5         | 10M rows, 64MB cache           |
| Redis                 | Mini        | $3         | 25MB max memory                |
| **Subtotal**          |             | **$18**    |                                |
| **Student Credit**    |             | **-$13**   | 24 months of $13/month credit  |
| **Your Cost**         |             | **$5/mo**  | After student credit applied   |

**Total Free Period**: ~17-20 months with student credits

---

### Production Deployment (Recommended)

**For production workload (50-1000 RCAs/day)**:

| Resource           | Plan          | Cost/Month | Notes                                |
| ------------------ | ------------- | ---------- | ------------------------------------ |
| API Dyno           | Standard-1X   | $25        | Always-on, 512MB RAM                 |
| Worker Dyno        | Standard-1X   | $25        | Always-on, 512MB RAM                 |
| PostgreSQL         | Essential-1   | $15        | 10M rows, 400MB cache, daily backups |
| Redis              | Premium-0     | $15        | 100MB, high availability             |
| Papertrail (Logs)  | Fixa          | $7         | 100MB/month, 7-day retention         |
| New Relic (APM)    | Wayne (Free)  | $0         | 100GB data/month                     |
| **Total**          |               | **$87/mo** | Production-ready stack               |

**Additional Costs (Variable)**:
- **OpenAI API**: ~$0.10-0.15 per RCA (GPT-4o-mini)
  - 100 RCAs/day = ~$10-15/month
  - 1000 RCAs/day = ~$100-150/month
- **GitHub API**: Free (60 req/hour public, 5000/hour authenticated)
- **Sentry**: Free tier (5K errors/month), then $26/month for Team
- **S3 (optional caching)**: ~$1-5/month depending on usage

**Total Monthly Cost Estimate**:
- **Low volume** (100 RCAs/day): ~$100/month
- **Medium volume** (500 RCAs/day): ~$125/month
- **High volume** (1000 RCAs/day): ~$200/month

---

### Scaling Scenarios

#### Scenario 1: 5000 RCAs/day (Enterprise)

| Resource           | Plan          | Quantity | Cost/Month |
| ------------------ | ------------- | -------- | ---------- |
| API Dyno           | Standard-2X   | 2        | $100       |
| Worker Dyno        | Standard-2X   | 3        | $150       |
| PostgreSQL         | Premium-0     | 1        | $50        |
| Redis              | Premium-2     | 1        | $60        |
| Papertrail         | Volym         | 1        | $25        |
| New Relic          | Starter       | 1        | $99        |
| **Heroku Total**   |               |          | **$484**   |
| **OpenAI Costs**   | 5K RCAs/day   |          | **~$750**  |
| **Monthly Total**  |               |          | **~$1234** |

#### Scenario 2: 10K+ RCAs/day (Consider AWS/GCP)

At this scale, consider migrating to AWS ECS/Fargate or GCP Cloud Run for better cost efficiency.

---

### Cost Optimization Tips

1. **Use Eco Dynos for Staging**: Save $15/month vs Standard
2. **Optimize LLM Usage**:
   - Cache LLM responses in Redis (avoid duplicate analyses)
   - Use deterministic analysis first (only LLM when needed)
   - Set reasonable daily token limits per organization
3. **Right-Size Dynos**:
   - Monitor metrics to avoid over-provisioning
   - Start with Standard-1X, scale up only if needed
4. **Use Free Tiers**:
   - New Relic Wayne plan (free)
   - Papertrail Choklad plan (free 50MB)
   - Sentry free tier (5K errors/month)
5. **Implement 3-Tier Caching**:
   - Redis (hot cache, 1-hour TTL)
   - S3 (warm cache, 7-day TTL) - only ~$1-2/month
   - Reduces GitHub API calls significantly

---

## Quick Reference

### Dashboard Navigation

| Task                          | Path                                                     |
| ----------------------------- | -------------------------------------------------------- |
| View app overview             | Dashboard → [App Name]                                   |
| View/edit config vars         | App → Settings → Config Vars → Reveal Config Vars       |
| View logs                     | App → More → View logs                                   |
| Run one-off command           | App → More → Run console                                 |
| Deploy manually               | App → Deploy → Manual deploy → Deploy Branch            |
| View metrics                  | App → Metrics                                            |
| View activity/releases        | App → Activity                                           |
| Manage add-ons                | App → Resources → Add-ons                                |
| Scale dynos                   | App → Resources → Dynos → Click pencil icon             |
| Restart app                   | App → More → Restart all dynos                           |
| View builds                   | App → Activity → Click on build                          |
| Rollback release              | App → Activity → Click release → Roll back               |
| Add custom domain             | App → Settings → Domains → Add domain                    |
| Enable maintenance mode       | App → Settings → Maintenance Mode → Toggle on            |
| Manage database               | App → Resources → Heroku Postgres → Opens add-on dash    |
| Manage Redis                  | App → Resources → Heroku Data for Redis → Opens add-on  |

### Essential Heroku Concepts

#### Dynos
- **Web Dyno**: Handles HTTP requests (Fastify API)
- **Worker Dyno**: Processes background jobs (BullMQ)
- **One-Off Dyno**: Temporary dyno for commands (e.g., migrations)

**Dyno Types**:
- **Eco**: $5/month (shared, sleeps after inactivity)
- **Basic**: $7/month (always-on, no sleeping)
- **Standard-1X**: $25/month (512MB RAM, production-ready)
- **Standard-2X**: $50/month (1GB RAM, better performance)
- **Performance**: $250-$500/month (dedicated, high-performance)

#### Config Vars
Environment variables accessible via `process.env.VAR_NAME` in your app.

**Auto-set by add-ons**:
- `DATABASE_URL` (Heroku Postgres)
- `REDIS_URL` (Heroku Data for Redis)
- `PORT` (Heroku platform)

#### Add-ons
Third-party services attached to your app (Postgres, Redis, logging, monitoring).

#### Procfile
Defines process types for your app:
```
release: npm run migrate:up
web: node dist/api/server.js
worker: node dist/workers/rca-worker.js
```

#### Buildpacks
Scripts that transform your code into a runnable app. Buglens uses:
1. `heroku/python` (for Python analyzers)
2. `heroku/nodejs` (for Node.js/TypeScript)

---

### Common Commands (Dashboard Equivalents)

| CLI Command                                      | Dashboard Equivalent                                |
| ------------------------------------------------ | --------------------------------------------------- |
| `heroku config -a APP`                           | Settings → Config Vars → Reveal                     |
| `heroku config:set KEY=value -a APP`             | Settings → Config Vars → Add                        |
| `heroku logs --tail -a APP`                      | More → View logs                                    |
| `heroku run COMMAND -a APP`                      | More → Run console → Enter command                  |
| `heroku ps -a APP`                               | Resources → Dynos section                           |
| `heroku ps:restart -a APP`                       | More → Restart all dynos                            |
| `heroku ps:scale web=2 -a APP`                   | Resources → Dynos → Edit dyno count/type            |
| `heroku releases -a APP`                         | Activity tab                                        |
| `heroku rollback -a APP`                         | Activity → Click release → Roll back                |
| `heroku domains:add DOMAIN -a APP`               | Settings → Domains → Add domain                     |
| `heroku maintenance:on -a APP`                   | Settings → Maintenance Mode → Toggle on             |
| `heroku addons:create ADDON -a APP`              | Resources → Add-ons → Search and provision          |
| `heroku pg:info -a APP`                          | Resources → Heroku Postgres → View dashboard        |
| `heroku pg:backups:capture -a APP`               | Postgres add-on → Durability → Create Manual Backup |
| `heroku builds:info -a APP`                      | Activity → Click on build                           |

---

### When to Use CLI vs Dashboard

**Use Dashboard For**:
- ✅ Initial setup and configuration
- ✅ Visual monitoring (metrics, graphs)
- ✅ Quick config changes
- ✅ One-time operations
- ✅ Add-on management
- ✅ Viewing logs visually

**Use CLI For**:
- ✅ Automation/scripting
- ✅ Bulk operations
- ✅ Advanced database operations
- ✅ CI/CD pipelines
- ✅ Debugging (piping logs to grep, etc.)
- ✅ Operations from terminal workflow

**Both Work Equally Well For**:
- Deployments
- Config var management
- Restarting apps
- Viewing logs
- Running migrations

---

## Next Steps

### Immediate Actions (First-Time Setup)

1. **Complete Staging Setup**:
   - [ ] Create 4 Heroku apps (API + Worker for staging/prod)
   - [ ] Add PostgreSQL and Redis to API apps
   - [ ] Share add-ons with worker apps
   - [ ] Connect GitHub repository
   - [ ] Configure all environment variables
   
2. **First Deployment to Staging**:
   - [ ] Set buildpacks (Python + Node.js)
   - [ ] Deploy API and Worker apps
   - [ ] Run database migrations
   - [ ] Verify /health endpoint
   - [ ] Test webhook integration with Sentry

3. **Production Deployment**:
   - [ ] Generate **new** production secrets (different from staging)
   - [ ] Configure production environment variables
   - [ ] Add custom domain (optional but recommended)
   - [ ] Upgrade to Standard dynos
   - [ ] Enable preboot for zero-downtime deploys
   - [ ] Schedule database backups
   - [ ] Deploy and run migrations
   - [ ] Verify production deployment

4. **Post-Deployment**:
   - [ ] Set up monitoring (Papertrail, New Relic)
   - [ ] Configure uptime monitoring (UptimeRobot)
   - [ ] Set up alerts (Slack/email for critical errors)
   - [ ] Configure GitHub Actions for CI/CD
   - [ ] Document runbook for common issues
   - [ ] Schedule regular secret rotation

---

### Learning Resources

**Heroku Official Documentation**:
- Dev Center: https://devcenter.heroku.com
- Node.js Guide: https://devcenter.heroku.com/categories/nodejs-support
- Postgres Guide: https://devcenter.heroku.com/categories/postgres-basics
- Deploying with Git: https://devcenter.heroku.com/articles/git

**Buglens-Specific Docs**:
- Architecture: `docs/Buglens Architecture UPDATED.md`
- LLM Strategy: `docs/buglens llm architecture UPDATED.md`
- Phase 1 Roadmap: `docs/Buglens Roadmap Phase 1 (Week 1-6).md`
- Integration Guide: `docs/INTEGRATION_GUIDE.md`

**Community & Support**:
- Heroku Status: https://status.heroku.com
- Heroku Forums: https://discussion.heroku.com
- Stack Overflow: Tag `heroku`

---

### Troubleshooting Support

**If you encounter issues**:

1. **Check this guide first** - Most common issues are documented above
2. **View logs** - App → More → View logs (90% of issues visible in logs)
3. **Check Heroku Status** - https://status.heroku.com (platform issues)
4. **Search Dev Center** - Comprehensive troubleshooting articles
5. **Contact support** - https://help.heroku.com/tickets/new

**For Buglens-specific issues**:
- Check `docs/DEBUGGING_GUIDE.md`
- Review GitHub Issues
- Contact team via Slack/Discord

---

### Appendix: CLI Quick Reference (Optional)

For developers who prefer terminal workflows, here are common CLI equivalents:

```bash
# Installation
brew install heroku/brew/heroku
heroku login

# App Management
heroku create APP_NAME --region us
heroku apps:info -a APP_NAME
heroku open -a APP_NAME

# Configuration
heroku config -a APP_NAME
heroku config:set KEY=value -a APP_NAME
heroku config:get KEY -a APP_NAME

# Deployment
git push heroku main
heroku releases -a APP_NAME
heroku rollback -a APP_NAME

# Dynos
heroku ps -a APP_NAME
heroku ps:scale web=1:standard-1x -a APP_NAME
heroku ps:restart -a APP_NAME

# Logs & Console
heroku logs --tail -a APP_NAME
heroku run bash -a APP_NAME
heroku run npm run migrate:up -a APP_NAME

# Add-ons
heroku addons -a APP_NAME
heroku addons:create heroku-postgresql:essential-1 -a APP_NAME
heroku addons:open postgres -a APP_NAME

# Database
heroku pg:info -a APP_NAME
heroku pg:psql -a APP_NAME
heroku pg:backups:capture -a APP_NAME
heroku pg:backups:download -a APP_NAME

# Domains
heroku domains:add api.buglens.com -a APP_NAME
heroku certs:auto:enable -a APP_NAME

# Maintenance
heroku maintenance:on -a APP_NAME
heroku maintenance:off -a APP_NAME
```

---

### Version History

- **v2.0** (2026-01-08) - Rewritten for Heroku Dashboard (web interface) deployment
- **v1.0** (2025-12-15) - Initial CLI-based guide

---

**Questions or Issues?** 
- Open an issue in the GitHub repository
- Check `docs/` for additional guides
- Contact the Buglens team

**Happy Deploying! 🚀**
