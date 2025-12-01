import { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import { pool } from "../../db/client.js";

/**
 * Organization context stored in request
 */
interface OrgContext {
  orgId: string;
  orgPlan: string;
}

/**
 * Extend FastifyRequest to include org context
 */
declare module "fastify" {
  interface FastifyRequest {
    orgContext?: OrgContext;
    getOrgId(): string;
    getOrgPlan(): string;
  }
}

/**
 * Middleware to extract and validate organization context
 * Sets org_id for row-level security
 */
export async function orgContextMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    // Extract org_id from JWT token (when auth is implemented)
    // For now, get from header (development only)
    const orgId =
      (request.headers["x-org-id"] as string) ||
      "00000000-0000-0000-0000-000000000000";

    // Verify organization exists
    const result = await pool.query(
      "SELECT id, plan FROM organizations WHERE id = $1",
      [orgId]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({
        error: "Organization not found",
      });
    }

    // Store in request object
    request.orgContext = {
      orgId,
      orgPlan: result.rows[0].plan as string,
    };
  } catch (error) {
    request.log.error({ error }, "Failed to set org context");
    return reply.status(500).send({
      error: "Internal Server Error",
    });
  }
}

/**
 * Setup request decorators for org context access
 */
export function setupOrgDecorators(server: FastifyInstance) {
  // Add placeholder for orgContext
  server.decorateRequest("orgContext", null);

  server.decorateRequest("getOrgId", function (this: FastifyRequest) {
    return this.orgContext?.orgId || "";
  });

  server.decorateRequest("getOrgPlan", function (this: FastifyRequest) {
    return this.orgContext?.orgPlan || "free";
  });
}
