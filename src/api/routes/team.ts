import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { logger } from "../../utils/logger.js";
import { query } from "../../db/client.js";
import {
  logUserInvite,
  logUserRemove,
  logRoleChange,
} from "../../services/audit.js";

// ============================================
// Request/Response Schemas
// ============================================

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
  name: z.string().optional(),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

type InviteMemberBody = z.infer<typeof inviteMemberSchema>;
type UpdateMemberRoleBody = z.infer<typeof updateMemberRoleSchema>;

// ============================================
// Response Types
// ============================================

interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  isActive: boolean;
  avatarUrl: string | null;
  githubUsername: string | null;
  slackUserId: string | null;
  createdAt: string;
  lastActiveAt: string | null;
}

// PendingInvite type - reserved for invite system implementation
// interface PendingInvite {
//   id: string;
//   email: string;
//   role: string;
//   invitedBy: string;
//   invitedAt: string;
//   expiresAt: string;
// }

// ============================================
// Helper Functions
// ============================================

/**
 * Check if user has admin or owner role
 */
async function isAdminOrOwner(userId: string, orgId: string): Promise<boolean> {
  const result = await query<{ role: string }>(
    `SELECT role FROM users WHERE id = $1 AND org_id = $2`,
    [userId, orgId]
  );
  return result.rows[0]?.role === "owner" || result.rows[0]?.role === "admin";
}

/**
 * Check if user is the owner
 */
async function isOwner(userId: string, orgId: string): Promise<boolean> {
  const result = await query<{ role: string }>(
    `SELECT role FROM users WHERE id = $1 AND org_id = $2`,
    [userId, orgId]
  );
  return result.rows[0]?.role === "owner";
}

// ============================================
// Route Handlers
// ============================================

/**
 * GET /api/team/members
 *
 * Returns all team members for the organization
 */
async function getTeamMembersHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const orgId = request.getOrgId();

  if (!orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  try {
    const result = await query<{
      id: string;
      email: string;
      name: string | null;
      role: string;
      is_active: boolean;
      avatar_url: string | null;
      github_username: string | null;
      slack_user_id: string | null;
      created_at: string;
      last_active_at: string | null;
    }>(
      `SELECT
        id, email, name, role, is_active, avatar_url,
        github_username, slack_user_id, created_at, last_active_at
       FROM users
       WHERE org_id = $1
       ORDER BY
         CASE role
           WHEN 'owner' THEN 1
           WHEN 'admin' THEN 2
           ELSE 3
         END,
         created_at ASC`,
      [orgId]
    );

    const members: TeamMember[] = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as "owner" | "admin" | "member",
      isActive: row.is_active,
      avatarUrl: row.avatar_url,
      githubUsername: row.github_username,
      slackUserId: row.slack_user_id,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    }));

    reply.send({ members, total: members.length });
  } catch (error) {
    logger.error({ error, orgId }, "Failed to fetch team members");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch team members",
    });
  }
}

/**
 * POST /api/team/members
 *
 * Invite a new member to the organization
 */
