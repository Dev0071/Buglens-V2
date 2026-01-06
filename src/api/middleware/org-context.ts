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
    getUserId(): string | undefined;
    rawBody?: Buffer;
  }

  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}

/**
 * Middleware to extract and validate organization context
 * Sets org_id for row-level security
 *
 * Priority order:
 * 1. JWT token from Authorization header (for authenticated API requests)
 * 2. JWT token from httpOnly cookie (SOC2 compliant auth)
 * 3. x-org-id header (for webhooks)
 * 4. org_id path parameter
 */
export async function orgContextMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  let candidateOrgId: string | undefined;

  // 1. Try to extract from JWT in Authorization header (authenticated requests)
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      await request.jwtVerify();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = request.user as any; // Use any to avoid type conflicts with Fastify
      if (user && typeof user === "object" && user.orgId) {
        candidateOrgId = user.orgId;
      }
    } catch (error) {
      // JWT verification failed - continue to check cookies/headers/params
    }
  }

  // 2. Try to extract from httpOnly cookie (SOC2 compliant)
  if (!candidateOrgId && request.cookies?.accessToken) {
    try {
      // Manually verify the cookie token
      const cookieToken = request.cookies.accessToken;
      const decoded = request.server.jwt.verify<{
        userId: string;
        orgId: string;
      }>(cookieToken);
      if (decoded && decoded.orgId) {
        candidateOrgId = decoded.orgId;
        // Set user on request for downstream middleware
        request.user = decoded;
      }
    } catch {
      // Cookie token invalid - continue to check headers/params
    }
  }

  // 3. Try x-org-id header (webhooks)
  if (!candidateOrgId) {
    const headerOrgId = request.headers["x-org-id"];
    if (typeof headerOrgId === "string" && headerOrgId.trim().length > 0) {
      candidateOrgId = headerOrgId;
    }
  }

  // 4. Try path parameter
  if (!candidateOrgId) {
    const params = request.params as Record<string, unknown> | undefined;
    if (params && typeof params.org_id === "string") {
      candidateOrgId = params.org_id;
    }
  }

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
    console.log(`Setting org context for orgId: ${orgId}`);

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

  server.decorateRequest("getUserId", function (this: FastifyRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = this.user as any;
    return user?.userId;
  });

  // Add authenticate decorator - requires valid JWT
  server.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch (error) {
        reply.status(401).send({
          error: "UNAUTHORIZED",
          message: "Authentication required",
        });
      }
    }
  );
}
