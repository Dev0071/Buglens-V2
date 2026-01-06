# Secret Rotation Requirements & Implementation Plan

**Date:** January 5, 2026
**Status:** Planning Phase
**Priority:** High (Security Critical)

---

## Executive Summary

Secret rotation is a **critical security requirement** for Buglens. Without it, compromised secrets remain valid indefinitely, exposing the system to unauthorized access, data breaches, and compliance violations.

### Necessity Assessment: **CRITICAL**

**Why Secret Rotation is Non-Negotiable:**

1. **Compliance Requirements**: SOC 2, ISO 27001, GDPR require regular secret rotation
2. **Breach Containment**: Limits damage window if secrets are compromised
3. **Insider Threat Mitigation**: Revokes access for former employees/contractors
4. **Key Aging**: Cryptographic best practice to limit key exposure over time
5. **Zero Trust Architecture**: Aligns with modern security principles

**Risk of No Rotation:**

- 🚨 Compromised JWT secret = all user sessions hijacked
- 🚨 Leaked GitHub App key = unauthorized repo access
- 🚨 Exposed encryption key = all stored OAuth tokens decrypted
- 🚨 Stolen webhook secrets = injection of fake events

---

## Secrets Inventory & Rotation Requirements

### 1. Critical Secrets (Rotation Required)

| Secret                   | Current Use           | Rotation Frequency | Impact on Rotation          | Priority |
| ------------------------ | --------------------- | ------------------ | --------------------------- | -------- |
| `JWT_SECRET`             | Signs access tokens   | **90 days**        | Active sessions invalidated | **P0**   |
| `ENCRYPTION_KEY`         | Encrypts OAuth tokens | **180 days**       | Must re-encrypt data        | **P0**   |
| `GITHUB_APP_PRIVATE_KEY` | GitHub API auth       | **365 days**       | Regenerate via GitHub       | **P1**   |
| `GITHUB_WEBHOOK_SECRET`  | Webhook verification  | **180 days**       | Update in GitHub + code     | **P1**   |
| `SENTRY_WEBHOOK_SECRET`  | Webhook verification  | **180 days**       | Update in Sentry + code     | **P1**   |
| `OPENAI_API_KEY`         | LLM requests          | **180 days**       | Update in OpenAI + code     | **P2**   |

### 2. Managed Secrets (Automatic Rotation)

| Secret          | Provider        | Rotation Mechanism  |
| --------------- | --------------- | ------------------- |
| `DATABASE_URL`  | Heroku Postgres | Managed by Heroku   |
| `REDIS_URL`     | Heroku Redis    | Managed by Heroku   |
| AWS Access Keys | AWS IAM         | AWS Secrets Manager |

### 3. Non-Rotatable Secrets

| Secret           | Type        | Alternative Strategy |
| ---------------- | ----------- | -------------------- |
| Organization IDs | Identifiers | Immutable by design  |
| User IDs         | Identifiers | Immutable by design  |

---

## Functional Requirements

### FR-1: Multi-Version Secret Support

**Requirement:** The system MUST support multiple versions of a secret simultaneously during rotation to prevent downtime.

**Acceptance Criteria:**

- [ ] Support up to 3 concurrent versions: `current`, `previous`, `next`
- [ ] Graceful fallback: Try `current`, fall back to `previous` if validation fails
- [ ] Automatic cleanup of `previous` after grace period (7 days)

### FR-2: Zero-Downtime Rotation

**Requirement:** Secret rotation MUST NOT cause service interruption or user-facing errors.

**Acceptance Criteria:**

- [ ] No 401/403 errors during rotation window
- [ ] No failed webhook validations
- [ ] No orphaned user sessions

### FR-3: Automated Rotation Workflow

**Requirement:** Rotation process MUST be automated via API and CLI, not manual.

**Acceptance Criteria:**

- [ ] Admin API endpoint: `POST /api/admin/secrets/rotate`
- [ ] CLI command: `npm run rotate:secrets`
- [ ] Scheduled rotation via cron/background job

### FR-4: Audit Trail

**Requirement:** All rotation events MUST be logged with timestamp, actor, and secret type.

**Acceptance Criteria:**

- [ ] Audit log table: `secret_rotation_events`
- [ ] Fields: `id`, `secret_type`, `rotated_by`, `rotated_at`, `status`, `old_key_id`, `new_key_id`
- [ ] Queryable via admin dashboard

### FR-5: Data Re-Encryption

**Requirement:** When `ENCRYPTION_KEY` rotates, all encrypted data MUST be re-encrypted.

**Acceptance Criteria:**

