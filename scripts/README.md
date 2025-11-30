# Buglens Test Scripts

## Webhook End-to-End Testing

### Quick Start

```bash
# 1. Start the server
npm run dev

# 2. In another terminal, run the test script
node scripts/test-webhook.cjs
```

### Test Script Features

The `test-webhook.cjs` script provides comprehensive end-to-end testing:

✅ **8 Test Scenarios:**

1. Default ReferenceError
2. TypeError with multiple stack frames
3. Event with breadcrumbs & user context
4. Node.js error with full context
5. Minimal valid payload
6. Staging environment
7. Invalid HMAC signature (401 test)
8. Invalid payload structure (400 test)

✅ **Automated Testing:**

- HMAC signature generation
- HTTP request handling
- Response validation
- Database verification (optional)
- Performance metrics (response time)

✅ **Pretty Output:**

- Color-coded results
- Clear pass/fail indicators
- Duration tracking

### Usage Options

**Basic test:**

```bash
node scripts/test-webhook.cjs
```

**Test against different URL:**

```bash
node scripts/test-webhook.cjs --url https://api.buglens.dev
```

**With database verification:**

```bash
node scripts/test-webhook.cjs --verify-db
```

**Verbose output (show payloads):**

```bash
node scripts/test-webhook.cjs --verbose
node scripts/test-webhook.cjs -v
```

**Combined options:**

```bash
node scripts/test-webhook.cjs --verify-db --verbose
```

### Environment Variables

Set these in your `.env` file:

```env
# Required
SENTRY_WEBHOOK_SECRET=your-test-secret

# Optional (for database verification)
DATABASE_URL=postgresql://buglens:buglens_dev_password@localhost:5432/buglens_dev
```

### Expected Output

```
============================================================
Buglens Webhook End-to-End Tests
============================================================
Base URL: http://localhost:3000
Secret: test-secre...
Database Verification: Enabled

============================================================
Test Suite 1: Valid Payloads
============================================================

▶ Default ReferenceError
  ✅ Status: 200 (23ms)
  ✅ Event created: 550e8400-e29b-41d4-a716-446655440000
  ✅ Event found in database:
   ID: 550e8400-e29b-41d4-a716-446655440000
   Status: received
   Environment: production

▶ TypeError with stack trace
  ✅ Status: 200 (18ms)
  ✅ Event created: 550e8400-e29b-41d4-a716-446655440001

... (more tests)

============================================================
Test Suite 2: Error Scenarios
============================================================

▶ Invalid HMAC signature
  ✅ Status: 401 (5ms)
  ✅ Error response: Unauthorized

▶ Invalid payload (missing required fields)
  ✅ Status: 400 (7ms)
  ✅ Validation error caught

============================================================
Test Results
============================================================
Total Tests: 8
Passed: 8
Failed: 0

🎉 All tests passed!
```

### Troubleshooting

**Server not running:**

```
❌ Request failed: connect ECONNREFUSED 127.0.0.1:3000
```

Solution: Start the server with `npm run dev`

**Wrong webhook secret:**

```
▶ Default ReferenceError
  ❌ Expected 200, got 401
```

Solution: Ensure `SENTRY_WEBHOOK_SECRET` in `.env` matches the test script

**Database verification fails:**

```
⚠️  Database verification failed: connect ECONNREFUSED
```

Solution: Start Docker Compose: `docker-compose up -d`

**Rate limit hit:**

```
❌ Expected 200, got 429
```

Solution: Wait 1 minute or restart server (rate limit resets)

### Use as Module

You can also import and use individual functions:

```javascript
const {
  generateSignature,
  createPayload,
  sendWebhook,
} = require("./scripts/test-webhook.cjs");

// Generate a custom test payload
const payload = createPayload("typeError");
const signature = generateSignature(payload, "my-secret");

// Send to webhook
const response = await sendWebhook(payload, signature);
console.log(response.body);
```

### Integration with CI/CD

Add to your GitHub Actions workflow:

```yaml
- name: Run webhook tests
  run: |
    npm run dev &
    sleep 5
    node scripts/test-webhook.cjs --verify-db
  env:
    SENTRY_WEBHOOK_SECRET: ${{ secrets.SENTRY_WEBHOOK_SECRET }}
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### Performance Benchmarks

Target response times:

- Health check: <10ms
- Webhook receive: <50ms
- With DB insert: <100ms

The test script tracks duration for each request.

### Next Steps

After all tests pass:

1. Review database entries: `docker exec -it buglens-postgres psql -U buglens -d buglens_dev -c "SELECT * FROM events ORDER BY created_at DESC LIMIT 5;"`
2. Check application logs for any warnings
3. Test with real Sentry webhook (configure in Sentry dashboard)
4. Move to Week 2: GitHub integration
