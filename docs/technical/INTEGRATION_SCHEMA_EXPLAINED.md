# Integration Schema & GitHub Access Strategy

## Database Schema Overview

### Integrations Table Columns

```sql
CREATE TABLE integrations (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL,                    -- 'github_app', 'github', 'slack', etc.

  -- Legacy column (being phased out)
  config JSONB,                          -- Old unstructured config (nullable now)

  -- New structured columns
  status TEXT NOT NULL DEFAULT 'connected',     -- 'connected', 'disconnected', 'error'
  display_name TEXT,                            -- Human-readable name
  external_id TEXT,                             -- Provider's installation/team ID
  encrypted_tokens JSONB NOT NULL,              -- Encrypted OAuth tokens
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,  -- Non-sensitive integration data

  -- State tracking
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Column Use Cases

#### 1. **`config` (DEPRECATED - Legacy)**

- **Purpose**: Originally stored ALL integration data (tokens + metadata)
- **Problem**: Mixed sensitive and non-sensitive data, hard to query
- **Current State**: Nullable, being phased out
- **Migration**: New integrations use `encrypted_tokens` + `metadata`

#### 2. **`encrypted_tokens` (REQUIRED)**

- **Purpose**: Store OAuth tokens and secrets securely
- **Format**: JSONB encrypted with org-specific key
- **Example**:
  ```json
  {
    "data": "ENCRYPTED_BASE64_STRING",
    "encryptedAt": "2025-12-27T22:00:00Z",
    "keyVersion": "1"
  }
  ```
- **Contents (decrypted)**:
  ```json
  {
    "access_token": "ghp_xxx",
    "refresh_token": "ghr_xxx", // If applicable
    "expires_at": 1735344000 // Unix timestamp
  }
  ```

#### 3. **`metadata` (REQUIRED)**

- **Purpose**: Store non-sensitive integration data that's queryable
- **Format**: JSONB (unencrypted)
- **Examples**:

  **GitHub App:**

  ```json
  {
    "installationId": 101500883,
    "accountLogin": "YourOrg",
    "accountId": 12345,
    "accountType": "Organization",
    "permissions": {
      "contents": "read",
      "metadata": "read"
    },
    "repositorySelection": "all",
    "selectedRepos": ["owner/repo1", "owner/repo2"]
  }
  ```

  **Slack:**

  ```json
  {
    "teamId": "T123456",
    "teamName": "Engineering",
    "channel": "#errors",
    "webhookUrl": "https://hooks.slack.com/..."
  }
  ```

#### 4. **`display_name`**

- **Purpose**: Human-readable label for multi-integration scenarios
- **Examples**:
  - "GitHub (YourOrg repos)"
  - "GitHub (Personal)"
  - "Slack (#engineering)"
  - "Slack (#production)"

#### 5. **`external_id`**

- **Purpose**: Provider's unique identifier for this integration
- **Examples**:
  - GitHub App: `"101500883"` (installation_id)
  - Slack: `"T123456"` (team_id)
  - Jira: `"cloud-id-xxx"` (cloud_id)
- **Use Case**: Prevents duplicate installations, enables lookups

#### 6. **`status`**

- **Purpose**: Current connection state
- **Values**:
  - `connected`: Working and verified
  - `disconnected`: User manually disconnected
  - `error`: Token expired or API error
- **Note**: Currently using `is_active` instead (will migrate later)

#### 7. **`is_active`**

- **Purpose**: Boolean flag for active/inactive state
- **Current Use**: Primary source of truth (overrides `status` column)
- **Logic**:
  - `true` → Show "Disconnect" button
  - `false` → Show "Connect" button

---

## GitHub Integration Strategy

### Three GitHub Integration Types

#### 1. **GitHub OAuth App** (User-Level Access)

- **Type in DB**: `github`
- **Scope**: User's personal repos + orgs they belong to
- **Use Case**: Initial MVP, simple setup
- **Token**: User access token (long-lived)
- **Permissions**: Whatever user has on repos
- **Stored in**: `encrypted_tokens`
  ```json
  {
    "access_token": "ghp_usertoken",
    "login": "username",
    "repos": ["user/repo1", "user/repo2"]
  }
  ```

#### 2. **GitHub App** (Org-Level Access) ⭐ **RECOMMENDED**

- **Type in DB**: `github_app`
- **Scope**: Org repos or specific repos
- **Use Case**: Production (better security, fine-grained permissions)
- **Token**: Installation access token (expires hourly, auto-refreshed)
- **Permissions**: Configured at app level (`contents: read`)
- **Stored in**: `encrypted_tokens` + `metadata`

  ```json
  // encrypted_tokens (decrypted)
  {
    "access_token": "ghs_installationtoken",
    "expires_at": 1735344000
  }

  // metadata
  {
    "installationId": 101500883,
    "accountLogin": "YourOrg",
    "permissions": {"contents": "read"}
  }
  ```

#### 3. **GitHub App + JWT** (Platform-Level)

- **Type**: Backend service authentication
- **Use Case**: Buglens backend generates installation tokens on-demand
- **Storage**: Private key in environment variable
- **Process**:
  1. Backend has GitHub App private key
  2. Creates JWT signed with private key
  3. Exchanges JWT for installation access token
  4. Uses token to fetch code
  5. Token expires in 1 hour, regenerate as needed

---

## Code Fetcher Requirements

### What We Need to Fetch Code

The **CodeFetcher** needs to access:

1. **Repository content** (`GET /repos/{owner}/{repo}/contents/{path}`)
2. **Specific commit/ref** (`?ref={sha}`)
3. **Base64 decode** file content

### Required GitHub Permissions

```
contents: read    ✅ REQUIRED - Read repository files
metadata: read    ✅ INCLUDED - Repository metadata
```

### All Three Integration Types Work! ✅

| Integration Type          | Code Fetcher Compatible? | How It Works                                          |
| ------------------------- | ------------------------ | ----------------------------------------------------- |
| **GitHub OAuth App**      | ✅ YES                   | User token → Fetch any repo user has access to        |
| **GitHub App**            | ✅ YES                   | Installation token → Fetch org/repo files             |
| **GitHub App (Platform)** | ✅ YES                   | Backend generates tokens → Fetch using installationId |

### Current Implementation (Platform GitHub App)

**Flow:**

1. User installs GitHub App on their org/repos
2. Backend stores `installation_id` in `metadata.installationId`
3. When code is needed:
   ```typescript
   const installationId = await getInstallationId(orgId, repoFullName);
   const token = await getInstallationAccessToken(installationId);
   const fileContent = await fetchFileContent(token, owner, repo, path, ref);
   ```

**Code Reference:**

```typescript
// src/services/github.ts
export async function fetchFileContent(
  installationId: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  orgId: string
): Promise<GitHubFileContent | null> {
  const octokit = await getInstallationOctokit(installationId);

  const response = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
    ref, // commit SHA
  });

  return response.data; // Base64 encoded content
}
```

---

## RCA Process Integration Points

### 1. **Sentry Webhook** → Event Received

```
Event includes:
- error message
- stack trace (file paths, line numbers)
- release tag (contains commit SHA)
- project name
```

### 2. **Extract Repository Info**

```typescript
// From event.release: "myapp@abc123def"
const commitSha = extractCommitFromRelease(event.release);

