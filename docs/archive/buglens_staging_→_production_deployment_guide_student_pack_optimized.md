# Buglens Staging → Production Deployment Guide (Student Pack Optimized)

You want **staging first**, then **prod** once stable. You also want this to be **secure**, **fast**, and **cheap** using the GitHub Student Pack offers.

This guide picks a **default path** (fastest to ship) and an **upgrade path** (more control later).

---

## 1) Pick a deployment strategy (don’t overthink this)

### Option A (recommended for March 1): **Heroku-first**
**Why:** fastest staging+prod, great for multi-process apps (API + worker), easy Postgres + Redis, decent security defaults.
You have student credits: **$13/month for 24 months** citeturn0search0turn0search4.

**When to switch off:** once you need lower infra cost per event, more knobs, or multi-region.

### Option B (upgrade path): **DigitalOcean App Platform + Managed DB/Redis + Spaces**
**Why:** predictable pricing, more control, still easy. Student credit **$200 for 1 year** citeturn0search2.

### Option C (not recommended for now): AWS just for CloudWatch free tier
CloudWatch free tier exists, but AWS adds complexity (IAM, networking, NAT, VPC, etc.). The free tier details are real citeturn0search1 but **it’s not worth the overhead for v1**.

---

## 2) What Buglens needs in production (minimum viable infra)

Buglens isn’t “one web app.” It’s a **pipeline**:

1) **API/Webhook receiver** (Fastify)
2) **Queue + worker(s)** (BullMQ)
3) **Postgres** (events/jobs/results/sessions)
4) **Redis** (BullMQ)
5) **Object storage** (evidence bundles, code snapshots)
6) **Monitoring + alerting**
7) **Domain + TLS**

Staging and prod must be isolated:
- separate apps
- separate DBs
- separate Redis
- separate object storage buckets
- separate secrets

---

## 3) Recommended tool selection from your offers

### Core hosting (choose one)
**Heroku (default)**
- Web: Heroku dynos
- Worker: Heroku dynos
- Postgres: Heroku Postgres
- Redis: Heroku Key-Value Store

**DigitalOcean (upgrade)**
- App Platform: Web + Worker
- Managed Postgres
- Managed Redis
- Spaces (S3-compatible)

### Domain & TLS
- **Namecheap .me domain + free SSL for 1 year** citeturn0search3turn0search9
(Alternatively Name.com offers free domains; either works.)

### Monitoring / Error tracking
- **Sentry**: app errors + traces (you already depend on it)
- Basic platform logs/metrics (Heroku metrics or DO metrics)

Optional later:
- OpenTelemetry collector + centralized traces/logs
- Datadog/New Relic if you want full observability (but don’t add this before you ship the product)

---

## 4) The clean environment design (staging first)

### Environments
- **staging.buglens.me**  (or buglens-staging.<yourdomain>)
- **app.buglens.me** (prod)

### Apps (Heroku naming example)
- `buglens-api-staging`
- `buglens-worker-staging`
- `buglens-api-prod`
- `buglens-worker-prod`

### Datastores
- `buglens-staging-postgres`
- `buglens-prod-postgres`
- `buglens-staging-redis`
- `buglens-prod-redis`

### Object storage (S3-compatible)
- `buglens-staging-evidence`
- `buglens-prod-evidence`

---

## 5) Heroku-first: step-by-step (staging)

### 5.1 Create the Heroku apps
1) Create Heroku app: `buglens-api-staging`
2) Create Heroku app: `buglens-worker-staging`

### 5.2 Add Postgres + Redis
- Attach **Heroku Postgres** to `buglens-api-staging`
- Attach **Heroku Redis / Key-Value Store** to both apps (or share one Redis instance)

### 5.3 Configure process types
Use a Procfile (or app settings) like:
- `web`: `node dist/server.js` (or your start command)
- `worker`: `node dist/worker.js`

### 5.4 Secrets / config vars (staging)
**Minimum required categories**:

**App:**
- `NODE_ENV=staging`
- `APP_BASE_URL=https://staging.buglens.me`

**DB/Queue:**
- `DATABASE_URL` (Heroku sets)
- `REDIS_URL` (Heroku sets)

