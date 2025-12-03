/**
 * GitHub App Webhook Handler
 *
 * Handles GitHub App events:
 * - installation.created: Auto-register org + repos
 * - installation.deleted: Deactivate repos
 * - installation_repositories.added: Register new repos
 * - installation_repositories.removed: Deactivate repos
 *
 * This enables zero-config onboarding for clients!
 */

import { FastifyPluginAsync } from "fastify";
import type { FastifyRequest } from "fastify";
import crypto from "crypto";
import { config } from "../../utils/config.js";
import { pool } from "../../db/client.js";
import { logger } from "../../utils/logger.js";
import { z } from "zod";

// ============================================
// Webhook Payload Schemas
// ============================================

const installationAccountSchema = z.object({
  login: z.string(),
  id: z.number(),
  type: z.enum(["User", "Organization"]),
});

const installationRepoSchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
  default_branch: z.string().optional(),
});

const installationSchema = z.object({
  id: z.number(),
  account: installationAccountSchema,
  repository_selection: z.enum(["all", "selected"]).optional(),
  target_type: z.enum(["User", "Organization"]).optional(),
});

const installationCreatedSchema = z.object({
  action: z.literal("created"),
  installation: installationSchema,
  repositories: z.array(installationRepoSchema).optional(),
  sender: z.object({ login: z.string() }).optional(),
});

const installationDeletedSchema = z.object({
  action: z.literal("deleted"),
  installation: installationSchema,
});

const installationReposAddedSchema = z.object({
  action: z.literal("added"),
  installation: installationSchema,
  repositories_added: z.array(installationRepoSchema),
});

const installationReposRemovedSchema = z.object({
  action: z.literal("removed"),
  installation: installationSchema,
  repositories_removed: z.array(installationRepoSchema),
});

// ============================================
// HMAC Signature Verification
// ============================================

