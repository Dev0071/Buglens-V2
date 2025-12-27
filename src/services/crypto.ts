/**
 * Cryptography Service
 *
 * Handles encryption/decryption of sensitive data like OAuth tokens.
 * Uses AES-256-GCM for authenticated encryption.
 *
 * Architecture:
 * - Platform-level encryption key derived from JWT_SECRET
 * - Per-organization encryption for tenant isolation
 * - Automatic key rotation support via versioned keys
 */

import crypto from "crypto";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

// Constants for AES-256-GCM
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits
const SALT_LENGTH = 32;

/**
 * Derive a consistent encryption key from a secret and salt
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secret, salt, 100000, KEY_LENGTH, "sha256");
}

/**
 * Get the platform master key (derived from JWT_SECRET)
 * This is used for encrypting platform-level secrets
 */
function getPlatformKey(): Buffer {
  // Use a fixed salt for platform key so it's consistent
  const platformSalt = crypto
    .createHash("sha256")
    .update("buglens-platform-key-v1")
    .digest();
  return deriveKey(config.JWT_SECRET, platformSalt);
}

/**
 * Get an organization-specific encryption key
 * Provides tenant isolation for encrypted data
 */
function getOrgKey(orgId: string): Buffer {
  const orgSalt = crypto
    .createHash("sha256")
    .update(`buglens-org-key-v1:${orgId}`)
    .digest();
  return deriveKey(config.JWT_SECRET, orgSalt);
}

/**
 * Encrypted data format:
 * - version (1 byte): Key version for rotation
 * - salt (32 bytes): For key derivation (used with org-specific encryption)
 * - iv (16 bytes): Initialization vector
 * - authTag (16 bytes): GCM authentication tag
 * - ciphertext (variable): Encrypted data
 *
 * All packed and base64 encoded for storage
 */

export interface EncryptedData {
  version: number;
  data: string; // base64 encoded encrypted payload
}

/**
 * Encrypt sensitive data with organization-specific key
 *
 * @param plaintext - Data to encrypt (string or object)
 * @param orgId - Organization ID for key derivation
 * @returns Encrypted data object safe for storage
 */
export function encryptForOrg(
  plaintext: string | object,
  orgId: string
): EncryptedData {
  const data =
    typeof plaintext === "string" ? plaintext : JSON.stringify(plaintext);
  const key = getOrgKey(orgId);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(data, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: version (1) + iv (16) + authTag (16) + ciphertext
  const packed = Buffer.concat([
    Buffer.from([1]), // version 1
    iv,
    authTag,
    encrypted,
  ]);

  return {
    version: 1,
    data: packed.toString("base64"),
  };
}

/**
 * Decrypt data that was encrypted for an organization
 *
 * @param encrypted - Encrypted data object
 * @param orgId - Organization ID for key derivation
 * @returns Decrypted string
 */
export function decryptForOrg(encrypted: EncryptedData, orgId: string): string {
  const key = getOrgKey(orgId);
  const packed = Buffer.from(encrypted.data, "base64");

  // Unpack: version (1) + iv (16) + authTag (16) + ciphertext
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

/**
 * Encrypt with organization key and parse result as JSON
 */
export function encryptJsonForOrg<T extends object>(
  data: T,
  orgId: string
): EncryptedData {
  return encryptForOrg(JSON.stringify(data), orgId);
}

/**
 * Decrypt and parse as JSON
 */
export function decryptJsonForOrg<T>(
  encrypted: EncryptedData,
  orgId: string
): T {
  const decrypted = decryptForOrg(encrypted, orgId);
  return JSON.parse(decrypted) as T;
}

/**
 * Encrypt platform-level secrets (not org-specific)
 * Used for platform configuration stored in database
 */
export function encryptPlatformSecret(plaintext: string): EncryptedData {
  const key = getPlatformKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const packed = Buffer.concat([Buffer.from([1]), iv, authTag, encrypted]);

  return {
    version: 1,
    data: packed.toString("base64"),
  };
}

/**
 * Decrypt platform-level secrets
 */
export function decryptPlatformSecret(encrypted: EncryptedData): string {
  const key = getPlatformKey();
  const packed = Buffer.from(encrypted.data, "base64");

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

/**
 * Generate a cryptographically secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Hash a value (one-way, for comparison)
 */
export function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Verify if a value matches a hash
 */
export function verifyHash(value: string, hash: string): boolean {
  return crypto.timingSafeEqual(
    Buffer.from(hashValue(value)),
    Buffer.from(hash)
  );
}

logger.info("Cryptography service initialized");
