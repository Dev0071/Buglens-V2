/**
 * Audit Logging Service
 *
 * Provides comprehensive audit trail for SOC2 compliance:
 * - Authentication events (login, logout, failed attempts)
 * - Authorization changes (role assignments, permissions)
 * - Data access (sensitive data views)
 * - Configuration changes (settings, integrations)
 * - Administrative actions (user/org management)
 *
 * @module services/audit
 */

import { query } from "../db/client.js";
import { logger } from "../utils/logger.js";

// ============================================
// Types
// ============================================

export type AuditAction =
  // Authentication
  | "user.login"
  | "user.login.failed"
  | "user.logout"
  | "user.logout.all"
  | "user.signup"
  | "user.password.change"
  | "user.password.reset"
  | "user.mfa.enable"
  | "user.mfa.disable"
  // Authorization
  | "user.role.change"
  | "user.invite"
  | "user.remove"
  | "user.suspend"
  | "user.unsuspend"
  // Organization
  | "organization.created"
  | "organization.updated"
  | "organization.deleted"
  | "organization.suspend"
  | "organization.unsuspend"
  | "organization.plan.change"
  // Integrations
  | "integration.created"
  | "integration.updated"
  | "integration.deleted"
  | "integration.oauth.connect"
  | "integration.oauth.disconnect"
  // Data Access
  | "rca.view"
  | "rca.created"
  | "event.view"
  | "event.created"
  | "export.requested"
  | "export.downloaded"
  // Settings
  | "settings.updated"
  | "webhook.created"
  | "webhook.deleted"
  // Admin
  | "admin.access"
  | "admin.user.view"
  | "admin.org.view"
  | "admin.system.view"
  | "secret.rotated"
  | "secret.created"
  | "secret.accessed";

export type AuditActorType = "user" | "system" | "api_key" | "webhook";
export type AuditResourceType =
  | "user"
  | "organization"
  | "integration"
  | "rca"
  | "event"
  | "settings"
  | "secret"
  | "session";

export interface AuditLogEntry {
  actorId: string | null;
  actorType: AuditActorType;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  orgId?: string;
}

export interface AuditLogRecord extends AuditLogEntry {
  id: string;
  createdAt: Date;
}

// ============================================
// Audit Service
// ============================================

/**
 * Log an audit event to the database
 * @param entry Audit log entry
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs
       (actor_id, actor_type, action, resource_type, resource_id, details, ip_address, user_agent, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.actorId,
        entry.actorType,
        entry.action,
        entry.resourceType,
        entry.resourceId,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.ipAddress || null,
        entry.userAgent || null,
        entry.orgId || null,
      ]
    );
  } catch (error) {
    // Log errors but don't throw - audit logging should not break application flow
    logger.error({ error, entry }, "Failed to write audit log");
  }
}

// ============================================
// Convenience Methods for Common Events
// ============================================

/**
 * Log a successful user login
 */
export async function logLogin(
  userId: string,
  orgId: string,
  ipAddress?: string,
  userAgent?: string,
  details?: Record<string, unknown>
): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorType: "user",
    action: "user.login",
    resourceType: "user",
    resourceId: userId,
    details: { ...details, method: details?.method || "password" },
    ipAddress,
    userAgent,
    orgId,
  });
}

/**
 * Log a failed login attempt
 */
export async function logLoginFailed(
  email: string,
  ipAddress?: string,
  userAgent?: string,
  reason?: string
): Promise<void> {
  await logAuditEvent({
    actorId: null,
    actorType: "user",
    action: "user.login.failed",
    resourceType: "user",
    resourceId: null,
    details: { email, reason: reason || "invalid_credentials" },
    ipAddress,
    userAgent,
  });
}

/**
 * Log a user logout
 */
export async function logLogout(
  userId: string,
  orgId: string,
  ipAddress?: string,
  userAgent?: string,
  allDevices = false
): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorType: "user",
    action: allDevices ? "user.logout.all" : "user.logout",
    resourceType: "user",
    resourceId: userId,
    ipAddress,
    userAgent,
    orgId,
  });
}

/**
 * Log a new user signup
 */
export async function logSignup(
  userId: string,
  orgId: string,
  email: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorType: "user",
    action: "user.signup",
    resourceType: "user",
    resourceId: userId,
    details: { email },
    ipAddress,
    userAgent,
    orgId,
  });
}

/**
 * Log organization creation
 */
export async function logOrgCreated(
  userId: string,
  orgId: string,
  orgName: string,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorType: "user",
    action: "organization.created",
    resourceType: "organization",
    resourceId: orgId,
    details: { name: orgName },
    ipAddress,
    orgId,
  });
}

/**
 * Log user role change
 */
export async function logRoleChange(
  actorId: string,
  targetUserId: string,
  orgId: string,
  oldRole: string,
  newRole: string,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId,
    actorType: "user",
    action: "user.role.change",
    resourceType: "user",
    resourceId: targetUserId,
    details: { oldRole, newRole },
    ipAddress,
    orgId,
  });
}

/**
 * Log user suspension
 */
