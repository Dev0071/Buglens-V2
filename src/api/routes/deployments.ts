import type { FastifyInstance } from "fastify";
import { logger } from "../../utils/logger.js";
import { trackDeploySchema } from "../../types/deployment.js";
import {
  recordDeployment,
  listDeployments,
  resolveDeploymentAtTime,
} from "../../services/deployment-tracker.js";

export async function deploymentRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/track-deploy
   *
   * Called from CI/CD pipelines after a successful deploy. No browser
   * exposure — authenticated via the org's deploy token (JWT).
   *
   * Example (GitHub Actions):
   *   curl -X POST https://api.buglens.com/api/v1/track-deploy \
   *     -H "Authorization: Bearer $BUGLENS_DEPLOY_TOKEN" \
   *     -H "Content-Type: application/json" \
   *     -d '{"repo":"owner/repo","sha":"${{ github.sha }}","environment":"production"}'
   */
  server.post(
    "/v1/track-deploy",
    { schema: { tags: ["deployments"] } },
    async (request, reply) => {
      const orgId = request.getOrgId();
      if (!orgId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const parsed = trackDeploySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid payload",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      try {
        const deployment = await recordDeployment(orgId, parsed.data, "api");

        logger.info(
          { orgId, repo: deployment.repo_full_name, sha: deployment.commit_sha, environment: deployment.environment },
          "Deployment tracked via API"
        );

        return reply.status(201).send({
          id:          deployment.id,
          repo:        deployment.repo_full_name,
          sha:         deployment.commit_sha,
          environment: deployment.environment,
          deployed_at: deployment.deployed_at,
        });
      } catch (error) {
        logger.error({ error, orgId }, "Failed to record deployment");
        return reply.status(500).send({ error: "Failed to record deployment" });
      }
    }
  );

  /**
   * GET /api/v1/deployments?repo=owner%2Frepo&limit=20
   *
   * Returns recent deployments for a repo — used by the SDK Setup page
   * and the dashboard to show deploy history.
   */
  server.get(
    "/v1/deployments",
    { schema: { tags: ["deployments"] } },
    async (request, reply) => {
      const orgId = request.getOrgId();
      if (!orgId) return reply.status(401).send({ error: "Unauthorized" });

      const { repo, limit } = request.query as { repo?: string; limit?: string };
      if (!repo) return reply.status(400).send({ error: "repo query param is required" });

      try {
        const deployments = await listDeployments(orgId, repo, limit ? parseInt(limit, 10) : 20);
        return reply.send(deployments);
      } catch (error) {
        logger.error({ error, orgId, repo }, "Failed to list deployments");
        return reply.status(500).send({ error: "Failed to list deployments" });
      }
    }
  );

  /**
   * GET /api/v1/deployments/resolve?repo=owner%2Frepo&environment=production&at=<ISO8601>
   *
   * Debug endpoint — resolves the commit SHA for a given repo+env+timestamp.
   * Useful for testing the pipeline without triggering a real Sentry event.
   */
  server.get(
    "/v1/deployments/resolve",
    { schema: { tags: ["deployments"] } },
    async (request, reply) => {
      const orgId = request.getOrgId();
      if (!orgId) return reply.status(401).send({ error: "Unauthorized" });

      const { repo, environment, at } = request.query as {
        repo?: string;
        environment?: string;
        at?: string;
      };

      if (!repo || !environment || !at) {
        return reply.status(400).send({ error: "repo, environment, and at params are required" });
      }

      const errorTimestamp = new Date(at);
      if (isNaN(errorTimestamp.getTime())) {
        return reply.status(400).send({ error: "at must be a valid ISO 8601 timestamp" });
      }

      try {
        const match = await resolveDeploymentAtTime(orgId, repo, environment, errorTimestamp);
        if (!match) {
          return reply.status(404).send({ error: "No deployment found for the given params" });
        }
        return reply.send(match);
      } catch (error) {
        logger.error({ error, orgId }, "Failed to resolve deployment");
        return reply.status(500).send({ error: "Failed to resolve deployment" });
      }
    }
  );
}
