/**
 * Admin Authentication Hook
 *
 * Shared authentication logic for all admin routes.
 * Requires:
 * 1. Valid JWT token
 * 2. User with admin/super_admin/owner role
 * 3. Valid X-Admin-Token header
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { query } from "../../db/client.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../utils/config.js";

// Cache user roles briefly to avoid DB hits on every request
const roleCache = new Map<string, { role: string; timestamp: number }>();
const CACHE_TTL_MS = 60000; // 1 minute

interface UserWithRole {
  id: string;
  role: string;
}

/**
 * Fetch user's role from database with caching
 */
async function getUserRole(userId: string): Promise<string | null> {
  // Check cache
  const cached = roleCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.role;
  }

  // Fetch from database
  const result = await query<UserWithRole>(
    "SELECT id, role FROM users WHERE id = $1",
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const role = result.rows[0].role;
  roleCache.set(userId, { role, timestamp: Date.now() });
  return role;
}

/**
 * Clear cached role for a user (call after role changes)
 */
export function clearRoleCache(userId: string): void {
  roleCache.delete(userId);
}

/**
 * Verify admin access for a request
 *
 * @param context - Context string for logging (e.g., "organization management")
 */
export function createAdminAuthHook(context: string) {
  return async function verifyAdminAccess(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = request.user as any;

    if (!user || !user.userId) {
      reply.status(401).send({ error: "Authentication required" });
      return;
    }

    // Fetch the role from database (JWT doesn't contain role)
    const role = await getUserRole(user.userId);

    if (!role) {
      logger.warn(
        { userId: user.userId },
        "User not found during admin access"
      );
      reply.status(401).send({ error: "User not found" });
      return;
    }

    const isAdmin =
      role === "admin" || role === "super_admin" || role === "owner";
    if (!isAdmin) {
      logger.warn(
        { userId: user.userId, role },
        `Non-admin user attempted to access ${context}`
      );
      reply.status(403).send({ error: "Admin access required" });
      return;
    }

    // Verify platform admin token
    const adminToken = request.headers["x-admin-token"] as string | undefined;
    const expectedToken = config.PLATFORM_ADMIN_TOKEN;

    if (!expectedToken) {
      const error = new Error("PLATFORM_ADMIN_TOKEN not configured");
      logger.error(error.message);
      // Import captureException to send to Sentry
      import("../../utils/sentry.js").then(({ captureException }) => {
        captureException(error, { context: "admin-auth-middleware" });
      });
      reply.status(500).send({ error: "Server configuration error" });
      return;
    }

    if (!adminToken || adminToken !== expectedToken) {
      logger.warn(
        { userId: user.userId, hasToken: !!adminToken },
        `Invalid admin token for ${context}`
      );
      reply.status(403).send({ error: "Invalid admin token" });
      return;
    }

    // Attach role to request for use in handlers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (request as any).adminRole = role;
  };
}
