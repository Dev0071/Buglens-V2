# Buglens Heroku Deployment Guide

Complete guide for deploying Buglens to Heroku with staging and production environments.

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

### Required Tools

```bash
# Install Heroku CLI
brew install heroku/brew/heroku

# Login to Heroku
heroku login

# Verify installation
heroku --version
```

### Required Accounts

- Heroku account with Student Pack ($13/month credit) or paid plan
- GitHub repository with the Buglens codebase
- Sentry account for error tracking
- AWS account for S3 and CloudWatch (optional, can use Heroku alternatives)

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

### 1. Create Heroku Apps

```bash
# Staging apps
heroku create buglens-api-staging --region us
heroku create buglens-worker-staging --region us

# Production apps
heroku create buglens-api-prod --region us
heroku create buglens-worker-prod --region us
```

### 2. Add PostgreSQL

```bash
# Staging (mini plan for development)
heroku addons:create heroku-postgresql:essential-0 -a buglens-api-staging

# Production (standard plan for reliability)
heroku addons:create heroku-postgresql:essential-1 -a buglens-api-prod
```

### 3. Add Redis (Key-Value Store)

```bash
# Staging
heroku addons:create heroku-redis:mini -a buglens-api-staging

# Production
heroku addons:create heroku-redis:premium-0 -a buglens-api-prod
```

### 4. Share Add-ons with Worker

```bash
# Share Postgres and Redis with worker apps
# Staging
heroku addons:attach buglens-api-staging::DATABASE -a buglens-worker-staging
heroku addons:attach buglens-api-staging::REDIS -a buglens-worker-staging

# Production
heroku addons:attach buglens-api-prod::DATABASE -a buglens-worker-prod
heroku addons:attach buglens-api-prod::REDIS -a buglens-worker-prod
```

### 5. Configure Git Remotes

```bash
# Add Heroku remotes
git remote add staging-api https://git.heroku.com/buglens-api-staging.git
git remote add staging-worker https://git.heroku.com/buglens-worker-staging.git
git remote add prod-api https://git.heroku.com/buglens-api-prod.git
git remote add prod-worker https://git.heroku.com/buglens-worker-prod.git
```

---

## Staging Deployment

### 1. Set Environment Variables

```bash
# Core settings
heroku config:set NODE_ENV=staging -a buglens-api-staging
heroku config:set APP_BASE_URL=https://buglens-api-staging.herokuapp.com -a buglens-api-staging

# Authentication
heroku config:set JWT_SECRET=$(openssl rand -base64 32) -a buglens-api-staging
heroku config:set ENCRYPTION_KEY=$(openssl rand -hex 32) -a buglens-api-staging

# GitHub App
heroku config:set GITHUB_APP_ID=your_app_id -a buglens-api-staging
heroku config:set GITHUB_APP_PRIVATE_KEY="$(cat github-app-private-key.pem)" -a buglens-api-staging
heroku config:set GITHUB_APP_WEBHOOK_SECRET=your_webhook_secret -a buglens-api-staging

# Sentry
heroku config:set SENTRY_DSN=https://your-sentry-dsn -a buglens-api-staging
heroku config:set SENTRY_WEBHOOK_SECRET=your_sentry_webhook_secret -a buglens-api-staging

# OpenAI (for LLM analysis)
heroku config:set OPENAI_API_KEY=sk-your-api-key -a buglens-api-staging

# Copy to worker app
heroku config:set NODE_ENV=staging -a buglens-worker-staging
heroku config:set WORKER_MODE=true -a buglens-worker-staging
heroku config:set GITHUB_APP_ID=your_app_id -a buglens-worker-staging
heroku config:set GITHUB_APP_PRIVATE_KEY="$(cat github-app-private-key.pem)" -a buglens-worker-staging
heroku config:set OPENAI_API_KEY=sk-your-api-key -a buglens-worker-staging
```

### 2. Deploy to Staging

