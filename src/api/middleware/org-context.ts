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
    rawBody?: Buffer;
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
  const headerOrgId = request.headers["x-org-id"];
  const params = request.params as Record<string, unknown> | undefined;
  const pathOrgId =
    params && typeof params.org_id === "string" ? params.org_id : undefined;
  const candidateOrgId =
    (typeof headerOrgId === "string" && headerOrgId.trim().length > 0
      ? headerOrgId
      : undefined) || pathOrgId;

  // Health checks and unauthenticated routes may not provide org context
  if (!candidateOrgId) {
    return;
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(candidateOrgId)) {
    return reply.status(400).send({
      error: "Bad Request",
      message: "Invalid organization ID",
    });
  }

  try {
    const orgId = candidateOrgId;

    // Verify organization exists
    const result = await pool.query(
      "SELECT id, plan FROM organizations WHERE id = $1",
      [orgId]
    );

    if (result.rows.length === 0) {
      request.log.warn({ orgId }, "Organization context not found");
      return reply.status(404).send({
        error: "Not Found",
        message: "Organization does not exist",
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
