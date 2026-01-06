# Secret Rotation Architecture Diagrams

Visual representations of the secret rotation system architecture.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Buglens Application                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────┐         ┌────────────────┐                      │
│  │  Auth Service  │◄────────│ Secret Manager │                      │
│  │                │         │                │                      │
│  │ - Sign JWT     │         │ - Get secret   │                      │
│  │ - Verify JWT   │         │ - Rotate       │                      │
│  │ - Refresh      │         │ - Cleanup      │                      │
│  └────────────────┘         └────────┬───────┘                      │
│                                      │                              │
│  ┌────────────────┐                  │                              │
│  │ Crypto Service │◄─────────────────┘                              │
│  │                │                                                 │
│  │ - Encrypt      │                                                 │
│  │ - Decrypt      │                                                 │
│  │ - Re-encrypt   │                                                 │
│  └────────────────┘                                                 │
│                                                                      │
└──────────────────────────────────────┬───────────────────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────┐
                    │         PostgreSQL               │
                    ├──────────────────────────────────┤
                    │                                  │
                    │  ┌────────────────────────────┐  │
                    │  │   secret_versions          │  │
                    │  ├────────────────────────────┤  │
                    │  │ - secret_type              │  │
                    │  │ - version (current/prev)   │  │
                    │  │ - key_id                   │  │
                    │  │ - secret_value_encrypted   │  │
                    │  │ - activated_at             │  │
                    │  │ - expires_at               │  │
                    │  └────────────────────────────┘  │
                    │                                  │
                    │  ┌────────────────────────────┐  │
                    │  │  secret_rotation_events    │  │
                    │  ├────────────────────────────┤  │
                    │  │ - secret_type              │  │
                    │  │ - old_key_id               │  │
                    │  │ - new_key_id               │  │
                    │  │ - rotated_by               │  │
                    │  │ - rotation_status          │  │
                    │  │ - created_at               │  │
                    │  └────────────────────────────┘  │
                    │                                  │
                    └──────────────────────────────────┘
```

---

## Secret Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Secret Lifecycle                             │
└─────────────────────────────────────────────────────────────────────┘

   ┌─────────────┐
   │   CREATED   │  ← New secret generated
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐
   │    NEXT     │  ← Staged, not yet active
   └──────┬──────┘
          │
          │ (Promotion)
          ▼
   ┌─────────────┐
   │   CURRENT   │  ← Active secret in use
   └──────┬──────┘
          │
          │ (New rotation triggered)
          ▼
   ┌─────────────┐
   │  PREVIOUS   │  ← Grace period (7 days)
   └──────┬──────┘
          │
          │ (After grace period)
          ▼
   ┌─────────────┐
   │   DELETED   │  ← Cleanup expired secrets
   └─────────────┘
```

---

## JWT Rotation Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                      JWT Secret Rotation                             │
└──────────────────────────────────────────────────────────────────────┘

BEFORE ROTATION:
┌──────────────┐
│ secret_versions│
├──────────────┤
│ jwt_secret   │ version: current  │ key_id: jwt-v1 │
└──────────────┘

USER TOKENS:
Token A: Signed with jwt-v1 ✅ Valid
Token B: Signed with jwt-v1 ✅ Valid

═══════════════════════════════════════════════════════════════════════

ROTATION TRIGGERED:
┌──────────────┐
│ secret_versions│
├──────────────┤
│ jwt_secret   │ version: current   │ key_id: jwt-v2 │ ← NEW
│ jwt_secret   │ version: previous  │ key_id: jwt-v1 │ ← DEMOTED
└──────────────┘

USER TOKENS:
Token A: Signed with jwt-v1 ✅ Valid (fallback to previous)
Token B: Signed with jwt-v1 ✅ Valid (fallback to previous)
Token C: Signed with jwt-v2 ✅ Valid (current)

═══════════════════════════════════════════════════════════════════════

AFTER GRACE PERIOD (7 days):
┌──────────────┐
│ secret_versions│
├──────────────┤
│ jwt_secret   │ version: current  │ key_id: jwt-v2 │
└──────────────┘
                                    │ jwt-v1 DELETED