**Auth + Integrations:**
- `SENTRY_WEBHOOK_SECRET` (if using signed webhooks)
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_WEBHOOK_SECRET`

**Storage:**
- `EVIDENCE_BUCKET` (or equivalent)
- `S3_ENDPOINT/S3_REGION/S3_ACCESS_KEY/S3_SECRET_KEY` (if using S3/Spaces)

**Security defaults:**
- `JWT_SECRET`
- `ENCRYPTION_KEY` (32 bytes)

### 5.5 Migrations
- On deploy: run migrations as a release step.
- Keep migrations idempotent.

### 5.6 CI/CD (GitHub Actions)
- Trigger on merge to `main` → deploy to staging.
- Later: tag or promote build → prod.

Minimum protections:
- branch protection: required checks + reviews
- do not deploy from feature branches

---

## 6) Move staging → prod (when stable)

### Promotion rules (non-negotiable)
- Staging has processed **realistic traffic** (or replayed events) without crashes
- Worker queues don’t backlog
- RCA jobs complete within your SLA
- Audit logs exist for failures

### Prod setup
Repeat the same structure with prod apps + prod DB/Redis + prod buckets.

**Important:** never reuse staging credentials in prod.

---

## 7) DigitalOcean upgrade path (when you want more control)

### DO layout
- App Platform service: `api`
- App Platform service: `worker`
- Managed Postgres
- Managed Redis
- Spaces bucket (evidence)

You’ll burn $200 credit slower than you think if you keep it simple. citeturn0search2

---

## 8) Monitoring that actually matters for Buglens

### You must monitor these or you’ll get paged by your own product

**Pipeline health (core):**
- webhook receive rate
- dedupe/drop rate
- queue depth (BullMQ)
- worker success/failure counts
- job latency p50/p95

**Data health:**
- Postgres slow queries
- Postgres connection pool saturation
- Redis memory + eviction

**Cost controls (AI):**
- tokens per job
- cost per investigation session
- % jobs that use LLM vs deterministic-only

**User trust signals:**
- % investigations with resolved source map
- % investigations with repo mapping success
- feedback ratings distribution

Sentry should alert on:
- API 5xx spike
- worker crash loops
- queue “stuck” conditions

---

## 9) Security checklist (do this now, not later)

### Repo access / GitHub App
- Use a **GitHub App** (not personal tokens)
- Least privilege:
  - read-only repo contents
  - read commits
  - optionally: checks read
- Per-org install tokens only

### Data handling
- Encrypt secrets at rest
- Separate staging/prod buckets
- Don’t store raw source files forever (retention)

### Webhooks
- Verify signatures (you already do)
- Rate limit by org_id
- Store raw payloads but cap size

### Production hygiene
- 2FA everywhere
- Rotate keys
- Audit log access

---

## 10) What to do this week (tight plan)

### Day 1–2: Staging baseline
- Heroku staging apps + Postgres + Redis
- Deploy API + worker
- Verify: webhook → DB insert → job enqueue → worker picks up

### Day 3–4: Evidence + storage
- Add S3/Spaces bucket for evidence bundles
- Confirm: evidence package stored + URL recorded

### Day 5–6: Monitoring + alerting
- Add Sentry alerts
- Add queue depth + job latency metrics

### Day 7: Domain + TLS
- Register domain on Namecheap (.me) citeturn0search3turn0search9
- Point `staging` subdomain to staging app

---

## 11) Quick “preferred defaults” (my picks)

If you want to ship and not get stuck:

- **Heroku** for staging + early prod citeturn0search0
- **Namecheap** for domain + SSL citeturn0search3turn0search9
- **Sentry** for runtime errors (already your core data source)
- **Postgres + Redis** managed
- Add DO later for cost control citeturn0search2

---

## 12) One hard truth

The thing that will kill your rollout isn’t hosting.

It’s **trust + data access**:
- repo mapping failures
- sourcemap resolution
- incomplete evidence

So your staging success criteria should be:

**“Can Buglens reliably reconstruct source context from real errors and present a believable investigation?”**

Not “is it deployed.”

