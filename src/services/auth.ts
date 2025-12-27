/**
 * Authentication Service
 *
 * Handles user authentication logic including:
 * - Password hashing and verification (bcrypt)
 * - JWT token generation and validation
 * - Session management with refresh tokens
 * - User registration and login
 *
 * @module services/auth
 */

import bcrypt from "bcrypt";
import crypto from "crypto";
import { query, transaction } from "../db/client.js";
import { logger } from "../utils/logger.js";

// Constants
const SALT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 32;
const SESSION_EXPIRY_DAYS = 30;
// Reserved for email verification feature (future implementation)
// Exported to prevent unused variable error while keeping for future use
export const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;
export const RESET_TOKEN_EXPIRY_HOURS = 1;

// ============================================
// Types
// ============================================

export interface UserRecord {
  id: string;
  org_id: string;
  email: string;
  name: string | null;
  role: string;
  password_hash: string | null;
  email_verified: boolean;
  auth_provider: string;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  refresh_token: string;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: Date;
  created_at: Date;
  last_used_at: Date | null;
}

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  plan: string;
  created_at: Date;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  orgId: string;
  orgName: string;
  avatarUrl?: string;
}

export interface AuthOrganization {
  id: string;
  name: string;
  plan: string;
  createdAt: string;
}

export interface AuthResult {
  user: AuthUser;
  organization: AuthOrganization;
  accessToken: string;
  refreshToken: string;
}

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  organizationName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

// ============================================
// Password Functions (Pure)
// ============================================

/**
 * Hash a password using bcrypt
 * @pure
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 * @pure
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a secure random token
 * @pure
 */
export function generateToken(bytes: number = REFRESH_TOKEN_BYTES): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Generate a URL-safe slug from a string
 * @pure
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
}

/**
 * Validate email format
 * @pure
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 * @pure
 */
export function validatePassword(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  return { valid: errors.length === 0, errors };
}

// ============================================
// Auth Service Class
// ============================================

export class AuthService {
  // JWT is handled by Fastify's jwt plugin via server.jwt.sign()
  // These would be used if we handled JWT signing directly

  constructor(_jwtSecret?: string, _jwtExpiresIn?: string) {
    // Config values available via config.JWT_SECRET and config.JWT_EXPIRES_IN if needed
  }