```bash
# Deploy API
git push staging-api main

# Deploy Worker (uses separate Dockerfile)
# First, configure the buildpack
heroku buildpacks:set heroku/nodejs -a buglens-api-staging
heroku buildpacks:add --index 1 heroku/python -a buglens-api-staging

# Or use container deployment
heroku stack:set container -a buglens-api-staging
heroku stack:set container -a buglens-worker-staging
git push staging-api main
git push staging-worker main
```

### 3. Run Migrations

```bash
# Run migrations on staging
heroku run npm run migrate:up -a buglens-api-staging
```

### 4. Verify Deployment

```bash
# Check API health
curl https://buglens-api-staging.herokuapp.com/health

# Check logs
heroku logs --tail -a buglens-api-staging
heroku logs --tail -a buglens-worker-staging
```

---

## Production Deployment

### 1. Set Production Environment Variables

```bash
# Core settings
heroku config:set NODE_ENV=production -a buglens-api-prod
heroku config:set APP_BASE_URL=https://api.buglens.com -a buglens-api-prod

# Use different secrets for production!
heroku config:set JWT_SECRET=$(openssl rand -base64 32) -a buglens-api-prod
heroku config:set ENCRYPTION_KEY=$(openssl rand -hex 32) -a buglens-api-prod

# GitHub App (can use same app or separate prod app)
heroku config:set GITHUB_APP_ID=your_prod_app_id -a buglens-api-prod
heroku config:set GITHUB_APP_PRIVATE_KEY="$(cat github-app-private-key-prod.pem)" -a buglens-api-prod
heroku config:set GITHUB_APP_WEBHOOK_SECRET=your_prod_webhook_secret -a buglens-api-prod

# Sentry (production DSN)
heroku config:set SENTRY_DSN=https://your-prod-sentry-dsn -a buglens-api-prod

# OpenAI
heroku config:set OPENAI_API_KEY=sk-your-prod-api-key -a buglens-api-prod

# Copy to worker
heroku config:set NODE_ENV=production -a buglens-worker-prod
heroku config:set WORKER_MODE=true -a buglens-worker-prod
# ... (same variables as API)
```

### 2. Custom Domain Setup

```bash
# Add custom domain
heroku domains:add api.buglens.com -a buglens-api-prod

# Get DNS target
heroku domains:info api.buglens.com -a buglens-api-prod

# Configure your DNS provider (e.g., Namecheap):
# CNAME: api -> your-app.herokudns.com
```

### 3. Enable SSL

```bash
# Heroku provides automatic SSL for paid dynos
# For custom domains, SSL is included with ACM
heroku certs:auto:enable -a buglens-api-prod
```

### 4. Scale Dynos

```bash
# Production scaling
heroku ps:scale web=1:standard-1x -a buglens-api-prod
heroku ps:scale worker=1:standard-1x -a buglens-worker-prod

# Check dyno status
heroku ps -a buglens-api-prod
```

---

## CI/CD with GitHub Actions

### Automatic Deployment Workflow

The repository includes GitHub Actions workflows for:

1. **Test** (`.github/workflows/test.yml`) - Runs on all PRs and pushes
2. **Deploy Staging** (`.github/workflows/deploy-staging.yml`) - Deploys on push to `staging` branch
3. **Deploy Production** (`.github/workflows/deploy-production.yml`) - Deploys on push to `main` with approval

### Required GitHub Secrets

Configure these in your repository Settings → Secrets:

```
HEROKU_API_KEY          # heroku authorizations:create
HEROKU_EMAIL            # Your Heroku account email
HEROKU_APP_STAGING_API  # buglens-api-staging
HEROKU_APP_STAGING_WORKER # buglens-worker-staging
HEROKU_APP_PROD_API     # buglens-api-prod
HEROKU_APP_PROD_WORKER  # buglens-worker-prod
```

### Get Heroku API Key

```bash
heroku authorizations:create --description "GitHub Actions"
# Copy the Token value
```

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

### Running Migrations

```bash
# Run pending migrations
heroku run npm run migrate:up -a buglens-api-prod

# Rollback last migration
heroku run npm run migrate:down -a buglens-api-prod

# Check migration status
heroku run npm run migrate:status -a buglens-api-prod
```

