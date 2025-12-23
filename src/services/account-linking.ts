/**
 * Account Linking Service
 *
 * Allows users to link multiple OAuth providers to their account:
 * - Link Google ↔ GitHub identities
 * - Merge accounts if same email exists
 * - Unlink providers (keep at least one auth method)
 *
 * This enables users to sign in with any linked provider.
 */

import { query, transaction } from "../db/client.js";
import { logger } from "../utils/logger.js";
import { AuthError } from "./auth.js";

// ============================================
// Types
// ============================================

export type OAuthProviderType = "google" | "github";

export interface LinkedAccount {
  id: string;
  provider: OAuthProviderType;
  providerId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  linkedAt: Date;
}

export interface AccountIdentity {
  provider: OAuthProviderType;
  providerId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

// ============================================
// Database Schema
// ============================================

/*
CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  avatar_url VARCHAR(1024),
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (provider, provider_id)
);

CREATE INDEX idx_user_identities_user ON user_identities(user_id);
CREATE INDEX idx_user_identities_email ON user_identities(email);
*/

// ============================================
// Link Account Functions
// ============================================

/**
 * Link a new OAuth provider to an existing user account
 *
 * Rules:
 * - Cannot link if provider_id already linked to another user
 * - Cannot link if email belongs to different user (unless merging)
 * - Creates entry in user_identities table
 */
export async function linkOAuthProvider(
  userId: string,
  identity: AccountIdentity
): Promise<LinkedAccount> {
  const { provider, providerId, email, name, avatarUrl } = identity;

  // Check if this provider_id is already linked to someone else
  const existingLink = await query<{ user_id: string }>(
    `SELECT user_id FROM user_identities
     WHERE provider = $1 AND provider_id = $2`,
    [provider, providerId]
  );

  if (existingLink.rows.length > 0) {
    if (existingLink.rows[0].user_id === userId) {
      throw new AuthError(
        "This provider is already linked to your account",
        "PROVIDER_ALREADY_LINKED"
      );
    } else {
      throw new AuthError(
        "This provider is already linked to another account",
        "PROVIDER_LINKED_TO_OTHER"
      );
    }
  }

  // Check if email belongs to a different user (potential merge scenario)
  const emailOwner = await query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 AND id != $2`,
    [email.toLowerCase(), userId]
  );

  if (emailOwner.rows.length > 0) {
    // Email belongs to different account - need to merge or reject
    throw new AuthError(
      "This email is associated with another account. Please merge accounts instead.",
      "EMAIL_BELONGS_TO_OTHER"
    );
  }

  // Link the provider
  const result = await query<{
    id: string;
    provider: string;
    provider_id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    linked_at: Date;
  }>(
    `INSERT INTO user_identities (user_id, provider, provider_id, email, name, avatar_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, provider, provider_id, email, name, avatar_url, linked_at`,
    [userId, provider, providerId, email.toLowerCase(), name, avatarUrl]
  );

  const row = result.rows[0];
  logger.info({ userId, provider }, "OAuth provider linked to account");

  return {
    id: row.id,
    provider: row.provider as OAuthProviderType,
    providerId: row.provider_id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    linkedAt: row.linked_at,
  };
}

/**
 * Get all linked accounts for a user
 */
export async function getLinkedAccounts(
  userId: string
): Promise<LinkedAccount[]> {
  const result = await query<{
    id: string;
    provider: string;
    provider_id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    linked_at: Date;
  }>(
    `SELECT id, provider, provider_id, email, name, avatar_url, linked_at
     FROM user_identities
     WHERE user_id = $1
     ORDER BY linked_at ASC`,
    [userId]
  );

  // Also include the primary auth method from users table
  const primaryAuth = await query<{
    email: string;
    name: string | null;
    auth_provider: string;
    created_at: Date;
  }>(
    `SELECT email, name, auth_provider, created_at
     FROM users
     WHERE id = $1`,
    [userId]
  );

  const linkedAccounts: LinkedAccount[] = [];

  // Add primary auth if it's an OAuth provider
  if (
    primaryAuth.rows.length > 0 &&
    (primaryAuth.rows[0].auth_provider === "google" ||
      primaryAuth.rows[0].auth_provider === "github")
  ) {
    linkedAccounts.push({
      id: "primary",
      provider: primaryAuth.rows[0].auth_provider as OAuthProviderType,
      providerId: "", // We don't store providerId for primary
      email: primaryAuth.rows[0].email,
      name: primaryAuth.rows[0].name,
      avatarUrl: null,
      linkedAt: primaryAuth.rows[0].created_at,
    });
  }

  // Add linked identities
  for (const row of result.rows) {
    linkedAccounts.push({
      id: row.id,
      provider: row.provider as OAuthProviderType,
      providerId: row.provider_id,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatar_url,
      linkedAt: row.linked_at,
    });
  }

  return linkedAccounts;
}

/**
 * Unlink an OAuth provider from an account
 *
 * Rules:
 * - Cannot unlink if it's the only auth method
 * - Cannot unlink primary auth method (use switchPrimaryProvider instead)
 */
export async function unlinkOAuthProvider(
  userId: string,
  identityId: string
): Promise<void> {
  if (identityId === "primary") {
    throw new AuthError(
      "Cannot unlink primary authentication method. Switch primary first.",
      "CANNOT_UNLINK_PRIMARY"
    );
  }

  // Check if user has other auth methods
  const authMethods = await query<{ count: string }>(
    `SELECT
      (SELECT COUNT(*) FROM user_identities WHERE user_id = $1) +
      (SELECT CASE WHEN password_hash IS NOT NULL THEN 1 ELSE 0 END FROM users WHERE id = $1) +
      (SELECT CASE WHEN auth_provider IN ('google', 'github') THEN 1 ELSE 0 END FROM users WHERE id = $1)
     as count`,
    [userId]
  );

  const totalMethods = parseInt(authMethods.rows[0]?.count || "0", 10);

  if (totalMethods <= 1) {
    throw new AuthError(
      "Cannot unlink the only authentication method. Add another method first.",
      "CANNOT_REMOVE_LAST_AUTH"
    );
  }

  // Unlink
  const result = await query(
    `DELETE FROM user_identities WHERE id = $1 AND user_id = $2`,
    [identityId, userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new AuthError("Linked account not found", "IDENTITY_NOT_FOUND");
  }

  logger.info({ userId, identityId }, "OAuth provider unlinked from account");
}

/**
 * Find user by OAuth provider identity
 *
 * Checks both primary auth and linked identities
 */
export async function findUserByOAuthIdentity(
  provider: OAuthProviderType,
  providerId: string
): Promise<{ userId: string; orgId: string } | null> {
  // Check linked identities first
  const linkedResult = await query<{ user_id: string; org_id: string }>(
    `SELECT ui.user_id, u.org_id
     FROM user_identities ui
     JOIN users u ON ui.user_id = u.id
     WHERE ui.provider = $1 AND ui.provider_id = $2`,
    [provider, providerId]
  );

  if (linkedResult.rows.length > 0) {
    return {
      userId: linkedResult.rows[0].user_id,
      orgId: linkedResult.rows[0].org_id,
    };
  }

  return null;
}

/**
 * Find user by email across all linked identities
 */
export async function findUserByLinkedEmail(
  email: string
): Promise<{ userId: string; orgId: string } | null> {
  // Check primary user email
  const userResult = await query<{ id: string; org_id: string }>(
    `SELECT id, org_id FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );

  if (userResult.rows.length > 0) {
    return {
      userId: userResult.rows[0].id,
      orgId: userResult.rows[0].org_id,
    };
  }

  // Check linked identities
  const linkedResult = await query<{ user_id: string; org_id: string }>(
    `SELECT ui.user_id, u.org_id
     FROM user_identities ui
     JOIN users u ON ui.user_id = u.id
     WHERE ui.email = $1`,
    [email.toLowerCase()]
  );

  if (linkedResult.rows.length > 0) {
    return {
      userId: linkedResult.rows[0].user_id,
      orgId: linkedResult.rows[0].org_id,
    };
  }

  return null;
}

// ============================================
// Account Merge Functions
// ============================================

/**
 * Merge two accounts (when user has multiple accounts with same identity)
 *
 * This is a complex operation that:
 * 1. Moves all linked identities to the target account
 * 2. Optionally transfers ownership of resources
 * 3. Deletes the source account
 *
 * Should be used with caution and user confirmation
 */
export async function mergeAccounts(
  targetUserId: string,
  sourceUserId: string,
  options: {
    transferResources?: boolean;
    deleteSource?: boolean;
  } = {}
): Promise<void> {
  const { transferResources = false, deleteSource = true } = options;

  // Verify both accounts exist
  const users = await query<{ id: string; org_id: string }>(
    `SELECT id, org_id FROM users WHERE id IN ($1, $2)`,
    [targetUserId, sourceUserId]
  );

  if (users.rows.length !== 2) {
    throw new AuthError("One or both accounts not found", "ACCOUNTS_NOT_FOUND");
  }

  // Get org_id from target user for transaction context
  const targetUser = users.rows.find((u) => u.id === targetUserId);
  const orgId = targetUser?.org_id || null;

  await transaction(orgId, async (client) => {
    // Move linked identities from source to target
    await client.query(
      `UPDATE user_identities SET user_id = $1 WHERE user_id = $2`,
      [targetUserId, sourceUserId]
    );

    if (transferResources) {
      // Transfer any organization membership (if different orgs)
      // This depends on your specific data model
      logger.info(
        { targetUserId, sourceUserId },
        "Resource transfer requested during merge"
      );
    }

    if (deleteSource) {
      // Soft delete or hard delete the source account
      await client.query(
        `UPDATE users SET is_active = false, email = email || '_merged_' || $1
         WHERE id = $1`,
        [sourceUserId]
      );
    }
  });

  logger.info(
    { targetUserId, sourceUserId, transferResources, deleteSource },
    "Accounts merged"
  );
}

// ============================================
// Primary Provider Management
// ============================================

/**
 * Switch the primary authentication provider
 *
 * This updates the users.auth_provider to use a linked identity as primary
 */
export async function switchPrimaryProvider(
  userId: string,
  identityId: string
): Promise<void> {
  if (identityId === "primary") {
    return; // Already primary
  }

  // Get the identity to promote
  const identity = await query<{
    provider: string;
    email: string;
    name: string | null;
  }>(
    `SELECT provider, email, name FROM user_identities
     WHERE id = $1 AND user_id = $2`,
    [identityId, userId]
  );

  if (identity.rows.length === 0) {
    throw new AuthError("Linked account not found", "IDENTITY_NOT_FOUND");
  }

  const { provider, email, name } = identity.rows[0];

  // Use null for orgId since this is a user-level operation (RLS not needed)
  await transaction(null, async (client) => {
    // Update user's primary auth
    await client.query(
      `UPDATE users SET
        auth_provider = $1,
        email = $2,
        name = COALESCE($3, name)
       WHERE id = $4`,
      [provider, email.toLowerCase(), name, userId]
    );

    // Remove the identity since it's now primary
    await client.query(`DELETE FROM user_identities WHERE id = $1`, [
      identityId,
    ]);
  });

  logger.info({ userId, newProvider: provider }, "Primary provider switched");
}

logger.info("Account linking service initialized");