- [ ] Bulk re-encryption job for `integrations.encrypted_access_token`
- [ ] Progress tracking and rollback capability
- [ ] Verification of successful re-encryption

---

## Non-Functional Requirements

### NFR-1: Performance

- Rotation process completes within **5 minutes** for all secrets
- Re-encryption throughput: **100 records/second**
- No noticeable API latency increase during rotation

### NFR-2: Security

- New secrets generated using cryptographically secure random (CSPRNG)
- Old secrets immediately revoked after grace period
- Secrets never logged in plaintext
- Role-based access control (only org owners + platform admins)

### NFR-3: Observability

- CloudWatch metrics: `SecretRotationSuccess`, `SecretRotationFailure`
- Slack alerts on rotation completion/failure
- Sentry error tracking for rotation issues

---

## Architecture Design

### Database Schema Changes

```sql
-- New table for secret versioning
CREATE TABLE secret_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_type VARCHAR(50) NOT NULL, -- 'jwt_secret', 'encryption_key', etc.
  version VARCHAR(20) NOT NULL,     -- 'current', 'previous', 'next'
  key_id VARCHAR(50) NOT NULL,      -- Unique identifier for this key version
  secret_value_encrypted TEXT NOT NULL, -- Encrypted using platform master key
  created_at TIMESTAMP DEFAULT NOW(),
  activated_at TIMESTAMP,            -- When it became 'current'
  expires_at TIMESTAMP,              -- When to delete

  UNIQUE(secret_type, version)
);

CREATE INDEX idx_secret_versions_type ON secret_versions(secret_type);
CREATE INDEX idx_secret_versions_expires ON secret_versions(expires_at);

-- Audit log for rotation events
CREATE TABLE secret_rotation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_type VARCHAR(50) NOT NULL,
  old_key_id VARCHAR(50),
  new_key_id VARCHAR(50) NOT NULL,
  rotated_by UUID REFERENCES users(id),  -- NULL for automated rotations
  rotation_status VARCHAR(20) NOT NULL,  -- 'initiated', 'completed', 'failed', 'rolled_back'
  error_message TEXT,
  metadata JSONB,                        -- Additional context (e.g., affected records count)
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_rotation_events_type ON secret_rotation_events(secret_type);
CREATE INDEX idx_rotation_events_status ON secret_rotation_events(rotation_status);
```

### Secret Storage Strategy

**Option A: Database-Backed (Recommended for MVP)**

- Store encrypted secrets in `secret_versions` table
- Decrypt on application startup and cache in memory
- Refresh cache every 5 minutes

**Option B: AWS Secrets Manager (Production Scale)**

- Use AWS Secrets Manager for secret storage
- Enable automatic rotation via Lambda
- Higher cost but better security posture

**Decision: Start with Option A, migrate to Option B in Phase 2**

---

## Implementation Plan

### Phase 1: Foundation (Week 1-2)

**Backend Tasks:**

1. **Database Schema**
   - [ ] Create migration `024_add_secret_versioning.cjs`
   - [ ] Add `secret_versions` table
   - [ ] Add `secret_rotation_events` table
   - [ ] Seed initial secrets from environment variables

2. **Secret Management Service**
   - [ ] Create `src/services/secret-manager.ts`
   - [ ] Implement `getSecret(type, version)` with fallback logic
   - [ ] Implement `rotateSecret(type, newValue)`
   - [ ] Implement `cleanupExpiredSecrets()` background job

3. **Update Existing Services**
   - [ ] Update `src/services/auth.ts` to use versioned JWT secrets
   - [ ] Update `src/services/crypto.ts` to support multi-version encryption keys
   - [ ] Update `src/services/github.ts` for webhook secret validation

4. **Testing**
   - [ ] Unit tests for secret fallback logic
   - [ ] Integration test: Rotate JWT secret with active sessions
   - [ ] Integration test: Rotate encryption key with re-encryption

**Frontend Tasks:**

1. **Admin UI**
   - [ ] Create `/admin/secrets` page (restricted to org owners)
   - [ ] Display current secret metadata (NOT values):
     - Secret type
     - Key ID
     - Last rotated date
     - Next rotation due date
   - [ ] "Rotate Now" button for each secret type
   - [ ] Confirmation modal with warnings

2. **User Experience**
   - [ ] Handle 401 errors gracefully (auto-refresh token)
   - [ ] Show "Session expired, please log in again" if refresh fails
   - [ ] No user action required during webhook secret rotation

---

### Phase 2: Automation (Week 3)

**Backend Tasks:**

