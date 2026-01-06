import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import bcrypt from "bcrypt";
import { logger } from "../../utils/logger.js";
import { query } from "../../db/client.js";
import { logPasswordChange, logAccountDeletion } from "../../services/audit.js";

// ============================================
// Request/Response Schemas
// ============================================

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

const notificationPreferencesSchema = z.object({
  emailNotifications: z.boolean().optional(),
  slackNotifications: z.boolean().optional(),
  dailyDigest: z.boolean().optional(),
  weeklyReport: z.boolean().optional(),
  notificationLevel: z.enum(["all", "high", "critical", "none"]).optional(),
});

type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
type NotificationPreferencesBody = z.infer<
  typeof notificationPreferencesSchema
>;

// ============================================
// Response Types
// ============================================

interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
  emailVerified: boolean;
  authProvider: string;
  createdAt: string;
  lastLoginAt: string | null;
}

interface NotificationPreferences {
  emailNotifications: boolean;
  slackNotifications: boolean;
  dailyDigest: boolean;
  weeklyReport: boolean;
  notificationLevel: "all" | "high" | "critical" | "none";
}

// ============================================
// Route Handlers
// ============================================

/**
 * GET /api/profile
 *
 * Returns the current user's profile
 */
async function getProfileHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = request.getUserId();

  if (!userId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required",
    });
    return;
  }

  try {
    const result = await query<{
      id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
      role: string;
      email_verified: boolean;
      auth_provider: string;
      created_at: string;
      last_login_at: string | null;
    }>(
      `SELECT
        id, email, name, avatar_url, role,
        email_verified, auth_provider, created_at, last_login_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "User not found",
      });
      return;
    }

    const user = result.rows[0];
    const profile: UserProfile = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
      role: user.role,
      emailVerified: user.email_verified,
      authProvider: user.auth_provider || "email",
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
    };

    reply.send({ profile });
  } catch (error) {
    logger.error({ error, userId }, "Failed to fetch user profile");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch profile",
    });
  }
}

/**
 * PATCH /api/profile
 *
 * Updates the current user's profile
 */
async function updateProfileHandler(
  request: FastifyRequest<{ Body: UpdateProfileBody }>,
  reply: FastifyReply
): Promise<void> {
  const userId = request.getUserId();

  if (!userId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required",
    });
    return;
  }

  // Validate request body
  const parseResult = updateProfileSchema.safeParse(request.body);
  if (!parseResult.success) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid request body",
      details: parseResult.error.issues,
    });
    return;
  }

  const { name, avatarUrl } = parseResult.data;

  try {
    const updates: string[] = [];
    const values: (string | null)[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }

    if (avatarUrl !== undefined) {
      updates.push(`avatar_url = $${paramIndex++}`);
      values.push(avatarUrl);
    }

    if (updates.length === 0) {
      reply.status(400).send({
        error: "Bad Request",
        message: "No fields to update",
      });
      return;
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const result = await query<{
      id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
      role: string;
    }>(
      `UPDATE users
       SET ${updates.join(", ")}
       WHERE id = $${paramIndex}
       RETURNING id, email, name, avatar_url, role`,
      values
    );

    if (result.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "User not found",
      });
      return;
    }

    const user = result.rows[0];
    reply.send({
      success: true,
      profile: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
        role: user.role,
      },
      message: "Profile updated successfully",
    });

    logger.info({ userId }, "User profile updated");
  } catch (error) {
    logger.error({ error, userId }, "Failed to update user profile");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to update profile",
    });
  }
}

/**
 * POST /api/profile/change-password
 *
 * Changes the user's password
 */
async function changePasswordHandler(
  request: FastifyRequest<{ Body: ChangePasswordBody }>,
  reply: FastifyReply
): Promise<void> {
  const userId = request.getUserId();

  if (!userId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required",
    });
    return;
  }

  // Validate request body
  const parseResult = changePasswordSchema.safeParse(request.body);
  if (!parseResult.success) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid request body",
      details: parseResult.error.issues,
    });
    return;
  }

  const { currentPassword, newPassword } = parseResult.data;

  try {
    // Get current password hash
    const userResult = await query<{
      password_hash: string | null;
      auth_provider: string;
    }>(`SELECT password_hash, auth_provider FROM users WHERE id = $1`, [
      userId,
    ]);

    if (userResult.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "User not found",
      });
      return;
    }

    const user = userResult.rows[0];

    // OAuth users cannot change password
    if (user.auth_provider && user.auth_provider !== "email") {
      reply.status(400).send({
        error: "Bad Request",
        message: `Cannot change password for ${user.auth_provider} account`,
      });
      return;
    }

    // Verify current password
    if (!user.password_hash) {
      reply.status(400).send({
        error: "Bad Request",
        message: "No password set for this account",
      });
      return;
    }

    const isValidPassword = await bcrypt.compare(
      currentPassword,
      user.password_hash
    );

    if (!isValidPassword) {
      reply.status(401).send({
        error: "Unauthorized",
        message: "Current password is incorrect",
      });
      return;
    }

    // Hash and update new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await query(
      `UPDATE users
       SET password_hash = $1, updated_at = NOW()
       WHERE id = $2`,
      [newPasswordHash, userId]
    );

    // Get org_id for audit logging
    const orgResult = await query<{ org_id: string }>(
      `SELECT org_id FROM users WHERE id = $1`,
      [userId]
    );
    const orgId = orgResult.rows[0]?.org_id;

    // Audit log: password change (CRITICAL for SOC2)
    await logPasswordChange(
      userId,
      orgId,
      request.ip,
      request.headers["user-agent"] as string
    );

    reply.send({
      success: true,
      message: "Password changed successfully",
    });

    logger.info({ userId }, "User password changed");
  } catch (error) {
    logger.error({ error, userId }, "Failed to change password");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to change password",
    });
  }
}

/**
 * GET /api/profile/notifications
 *
 * Returns user's notification preferences
 */
async function getNotificationPreferencesHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = request.getUserId();
  const orgId = request.getOrgId();

  if (!userId || !orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required",
    });
    return;
  }

  try {
    // Get organization settings (notification preferences are stored there)
    const result = await query<{ settings: Record<string, unknown> }>(
      `SELECT settings FROM organizations WHERE id = $1`,
      [orgId]
    );

    if (result.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "Organization not found",
      });
      return;
    }

    const settings = result.rows[0].settings || {};
    const preferences: NotificationPreferences = {
      emailNotifications: (settings.email_notifications as boolean) ?? true,
      slackNotifications: (settings.slack_notifications as boolean) ?? true,
      dailyDigest: (settings.daily_digest as boolean) ?? false,
      weeklyReport: (settings.weekly_report as boolean) ?? false,
      notificationLevel:
        (settings.notification_level as NotificationPreferences["notificationLevel"]) ??
        "high",
    };

    reply.send({ preferences });
  } catch (error) {
    logger.error({ error, userId }, "Failed to fetch notification preferences");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch notification preferences",
    });
  }
}

/**
 * PATCH /api/profile/notifications
 *
 * Updates user's notification preferences
 */
async function updateNotificationPreferencesHandler(
  request: FastifyRequest<{ Body: NotificationPreferencesBody }>,
  reply: FastifyReply
): Promise<void> {
  const userId = request.getUserId();
  const orgId = request.getOrgId();

  if (!userId || !orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required",
    });
    return;
  }

  // Validate request body
  const parseResult = notificationPreferencesSchema.safeParse(request.body);
  if (!parseResult.success) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid request body",
      details: parseResult.error.issues,
    });
    return;
  }

  const updates = parseResult.data;

  try {
    // Get current settings
    const currentResult = await query<{ settings: Record<string, unknown> }>(
      `SELECT settings FROM organizations WHERE id = $1`,
      [orgId]
    );

    if (currentResult.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "Organization not found",
      });
      return;
    }

    const currentSettings = currentResult.rows[0].settings || {};

    // Merge updates
    const newSettings = {
      ...currentSettings,
      ...(updates.emailNotifications !== undefined && {
        email_notifications: updates.emailNotifications,
      }),
      ...(updates.slackNotifications !== undefined && {
        slack_notifications: updates.slackNotifications,
      }),
      ...(updates.dailyDigest !== undefined && {
        daily_digest: updates.dailyDigest,
      }),
      ...(updates.weeklyReport !== undefined && {
        weekly_report: updates.weeklyReport,
      }),
      ...(updates.notificationLevel !== undefined && {
        notification_level: updates.notificationLevel,
      }),
    };

    // Update organization settings
    await query(
      `UPDATE organizations
       SET settings = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(newSettings), orgId]
    );

    reply.send({
      success: true,
      preferences: {
        emailNotifications: newSettings.email_notifications ?? true,
        slackNotifications: newSettings.slack_notifications ?? true,
        dailyDigest: newSettings.daily_digest ?? false,
        weeklyReport: newSettings.weekly_report ?? false,
        notificationLevel: newSettings.notification_level ?? "high",
      },
      message: "Notification preferences updated",
    });

    logger.info({ userId, orgId }, "Notification preferences updated");
  } catch (error) {
    logger.error(
      { error, userId },
      "Failed to update notification preferences"
    );
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to update notification preferences",
    });
  }
}

