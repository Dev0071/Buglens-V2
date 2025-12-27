# Platform-Owned OAuth Architecture

## Overview

Buglens uses a **platform-owned OAuth** architecture where all OAuth applications (Google, GitHub, Slack, etc.) are owned and managed by Buglens itself. Users simply click "Connect" - no configuration required.

This is the same pattern used by Vercel, Netlify, Linear, Heroku, and other modern SaaS platforms.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PLATFORM-OWNED OAUTH                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐       ┌──────────────────────────────────┐               │
│   │   BUGLENS    │       │      OAUTH PROVIDERS              │              │
│   │   PLATFORM   │       │  ┌──────────┐ ┌──────────┐       │              │
│   │              │       │  │  Google  │ │  GitHub  │       │              │
│   │  Owns OAuth  │◄─────►│  │  OAuth   │ │  OAuth   │       │              │
│   │  Apps/Keys   │       │  │   App    │ │   App    │       │              │
│   │              │       │  └──────────┘ └──────────┘       │              │
│   └──────┬───────┘       │  ┌──────────┐ ┌──────────┐       │              │
│          │               │  │  GitHub  │ │  Slack   │       │              │
│          │               │  │   App    │ │   App    │       │              │
│          │               │  │(Install) │ │          │       │              │
│          │               │  └──────────┘ └──────────┘       │              │
│          │               └──────────────────────────────────┘               │
│          │                                                                   │
│          ▼                                                                   │
│   ┌──────────────────────────────────────────────────────────────┐          │
│   │                    ENCRYPTED TOKEN STORAGE                    │          │
│   │  ┌─────────────────────────────────────────────────────────┐ │          │
│   │  │  Org A: AES-256-GCM encrypted tokens (GitHub, Slack)   │ │          │
│   │  ├─────────────────────────────────────────────────────────┤ │          │
│   │  │  Org B: AES-256-GCM encrypted tokens (Google, GitHub)  │ │          │
│   │  ├─────────────────────────────────────────────────────────┤ │          │
│   │  │  Org C: AES-256-GCM encrypted tokens (Slack, Jira)     │ │          │
│   │  └─────────────────────────────────────────────────────────┘ │          │
│   └──────────────────────────────────────────────────────────────┘          │
│                                                                              │
│          ▼                                                                   │
│   ┌──────────────────────────────────────────────────────────────┐          │
│   │                        USERS                                  │          │
│   │  ┌───────────┐  ┌───────────┐  ┌───────────┐                │          │
│   │  │  User 1   │  │  User 2   │  │  User 3   │                │          │
│   │  │ (Org A)   │  │ (Org B)   │  │ (Org C)   │                │          │
│   │  │           │  │           │  │           │                │          │
│   │  │  Just     │  │  Just     │  │  Just     │                │          │
│   │  │  clicks   │  │  clicks   │  │  clicks   │                │          │
│   │  │ "Connect" │  │ "Connect" │  │ "Connect" │                │          │
│   │  └───────────┘  └───────────┘  └───────────┘                │          │
│   └──────────────────────────────────────────────────────────────┘          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## OAuth & Install Flow Step-by-Step

### Flow 1: User Sign-In (Google/GitHub OAuth)

```
┌───────────┐     ┌───────────────┐     ┌──────────────┐     ┌───────────┐
│   User    │     │   Buglens     │     │   Buglens    │     │  Google/  │
│  Browser  │     │   Frontend    │     │   Backend    │     │  GitHub   │
└─────┬─────┘     └───────┬───────┘     └──────┬───────┘     └─────┬─────┘
      │                   │                    │                   │
      │ 1. Click "Sign in │                    │                   │
      │    with Google"   │                    │                   │
      │ ─────────────────>│                    │                   │
      │                   │                    │                   │
      │                   │ 2. Redirect to     │                   │
      │                   │    /api/auth/google│                   │
      │ <────────────────────────────────────────                  │
      │                   │                    │                   │
      │ 3. GET /api/auth/google               │                   │
      │ ──────────────────────────────────────>│                   │
      │                   │                    │                   │
      │                   │                    │ 4. Generate PKCE  │
      │                   │                    │    code_verifier  │
      │                   │                    │    & code_challenge
      │                   │                    │                   │
      │                   │                    │ 5. Set cookies:   │
      │                   │                    │    - oauth_state  │
      │                   │                    │    - oauth_verifier
      │                   │                    │                   │
      │ 6. 302 Redirect to Google OAuth        │                   │
      │ <─────────────────────────────────────────────────────────>│
      │                   │                    │                   │
      │ 7. User approves in Google             │                   │
      │ ──────────────────────────────────────────────────────────>│
      │                   │                    │                   │
      │ 8. Google redirects with code          │                   │
      │ <─────────────────────────────────────────────────────────│
      │    /api/auth/google/callback?code=xxx&state=yyy           │
      │                   │                    │                   │
      │ 9. Backend exchanges code for tokens   │                   │
      │ ──────────────────────────────────────>│                   │
      │                   │                    │ ──────────────────>│
      │                   │                    │ <──────────────────│
      │                   │                    │   access_token,   │
      │                   │                    │   refresh_token   │
      │                   │                    │                   │
      │                   │                    │ 10. Fetch user info
      │                   │                    │ ──────────────────>│
      │                   │                    │ <──────────────────│
      │                   │                    │                   │
      │                   │                    │ 11. Create/update │
      │                   │                    │     user record   │
      │                   │                    │     Generate JWT  │
      │                   │                    │                   │
      │ 12. Redirect to app with JWT           │                   │
      │ <──────────────────────────────────────│                   │
      │    Set refreshToken cookie             │                   │
      │                   │                    │                   │
      ▼                   ▼                    ▼                   ▼
```

### Flow 2: Integration Installation (GitHub App)

