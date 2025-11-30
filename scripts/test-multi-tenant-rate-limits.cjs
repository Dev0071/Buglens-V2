#!/usr/bin/env node
/**
 * Buglens Multi-Tenancy & Rate Limit Test Script
 *
 * Tests:
 * 1. Multi-tenant isolation: Send 100 events from 2 different orgs, verify DB isolation
 * 2. Rate limiting: Exceed limit (100 req/min), verify 429 response
 *
 * Usage:
 *   node scripts/test-multi-tenant-rate-limits.cjs
 *   node scripts/test-multi-tenant-rate-limits.cjs --verbose
 */

require('dotenv').config();

const crypto = require('crypto');
const http = require('http');

// Configuration
const CONFIG = {
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  secret: process.env.SENTRY_WEBHOOK_SECRET || 'your-test-secret-for-local-development',
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v'),
  // Organization configs
  orgs: [
    {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Test Organization',
      slug: 'test-org',
    },
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Second Organization',
      slug: 'second-org',
    }
  ]
};

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60));
}

function logTest(name) {
  log(`\n▶ ${name}`, 'cyan');
}

function logSuccess(message) {
  log(`  ✅ ${message}`, 'green');
}

function logError(message) {
  log(`  ❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`  ⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`  ℹ️  ${message}`, 'blue');
}

/**
 * Generate HMAC signature
 */
function generateSignature(payload, secret) {
  const payloadString = JSON.stringify(payload);
  return crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');
}

/**
 * Create test payload
 */
function createPayload(orgId, index) {
  return {
    event_id: `test-org-${orgId.substring(0, 8)}-${Date.now()}-${index}`,
    timestamp: Math.floor(Date.now() / 1000),
    platform: 'javascript',
    level: 'error',
    exception: {
      values: [{
        type: 'TestError',
        value: `Test error ${index} from org ${orgId.substring(0, 8)}`,
        stacktrace: {
          frames: [{
            filename: 'test.js',
            function: 'testFunction',
            lineno: index,
            colno: 10,
            in_app: true,
          }]
        }
      }]
    },
    environment: 'test',
    message: `Test error ${index}`,
  };
}

/**
 * Send HTTP request
 */
