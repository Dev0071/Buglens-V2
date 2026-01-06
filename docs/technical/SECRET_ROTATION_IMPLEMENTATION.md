# Secret Rotation Implementation Plan

**Companion Document to:** [SECRET_ROTATION_REQUIREMENTS.md](./SECRET_ROTATION_REQUIREMENTS.md)

This document provides detailed implementation steps with code templates for both backend and frontend.

---

## Table of Contents

1. [Backend Implementation](#backend-implementation)
2. [Frontend Implementation](#frontend-implementation)
3. [Database Migrations](#database-migrations)
4. [Testing Implementation](#testing-implementation)
5. [Deployment Checklist](#deployment-checklist)

---

## Backend Implementation

### Step 1: Database Migration

**File:** `migrations/024_add_secret_versioning.cjs`

```javascript
exports.up = async (pgm) => {
  // Secret versions table
  pgm.createTable("secret_versions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    secret_type: { type: "varchar(50)", notNull: true },
    version: { type: "varchar(20)", notNull: true },
    key_id: { type: "varchar(50)", notNull: true },
    secret_value_encrypted: { type: "text", notNull: true },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    activated_at: { type: "timestamp" },
    expires_at: { type: "timestamp" },
  });

  pgm.createIndex("secret_versions", "secret_type");
  pgm.createIndex("secret_versions", "expires_at");
  pgm.addConstraint("secret_versions", "unique_secret_version", {
    unique: ["secret_type", "version"],
  });

  // Rotation events audit log
  pgm.createTable("secret_rotation_events", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    secret_type: { type: "varchar(50)", notNull: true },
    old_key_id: { type: "varchar(50)" },
    new_key_id: { type: "varchar(50)", notNull: true },
    rotated_by: { type: "uuid", references: "users" },
    rotation_status: { type: "varchar(20)", notNull: true },
    error_message: { type: "text" },
    metadata: { type: "jsonb" },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.createIndex("secret_rotation_events", "secret_type");
  pgm.createIndex("secret_rotation_events", "rotation_status");
  pgm.createIndex("secret_rotation_events", "created_at");
};

exports.down = async (pgm) => {
  pgm.dropTable("secret_rotation_events");
  pgm.dropTable("secret_versions");
};
```

---

### Step 2: Secret Manager Service

**File:** `src/services/secret-manager.ts`

```typescript
/**
 * Secret Manager Service
 *
 * Handles versioned secret storage and rotation with zero-downtime support.
 */

import crypto from "crypto";
import { query, transaction } from "../db/client.js";
import { logger } from "../utils/logger.js";
import { encryptData, decryptData } from "./crypto.js";

// ============================================
// Types
// ============================================

export type SecretType =
  | "jwt_secret"
  | "encryption_key"
  | "github_webhook_secret"
  | "sentry_webhook_secret";

export type SecretVersion = "current" | "previous" | "next";

export interface SecretRecord {
  id: string;
  secret_type: SecretType;
  version: SecretVersion;
  key_id: string;
  secret_value_encrypted: string;
  created_at: Date;
  activated_at: Date | null;
  expires_at: Date | null;
}

export interface RotationResult {
  success: boolean;
  newKeyId: string;
  oldKeyId: string | null;
  affectedRecords?: number;
  error?: string;
}

// ============================================
// In-Memory Cache
// ============================================

interface CachedSecret {
  value: string;
  keyId: string;
  expiresAt: number; // Unix timestamp
}

const secretCache = new Map<string, CachedSecret>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(secretType: SecretType, version: SecretVersion): string {
  return `${secretType}:${version}`;
}

// ============================================
// Secret Retrieval
// ============================================

/**
 * Get a secret by type and version with caching
 * Falls back to 'previous' version if 'current' validation fails
 */
export async function getSecret(
  secretType: SecretType,
  version: SecretVersion = "current"
): Promise<string> {
  const cacheKey = getCacheKey(secretType, version);
  const cached = secretCache.get(cacheKey);

  // Return from cache if still valid
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  // Fetch from database
  const result = await query<SecretRecord>(
    `SELECT * FROM secret_versions
     WHERE secret_type = $1 AND version = $2
     AND (expires_at IS NULL OR expires_at > NOW())`,
    [secretType, version]
  );

  if (result.rows.length === 0) {
    throw new Error(`Secret not found: ${secretType} (${version})`);
  }

  const record = result.rows[0];
  const decryptedValue = decryptData(record.secret_value_encrypted, "platform");

  // Update cache
  secretCache.set(cacheKey, {
    value: decryptedValue,
    keyId: record.key_id,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return decryptedValue;
}

/**
 * Get secret with automatic fallback to previous version
 * Use this for validating JWTs/webhooks during rotation
 */
export async function getSecretWithFallback(
  secretType: SecretType
): Promise<{ value: string; keyId: string }> {
  try {
    const current = await getSecret(secretType, "current");
    const cached = secretCache.get(getCacheKey(secretType, "current"));
    return { value: current, keyId: cached!.keyId };
  } catch (err) {
    logger.warn(`Current secret not found, falling back to previous`, {
      secretType,
    });
    const previous = await getSecret(secretType, "previous");
    const cached = secretCache.get(getCacheKey(secretType, "previous"));
    return { value: previous, keyId: cached!.keyId };
  }
}

// ============================================
// Secret Rotation
// ============================================

/**
 * Rotate a secret with zero-downtime support
 */
export async function rotateSecret(
  secretType: SecretType,
  options: {
    newValue?: string; // If not provided, auto-generate
    rotatedBy?: string; // User ID
    gracePeriodDays?: number; // Default: 7 days
  } = {}
): Promise<RotationResult> {
  const {
    newValue = generateSecureSecret(secretType),
    rotatedBy,
    gracePeriodDays = 7,
  } = options;

  logger.info(`Starting secret rotation`, { secretType });

  try {
    const result = await transaction(async (client) => {
      // 1. Get current secret
      const currentResult = await client.query<SecretRecord>(
        `SELECT * FROM secret_versions
         WHERE secret_type = $1 AND version = 'current'`,
        [secretType]
      );

      const currentSecret = currentResult.rows[0];
      const oldKeyId = currentSecret?.key_id || null;

      // 2. Generate new key ID
      const newKeyId = generateKeyId(secretType);

      // 3. Demote current → previous
      if (currentSecret) {
        await client.query(
          `UPDATE secret_versions
           SET version = 'previous',
               expires_at = NOW() + INTERVAL '${gracePeriodDays} days'
           WHERE secret_type = $1 AND version = 'current'`,
          [secretType]
        );
      }

      // 4. Delete old 'previous' version
      await client.query(
        `DELETE FROM secret_versions
         WHERE secret_type = $1 AND version = 'previous' AND key_id != $2`,
        [secretType, currentSecret?.key_id]
      );

      // 5. Promote next → current (if exists)
      const nextResult = await client.query(
        `SELECT * FROM secret_versions
         WHERE secret_type = $1 AND version = 'next'`,
        [secretType]
      );

      if (nextResult.rows.length > 0) {
        await client.query(
          `UPDATE secret_versions
           SET version = 'current', activated_at = NOW()
           WHERE secret_type = $1 AND version = 'next'`,
          [secretType]
        );

        logger.info(`Promoted next → current`, { secretType, newKeyId });
      } else {
        // 6. Create new current secret
        const encryptedValue = encryptData(newValue, "platform");

        await client.query(
          `INSERT INTO secret_versions
           (secret_type, version, key_id, secret_value_encrypted, activated_at)
           VALUES ($1, 'current', $2, $3, NOW())`,
          [secretType, newKeyId, encryptedValue]
        );

        logger.info(`Created new current secret`, { secretType, newKeyId });
      }

      // 7. Log rotation event
      await client.query(
        `INSERT INTO secret_rotation_events
         (secret_type, old_key_id, new_key_id, rotated_by, rotation_status, metadata)
         VALUES ($1, $2, $3, $4, 'completed', $5)`,
        [
          secretType,
          oldKeyId,
          newKeyId,
          rotatedBy,
          JSON.stringify({ gracePeriodDays }),
        ]
      );

      return { oldKeyId, newKeyId };
    });

    // 8. Clear cache
    secretCache.delete(getCacheKey(secretType, "current"));
    secretCache.delete(getCacheKey(secretType, "previous"));

    // 9. Handle special rotation logic
    let affectedRecords: number | undefined;
    if (secretType === "encryption_key") {
      affectedRecords = await reEncryptAllData();
    }

    logger.info(`Secret rotation completed`, {
      secretType,
      newKeyId: result.newKeyId,
      affectedRecords,
    });

    return {
      success: true,
      newKeyId: result.newKeyId,
      oldKeyId: result.oldKeyId,
      affectedRecords,
    };
  } catch (error) {
    logger.error(`Secret rotation failed`, { secretType, error });

    // Log failure event
    await query(
      `INSERT INTO secret_rotation_events
       (secret_type, new_key_id, rotated_by, rotation_status, error_message)
       VALUES ($1, $2, $3, 'failed', $4)`,
      [secretType, "failed", rotatedBy, (error as Error).message]
    );

    return {
      success: false,
      newKeyId: "",
      oldKeyId: null,
      error: (error as Error).message,
    };
  }
}

// ============================================
// Helper Functions
// ============================================

function generateSecureSecret(secretType: SecretType): string {
  const length = secretType === "jwt_secret" ? 64 : 32;
  return crypto.randomBytes(length).toString("base64");
}

function generateKeyId(secretType: SecretType): string {
  const prefix = secretType.replace("_", "-");
  const randomSuffix = crypto.randomBytes(4).toString("hex");
  return `${prefix}-${randomSuffix}`;
}

/**
 * Re-encrypt all OAuth tokens with new encryption key
 */
async function reEncryptAllData(): Promise<number> {
  logger.info(`Starting bulk re-encryption`);

  const result = await query<{ encrypted_access_token: string }>(
    `SELECT id, encrypted_access_token FROM integrations
     WHERE encrypted_access_token IS NOT NULL`
  );

  let reEncryptedCount = 0;

  for (const row of result.rows) {
    try {
      // Decrypt with old key (now 'previous')
      const oldKey = await getSecret("encryption_key", "previous");
      const plainToken = decryptData(row.encrypted_access_token, "platform", {
        key: oldKey,
      });

      // Encrypt with new key (now 'current')
      const newKey = await getSecret("encryption_key", "current");
      const newEncrypted = encryptData(plainToken, "platform", { key: newKey });

      // Update record
      await query(
        `UPDATE integrations SET encrypted_access_token = $1 WHERE id = $2`,
        [newEncrypted, row.id]
      );

      reEncryptedCount++;

      if (reEncryptedCount % 100 === 0) {
        logger.info(`Re-encryption progress`, {
          count: reEncryptedCount,
          total: result.rows.length,
        });
      }
    } catch (error) {
      logger.error(`Failed to re-encrypt record`, { id: row.id, error });
    }
  }

  logger.info(`Bulk re-encryption completed`, { count: reEncryptedCount });
  return reEncryptedCount;
}

/**
 * Cleanup expired secrets (run daily via cron)
 */
export async function cleanupExpiredSecrets(): Promise<number> {
  const result = await query(
    `DELETE FROM secret_versions
     WHERE expires_at IS NOT NULL AND expires_at < NOW()
     RETURNING id`
  );

  logger.info(`Cleaned up expired secrets`, { count: result.rowCount });
  return result.rowCount || 0;
}

/**
 * Get rotation status for all secrets
 */
export async function getRotationStatus(): Promise<
  Array<{
    secretType: SecretType;
    currentKeyId: string;
    lastRotated: Date;
    expiresAt: Date | null;
  }>
> {
  const result = await query<{
    secret_type: SecretType;
    key_id: string;
    activated_at: Date;
    expires_at: Date | null;
  }>(
    `SELECT secret_type, key_id, activated_at, expires_at
     FROM secret_versions
     WHERE version = 'current'
     ORDER BY secret_type`
  );

  return result.rows.map((row) => ({
    secretType: row.secret_type,
    currentKeyId: row.key_id,
    lastRotated: row.activated_at,
    expiresAt: row.expires_at,
  }));
}
```

---

### Step 3: Update Auth Service

**File:** `src/services/auth.ts` (modifications)

```typescript
import { getSecret, getSecretWithFallback } from "./secret-manager.js";

// Update generateAccessToken to use versioned secret
export async function generateAccessToken(user: AuthUser): Promise<string> {
  const jwtSecret = await getSecret("jwt_secret", "current");

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      orgId: user.orgId,
      role: user.role,
    },
    jwtSecret,
    { expiresIn: "15m" }
  );
}

// Update verifyAccessToken to support fallback
export async function verifyAccessToken(
  token: string
): Promise<jwt.JwtPayload> {
  try {
    // Try current secret first
    const { value: jwtSecret } = await getSecretWithFallback("jwt_secret");
    return jwt.verify(token, jwtSecret) as jwt.JwtPayload;
  } catch (error) {
    // If verification fails with current, try previous
    try {
      const previousSecret = await getSecret("jwt_secret", "previous");
      return jwt.verify(token, previousSecret) as jwt.JwtPayload;
    } catch {
      throw new Error("Invalid or expired token");
    }
  }
}
```

---

### Step 4: Admin API Routes

**File:** `src/api/routes/admin/secrets.ts`

```typescript
import { FastifyPluginAsync } from "fastify";
import {
  rotateSecret,
  getRotationStatus,
  cleanupExpiredSecrets,
  SecretType,
} from "../../../services/secret-manager.js";
import { requireRole } from "../../middleware/auth.js";

export const secretsRoutes: FastifyPluginAsync = async (fastify) => {
  // Require owner role for all secret operations
  fastify.addHook("preHandler", requireRole(["owner", "platform_admin"]));

  /**
   * POST /api/admin/secrets/rotate
   * Rotate a specific secret
   */
  fastify.post<{
    Body: { secretType: SecretType; gracePeriodDays?: number };
  }>("/rotate", async (request, reply) => {
    const { secretType, gracePeriodDays } = request.body;

    const result = await rotateSecret(secretType, {
      rotatedBy: request.user.id,
      gracePeriodDays,
    });

    if (!result.success) {
      return reply.status(500).send({
        error: "Rotation failed",
        message: result.error,
      });
    }

    return {
      success: true,
      secretType,
      newKeyId: result.newKeyId,
      oldKeyId: result.oldKeyId,
      affectedRecords: result.affectedRecords,
    };
  });

  /**
   * GET /api/admin/secrets/status
   * Get rotation status for all secrets
   */
  fastify.get("/status", async () => {
    const statuses = await getRotationStatus();

    return {
      secrets: statuses.map((s) => ({
        type: s.secretType,
        keyId: s.currentKeyId,
        lastRotated: s.lastRotated.toISOString(),
        expiresAt: s.expiresAt?.toISOString() || null,
        daysUntilExpiration: s.expiresAt
          ? Math.ceil(
              (s.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            )
          : null,
      })),
    };
  });

  /**
   * POST /api/admin/secrets/cleanup
   * Manually trigger cleanup of expired secrets
   */
  fastify.post("/cleanup", async () => {
    const count = await cleanupExpiredSecrets();
    return { cleaned: count };
  });
};
```

---

## Frontend Implementation

### Step 1: Secrets Management Page

**File:** `web/src/pages/admin/SecretsManagement.tsx`

```typescript
import React, { useState, useEffect } from "react";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../api/client";

interface SecretStatus {
  type: string;
  keyId: string;
  lastRotated: string;
  expiresAt: string | null;
  daysUntilExpiration: number | null;
}

export function SecretsManagement() {
  const { user } = useAuth();
  const [secrets, setSecrets] = useState<SecretStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState<string | null>(null);

  // Check authorization
  if (!["owner", "platform_admin"].includes(user?.role || "")) {
    return <div>Access Denied</div>;
  }

  useEffect(() => {
    fetchSecretStatus();
  }, []);

  async function fetchSecretStatus() {
    try {
      const response = await api.get("/admin/secrets/status");
      setSecrets(response.data.secrets);
    } catch (error) {
      console.error("Failed to fetch secret status", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleRotate(secretType: string) {
    if (
      !confirm(
        `Are you sure you want to rotate ${secretType}? This action cannot be undone.`
      )
    ) {
      return;
    }

    setRotating(secretType);

    try {
      await api.post("/admin/secrets/rotate", { secretType });
      alert(`Successfully rotated ${secretType}`);
      await fetchSecretStatus();
    } catch (error) {
      alert(`Failed to rotate ${secretType}: ${error}`);
    } finally {
      setRotating(null);
    }
  }

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Secret Management</h1>

      <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-6">
        <p className="text-sm text-yellow-800">
          ⚠️ <strong>Security Notice:</strong> Rotating secrets may require
          users to re-authenticate. Webhook secrets must also be updated in
          external services (GitHub, Sentry).
        </p>
      </div>

      <table className="min-w-full bg-white border border-gray-200 rounded-lg">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Secret Type
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Key ID
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Last Rotated
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Status
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {secrets.map((secret) => (
            <tr key={secret.type}>
              <td className="px-6 py-4 text-sm font-medium text-gray-900">
                {secret.type.replace("_", " ").toUpperCase()}
              </td>
              <td className="px-6 py-4 text-sm text-gray-500 font-mono">
                {secret.keyId}
              </td>
              <td className="px-6 py-4 text-sm text-gray-500">
                {new Date(secret.lastRotated).toLocaleDateString()}
              </td>
              <td className="px-6 py-4 text-sm">
                {getStatusBadge(secret.daysUntilExpiration)}
              </td>
              <td className="px-6 py-4 text-right text-sm">
                <button
                  onClick={() => handleRotate(secret.type)}
                  disabled={rotating === secret.type}
                  className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
                >
                  {rotating === secret.type ? "Rotating..." : "Rotate Now"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getStatusBadge(daysUntil: number | null) {
  if (daysUntil === null) {
    return <span className="text-green-600">✓ Active</span>;
  }

  if (daysUntil < 7) {
    return <span className="text-red-600">⚠️ Expiring Soon ({daysUntil}d)</span>;
  }

  if (daysUntil < 30) {
    return <span className="text-yellow-600">⏰ Expires in {daysUntil}d</span>;
  }

  return <span className="text-green-600">✓ Active ({daysUntil}d)</span>;
}
```

---

### Step 2: Handle 401 Errors Gracefully

**File:** `web/src/api/client.ts` (modifications)

```typescript
// Add automatic token refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and not already retrying
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Try to refresh token
        const refreshToken = localStorage.getItem("refreshToken");
        const response = await api.post("/auth/refresh", { refreshToken });

        // Update tokens
        localStorage.setItem("accessToken", response.data.accessToken);
        localStorage.setItem("refreshToken", response.data.refreshToken);

        // Retry original request
        originalRequest.headers.Authorization = `Bearer ${response.data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed, logout user
        localStorage.clear();
        window.location.href = "/login";
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
```

---

## Testing Implementation

**File:** `tests/integration/secret-rotation.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  rotateSecret,
  getSecret,
  cleanupExpiredSecrets,
} from "../../src/services/secret-manager";
import {
  generateAccessToken,
  verifyAccessToken,
} from "../../src/services/auth";
import { query } from "../../src/db/client";

describe("Secret Rotation", () => {
  beforeAll(async () => {
    // Seed initial secrets
    await query(
      `INSERT INTO secret_versions (secret_type, version, key_id, secret_value_encrypted, activated_at)
       VALUES ('jwt_secret', 'current', 'jwt-initial', $1, NOW())`,
      [encryptData("test-jwt-secret-123", "platform")]
    );
  });

  afterAll(async () => {
    // Cleanup
    await query(`DELETE FROM secret_versions WHERE secret_type = 'jwt_secret'`);
    await query(
      `DELETE FROM secret_rotation_events WHERE secret_type = 'jwt_secret'`
    );
  });

  it("should rotate JWT secret without breaking active tokens", async () => {
    // Generate token with current secret
    const user = {
      id: "user-1",
      email: "test@example.com",
      orgId: "org-1",
      role: "owner",
    };
    const oldToken = await generateAccessToken(user);

    // Rotate secret
    const result = await rotateSecret("jwt_secret");
    expect(result.success).toBe(true);

    // Old token should still be valid (fallback to 'previous')
    const payload = await verifyAccessToken(oldToken);
    expect(payload.sub).toBe(user.id);

    // New token should use new secret
    const newToken = await generateAccessToken(user);
    expect(newToken).not.toBe(oldToken);

    const newPayload = await verifyAccessToken(newToken);
    expect(newPayload.sub).toBe(user.id);
  });

  it("should cleanup expired secrets", async () => {
    // Set expiration in the past
    await query(
      `UPDATE secret_versions SET expires_at = NOW() - INTERVAL '1 day'
       WHERE version = 'previous'`
    );

    const cleaned = await cleanupExpiredSecrets();
    expect(cleaned).toBeGreaterThan(0);
  });
});
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] Review code with security team
- [ ] Run full test suite
- [ ] Backup production database
- [ ] Document rollback procedure
- [ ] Notify team of planned rotation window

### Deployment Steps

```bash
# 1. Deploy database migration
npm run migrate:up

# 2. Deploy application code
git push heroku main

# 3. Backfill current secrets (one-time)
heroku run npm run secrets:init

# 4. Test rotation in staging
heroku run npm run secrets:rotate -- --type jwt_secret -a buglens-api-staging

# 5. Verify no errors
heroku logs --tail -a buglens-api-staging

# 6. Deploy to production
git push prod main

# 7. Monitor for 24 hours
```

### Post-Deployment

- [ ] Verify all secrets rotated successfully
- [ ] Check error rates in Sentry
- [ ] Monitor user session metrics
- [ ] Schedule next rotation (90 days)

---

## Monitoring Dashboard

Add to CloudWatch or Grafana:

```
Secret Rotation Dashboard:
- Rotation success/failure rate
- Time since last rotation
- Secrets expiring in < 7 days
- Active secret versions per type
- Re-encryption progress (if applicable)
```

---

**End of Implementation Plan**

For questions or issues, contact the security team or refer to [SECRET_ROTATION_REQUIREMENTS.md](./SECRET_ROTATION_REQUIREMENTS.md).