```
┌───────────┐     ┌───────────────┐     ┌──────────────┐     ┌───────────┐
│   User    │     │   Buglens     │     │   Buglens    │     │  GitHub   │
│  Browser  │     │   Frontend    │     │   Backend    │     │   App     │
└─────┬─────┘     └───────┬───────┘     └──────┬───────┘     └─────┬─────┘
      │                   │                    │                   │
      │ 1. Click "Connect │                    │                   │
      │    GitHub Repos"  │                    │                   │
      │ ─────────────────>│                    │                   │
      │                   │                    │                   │
      │                   │ 2. GET /api/integrations/github/connect
      │                   │ ───────────────────>│                   │
      │                   │                    │                   │
      │                   │                    │ 3. Generate state │
      │                   │                    │    Store orgId    │
      │                   │                    │                   │
      │ 4. 302 Redirect to GitHub App install  │                   │
      │ <─────────────────────────────────────────────────────────>│
      │    github.com/apps/buglens/installations/new               │
      │                   │                    │                   │
      │ 5. User selects repos to grant access  │                   │
      │ ──────────────────────────────────────────────────────────>│
      │                   │                    │                   │
      │ 6. GitHub redirects with installation_id                   │
      │ <─────────────────────────────────────────────────────────│
      │    /api/integrations/github/callback?installation_id=xxx   │
      │                   │                    │                   │
      │ 7. Backend receives installation       │                   │
      │ ──────────────────────────────────────>│                   │
      │                   │                    │                   │
      │                   │                    │ 8. Get app JWT    │
      │                   │                    │    using private  │
      │                   │                    │    key            │
      │                   │                    │                   │
      │                   │                    │ 9. Get installation
      │                   │                    │    access token   │
      │                   │                    │ ──────────────────>│
      │                   │                    │ <──────────────────│
      │                   │                    │                   │
      │                   │                    │ 10. Encrypt token │
      │                   │                    │     with org key  │
      │                   │                    │     Store in DB   │
      │                   │                    │                   │
      │ 11. Redirect to settings/success       │                   │
      │ <──────────────────────────────────────│                   │
      │                   │                    │                   │
      ▼                   ▼                    ▼                   ▼
```

### Flow 3: Slack App Installation

```
┌───────────┐     ┌───────────────┐     ┌──────────────┐     ┌───────────┐
│   User    │     │   Buglens     │     │   Buglens    │     │   Slack   │
│  Browser  │     │   Frontend    │     │   Backend    │     │   OAuth   │
└─────┬─────┘     └───────┬───────┘     └──────┬───────┘     └─────┬─────┘
      │                   │                    │                   │
      │ 1. Click "Connect │                    │                   │
      │    Slack"         │                    │                   │
      │ ─────────────────>│                    │                   │
      │                   │                    │                   │
      │                   │ 2. GET /api/integrations/slack/connect │
      │                   │ ───────────────────>│                   │
      │                   │                    │                   │
      │                   │                    │ 3. Generate state │
      │                   │                    │    Build auth URL │
      │                   │                    │    with scopes:   │
      │                   │                    │    - chat:write   │
      │                   │                    │    - channels:read│
      │                   │                    │    etc.           │
      │                   │                    │                   │
      │ 4. 302 Redirect to Slack OAuth         │                   │
      │ <─────────────────────────────────────────────────────────>│
      │                   │                    │                   │
      │ 5. User approves Slack permissions     │                   │
      │ ──────────────────────────────────────────────────────────>│
      │                   │                    │                   │
      │ 6. Slack redirects with code           │                   │
      │ <─────────────────────────────────────────────────────────│
      │                   │                    │                   │
      │ 7. Backend exchanges code              │                   │
      │ ──────────────────────────────────────>│ ──────────────────>│
      │                   │                    │ <──────────────────│
      │                   │                    │   bot_token,      │
      │                   │                    │   team info,      │
      │                   │                    │   webhook URL     │
      │                   │                    │                   │
      │                   │                    │ 8. Encrypt and    │
      │                   │                    │    store tokens   │
      │                   │                    │                   │
      │ 9. Redirect to success                 │                   │
      │ <──────────────────────────────────────│                   │
      ▼                   ▼                    ▼                   ▼
```

---

## Backend Implementation Examples

### 1. Platform Credentials Service

The credentials service loads OAuth app secrets from environment variables. Users never see or configure these.

```typescript
// src/services/platform-credentials.ts

class PlatformCredentialsService {
  /**
   * Check if a provider is configured at platform level
   */
  isConfigured(provider: ProviderType): boolean {
    switch (provider) {
      case "google":
        return !!(
          config.GOOGLE_OAUTH_CLIENT_ID && config.GOOGLE_OAUTH_CLIENT_SECRET
        );
      case "github":
        return !!(
          config.GITHUB_OAUTH_CLIENT_ID && config.GITHUB_OAUTH_CLIENT_SECRET
        );
      case "slack":
        return !!(config.SLACK_CLIENT_ID && config.SLACK_CLIENT_SECRET);
      default:
        return false;
    }
  }

  /**
   * Get Google OAuth credentials (platform-owned)
   */
  getGoogleOAuth(): OAuthAppCredentials | null {
    if (!this.isConfigured("google")) return null;
    return {
      clientId: config.GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET!,
    };
  }
}

// Singleton - loaded once at startup
export const platformCredentials = new PlatformCredentialsService();
```

### 2. OAuth Flow with PKCE

```typescript
// src/services/oauth.ts

/**
 * Generate PKCE code verifier (43-128 chars)
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Generate code challenge from verifier (S256 method)
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto
    .createHash("sha256")
    .update(verifier)
    .digest()
    .toString("base64url");
}

/**
 * Build Google OAuth URL with PKCE
 */
export function getGoogleAuthUrl(state: string, codeChallenge: string): string {
  const credentials = platformCredentials.getGoogleOAuth();
  if (!credentials) throw new Error("Google OAuth not configured");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("redirect_uri", `${BASE_URL}/api/auth/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline"); // Get refresh token

  return url.toString();
}
```

### 3. Encrypted Token Storage

```typescript
// src/services/crypto.ts

/**
 * Encrypt tokens with organization-specific key
 * Uses AES-256-GCM for authenticated encryption
 */