### Automatic Migrations (Release Phase)

Add to `Procfile`:

```procfile
release: npm run migrate:up
web: node dist/api/server.js
worker: node dist/workers/rca-worker.js
```

This runs migrations automatically before each deployment.

### Backup Database

```bash
# Create backup
heroku pg:backups:capture -a buglens-api-prod

# Download backup
heroku pg:backups:download -a buglens-api-prod

# Schedule automatic backups
heroku pg:backups:schedule DATABASE_URL --at '02:00 UTC' -a buglens-api-prod
```

---

## Monitoring & Logging

### View Logs

```bash
# Tail logs
heroku logs --tail -a buglens-api-prod

# Filter by process
heroku logs --tail --ps web -a buglens-api-prod
heroku logs --tail --ps worker -a buglens-worker-prod

# Filter by source
heroku logs --source app -a buglens-api-prod
```

### Metrics Dashboard

```bash
# Open Heroku Dashboard
heroku open -a buglens-api-prod

# View metrics
heroku metrics -a buglens-api-prod
```

### Add Logging Add-on (Optional)

```bash
# Add Papertrail for log aggregation
heroku addons:create papertrail:choklad -a buglens-api-prod
```

### Health Check Endpoint

The API exposes a health check at `/health`:

```bash
curl https://api.buglens.com/health
# Response: {"status":"ok","database":"connected","redis":"connected","timestamp":"..."}
```

---

## Troubleshooting

### Common Issues

#### 1. Build Fails

```bash
# Check build logs
heroku builds:info -a buglens-api-prod

# Clear build cache
heroku builds:cache:purge -a buglens-api-prod
```

#### 2. App Crashes on Start

```bash
# Check recent logs
heroku logs --tail -a buglens-api-prod

# Common causes:
# - Missing environment variables
# - Database connection issues
# - Port binding (must use process.env.PORT)
```

#### 3. Database Connection Issues

```bash
# Check database status
heroku pg:info -a buglens-api-prod

# Check connection count
heroku pg:connection-pooling -a buglens-api-prod

# Restart database
heroku pg:restart -a buglens-api-prod
```

#### 4. Redis Connection Issues

```bash
# Check Redis status
heroku redis:info -a buglens-api-prod

# Check Redis memory
heroku redis:maxmemory -a buglens-api-prod
```

#### 5. Worker Not Processing Jobs

```bash
# Check worker logs
heroku logs --tail -a buglens-worker-prod

# Restart worker
heroku ps:restart worker -a buglens-worker-prod

# Check Redis for queue info
heroku redis:cli -a buglens-api-prod
> KEYS bull:*
```

### Performance Optimization

```bash
# Enable preboot (zero-downtime deploys)
heroku features:enable preboot -a buglens-api-prod

# Scale dyno size if needed
heroku ps:resize web=standard-2x -a buglens-api-prod
```

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

- [ ] All secrets stored in Heroku config vars (not in code)
- [ ] Different secrets for staging vs production
- [ ] SSL enabled (automatic with ACM)
- [ ] Database backups configured
- [ ] Two-factor authentication on Heroku account
- [ ] GitHub webhook secrets configured
- [ ] Rate limiting enabled in API
- [ ] CORS configured for production domains only

---

## Quick Reference Commands

```bash
# Deploy
git push heroku main

# Logs
heroku logs --tail -a APP_NAME

# Console
heroku run bash -a APP_NAME

# Restart
heroku restart -a APP_NAME

# Scale
heroku ps:scale web=2 worker=1 -a APP_NAME

# Config
heroku config -a APP_NAME
heroku config:set KEY=value -a APP_NAME

# Database
heroku pg:info -a APP_NAME
heroku pg:psql -a APP_NAME

# Migrations
heroku run npm run migrate:up -a APP_NAME
```

---

## Next Steps

1. Complete initial setup with staging apps
2. Configure all environment variables
3. Run first deployment to staging
4. Test webhook integration with Sentry
5. Promote to production after validation
6. Set up custom domain and SSL
7. Configure monitoring alerts
