import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { query, transaction } from "../../db/client.js";

// ============================================
// Request/Response Schemas
// ============================================

const feedbackBodySchema = z.object({
  actual_root_cause: z.string().min(10).max(2000),
  feedback_notes: z.string().max(2000).optional(),
});

type FeedbackBody = z.infer<typeof feedbackBodySchema>;

// JSON Schema for Fastify (not Zod)
const rcaResponseJSONSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    job_id: { type: "string" },
    root_cause: { type: "string" },
    suggested_fix: { type: "string" },
    confidence: { type: "number" },
    causal_chain: { type: "array", items: { type: "string" } },
    evidence_refs: { type: "array", items: { type: "string" } },
    llm_model: { type: "string" },
    evidence_graph: { type: ["object", "null"] },
    actual_root_cause: { type: ["string", "null"] },
    feedback_timestamp: { type: ["string", "null"] },
    error_category: { type: ["string", "null"] },
    created_at: { type: "string" },
  },
};

const feedbackResponseJSONSchema = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    message: { type: "string" },
    correction_id: { type: "string" },
  },
};

// ============================================
// Route Handlers
// ============================================

interface RCAParams {
  id: string;
}

interface RCARow {
  id: string;
  org_id: string;
  job_id: string;
  root_cause: string;
  suggested_fix: string;
  confidence: number;
  causal_chain: string[];
  evidence_refs: string[];
  llm_model: string;
  evidence_graph: unknown;
  actual_root_cause: string | null;
  feedback_timestamp: Date | null;
  error_category: string | null;
  created_at: Date;
}

/**
 * GET /v1/rca/:id
 *
 * Retrieve RCA result by ID
 */
async function getRCAHandler(
  request: FastifyRequest<{ Params: RCAParams }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const orgId = request.headers["x-org-id"] as string;

  if (!orgId) {
    reply.status(400).send({ error: "Missing x-org-id header" });
    return;
  }

  try {
    const result = await query<RCARow>(
      `SELECT
         id, org_id, job_id, root_cause, suggested_fix, confidence,
         causal_chain, evidence_refs, llm_model, evidence_graph,
         actual_root_cause, feedback_timestamp, error_category, created_at
       FROM rca_results
       WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      reply.status(404).send({ error: "RCA result not found" });
      return;
    }

    const row = result.rows[0];
    const response = {
      ...row,
      created_at: row.created_at.toISOString(),
      feedback_timestamp: row.feedback_timestamp?.toISOString() ?? null,
    };

    reply.send(response);
  } catch (error) {
    logger.error({ error, rcaId: id, orgId }, "Failed to retrieve RCA result");
    reply.status(500).send({ error: "Internal server error" });
  }
}

/**
 * POST /v1/rca/:id/feedback
 *
 * Submit feedback/correction for an RCA result
 * This allows users to provide the actual root cause when the AI was wrong
 */
async function submitFeedbackHandler(
  request: FastifyRequest<{ Params: RCAParams; Body: FeedbackBody }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const orgId = request.headers["x-org-id"] as string;

  if (!orgId) {
    reply.status(400).send({ error: "Missing x-org-id header" });
    return;
  }

  // Validate body
  const parseResult = feedbackBodySchema.safeParse(request.body);
  if (!parseResult.success) {
    reply.status(400).send({
      error: "Validation failed",
      details: parseResult.error.errors,
    });
    return;
  }

  const { actual_root_cause, feedback_notes } = parseResult.data;

  try {
    // Verify RCA exists and belongs to org
    const rcaResult = await query<{ id: string; root_cause: string }>(
      `SELECT id, root_cause FROM rca_results WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );

    if (rcaResult.rows.length === 0) {
      reply.status(404).send({ error: "RCA result not found" });
      return;
    }

    const originalRCA = rcaResult.rows[0];
    const correctionId = crypto.randomUUID();

    await transaction(orgId, async (client) => {
      // Update the RCA result with feedback
      await client.query(
        `UPDATE rca_results
         SET actual_root_cause = $1,
             feedback_timestamp = NOW()
         WHERE id = $2 AND org_id = $3`,
        [actual_root_cause, id, orgId]
      );

      // Store correction for learning/analytics
      await client.query(
        `INSERT INTO rca_corrections (
          id, org_id, rca_result_id, original_root_cause,
          corrected_root_cause, feedback_notes, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          correctionId,
          orgId,
          id,
          originalRCA.root_cause,
          actual_root_cause,
          feedback_notes ?? null,
        ]
      );
    });

    logger.info(
      { rcaId: id, correctionId, orgId },
      "RCA feedback submitted successfully"
    );

    reply.send({
      success: true,
      message: "Feedback recorded successfully",
      correction_id: correctionId,
    });
  } catch (error) {
    logger.error({ error, rcaId: id, orgId }, "Failed to submit RCA feedback");
    reply.status(500).send({ error: "Internal server error" });
  }
}

/**
 * GET /v1/rca/:id/evidence-graph
 *
 * Retrieve just the evidence graph for visualization
 */
async function getEvidenceGraphHandler(
  request: FastifyRequest<{ Params: RCAParams }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const orgId = request.headers["x-org-id"] as string;

  if (!orgId) {
    reply.status(400).send({ error: "Missing x-org-id header" });
    return;
  }

  try {
    const result = await query<{ evidence_graph: unknown }>(
      `SELECT evidence_graph
       FROM rca_results
       WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      reply.status(404).send({ error: "RCA result not found" });
      return;
    }

    const { evidence_graph } = result.rows[0];

    if (!evidence_graph) {
      reply
        .status(404)
        .send({ error: "Evidence graph not available for this RCA" });
      return;
    }

    reply.send(evidence_graph);
  } catch (error) {
    logger.error(
      { error, rcaId: id, orgId },
      "Failed to retrieve evidence graph"
    );
    reply.status(500).send({ error: "Internal server error" });
  }
}

// ============================================
// Route Registration
// ============================================

export async function rcaRoutes(fastify: FastifyInstance): Promise<void> {
  // Get RCA result by ID
  fastify.get<{ Params: RCAParams }>(
    "/v1/rca/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
          },
          required: ["id"],
        },
        response: {
          200: rcaResponseJSONSchema,
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    getRCAHandler
  );

  // Submit feedback for RCA
  fastify.post<{ Params: RCAParams; Body: FeedbackBody }>(
    "/v1/rca/:id/feedback",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
          },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            actual_root_cause: {
              type: "string",
              minLength: 10,
              maxLength: 2000,
            },
            feedback_notes: { type: "string", maxLength: 2000 },
          },
          required: ["actual_root_cause"],
        },
        response: {
          200: feedbackResponseJSONSchema,
          400: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    submitFeedbackHandler
  );

  // Get evidence graph only
  fastify.get<{ Params: RCAParams }>(
    "/v1/rca/:id/evidence-graph",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
          },
          required: ["id"],
        },
        response: {
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    getEvidenceGraphHandler
  );

  logger.info("RCA routes registered");
}