function verifyGitHubSignature(
  payload: Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  const expected = `sha256=${hmac.digest("hex")}`;

  // Timing-safe comparison
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function resolveGitHubPayloadBuffer(request: FastifyRequest): Buffer {
  const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
  if (rawBody && Buffer.isBuffer(rawBody)) {
    return rawBody;
  }

  const body = request.body ?? {};
  const textPayload = typeof body === "string" ? body : JSON.stringify(body);
  return Buffer.from(textPayload ?? "", "utf8");
}

// ============================================
// Webhook Routes
// ============================================

export const githubWebhooksRoutes: FastifyPluginAsync = async (server) => {
  /**
   * GitHub App Webhook Endpoint
   *
   * Receives all GitHub App events (installation, push, etc.)
   * This is the main entry point for automatic repo registration.
   */
  server.post("/webhooks/github", async (request, reply) => {
    const event = request.headers["x-github-event"] as string;
    const delivery = request.headers["x-github-delivery"] as string;
    const signature = request.headers["x-hub-signature-256"] as string;

    logger.info({ event, delivery }, "Received GitHub webhook");

    // Verify signature if secret is configured
    if (config.GITHUB_WEBHOOK_SECRET) {
      const payloadBuffer = resolveGitHubPayloadBuffer(request);
      const isValid = verifyGitHubSignature(
        payloadBuffer,
        signature,
        config.GITHUB_WEBHOOK_SECRET
      );

      if (!isValid) {
        logger.warn({ delivery }, "Invalid GitHub webhook signature");
        return reply.status(401).send({ error: "Invalid signature" });
      }
    }

    // Route by event type
    try {
      switch (event) {
        case "installation":
          await handleInstallationEvent(request.body);
          break;

        case "installation_repositories":
          await handleInstallationRepositoriesEvent(request.body);
          break;

        case "push":
          // Future: Invalidate cache for changed files
          logger.debug({ delivery }, "Push event received (not handled yet)");
          break;

        default:
          logger.debug({ event, delivery }, "Unhandled GitHub event");
      }

      return reply.status(200).send({ status: "processed", event });
    } catch (error) {
      logger.error(
        { error, event, delivery },
        "Failed to process GitHub webhook"
      );
      return reply.status(500).send({ error: "Processing failed" });
    }
  });
};

// ============================================
// Event Handlers
// ============================================

/**
 * Handle installation.created / installation.deleted
 *
 * On `created`: Create org (if needed) + register all repos
 * On `deleted`: Deactivate all repos for this installation
 */
async function handleInstallationEvent(payload: unknown): Promise<void> {
  // Try created first
  const createdResult = installationCreatedSchema.safeParse(payload);
  if (createdResult.success) {
    const { installation, repositories } = createdResult.data;
    logger.info(
      {
        installationId: installation.id,
        account: installation.account.login,
        repoCount: repositories?.length || 0,
      },
      "GitHub App installed"
    );

    // 1. Create or get organization
    const orgId = await findOrCreateOrganization(installation);

    // 2. Register all repos
    if (repositories && repositories.length > 0) {
      await registerRepositories(orgId, installation.id, repositories);
    }

    return;
  }

  // Try deleted
  const deletedResult = installationDeletedSchema.safeParse(payload);
  if (deletedResult.success) {
    const { installation } = deletedResult.data;
    logger.info(
      {
        installationId: installation.id,
        account: installation.account.login,
      },
      "GitHub App uninstalled"
    );

    // Deactivate all repos for this installation
    await pool.query(
      `UPDATE repos SET is_active = false, updated_at = NOW()
       WHERE installation_id = $1`,
      [installation.id.toString()]
    );

    return;
  }

  logger.warn({ payload }, "Unknown installation event action");
}

/**
 * Handle installation_repositories.added / .removed
 *
 * When user adds/removes repos from installation settings
 */
async function handleInstallationRepositoriesEvent(
  payload: unknown
): Promise<void> {
  // Try added
  const addedResult = installationReposAddedSchema.safeParse(payload);
  if (addedResult.success) {
    const { installation, repositories_added } = addedResult.data;
    logger.info(
      {
        installationId: installation.id,
        reposAdded: repositories_added.length,
      },
      "Repositories added to installation"
    );

    // Find org by installation_id
    const orgResult = await pool.query<{ org_id: string }>(
      `SELECT DISTINCT org_id FROM repos WHERE installation_id = $1 LIMIT 1`,
      [installation.id.toString()]
    );

    if (orgResult.rows.length === 0) {
      // New installation, create org
      const orgId = await findOrCreateOrganization(installation);
      await registerRepositories(orgId, installation.id, repositories_added);
    } else {
      await registerRepositories(
        orgResult.rows[0].org_id,
        installation.id,
        repositories_added
      );
    }

    return;
  }

  // Try removed
  const removedResult = installationReposRemovedSchema.safeParse(payload);
  if (removedResult.success) {
    const { installation, repositories_removed } = removedResult.data;
    logger.info(
      {
        installationId: installation.id,
        reposRemoved: repositories_removed.length,
      },
      "Repositories removed from installation"
    );

    // Deactivate specific repos
    const fullNames = repositories_removed.map((r) => r.full_name);
    await pool.query(
      `UPDATE repos SET is_active = false, updated_at = NOW()
       WHERE installation_id = $1 AND full_name = ANY($2)`,
      [installation.id.toString(), fullNames]
    );

    return;
  }

  logger.warn({ payload }, "Unknown installation_repositories event action");
}

// ============================================
// Helper Functions
// ============================================

/**
 * Find or create an organization based on GitHub installation
 */
async function findOrCreateOrganization(
  installation: z.infer<typeof installationSchema>
): Promise<string> {
  const { account } = installation;
  const slug = account.login.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  // Check if org exists by slug
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM organizations WHERE slug = $1`,
    [slug]
  );

  if (existing.rows.length > 0) {
    logger.debug({ slug }, "Organization already exists");
    return existing.rows[0].id;
  }

  // Create new organization
  const result = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, plan, created_at, updated_at)
     VALUES ($1, $2, 'free', NOW(), NOW())
     RETURNING id`,
    [account.login, slug]
  );

  logger.info({ slug, id: result.rows[0].id }, "Created new organization");
  return result.rows[0].id;
}

/**
 * Register multiple repositories for an organization
 */
async function registerRepositories(
  orgId: string,
  installationId: number,
  repositories: z.infer<typeof installationRepoSchema>[]
): Promise<void> {
  if (repositories.length === 0) {
    return;
  }

  const startTime = Date.now();
  const installationIdText = installationId.toString();

  const normalizedRepos = repositories.map((repo) => {
    const [owner, name] = repo.full_name.split("/", 2);
    return {
      owner: owner ?? repo.full_name,
      name: name ?? repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch ?? "main",
    };
  });

  const values = normalizedRepos.flatMap((repo) => [
    orgId,
    repo.owner,
    repo.name,
    repo.fullName,
    repo.defaultBranch,
    installationIdText,
  ]);

  const valuePlaceholders = normalizedRepos
    .map((_, index) => {
      const offset = index * 6;
      return `($${offset + 1}, 'github', $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, 'auto-registered', true)`;
    })
    .join(", ");

  await pool.query(
    `INSERT INTO repos (
        org_id, provider, owner, name, full_name,
        default_branch, installation_id, secret_id, is_active
      ) VALUES ${valuePlaceholders}
      ON CONFLICT (org_id, provider, full_name) DO UPDATE SET
        installation_id = EXCLUDED.installation_id,
        default_branch = EXCLUDED.default_branch,
        is_active = true,
        updated_at = NOW()`,
    values
  );

  const durationMs = Date.now() - startTime;
  logger.info(
    {
      orgId,
      installationId,
      repoCount: normalizedRepos.length,
      repos: normalizedRepos.map((repo) => repo.fullName),
      durationMs,
    },
    "Repositories registered"
  );
}