export function encryptForOrg(
  data: string | object,
  orgId: string
): EncryptedData {
  const key = getOrgKey(orgId); // Derived from JWT_SECRET + orgId
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    data: Buffer.concat([iv, authTag, encrypted]).toString("base64"),
  };
}

/**
 * Decrypt tokens with organization-specific key
 */
export function decryptForOrg<T>(encrypted: EncryptedData, orgId: string): T {
  const key = getOrgKey(orgId);
  const buffer = Buffer.from(encrypted.data, "base64");

  const iv = buffer.subarray(0, 16);
  const authTag = buffer.subarray(16, 32);
  const ciphertext = buffer.subarray(32);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}
```

### 4. Token Lifecycle Management

```typescript
// src/services/token-lifecycle.ts

/**
 * Refresh Google OAuth tokens before they expire
 */
async function refreshGoogleTokens(
  refreshToken: string
): Promise<TokenResponse | null> {
  const credentials = platformCredentials.getGoogleOAuth();
  if (!credentials) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) return null;
  return response.json();
}

/**
 * BullMQ job that runs every 5 minutes to refresh expiring tokens
 */
export async function tokenRefreshJobHandler(): Promise<void> {
  const expiringIntegrations = await query(`
    SELECT * FROM integrations
    WHERE status = 'connected'
    AND expires_at < NOW() + INTERVAL '10 minutes'
  `);

  for (const integration of expiringIntegrations.rows) {
    await refreshIntegrationTokens(integration.org_id, integration.id);
  }
}
```

---

## Frontend Integration Examples

### 1. One-Click Connection Button

```tsx
// web/src/components/IntegrationCard.tsx

interface IntegrationCardProps {
  type: "github" | "slack" | "google";
  name: string;
  connected: boolean;
  available: boolean; // From platform availability check
}

function IntegrationCard({
  type,
  name,
  connected,
  available,
}: IntegrationCardProps) {
  const handleConnect = async () => {
    // Fetch OAuth URL from backend (includes platform credentials)
    const response = await fetch(`/api/integrations/${type}/connect`);
    const { authUrl } = await response.json();

    // Redirect user to OAuth provider
    window.location.href = authUrl;
  };

  return (
    <div className="integration-card">
      <h3>{name}</h3>
      {!available ? (
        <span className="badge">Coming Soon</span>
      ) : connected ? (
        <button onClick={() => disconnect(type)}>Disconnect</button>
      ) : (
        <button onClick={handleConnect}>Connect {name}</button>
      )}
    </div>
  );
}
```

### 2. Fetching Available Providers

```tsx
// web/src/pages/settings/SettingsPage.tsx

function IntegrationsSettings() {
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);

  useEffect(() => {
    // Check which integrations the platform has configured
    fetch("/api/integrations/available")
      .then((res) => res.json())
      .then((data) => setAvailableProviders(data.providers));
  }, []);

  return (
    <div>
      <IntegrationCard
        type="github"
        name="GitHub"
        available={availableProviders.includes("github")}
        connected={/* from user data */}
      />
      <IntegrationCard
        type="slack"
        name="Slack"
        available={availableProviders.includes("slack")}
        connected={/* from user data */}
      />
    </div>
  );
}
```

### 3. Handling OAuth Callback

```tsx
// web/src/pages/settings/IntegrationCallback.tsx

