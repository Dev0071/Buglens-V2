/**
 * Admin Routes for Secret Management
 *
 * Provides endpoints for:
 * - Secret rotation status monitoring
 * - Manual secret rotation triggering
 * - Rollback capabilities
 * - Rotation history viewing
 *
 * @security Requires admin role + platform-admin-token validation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  getRotationStatus,
  getSecretVersions,
  getRotationHistory,
  rotateSecret,
  rollbackRotation,
  cleanupExpiredSecrets,
  getSecretsNeedingRotation,
  type SecretType,
  type RotationReason,
} from "../../../services/secret-manager.js";
import { logger } from "../../../utils/logger.js";
import { config } from "../../../utils/config.js";

// ============================================
// Types
// ============================================

interface RotateSecretBody {
  secret_type: SecretType;
  reason?: RotationReason;
  grace_period_days?: number;
}

interface RollbackSecretBody {
  secret_type: SecretType;
}

interface SecretTypeParams {
  secretType: SecretType;
}

// ============================================
// Admin Authentication Hook
// ============================================

/**
 * Verify platform admin token
 * This is a separate auth mechanism from user JWT for sensitive operations
 */
async function verifyAdminAccess(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // First, check if user is authenticated and has admin role
  if (!request.user) {
    reply.status(401).send({ error: "Authentication required" });
    return;
  }

  // Check admin role from JWT
  const user = request.user as { userId?: string; role?: string } | undefined;
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  if (!isAdmin) {
    logger.warn(
      { userId: user?.userId, role: user?.role },
      "Non-admin user attempted to access secret management"
    );
    reply.status(403).send({ error: "Admin access required" });
    return;
  }

  // Additionally verify platform admin token for extra security
  const adminToken = request.headers["x-admin-token"] as string | undefined;
  const expectedToken = config.PLATFORM_ADMIN_TOKEN;

  if (!expectedToken) {
    logger.error("PLATFORM_ADMIN_TOKEN not configured");
    reply.status(500).send({ error: "Server configuration error" });
    return;
  }

  if (!adminToken || adminToken !== expectedToken) {
    logger.warn(
      { userId: user?.userId, hasToken: !!adminToken },
      "Invalid admin token for secret management"
    );
    reply.status(403).send({ error: "Invalid admin token" });
    return;
  }
}

// ============================================
// Route Registration
// ============================================

