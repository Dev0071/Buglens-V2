# Buglens Testing Guide

## Overview

This guide walks you through thoroughly testing the Week 1 foundation of Buglens. We test in layers: **infrastructure → database → API → integration**.

---

## Prerequisites

### 1. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit .env with test values
nano .env
```

**Required values for testing:**
```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Use Docker Compose values
DATABASE_URL=postgresql://buglens:buglens_dev_password@localhost:5432/buglens_dev
REDIS_URL=redis://localhost:6379

# Generate a test JWT secret
JWT_SECRET=test-secret-change-in-production

# Optional for full webhook testing
SENTRY_WEBHOOK_SECRET=your-test-secret
```

### 2. Install Dependencies

```bash
# Node.js dependencies
npm install

# Python dependencies
cd python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cd ..
```

---

## Layer 1: Infrastructure Testing

### Start Docker Services

```bash
# Start Postgres + Redis
docker-compose up -d

# Verify containers are running
docker-compose ps

# Expected output:
# NAME                  STATUS
# buglens-postgres      Up (healthy)
# buglens-redis         Up (healthy)
```

### Test Postgres Connection

```bash
# Connect to Postgres
docker exec -it buglens-postgres psql -U buglens -d buglens_dev

# Run test query
\dt

# You should see no tables yet (migrations not run)
# Exit with \q
```

### Test Redis Connection

```bash
# Test Redis
docker exec -it buglens-redis redis-cli ping

# Expected: PONG
```

**✅ Infrastructure Layer: PASSED**

---

## Layer 2: Database Testing

### Run Migrations

```bash
# Apply all migrations
npm run migrate:up

# Expected output:
# > buglens@0.1.0 migrate:up
# > node-pg-migrate up
# 
# Running 001_create_organizations
# Running 002_create_events
# Running 003_create_rca_jobs
# ... (9 migrations total)
```

### Verify Schema

```bash
# Connect to database
docker exec -it buglens-postgres psql -U buglens -d buglens_dev

# List all tables
\dt

# Expected tables:
# organizations
# events
# rca_jobs
# rca_results
# repos
# code_snapshots
# users
# integrations
# cost_metrics
# pgmigrations
```

### Test Multi-Tenancy Setup

```sql
-- Check org_id columns exist on all tables
SELECT 
  table_name, 
  column_name 
FROM information_schema.columns 
WHERE column_name = 'org_id' 
ORDER BY table_name;

-- Expected: 8 rows (all tables except organizations and pgmigrations)

-- Check indexes
\di

-- Should see indexes like:
-- idx_events_org
-- idx_rca_jobs_org
-- idx_cost_metrics_org_date
```

### Seed Test Data

```bash
# From project root
docker exec -i buglens-postgres psql -U buglens -d buglens_dev < scripts/seed-dev-data.sql

# Verify data loaded
docker exec -it buglens-postgres psql -U buglens -d buglens_dev -c "SELECT id, name, plan FROM organizations;"

# Expected:
# id                                   | name              | plan
# 00000000-0000-0000-0000-000000000000 | Test Organization | pro
```

**✅ Database Layer: PASSED**

---

## Layer 3: Unit Testing

### Run All Unit Tests

```bash
# Run test suite
npm test

# Or with UI
npm run test:ui
```

### Test Coverage

**Current unit tests:**
1. `tests/unit/health.test.ts` - Health check endpoints
2. `tests/integration/sentry-webhook.test.ts` - Webhook receiver

**Expected output:**
```
✓ tests/unit/health.test.ts (2)
  ✓ Health Endpoints (2)
    ✓ should return healthy status
    ✓ should return ready status

✓ tests/integration/sentry-webhook.test.ts (2)
  ✓ Sentry Webhook (2)
    ✓ should accept valid Sentry webhook
    ✓ should reject invalid payload

Test Files  2 passed (2)
Tests  4 passed (4)
```

### Manual Unit Test Verification

**Test 1: Health Check**
```bash
# Start dev server in one terminal
npm run dev

# In another terminal, test health endpoint
curl http://localhost:3000/api/v1/health

# Expected response:
# {
#   "status": "healthy",
#   "database": "connected",
#   "timestamp": "2025-11-30T..."
# }
```

**Test 2: Ready Check**
```bash
curl http://localhost:3000/api/v1/ready