// From integration: "YourOrg/myapp"
const repo = await getRepoForProject(orgId, event.project);
```

### 3. **Fetch Code for Stack Frames**

```typescript
const installationId = await getInstallationId(orgId, repo);

for (const frame of event.stacktrace.frames) {
  const codeContext = await codeFetcherService.fetchCodeForFrame(frame, {
    orgId,
    installationId,
    repo,
    ref: commitSha,
  });
}
```

### 4. **Requirements Met?** ✅

| Requirement                          | GitHub App Provides            | Status |
| ------------------------------------ | ------------------------------ | ------ |
| Read file content at specific commit | `repos.getContent({ref: sha})` | ✅     |
| Access private repos                 | Installation permissions       | ✅     |
| Handle source maps                   | Fetch `.map` files             | ✅     |
| Rate limiting                        | 5000/hr per installation       | ✅     |
| Caching                              | 3-tier cache (Redis→S3→DB)     | ✅     |

---

## Decision: Use GitHub App (Platform)

### Why GitHub App > OAuth App?

| Feature            | GitHub OAuth App   | GitHub App                          |
| ------------------ | ------------------ | ----------------------------------- |
| **Scope**          | User-level         | Org/repo-level                      |
| **Permissions**    | User's permissions | Fine-grained (`contents:read` only) |
| **Token Lifetime** | No expiration      | 1 hour (auto-refresh)               |
| **Revocation**     | User can revoke    | Admin controls                      |
| **Rate Limit**     | 5000/hr shared     | 5000/hr per installation            |
| **Security**       | User token in DB   | Installation tokens short-lived     |
| **Multi-Org**      | Separate per user  | Per org installation                |

### Current Implementation Status

✅ **GitHub App is implemented and working**

- Installation ID stored in `metadata.installationId`
- Backend generates short-lived tokens using App private key
- CodeFetcher uses `installationId` to fetch files
- Frontend normalizes `github_app` → `github` for display

### Column Usage Summary

```typescript
// When GitHub App is installed:
INSERT INTO integrations (
  org_id: "uuid",
  type: "github_app",                    // Backend type
  external_id: "101500883",              // Installation ID
  display_name: "GitHub (YourOrg)",      // UI label
  status: "connected",                   // Connection state
  is_active: true,                       // Active flag ⭐ SOURCE OF TRUTH
  encrypted_tokens: {                    // Sensitive data
    data: "ENCRYPTED_ACCESS_TOKEN",
    expiresAt: 1735344000
  },
  metadata: {                            // Queryable data
    installationId: 101500883,
    accountLogin: "YourOrg",
    accountType: "Organization",
    permissions: {"contents": "read"},
    repositorySelection: "all"
  }
)