function IntegrationCallback() {
  const searchParams = useSearchParams();
  const success = searchParams.get("success");
  const error = searchParams.get("error");

  useEffect(() => {
    if (success) {
      toast.success(
        `Successfully connected ${success.replace("_connected", "")}`
      );
    } else if (error) {
      toast.error(`Connection failed: ${error}`);
    }

    // Redirect back to settings after showing toast
    setTimeout(() => navigate("/settings/integrations"), 2000);
  }, [success, error]);

  return <div>Processing...</div>;
}
```

---

## How "No Env Vars for Users" is Achieved

### The Problem with Traditional OAuth

In traditional setups, every customer/deployment needs:

- Create their own Google OAuth App
- Create their own GitHub OAuth App
- Configure client IDs and secrets
- Handle callback URLs

This creates:

- Poor UX (users need to understand OAuth)
- Security risks (secrets in customer repos)
- Support burden (debugging customer OAuth misconfigurations)

### The Platform-Owned Solution

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         CREDENTIAL FLOW                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   PLATFORM LEVEL (Buglens owns this)                                     │
│   ┌────────────────────────────────────────────────────────────────┐    │
│   │  Environment Variables / AWS Secrets Manager                    │    │
│   │  ┌──────────────────────────────────────────────────────────┐  │    │
│   │  │  GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com   │  │    │
│   │  │  GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxx                   │  │    │
│   │  │  GITHUB_OAUTH_CLIENT_ID=Iv1.xxx                          │  │    │
│   │  │  GITHUB_OAUTH_CLIENT_SECRET=xxx                          │  │    │
│   │  │  GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----  │  │    │
│   │  │  SLACK_CLIENT_ID=xxx                                     │  │    │
│   │  │  SLACK_CLIENT_SECRET=xxx                                 │  │    │
│   │  └──────────────────────────────────────────────────────────┘  │    │
│   └────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│   ┌────────────────────────────────────────────────────────────────┐    │
│   │  PlatformCredentialsService (loaded at startup)                │    │
│   │  - Single source of truth for OAuth app credentials            │    │
│   │  - Validates all required credentials are present              │    │
│   │  - Exposes only via getter methods (never logged)              │    │
│   └────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│   USER LEVEL (per-tenant)                                                │
│   ┌────────────────────────────────────────────────────────────────┐    │
│   │  User clicks "Connect GitHub"                                   │    │
│   │  ↓                                                              │    │
│   │  Backend uses platform credentials to build OAuth URL          │    │
│   │  ↓                                                              │    │
│   │  User approves (they're authorizing Buglens's app)             │    │
│   │  ↓                                                              │    │
│   │  Backend receives tokens, encrypts with org-specific key       │    │
│   │  ↓                                                              │    │
│   │  Tokens stored in database (encrypted per-tenant)              │    │
│   │                                                                 │    │
│   │  User NEVER provides:                                          │    │
│   │  ✗ Client ID                                                   │    │
│   │  ✗ Client Secret                                               │    │
│   │  ✗ Webhook secrets                                             │    │
│   │  ✗ Private keys                                                │    │
│   └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Key Implementation Details

1. **Platform Secrets Management**

   ```typescript
   // Credentials loaded from env vars at startup
   // In production: AWS Secrets Manager, HashiCorp Vault, etc.
   class PlatformCredentialsService {
     private credentials: Map<string, OAuthCredentials>;

     constructor() {
       // Load once, validate all required
       this.credentials = this.loadFromEnv();
     }
   }
   ```

2. **Tenant Isolation**

   ```typescript
   // Each org gets its own encryption key
   function getOrgKey(orgId: string): Buffer {
     return deriveKey(JWT_SECRET, `buglens-org-key:${orgId}`);
   }

   // Tokens encrypted per-org
   const encrypted = encryptForOrg(tokens, user.orgId);
   ```

3. **Dynamic Provider Availability**
   ```typescript
   // Frontend only shows integrations that are configured
   GET /api/integrations/available
   → { providers: ["github", "slack"] } // Only configured ones
   ```

---

## Tradeoffs and Limitations

### Tradeoffs

| Aspect              | Platform-Owned                | User-Provided                  |
| ------------------- | ----------------------------- | ------------------------------ |
| **User Experience** | ✅ One-click setup            | ❌ Complex configuration       |
| **Security**        | ✅ Secrets in secure vault    | ❌ Secrets in customer repos   |
| **Rate Limits**     | ⚠️ Shared across all users    | ✅ Per-customer limits         |
| **Customization**   | ❌ Fixed scopes/permissions   | ✅ Custom OAuth apps           |
| **Auditability**    | ⚠️ All activity from one app  | ✅ Per-customer audit trails   |
| **Compliance**      | ⚠️ Data flows through Buglens | ✅ Direct customer-to-provider |

### Limitations

#### 1. Rate Limits (GitHub/Slack/Google)

- **Problem**: All customers share Buglens's API rate limits
- **Mitigation**:
  - Aggressive caching (3-tier: Redis → S3 → API)
  - Request deduplication
  - Per-org rate limiting at Buglens level

#### 2. OAuth App Review

- **Problem**: Buglens's OAuth apps need approval from each provider
- **Mitigation**:
  - Complete OAuth verification early (Google, Slack, GitHub)
  - Document required scopes clearly
  - Use minimum necessary permissions

#### 3. Token Revocation

- **Problem**: If Buglens's OAuth app is compromised, all customer tokens are at risk
- **Mitigation**:
  - Secure credential storage (AWS Secrets Manager)
  - Key rotation strategy
  - Monitoring for suspicious activity

#### 4. Enterprise Customers

- **Problem**: Some enterprises require BYO OAuth apps for security/compliance
- **Future**: Consider "BYOA" (Bring Your Own App) mode for enterprise tier

#### 5. Provider Outages

- **Problem**: If Buglens's OAuth app is rate-limited or blocked, all customers affected
- **Mitigation**:
  - Multiple backup OAuth apps
  - Graceful degradation
  - Status page integration

### Security Considerations

1. **Credential Protection**
   - Never log OAuth secrets
   - Store in AWS Secrets Manager or similar
   - Rotate credentials periodically

2. **Token Encryption**
   - AES-256-GCM with per-org keys
   - Key derivation from master secret + org ID
   - Auth tag for tamper detection

3. **PKCE for Auth Flows**
   - Prevents authorization code interception
   - Required for public clients
   - Used even for server-side flows (defense in depth)

4. **State Parameter**
   - CSRF protection
   - One-time use (consumed on validation)
   - Short TTL (10 minutes)

````

---

## Development Testing Guide

### Single Account Testing Strategy

When you have only one GitHub account and one Google account, you can still comprehensively test all OAuth flows using different testing scenarios and careful session management.

#### Prerequisites

1. **Set up OAuth applications** as described in the Environment Variables section
2. **Configure your .env file** with the correct credentials
3. **Use different browsers/incognito sessions** for isolation

### Testing Google OAuth Login

#### Test 1: Initial Google Sign-In

```bash
# 1. Start your development server
npm run dev

# 2. Open browser to http://localhost:3000
# 3. Click "Sign in with Google"
# 4. Complete Google OAuth flow
# 5. Verify you're redirected to dashboard
````

**Expected Flow:**

1. Redirected to `accounts.google.com/o/oauth2/v2/auth`
2. Google shows permission screen (first time only)
3. After approval, redirected to `/api/auth/google/callback?code=...`
4. Backend exchanges code for tokens
5. User created in database with Google identity
6. Redirected to dashboard with JWT cookie set

#### Test 2: Google Sign-In with Existing Account

```bash
# 1. Sign out from Buglens (but stay signed in to Google)
# 2. Click "Sign in with Google" again
# 3. Should auto-approve (no permission screen)
# 4. Should log you back in to same Buglens account
```

#### Test 3: Google Token Refresh (Advanced)

```sql
-- Manually expire the Google token to test refresh
UPDATE integrations
SET expires_at = NOW() - INTERVAL '1 hour'
WHERE type = 'google' AND org_id = 'your-org-id';
```

### Testing GitHub OAuth Login

#### Test 1: Initial GitHub Sign-In

```bash
# 1. Use incognito window or different browser
# 2. Go to http://localhost:3000
# 3. Click "Sign in with GitHub"
# 4. Complete GitHub OAuth flow
```

**Expected Flow:**

1. Redirected to `github.com/login/oauth/authorize`
2. GitHub shows permission screen
3. After approval, redirected to `/api/auth/github/callback?code=...`
4. Backend exchanges code for tokens
5. New user created (or existing user linked if same email)

#### Test 2: Account Linking Scenario

If your Google and GitHub accounts use the same email:

```bash
# 1. Sign in with Google first (creates user account)
# 2. Sign out
# 3. Sign in with GitHub using same email
# 4. Should link to existing user account, not create new one
```

