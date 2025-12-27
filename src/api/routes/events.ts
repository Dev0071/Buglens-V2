import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { query, transaction } from "../../db/client.js";
import { enqueueDeterministicJob } from "../../workers/queues/deterministic.js";

// ============================================
// Request/Response Schemas
// ============================================

const eventsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .pipe(z.number().min(1)),
  pageSize: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().min(1).max(100)),
  severity: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",") : undefined))
    .pipe(z.array(z.enum(["low", "medium", "high", "critical"])).optional()),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",") : undefined))
    .pipe(
      z
        .array(z.enum(["pending", "processing", "completed", "failed"]))
        .optional()
    ),
  search: z.string().max(200).optional(),
  environment: z.string().max(50).optional(),
});

type EventsQuery = z.infer<typeof eventsQuerySchema>;

// ============================================
// Response Types
// ============================================

interface EventListItem {
  id: string;
  sentry_event_id: string | null;
  message: string;
  platform: string | null;
  severity: "low" | "medium" | "high" | "critical";
  environment: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  created_at: string;
  rca_result_id?: string;
}

interface EventsResponse {
  events: EventListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface EventDetail {
  id: string;
  sentry_event_id: string | null;
  message: string | null;
  platform: string | null;
  environment: string | null;
  release: string | null;
  severity: "low" | "medium" | "high" | "critical";
  status: "pending" | "processing" | "completed" | "failed";
  stack_trace: unknown;
  breadcrumbs: unknown;
  context: unknown;
  raw_payload: unknown;
  created_at: string;
  updated_at: string;
  rca_job?: {
    id: string;
    status: string;
    rca_result_id?: string;
    started_at?: string;
    completed_at?: string;
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Calculate severity based on error type and context
 */
function calculateSeverity(
  errorType?: string | null,
  environment?: string | null
): "low" | "medium" | "high" | "critical" {
  if (
    environment === "production" &&
    (errorType?.includes("Unhandled") || errorType?.includes("Fatal"))
  ) {
    return "critical";
  }

  if (
    environment === "production" &&
    (errorType === "TypeError" ||
      errorType === "ReferenceError" ||
      errorType === "RangeError")
  ) {
    return "high";
  }

  if (
    errorType === "SyntaxError" ||
    errorType === "NetworkError" ||
    errorType?.includes("Connection")
  ) {
    return "medium";
  }

  return "low";
}

/**
 * Map RCA job status to user-friendly status
 */
function mapJobStatus(
  jobStatus?: string | null
): "pending" | "processing" | "completed" | "failed" {
  if (!jobStatus) return "pending";

  switch (jobStatus) {
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "pending":
      return "pending";
    case "fetching_code":
    case "analyzing":
    case "deterministic_complete":
    case "reasoning":
      return "processing";
    default:
      return "pending";
  }
}

/**
 * Extract error type from raw payload
 */
function extractErrorType(rawPayload: unknown): string | undefined {
  if (!rawPayload || typeof rawPayload !== "object") return undefined;
  const payload = rawPayload as {
    exception?: { values?: Array<{ type?: string }> };
  };
  return payload.exception?.values?.[0]?.type;
}

// ============================================
// Route Handlers
// ============================================

interface EventIdParams {
  id: string;
}

/**
 * GET /api/events
 *
 * Returns paginated list of events with filtering
 */
async function listEventsHandler(
  request: FastifyRequest<{ Querystring: EventsQuery }>,
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

  // Validate query params
  const parseResult = eventsQuerySchema.safeParse(request.query);
  if (!parseResult.success) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid query parameters",
      details: parseResult.error.errors,
    });
    return;
  }

  const { page, pageSize, severity, status, search, environment } =
    parseResult.data;
  const offset = (page - 1) * pageSize;

