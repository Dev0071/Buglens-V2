-- Setup script for testing with your Next.js app
-- Run with: psql "$DATABASE_URL" -f scripts/setup-nextjs-test.sql

-- Create your test organization (use a stable UUID you can reference)
INSERT INTO organizations (id, name, slug, plan, settings)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'My Next.js Test Org',
  'nextjs-test-org',
  'pro',
  '{}'
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Register your Next.js repository
-- IMPORTANT: Update 'owner/repo' to match your actual GitHub repo
-- Update installation_id to your GitHub App installation ID
INSERT INTO repos (
  org_id,
  provider,
  owner,
  name,
  full_name,
  default_branch,
  installation_id,
  secret_id,
  is_active
)
VALUES (
  '21111111-1111-1111-1111-111111111111',
  'github',
  'YOUR_GITHUB_USERNAME',  -- Replace with your GitHub username
  'YOUR_REPO_NAME',        -- Replace with your repo name
  'YOUR_GITHUB_USERNAME/YOUR_REPO_NAME',  -- Replace: owner/repo format
  'main',
  'YOUR_INSTALLATION_ID',  -- Your GitHub App installation ID from .env
  'nextjs-test-secret',
  true
)
ON CONFLICT (org_id, provider, full_name) DO UPDATE SET
  installation_id = EXCLUDED.installation_id,
  is_active = true;

-- Verify setup
SELECT 'Organization:' as type, id, name, plan FROM organizations WHERE id = '11111111-1111-1111-1111-111111111111'
UNION ALL
SELECT 'Repository:', id::text, full_name, installation_id FROM repos WHERE org_id = '11111111-1111-1111-1111-111111111111';