export async function adminSecretRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // Apply admin auth to all routes in this plugin
  fastify.addHook("preHandler", verifyAdminAccess);

  /**
   * GET /api/admin/secrets/status
   * Get rotation status for all managed secrets
   */
  fastify.get("/status", async (_request, reply) => {
    try {
      const statuses = await getRotationStatus();
      const needingRotation = await getSecretsNeedingRotation(14);

      return reply.send({
        secrets: statuses,
        summary: {
          total: statuses.length,
          healthy: statuses.filter((s) => s.status === "healthy").length,
          expiring_soon: statuses.filter((s) => s.status === "expiring_soon")
            .length,
          overdue: statuses.filter((s) => s.status === "overdue").length,
          missing: statuses.filter((s) => s.status === "missing").length,
        },
        alerts: needingRotation.map((s) => ({
          secret_type: s.secretType,
          status: s.status,
          days_until_expiration: s.daysUntilExpiration,
          message:
            s.status === "overdue"
              ? `${s.secretType} rotation is overdue`
              : `${s.secretType} expires in ${s.daysUntilExpiration} days`,
        })),
      });
    } catch (error) {
      logger.error({ error }, "Failed to get secret status");
      return reply
        .status(500)
        .send({ error: "Failed to retrieve secret status" });
    }
  });

  /**
   * GET /api/admin/secrets/:secretType/versions
   * Get all versions of a specific secret (without values)
   */
  fastify.get<{ Params: SecretTypeParams }>(
    "/:secretType/versions",
    async (request, reply) => {
      const { secretType } = request.params;

      try {
        const versions = await getSecretVersions(secretType);
        return reply.send({ secret_type: secretType, versions });
      } catch (error) {
        logger.error({ error, secretType }, "Failed to get secret versions");
        return reply
          .status(500)
          .send({ error: "Failed to retrieve secret versions" });
      }
    }
  );

  /**
   * GET /api/admin/secrets/:secretType/history
   * Get rotation history for a secret
   */
  fastify.get<{ Params: SecretTypeParams; Querystring: { limit?: number } }>(
    "/:secretType/history",
    async (request, reply) => {
      const { secretType } = request.params;
      const limit = request.query.limit || 20;

      try {
        const history = await getRotationHistory(secretType, limit);
        return reply.send({
          secret_type: secretType,
          history: history.map((event) => ({
            ...event,
            // Mask key IDs partially for security
            old_key_id: event.old_key_id
              ? `${event.old_key_id.slice(0, 15)}...`
              : null,
            new_key_id: `${event.new_key_id.slice(0, 15)}...`,
          })),
        });
      } catch (error) {
        logger.error({ error, secretType }, "Failed to get rotation history");
        return reply
          .status(500)
          .send({ error: "Failed to retrieve rotation history" });
      }
    }
  );

  /**
   * POST /api/admin/secrets/rotate
   * Trigger manual rotation for a secret
   */
  fastify.post<{ Body: RotateSecretBody }>(
    "/rotate",
    async (request, reply) => {
      const {
        secret_type,
        reason = "manual",
        grace_period_days = 7,
      } = request.body;

      if (!secret_type) {
        return reply.status(400).send({ error: "secret_type is required" });
      }

      const validTypes = [
        "jwt_secret",
        "encryption_key",
        "github_webhook_secret",
        "sentry_webhook_secret",
        "openai_api_key",
      ];

      if (!validTypes.includes(secret_type)) {
        return reply.status(400).send({
          error: `Invalid secret_type. Must be one of: ${validTypes.join(", ")}`,
        });
      }

      // Validate grace period
      if (grace_period_days < 1 || grace_period_days > 30) {
        return reply
          .status(400)
          .send({ error: "grace_period_days must be between 1 and 30" });
      }

      logger.info(
        {
          secretType: secret_type,
          reason,
          userId: (request.user as { userId?: string })?.userId,
        },
        "Admin initiated secret rotation"
      );

      try {
        const result = await rotateSecret(secret_type, {
          rotatedBy: (request.user as { userId?: string })?.userId,
          reason,
          gracePeriodDays: grace_period_days,
        });

        if (result.success) {
          return reply.send({
            success: true,
            message: `Secret ${secret_type} rotated successfully`,
            details: {
              new_key_id: `${result.newKeyId.slice(0, 15)}...`,
              old_key_id: result.oldKeyId
                ? `${result.oldKeyId.slice(0, 15)}...`
                : null,
              affected_records: result.affectedRecords,
              duration_ms: result.durationMs,
            },
          });
        } else {
          logger.error(
            { secretType: secret_type, error: result.error },
            "Secret rotation failed"
          );
          return reply.status(500).send({
            success: false,
            error: "Secret rotation failed",
            details: result.error,
          });
        }
      } catch (error) {
        logger.error(
          { error, secretType: secret_type },
          "Secret rotation error"
        );
        return reply
          .status(500)
          .send({ error: "Internal server error during rotation" });
      }
    }
  );

  /**
   * POST /api/admin/secrets/rollback
   * Rollback a recent rotation (restore previous version)
   */
  fastify.post<{ Body: RollbackSecretBody }>(
    "/rollback",
    async (request, reply) => {
      const { secret_type } = request.body;

      if (!secret_type) {
        return reply.status(400).send({ error: "secret_type is required" });
      }

      logger.warn(
        {
          secretType: secret_type,
          userId: (request.user as { userId?: string })?.userId,
        },
        "Admin initiated secret rollback"
      );

      try {
        const result = await rollbackRotation(
          secret_type,
          (request.user as { userId?: string })?.userId
        );

        if (result.success) {
          return reply.send({
            success: true,
            message: `Secret ${secret_type} rolled back successfully`,
            details: {
              restored_key_id: `${result.newKeyId.slice(0, 15)}...`,
              removed_key_id: result.oldKeyId
                ? `${result.oldKeyId.slice(0, 15)}...`
                : null,
              duration_ms: result.durationMs,
            },
          });
        } else {
          return reply.status(500).send({
            success: false,
            error: "Rollback failed",
            details: result.error,
          });
        }
      } catch (error) {
        logger.error(
          { error, secretType: secret_type },
          "Secret rollback error"
        );
        return reply
          .status(500)
          .send({ error: "Internal server error during rollback" });
      }
    }
  );

  /**
   * POST /api/admin/secrets/cleanup
   * Clean up expired secret versions
   */
  fastify.post("/cleanup", async (request, reply) => {
    try {
      const deletedCount = await cleanupExpiredSecrets();

      logger.info(
        { deletedCount, userId: (request.user as { userId?: string })?.userId },
        "Admin triggered secret cleanup"
      );

      return reply.send({
        success: true,
        message: `Cleaned up ${deletedCount} expired secret(s)`,
        deleted_count: deletedCount,
      });
    } catch (error) {
      logger.error({ error }, "Secret cleanup error");
      return reply
        .status(500)
        .send({ error: "Failed to cleanup expired secrets" });
    }
  });

  /**
   * GET /api/admin/secrets/alerts
   * Get secrets that need attention (expiring soon or overdue)
   */
  fastify.get<{ Querystring: { warning_days?: number } }>(
    "/alerts",
    async (request, reply) => {
      const warningDays = request.query.warning_days || 14;

      try {
        const secrets = await getSecretsNeedingRotation(warningDays);

        return reply.send({
          warning_threshold_days: warningDays,
          alert_count: secrets.length,
          alerts: secrets.map((s) => ({
            secret_type: s.secretType,
            status: s.status,
            current_key_id: s.currentKeyId
              ? `${s.currentKeyId.slice(0, 15)}...`
              : null,
            last_rotated: s.lastRotated,
            next_rotation_due: s.nextRotationDue,
            days_until_expiration: s.daysUntilExpiration,
            recommended_action:
              s.status === "overdue"
                ? "Immediate rotation required"
                : s.status === "expiring_soon"
                  ? "Schedule rotation soon"
                  : s.status === "missing"
                    ? "Initialize secret"
                    : "No action needed",
          })),
        });
      } catch (error) {
        logger.error({ error }, "Failed to get secret alerts");
        return reply
          .status(500)
          .send({ error: "Failed to retrieve secret alerts" });
      }
    }
  );
}

export default adminSecretRoutes;
