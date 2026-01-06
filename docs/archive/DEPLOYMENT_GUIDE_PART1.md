# Buglens Deployment Guide - Part 1: Infrastructure & Setup

**Created:** January 5, 2026
**Target:** Staging + Production Environments
**Estimated Setup Time:** 4-6 hours

---

## Table of Contents

1. [Tool Selection & Rationale](#1-tool-selection--rationale)
2. [Domain & SSL Setup](#2-domain--ssl-setup)
3. [DigitalOcean Infrastructure](#3-digitalocean-infrastructure)
4. [Database Setup (PostgreSQL)](#4-database-setup-postgresql)
5. [Redis Setup](#5-redis-setup)
6. [S3-Compatible Storage](#6-s3-compatible-storage)
7. [Environment Configuration](#7-environment-configuration)

---

## 1. Tool Selection & Rationale

### Selected Stack from GitHub Student Pack

| Component                     | Tool                      | Why                                  | Free Value  |
| ----------------------------- | ------------------------- | ------------------------------------ | ----------- |
| **Hosting**                   | DigitalOcean              | $200 credit, managed K8s, simple     | $200/year   |
| **Domain**                    | Name.com                  | Free .dev/.app domain (professional) | ~$15/year   |
| **SSL**                       | Let's Encrypt + Namecheap | Free SSL certificate                 | $10/year    |
| **Error Tracking**            | Sentry                    | Already integrated, 50K errors       | ~$300/year  |
| **Infrastructure Monitoring** | Datadog                   | 10 servers, 2 years free             | ~$600/year  |
| **APM/Observability**         | New Relic                 | $300/month backup option             | $3,600/year |
| **CI/CD**                     | GitHub Actions            | Free with Pro account                | ~$200/year  |
| **Secrets Management**        | Doppler                   | Free Team plan for students          | ~$100/year  |
| **Password Manager**          | 1Password                 | Team secrets + dev tools             | ~$96/year   |

**Total Annual Value: ~$5,000+ in free tools**

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         STAGING ENVIRONMENT                              │
│                      staging.buglens.dev                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │   Vercel    │    │ DigitalOcean│    │ DigitalOcean│                 │
│  │  Frontend   │───▶│  App Platform│───▶│  Managed    │                 │
│  │  (React)    │    │  (Node.js)  │    │  Postgres   │                 │
│  └─────────────┘    └──────┬──────┘    └─────────────┘                 │
│                            │                                             │
│                     ┌──────┴──────┐                                     │
│                     │ DigitalOcean│                                     │
│                     │   Managed   │                                     │
│                     │    Redis    │                                     │
│                     └──────┬──────┘                                     │
│                            │                                             │
│                     ┌──────┴──────┐                                     │
│                     │ DigitalOcean│                                     │
│                     │   Spaces    │                                     │
│                     │  (S3 Cache) │                                     │
│                     └─────────────┘                                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                       MONITORING & OBSERVABILITY                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │   Sentry    │    │   Datadog   │    │  New Relic  │                 │
│  │   Errors    │    │   Metrics   │    │   (Backup)  │                 │
│  │   50K/mo    │    │  10 servers │    │  $300/mo    │                 │
│  └─────────────┘    └─────────────┘    └─────────────┘                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Domain & SSL Setup

### Step 2.1: Claim Your Free Domain (Name.com)

1. **Go to Name.com Student Pack page:**

   ```
   https://www.name.com/partner/github-students
   ```

2. **Connect your GitHub account** and verify student status

3. **Choose your domain** (recommended options):
   - `buglens.dev` - Most professional for developer tools
   - `buglens.app` - Modern, implies application
   - `buglens.software` - Descriptive

4. **Configure DNS (after claiming):**

   ```
   # A Records (will add after DigitalOcean setup)
   @       A       <DIGITALOCEAN_IP>
   staging A       <STAGING_IP>
   api     A       <API_IP>

   # CNAME Records
   www     CNAME   buglens.dev
   ```

### Step 2.2: SSL Certificate Setup

**Option A: Let's Encrypt (Recommended - Free Forever)**

DigitalOcean App Platform includes automatic Let's Encrypt SSL. No action needed.

**Option B: Namecheap Free SSL (Backup)**

1. Go to Namecheap and claim your free SSL certificate
2. Generate CSR on your server:
   ```bash
   openssl req -new -newkey rsa:2048 -nodes \
     -keyout buglens.key \
     -out buglens.csr \
     -subj "/CN=buglens.dev/O=Buglens/C=US"
   ```
3. Submit CSR to Namecheap
4. Complete domain validation (DNS or Email)

---

## 3. DigitalOcean Infrastructure

### Step 3.1: Activate Student Credits

1. **Go to DigitalOcean Student Pack:**

   ```
   https://www.digitalocean.com/github-students
   ```

2. **Connect GitHub account** - You'll receive $200 credit

3. **Verify credit applied:**
   - Go to Billing → Credits
   - Should show "$200.00 available"

### Step 3.2: Create Project Structure

```bash
# In DigitalOcean Console, create:
Project: Buglens
├── Environment: Staging
│   ├── App: buglens-api-staging
│   ├── Database: buglens-db-staging
│   ├── Redis: buglens-redis-staging
│   └── Spaces: buglens-cache-staging
│
└── Environment: Production (later)
    ├── App: buglens-api-prod
    ├── Database: buglens-db-prod
    ├── Redis: buglens-redis-prod
    └── Spaces: buglens-cache-prod
```

### Step 3.3: Deploy Backend with App Platform

1. **Create New App:**
   - Go to Apps → Create App
   - Source: GitHub
   - Repository: `your-username/buglens`
   - Branch: `staging` (create this branch first)

2. **Configure App Spec** (create `.do/app.yaml`):

```yaml
# .do/app.yaml - DigitalOcean App Platform Specification
name: buglens-staging
region: nyc
features:
  - buildpack-stack=ubuntu-22

services:
  # Main API Service
  - name: api
    github:
      repo: your-username/buglens
      branch: staging
      deploy_on_push: true
    dockerfile_path: Dockerfile
    instance_count: 1
    instance_size_slug: professional-xs # $12/mo - 1 vCPU, 1GB RAM
    http_port: 3000

    health_check:
      http_path: /health
      initial_delay_seconds: 30
      period_seconds: 10
      timeout_seconds: 5
      success_threshold: 1
      failure_threshold: 3

    envs:
      - key: NODE_ENV
        value: staging
      - key: PORT
        value: "3000"
      - key: DATABASE_URL
        scope: RUN_TIME
        value: ${buglens-db-staging.DATABASE_URL}
      - key: REDIS_URL
        scope: RUN_TIME
        value: ${buglens-redis-staging.REDIS_URL}
      - key: S3_ENDPOINT
        value: https://nyc3.digitaloceanspaces.com
      - key: S3_BUCKET_NAME
        value: buglens-cache-staging
      - key: SENTRY_DSN
        scope: RUN_TIME
        type: SECRET
      - key: GITHUB_APP_ID
        scope: RUN_TIME
        type: SECRET
      - key: GITHUB_PRIVATE_KEY
        scope: RUN_TIME
        type: SECRET
      - key: OPENAI_API_KEY
        scope: RUN_TIME
        type: SECRET
      - key: SLACK_SIGNING_SECRET
        scope: RUN_TIME
        type: SECRET

  # Background Worker (BullMQ)
  - name: worker
    github:
      repo: your-username/buglens
      branch: staging
      deploy_on_push: true
    dockerfile_path: Dockerfile.worker
    instance_count: 1
    instance_size_slug: professional-xs

    envs:
      - key: NODE_ENV
        value: staging
      - key: WORKER_MODE
        value: "true"
      - key: DATABASE_URL
        scope: RUN_TIME
        value: ${buglens-db-staging.DATABASE_URL}
      - key: REDIS_URL
        scope: RUN_TIME
        value: ${buglens-redis-staging.REDIS_URL}

databases:
  - name: buglens-db-staging
    engine: PG
    version: "15"
    size: db-s-1vcpu-1gb # $15/mo
    num_nodes: 1

  - name: buglens-redis-staging
    engine: REDIS
    version: "7"
    size: db-s-1vcpu-1gb # $15/mo
    num_nodes: 1
```

3. **Create Dockerfile** (if not exists):

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Production image
FROM node:20-alpine AS runner

WORKDIR /app

# Install Python for analyzers
RUN apk add --no-cache python3 py3-pip
COPY python/requirements.txt ./python/
RUN pip3 install --no-cache-dir -r python/requirements.txt

# Copy built app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY python ./python

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

4. **Create Worker Dockerfile:**

```dockerfile
# Dockerfile.worker
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

# Install Python
RUN apk add --no-cache python3 py3-pip
COPY python/requirements.txt ./python/
RUN pip3 install --no-cache-dir -r python/requirements.txt

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY python ./python

CMD ["node", "dist/workers/rca-worker.js"]
```

### Step 3.4: Estimated Monthly Costs (Staging)

| Resource              | Size            | Monthly Cost  |
| --------------------- | --------------- | ------------- |
| App Platform (API)    | professional-xs | $12           |
| App Platform (Worker) | professional-xs | $12           |
| Managed PostgreSQL    | db-s-1vcpu-1gb  | $15           |
| Managed Redis         | db-s-1vcpu-1gb  | $15           |
| Spaces (25GB)         | -               | $5            |
| **Total**             |                 | **$59/month** |

**With $200 credit: ~3.4 months free!**

---

## 4. Database Setup (PostgreSQL)

### Step 4.1: Create Managed Database

1. **In DigitalOcean Console:**
   - Databases → Create Database Cluster
   - Engine: PostgreSQL 15
   - Size: 1 vCPU, 1GB RAM, 10GB SSD ($15/mo)
   - Datacenter: NYC1 (same as app)
   - Name: `buglens-db-staging`

2. **Configure Connection Pooling:**
   - Enable PgBouncer (built-in)
   - Pool Mode: Transaction
   - Pool Size: 22 (default)

3. **Security Settings:**
   - Enable SSL Required
   - Restrict trusted sources to App Platform only

### Step 4.2: Run Migrations

```bash
# Get connection string from DigitalOcean Console
export DATABASE_URL="postgresql://doadmin:password@db-postgresql-nyc1-xxxxx.ondigitalocean.com:25060/defaultdb?sslmode=require"

# Run migrations
npm run migrate

# Verify tables created
psql $DATABASE_URL -c "\dt"
```

### Step 4.3: Database Backup Configuration

DigitalOcean Managed Databases include:

- ✅ Daily automatic backups (7-day retention)
- ✅ Point-in-time recovery
- ✅ Automatic failover (on higher tiers)

**For staging:** Default settings are sufficient.

**For production (later):** Upgrade to 2-node cluster for high availability.

---

## 5. Redis Setup

### Step 5.1: Create Managed Redis

1. **In DigitalOcean Console:**
   - Databases → Create Database Cluster
   - Engine: Redis 7
   - Size: 1 vCPU, 1GB RAM ($15/mo)
   - Datacenter: NYC1
   - Name: `buglens-redis-staging`

2. **Configure Eviction Policy:**

   ```
   Eviction Policy: allkeys-lru
   Max Memory: 1GB
   ```

3. **Get Connection Details:**
   ```bash
   # Format: rediss://default:password@host:port
   REDIS_URL="rediss://default:xxxxx@redis-xxxxx.ondigitalocean.com:25061"
   ```

### Step 5.2: Verify Redis Connection

```bash
# Install redis-cli locally
brew install redis  # macOS

# Test connection (with TLS)
redis-cli -u $REDIS_URL --tls ping
# Should return: PONG
```

### Step 5.3: BullMQ Configuration

Update your worker configuration for managed Redis:

```typescript
// src/workers/config.ts
import { QueueOptions } from "bullmq";

export const redisConnection: QueueOptions["connection"] = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || "25061"),
  password: process.env.REDIS_PASSWORD,
  tls: {
    rejectUnauthorized: true, // Require valid SSL
  },
  maxRetriesPerRequest: null, // Required for BullMQ
};
```

---

## 6. S3-Compatible Storage (DigitalOcean Spaces)

### Step 6.1: Create Space (S3-Compatible Bucket)

1. **In DigitalOcean Console:**
   - Spaces → Create Space
   - Datacenter: NYC3
   - Name: `buglens-cache-staging`
   - File Listing: Restricted (private)

2. **Create Access Keys:**
   - API → Spaces Keys → Generate New Key
   - Name: `buglens-staging-access`
   - Save both Access Key and Secret Key

### Step 6.2: Configure S3 Client

Update your cache service for DigitalOcean Spaces:

```typescript
// src/services/cache.ts - Update S3 client configuration

import { S3Client } from "@aws-sdk/client-s3";

const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT || "https://nyc3.digitaloceanspaces.com",
  region: "nyc3", // DigitalOcean uses region format
  credentials: {
    accessKeyId: process.env.SPACES_ACCESS_KEY!,
    secretAccessKey: process.env.SPACES_SECRET_KEY!,
  },
  forcePathStyle: false, // Use virtual-hosted style
});

// Bucket name
const BUCKET_NAME = process.env.S3_BUCKET_NAME || "buglens-cache-staging";
```

### Step 6.3: Set Lifecycle Policy (7-day TTL)

```bash
# Create lifecycle policy file
cat > lifecycle.json << 'EOF'
{
  "Rules": [
    {
      "ID": "ExpireCodeCache",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "code/"
      },
      "Expiration": {
        "Days": 7
      }
    }
  ]
}
EOF

# Apply using s3cmd or AWS CLI configured for Spaces
s3cmd setlifecycle lifecycle.json s3://buglens-cache-staging
```

### Step 6.4: CORS Configuration (if needed for direct uploads)

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://staging.buglens.dev"],
      "AllowedMethods": ["GET", "PUT"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

---

## 7. Environment Configuration

### Step 7.1: Setup Doppler for Secrets Management

1. **Claim Doppler Student Access:**

   ```
   https://www.doppler.com/github-students
   ```

2. **Create Project Structure:**

   ```
   Project: buglens
   ├── Environment: staging
   │   └── Config: staging
   └── Environment: production
       └── Config: production
   ```

3. **Add Secrets to Doppler:**

   ```bash
   # Install Doppler CLI
   brew install dopplerhq/cli/doppler

   # Login
   doppler login

   # Setup project
   doppler setup --project buglens --config staging

   # Add secrets
   doppler secrets set DATABASE_URL="postgresql://..."
   doppler secrets set REDIS_URL="rediss://..."
   doppler secrets set GITHUB_APP_ID="123456"
   doppler secrets set GITHUB_PRIVATE_KEY="-----BEGIN RSA..."
   doppler secrets set GITHUB_WEBHOOK_SECRET="whsec_..."
   doppler secrets set OPENAI_API_KEY="sk-..."
   doppler secrets set SENTRY_DSN="https://...@sentry.io/..."
   doppler secrets set SLACK_SIGNING_SECRET="..."
   doppler secrets set SLACK_BOT_TOKEN="xoxb-..."
   doppler secrets set SPACES_ACCESS_KEY="DO..."
   doppler secrets set SPACES_SECRET_KEY="..."
   doppler secrets set JWT_SECRET="..."
   doppler secrets set ENCRYPTION_KEY="..."
   ```

4. **Sync to DigitalOcean:**
   ```bash
   # Export secrets for DigitalOcean
   doppler secrets download --no-file --format env-no-quotes > .env.staging
   ```

### Step 7.2: Complete Environment Variables

Create a reference file for all required variables:

```bash
# .env.example - Complete list for Buglens

# ============================================
# Core Application
# ============================================
NODE_ENV=staging
PORT=3000
LOG_LEVEL=info

# ============================================
# Database (DigitalOcean Managed PostgreSQL)
# ============================================
DATABASE_URL=postgresql://doadmin:PASSWORD@HOST:25060/defaultdb?sslmode=require

# ============================================
# Redis (DigitalOcean Managed Redis)
# ============================================
REDIS_URL=rediss://default:PASSWORD@HOST:25061
REDIS_HOST=redis-xxxxx.ondigitalocean.com
REDIS_PORT=25061
REDIS_PASSWORD=xxxxx

# ============================================
# S3 Cache (DigitalOcean Spaces)
# ============================================
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_BUCKET_NAME=buglens-cache-staging
SPACES_ACCESS_KEY=DOxxxxxxxxx
SPACES_SECRET_KEY=xxxxxxxxxxxxx

# ============================================
# GitHub Integration
# ============================================
GITHUB_APP_ID=123456
GITHUB_APP_NAME=buglens-staging
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=whsec_xxxxxxxx
GITHUB_CLIENT_ID=Iv1.xxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxx

# ============================================
# OpenAI (LLM)
# ============================================
OPENAI_API_KEY=sk-proj-xxxxxxxx
OPENAI_MODEL=gpt-4o-mini

# ============================================
# Sentry (Error Tracking)
# ============================================
SENTRY_DSN=https://xxxxx@o123456.ingest.sentry.io/789
SENTRY_ENVIRONMENT=staging

# ============================================
# Slack Integration
# ============================================
SLACK_SIGNING_SECRET=xxxxxxxx
SLACK_BOT_TOKEN=xoxb-xxxxx-xxxxx-xxxxx
SLACK_APP_ID=A0XXXXXXX

# ============================================
# Authentication
# ============================================
JWT_SECRET=super-secret-jwt-key-min-32-chars
JWT_EXPIRES_IN=7d
ENCRYPTION_KEY=32-byte-hex-key-for-token-encryption

# ============================================
# Rate Limiting
# ============================================
RATE_LIMIT_FREE_EVENTS_PER_DAY=100
RATE_LIMIT_PRO_EVENTS_PER_DAY=10000
RATE_LIMIT_FREE_LLM_TOKENS_PER_DAY=50000
RATE_LIMIT_PRO_LLM_TOKENS_PER_DAY=500000

# ============================================
# Feature Flags
# ============================================
FEATURE_LLM_ENABLED=true
FEATURE_SLACK_ENABLED=true
FEATURE_SOURCE_MAPS_ENABLED=true

# ============================================
# Monitoring
# ============================================
DATADOG_API_KEY=xxxxxxxxxxxxx
DATADOG_APP_KEY=xxxxxxxxxxxxx
```

### Step 7.3: Validation Script

Create a startup validation script:

```typescript
// src/utils/validate-env.ts
import { z } from "zod";

const envSchema = z.object({
  // Required
  NODE_ENV: z.enum(["development", "staging", "production"]),
  PORT: z.string().transform(Number),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),

  // GitHub (required for core functionality)
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_PRIVATE_KEY: z.string().includes("BEGIN"),
  GITHUB_WEBHOOK_SECRET: z.string().min(10),

  // OpenAI (required for LLM features)
  OPENAI_API_KEY: z.string().startsWith("sk-"),

  // Optional with defaults
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  S3_BUCKET_NAME: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
});

export function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.format());
    process.exit(1);
  }

  console.log("✅ Environment variables validated");
  return result.data;
}
```

---

## Next Steps

Continue to **[Part 2: CI/CD, Monitoring & Production](DEPLOYMENT_GUIDE_PART2.md)** for:

- GitHub Actions CI/CD pipeline
- Sentry error tracking setup
- Datadog infrastructure monitoring
- Production deployment checklist
- Security hardening
- Performance optimization
- Disaster recovery plan

---

## Quick Reference: Monthly Costs

### Staging Environment (~$59/month)

| Service        | Provider                  | Cost    |
| -------------- | ------------------------- | ------- |
| API Server     | DigitalOcean App Platform | $12     |
| Worker Server  | DigitalOcean App Platform | $12     |
| PostgreSQL     | DigitalOcean Managed      | $15     |
| Redis          | DigitalOcean Managed      | $15     |
| Spaces (25GB)  | DigitalOcean              | $5      |
| Domain         | Name.com                  | FREE    |
| SSL            | Let's Encrypt             | FREE    |
| Error Tracking | Sentry                    | FREE    |
| Monitoring     | Datadog                   | FREE    |
| Secrets        | Doppler                   | FREE    |
| **Total**      |                           | **$59** |

**With $200 DigitalOcean credit: First 3.4 months FREE!**

### Production Environment (Estimate ~$150/month)

| Service            | Provider                  | Cost      |
| ------------------ | ------------------------- | --------- |
| API Server (2x)    | DigitalOcean App Platform | $24       |
| Worker Server (2x) | DigitalOcean App Platform | $24       |
| PostgreSQL (HA)    | DigitalOcean Managed      | $45       |
| Redis (HA)         | DigitalOcean Managed      | $30       |
| Spaces (100GB)     | DigitalOcean              | $5        |
| CDN                | Cloudflare                | FREE      |
| **Total**          |                           | **~$128** |

---

**Document Version:** 1.0
**Last Updated:** January 5, 2026
**Author:** Buglens Engineering