### Testing GitHub App Integration

The GitHub App integration is separate from GitHub OAuth login - it's for accessing repositories.

#### Test 1: Install GitHub App on Personal Account

```bash
# 1. Sign in to Buglens (using Google or GitHub OAuth)
# 2. Go to Settings → Integrations
# 3. Click "Connect GitHub Repos"
# 4. This will redirect to GitHub App installation
```

**GitHub App Installation URL Format:**

```
https://github.com/apps/your-app-name/installations/new?state=<state>
```

#### Test 2: Select Repository Access

When installing the GitHub App:

1. **Option A: All Repositories**
   - Select "All repositories"
   - Gives Buglens access to all current and future repos

2. **Option B: Selected Repositories**
   - Choose specific repos (recommended for testing)
   - Select 1-2 test repositories

#### Test 3: Verify Installation Success

After GitHub App installation:

```bash
# Check the callback was successful
# URL should be: /api/integrations/github/callback?installation_id=12345

# Verify in database
SELECT * FROM integrations WHERE type = 'github_app';
```

#### Test 4: Test Repository Access

```bash
# Use the GitHub integration to fetch repository data
curl -X GET "http://localhost:3000/api/integrations/github/repos" \
  -H "Authorization: Bearer your-jwt-token"

# Should return list of accessible repositories
```

### Testing Multiple Organizations

Even with one GitHub account, you can test multi-tenancy:

#### Test 1: Create Multiple Buglens Organizations

```bash
# 1. Sign up with Google → Creates Organization A
# 2. Sign out
# 3. Clear browser data or use incognito
# 4. Sign up with GitHub → Creates Organization B
# 5. Both orgs will have separate encrypted token storage
```

#### Test 2: Test Organization Isolation

```sql
-- Verify tokens are stored per-organization
SELECT org_id, type, created_at
FROM integrations
ORDER BY org_id, type;

-- Should see separate entries for each org
```

### Advanced Testing Scenarios

#### Test 1: OAuth Error Handling & User Cancellation

OAuth flows can fail in multiple ways - users can cancel, deny permissions, or network errors can occur. The system must handle all these gracefully.

**Test 1.1: User Cancels GitHub Authorization**

```bash
# 1. Click "Sign in with GitHub"
# 2. On GitHub's authorization page, click "Cancel"
# 3. GitHub redirects with error parameter:
#    http://localhost:3000/api/auth/github/callback?error=access_denied&error_description=The+user+has+denied+your+application+access
# 4. Backend should:
#    - Detect error=access_denied
#    - Log the cancellation
#    - Redirect to: /login?error=oauth_cancelled&provider=github
# 5. Frontend should:
#    - Parse error parameter
#    - Show toast: "GitHub sign-in was cancelled"
#    - Display login options again
```

**Expected Error Types:**

- `access_denied` - User clicked "Cancel" or denied permissions
- `invalid_state` - CSRF token mismatch (potential attack or session expired)
- `invalid_client` - OAuth app credentials incorrect
- `unauthorized_client` - OAuth app not approved by provider

**Test 1.2: User Cancels Google Authorization**

```bash
# 1. Click "Sign in with Google"
# 2. On Google's consent screen, click "Cancel"
# 3. Google redirects with:
#    http://localhost:3000/api/auth/google/callback?error=access_denied
# 4. Backend redirects to: /login?error=oauth_cancelled&provider=google
# 5. Frontend shows: "Google sign-in was cancelled. Please try again."
```

**Test 1.3: Invalid State Parameter (CSRF Protection)**

```bash
# Simulate CSRF attack or expired session
curl "http://localhost:3000/api/auth/github/callback?code=abc123&state=tampered_state"

# Expected response:
# - HTTP 302 redirect to /login?error=invalid_state
# - Frontend shows: "Session expired. Please try signing in again."
```

**Test 1.4: Expired Authorization Code**

```bash
# OAuth codes expire after ~10 minutes
# Simulate delayed callback processing
curl "http://localhost:3000/api/auth/google/callback?code=expired_code&state=valid_state"

# Expected response:
# - Token exchange fails with 400 Bad Request
# - Backend redirects to: /login?error=oauth_failed&provider=google
# - Frontend shows: "Sign-in failed. Please try again."
```

**Test 1.5: Network Errors During Token Exchange**

```javascript
// Mock network failure in tests
// src/services/oauth.test.ts
it("should handle network errors during token exchange", async () => {
  // Mock fetch to throw network error
  global.fetch = jest.fn(() => Promise.reject(new Error("Network error")));

  const result = await exchangeGoogleCode("valid_code", "valid_verifier");

  expect(result).toBeNull();
  // Should log error and redirect user gracefully
});
```

**Test 1.6: GitHub App Installation Cancellation**

```bash
# 1. Click "Connect GitHub Repos"
# 2. On GitHub App installation page, click "Cancel"
# 3. GitHub redirects to: /api/integrations/github/callback?setup_action=cancelled
# 4. Backend should:
#    - Detect setup_action=cancelled
#    - Redirect to: /settings/integrations?error=installation_cancelled
# 5. Frontend should:
#    - Show toast: "GitHub App installation was cancelled"
#    - Keep integration card in "Not Connected" state
```

**Frontend Error Handling Implementation:**

The LoginPage must handle all error query parameters:

```typescript
// web/src/pages/auth/LoginPage.tsx
const [searchParams] = useSearchParams();
const error = searchParams.get("error");
const provider = searchParams.get("provider");

useEffect(() => {
  if (error) {
    const errorMessages: Record<string, string> = {
      oauth_cancelled: `${provider || "OAuth"} sign-in was cancelled`,
      invalid_state: "Session expired. Please try signing in again.",
      oauth_failed: `${provider || "OAuth"} sign-in failed. Please try again.`,
      oauth_verification_failed:
        "Failed to verify your account. Please try again.",
      access_denied: `Access was denied. Please check permissions and try again.`,
    };

    toast.error(errorMessages[error] || "An error occurred. Please try again.");
  }
}, [error, provider]);
```

**Backend Error Handling Pattern:**

