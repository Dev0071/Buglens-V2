-- ============================================================================
-- Buglens Development Seed Data
-- ============================================================================
-- Creates realistic test data for all tables to enable frontend development
-- and testing with real API data instead of mock data.
--
-- Run with: psql -U buglens -d buglens_dev -f scripts/seed-dev-data-full.sql
-- Or via npm: npm run db:seed
-- ============================================================================

-- Start transaction
BEGIN;

-- ============================================================================
-- 1. ORGANIZATION & USERS
-- ============================================================================

-- Test organization (Pro tier for full features)
INSERT INTO organizations (id, name, slug, plan, settings, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Buglens Demo Company',
  'buglens-demo',
  'pro',
  '{
    "slack_channel": "#engineering-bugs",
    "notification_level": "high",
    "auto_analyze": true,
    "daily_digest": true,
    "weekly_report": true
  }'::jsonb,
  NOW() - INTERVAL '90 days',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  plan = EXCLUDED.plan,
  settings = EXCLUDED.settings,
  updated_at = NOW();

-- Test users
INSERT INTO users (id, org_id, email, name, role, password_hash, email_verified, created_at)
VALUES
  (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000001',
    'admin@buglens-demo.com',
    'Alice Admin',
    'owner',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4EdwSBQrA4JSWWGW', -- password: Demo123!
    true,
    NOW() - INTERVAL '90 days'
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000001',
    'dev@buglens-demo.com',
    'Bob Developer',
    'member',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4EdwSBQrA4JSWWGW',
    true,
    NOW() - INTERVAL '60 days'
  ),
  (
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000001',
    'viewer@buglens-demo.com',
    'Carol Viewer',
    'viewer',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4EdwSBQrA4JSWWGW',
    true,
    NOW() - INTERVAL '30 days'
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. INTEGRATIONS
-- ============================================================================

INSERT INTO integrations (id, org_id, type, config, is_active, created_at)
VALUES
  (
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000001',
    'sentry',
    '{
      "dsn": "https://abc123@o123456.ingest.sentry.io/1234567",
      "project_id": "1234567",
      "organization_slug": "buglens-demo"
    }'::jsonb,
    true,
    NOW() - INTERVAL '80 days'
  ),
  (
    '00000000-0000-0000-0000-000000000202',
    '00000000-0000-0000-0000-000000000001',
    'github',
    '{
      "installation_id": "12345678",
      "app_id": "123456",
      "repositories": ["buglens-demo/web-app", "buglens-demo/api-server"]
    }'::jsonb,
    true,
    NOW() - INTERVAL '80 days'
  ),
  (
    '00000000-0000-0000-0000-000000000203',
    '00000000-0000-0000-0000-000000000001',
    'slack',
    '{
      "workspace_id": "T1234567890",
      "channel_id": "C1234567890",
      "channel_name": "#engineering-bugs",
      "bot_token": "xoxb-xxx"
    }'::jsonb,
    true,
    NOW() - INTERVAL '70 days'
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. REPOSITORIES
-- ============================================================================