  try {
    // Build dynamic query with filters
    const conditions: string[] = ["e.org_id = $1"];
    const params: unknown[] = [orgId];
    let paramIndex = 2;

    // Environment filter
    if (environment) {
      conditions.push(`e.environment = $${paramIndex}`);
      params.push(environment);
      paramIndex++;
    }

    // Search filter (message contains)
    if (search) {
      conditions.push(`e.message ILIKE $${paramIndex}`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Status filter (requires join with rca_jobs)
    let statusCondition = "";
    if (status && status.length > 0) {
      // Map frontend status to database status values
      const dbStatuses: Record<string, string[]> = {
        pending: ["pending"],
        processing: [
          "fetching_code",
          "analyzing",
          "deterministic_complete",
          "reasoning",
        ],
        completed: ["done"],
        failed: ["failed"],
      };
      // Flatten all status values for the filter
      const allStatusValues = status.flatMap((s) => dbStatuses[s] || []);
      if (allStatusValues.length > 0) {
        statusCondition = `AND j.status = ANY($${paramIndex})`;
        params.push(allStatusValues);
        paramIndex++;
      }
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT e.id) as count
      FROM events e
      LEFT JOIN rca_jobs j ON e.id = j.event_id AND j.org_id = e.org_id
      WHERE ${conditions.join(" AND ")} ${statusCondition}
    `;
    const countResult = await query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0]?.count || "0", 10);

    // Get paginated events
    const eventsQuery = `
      SELECT
        e.id,
        e.sentry_event_id,
        e.message,
        e.platform,
        e.environment,
        e.raw_payload,
        e.created_at,
        j.status as job_status,
        r.id as rca_result_id
      FROM events e
      LEFT JOIN rca_jobs j ON e.id = j.event_id AND j.org_id = e.org_id
      LEFT JOIN rca_results r ON j.id = r.job_id AND r.org_id = e.org_id
      WHERE ${conditions.join(" AND ")} ${statusCondition}
      ORDER BY e.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(pageSize, offset);

    const result = await query<{
      id: string;
      sentry_event_id: string | null;
      message: string | null;
      platform: string | null;
      environment: string | null;
      raw_payload: unknown;
      created_at: Date;
      job_status: string | null;
      rca_result_id: string | null;
    }>(eventsQuery, params);

    // Process events and apply severity filter in memory
    // (severity is calculated, not stored)
    let events: EventListItem[] = result.rows.map((row) => {
      const errorType = extractErrorType(row.raw_payload);
      return {
        id: row.id,
        sentry_event_id: row.sentry_event_id,
        message: row.message || "Unknown error",
        platform: row.platform,
        severity: calculateSeverity(errorType, row.environment),
        environment: row.environment,
        status: mapJobStatus(row.job_status),
        created_at: row.created_at.toISOString(),
        rca_result_id: row.rca_result_id ?? undefined,
      };
    });

    // Filter by severity in memory (since it's calculated)
    if (severity && severity.length > 0) {
      events = events.filter((e) => severity.includes(e.severity));
    }

    const response: EventsResponse = {
      events,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };

    reply.send(response);
  } catch (error) {
    logger.error({ error, orgId }, "Failed to fetch events");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch events",
    });
  }
}

/**
 * GET /api/events/:id
 *
 * Returns detailed event information
 */
async function getEventHandler(
  request: FastifyRequest<{ Params: EventIdParams }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const orgId = request.getOrgId();

  if (!orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid event ID format",
    });
    return;
  }

  try {
    const result = await query<{
      id: string;
      sentry_event_id: string | null;
      message: string | null;
      platform: string | null;
      environment: string | null;
      release: string | null;
      stack_trace: unknown;
      breadcrumbs: unknown;
      context: unknown;
      raw_payload: unknown;
      created_at: Date;
      updated_at: Date;
      job_id: string | null;
      job_status: string | null;
      job_started_at: Date | null;
      job_completed_at: Date | null;
      rca_result_id: string | null;
    }>(
      `SELECT
         e.id,
         e.sentry_event_id,
         e.message,
         e.platform,
         e.environment,
         e.release,
         e.stack_trace,
         e.breadcrumbs,
         e.context,
         e.raw_payload,
         e.created_at,
         e.updated_at,
         j.id as job_id,
         j.status as job_status,
         j.started_at as job_started_at,
         j.completed_at as job_completed_at,
         r.id as rca_result_id
       FROM events e
       LEFT JOIN rca_jobs j ON e.id = j.event_id AND j.org_id = e.org_id
       LEFT JOIN rca_results r ON j.id = r.job_id AND r.org_id = e.org_id
       WHERE e.id = $1 AND e.org_id = $2`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "Event not found",
      });
      return;
    }

    const row = result.rows[0];
    const errorType = extractErrorType(row.raw_payload);

    const response: EventDetail = {
      id: row.id,
      sentry_event_id: row.sentry_event_id,
      message: row.message,
      platform: row.platform,
      environment: row.environment,
      release: row.release,
      severity: calculateSeverity(errorType, row.environment),
      status: mapJobStatus(row.job_status),
      stack_trace: row.stack_trace,
      breadcrumbs: row.breadcrumbs,
      context: row.context,
      raw_payload: row.raw_payload,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      rca_job: row.job_id
        ? {
            id: row.job_id,
            status: row.job_status || "pending",
            rca_result_id: row.rca_result_id ?? undefined,
            started_at: row.job_started_at?.toISOString(),
            completed_at: row.job_completed_at?.toISOString(),
          }
        : undefined,
    };

    reply.send(response);
  } catch (error) {
    logger.error({ error, eventId: id, orgId }, "Failed to fetch event detail");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch event details",
    });
  }
}

/**
 * POST /api/events/:id/reanalyze
 *
 * Triggers re-analysis of an event
 */