```typescript
// src/api/routes/auth.ts
// Handle OAuth errors consistently
function handleOAuthError(
  reply: FastifyReply,
  error: string,
  provider: string,
  description?: string
): void {
  logger.error(`OAuth error for ${provider}:`, { error, description });

  const errorMap: Record<string, string> = {
    access_denied: "oauth_cancelled",
    invalid_request: "oauth_failed",
    unauthorized_client: "oauth_failed",
    server_error: "oauth_failed",
  };

  const mappedError = errorMap[error] || "oauth_failed";

  return reply.redirect(`/login?error=${mappedError}&provider=${provider}`);
}

// In callback handler
app.get("/api/auth/github/callback", async (request, reply) => {
  const { code, state, error, error_description } = request.query;

  // Handle OAuth provider errors first
  if (error) {
    return handleOAuthError(reply, error, "github", error_description);
  }

  // Validate state (CSRF protection)
  const savedState = request.cookies.oauth_state;
  if (!state || state !== savedState) {
    return handleOAuthError(reply, "invalid_state", "github");
  }

  // Clear state cookie (one-time use)
  reply.clearCookie("oauth_state");

  try {
    // Exchange code for tokens
    const tokens = await exchangeGitHubCode(code, verifier);

    if (!tokens) {
      return handleOAuthError(reply, "token_exchange_failed", "github");
    }

    // Success path...
  } catch (err) {
    logger.error("OAuth callback error:", err);
    return handleOAuthError(reply, "oauth_failed", "github");
  }
});
```

**Test 1.7: Invalid State Parameter**

```bash
# Test invalid state parameter
curl "http://localhost:3000/api/auth/google/callback?code=valid&state=invalid"
# Should return error and redirect to login with error message

# Test expired/invalid authorization code
curl "http://localhost:3000/api/auth/google/callback?code=expired&state=valid"
# Should handle gracefully and show error
```

#### Test 2: Token Encryption/Decryption

```javascript
// Test in Node.js REPL or test file
const { encryptForOrg, decryptForOrg } = require("./src/services/crypto");

const testToken = { access_token: "test123", refresh_token: "refresh456" };
const orgId = "test-org-id";

const encrypted = encryptForOrg(testToken, orgId);
console.log("Encrypted:", encrypted);

const decrypted = decryptForOrg(encrypted, orgId);
console.log("Decrypted:", decrypted);
// Should match original testToken
```

#### Test 3: Session Management

```bash
# Test multiple browser sessions
# Browser 1: Sign in as Google user in Org A
# Browser 2: Sign in as GitHub user in Org B
# Both should maintain separate sessions
```

### Debugging OAuth Issues

#### Enable Debug Logging

```bash
# Add to your .env
LOG_LEVEL=debug

# This will show detailed OAuth flow information
```

#### Common Issues and Solutions

**Issue: "invalid_client" error**

```bash
# Check your client ID and secret are correct
# Verify redirect URI matches exactly (including http vs https)
```

**Issue: "access_denied" error**

```bash
# User canceled OAuth flow
# Check if OAuth app permissions are too broad
```

**Issue: Token refresh fails**

```bash
# Check if refresh_token was properly stored
# Verify token refresh endpoint is correct
```

#### Test Data Cleanup

```sql
-- Reset test data between runs
DELETE FROM integrations WHERE org_id LIKE 'test-%';
DELETE FROM users WHERE email LIKE '%+test@%';
DELETE FROM organizations WHERE name LIKE 'Test%';
```

### Testing Checklist

