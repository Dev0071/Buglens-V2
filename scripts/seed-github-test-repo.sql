-- Seed data for GitHub integration testing
-- Run with: psql $DATABASE_URL -f scripts/seed-github-test-repo.sql

-- First ensure the test organization exists
INSERT INTO organizations (id, name, slug, plan, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'Buglens Development',
    'buglens-dev',
    'pro',
    NOW(),
    NOW()
) ON CONFLICT (id) DO NOTHING;

-- Register the test GitHub repository
-- Note: secret_id points to where the GitHub App private key is stored
-- For local dev, we're using a placeholder since we load the key from file
INSERT INTO repos (
    org_id,
    provider,
    owner,
    name,
    full_name,
    installation_id,
    secret_id,
    default_branch,
    is_active,
    created_at,
    updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'github',
    'Dev0071',
    'Buglens-V2',
    'Dev0071/Buglens-V2',
    '97391346',
    'local-dev-key',  -- Placeholder for local development
    'main',
    true,
    NOW(),
    NOW()
) ON CONFLICT (org_id, provider, full_name) DO UPDATE SET
    installation_id = EXCLUDED.installation_id,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- Verify the repo was created
SELECT
    id,
    full_name,
    installation_id,
    is_active
FROM repos
WHERE org_id = '00000000-0000-0000-0000-000000000000';
