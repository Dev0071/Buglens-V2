import { FastifyRequest, FastifyReply } from "fastify";
import { RATE_LIMITS, OrgPlan } from "../../utils/rate-limits.js";
import { pool } from "../../db/client.js";

interface RateLimitOptions {
  resource: "events" | "rca_jobs" | "llm_tokens" | "github_api_calls";
  period: "hour" | "day";
}

export function createRateLimitMiddleware(options: RateLimitOptions) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = request.getOrgId();
    const orgPlan = request.getOrgPlan() as OrgPlan;

    if (!orgId) {
      request.log.warn(
        { resource: options.resource },
        "Rate limit skipped: missing org context"
      );
      return;
    }

    const limits = RATE_LIMITS[orgPlan];
    if (!limits) {
      request.log.warn({ orgPlan }, "Unknown org plan for rate limiting");
      return;
    }
    const limitKey =
      `${options.resource}_per_${options.period}` as keyof (typeof RATE_LIMITS)[OrgPlan];
    const maxAllowed = limits[limitKey] as number;

    // Get current usage from database
    const periodStart =
      options.period === "hour"
        ? new Date(Date.now() - 60 * 60 * 1000)
        : new Date(new Date().setHours(0, 0, 0, 0));

    let currentUsage = 0;

    if (options.resource === "events") {
      const result = await pool.query(
        "SELECT COUNT(*) FROM events WHERE org_id = $1 AND created_at >= $2",
        [orgId, periodStart]
      );
      currentUsage = parseInt(result.rows[0].count);
    } else if (options.resource === "rca_jobs") {
      const result = await pool.query(
        "SELECT COUNT(*) FROM rca_jobs WHERE org_id = $1 AND created_at >= $2",
        [orgId, periodStart]
      );
      currentUsage = parseInt(result.rows[0].count);
    } else if (options.resource === "llm_tokens") {
      const result = await pool.query(
        "SELECT llm_tokens_used FROM cost_metrics WHERE org_id = $1 AND date = CURRENT_DATE",
        [orgId]
      );
      currentUsage = result.rows[0]?.llm_tokens_used || 0;
    }

    // Add usage headers
    reply.header("X-RateLimit-Limit", maxAllowed);
    reply.header("X-RateLimit-Remaining", maxAllowed - currentUsage);

    if (currentUsage >= maxAllowed) {
      request.log.warn(
        {
          orgId,
          orgPlan,
          resource: options.resource,
          currentUsage,
          maxAllowed,
        },
        "Rate limit exceeded"
      );

      return reply.status(429).send({
        error: "Rate Limit Exceeded",
        message: `You have exceeded your ${options.resource} quota for this ${options.period}`,
        quota: {
          limit: maxAllowed,
          used: currentUsage,
          remaining: 0,
          reset_at:
            options.period === "hour"
              ? new Date(Date.now() + 60 * 60 * 1000)
              : new Date(new Date().setHours(24, 0, 0, 0)),
        },
      });
    }
  };
}