function sendWebhook(payload, signature, orgId) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${CONFIG.baseUrl}/api/v1/webhooks/sentry/${orgId}`);
    const payloadString = JSON.stringify(payload);

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadString),
        'Sentry-Hook-Signature': signature,
      },
    };

    const startTime = Date.now();

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const duration = Date.now() - startTime;
        try {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data),
            duration,
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            body: data,
            duration,
          });
        }
      });
    });

    req.on('error', reject);
    req.write(payloadString);
    req.end();
  });
}

/**
 * Query database
 */
async function queryDatabase(query, params = []) {
  try {
    const { Client } = require('pg');
    const client = new Client({
      connectionString: process.env.DATABASE_URL || 'postgresql://buglens:buglens_dev_password@localhost:5432/buglens_dev',
    });

    await client.connect();
    const result = await client.query(query, params);
    await client.end();

    return result.rows;
  } catch (error) {
    logWarning(`Database query failed: ${error.message}`);
    logWarning('Install pg module: npm install pg');
    return null;
  }
}

/**
 * Setup test organizations in database
 */
async function setupOrganizations() {
  logTest('Setting up test organizations');

  for (const org of CONFIG.orgs) {
    const result = await queryDatabase(
      `INSERT INTO organizations (id, name, slug, plan, settings)
       VALUES ($1, $2, $3, 'pro', '{}')
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, slug = EXCLUDED.slug
       RETURNING id`,
      [org.id, org.name, org.slug]
    );

    if (result) {
      logSuccess(`Organization ${org.name} (${org.id.substring(0, 8)}...) ready`);
    }
  }
}

/**
 * Clean up test events
 */
async function cleanupEvents() {
  logTest('Cleaning up old test events');

  for (const org of CONFIG.orgs) {
    const result = await queryDatabase(
      `DELETE FROM events WHERE org_id = $1 AND message LIKE 'Test error%'`,
      [org.id]
    );

    if (result !== null) {
      logInfo(`Cleaned up old events for org ${org.slug}`);
    }
  }
}

/**
 * Test 1: Multi-tenant isolation
 */
async function testMultiTenantIsolation() {
  logSection('Test 1: Multi-Tenant Isolation');
  logInfo('Sending 50 events from each organization (100 total)');

  const results = {
    org1: { sent: 0, success: 0, failed: 0 },
    org2: { sent: 0, success: 0, failed: 0 },
  };

  // Send events from both orgs
  const promises = [];

  for (let i = 0; i < 50; i++) {
    // Org 1
    const payload1 = createPayload(CONFIG.orgs[0].id, i);
    const signature1 = generateSignature(payload1, CONFIG.secret);
    promises.push(
      sendWebhook(payload1, signature1, CONFIG.orgs[0].id)
        .then(res => {
          results.org1.sent++;
          if (res.statusCode === 200) results.org1.success++;
          else results.org1.failed++;
          if (CONFIG.verbose && i % 10 === 0) {
            logInfo(`Org 1: Sent ${i + 1}/50 events`);
          }
        })
        .catch(() => results.org1.failed++)
    );

    // Org 2
    const payload2 = createPayload(CONFIG.orgs[1].id, i);
    const signature2 = generateSignature(payload2, CONFIG.secret);
    promises.push(
      sendWebhook(payload2, signature2, CONFIG.orgs[1].id)
        .then(res => {
          results.org2.sent++;
          if (res.statusCode === 200) results.org2.success++;
          else results.org2.failed++;
          if (CONFIG.verbose && i % 10 === 0) {
            logInfo(`Org 2: Sent ${i + 1}/50 events`);
          }
        })
        .catch(() => results.org2.failed++)
    );

    // Small delay to avoid overwhelming server
    if (i % 10 === 0) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  await Promise.all(promises);

  logInfo('All events sent, verifying database isolation...');
  await new Promise(r => setTimeout(r, 1000)); // Wait for DB writes

  // Verify isolation in database
  const org1Count = await queryDatabase(
    `SELECT COUNT(*) as count FROM events WHERE org_id = $1 AND message LIKE 'Test error%'`,
    [CONFIG.orgs[0].id]
  );

  const org2Count = await queryDatabase(
    `SELECT COUNT(*) as count FROM events WHERE org_id = $1 AND message LIKE 'Test error%'`,
    [CONFIG.orgs[1].id]
  );

  // Verify no cross-contamination
  const crossCheck1 = await queryDatabase(
    `SELECT COUNT(*) as count FROM events WHERE org_id = $1 AND sentry_event_id LIKE 'test-org-${CONFIG.orgs[1].id.substring(0, 8)}%'`,
    [CONFIG.orgs[0].id]
  );

  const crossCheck2 = await queryDatabase(
    `SELECT COUNT(*) as count FROM events WHERE org_id = $1 AND sentry_event_id LIKE 'test-org-${CONFIG.orgs[0].id.substring(0, 8)}%'`,
    [CONFIG.orgs[1].id]
  );

  // Results
  console.log('\n' + '-'.repeat(60));
  logInfo('Results Summary:');
  console.log('-'.repeat(60));

  logInfo(`Organization 1 (${CONFIG.orgs[0].slug}):`);
  logInfo(`  - Sent: ${results.org1.sent} events`);
  logInfo(`  - Success: ${results.org1.success} (${((results.org1.success / results.org1.sent) * 100).toFixed(1)}%)`);
  if (org1Count) {
    logInfo(`  - Database count: ${org1Count[0].count}`);
  }

  logInfo(`\nOrganization 2 (${CONFIG.orgs[1].slug}):`);
  logInfo(`  - Sent: ${results.org2.sent} events`);
  logInfo(`  - Success: ${results.org2.success} (${((results.org2.success / results.org2.sent) * 100).toFixed(1)}%)`);
  if (org2Count) {
    logInfo(`  - Database count: ${org2Count[0].count}`);
  }

  // Validation
  console.log('\n' + '-'.repeat(60));
  logInfo('Isolation Validation:');
  console.log('-'.repeat(60));

  let passed = true;

  if (org1Count && org1Count[0].count >= 45) {
    logSuccess(`Org 1: ${org1Count[0].count} events stored (expected ~50)`);
  } else {
    logError(`Org 1: Only ${org1Count?.[0]?.count || 0} events stored (expected ~50)`);
    passed = false;
  }

  if (org2Count && org2Count[0].count >= 45) {
    logSuccess(`Org 2: ${org2Count[0].count} events stored (expected ~50)`);
  } else {
    logError(`Org 2: Only ${org2Count?.[0]?.count || 0} events stored (expected ~50)`);
    passed = false;
  }

  if (crossCheck1 && Number(crossCheck1[0].count) === 0) {
    logSuccess('No Org 2 events leaked into Org 1');
  } else {
    logError(`Cross-contamination detected: ${crossCheck1?.[0]?.count || 'unknown'} Org 2 events in Org 1`);
    passed = false;
  }

  if (crossCheck2 && Number(crossCheck2[0].count) === 0) {
    logSuccess('No Org 1 events leaked into Org 2');
  } else {
    logError(`Cross-contamination detected: ${crossCheck2?.[0]?.count || 'unknown'} Org 1 events in Org 2`);
    passed = false;
  }

  return passed;
}

/**
 * Test 2: Rate limiting
 */
async function testRateLimiting() {
  logSection('Test 2: Rate Limiting');
  logInfo('Sending 105 requests rapidly to exceed 100 req/min limit');
  logWarning('This may take ~30 seconds...');

  const results = {
    success: 0,
    rateLimited: 0,
    errors: 0,
  };

  const startTime = Date.now();

  // Send 105 requests as fast as possible
  for (let i = 0; i < 105; i++) {
    const payload = createPayload(CONFIG.orgs[0].id, i);
    const signature = generateSignature(payload, CONFIG.secret);

    try {
      const response = await sendWebhook(payload, signature, CONFIG.orgs[0].id);

      if (response.statusCode === 200) {
        results.success++;
      } else if (response.statusCode === 429) {
        results.rateLimited++;
        if (results.rateLimited === 1) {
          logInfo(`First rate limit hit after ${i + 1} requests`);
        }
      } else {
        results.errors++;
      }

      if (CONFIG.verbose && (i + 1) % 20 === 0) {
        logInfo(`Progress: ${i + 1}/105 requests sent`);
      }
    } catch (error) {
      results.errors++;
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Results
  console.log('\n' + '-'.repeat(60));
  logInfo('Rate Limit Test Results:');
  console.log('-'.repeat(60));

  logInfo(`Total requests: 105`);
  logInfo(`Duration: ${duration}s`);
  logInfo(`Successful (200): ${results.success}`);
  logInfo(`Rate limited (429): ${results.rateLimited}`);
  logInfo(`Errors: ${results.errors}`);

  // Validation
  console.log('\n' + '-'.repeat(60));
  logInfo('Validation:');
  console.log('-'.repeat(60));

  let passed = true;

  if (results.rateLimited > 0) {
    logSuccess(`Rate limiting working: ${results.rateLimited} requests rejected with 429`);
  } else {
    logError('Rate limiting NOT working: No 429 responses received');
    logWarning('Expected some requests to be rate limited (limit is 100/min)');
    passed = false;
  }

  if (results.success <= 100) {
    logSuccess(`Success count (${results.success}) within expected range (<=100)`);
  } else {
    logWarning(`More requests succeeded (${results.success}) than limit allows (100)`);
  }

  const requestsPerSecond = (105 / parseFloat(duration)).toFixed(2);
  logInfo(`Throughput: ${requestsPerSecond} req/s`);

  return passed;
}

/**
 * Test 3: Row-level security (verify org isolation with SQL)
 */
async function testRowLevelSecurity() {
  logSection('Test 3: Row-Level Security');
  logInfo('Testing PostgreSQL RLS policies for tenant isolation');

  // Set org context and query
  const org1Events = await queryDatabase(`
    BEGIN;
    SET LOCAL app.current_org_id = '${CONFIG.orgs[0].id}';
    SELECT COUNT(*) as count FROM events WHERE message LIKE 'Test error%';
    COMMIT;
  `);

  const org2Events = await queryDatabase(`
    BEGIN;
    SET LOCAL app.current_org_id = '${CONFIG.orgs[1].id}';
    SELECT COUNT(*) as count FROM events WHERE message LIKE 'Test error%';
    COMMIT;
  `);

  if (!org1Events || !org2Events) {
    logWarning('RLS test skipped (database query failed)');
    return false;
  }

  logInfo(`With org_id = ${CONFIG.orgs[0].id.substring(0, 8)}...:`);
  logInfo(`  - Visible events: ${org1Events[0]?.count || 0}`);

  logInfo(`With org_id = ${CONFIG.orgs[1].id.substring(0, 8)}...:`);
  logInfo(`  - Visible events: ${org2Events[0]?.count || 0}`);

  // Note: RLS policies need to be properly configured to see isolation
  logWarning('Note: RLS testing requires properly configured policies');
  logWarning('Check that app.current_org_id is set correctly');

  return true;
}

/**
 * Main test runner
 */
async function runTests() {
  logSection('Buglens Multi-Tenant & Rate Limit Tests');

  console.log(`Base URL: ${CONFIG.baseUrl}`);
  console.log(`Organizations: ${CONFIG.orgs.length}`);
  console.log(`Verbose: ${CONFIG.verbose}`);

  const results = {
    passed: 0,
    failed: 0,
  };

  try {
    // Setup
    await setupOrganizations();
    await cleanupEvents();

    // Test 1: Multi-tenant isolation
    const test1 = await testMultiTenantIsolation();
    if (test1) results.passed++;
    else results.failed++;

    // Wait before next test
    await new Promise(r => setTimeout(r, 2000));

    // Test 2: Rate limiting
    const test2 = await testRateLimiting();
    if (test2) results.passed++;
    else results.failed++;

    // Wait before next test
    await new Promise(r => setTimeout(r, 2000));

    // Test 3: RLS (informational)
    await testRowLevelSecurity();

  } catch (error) {
    logError(`Fatal error: ${error.message}`);
    if (CONFIG.verbose) {
      console.error(error);
    }
    results.failed++;
  }

  // Summary
  logSection('Final Results');
  log(`Tests Passed: ${results.passed}`, results.passed > 0 ? 'green' : 'reset');
  log(`Tests Failed: ${results.failed}`, results.failed > 0 ? 'red' : 'reset');

  if (results.failed === 0) {
    log('\n🎉 All tests passed!', 'green');
    log('\n✅ Multi-tenancy isolation verified', 'green');
    log('✅ Rate limiting working correctly', 'green');
    process.exit(0);
  } else {
    log(`\n⚠️  ${results.failed} test(s) failed`, 'yellow');
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runTests().catch((error) => {
    logError(`Fatal error: ${error.message}`);
    if (CONFIG.verbose) {
      console.error(error);
    }
    process.exit(1);
  });
}

module.exports = { runTests };