async function reanalyzeEventHandler(
  request: FastifyRequest<{ Params: EventIdParams }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const orgId = request.getOrgId();

  if (!orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid event ID format",
    });
    return;
  }

  try {
    // Verify event exists and belongs to org
    const eventResult = await query<{ id: string }>(
      `SELECT id FROM events WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );

    if (eventResult.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "Event not found",
      });
      return;
    }

    // Check if there's an existing active job
    const existingJob = await query<{ id: string; status: string }>(
      `SELECT id, status FROM rca_jobs
       WHERE event_id = $1 AND org_id = $2
         AND status IN ('pending', 'fetching_code', 'analyzing', 'deterministic_complete', 'reasoning')`,
      [id, orgId]
    );

    if (existingJob.rows.length > 0) {
      reply.status(409).send({
        error: "Conflict",
        message: "Analysis already in progress for this event",
        jobId: existingJob.rows[0].id,
      });
      return;
    }

    // Create new RCA job
    const jobId = crypto.randomUUID();

    await transaction(orgId, async (client) => {
      await client.query(
        `INSERT INTO rca_jobs (id, org_id, event_id, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'pending', NOW(), NOW())`,
        [jobId, orgId, id]
      );
    });

    // Enqueue the job for processing
    try {
      await enqueueDeterministicJob({
        eventId: id,
        orgId,
        jobId,
      });
    } catch (queueError) {
      // Job created but queue failed - log but don't fail the request
      logger.error(
        { error: queueError, jobId, eventId: id },
        "Failed to enqueue reanalysis job"
      );
    }

    reply.status(202).send({
      message: "Re-analysis started",
      jobId,
      status: "pending",
    });
  } catch (error) {
    logger.error(
      { error, eventId: id, orgId },
      "Failed to start event reanalysis"
    );
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to start re-analysis",
    });
  }
}

/**
 * GET /api/events/:id/rca
 *
 * Returns RCA result for an event (if exists)
 */
async function getEventRCAHandler(
  request: FastifyRequest<{ Params: EventIdParams }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const orgId = request.getOrgId();

  if (!orgId) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Organization context required",
    });
    return;
  }

  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Invalid event ID format",
    });
    return;
  }

  try {
    const result = await query<{
      id: string;
      event_id: string;
      job_id: string;
      title: string;
      summary: string;
      root_cause: string;
      causal_chain: unknown;
      suggested_fix: unknown;
      evidence: unknown;
      evidence_graph: unknown;
      confidence: number;
      llm_model: string;
      llm_tokens_used: number | null;
      processing_time_ms: number | null;
      user_feedback: string | null;
      user_notes: string | null;
      actual_root_cause: string | null;
      feedback_timestamp: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT
         r.id,
         r.event_id,
         r.job_id,
         r.title,
         r.summary,
         r.root_cause,
         r.causal_chain,
         r.suggested_fix,
         r.evidence,
         r.evidence_graph,
         r.confidence,
         r.llm_model,
         r.llm_tokens_used,
         r.processing_time_ms,
         r.user_feedback,
         r.user_notes,
         r.actual_root_cause,
         r.feedback_timestamp,
         r.created_at,
         r.updated_at
       FROM rca_results r
       WHERE r.event_id = $1 AND r.org_id = $2
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      reply.status(404).send({
        error: "Not Found",
        message: "RCA result not found for this event",
      });
      return;
    }

    const row = result.rows[0];
    reply.send({
      ...row,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      feedback_timestamp: row.feedback_timestamp?.toISOString() ?? null,
    });
  } catch (error) {
    logger.error({ error, eventId: id, orgId }, "Failed to fetch event RCA");
    reply.status(500).send({
      error: "Internal Server Error",
      message: "Failed to fetch RCA result",
    });
  }
}

// ============================================
// Route Registration
// ============================================

export async function eventsRoutes(server: FastifyInstance): Promise<void> {
  // GET /api/events
  server.get(
    "/events",
    {
      schema: {
        description: "List events with pagination and filtering",
        tags: ["events"],
        querystring: {
          type: "object",
          properties: {
            page: { type: "string" },
            pageSize: { type: "string" },
            // Note: severity and status are comma-separated strings that get validated by Zod
            // Don't use enum here as it prevents comma-separated values like "pending,processing"
            severity: { type: "string" },
            status: { type: "string" },
            search: { type: "string" },
            environment: { type: "string" },
          },
        },
      },
    },
    listEventsHandler
  );

  // GET /api/events/:id
  server.get(
    "/events/:id",
    {
      schema: {
        description: "Get event details",
        tags: ["events"],
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
      },
    },
    getEventHandler
  );

  // POST /api/events/:id/reanalyze
  server.post(
    "/events/:id/reanalyze",
    {
      schema: {
        description: "Trigger re-analysis of an event",
        tags: ["events"],
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
      },
    },
    reanalyzeEventHandler
  );

  // GET /api/events/:id/rca
  server.get(
    "/events/:id/rca",
    {
      schema: {
        description: "Get RCA result for an event",
        tags: ["events"],
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
      },
    },
    getEventRCAHandler
  );
}