// Frontend sees:
{
  id: "uuid",
  type: "github",                        // Normalized from github_app
  name: "GitHub",
  status: "connected"                    // Computed from is_active
}
```

---

## Recommendations

### Short Term (Current)

1. ✅ Use `is_active` as source of truth for connection status
2. ✅ Keep `status` column for future use
3. ✅ Normalize `github_app` → `github` in API responses
4. ✅ Store installation tokens in `encrypted_tokens`
5. ✅ Store installation metadata in `metadata`

### Long Term (Phase 2)

1. Migrate away from `config` column entirely
2. Use `status` column for richer states (expiring, refreshing, etc.)
3. Add `status_details` JSONB for error messages/diagnostics
4. Implement token refresh monitoring
5. Add webhook for installation events (repo added/removed)

### For Multi-Integration Support

```sql
-- Allow multiple GitHub installations per org
UNIQUE (org_id, type, external_id)

-- Example: Multiple Slack workspaces
INSERT INTO integrations (org_id, type, external_id, display_name)
VALUES
  ('org1', 'slack', 'T123', 'Slack (#engineering)'),
  ('org1', 'slack', 'T456', 'Slack (#production)');
```

---

## Conclusion

**All three GitHub integration types work for code fetching**, but **GitHub App (Platform)** is the best choice for production:

- ✅ Fine-grained permissions
- ✅ Better security (short-lived tokens)
- ✅ Org-level control
- ✅ Higher rate limits
- ✅ Already implemented and working

The schema supports future expansion with `metadata` for queryable data and `encrypted_tokens` for secrets.