1. **Admin API Endpoints**

   ```typescript
   POST / api / admin / secrets / rotate;
   Body: {
     secretType: "jwt_secret" | "encryption_key" | "webhook_secret";
   }

   GET / api / admin / secrets / status;
   Response: {
     secrets: [{ type, keyId, lastRotated, nextRotation }];
   }

   POST / api / admin / secrets / emergency - revoke;
   Body: {
     (secretType, keyId);
   } // Immediately revoke a specific key
   ```

2. **CLI Commands**

   ```bash
   npm run secrets:rotate -- --type jwt_secret
   npm run secrets:status
   npm run secrets:cleanup-expired
   ```

3. **Scheduled Rotation**
   - [ ] BullMQ job: `ScheduledSecretRotation`
   - [ ] Cron: Check daily if any secrets are due for rotation
   - [ ] Auto-rotate if within 7 days of expiration
   - [ ] Send Slack notification before auto-rotation

**Frontend Tasks:**

1. **Rotation Status UI**
   - [ ] Real-time progress indicator during rotation
   - [ ] WebSocket/polling for rotation status updates
   - [ ] Success/failure toast notifications

2. **Audit Log Viewer**
   - [ ] Table of past rotation events
   - [ ] Filters: secret type, status, date range
   - [ ] Export to CSV

---

### Phase 3: Advanced Features (Week 4+)

**Backend:**

- [ ] Integration with AWS Secrets Manager
- [ ] Lambda function for automatic GitHub App key rotation
- [ ] Rollback mechanism if rotation causes errors
- [ ] Multi-region secret replication

**Frontend:**

- [ ] Rotation calendar view
- [ ] Automated rotation scheduling UI
- [ ] Slack/email notifications preferences

---

## Rotation Workflows

### Workflow 1: JWT Secret Rotation

```
1. Admin initiates rotation via UI or scheduled job
2. System generates new JWT_SECRET (256-bit random)
3. Store new secret as 'next' version in DB
4. Promote 'next' → 'current', 'current' → 'previous'
5. New tokens signed with new secret
6. Old tokens validated against both 'current' and 'previous'
7. Grace period: 7 days
8. After grace period, delete 'previous' version
9. Log rotation event
10. Notify admins via Slack
```

**User Impact:** None (seamless transition)

### Workflow 2: Encryption Key Rotation

```
1. Admin initiates rotation
2. System generates new ENCRYPTION_KEY
3. Store as 'next' version
4. Create re-encryption job:
   - Query all integrations.encrypted_access_token
   - Decrypt with 'current' key
   - Encrypt with 'next' key
   - Update record
5. Track progress: 0% → 100%
6. Upon 100% completion, promote 'next' → 'current'
7. Mark old key for deletion after 30 days (emergency rollback window)
8. Log rotation event
```

**User Impact:** Temporary read-only mode for integrations (5-10 mins)

### Workflow 3: Webhook Secret Rotation

```
1. Admin initiates rotation
2. Generate new webhook secret
3. Update external service (GitHub/Sentry) with new secret
4. Store new secret as 'next' version
5. Accept webhooks signed with either 'current' or 'next'
6. After 24 hours, promote 'next' → 'current'
7. After 7 days, delete 'previous'
```

**User Impact:** None

---

## Rollback Plan

If rotation causes errors:

1. **Immediate Rollback (Auto-triggered):**

   ```typescript
   if (errorRate > 5%) {
     promoteVersion('previous', 'current');
     markRotationFailed();
     alertTeam();
   }
   ```

2. **Manual Rollback (Admin Action):**

   ```bash
   npm run secrets:rollback -- --type jwt_secret
   ```

3. **Data Recovery:**
   - If re-encryption fails, keep old encrypted data
   - Retry re-encryption in background
   - Do NOT delete old key until verified

---

## Security Considerations

### Secret Generation

```typescript
// ✅ CORRECT: Cryptographically secure random
const newSecret = crypto.randomBytes(32).toString("base64");

// ❌ WRONG: Predictable
const newSecret = Math.random().toString(36);
```

### Secret Storage

```typescript
// Secrets in DB are encrypted with platform master key
const encryptedSecret = encrypt(plainSecret, getPlatformKey());

// On retrieval, decrypt and cache (NOT in logs)
const plainSecret = decrypt(encryptedSecret, getPlatformKey());
logger.info("Secret rotated", { keyId: "jwt-v2" }); // ✅ Log keyId, NOT value
```

### Access Control

```typescript
// Only org owners + platform admins can rotate secrets
if (!user.role.includes("owner") && !user.is_platform_admin) {
  throw new ForbiddenError("Insufficient permissions");
}
```

---

## Testing Strategy

### Unit Tests

