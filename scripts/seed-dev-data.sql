-- Seed script for local development
-- Run with: psql -U buglens -d buglens_dev -f scripts/seed-dev-data.sql

-- Create test organization
INSERT INTO organizations (id, name, slug, plan, settings)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'Test Organization',
  'test-org',
  'pro',
  '{}'
)
ON CONFLICT (id) DO NOTHING;

-- Create test user
INSERT INTO users (org_id, email, name, role)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'dev@test.com',
  'Dev User',
  'owner'
)
ON CONFLICT (email) DO NOTHING;

-- Create test integration (Sentry)
INSERT INTO integrations (org_id, type, config, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'sentry',
  '{"dsn": "https://test@sentry.io/123", "project_id": "123"}',
  true
)
ON CONFLICT (org_id, type) DO NOTHING;

-- Create test repository
INSERT INTO repos (
  org_id,
  provider,
  owner,
  name,
  full_name,
  default_branch,
  secret_id,
  is_active
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'github',
  'test-owner',
  'test-repo',
  'test-owner/test-repo',
  'main',
  'test-secret',
  true
)
ON CONFLICT (org_id, provider, full_name) DO NOTHING;

COMMIT;
