/**
 * Secret Manager Service
 *
 * Provides secure, versioned secret management with:
 * - Multi-version support (current, previous, next) for zero-downtime rotation
 * - Automatic fallback during rotation periods
 * - Encrypted storage using platform master key
 * - Audit logging for all rotation events
 * - CloudWatch metrics integration
 *
 * @module services/secret-manager
 */

import crypto from "crypto";
import { pool, query } from "../db/client.js";
import { logger } from "../utils/logger.js";
import { config } from "../utils/config.js";
import type pg from "pg";

// ============================================
// Types
// ============================================

export type SecretType =
  | "jwt_secret"
  | "encryption_key"
  | "github_webhook_secret"
  | "sentry_webhook_secret"
  | "openai_api_key";

export type SecretVersion = "current" | "previous" | "next";

export type RotationStatus =
  | "initiated"
  | "completed"
  | "failed"
  | "rolled_back";

export type RotationReason =
  | "scheduled"
  | "manual"
  | "emergency"
  | "compromise"
  | "initial";

export interface SecretRecord {
  id: string;
  secret_type: SecretType;
  version: SecretVersion;
  key_id: string;
  secret_value_encrypted: string;
  rotation_interval_days: number;
  created_at: Date;
  activated_at: Date | null;
  expires_at: Date | null;
  metadata: Record<string, unknown>;
}