INSERT INTO repos (id, org_id, provider, owner, name, full_name, default_branch, is_active, created_at)
VALUES
  (
    '00000000-0000-0000-0000-000000000301',
    '00000000-0000-0000-0000-000000000001',
    'github',
    'buglens-demo',
    'web-app',
    'buglens-demo/web-app',
    'main',
    true,
    NOW() - INTERVAL '80 days'
  ),
  (
    '00000000-0000-0000-0000-000000000302',
    '00000000-0000-0000-0000-000000000001',
    'github',
    'buglens-demo',
    'api-server',
    'buglens-demo/api-server',
    'main',
    true,
    NOW() - INTERVAL '80 days'
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 4. EVENTS (Realistic error samples)
-- ============================================================================

-- Generate 50 realistic events over the past 30 days
INSERT INTO events (id, org_id, sentry_event_id, message, platform, environment, release, stack_trace, breadcrumbs, context, raw_payload, created_at, updated_at)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'sentry-' || i || '-' || EXTRACT(EPOCH FROM NOW())::int,
  CASE (i % 10)
    WHEN 0 THEN 'TypeError: Cannot read property ''name'' of undefined'
    WHEN 1 THEN 'ReferenceError: db is not defined'
    WHEN 2 THEN 'SyntaxError: Unexpected token < in JSON at position 0'
    WHEN 3 THEN 'TypeError: Cannot read property ''map'' of null'
    WHEN 4 THEN 'Error: Network request failed'
    WHEN 5 THEN 'UnhandledPromiseRejection: Connection refused'
    WHEN 6 THEN 'TypeError: undefined is not a function'
    WHEN 7 THEN 'RangeError: Maximum call stack size exceeded'
    WHEN 8 THEN 'Error: ENOENT: no such file or directory'
    ELSE 'Error: Internal server error'
  END,
  CASE (i % 3)
    WHEN 0 THEN 'javascript'
    WHEN 1 THEN 'node'
    ELSE 'typescript'
  END,
  CASE (i % 4)
    WHEN 0 THEN 'production'
    WHEN 1 THEN 'staging'
    WHEN 2 THEN 'production'
    ELSE 'development'
  END,
  'v1.' || (i % 5) || '.' || (i % 10),
  jsonb_build_object(
    'frames', jsonb_build_array(
      jsonb_build_object(
        'filename', 'src/services/user.ts',
        'lineno', 42 + i,
        'colno', 15,
        'function', 'getUserById',
        'in_app', true
      ),
      jsonb_build_object(
        'filename', 'src/controllers/api.ts',
        'lineno', 128,
        'colno', 8,
        'function', 'handleRequest',
        'in_app', true
      )
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'timestamp', (NOW() - (i || ' hours')::interval)::text,
      'category', 'http',
      'message', 'GET /api/users/' || i
    ),
    jsonb_build_object(
      'timestamp', (NOW() - (i || ' hours')::interval - INTERVAL '1 second')::text,
      'category', 'console',
      'message', 'Fetching user data...'
    )
  ),
  jsonb_build_object(
    'user', jsonb_build_object('id', 'user-' || i, 'email', 'user' || i || '@example.com'),
    'browser', jsonb_build_object('name', 'Chrome', 'version', '120.0'),
    'os', jsonb_build_object('name', 'macOS', 'version', '14.2')
  ),
  jsonb_build_object(
    'event_id', 'sentry-' || i,
    'exception', jsonb_build_object(
      'values', jsonb_build_array(
        jsonb_build_object(
          'type', CASE (i % 5)
            WHEN 0 THEN 'TypeError'
            WHEN 1 THEN 'ReferenceError'
            WHEN 2 THEN 'SyntaxError'
            WHEN 3 THEN 'RangeError'
            ELSE 'Error'
          END,
          'value', 'Error message ' || i
        )
      )
    )
  ),
  NOW() - ((50 - i) || ' hours')::interval,
  NOW() - ((50 - i) || ' hours')::interval
FROM generate_series(1, 50) AS i
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 5. RCA JOBS
-- ============================================================================

-- Create RCA jobs for events (80% completed, 10% processing, 10% pending)
INSERT INTO rca_jobs (id, org_id, event_id, status, started_at, completed_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  e.id,
  CASE
    WHEN random() < 0.8 THEN 'done'
    WHEN random() < 0.9 THEN 'analyzing'
    ELSE 'pending'
  END,
  e.created_at + INTERVAL '1 second',
  CASE WHEN random() < 0.8
    THEN e.created_at + (INTERVAL '20 seconds' + (random() * INTERVAL '40 seconds'))
    ELSE NULL
  END,
  e.created_at,
  e.created_at + INTERVAL '30 seconds'
FROM events e
WHERE e.org_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 6. RCA RESULTS
-- ============================================================================

-- Create RCA results for completed jobs
INSERT INTO rca_results (id, org_id, job_id, root_cause, suggested_fix, confidence, causal_chain, evidence_refs, llm_model, llm_tokens_used, error_category, created_at)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  j.id,
  CASE (ROW_NUMBER() OVER (ORDER BY j.created_at) % 5)::int
    WHEN 0 THEN 'Missing null check: The code attempts to access a property on an object that may be undefined. The database query returned null when no matching record was found, but the code assumes a record always exists.'
    WHEN 1 THEN 'Variable scope issue: The variable "db" is referenced before it was declared in this scope. This is likely a module import that was not properly included at the top of the file.'
    WHEN 2 THEN 'Invalid JSON response: The API endpoint returned HTML instead of JSON, likely due to an authentication redirect or server error page. The frontend code expected valid JSON.'
    WHEN 3 THEN 'Infinite recursion: A recursive function lacks a proper base case, causing the call stack to exceed the maximum size. Review the recursion termination condition.'
    ELSE 'Network connectivity: The database connection was refused, likely due to the database server being unavailable or a misconfigured connection string.'
  END,
  CASE (ROW_NUMBER() OVER (ORDER BY j.created_at) % 5)::int
    WHEN 0 THEN 'Add a null check before accessing the property: `if (user && user.name) { ... }` or use optional chaining: `user?.name`'
    WHEN 1 THEN 'Add the missing import at the top of the file: `import { db } from ''./database'';`'
    WHEN 2 THEN 'Add response type checking before parsing: `if (response.headers.get(''content-type'')?.includes(''application/json'')) { ... }`'
    WHEN 3 THEN 'Add a base case to terminate recursion: `if (depth > MAX_DEPTH) return;` or `if (items.length === 0) return result;`'
    ELSE 'Check database connection settings. Verify DATABASE_URL environment variable and ensure database server is running. Add connection retry logic with exponential backoff.'
  END,
  0.65 + (random() * 0.30), -- Confidence between 0.65 and 0.95
  ARRAY[
    'Error thrown at src/services/user.ts:42',
    'Called from src/controllers/api.ts:128',
    'Triggered by HTTP request to /api/users/:id'
  ],
  ARRAY[
    'stack_trace:frame_0',
    'breadcrumb:http_request',
    'context:user_session'
  ],
  'gpt-4o-mini',
  1500 + (random() * 1000)::int,
  CASE (ROW_NUMBER() OVER (ORDER BY j.created_at) % 4)::int
    WHEN 0 THEN 'null_pointer'
    WHEN 1 THEN 'undefined_reference'
    WHEN 2 THEN 'type_mismatch'
    ELSE 'network_error'
  END,
  j.completed_at
FROM rca_jobs j
WHERE j.org_id = '00000000-0000-0000-0000-000000000001'
  AND j.status = 'done'
  AND j.completed_at IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 7. COST METRICS (Last 90 days)
-- ============================================================================

INSERT INTO cost_metrics (id, org_id, date, llm_tokens_used, llm_cost_usd, github_requests, events_processed, created_at)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  (CURRENT_DATE - (i || ' days')::interval)::date,
  50000 + (random() * 30000)::int,  -- 50K-80K tokens per day
  1.5 + (random() * 2.0),            -- $1.50-$3.50 per day
  200 + (random() * 150)::int,       -- 200-350 GitHub requests
  20 + (random() * 30)::int,         -- 20-50 events processed
  NOW() - (i || ' days')::interval
FROM generate_series(1, 90) AS i
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 8. CODE SNAPSHOTS (Sample cached code)
-- ============================================================================

INSERT INTO code_snapshots (id, org_id, repo_id, file_path, commit_sha, content, created_at)
VALUES
  (
    '00000000-0000-0000-0000-000000000401',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000301',
    'src/services/user.ts',
    'abc123def456789',
    E'import { db } from ''./database'';\n\nexport async function getUserById(id: string) {\n  const user = await db.users.findUnique({ where: { id } });\n  return user.name; // BUG: user might be null\n}\n',
    NOW() - INTERVAL '7 days'
  ),
  (
    '00000000-0000-0000-0000-000000000402',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000301',
    'src/controllers/api.ts',
    'abc123def456789',
    E'import { getUserById } from ''../services/user'';\n\nexport async function handleRequest(req, res) {\n  const userId = req.params.id;\n  const user = await getUserById(userId);\n  res.json({ name: user.name });\n}\n',
    NOW() - INTERVAL '7 days'
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 9. SESSIONS (For auth testing)
-- ============================================================================

INSERT INTO sessions (id, user_id, refresh_token, expires_at, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000101',
  'demo_refresh_token_12345',
  NOW() + INTERVAL '30 days',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- COMMIT
-- ============================================================================

COMMIT;

-- Verify data
SELECT 'Organizations: ' || COUNT(*) FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT 'Users: ' || COUNT(*) FROM users WHERE org_id = '00000000-0000-0000-0000-000000000001';
SELECT 'Integrations: ' || COUNT(*) FROM integrations WHERE org_id = '00000000-0000-0000-0000-000000000001';
SELECT 'Events: ' || COUNT(*) FROM events WHERE org_id = '00000000-0000-0000-0000-000000000001';
SELECT 'RCA Jobs: ' || COUNT(*) FROM rca_jobs WHERE org_id = '00000000-0000-0000-0000-000000000001';
SELECT 'RCA Results: ' || COUNT(*) FROM rca_results WHERE org_id = '00000000-0000-0000-0000-000000000001';
SELECT 'Cost Metrics (days): ' || COUNT(*) FROM cost_metrics WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- Summary
SELECT '=== Seed Data Complete ===' as status;
SELECT 'Test org ID: 00000000-0000-0000-0000-000000000001' as info;
SELECT 'Login: admin@buglens-demo.com / Demo123!' as credentials;