- [ ] Google OAuth sign-in creates user account
- [ ] GitHub OAuth sign-in creates user account
- [ ] Same email links accounts (doesn't duplicate)
- [ ] GitHub App installation stores credentials
- [ ] GitHub App can fetch repository list
- [ ] Tokens are encrypted per-organization
- [ ] Sign-out clears JWT cookies
- [ ] Error states handle gracefully
- [ ] Multiple browser sessions work independently
- [ ] Token refresh works for long-running sessions

### Mock Data for Testing

```javascript
// For unit tests - mock OAuth responses
export const mockGoogleTokenResponse = {
  access_token: "ya29.mock-access-token",
  refresh_token: "1//mock-refresh-token",
  expires_in: 3600,
  token_type: "Bearer",
  scope: "openid email profile",
};

export const mockGoogleUserInfo = {
  id: "123456789",
  email: "test@example.com",
  name: "Test User",
  picture: "https://lh3.googleusercontent.com/a/mock-avatar",
};

export const mockGitHubAppInstallation = {
  id: 12345,
  account: {
    login: "testuser",
    type: "User",
  },
  repository_selection: "selected",
  repositories: [
    {
      id: 456789,
      name: "test-repo",
      full_name: "testuser/test-repo",
    },
  ],
};
```

---

## Environment Variables Reference

Required platform environment variables:

```bash
# Authentication (required)
JWT_SECRET=<min-32-char-secret>

# Google OAuth (optional - enables Google sign-in)
GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxx

# GitHub OAuth (optional - enables GitHub sign-in)
GITHUB_OAUTH_CLIENT_ID=Iv1.xxx
GITHUB_OAUTH_CLIENT_SECRET=xxx

# GitHub App (optional - enables repo integration)
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_APP_WEBHOOK_SECRET=xxx

# Slack App (optional - enables Slack notifications)
SLACK_CLIENT_ID=xxx
SLACK_CLIENT_SECRET=xxx
SLACK_SIGNING_SECRET=xxx

# Jira App (optional - enables Jira integration)
JIRA_CLIENT_ID=xxx
JIRA_CLIENT_SECRET=xxx

# Microsoft Teams (optional)
TEAMS_CLIENT_ID=xxx
TEAMS_CLIENT_SECRET=xxx
TEAMS_TENANT_ID=common
```

---

## Related Documentation

- [API Reference: /api/auth/\*](./API_AUTH.md)
- [API Reference: /api/integrations/\*](./API_INTEGRATIONS.md)
- [Token Lifecycle Management](./TOKEN_LIFECYCLE.md)
- [Security Model](./SECURITY.md)

---

## Integration Setup & Testing Guides

### Slack Integration Setup

Slack integration enables:

- **Event Notifications**: Alerts when new errors are detected from Sentry
- **RCA Notifications**: Alerts when Root Cause Analysis completes

#### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Enter App Name: `Buglens` and select your workspace
4. Navigate to **OAuth & Permissions**

#### 2. Configure OAuth Scopes

Add the following **Bot Token Scopes**:

- `chat:write` - Post messages
- `channels:read` - List channels
- `incoming-webhook` - Post via webhook (optional)

#### 3. Set Redirect URL

In **OAuth & Permissions** → **Redirect URLs**, add:

```
https://your-domain.com/api/integrations/slack/callback
```

#### 4. Get Credentials

From **Basic Information**, copy:

- **Client ID** → `SLACK_CLIENT_ID`
- **Client Secret** → `SLACK_CLIENT_SECRET`
- **Signing Secret** → `SLACK_SIGNING_SECRET`

Add to your `.env`:

```bash
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
SLACK_SIGNING_SECRET=your-signing-secret
```

#### 5. Install to Workspace

1. In Buglens, go to **Settings** → **Integrations**
2. Click **Connect Slack**
3. Authorize the app in your Slack workspace
4. Select a channel for notifications

#### Testing Slack Integration

```bash
# 1. Send a test notification via API
curl -X POST http://localhost:3001/api/integrations/slack/test \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"

# Expected response:
{
  "success": true,
  "message": "Test notification sent to Slack"
}
```

**Verify in Slack:**

- A test notification should appear in your configured channel
- Message should include "Test Error: Connection Timeout"

**Common Issues:**

- `channel_not_found`: The bot is not added to the channel
- `token_expired`: Re-authorize via Settings → Integrations
- `not_in_channel`: Invite @Buglens to the channel first

---

### Microsoft Teams Integration Setup

Teams integration enables:

- **Event Notifications**: Alerts when new errors are detected
- **RCA Notifications**: Alerts when Root Cause Analysis completes

#### 1. Register Azure AD Application

1. Go to [portal.azure.com](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations**
3. Click **New registration**
4. Configure:
   - Name: `Buglens`
   - Supported account types: **Accounts in any organizational directory**
   - Redirect URI: `Web` → `https://your-domain.com/api/integrations/teams/callback`

#### 2. Configure API Permissions

In **API permissions**, add Microsoft Graph permissions:

- `User.Read` (delegated)
- `Team.ReadBasic.All` (delegated)
- `Channel.ReadBasic.All` (delegated)
- `ChannelMessage.Send` (delegated)

Click **Grant admin consent** if you have admin privileges.

#### 3. Create Client Secret

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Copy the **Value** (shown only once)

#### 4. Get Credentials

From the app **Overview**, copy:

- **Application (client) ID** → `TEAMS_CLIENT_ID`
- **Directory (tenant) ID** → `TEAMS_TENANT_ID` (or use `common` for multi-tenant)

Add to your `.env`:

```bash
TEAMS_CLIENT_ID=your-client-id
TEAMS_CLIENT_SECRET=your-client-secret
TEAMS_TENANT_ID=common
```

#### 5. Connect in Buglens

1. Go to **Settings** → **Integrations**
2. Click **Connect Microsoft Teams**
3. Sign in with your Microsoft account
4. Grant permissions

#### Testing Teams Integration

```bash
# 1. Send a test notification via API
curl -X POST http://localhost:3001/api/integrations/teams/test \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"

# Expected response:
{
  "success": true,
  "message": "Test notification sent to Microsoft Teams"
}
```

**Common Issues:**

- `AADSTS50011`: Redirect URI mismatch - check Azure AD configuration
- `AADSTS65001`: Admin consent required - contact your IT admin
- `InvalidAuthenticationToken`: Token expired - reconnect the integration

---

### Jira Integration Setup

Jira integration enables:

- **Automatic Ticket Creation**: Create Jira issues from events or RCA results
- **Manual Ticket Creation**: Create tickets on-demand from the UI

#### 1. Create Atlassian OAuth App

1. Go to [developer.atlassian.com/console](https://developer.atlassian.com/console)
2. Click **Create** → **OAuth 2.0 integration**
3. Enter a name: `Buglens`
4. Enable **OAuth 2.0 (3LO)**

#### 2. Configure OAuth 2.0 Settings

In **Authorization**:

- **Callback URL**: `https://your-domain.com/api/integrations/jira/callback`

#### 3. Add API Scopes

In **Permissions**, add Jira API scopes:

- `read:jira-work` - Read Jira issues
- `write:jira-work` - Create/update issues
- `read:jira-user` - Read user information
- `offline_access` - Refresh tokens

#### 4. Get Credentials

From the app settings, copy:

- **Client ID** → `JIRA_CLIENT_ID`
- **Client Secret** → `JIRA_CLIENT_SECRET`

Add to your `.env`:

```bash
JIRA_CLIENT_ID=your-client-id
JIRA_CLIENT_SECRET=your-client-secret
```

#### 5. Connect in Buglens

1. Go to **Settings** → **Integrations**
2. Click **Connect Jira**
3. Choose your Atlassian site (if multiple)
4. Authorize Buglens

#### Configuring Jira Defaults

Set your default Jira project in organization settings:

```bash
# Update organization settings to set default project
curl -X PATCH http://localhost:3001/api/settings \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jira_default_project": "BUG",
    "jira_auto_create": true
  }'
```

#### Testing Jira Integration

```bash
# 1. Get available Jira projects
curl http://localhost:3001/api/integrations/jira/projects \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected response:
{
  "projects": [
    { "id": "10001", "key": "BUG", "name": "Bug Tracking" },
    { "id": "10002", "key": "DEV", "name": "Development" }
  ]
}

# 2. Create a ticket from an RCA result
curl -X POST http://localhost:3001/api/integrations/jira/tickets/rca \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rcaId": "your-rca-id",
    "projectKey": "BUG",
    "issueType": "Bug"
  }'

# Expected response:
{
  "success": true,
  "ticket": {
    "id": "12345",
    "key": "BUG-123",
    "self": "https://your-site.atlassian.net/rest/api/3/issue/12345"
  }
}
```

**Ticket Content:**
Created tickets include:

- Error summary as title
- Root cause analysis details
- Suggested fix (if available)
- Code location and snippet
- Link back to Buglens for full analysis

**Common Issues:**

- `No Jira project configured`: Set a default project in org settings
- `401 Unauthorized`: Token expired - reconnect via Settings
- `404 Project not found`: Verify the project key exists

---

### Notification Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     NOTIFICATION & TICKET FLOW                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐                                                      │
│   │   Sentry     │                                                      │
│   │   Webhook    │                                                      │
│   └──────┬───────┘                                                      │
│          │                                                               │
│          ▼                                                               │
│   ┌──────────────────────────────────────────────────────────────┐      │
│   │                    BUGLENS BACKEND                            │      │
│   │                                                               │      │
│   │   ┌────────────┐    ┌────────────┐    ┌────────────┐        │      │
│   │   │  Webhook   │───►│ Deterministic│───►│    LLM     │        │      │
│   │   │  Handler   │    │  Analyzer    │    │  Reasoning │        │      │
│   │   └──────┬─────┘    └────────────┘    └──────┬─────┘        │      │
│   │          │                                    │               │      │
│   │          │ Event Created                     │ RCA Complete   │      │
│   │          ▼                                    ▼               │      │
│   │   ┌────────────────────────────────────────────────┐        │      │
│   │   │           NOTIFICATION SERVICE                  │        │      │
│   │   │                                                 │        │      │
│   │   │  ┌─────────────────┐  ┌─────────────────┐     │        │      │
│   │   │  │  Check Prefs    │  │  Format Message │     │        │      │
│   │   │  │  - Severity     │  │  - Slack Blocks │     │        │      │
│   │   │  │  - Level        │  │  - Teams Cards  │     │        │      │
│   │   │  └────────┬────────┘  └────────┬────────┘     │        │      │
│   │   │           │                    │              │        │      │
│   │   └───────────┼────────────────────┼──────────────┘        │      │
│   │               │                    │                        │      │
│   └───────────────┼────────────────────┼────────────────────────┘      │
│                   │                    │                                │
│                   ▼                    ▼                                │
│   ┌───────────────────┐    ┌───────────────────┐                       │
│   │       SLACK       │    │   MICROSOFT       │                       │
│   │                   │    │     TEAMS         │                       │
│   │  ┌─────────────┐  │    │  ┌─────────────┐  │                       │
│   │  │  #errors    │  │    │  │  Teams      │  │                       │
│   │  │  channel    │  │    │  │  Channel    │  │                       │
│   │  └─────────────┘  │    │  └─────────────┘  │                       │
│   └───────────────────┘    └───────────────────┘                       │
│                                                                          │
│                   │ (If auto-create enabled)                            │
│                   ▼                                                      │
│   ┌───────────────────────────────────────────┐                         │
│   │               JIRA                         │                         │
│   │                                            │                         │
│   │   ┌──────────────────────────────────┐    │                         │
│   │   │  BUG-123: TypeError in app.js   │    │                         │
│   │   │                                   │    │                         │
│   │   │  Root Cause: Missing null check  │    │                         │
│   │   │  Suggested Fix: Add guard        │    │                         │
│   │   │                                   │    │                         │
│   │   │  [View in Buglens]               │    │                         │
│   │   └──────────────────────────────────┘    │                         │
│   └───────────────────────────────────────────┘                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Integration API Reference

#### Slack Endpoints

| Method   | Endpoint                           | Description            |
| -------- | ---------------------------------- | ---------------------- |
| `POST`   | `/api/integrations/slack/connect`  | Initiate Slack OAuth   |
| `GET`    | `/api/integrations/slack/callback` | OAuth callback         |
| `POST`   | `/api/integrations/slack/test`     | Send test notification |
| `DELETE` | `/api/integrations/slack`          | Disconnect Slack       |

#### Teams Endpoints

| Method   | Endpoint                           | Description            |
| -------- | ---------------------------------- | ---------------------- |
| `POST`   | `/api/integrations/teams/connect`  | Initiate Teams OAuth   |
| `GET`    | `/api/integrations/teams/callback` | OAuth callback         |
| `POST`   | `/api/integrations/teams/test`     | Send test notification |
| `DELETE` | `/api/integrations/teams`          | Disconnect Teams       |

#### Jira Endpoints

| Method   | Endpoint                                           | Description              |
| -------- | -------------------------------------------------- | ------------------------ |
| `POST`   | `/api/integrations/jira/connect`                   | Initiate Jira OAuth      |
| `GET`    | `/api/integrations/jira/callback`                  | OAuth callback           |
| `GET`    | `/api/integrations/jira/projects`                  | List available projects  |
| `GET`    | `/api/integrations/jira/projects/:key/issue-types` | Get issue types          |
| `POST`   | `/api/integrations/jira/tickets/event`             | Create ticket from event |
| `POST`   | `/api/integrations/jira/tickets/rca`               | Create ticket from RCA   |
| `DELETE` | `/api/integrations/jira`                           | Disconnect Jira          |

---

### Notification Preferences

Users can configure notification preferences per organization:

| Setting                | Values                            | Default | Description              |
| ---------------------- | --------------------------------- | ------- | ------------------------ |
| `notification_level`   | `all`, `high`, `critical`, `none` | `all`   | Filter by severity       |
| `email_notifications`  | `boolean`                         | `true`  | Enable email alerts      |
| `slack_notifications`  | `boolean`                         | `true`  | Enable Slack alerts      |
| `jira_auto_create`     | `boolean`                         | `false` | Auto-create tickets      |
| `jira_default_project` | `string`                          | `null`  | Default Jira project key |

Update via API:

```bash
curl -X PATCH http://localhost:3001/api/profile/notifications \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notificationLevel": "high",
    "slackNotifications": true,
    "emailNotifications": false
  }'
```
