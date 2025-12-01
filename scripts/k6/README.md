# k6 Load Tests

This directory contains performance scenarios for validating Buglens rate limits under sustained load. The current focus is the Sentry webhook ingestion path, ensuring Redis-backed counters throttle requests correctly.

## Sentry Rate Limit Scenario

Script: `sentry-rate-limit-test.js`

### Requirements

- Running API server (`npm run dev` or deployed endpoint)
- Corresponding PostgreSQL and Redis services (see root `docker-compose.yml`)
- Valid organization seeded in the database with known `org_id`
- `SENTRY_WEBHOOK_SECRET` matching the server configuration
- `k6` installed (via Homebrew: `brew install k6`)

### Setup

```bash
# Start dependencies
docker-compose up -d postgres redis

# Apply migrations
npm run migrate:up

# Seed test organization
psql "$DATABASE_URL" -c "INSERT INTO organizations (id, name, slug, plan) VALUES ('00000000-0000-0000-0000-000000000000', 'K6 Test Org', 'k6-test-org', 'free') ON CONFLICT DO NOTHING;"

# Start server with webhook secret
SENTRY_WEBHOOK_SECRET="test-sentry-secret" npm run dev
```

### Usage

```bash
export ORG_ID="00000000-0000-0000-0000-000000000000"
export SENTRY_WEBHOOK_SECRET="test-sentry-secret"
export BASE_URL="http://localhost:3000"
export K6_VUS=10
export K6_DURATION="30s"

k6 run scripts/k6/sentry-rate-limit-test.js
```

The script exercises the `/api/v1/webhooks/sentry/:org_id` endpoint with signed payloads. It records the rate of `429` responses via the `sentry_rate_limit_hits` counter and enforces thresholds:

- <1% unexpected failure rate (only 200/429 are expected)
- P95 latency < 500ms
- Rate limit counter tracks throttled requests

### Validated Baseline (5 VUs, 3s)

```
✓ status 200 or 429: 145/145 (100%)
✓ unexpected_failures: 0%
✓ http_req_duration p(95): 3.9ms
✓ sentry_rate_limit_hits: 145 (all rate limited after quota exhaustion)
✓ http_reqs: ~48 req/s
```

### Results Interpretation

- **429 Rate**: Confirms quotas enforced once the plan limit is exhausted.
- **Latency Thresholds**: Ensures rate limit checks remain performant under load.
- **Failure Rate**: Unexpected non-200/429 responses fail the run.

### Tuning

- Increase `K6_VUS` / `K6_DURATION` to approximate production load patterns.
- Adjust thresholds within the script to reflect plan-specific expectations.
- Combine with external monitoring (Redis metrics, Fastify logs) to validate synchronization across instances.

### Cleanup

After running high-volume tests, clear Redis counters or wait for them to expire to avoid influencing subsequent runs.