async function inviteMemberHandler(
  request: FastifyRequest<{ Body: InviteMemberBody }>,
  reply: FastifyReply
): Promise<void> {
  const orgId = request.getOrgId();
  const userId = request.getUserId();

  if (!orgId || !userId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // Validate request body
  const parseResult = inviteMemberSchema.safeParse(request.body);
  if (!parseResult.success) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid request body",
      details: parseResult.error.issues,
    });
    return;
  }

  const { email, role, name } = parseResult.data;

  try {
    // Check if requester has permission (admin or owner)
    const hasPermission = await isAdminOrOwner(userId, orgId);
    if (!hasPermission) {
      reply.status(403).send({
        error: "Forbidden",
        message: "Only admins and owners can invite members",
      });
      return;
    }

    // Check if user already exists in this organization
    const existingUser = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 AND org_id = $2`,
      [email, orgId]
    );

    if (existingUser.rows.length > 0) {
      reply.status(409).send({
        error: "Conflict",
        message: "User already exists in this organization",
      });
      return;
    }

    // Check organization limits
    const orgResult = await query<{ plan: string }>(
      `SELECT plan FROM organizations WHERE id = $1`,
      [orgId]
    );
    const plan = orgResult.rows[0]?.plan || "free";

    const memberCount = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM users WHERE org_id = $1`,
      [orgId]
    );
    const currentCount = parseInt(memberCount.rows[0]?.count || "0", 10);

    const limits: Record<string, number> = {
      free: 3,
      pro: 10,
      enterprise: 999999,
    };

    if (currentCount >= limits[plan]) {
      reply.status(403).send({
        error: "Forbidden",
        message: `Team member limit reached for ${plan} plan. Upgrade to add more members.`,
      });
      return;
    }

    // Create the new user (in a real app, you'd send an invite email)
    const newUserId = randomUUID();
    await query(
      `INSERT INTO users (id, org_id, email, name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [newUserId, orgId, email, name || null, role]
    );

    // Get the created user
    const newUser = await query<{
      id: string;
      email: string;
      name: string | null;
      role: string;
      is_active: boolean;
      created_at: string;
    }>(
      `SELECT id, email, name, role, is_active, created_at
       FROM users WHERE id = $1`,
      [newUserId]
    );

    const member: TeamMember = {
      id: newUser.rows[0].id,
      email: newUser.rows[0].email,
      name: newUser.rows[0].name,
      role: newUser.rows[0].role as "owner" | "admin" | "member",
      isActive: newUser.rows[0].is_active,
      avatarUrl: null,
      githubUsername: null,
      slackUserId: null,
      createdAt: newUser.rows[0].created_at,
      lastActiveAt: null,
    };

    logger.info(
      { orgId, email, role, invitedBy: userId },
      "Team member invited"
    );

    // Audit log: user invitation
    await logUserInvite(userId, email, role, orgId, request.ip);

    reply.status(201).send({
      message: "Member invited successfully",
      member,
    });
  } catch (error) {
    logger.error({ error, orgId, email }, "Failed to invite member");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to invite member",
    });
  }
}

/**
 * PATCH /api/team/members/:memberId/role
 *
 * Update a team member's role
 */
async function updateMemberRoleHandler(
  request: FastifyRequest<{
    Params: { memberId: string };
    Body: UpdateMemberRoleBody;
  }>,
  reply: FastifyReply
): Promise<void> {
  const orgId = request.getOrgId();
  const userId = request.getUserId();
  const { memberId } = request.params;

  if (!orgId || !userId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // Validate request body
  const parseResult = updateMemberRoleSchema.safeParse(request.body);
  if (!parseResult.success) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid request body",
      details: parseResult.error.issues,
    });
    return;
  }

  const { role: newRole } = parseResult.data;

  try {
    // Only owners can change roles
    const userIsOwner = await isOwner(userId, orgId);
    if (!userIsOwner) {
      reply.status(403).send({
        error: "Forbidden",
        message: "Only owners can change member roles",
      });
      return;
    }

    // Check if target member exists
    const targetMember = await query<{ id: string; role: string }>(
      `SELECT id, role FROM users WHERE id = $1 AND org_id = $2`,
      [memberId, orgId]
    );

    if (targetMember.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "Team member not found",
      });
      return;
    }

    // Cannot change owner's role
    if (targetMember.rows[0].role === "owner") {
      reply.status(403).send({
        error: "Forbidden",
        message: "Cannot change owner's role",
      });
      return;
    }

    const oldRole = targetMember.rows[0].role;

    // Update the role
    await query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
      [newRole, memberId, orgId]
    );

    logger.info(
      { orgId, memberId, newRole, updatedBy: userId },
      "Team member role updated"
    );

    // Audit log: role change (CRITICAL for SOC2)
    await logRoleChange(userId, memberId, orgId, oldRole, newRole, request.ip);

    reply.send({
      message: "Member role updated successfully",
      memberId,
      role: newRole,
    });
  } catch (error) {
    logger.error({ error, orgId, memberId }, "Failed to update member role");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to update member role",
    });
  }
}

/**
 * DELETE /api/team/members/:memberId
 *
 * Remove a team member from the organization
 */
async function removeMemberHandler(
  request: FastifyRequest<{ Params: { memberId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const orgId = request.getOrgId();
  const userId = request.getUserId();
  const { memberId } = request.params;

  if (!orgId || !userId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  try {
    // Check if requester has permission (admin or owner)
    const hasPermission = await isAdminOrOwner(userId, orgId);
    if (!hasPermission) {
      reply.status(403).send({
        error: "Forbidden",
        message: "Only admins and owners can remove members",
      });
      return;
    }

    // Check if target member exists
    const targetMember = await query<{
      id: string;
      role: string;
      email: string;
    }>(`SELECT id, role, email FROM users WHERE id = $1 AND org_id = $2`, [
      memberId,
      orgId,
    ]);

    if (targetMember.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "Team member not found",
      });
      return;
    }

    // Cannot remove the owner
    if (targetMember.rows[0].role === "owner") {
      reply.status(403).send({
        error: "Forbidden",
        message: "Cannot remove organization owner",
      });
      return;
    }

    // Cannot remove yourself (use leave org instead)
    if (memberId === userId) {
      reply.status(403).send({
        error: "Forbidden",
        message: "Cannot remove yourself. Use 'Leave Organization' instead.",
      });
      return;
    }

    // Admins cannot remove other admins (only owner can)
    const requesterIsOwner = await isOwner(userId, orgId);
    if (targetMember.rows[0].role === "admin" && !requesterIsOwner) {
      reply.status(403).send({
        error: "Forbidden",
        message: "Only owner can remove admins",
      });
      return;
    }

    // Soft delete: set is_active to false
    await query(
      `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 AND org_id = $2`,
      [memberId, orgId]
    );

    logger.info(
      { orgId, memberId, removedBy: userId, email: targetMember.rows[0].email },
      "Team member removed"
    );

    // Audit log: user removal (HIGH priority for SOC2)
    await logUserRemove(
      userId,
      memberId,
      targetMember.rows[0].email,
      orgId,
      request.ip
    );

    reply.send({
      message: "Member removed successfully",
      memberId,
    });
  } catch (error) {
    logger.error({ error, orgId, memberId }, "Failed to remove member");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to remove member",
    });
  }
}

/**
 * GET /api/team/invites
 *
 * Get pending invites for the organization (placeholder for invite system)
 */
async function getPendingInvitesHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const orgId = request.getOrgId();

  if (!orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // In a full implementation, this would query an invites table
  // For now, return empty array
  reply.send({ invites: [], total: 0 });
}

/**
 * POST /api/team/invites/:inviteId/resend
 *
 * Resend an invite email
 */
async function resendInviteHandler(
  request: FastifyRequest<{ Params: { inviteId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const orgId = request.getOrgId();

  if (!orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // Placeholder - would implement email sending
  reply.send({ message: "Invite resent successfully" });
}

/**
 * DELETE /api/team/invites/:inviteId
 *
 * Cancel a pending invite
 */
async function cancelInviteHandler(
  request: FastifyRequest<{ Params: { inviteId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const orgId = request.getOrgId();

  if (!orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // Placeholder - would delete from invites table
  reply.send({ message: "Invite cancelled successfully" });
}

// ============================================
// Route Registration
// ============================================

export async function teamRoutes(server: FastifyInstance): Promise<void> {
  // Team members
  server.get("/team/members", getTeamMembersHandler);
  server.post("/team/members", inviteMemberHandler);
  server.patch(
    "/team/members/:memberId/role",
    updateMemberRoleHandler as unknown as Parameters<typeof server.patch>[1]
  );
  server.delete(
    "/team/members/:memberId",
    removeMemberHandler as unknown as Parameters<typeof server.delete>[1]
  );

  // Invites (placeholder routes)
  server.get("/team/invites", getPendingInvitesHandler);
  server.post(
    "/team/invites/:inviteId/resend",
    resendInviteHandler as unknown as Parameters<typeof server.post>[1]
  );
  server.delete(
    "/team/invites/:inviteId",
    cancelInviteHandler as unknown as Parameters<typeof server.delete>[1]
  );

  logger.info("Team routes registered");
}

export default teamRoutes;