USER TOKENS:
Token A: Signed with jwt-v1 ❌ Invalid (expired)
Token B: Signed with jwt-v1 ❌ Invalid (expired)
Token C: Signed with jwt-v2 ✅ Valid
Token D: Signed with jwt-v2 ✅ Valid (new login)
```

---

## Encryption Key Rotation Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                  Encryption Key Rotation                             │
└──────────────────────────────────────────────────────────────────────┘

BEFORE ROTATION:
┌──────────────────┐
│  integrations    │
├──────────────────┤
│ id: 1            │ encrypted_token: AAABBBCCC (key: enc-v1)
│ id: 2            │ encrypted_token: DDDEEEFFF (key: enc-v1)
│ id: 3            │ encrypted_token: GGGHHHIII (key: enc-v1)
└──────────────────┘

═══════════════════════════════════════════════════════════════════════

ROTATION TRIGGERED:
Step 1: Create new key (enc-v2)
Step 2: Re-encrypt all data

┌──────────────────┐
│  integrations    │
├──────────────────┤
│ id: 1            │ encrypted_token: XXXYYYZZZZ (key: enc-v2) ✅
│ id: 2            │ encrypted_token: DDDEEEFFF  (key: enc-v1) ⏳ In progress
│ id: 3            │ encrypted_token: GGGHHHIII  (key: enc-v1) ⏳ Pending
└──────────────────┘

Progress: 33%

═══════════════════════════════════════════════════════════════════════

AFTER RE-ENCRYPTION:
┌──────────────────┐
│  integrations    │
├──────────────────┤
│ id: 1            │ encrypted_token: XXXYYYZZZZ (key: enc-v2) ✅
│ id: 2            │ encrypted_token: JJJKKKLLL  (key: enc-v2) ✅
│ id: 3            │ encrypted_token: MMMNNNOOO  (key: enc-v2) ✅
└──────────────────┘

Progress: 100%

Step 3: Promote enc-v2 → current
Step 4: Keep enc-v1 as 'previous' (30-day rollback window)
```

---

## Admin UI Workflow

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Admin Dashboard                                 │
└──────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  Secret Management                                     [Refresh]    │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ⚠️ Security Notice: Rotating secrets may require users to         │
│     re-authenticate. Webhook secrets must be updated externally.   │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Secret Type       │ Key ID    │ Last Rotated │ Status            │
│  ─────────────────┼───────────┼──────────────┼──────────────────  │
│  JWT SECRET        │ jwt-v2    │ 45 days ago  │ ✓ Active (45d)   │
│                    │           │              │ [Rotate Now]      │
│  ─────────────────┼───────────┼──────────────┼──────────────────  │
│  ENCRYPTION KEY    │ enc-v3    │ 120 days ago │ ⏰ Expires 60d   │
│                    │           │              │ [Rotate Now]      │
│  ─────────────────┼───────────┼──────────────┼──────────────────  │
│  GITHUB WEBHOOK    │ gh-wh-v1  │ 8 days ago   │ ⚠️ Expiring 6d   │
│                    │           │              │ [Rotate Now]      │
│  ─────────────────┼───────────┼──────────────┼──────────────────  │
│  SENTRY WEBHOOK    │ sn-wh-v2  │ 90 days ago  │ ✓ Active (90d)   │
│                    │           │              │ [Rotate Now]      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

USER CLICKS "Rotate Now":

┌────────────────────────────────────────────────────────────────────┐
│  Confirm Rotation                                          [×]     │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ⚠️ You are about to rotate JWT SECRET                            │
│                                                                    │
│  Impact:                                                           │
│  • Active user sessions will remain valid                          │
│  • New logins will use the new secret                              │
│  • Old tokens valid for 7 days (grace period)                      │
│  • This action is logged in the audit trail                        │
│                                                                    │
│  Are you sure you want to continue?                                │
│                                                                    │
│            [Cancel]              [Confirm Rotation]                │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