export async function logUserSuspend(
  actorId: string,
  targetUserId: string,
  orgId: string,
  reason: string,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId,
    actorType: "user",
    action: "user.suspend",
    resourceType: "user",
    resourceId: targetUserId,
    details: { reason },
    ipAddress,
    orgId,
  });
}

/**
 * Log organization suspension
 */
export async function logOrgSuspend(
  actorId: string,
  orgId: string,
  reason: string,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId,
    actorType: "user",
    action: "organization.suspend",
    resourceType: "organization",
    resourceId: orgId,
    details: { reason },
    ipAddress,
    orgId,
  });
}

/**
 * Log integration connection
 */
export async function logIntegrationConnect(
  userId: string,
  orgId: string,
  integrationType: string,
  integrationId: string,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorType: "user",
    action: "integration.oauth.connect",
    resourceType: "integration",
    resourceId: integrationId,
    details: { type: integrationType },
    ipAddress,
    orgId,
  });
}

/**
 * Log integration disconnection
 */
export async function logIntegrationDisconnect(
  userId: string,
  orgId: string,
  integrationType: string,
  integrationId: string,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorType: "user",
    action: "integration.oauth.disconnect",
    resourceType: "integration",
    resourceId: integrationId,
    details: { type: integrationType },
    ipAddress,
    orgId,
  });
}

/**
 * Log admin panel access
 */
export async function logAdminAccess(
  userId: string,
  context: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorType: "user",
    action: "admin.access",
    resourceType: "user",
    resourceId: userId,
    details: { context },
    ipAddress,
    userAgent,
  });
}

/**
 * Log settings update
 */
export async function logSettingsUpdate(
  userId: string,
  orgId: string,
  settingType: string,
  changes: Record<string, unknown>,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorType: "user",
    action: "settings.updated",
    resourceType: "settings",
    resourceId: orgId,
    details: { settingType, changes },
    ipAddress,
    orgId,
  });
}

/**
 * Log data export request
 */
export async function logExportRequest(
  userId: string,
  orgId: string,
  exportType: string,
  format: string,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorType: "user",
    action: "export.requested",
    resourceType: "organization",
    resourceId: orgId,
    details: { exportType, format },
    ipAddress,
    orgId,
  });
}

/**
 * Log secret rotation
 */
export async function logSecretRotation(
  actorId: string,
  secretName: string,
  reason: string,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId,
    actorType: "user",
    action: "secret.rotated",
    resourceType: "secret",
    resourceId: secretName,
    details: { reason },
    ipAddress,
  });
}

/**
 * Log user invitation
 */
export async function logUserInvite(
  actorId: string,
  targetEmail: string,
  role: string,
  orgId: string,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId,
    actorType: "user",
    action: "user.invite",
    resourceType: "user",
    resourceId: null,
    details: { email: targetEmail, role },
    ipAddress,
    orgId,
  });
}

/**
 * Log user removal from organization
 */
export async function logUserRemove(
  actorId: string,
  targetUserId: string,
  targetEmail: string,
  orgId: string,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId,
    actorType: "user",
    action: "user.remove",
    resourceType: "user",
    resourceId: targetUserId,
    details: { email: targetEmail },
    ipAddress,
    orgId,
  });
}

/**
 * Log password change
 */
export async function logPasswordChange(
  userId: string,
  orgId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorType: "user",
    action: "user.password.change",
    resourceType: "user",
    resourceId: userId,
    ipAddress,
    userAgent,
    orgId,
  });
}

/**
 * Log organization deletion
 */
export async function logOrgDelete(
  actorId: string,
  orgId: string,
  orgName: string,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId,
    actorType: "user",
    action: "organization.deleted",
    resourceType: "organization",
    resourceId: orgId,
    details: { name: orgName },
    ipAddress,
    orgId,
  });
}

/**
 * Log organization plan change
 */
export async function logPlanChange(
  actorId: string,
  orgId: string,
  oldPlan: string,
  newPlan: string,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    actorId,
    actorType: "user",
    action: "organization.plan.change",
    resourceType: "organization",
    resourceId: orgId,
    details: { oldPlan, newPlan },
    ipAddress,
    orgId,
  });
}

/**
 * Log account deletion (self-initiated)
 */
export async function logAccountDeletion(
  userId: string,
  orgId: string,
  email: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    actorId: userId,
    actorType: "user",
    action: "user.suspend",
    resourceType: "user",
    resourceId: userId,
    details: { email, reason: "self_deletion" },
    ipAddress,
    userAgent,
    orgId,
  });
}

// ============================================
// Export Default Object
// ============================================

export const auditService = {
  logAuditEvent,
  logLogin,
  logLoginFailed,
  logLogout,
  logSignup,
  logOrgCreated,
  logRoleChange,
  logUserSuspend,
  logOrgSuspend,
  logIntegrationConnect,
  logIntegrationDisconnect,
  logAdminAccess,
  logSettingsUpdate,
  logExportRequest,
  logSecretRotation,
  logUserInvite,
  logUserRemove,
  logPasswordChange,
  logOrgDelete,
  logPlanChange,
  logAccountDeletion,
};

export default auditService;
