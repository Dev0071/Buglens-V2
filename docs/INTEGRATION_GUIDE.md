# Buglens Integration Guide

## Table of Contents

1. [Repository Registration Flow](#1-repository-registration-flow)
2. [GitHub App Installation Guide](#2-github-app-installation-guide)
3. [Sentry Integration Guide](#3-sentry-integration-guide)
4. [Testing the Integrations](#4-testing-the-integrations)

---

## 1. Repository Registration Flow

### When Repos Get Registered

Repositories are automatically registered in the database when:

1. **GitHub App Installation** (`installation.created` webhook)
   - When a user installs the Buglens GitHub App
   - All selected repositories are immediately registered

2. **Repository Addition** (`installation_repositories.added` webhook)
   - When user adds repos to an existing installation via GitHub settings

3. **Manual Registration** (Admin API - not yet implemented)
   - Future: Admin can manually add repos via API

### How Registration Works

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    REPO REGISTRATION FLOW                                 │
│                                                                           │
│   GitHub                    Buglens                      Database         │
│     │                          │                            │             │
│     │ ──── Webhook ──────────▶ │                            │             │
│     │   installation.created   │                            │             │
│     │                          │                            │             │
│     │                          │ ── Verify HMAC ──────────▶ │             │
│     │                          │                            │             │
│     │                          │ ── Find/Create Org ──────▶ │             │
│     │                          │    (by account.login)      │             │
│     │                          │                            │             │
│     │                          │ ── Bulk INSERT repos ────▶ │             │
│     │                          │    (with ON CONFLICT)      │             │
│     │                          │                            │             │
│     │ ◀──── 200 OK ────────── │                            │             │
└──────────────────────────────────────────────────────────────────────────┘
```

### Database Schema (`repos` table)

```sql
CREATE TABLE repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'github',
  owner TEXT NOT NULL,           -- e.g., "acme-corp"
  name TEXT NOT NULL,            -- e.g., "my-app"
  full_name TEXT NOT NULL,       -- e.g., "acme-corp/my-app"
  default_branch TEXT NOT NULL DEFAULT 'main',
  installation_id TEXT,          -- GitHub App Installation ID
  secret_id TEXT NOT NULL,       -- For secure operations
  is_active BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint prevents duplicate repos per org
UNIQUE (org_id, provider, full_name)
```

### Code Reference

**File:** `src/api/routes/github-webhooks.ts`

```typescript
// Registration function (bulk insert)
async function registerRepositories(
  orgId: string,
  installationId: number,
  repositories: Repository[]
): Promise<void> {
  // Builds batch INSERT with ON CONFLICT for upsert
  await pool.query(
    `
    INSERT INTO repos (org_id, provider, owner, name, full_name,
                       default_branch, installation_id, secret_id, is_active)
    VALUES ${valuePlaceholders}
    ON CONFLICT (org_id, provider, full_name) DO UPDATE SET
      installation_id = EXCLUDED.installation_id,
      default_branch = EXCLUDED.default_branch,
      is_active = true,
      updated_at = NOW()
  `,
    values
  );
}
```

### Repo Deactivation

Repos are **deactivated** (not deleted) when:

- GitHub App is uninstalled → all repos set `is_active = false`
- Repos removed from installation → specific repos deactivated

---

## 2. GitHub App Installation Guide

### Prerequisites

1. Admin access to your GitHub organization
2. Buglens account with organization created
3. Access to GitHub Developer Settings

### Step 1: Create GitHub App (One-time Setup)

1. Go to **GitHub > Settings > Developer Settings > GitHub Apps**
2. Click **"New GitHub App"**
3. Configure the app:

```
App Name: Buglens RCA (or your custom name)
Homepage URL: https://buglens.io
Webhook URL: https://api.buglens.io/webhooks/github
Webhook Secret: [Generate a strong random string]
```

4. Set permissions:

| Permission          | Access Level | Purpose                        |
| ------------------- | ------------ | ------------------------------ |
| Repository contents | Read         | Fetch source code for analysis |
| Metadata            | Read         | List repos, branches           |

5. Subscribe to events:
   - `installation`
   - `installation_repositories`
   - `push` (optional, for cache invalidation)

6. Generate and download the **private key** (.pem file)

7. Note your **App ID** (shown on app settings page)

### Step 2: Configure Buglens Backend

Add these environment variables:

```bash
# .env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-webhook-secret-here
```

Or use AWS Secrets Manager:

```bash
GITHUB_APP_PRIVATE_KEY_SECRET_ID=arn:aws:secretsmanager:...
```

### Step 3: Install the App on Your Organization

1. Go to your GitHub App's public page:
   `https://github.com/apps/YOUR-APP-NAME`

2. Click **"Install"** or **"Configure"**

3. Select your organization

4. Choose repositories:
   - **All repositories** - Auto-registers all (including future repos)
   - **Only select repositories** - Choose specific repos

5. Click **"Install"**

### What Happens After Installation

```
1. GitHub sends `installation.created` webhook
2. Buglens verifies HMAC signature
3. Organization created (if new) with slug from GitHub login
4. All selected repositories registered in `repos` table
5. GitHub installation_id stored for future API calls
```

### Step 4: Verify Installation

Check the database:

```sql
-- See registered organizations
SELECT id, name, slug, created_at FROM organizations;

-- See registered repos
SELECT r.full_name, r.installation_id, r.is_active, o.name as org
FROM repos r
JOIN organizations o ON r.org_id = o.id;
```

Or check API:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://api.buglens.io/api/integrations
```

---

## 3. Sentry Integration Guide

### Prerequisites

1. Sentry account with admin access to your project
2. Buglens organization already created
3. Your Buglens org_id (UUID)

### Step 1: Get Your Buglens Webhook URL

Your Sentry webhook URL format:

```
https://api.buglens.io/webhooks/sentry/{org_id}
```

Where `{org_id}` is your Buglens organization UUID.

### Step 2: Configure Sentry Webhook

1. Go to **Sentry > Settings > Integrations**

2. Search for **"Webhooks"** integration

3. Click **"Add to Project"**

4. Configure webhook:

```
Callback URL: https://api.buglens.io/webhooks/sentry/YOUR_ORG_ID
Secret: [Generate and save - MUST match SENTRY_CLIENT_SECRET]
```

5. Enable events:
   - ✅ `error.created` (required)
   - ✅ `issue.created` (optional)

### Step 3: Configure Buglens Backend

```bash
# .env
SENTRY_CLIENT_SECRET=your-sentry-webhook-secret
ALLOW_DEV_ERRORS=false  # Set true only for testing
```

### Step 4: Configure Sentry SDK in Your App

Your application's Sentry SDK MUST include:

```javascript
// sentry.config.js
Sentry.init({
  dsn: "https://xxx@sentry.io/123",

  // CRITICAL for Buglens:
  release: "my-app@1.2.3", // Links to Git commit
  environment: "production", // Must NOT be "development"

  // RECOMMENDED:
  integrations: [
    new Sentry.Integrations.BrowserTracing({
      tracingOrigins: ["localhost", "your-api.com"],
    }),
  ],

  // Capture stack traces
  attachStacktrace: true,
});
```

### Environment Filtering

Buglens processes errors from these environments:

- ✅ `production`, `staging`, `qa`, `uat`, `preview`

Buglens ignores:

- ❌ `development`, `dev`, `local`, `localhost`, `test`

### What Happens When Error Occurs

```
1. Error thrown in your app
2. Sentry SDK captures and sends to Sentry
3. Sentry triggers webhook to Buglens
4. Buglens verifies HMAC signature
5. Validates environment (rejects dev/local)
6. Stores event in `events` table
7. Creates RCA job in queue
8. Worker fetches code, runs analysis
9. LLM generates root cause explanation
10. Results stored, notification sent
```

### Step 5: Test the Integration

Send a test error:

```javascript
// In your production/staging environment
try {
  throw new Error("Test Buglens integration");
} catch (e) {
  Sentry.captureException(e);
}
```

Check Buglens:

```bash
# Check events
curl -H "Authorization: Bearer $TOKEN" \
  https://api.buglens.io/api/events

# Check RCA jobs
curl -H "Authorization: Bearer $TOKEN" \
  https://api.buglens.io/api/rca/jobs
```

---

## 4. Testing the Integrations

### Local Development Setup

1. **Start infrastructure:**

```bash
docker-compose up -d
```

2. **Run migrations:**

```bash
npm run migrate
```

3. **Seed test data:**

```bash
npm run db:seed
```

4. **Start backend:**

```bash
npm run dev
```

### Testing GitHub Webhook

Use ngrok for local testing:

```bash
# Terminal 1: Start ngrok
ngrok http 3001

# Terminal 2: Update GitHub App webhook URL to ngrok URL
# Then trigger by installing app on a test repo
```

Or use curl to simulate:

```bash
# Calculate HMAC signature
PAYLOAD='{"action":"created","installation":{"id":123,"account":{"login":"test-org"}},"repositories":[{"name":"test-repo","full_name":"test-org/test-repo"}]}'
SECRET="your-webhook-secret"
SIGNATURE="sha256=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)"

# Send webhook
curl -X POST http://localhost:3001/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: installation" \
  -H "X-GitHub-Delivery: test-123" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  -d "$PAYLOAD"
```

### Testing Sentry Webhook

```bash
# Create test organization first
ORG_ID="550e8400-e29b-41d4-a716-446655440000"

# Simulate Sentry webhook
curl -X POST "http://localhost:3001/webhooks/sentry/$ORG_ID" \
  -H "Content-Type: application/json" \
  -H "Sentry-Hook-Signature: [calculate-hmac]" \
  -d '{
    "event_id": "abc123",
    "message": "TypeError: Cannot read property x of undefined",
    "environment": "production",
    "exception": {
      "values": [{
        "type": "TypeError",
        "value": "Cannot read property x of undefined",
        "stacktrace": {
          "frames": [{
            "filename": "src/api/handler.js",
            "function": "handleRequest",
            "lineno": 42,
            "colno": 15,
            "in_app": true
          }]
        }
      }]
    }
  }'
```

### Running Integration Tests

```bash
# All tests
npm test

# GitHub webhook tests only
npm test -- tests/integration/github-webhook-auth.test.ts

# Sentry webhook tests only
npm test -- tests/integration/sentry-webhook.test.ts

# With coverage
npm test -- --coverage
```

---

## Troubleshooting

### GitHub Integration Issues

| Problem                      | Solution                                           |
| ---------------------------- | -------------------------------------------------- |
| "Invalid signature"          | Check `GITHUB_WEBHOOK_SECRET` matches App settings |
| "No repositories found"      | Verify App has correct permissions                 |
| "Installation token expired" | Check Redis is running (tokens cached)             |
| "Rate limit exceeded"        | Wait 1 hour or upgrade plan                        |

### Sentry Integration Issues

| Problem                | Solution                                     |
| ---------------------- | -------------------------------------------- |
| "Invalid signature"    | Check `SENTRY_CLIENT_SECRET` matches webhook |
| "Environment filtered" | Use `production`/`staging` not `development` |
| "No stack trace"       | Enable `attachStacktrace: true` in SDK       |
| "Missing release"      | Add `release` to Sentry.init() config        |

### Database Issues

```bash
# Check connection
psql $DATABASE_URL -c "SELECT 1"

# Check repos table
psql $DATABASE_URL -c "SELECT * FROM repos LIMIT 5"

# Check if RLS is blocking
psql $DATABASE_URL -c "SET app.current_org_id = 'your-org-id'; SELECT * FROM repos;"
```

---

## Quick Reference

### Environment Variables

```bash
# Required
DATABASE_URL=postgres://user:pass@localhost:5432/buglens
REDIS_URL=redis://localhost:6379

# GitHub Integration
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA..."
GITHUB_WEBHOOK_SECRET=your-secret

# Sentry Integration
SENTRY_CLIENT_SECRET=your-sentry-secret

# Optional
ALLOW_DEV_ERRORS=false
LOG_LEVEL=info
```

### API Endpoints

| Endpoint                           | Method | Purpose               |
| ---------------------------------- | ------ | --------------------- |
| `/webhooks/github`                 | POST   | GitHub App webhooks   |
| `/webhooks/sentry/:org_id`         | POST   | Sentry error webhooks |
| `/api/events`                      | GET    | List captured events  |
| `/api/rca/:id`                     | GET    | Get RCA result        |
| `/api/integrations`                | GET    | List integrations     |
| `/api/integrations/:type/connect`  | GET    | OAuth connect flow    |
| `/api/integrations/:type/callback` | GET    | OAuth callback        |

---

## 5. Jira Integration

Jira integration allows automatic issue creation from RCAs.

### Setup Steps

1. **Create an Atlassian OAuth App:**
   - Go to [developer.atlassian.com](https://developer.atlassian.com/console/myapps/)
   - Click "Create" → "OAuth 2.0 integration"
   - Name: "Buglens"
   - Add callback URL: `https://api.your-domain.com/api/integrations/jira/callback`

2. **Configure Permissions:**
   - Add scopes: `read:jira-work`, `write:jira-work`, `read:jira-user`, `offline_access`

3. **Get Credentials:** Copy Client ID and Client Secret

4. **In Buglens Dashboard:**
   - Go to Integrations → Jira → Connect
   - Authorize with Atlassian
   - Select your Jira site

### Environment Variables

```bash
JIRA_CLIENT_ID=your-jira-client-id
JIRA_CLIENT_SECRET=your-jira-client-secret
```

---

## 6. Microsoft Teams Integration

Teams integration sends RCA notifications to Teams channels.

### Setup Steps

1. **Register an Azure AD App:**
   - Go to [Azure Portal](https://portal.azure.com) → Azure Active Directory
   - App registrations → New registration
   - Name: "Buglens Notifications"
   - Redirect URI (Web): `https://api.your-domain.com/api/integrations/teams/callback`

2. **Configure API Permissions:**
   - Add Microsoft Graph: `ChannelMessage.Send`, `offline_access`

3. **Create Client Secret:**
   - Go to Certificates & secrets → New client secret

4. **In Buglens Dashboard:**
   - Go to Integrations → Microsoft Teams → Connect
   - Sign in with Microsoft

### Environment Variables

```bash
TEAMS_CLIENT_ID=your-azure-app-client-id
TEAMS_CLIENT_SECRET=your-azure-client-secret
TEAMS_TENANT_ID=common  # or your specific tenant ID
```

---

## Integration Status Summary

| Integration | Auth Type | Status              |
| ----------- | --------- | ------------------- |
| Sentry      | Webhook   | ✅ Production Ready |
| GitHub      | OAuth 2.0 | ✅ Production Ready |
| Slack       | OAuth 2.0 | ✅ Production Ready |
| Jira        | OAuth 2.0 | ✅ Production Ready |
| Teams       | OAuth 2.0 | ✅ Production Ready |

---

**End of Integration Guide**
