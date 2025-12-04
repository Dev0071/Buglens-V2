#!/usr/bin/env node
/**
 * Test script to simulate Sentry webhooks for your Next.js errors
 *
 * Usage:
 *   node scripts/test-nextjs-errors.cjs [error-type]
 *
 * Error types: null-access, unawaited-promise, missing-handler, all
 */

const crypto = require('crypto');
const http = require('http');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const ORG_ID = process.env.TEST_ORG_ID || '11111111-1111-1111-1111-111111111111';
const WEBHOOK_SECRET = process.env.SENTRY_WEBHOOK_SECRET || 'your-test-secret-for-local-development';
const REPO_FULL_NAME = process.env.TEST_REPO || 'YOUR_GITHUB_USERNAME/YOUR_NEXTJS_REPO'; // Update this!

function generateSignature(payload) {
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
}

function sendWebhook(payload, label) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const signature = generateSignature(payload);
    const url = new URL(`${API_URL}/api/v1/webhooks/sentry/${ORG_ID}`);

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'sentry-hook-signature': signature,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        console.log(`\n[${label}] Status: ${res.statusCode}`);
        try {
          console.log('Response:', JSON.parse(data));
        } catch {
          console.log('Response:', data);
        }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Error payloads that match your Next.js test cases
const errorPayloads = {
  'null-access': {
    event_id: `null-access-${Date.now()}`,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    environment: 'development',
    release: `${REPO_FULL_NAME}@main`, // Links to your repo
    message: "Cannot read properties of undefined (reading 'name')",
    exception: {
      values: [
        {
          type: 'TypeError',
          value: "Cannot read properties of undefined (reading 'name')",
          stacktrace: {
            frames: [
              {
                filename: 'app/api/test-null/route.ts',
                function: 'GET',
                lineno: 8,
                colno: 25,
                abs_path: '/app/api/test-null/route.ts',
                in_app: true,
              },
              {
                filename: 'node_modules/next/dist/server/future/route-modules/app-route/module.js',
                function: 'handleRequest',
                lineno: 123,
                colno: 15,
                in_app: false,
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: {
      values: [
        { timestamp: Date.now() / 1000 - 1, type: 'http', category: 'fetch', message: 'GET /api/test-null' },
      ],
    },
    contexts: {
      runtime: { name: 'node', version: '20.0.0' },
      app: { repository: REPO_FULL_NAME },
    },
    tags: {
      repo: REPO_FULL_NAME,
    },
  },

  'unawaited-promise': {
    event_id: `unawaited-${Date.now()}`,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    environment: 'development',
    release: `${REPO_FULL_NAME}@main`,
    message: 'Unhandled promise rejection: fetch failed',
    exception: {
      values: [
        {
          type: 'UnhandledRejection',
          value: 'Unhandled promise rejection: fetch failed',
          stacktrace: {
            frames: [
              {
                filename: 'app/api/test-promise/route.ts',
                function: 'POST',
                lineno: 12,
                colno: 3,
                abs_path: '/app/api/test-promise/route.ts',
                in_app: true,
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: {
      values: [
        { timestamp: Date.now() / 1000 - 2, type: 'http', category: 'fetch', message: 'POST /api/test-promise' },
        { timestamp: Date.now() / 1000 - 1, type: 'console', message: 'Starting async operation' },
      ],
    },
    contexts: {
      app: { repository: REPO_FULL_NAME },
    },
    tags: { repo: REPO_FULL_NAME },
  },

  'missing-handler': {
    event_id: `missing-handler-${Date.now()}`,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    environment: 'development',
    release: `${REPO_FULL_NAME}@main`,
    message: 'Uncaught Error: Something went wrong in try block',
    exception: {
      values: [
        {
          type: 'Error',
          value: 'Uncaught Error: Something went wrong in try block',
          stacktrace: {
            frames: [
              {
                filename: 'app/api/test-handler/route.ts',
                function: 'PUT',
                lineno: 5,
                colno: 11,
                abs_path: '/app/api/test-handler/route.ts',
                in_app: true,
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: {
      values: [
        { timestamp: Date.now() / 1000 - 1, type: 'http', category: 'fetch', message: 'PUT /api/test-handler' },
      ],
    },
    contexts: {
      app: { repository: REPO_FULL_NAME },
    },
    tags: { repo: REPO_FULL_NAME },
  },
};

async function main() {
  const errorType = process.argv[2] || 'all';
  console.log('='.repeat(60));
  console.log('Buglens Next.js Error Test');
  console.log('='.repeat(60));
  console.log(`API URL: ${API_URL}`);
  console.log(`Org ID: ${ORG_ID}`);
  console.log(`Repo: ${REPO_FULL_NAME}`);
  console.log(`Error Type: ${errorType}`);

  if (errorType === 'all') {
    for (const [type, payload] of Object.entries(errorPayloads)) {
      await sendWebhook(payload, type);
      await new Promise((r) => setTimeout(r, 500)); // Small delay between requests
    }
  } else if (errorPayloads[errorType]) {
    await sendWebhook(errorPayloads[errorType], errorType);
  } else {
    console.error(`Unknown error type: ${errorType}`);
    console.log('Available types: null-access, unawaited-promise, missing-handler, all');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Check your database for results:');
  console.log(`  psql "$DATABASE_URL" -c "SELECT id, status, message FROM events WHERE org_id = '${ORG_ID}' ORDER BY created_at DESC LIMIT 5;"`);
  console.log(`  psql "$DATABASE_URL" -c "SELECT id, status, deterministic_findings FROM rca_jobs WHERE org_id = '${ORG_ID}' ORDER BY created_at DESC LIMIT 5;"`);
}

main().catch(console.error);