# Expected:
# {"status": "ready"}
```

**✅ Unit Tests: PASSED**

---

## Layer 4: Integration Testing

### Test Sentry Webhook End-to-End

**Step 1: Generate HMAC Signature (for production-like test)**

```bash
# In Node.js REPL
node
```

```javascript
const crypto = require('crypto');
const secret = 'your-test-secret'; // From .env
const payload = JSON.stringify({
  event_id: 'manual-test-001',
  timestamp: Date.now() / 1000,
  platform: 'javascript',
  exception: {
    values: [{
      type: 'ReferenceError',
      value: 'user is not defined',
      stacktrace: {
        frames: [{
          filename: 'app.js',
          function: 'getUserName',
          lineno: 25,
          colno: 10
        }]
      }
    }]
  },
  environment: 'production'
});

const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
console.log('Signature:', signature);
console.log('Payload:', payload);
```

**Step 2: Send Test Webhook**

```bash
# Using curl (replace YOUR_SIGNATURE with output from above)
curl -X POST http://localhost:3000/api/v1/webhooks/sentry \
  -H "Content-Type: application/json" \
  -H "Sentry-Hook-Signature: YOUR_SIGNATURE" \
  -d '{
    "event_id": "manual-test-001",
    "timestamp": 1701360000,
    "platform": "javascript",
    "exception": {
      "values": [{
        "type": "ReferenceError",
        "value": "user is not defined",
        "stacktrace": {
          "frames": [{
            "filename": "app.js",
            "function": "getUserName",
            "lineno": 25,
            "colno": 10
          }]
        }
      }]
    },
    "environment": "production"
  }'

# Expected response:
# {
#   "status": "received",
#   "event_id": "uuid-here"
# }
```

**Step 3: Verify Data in Database**

```bash
docker exec -it buglens-postgres psql -U buglens -d buglens_dev -c \
  "SELECT sentry_event_id, platform, environment, created_at FROM events ORDER BY created_at DESC LIMIT 1;"

# Expected:
# sentry_event_id | platform   | environment | created_at
# manual-test-001 | javascript | production  | 2025-11-30 ...
```

**Step 4: Check Full Event Data**

```sql
-- In psql
SELECT 
  id,
  org_id,
  sentry_event_id,
  platform,
  message,
  environment,
  created_at
FROM events 
WHERE sentry_event_id = 'manual-test-001';

-- Verify org_id matches test org (00000000-0000-0000-0000-000000000000)
```

**✅ Integration Tests: PASSED**

---

## Layer 5: Rate Limiting & Multi-Tenancy

### Test Rate Limiting

```bash
# Send 101 requests rapidly (exceeds default 100/min)
for i in {1..101}; do
  curl -s http://localhost:3000/api/v1/health | jq .status
done

# First 100 should return "healthy"
# 101st should return 429 error:
# {
#   "error": "Rate Limit Exceeded",
#   "message": "Too many requests, please try again later"
# }
```

### Test Organization Context Middleware

Create a test with org_id validation:

```bash
# Create second test org
docker exec -it buglens-postgres psql -U buglens -d buglens_dev -c "
INSERT INTO organizations (id, name, slug, plan, settings)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Second Org',
  'second-org',
  'free',
  '{}'
);"

# Send webhook without org_id (should use default from integration)
# This tests org context middleware isolation
```

**Test tenant isolation in database:**

```sql
-- Set org context
SET LOCAL app.current_org_id = '00000000-0000-0000-0000-000000000000';

-- Query should only return events for this org
SELECT COUNT(*) FROM events;

-- Change org context
SET LOCAL app.current_org_id = '11111111-1111-1111-1111-111111111111';

-- Should return 0 (no events for this org)
SELECT COUNT(*) FROM events;
```

**✅ Multi-Tenancy: PASSED**

---

## Layer 6: Error Handling

### Test Validation Errors

```bash
# Missing required fields
curl -X POST http://localhost:3000/api/v1/webhooks/sentry \
  -H "Content-Type: application/json" \
  -d '{"invalid": "data"}'

# Expected: 400 Bad Request
# {
#   "error": "Bad Request",
#   "message": "Missing required fields"
# }
```

### Test HMAC Validation Failure

```bash
# Wrong signature
curl -X POST http://localhost:3000/api/v1/webhooks/sentry \
  -H "Content-Type: application/json" \
  -H "Sentry-Hook-Signature: invalid-signature" \
  -d '{"event_id": "test"}'

# Expected: 401 Unauthorized
```

### Test Malformed JSON

```bash
curl -X POST http://localhost:3000/api/v1/webhooks/sentry \
  -H "Content-Type: application/json" \
  -d 'not valid json{'

# Expected: 400 Bad Request
```

**✅ Error Handling: PASSED**

---

## Layer 7: Performance & Observability

### Check Logs

**Structured logging test:**
```bash
# Tail server logs
npm run dev