  /**
   * Register a new user and create organization
   */
  async signup(input: SignupInput): Promise<AuthResult> {
    const { email, password, name, organizationName } = input;

    // Validate email
    if (!isValidEmail(email)) {
      throw new AuthError("Invalid email format", "INVALID_EMAIL");
    }

    // Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      throw new AuthError(
        passwordValidation.errors.join(". "),
        "WEAK_PASSWORD"
      );
    }

    // Check if email already exists
    const existingUser = await query<UserRecord>(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      throw new AuthError(
        "An account with this email already exists",
        "EMAIL_EXISTS"
      );
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Generate organization slug
    const orgName = organizationName || `${name}'s Organization`;
    const baseSlug = generateSlug(orgName);
    const uniqueSlug = `${baseSlug}-${Date.now().toString(36)}`;

    // Create user and organization in transaction
    const result = await transaction<{
      user: UserRecord;
      org: OrganizationRecord;
    }>(null, async (client) => {
      // Create organization
      const orgResult = await client.query<OrganizationRecord>(
        `INSERT INTO organizations (name, slug, plan)
         VALUES ($1, $2, 'free')
         RETURNING *`,
        [orgName, uniqueSlug]
      );
      const org = orgResult.rows[0];

      // Create user
      const userResult = await client.query<UserRecord>(
        `INSERT INTO users (
          org_id, email, name, role, password_hash, email_verified, auth_provider
        ) VALUES ($1, $2, $3, 'owner', $4, false, 'email')
        RETURNING *`,
        [org.id, email.toLowerCase(), name, passwordHash]
      );
      const user = userResult.rows[0];

      return { user, org };
    });

    // Generate tokens
    const { accessToken, refreshToken } = await this.createSession(
      result.user.id,
      null,
      null
    );

    logger.info(
      { userId: result.user.id, orgId: result.org.id },
      "New user registered"
    );

    return {
      user: this.formatUser(result.user, result.org),
      organization: this.formatOrganization(result.org),
      accessToken,
      refreshToken,
    };
  }

  /**
   * Authenticate user with email and password
   */
  async login(
    input: LoginInput,
    userAgent?: string,
    ipAddress?: string
  ): Promise<AuthResult> {
    const { email, password } = input;

    // Find user with organization
    const result = await query<
      UserRecord & { org_name: string; org_plan: string; org_created_at: Date }
    >(
      `SELECT u.*, o.name as org_name, o.plan as org_plan, o.created_at as org_created_at
       FROM users u
       JOIN organizations o ON u.org_id = o.id
       WHERE u.email = $1 AND u.is_active = true`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      throw new AuthError("Invalid email or password", "INVALID_CREDENTIALS");
    }

    const user = result.rows[0];

    // Check if user has password (might be OAuth-only user)
    if (!user.password_hash) {
      throw new AuthError(
        "This account uses social login. Please sign in with GitHub or Google.",
        "OAUTH_ONLY"
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new AuthError("Invalid email or password", "INVALID_CREDENTIALS");
    }

    // Update last login
    await query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
      user.id,
    ]);

    // Create session
    const { accessToken, refreshToken } = await this.createSession(
      user.id,
      userAgent || null,
      ipAddress || null
    );

    logger.info({ userId: user.id }, "User logged in");

    const org: OrganizationRecord = {
      id: user.org_id,
      name: user.org_name,
      slug: "",
      plan: user.org_plan,
      created_at: user.org_created_at,
    };

    return {
      user: this.formatUser(user, org),
      organization: this.formatOrganization(org),
      accessToken,
      refreshToken,
    };
  }

  /**
   * Login or signup with OAuth provider (GitHub, Google)
   */
  async loginWithOAuth(input: {
    provider: "github" | "google";
    providerId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }): Promise<{
    user: AuthUser;
    organization: AuthOrganization;
    refreshToken: string;
  }> {
    const { provider, providerId: _providerId, email, name, avatarUrl } = input;

    // Check if user exists with this email
    const existingUser = await query<
      UserRecord & { org_name: string; org_plan: string; org_created_at: Date }
    >(
      `SELECT u.*, o.name as org_name, o.plan as org_plan, o.created_at as org_created_at
       FROM users u
       JOIN organizations o ON u.org_id = o.id
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      // User exists - update OAuth provider info and log them in
      const user = existingUser.rows[0];

      // Update auth provider and last login
      await query(
        `UPDATE users
         SET auth_provider = $1,
             last_login_at = NOW(),
             name = COALESCE(NULLIF($2, ''), name)
         WHERE id = $3`,
        [provider, name, user.id]
      );

      // Create session
      const { refreshToken } = await this.createSession(user.id, null, null);

      const org: OrganizationRecord = {
        id: user.org_id,
        name: user.org_name,
        slug: "",
        plan: user.org_plan,
        created_at: user.org_created_at,
      };

      logger.info({ userId: user.id, provider }, "OAuth user logged in");

      return {
        user: { ...this.formatUser(user, org), avatarUrl },
        organization: this.formatOrganization(org),
        refreshToken,
      };
    }

    // New user - create account and organization
    const orgName = name
      ? `${name}'s Organization`
      : `${email.split("@")[0]}'s Org`;
    const orgSlug = generateSlug(orgName) + "-" + Date.now().toString(36);

    const result = await transaction(null, async (client) => {
      // Create organization
      const orgResult = await client.query<OrganizationRecord>(
        `INSERT INTO organizations (name, slug, plan)
         VALUES ($1, $2, 'free')
         RETURNING *`,
        [orgName, orgSlug]
      );
      const org = orgResult.rows[0];

      // Create user (no password for OAuth users)
      const userResult = await client.query<UserRecord>(
        `INSERT INTO users (org_id, email, name, role, auth_provider, email_verified)
         VALUES ($1, $2, $3, 'owner', $4, true)
         RETURNING *`,
        [org.id, email.toLowerCase(), name, provider]
      );
      const user = userResult.rows[0];

      return { user, org };
    });

    // Create session
    const { refreshToken } = await this.createSession(
      result.user.id,
      null,
      null
    );

    logger.info(
      { userId: result.user.id, orgId: result.org.id, provider },
      "New OAuth user registered"
    );

    return {
      user: { ...this.formatUser(result.user, result.org), avatarUrl },
      organization: this.formatOrganization(result.org),
      refreshToken,
    };
  }

  /**
   * Get current user from access token
   */
  async getCurrentUser(userId: string): Promise<{
    user: AuthUser;
    organization: AuthOrganization;
  }> {
    const result = await query<
      UserRecord & { org_name: string; org_plan: string; org_created_at: Date }
    >(
      `SELECT u.*, o.name as org_name, o.plan as org_plan, o.created_at as org_created_at
       FROM users u
       JOIN organizations o ON u.org_id = o.id
       WHERE u.id = $1 AND u.is_active = true`,
      [userId]
    );

    if (result.rows.length === 0) {
      throw new AuthError("User not found", "USER_NOT_FOUND");
    }

    const user = result.rows[0];
    const org: OrganizationRecord = {
      id: user.org_id,
      name: user.org_name,
      slug: "",
      plan: user.org_plan,
      created_at: user.org_created_at,
    };

    return {
      user: this.formatUser(user, org),
      organization: this.formatOrganization(org),
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshSession(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    // Find valid session
    const sessionResult = await query<SessionRecord>(
      `SELECT * FROM sessions
       WHERE refresh_token = $1 AND expires_at > NOW()`,
      [refreshToken]
    );

    if (sessionResult.rows.length === 0) {
      throw new AuthError("Invalid or expired refresh token", "INVALID_TOKEN");
    }

    const session = sessionResult.rows[0];

    // Delete old session
    await query("DELETE FROM sessions WHERE id = $1", [session.id]);

    // Create new session
    return this.createSession(
      session.user_id,
      session.user_agent,
      session.ip_address
    );
  }

  /**
   * Logout - invalidate session
   */
  async logout(refreshToken: string): Promise<void> {
    await query("DELETE FROM sessions WHERE refresh_token = $1", [
      refreshToken,
    ]);
  }

  /**
   * Logout from all devices
   */
  async logoutAll(userId: string): Promise<void> {
    await query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    logger.info({ userId }, "User logged out from all devices");
  }

  /**
   * Create a new session and return tokens
   */
  private async createSession(
    userId: string,
    userAgent: string | null,
    ipAddress: string | null
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const refreshToken = generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

    // Store session
    await query(
      `INSERT INTO sessions (user_id, refresh_token, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, refreshToken, userAgent, ipAddress, expiresAt]
    );

    // Generate JWT access token (short-lived)
    // We'll use a simple token format for now, the JWT plugin handles the actual signing
    const accessToken = this.generateAccessToken(userId);

    return { accessToken, refreshToken };
  }

  /**
   * Generate JWT access token payload
   * Note: Actual JWT signing is done by Fastify JWT plugin
   */
  private generateAccessToken(userId: string): string {
    // This returns a placeholder - actual JWT signing happens in the route
    // We return the userId to be signed by Fastify's jwt.sign()
    return userId;
  }

  /**
   * Format user record for API response
   */
  private formatUser(user: UserRecord, org: OrganizationRecord): AuthUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as "owner" | "admin" | "member",
      orgId: user.org_id,
      orgName: org.name,
    };
  }

  /**
   * Format organization record for API response
   */
  private formatOrganization(org: OrganizationRecord): AuthOrganization {
    return {
      id: org.id,
      name: org.name,
      plan: org.plan as "free" | "pro" | "enterprise",
      createdAt: org.created_at.toISOString(),
    };
  }

  /**
   * Clean up expired sessions (call periodically)
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await query("DELETE FROM sessions WHERE expires_at < NOW()");
    return result.rowCount || 0;
  }
}

// ============================================
// Custom Error Class
// ============================================

export class AuthError extends Error {
  constructor(
    message: string,
    public code:
      | "INVALID_EMAIL"
      | "WEAK_PASSWORD"
      | "EMAIL_EXISTS"
      | "INVALID_CREDENTIALS"
      | "OAUTH_ONLY"
      | "USER_NOT_FOUND"
      | "INVALID_TOKEN"
      | "UNAUTHORIZED"
      // Account linking errors
      | "PROVIDER_ALREADY_LINKED"
      | "PROVIDER_LINKED_TO_OTHER"
      | "EMAIL_BELONGS_TO_OTHER"
      | "CANNOT_UNLINK_PRIMARY"
      | "CANNOT_REMOVE_LAST_AUTH"
      | "IDENTITY_NOT_FOUND"
      | "ACCOUNTS_NOT_FOUND"
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// Singleton instance
export const authService = new AuthService();