/**
 * DELETE /api/profile
 *
 * Deletes the current user's account
 */
async function deleteAccountHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = request.getUserId();
  const orgId = request.getOrgId();

  if (!userId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required",
    });
    return;
  }

  try {
    // Check if user is the owner
    const userResult = await query<{ role: string }>(
      `SELECT role FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "User not found",
      });
      return;
    }

    const user = userResult.rows[0];

    // If owner, check if there are other members
    if (user.role === "owner" && orgId) {
      const membersCount = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM users WHERE org_id = $1 AND id != $2`,
        [orgId, userId]
      );

      if (parseInt(membersCount.rows[0].count, 10) > 0) {
        reply.status(400).send({
          error: "Bad Request",
          message:
            "Cannot delete owner account while other members exist. Transfer ownership first.",
        });
        return;
      }
    }

    // Soft delete the user (or hard delete based on requirements)
    await query(
      `UPDATE users
       SET is_active = false, updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    // Invalidate all sessions
    await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);

    // Get user email for audit
    const userDetails = await query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [userId]
    );
    const email = userDetails.rows[0]?.email || "unknown";

    // Audit log: account deletion (HIGH priority for SOC2)
    await logAccountDeletion(
      userId,
      orgId || "",
      email,
      request.ip,
      request.headers["user-agent"] as string
    );

    reply.send({
      success: true,
      message: "Account deleted successfully",
    });

    logger.info({ userId }, "User account deleted");
  } catch (error) {
    logger.error({ error, userId }, "Failed to delete user account");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to delete account",
    });
  }
}

// ============================================
// Route Registration
// ============================================

export async function profileRoutes(server: FastifyInstance): Promise<void> {
  // GET /api/profile
  server.get(
    "/profile",
    {
      schema: {
        description: "Get current user profile",
        tags: ["Profile"],
        response: {
          200: {
            type: "object",
            properties: {
              profile: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  email: { type: "string" },
                  name: { type: "string", nullable: true },
                  avatarUrl: { type: "string", nullable: true },
                  role: { type: "string" },
                  emailVerified: { type: "boolean" },
                  authProvider: { type: "string" },
                  createdAt: { type: "string" },
                  lastLoginAt: { type: "string", nullable: true },
                },
              },
            },
          },
        },
      },
    },
    getProfileHandler
  );

  // PATCH /api/profile
  server.patch(
    "/profile",
    {
      schema: {
        description: "Update current user profile",
        tags: ["Profile"],
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            avatarUrl: { type: "string", format: "uri", nullable: true },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              profile: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  email: { type: "string" },
                  name: { type: "string", nullable: true },
                  avatarUrl: { type: "string", nullable: true },
                  role: { type: "string" },
                },
              },
              message: { type: "string" },
            },
          },
        },
      },
    },
    updateProfileHandler
  );

  // POST /api/profile/change-password
  server.post(
    "/profile/change-password",
    {
      schema: {
        description: "Change user password",
        tags: ["Profile"],
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string" },
            newPassword: { type: "string", minLength: 8, maxLength: 100 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    changePasswordHandler
  );

  // GET /api/profile/notifications
  server.get(
    "/profile/notifications",
    {
      schema: {
        description: "Get notification preferences",
        tags: ["Profile"],
        response: {
          200: {
            type: "object",
            properties: {
              preferences: {
                type: "object",
                properties: {
                  emailNotifications: { type: "boolean" },
                  slackNotifications: { type: "boolean" },
                  dailyDigest: { type: "boolean" },
                  weeklyReport: { type: "boolean" },
                  notificationLevel: {
                    type: "string",
                    enum: ["all", "high", "critical", "none"],
                  },
                },
              },
            },
          },
        },
      },
    },
    getNotificationPreferencesHandler
  );

  // PATCH /api/profile/notifications
  server.patch(
    "/profile/notifications",
    {
      schema: {
        description: "Update notification preferences",
        tags: ["Profile"],
        body: {
          type: "object",
          properties: {
            emailNotifications: { type: "boolean" },
            slackNotifications: { type: "boolean" },
            dailyDigest: { type: "boolean" },
            weeklyReport: { type: "boolean" },
            notificationLevel: {
              type: "string",
              enum: ["all", "high", "critical", "none"],
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              preferences: { type: "object" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    updateNotificationPreferencesHandler
  );

  // DELETE /api/profile
  server.delete(
    "/profile",
    {
      schema: {
        description: "Delete user account",
        tags: ["Profile"],
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    deleteAccountHandler
  );

  logger.info("Profile routes registered");
}