# In another terminal, make requests
curl http://localhost:3000/api/v1/health

# Check logs include:
# - Request ID
# - Response time
# - Status code
# - User agent
```

**Expected log format (JSON):**
```json
{
  "level": 30,
  "time": 1701360000000,
  "pid": 12345,
  "hostname": "localhost",
  "reqId": "req-1",
  "req": {
    "method": "GET",
    "url": "/api/v1/health"
  },
  "res": {
    "statusCode": 200
  },
  "responseTime": 5.2,
  "msg": "request completed"
}
```

### Check Database Connection Pooling

```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity WHERE datname = 'buglens_dev';

-- Should be <= 10 (DATABASE_POOL_MAX)
```

**✅ Observability: PASSED**

---

## Complete Test Checklist

Run this full checklist before considering Week 1 complete:

### Infrastructure ✅
- [ ] Docker Compose starts Postgres + Redis
- [ ] Postgres health check passes
- [ ] Redis health check passes
- [ ] Can connect to both services

### Database ✅
- [ ] All 9 migrations run successfully
- [ ] All tables have `org_id` (except organizations)
- [ ] Indexes exist on `org_id` columns
- [ ] Row-level security policies active
- [ ] Seed data loads correctly

### API ✅
- [ ] Health endpoint returns 200
- [ ] Ready endpoint returns 200
- [ ] Server logs structured JSON
- [ ] CORS headers present
- [ ] Request ID in logs

### Webhooks ✅
- [ ] Sentry webhook accepts valid payload
- [ ] HMAC validation works
- [ ] Invalid payload returns 400
- [ ] Event stored in database with correct org_id
- [ ] Timestamp converted properly

### Security ✅
- [ ] Rate limiting enforces 100 req/min
- [ ] JWT middleware registered (even if not used yet)
- [ ] HMAC signature validation works
- [ ] SQL injection prevented (parameterized queries)

### Multi-Tenancy ✅
- [ ] org_id stored on all events
- [ ] org_id matches integration's org
- [ ] Can set org context in SQL
- [ ] Queries isolated by org_id

### Tests ✅
- [ ] `npm test` passes all 4 tests
- [ ] Health test passes
- [ ] Webhook integration test passes
- [ ] Can add new tests easily

---

## Troubleshooting

### Database Connection Errors

```bash
# Check Postgres is running
docker-compose ps postgres

# Check logs
docker-compose logs postgres

# Reset if needed
docker-compose down
docker-compose up -d
```

### Migration Errors

```bash
# Check migration status
npm run migrate:up

# Rollback if needed
npm run migrate:down

# Re-run
npm run migrate:up
```

### Port Conflicts

```bash
# Check what's using port 3000
lsof -i :3000

# Kill process if needed
kill -9 <PID>

# Or change PORT in .env
```

### Redis Connection Issues

```bash
# Test Redis directly
docker exec -it buglens-redis redis-cli

# Inside Redis CLI:
PING  # Should return PONG
SET test "hello"
GET test  # Should return "hello"
```

---

## Next Steps After Testing

Once all tests pass:

1. **Document your setup** - Add any custom steps to README
2. **Create a PR** - For Week 1 completion review
3. **Begin Week 2** - GitHub integration & caching
4. **Add more tests** - As you build new features

---

## Performance Benchmarks (Target)

Week 1 baseline metrics:

- Health check: <10ms
- Webhook receive: <50ms (without job processing)
- Database insert: <20ms
- Rate limit check: <1ms (in-memory, will be faster with Redis)

**Measure with:**
```bash
# Install Apache Bench
brew install ab

# Test health endpoint
ab -n 1000 -c 10 http://localhost:3000/api/v1/health

# Look for:
# - Mean response time
# - Requests per second
# - No failed requests
```

---

## CI/CD Testing

GitHub Actions will run automatically on push. To test locally:

```bash
# Lint code
npm run lint

# Format code
npm run format

# Run tests
npm test

# Build TypeScript
npm run build

# Check no errors
echo $?  # Should be 0
```

---

## Summary

You've now thoroughly tested:
1. ✅ Infrastructure (Docker Compose)
2. ✅ Database (Migrations + Multi-tenancy)
3. ✅ API (Health + Webhooks)
4. ✅ Security (Rate limits + HMAC)
5. ✅ Observability (Structured logs)
6. ✅ Tests (Unit + Integration)

**Week 1 foundation is solid. Ready for Week 2: GitHub Integration.**
