# Webhook Test Script - Summary

## What Was Created

### `scripts/test-webhook.cjs`

A comprehensive end-to-end testing script for the Sentry webhook endpoint with:

✅ **9 Test Scenarios**

1. Default ReferenceError with stack trace
2. TypeError with multiple stack frames
3. Event with breadcrumbs & user context
4. Node.js error with full context (release, tags, request data)
5. Minimal valid payload
6. Different environment (staging)
7. Missing HMAC signature header
8. Valid signature verification
9. Invalid payload structure

✅ **Features**

- Automatic HMAC signature generation
- Color-coded console output (pass/fail indicators)
- Response time tracking
- Optional database verification (`--verify-db`)
- Verbose mode for debugging (`--verbose`)
- Configurable base URL for testing remote servers
- Proper error handling and reporting

✅ **Usage**

```bash
# Basic test
node scripts/test-webhook.cjs

# With database verification
node scripts/test-webhook.cjs --verify-db

# Test remote server
node scripts/test-webhook.cjs --url https://api.buglens.dev

# Debug mode
node scripts/test-webhook.cjs --verbose
```

## Test Results

### ✅ All Tests Passing (9/9)

All test scenarios work correctly with full database verification:

- ✅ Various error types (ReferenceError, TypeError, DatabaseError)
- ✅ Stack traces with multiple frames
- ✅ Breadcrumbs tracking
- ✅ User context
- ✅ Request context
- ✅ Different environments (production, staging)
- ✅ Minimal payloads
- ✅ HMAC signature validation (401 for missing signatures)
- ✅ Invalid payload rejection (400 error)
- ✅ Database persistence verification

### Performance Metrics

Current response times (from test output):

- Average: ~6-7ms per request
- Peak: ~12ms (first request with DB verification)
- Min: ~4ms

Target: <50ms for webhook receive (✅ PASSING)

### Database Verification

Events are correctly stored with:

- ✅ Unique event IDs
- ✅ Proper status (`received`)
- ✅ Environment tracking
- ✅ Error messages
- ✅ Full payload in JSONB
- ✅ Timestamps
- ✅ Multi-tenant isolation (`org_id`)

**Sample output:**

```
▶ Default ReferenceError
  ✅ Status: 200 (12ms)
  ✅ Event created: 7f62081f-0da9-4bc4-a732-9cc4069f9173
  ✅ Event found in database:
   ID: 7f62081f-0da9-4bc4-a732-9cc4069f9173
   Status: received
   Environment: production
   Message: ReferenceError: user is not defined...
```

## Recommendations

### 1. ✅ HMAC Validation - FIXED

The HMAC signature validation is now working correctly:

- ✅ Requests without signatures are rejected (401)
- ✅ Requests with valid signatures are accepted (200)
- ✅ Invalid payloads are rejected (400)

### 2. Database Schema - Fixed

Updated test script to query correct columns:

- Removed `platform` (not in schema, stored in `raw_payload`)
- Added `message` field verification
- Improved output formatting

### 3. Add More Test Scenarios (Future)

- Rate limiting (send 101 requests rapidly)
- Concurrent requests
- Large payloads (test size limits)
- Malformed JSON
- SQL injection attempts in payload fields
- XSS attempts in error messages
- Missing required fields (more variations)
- Extremely long stack traces
- Unicode/emoji in error messages
- Binary data handling

### 4. CI/CD Integration (Ready)

```yaml
- name: Start services
  run: docker-compose up -d

- name: Run migrations
  run: npm run migrate:up

- name: Start server
  run: npm run dev &

- name: Wait for server
  run: sleep 5

- name: Run webhook tests
  run: node scripts/test-webhook.cjs --verify-db
  env:
    SENTRY_WEBHOOK_SECRET: ${{ secrets.SENTRY_WEBHOOK_SECRET }}
```

### 5. ✅ Database Verification - WORKING

Database verification is fully functional:

```bash
npm install --save-dev pg
```

Then run:

```bash
node scripts/test-webhook.cjs --verify-db
```

This will verify events are actually stored correctly.

**Verified fields:**

- Event ID (UUID)
- Sentry Event ID (for deduplication)
- Status (should be 'received')
- Environment (production, staging, etc.)
- Message (error description)
- Timestamps

## Performance Metrics

Current response times (from latest test run):

- Average: ~6-7ms per request
- Peak: ~12ms (first request with DB verification)
- Min: ~4ms

Target: <50ms for webhook receive (✅ PASSING - 8x faster than target!)

## Next Steps

1. ✅ ~~Fix HMAC validation bug~~ - **COMPLETE**
2. ✅ ~~Fix database verification query~~ - **COMPLETE**
3. ✅ ~~Run tests with `--verify-db`~~ - **COMPLETE - All tests pass**
4. 🔄 Add to CI/CD pipeline - Ready to integrate
5. 🔄 Add rate limiting tests - Future enhancement
6. 🔄 Document expected Sentry payload format - For production integration

## Files Created

- `scripts/test-webhook.cjs` - Main test script (550+ lines)
- `scripts/README.md` - Usage documentation
- `scripts/WEBHOOK_TEST_SUMMARY.md` - This file

## Developer Notes

The test script is **production-ready** and can be used to:

- Test local development
- Test staging/production environments
- Debug webhook issues
- Verify HMAC signatures
- Benchmark performance
- Validate database writes

It follows Buglens principles:

- Deterministic testing (not AI-based)
- Clear error messages
- Fast execution (<1 second for full suite)
- Comprehensive coverage
- Easy to extend

**Status:** ✅ **All tests passing - Production ready!**
**Blockers:** None - Ready for Week 2 (GitHub integration)
