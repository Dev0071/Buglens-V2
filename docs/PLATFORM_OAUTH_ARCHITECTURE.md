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

#### Test 1: OAuth Error Handling

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