DURING ROTATION:

┌────────────────────────────────────────────────────────────────────┐
│  Rotation in Progress...                                   [×]     │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Rotating JWT SECRET...                                            │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 45%   │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                    │
│  Steps:                                                            │
│  ✅ Generated new secret                                           │
│  ✅ Stored in database                                             │
│  ⏳ Updating application...                                        │
│  ⏳ Validating rotation...                                         │
│  ⏳ Logging audit event...                                         │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

AFTER ROTATION:

┌────────────────────────────────────────────────────────────────────┐
│  ✅ Rotation Successful                                    [×]     │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  JWT SECRET has been rotated successfully.                         │
│                                                                    │
│  New Key ID: jwt-v3                                                │
│  Old Key ID: jwt-v2 (valid for 7 more days)                        │
│                                                                    │
│  [View Audit Log]              [Close]                             │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## API Request Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│              API Request with Multi-Version Support                  │
└──────────────────────────────────────────────────────────────────────┘

CLIENT REQUEST:
POST /api/v1/events
Authorization: Bearer eyJhbGc...  (Token signed with jwt-v1)

                      │
                      ▼
              ┌───────────────┐
              │  Auth Middleware│
              └───────┬─────────┘
                      │
                      ▼
              ┌───────────────────────┐
              │ Get JWT Secret        │
              │ Try: current (jwt-v2) │
              └───────┬───────────────┘
                      │
                      ▼
              ┌───────────────────────┐
              │ Verify Token          │
              │ jwt.verify(token,     │
              │   secret=jwt-v2)      │
              └───────┬───────────────┘
                      │
                      ├─────── Verification Failed ──────┐
                      │                                   │
           Verification Success                           ▼
                      │                    ┌─────────────────────────┐
                      │                    │ Fallback to Previous    │
                      │                    │ Get secret: jwt-v1      │
                      │                    └────────┬────────────────┘
                      │                             │
                      │                             ▼
                      │                    ┌─────────────────────────┐
                      │                    │ Verify Token Again      │
                      │                    │ jwt.verify(token,       │
                      │                    │   secret=jwt-v1)        │
                      │                    └────────┬────────────────┘
                      │                             │
                      │◄────────────────────────────┘
                      │          Success
                      ▼
              ┌───────────────────────┐
              │ Request Processed ✅   │
              └───────────────────────┘

This fallback mechanism ensures ZERO downtime during rotation!
```

---

## Monitoring Dashboard

```
┌──────────────────────────────────────────────────────────────────────┐
│                   CloudWatch Metrics Dashboard                       │
└──────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  Secret Rotation Health                                            │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────────────┐  ┌─────────────────────┐                 │
│  │ Rotation Success %  │  │  Avg Rotation Time  │                 │
│  │                     │  │                     │                 │
│  │       100%          │  │      3.2 min        │                 │
│  └─────────────────────┘  └─────────────────────┘                 │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ Secrets Expiring Soon                                        │ │
│  ├──────────────────────────────────────────────────────────────┤ │
│  │ github_webhook_secret  │  6 days remaining   │ 🔴 URGENT     │ │
│  │ encryption_key         │ 60 days remaining   │ 🟡 Warning    │ │
│  │ jwt_secret             │ 45 days remaining   │ 🟢 OK         │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ Recent Rotation Events                                       │ │
│  ├──────────────────────────────────────────────────────────────┤ │
│  │ Jan 5, 10:30  │ jwt_secret       │ Completed │ 2.8 min      │ │
│  │ Jan 4, 14:20  │ encryption_key   │ Completed │ 8.2 min      │ │
│  │ Jan 3, 09:15  │ sentry_webhook   │ Completed │ 1.5 min      │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

**End of Diagrams**

For implementation details, see:

- [Requirements](./SECRET_ROTATION_REQUIREMENTS.md)
- [Implementation Guide](./SECRET_ROTATION_IMPLEMENTATION.md)
- [Executive Summary](../SECRET_ROTATION_SUMMARY.md)
