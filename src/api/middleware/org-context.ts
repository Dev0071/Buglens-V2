import { FastifyRequest, FastifyReply } from "fastify";
import { pool } from "../db/client.js";

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

    // Store in request context
    request.requestContext.set("org_id", orgId);
    request.requestContext.set("org_plan", result.rows[0].plan);
  } catch (error) {
    request.log.error({ error }, "Failed to set org context");
    return reply.status(500).send({
      error: "Internal Server Error",
    });
  }
}

/**
 * Decorator to get org_id from request context
 */
declare module "fastify" {
  interface FastifyRequest {
    getOrgId(): string;
    getOrgPlan(): string;
  }
}

export function setupOrgDecorators(server: FastifyInstance) {
  server.decorateRequest("getOrgId", function () {
    return this.requestContext.get("org_id") as string;
  });

  server.decorateRequest("getOrgPlan", function () {
    return this.requestContext.get("org_plan") as string;
  });
}