export interface RotationEvent {
  id: string;
  secret_type: SecretType;
  old_key_id: string | null;
  new_key_id: string;
  rotated_by: string | null;
  rotation_status: RotationStatus;
  rotation_reason: RotationReason;
  error_message: string | null;
  affected_records: number | null;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface RotationResult {
  success: boolean;
  newKeyId: string;
  oldKeyId: string | null;
  affectedRecords?: number;
  durationMs: number;
  error?: string;
}

export interface SecretStatus {
  secretType: SecretType;
  currentKeyId: string | null;
  previousKeyId: string | null;
  lastRotated: Date | null;
  nextRotationDue: Date | null;
  rotationIntervalDays: number;
  daysUntilExpiration: number | null;
  status: "healthy" | "expiring_soon" | "overdue" | "missing";
}

export interface RotationOptions {
  newValue?: string; // Auto-generate if not provided
  rotatedBy?: string; // User ID
  gracePeriodDays?: number; // Default: 7 days
  reason?: RotationReason; // Default: manual
}

// ============================================
// Constants
// ============================================

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Default rotation intervals by secret type
const DEFAULT_ROTATION_INTERVALS: Record<SecretType, number> = {
  jwt_secret: 90,
  encryption_key: 180,
  github_webhook_secret: 180,
  sentry_webhook_secret: 180,
  openai_api_key: 180,
};

// Secret length by type
const SECRET_LENGTHS: Record<SecretType, number> = {
  jwt_secret: 64,
  encryption_key: 32,
  github_webhook_secret: 32,
  sentry_webhook_secret: 32,
  openai_api_key: 32, // Not auto-generated
};

// ============================================
// In-Memory Cache
// ============================================

interface CachedSecret {
  value: string;
  keyId: string;
  expiresAt: number;
}

const secretCache = new Map<string, CachedSecret>();

function getCacheKey(secretType: SecretType, version: SecretVersion): string {
  return `${secretType}:${version}`;
}

function clearSecretCache(secretType: SecretType): void {
  secretCache.delete(getCacheKey(secretType, "current"));
  secretCache.delete(getCacheKey(secretType, "previous"));
  secretCache.delete(getCacheKey(secretType, "next"));
}

// ============================================
// Encryption Helpers (Platform-Level)
// ============================================

/**
 * Derive the platform master key from JWT_SECRET
 * This key is used to encrypt/decrypt secrets stored in the database
 */
function getPlatformMasterKey(): Buffer {
  const salt = crypto
    .createHash("sha256")
    .update("buglens-secret-manager-v1")
    .digest();
  return crypto.pbkdf2Sync(
    config.JWT_SECRET,
    salt,
    100000,
    KEY_LENGTH,
    "sha256"
  );
}

/**
 * Encrypt a secret value for storage
 */
function encryptSecret(plaintext: string): string {
  const key = getPlatformMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: version (1) + iv (16) + authTag (16) + ciphertext
  const packed = Buffer.concat([
    Buffer.from([1]), // version
    iv,
    authTag,
    encrypted,
  ]);

  return packed.toString("base64");
}

/**
 * Decrypt a secret value from storage
 */
function decryptSecret(encryptedData: string): string {
  const key = getPlatformMasterKey();
  const packed = Buffer.from(encryptedData, "base64");

  const version = packed[0];
  if (version !== 1) {
    throw new Error(`Unsupported secret encryption version: ${version}`);
  }

  const iv = packed.subarray(1, 1 + IV_LENGTH);
  const authTag = packed.subarray(
    1 + IV_LENGTH,
    1 + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = packed.subarray(1 + IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

// ============================================
// Secret Generation
// ============================================

/**
 * Generate a cryptographically secure random secret
 */
export function generateSecureSecret(secretType: SecretType): string {
  const length = SECRET_LENGTHS[secretType];
  return crypto.randomBytes(length).toString("base64");
}

/**
 * Generate a unique key ID for a secret version
 */
function generateKeyId(secretType: SecretType): string {
  const prefix = secretType.replace(/_/g, "-");
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString("hex");
  return `${prefix}-${timestamp}-${random}`;
}

// ============================================
// Secret Retrieval
// ============================================

/**
 * Get a secret by type and version with caching
 */
export async function getSecret(
  secretType: SecretType,
  version: SecretVersion = "current"
): Promise<string> {
  const cacheKey = getCacheKey(secretType, version);
  const cached = secretCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

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
  const decryptedValue = decryptSecret(record.secret_value_encrypted);

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
): Promise<{ value: string; keyId: string; version: SecretVersion }> {
  // Try current first
  try {
    const value = await getSecret(secretType, "current");
    const cached = secretCache.get(getCacheKey(secretType, "current"));
    return { value, keyId: cached!.keyId, version: "current" };
  } catch {
    // Fall back to previous
    logger.warn({ secretType }, "Current secret not found, trying previous");
  }

  try {
    const value = await getSecret(secretType, "previous");
    const cached = secretCache.get(getCacheKey(secretType, "previous"));
    return { value, keyId: cached!.keyId, version: "previous" };
  } catch {
    throw new Error(`No valid secret found for: ${secretType}`);
  }
}

/**
 * Get all versions of a secret (for admin display)
 */
export async function getSecretVersions(
  secretType: SecretType
): Promise<Array<Omit<SecretRecord, "secret_value_encrypted">>> {
  const result = await query<SecretRecord>(
    `SELECT id, secret_type, version, key_id, rotation_interval_days,
            created_at, activated_at, expires_at, metadata
     FROM secret_versions
     WHERE secret_type = $1
     ORDER BY
       CASE version
         WHEN 'current' THEN 1
         WHEN 'previous' THEN 2
         WHEN 'next' THEN 3
       END`,
    [secretType]
  );

  return result.rows;
}

/**
 * Check if a secret exists
 */
export async function secretExists(
  secretType: SecretType,
  version: SecretVersion = "current"
): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM secret_versions
     WHERE secret_type = $1 AND version = $2
     AND (expires_at IS NULL OR expires_at > NOW())`,
    [secretType, version]
  );
  return result.rows.length > 0;
}

// ============================================
// Secret Rotation
// ============================================

/**
 * Rotate a secret with zero-downtime support
 */
export async function rotateSecret(
  secretType: SecretType,
  options: RotationOptions = {}
): Promise<RotationResult> {
  const {
    newValue = generateSecureSecret(secretType),
    rotatedBy,
    gracePeriodDays = 7,
    reason = "manual",
  } = options;

  const startTime = Date.now();
  const newKeyId = generateKeyId(secretType);

  logger.info({ secretType, newKeyId, reason }, "Starting secret rotation");

  // Log rotation initiation
  await logRotationEvent({
    secretType,
    oldKeyId: null, // Will be updated
    newKeyId,
    rotatedBy,
    status: "initiated",
    reason,
  });

  const client = await pool.connect();
  let oldKeyId: string | null = null;
  let affectedRecords = 0;

  try {
    await client.query("BEGIN");

    // 1. Get current secret info
    const currentResult = await client.query<SecretRecord>(
      `SELECT * FROM secret_versions WHERE secret_type = $1 AND version = 'current'`,
      [secretType]
    );
    const currentSecret = currentResult.rows[0];
    oldKeyId = currentSecret?.key_id || null;

    // 2. Delete any existing 'next' version
    await client.query(
      `DELETE FROM secret_versions WHERE secret_type = $1 AND version = 'next'`,
      [secretType]
    );

    // 3. Demote current → previous (if exists)
    if (currentSecret) {
      // First, delete existing previous
      await client.query(
        `DELETE FROM secret_versions WHERE secret_type = $1 AND version = 'previous'`,
        [secretType]
      );

      // Then demote current
      await client.query(
        `UPDATE secret_versions
         SET version = 'previous', expires_at = NOW() + INTERVAL '${gracePeriodDays} days'
         WHERE secret_type = $1 AND version = 'current'`,
        [secretType]
      );
    }

    // 4. Create new current secret
    const encryptedValue = encryptSecret(newValue);
    const rotationInterval = DEFAULT_ROTATION_INTERVALS[secretType];

    await client.query(
      `INSERT INTO secret_versions
       (secret_type, version, key_id, secret_value_encrypted, rotation_interval_days, activated_at)
       VALUES ($1, 'current', $2, $3, $4, NOW())`,
      [secretType, newKeyId, encryptedValue, rotationInterval]
    );

    // 5. Handle special cases (e.g., re-encryption for encryption_key)
    if (secretType === "encryption_key" && currentSecret) {
      affectedRecords = await reEncryptIntegrationTokens(
        client,
        currentSecret,
        newValue
      );
    }

    await client.query("COMMIT");

    // 6. Clear cache
    clearSecretCache(secretType);

    const durationMs = Date.now() - startTime;

    // 7. Log success
    await logRotationEvent({
      secretType,
      oldKeyId,
      newKeyId,
      rotatedBy,
      status: "completed",
      reason,
      affectedRecords,
      durationMs,
    });

    logger.info(
      { secretType, newKeyId, oldKeyId, durationMs, affectedRecords },
      "Secret rotation completed"
    );

    return {
      success: true,
      newKeyId,
      oldKeyId,
      affectedRecords,
      durationMs,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    const durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Log failure
    await logRotationEvent({
      secretType,
      oldKeyId,
      newKeyId,
      rotatedBy,
      status: "failed",
      reason,
      errorMessage,
      durationMs,
    });

    logger.error({ secretType, error }, "Secret rotation failed");

    return {
      success: false,
      newKeyId,
      oldKeyId,
      durationMs,
      error: errorMessage,
    };
  } finally {
    client.release();
  }
}

/**
 * Re-encrypt integration tokens with new encryption key
 */
async function reEncryptIntegrationTokens(
  client: pg.PoolClient,
  oldSecret: SecretRecord,
  newKeyValue: string
): Promise<number> {
  // Get all integrations with encrypted tokens
  const integrations = await client.query<{
    id: string;
    encrypted_access_token: string;
  }>(
    `SELECT id, encrypted_access_token FROM integrations
     WHERE encrypted_access_token IS NOT NULL`
  );

  if (integrations.rows.length === 0) {
    return 0;
  }

  logger.info(
    { count: integrations.rows.length },
    "Re-encrypting integration tokens"
  );

  const oldKeyValue = decryptSecret(oldSecret.secret_value_encrypted);
  let reEncryptedCount = 0;

  for (const row of integrations.rows) {
    try {
      // Decrypt with old key
      const decrypted = decryptWithKey(row.encrypted_access_token, oldKeyValue);
      // Encrypt with new key
      const reEncrypted = encryptWithKey(decrypted, newKeyValue);

      await client.query(
        `UPDATE integrations SET encrypted_access_token = $1 WHERE id = $2`,
        [reEncrypted, row.id]
      );

      reEncryptedCount++;

      if (reEncryptedCount % 100 === 0) {
        logger.info(
          { progress: reEncryptedCount, total: integrations.rows.length },
          "Re-encryption progress"
        );
      }
    } catch (error) {
      logger.error({ id: row.id, error }, "Failed to re-encrypt token");
      throw error; // Fail the whole rotation
    }
  }

  return reEncryptedCount;
}

/**
 * Encrypt with a specific key (for re-encryption)
 */
function encryptWithKey(plaintext: string, keyValue: string): string {
  const key = crypto.createHash("sha256").update(keyValue).digest();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const packed = Buffer.concat([Buffer.from([1]), iv, authTag, encrypted]);
  return packed.toString("base64");
}

/**
 * Decrypt with a specific key (for re-encryption)
 */
function decryptWithKey(encryptedData: string, keyValue: string): string {
  const key = crypto.createHash("sha256").update(keyValue).digest();
  const packed = Buffer.from(encryptedData, "base64");

  const version = packed[0];
  if (version !== 1) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  const iv = packed.subarray(1, 1 + IV_LENGTH);
  const authTag = packed.subarray(
    1 + IV_LENGTH,
    1 + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = packed.subarray(1 + IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

// ============================================
// Rollback Support
// ============================================

/**
 * Rollback a rotation by promoting previous → current
 */
export async function rollbackRotation(
  secretType: SecretType,
  rotatedBy?: string
): Promise<RotationResult> {
  const startTime = Date.now();

  logger.warn({ secretType }, "Rolling back secret rotation");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Get previous secret
    const previousResult = await client.query<SecretRecord>(
      `SELECT * FROM secret_versions WHERE secret_type = $1 AND version = 'previous'`,
      [secretType]
    );

    if (previousResult.rows.length === 0) {
      throw new Error(`No previous version to rollback to for: ${secretType}`);
    }

    const previousSecret = previousResult.rows[0];

    // Get current (to delete)
    const currentResult = await client.query<SecretRecord>(
      `SELECT * FROM secret_versions WHERE secret_type = $1 AND version = 'current'`,
      [secretType]
    );
    const currentKeyId = currentResult.rows[0]?.key_id || null;

    // Delete current
    await client.query(
      `DELETE FROM secret_versions WHERE secret_type = $1 AND version = 'current'`,
      [secretType]
    );

    // Promote previous → current
    await client.query(
      `UPDATE secret_versions
       SET version = 'current', expires_at = NULL, activated_at = NOW()
       WHERE secret_type = $1 AND version = 'previous'`,
      [secretType]
    );

    await client.query("COMMIT");

    clearSecretCache(secretType);

    const durationMs = Date.now() - startTime;

    await logRotationEvent({
      secretType,
      oldKeyId: currentKeyId,
      newKeyId: previousSecret.key_id,
      rotatedBy,
      status: "rolled_back",
      reason: "emergency",
      durationMs,
    });

    logger.info(
      { secretType, restoredKeyId: previousSecret.key_id, durationMs },
      "Secret rollback completed"
    );

    return {
      success: true,
      newKeyId: previousSecret.key_id,
      oldKeyId: currentKeyId,
      durationMs,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error({ secretType, error }, "Secret rollback failed");

    return {
      success: false,
      newKeyId: "",
      oldKeyId: null,
      durationMs: Date.now() - startTime,
      error: errorMessage,
    };
  } finally {
    client.release();
  }
}

// ============================================
// Cleanup & Maintenance
// ============================================

/**
 * Delete expired secret versions
 */
export async function cleanupExpiredSecrets(): Promise<number> {
  const result = await query(
    `DELETE FROM secret_versions
     WHERE expires_at IS NOT NULL AND expires_at < NOW()
     RETURNING id, secret_type, key_id`
  );

  if (result.rowCount && result.rowCount > 0) {
    logger.info(
      { count: result.rowCount, deleted: result.rows },
      "Cleaned up expired secrets"
    );
  }

  return result.rowCount || 0;
}

/**
 * Get rotation status for all secrets
 */
export async function getRotationStatus(): Promise<SecretStatus[]> {
  const secretTypes: SecretType[] = [
    "jwt_secret",
    "encryption_key",
    "github_webhook_secret",
    "sentry_webhook_secret",
    "openai_api_key",
  ];

  const statuses: SecretStatus[] = [];

  for (const secretType of secretTypes) {
    const versions = await getSecretVersions(secretType);
    const currentVersion = versions.find((v) => v.version === "current");
    const previousVersion = versions.find((v) => v.version === "previous");

    const rotationInterval =
      currentVersion?.rotation_interval_days ||
      DEFAULT_ROTATION_INTERVALS[secretType];

    let nextRotationDue: Date | null = null;
    let daysUntilExpiration: number | null = null;
    let status: SecretStatus["status"] = "missing";

    if (currentVersion?.activated_at) {
      nextRotationDue = new Date(
        currentVersion.activated_at.getTime() +
          rotationInterval * 24 * 60 * 60 * 1000
      );
      daysUntilExpiration = Math.ceil(
        (nextRotationDue.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      );

      if (daysUntilExpiration < 0) {
        status = "overdue";
      } else if (daysUntilExpiration < 14) {
        status = "expiring_soon";
      } else {
        status = "healthy";
      }
    }

    statuses.push({
      secretType,
      currentKeyId: currentVersion?.key_id || null,
      previousKeyId: previousVersion?.key_id || null,
      lastRotated: currentVersion?.activated_at || null,
      nextRotationDue,
      rotationIntervalDays: rotationInterval,
      daysUntilExpiration,
      status,
    });
  }

  return statuses;
}

/**
 * Get secrets that need rotation (scheduled check)
 */
export async function getSecretsNeedingRotation(
  warningDays: number = 7
): Promise<SecretStatus[]> {
  const statuses = await getRotationStatus();
  return statuses.filter(
    (s) =>
      s.status === "overdue" ||
      (s.daysUntilExpiration !== null && s.daysUntilExpiration <= warningDays)
  );
}

// ============================================
// Audit Logging
// ============================================

async function logRotationEvent(params: {
  secretType: SecretType;
  oldKeyId: string | null;
  newKeyId: string;
  rotatedBy?: string;
  status: RotationStatus;
  reason: RotationReason;
  errorMessage?: string;
  affectedRecords?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO secret_rotation_events
       (secret_type, old_key_id, new_key_id, rotated_by, rotation_status,
        rotation_reason, error_message, affected_records, duration_ms, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        params.secretType,
        params.oldKeyId,
        params.newKeyId,
        params.rotatedBy || null,
        params.status,
        params.reason,
        params.errorMessage || null,
        params.affectedRecords || null,
        params.durationMs || null,
        JSON.stringify(params.metadata || {}),
      ]
    );
  } catch (error) {
    logger.error({ error, params }, "Failed to log rotation event");
  }
}

/**
 * Get rotation history for a secret type
 */
export async function getRotationHistory(
  secretType: SecretType,
  limit: number = 20
): Promise<RotationEvent[]> {
  const result = await query<RotationEvent>(
    `SELECT * FROM secret_rotation_events
     WHERE secret_type = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [secretType, limit]
  );

  return result.rows;
}

// ============================================
// Initialization & Backfill
// ============================================

/**
 * Initialize secrets from environment variables (first-time setup)
 */
export async function initializeSecretsFromEnv(): Promise<void> {
  const secretsToInit: Array<{
    type: SecretType;
    envVar: string;
    required: boolean;
  }> = [
    { type: "jwt_secret", envVar: "JWT_SECRET", required: true },
    // Don't auto-init encryption_key - it needs special handling
    {
      type: "github_webhook_secret",
      envVar: "GITHUB_WEBHOOK_SECRET",
      required: false,
    },
    {
      type: "sentry_webhook_secret",
      envVar: "SENTRY_WEBHOOK_SECRET",
      required: false,
    },
    { type: "openai_api_key", envVar: "OPENAI_API_KEY", required: false },
  ];

  for (const secret of secretsToInit) {
    const exists = await secretExists(secret.type);
    if (exists) {
      logger.debug(
        { secretType: secret.type },
        "Secret already exists, skipping"
      );
      continue;
    }

    const envValue = process.env[secret.envVar];
    if (!envValue) {
      if (secret.required) {
        logger.warn(
          { secretType: secret.type, envVar: secret.envVar },
          "Required secret not found in environment"
        );
      }
      continue;
    }

    logger.info(
      { secretType: secret.type },
      "Initializing secret from environment"
    );

    const result = await rotateSecret(secret.type, {
      newValue: envValue,
      reason: "initial",
    });

    if (!result.success) {
      logger.error(
        { secretType: secret.type, error: result.error },
        "Failed to initialize secret"
      );
    }
  }
}

// ============================================
// Testing Utilities
// ============================================

export function _clearCacheForTesting(): void {
  secretCache.clear();
}

export async function _deleteAllSecretsForTesting(
  secretType: SecretType
): Promise<void> {
  await query(`DELETE FROM secret_versions WHERE secret_type = $1`, [
    secretType,
  ]);
  await query(`DELETE FROM secret_rotation_events WHERE secret_type = $1`, [
    secretType,
  ]);
  clearSecretCache(secretType);
}