```typescript
describe("SecretManager", () => {
  it("should fall back to previous version if current fails", async () => {
    await rotateSecret("jwt_secret");
    const token = signTokenWithPreviousSecret();
    const valid = await verifyToken(token); // Should succeed
    expect(valid).toBe(true);
  });

  it("should reject tokens after grace period", async () => {
    await rotateSecret("jwt_secret");
    await advanceTime(8, "days");
    await cleanupExpiredSecrets();
    const token = signTokenWithPreviousSecret();
    const valid = await verifyToken(token);
    expect(valid).toBe(false);
  });
});
```

### Integration Tests

```typescript
describe("E2E Secret Rotation", () => {
  it("should handle active sessions during JWT rotation", async () => {
    const user = await login();
    await rotateJwtSecret();
    const response = await authenticatedRequest(user.accessToken);
    expect(response.status).toBe(200); // Still works
  });

  it("should re-encrypt all OAuth tokens", async () => {
    await seedIntegrations(100);
    await rotateEncryptionKey();
    const integrations = await getAllIntegrations();
    for (const integration of integrations) {
      const token = await decrypt(integration.encrypted_access_token);
      expect(token).toBeTruthy(); // Successfully decrypted
    }
  });
});
```

---

## Monitoring & Alerts

### CloudWatch Metrics

```typescript
recordMetric("SecretRotationDuration", durationMs, { secretType });
recordMetric("SecretRotationSuccess", 1, { secretType });
recordMetric("SecretRotationFailure", 1, { secretType, errorType });
recordMetric("ReEncryptionProgress", percentage, { secretType });
```

### Alerts

```yaml
Alerts:
  - Name: SecretRotationFailure
    Condition: Sum(SecretRotationFailure) > 0
    Action: Page on-call engineer

  - Name: SecretExpirationWarning
    Condition: SecretExpiresIn < 7 days
    Action: Notify admins via Slack

  - Name: ReEncryptionStalled
    Condition: ReEncryptionProgress stuck for > 10 minutes
    Action: Alert engineering team
```

---

## Migration Path

### Step 1: Backfill Current Secrets (One-Time)

```sql
-- Migrate existing JWT_SECRET to versioned storage
INSERT INTO secret_versions (secret_type, version, key_id, secret_value_encrypted, activated_at)
VALUES (
  'jwt_secret',
  'current',
  'jwt-v1-' || substr(md5(random()::text), 1, 8),
  encrypt_with_platform_key(getenv('JWT_SECRET')),
  NOW()
);
```

### Step 2: Update Application Code

```typescript
// Before: Direct environment variable access
const jwtSecret = process.env.JWT_SECRET;

// After: Versioned secret retrieval
const jwtSecret = await getSecret("jwt_secret", "current");
```

### Step 3: Enable Rotation

```bash
# Initial rotation to verify system works
npm run secrets:rotate -- --type jwt_secret --dry-run
npm run secrets:rotate -- --type jwt_secret
```

---

## Success Metrics

| Metric                   | Target                               | Measurement                |
| ------------------------ | ------------------------------------ | -------------------------- |
| Rotation Completion Time | < 5 minutes                          | CloudWatch metrics         |
| User Session Disruption  | 0%                                   | Error rate during rotation |
| Re-Encryption Speed      | > 100 records/sec                    | BullMQ job metrics         |
| Audit Log Coverage       | 100%                                 | All rotations logged       |
| Secret Age               | < 90 days (JWT), < 180 days (others) | Scheduled monitoring       |

---

## Cost Analysis

**Development Effort:**

- Phase 1: ~40 hours (backend + frontend + testing)
- Phase 2: ~24 hours (automation + CLI)
- Phase 3: ~16 hours (AWS integration)
- **Total: ~80 hours (~2 weeks for 1 engineer)**

**Operational Cost:**

- AWS Secrets Manager: ~$0.40/secret/month + API calls
- CloudWatch metrics: ~$1/month
- Additional DB storage: Negligible (<10MB)
- **Total: ~$5-10/month**

**Cost of NOT Implementing:**

- Breach incident response: $50K-$500K
- Compliance violation fines: $100K+
- Customer trust loss: Immeasurable

**ROI: Infinite (prevents catastrophic security failure)**

---

## Next Steps

1. **Approval:** Present to engineering lead + security reviewer
2. **Prioritization:** Add to sprint planning (recommend: This sprint)
3. **Kickoff:** Assign engineer, create tickets in Linear/Jira
4. **Timeline:**
   - Week 1-2: Phase 1 (Foundation)
   - Week 3: Phase 2 (Automation)
   - Week 4: Testing & documentation
   - Week 5: Production rollout
