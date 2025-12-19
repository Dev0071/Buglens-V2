/**
 * Test Helpers and Seed Data for API Integration Tests
 *
 * This module provides:
 * - Test organization and user IDs
 * - Functions to seed and cleanup test data
 * - Utility functions for creating test records
 *
 * IMPORTANT: These interfaces match the ACTUAL database schema from migrations.
 * Events table does NOT have a 'severity' column - severity is computed from raw_payload.
 */

import { query, pool } from "../../src/db/client.js";
import { randomUUID } from "crypto";

// ============================================
// Test Constants
// ============================================

export const TEST_ORG_ID = "00000000-0000-0000-0000-000000000000";
export const TEST_ORG_NAME = "Test Organization";
export const SECOND_TEST_ORG_ID = "11111111-1111-1111-1111-111111111111";
export const SECOND_TEST_ORG_NAME = "Second Org";

// ============================================
// Seed Data Generators (Matching Actual DB Schema)
// ============================================

/**
 * Event interface matching migrations/002_create_events.cjs
 * NOTE: No 'severity' column - severity is computed from raw_payload
 */
export interface SeedEvent {
  id: string;
  org_id: string;
  source: string;
  sentry_event_id: string;
  signature: string;
  platform: string | null;
  message: string | null;
  stack_trace: Record<string, unknown> | null;
  breadcrumbs: Record<string, unknown>[] | null;
  context: Record<string, unknown> | null;
  environment: string | null;
  release: string | null;
  timestamp: Date;
  status: string;
  raw_payload: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * RCA Job interface matching migrations/003_create_rca_jobs.cjs
 */
export interface SeedRCAJob {
  id: string;
  org_id: string;
  event_id: string;
  status: "pending" | "running" | "done" | "failed";
  code_context_s3_url?: string;
  deterministic_findings?: Record<string, unknown>;
  error_message?: string;
  retry_count: number;
  started_at?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * RCA Result interface matching migrations/004_create_rca_results.cjs
 */
export interface SeedRCAResult {
  id: string;
  org_id: string;
  event_id: string;
  job_id: string;
  title: string;
  summary: string;
  root_cause: string;
  causal_chain: Record<string, unknown>[];
  suggested_fix: Record<string, unknown> | null;
  test_intentions: Record<string, unknown>[] | null;
  evidence: Record<string, unknown>;
  confidence: number;
  llm_model: string;
  llm_tokens_used?: number;
  processing_time_ms?: number;
  user_feedback?: string;
  user_notes?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Integration interface matching migrations/008_create_integrations.cjs
 */
export interface SeedIntegration {
  id: string;
  org_id: string;
  type: "sentry" | "github" | "slack";
  config: Record<string, unknown>;
  secret_id?: string;
  is_active: boolean;
  last_verified_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface SeedCostMetric {
  id: string;
  org_id: string;
  date: string;
  llm_tokens_used: number;
  llm_cost_usd: number;
  github_api_calls: number;
}

// ============================================
// Data Creation Functions (Pure)
// ============================================

/**
 * Create test event data matching actual DB schema
 * Severity is computed from raw_payload.exception.values[0].type
 */
export function createEventData(overrides: Partial<SeedEvent> = {}): SeedEvent {
  const id = randomUUID();
  const now = new Date();

  // Default error type determines computed severity
  const rawPayload = overrides.raw_payload as
    | Record<string, unknown>
    | undefined;
  const exception = rawPayload?.exception as
    | Record<string, unknown>
    | undefined;
  const values = exception?.values as
    | Array<Record<string, unknown>>
    | undefined;
  const errorType = (values?.[0]?.type as string) || "TypeError";

  return {
    id,
    org_id: TEST_ORG_ID,
    source: "sentry",
    sentry_event_id: `sentry-${id.slice(0, 8)}`,
    signature: `${errorType}:test-error-${id.slice(0, 8)}`,
    platform: "javascript",
    message: `Test error: ${id.slice(0, 8)}`,
    stack_trace: {
      frames: [
        {
          filename: "src/app.ts",
          lineno: 42,
          colno: 10,
          function: "handleRequest",
          in_app: true,
        },
      ],
    },
    breadcrumbs: [
      {
        type: "http",
        category: "fetch",
        message: "GET /api/users",
        timestamp: now.toISOString(),
      },
    ],
    context: {
      browser: { name: "Chrome", version: "120.0" },
      os: { name: "macOS" },
    },
    environment: "production",
    release: "1.0.0",
    timestamp: now,
    status: "received",
    raw_payload: {
      exception: {
        values: [
          {
            type: errorType,
            value: "Cannot read property 'foo' of undefined",
            stacktrace: {
              frames: [
                {
                  filename: "src/app.ts",
                  lineno: 42,
                  colno: 10,
                  function: "handleRequest",
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
      contexts: {
        browser: { name: "Chrome", version: "120.0" },
        os: { name: "macOS" },
      },
      user: { id: "user-123" },
      tags: { version: "1.0.0" },
    },
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function createRCAJobData(
  eventId: string,
  overrides: Partial<SeedRCAJob> = {}
): SeedRCAJob {
  const id = randomUUID();
  const now = new Date();
  return {
    id,
    org_id: TEST_ORG_ID,
    event_id: eventId,
    status: "pending",
    retry_count: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/**
 * Create RCA result data matching actual DB schema
 */
export function createRCAResultData(
  jobId: string,
  eventId: string,
  overrides: Partial<SeedRCAResult> = {}
): SeedRCAResult {
  const id = randomUUID();
  const now = new Date();
  return {
    id,
    org_id: TEST_ORG_ID,
    event_id: eventId,
    job_id: jobId,
    title: "Null Reference Error in Request Handler",
    summary: "A null reference error occurred when accessing user profile data",
    root_cause:
      "Null reference error due to missing null check before property access",
    causal_chain: [
      { step: 1, description: "User data fetch returned null" },
      { step: 2, description: "No null check before accessing user.profile" },
      {
        step: 3,
        description: "TypeError thrown when accessing undefined.name",
      },
    ],
    suggested_fix: {
      description: "Add null check before accessing property",
      code: "if (user?.profile) { return user.profile.name; }",
      file: "src/app.ts",
      line: 42,
    },
    test_intentions: [
      { type: "unit", description: "Test null user handling" },
      {
        type: "integration",
        description: "Test user profile endpoint with missing data",
      },
    ],
    evidence: {
      error_info: {
        type: "TypeError",
        message: "Cannot read property 'name' of undefined",
      },
      code_context: { file: "src/app.ts", snippet: "user.profile.name" },
      deterministic_findings: [
        { rule: "null-access", confidence: 0.9, location: "src/app.ts:42" },
      ],
    },
    confidence: 0.85,
    llm_model: "gpt-4o-mini",
    llm_tokens_used: 1500,
    processing_time_ms: 2500,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function createIntegrationData(
  type: "sentry" | "github" | "slack",
  overrides: Partial<SeedIntegration> = {}
): SeedIntegration {
  const id = randomUUID();
  const now = new Date();
  const configs: Record<string, Record<string, unknown>> = {
    sentry: {
      dsn: "https://test@sentry.io/12345",
      project_slug: "test-project",
      organization_slug: "test-org",
    },
    github: {
      installation_id: 12345,
      owner: "test-owner",
      repos: ["repo-1", "repo-2"],
    },
    slack: {
      webhook_url: "https://hooks.slack.com/services/xxx",
      channel: "#errors",
      bot_token: "xoxb-test-token",
    },
  };

  return {
    id,
    org_id: TEST_ORG_ID,
    type,
    config: configs[type],
    is_active: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function createCostMetricData(
  date: string,
  overrides: Partial<SeedCostMetric> = {}
): SeedCostMetric {
  return {
    id: randomUUID(),
    org_id: TEST_ORG_ID,
    date,
    llm_tokens_used: Math.floor(Math.random() * 50000) + 10000,
    llm_cost_usd: Math.random() * 0.5 + 0.1,
    github_api_calls: Math.floor(Math.random() * 100) + 20,
    ...overrides,
  };
}

// ============================================
// Database Operations
// ============================================

/**
 * Ensure test organization exists
 * NOTE: Uses DO NOTHING to avoid overwriting settings during concurrent tests
 */
export async function ensureTestOrg(): Promise<void> {
  await query(
    `INSERT INTO organizations (id, name, slug, plan, created_at, updated_at)
     VALUES ($1, $2, $3, 'pro', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [TEST_ORG_ID, TEST_ORG_NAME, "test-organization"]
  );
}

/**
 * Reset test organization to default values
 * Use this at the START of test files that modify org settings
 */
export async function resetTestOrg(): Promise<void> {
  await query(
    `UPDATE organizations
     SET name = $2, plan = 'pro', settings = '{}', updated_at = NOW()
     WHERE id = $1`,
    [TEST_ORG_ID, TEST_ORG_NAME]
  );
}

/**
 * Ensure second test organization exists (for isolation tests)
 */
export async function ensureSecondTestOrg(
  name: string = SECOND_TEST_ORG_NAME,
  plan: string = "free"
): Promise<void> {
  await query(
    `INSERT INTO organizations (id, name, slug, plan, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [SECOND_TEST_ORG_ID, name, "second-organization", plan]
  );
}

/**
 * Cleanup second test organization
 */
export async function cleanupSecondTestOrg(): Promise<void> {
  await query(
    "DELETE FROM rca_results WHERE job_id IN (SELECT id FROM rca_jobs WHERE org_id = $1)",
    [SECOND_TEST_ORG_ID]
  );
  await query("DELETE FROM rca_jobs WHERE org_id = $1", [SECOND_TEST_ORG_ID]);
  await query("DELETE FROM events WHERE org_id = $1", [SECOND_TEST_ORG_ID]);
  await query("DELETE FROM integrations WHERE org_id = $1", [
    SECOND_TEST_ORG_ID,
  ]);
  await query("DELETE FROM cost_metrics WHERE org_id = $1", [
    SECOND_TEST_ORG_ID,
  ]);
}

/**
 * Insert a test event into the database
 * Matches actual events table schema from migrations/002_create_events.cjs
 */
export async function insertEvent(event: SeedEvent): Promise<SeedEvent> {
  await query(
    `INSERT INTO events (
      id, org_id, source, sentry_event_id, signature, platform, message,
      stack_trace, breadcrumbs, context, environment, release, timestamp,
      status, raw_payload, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      event.id,
      event.org_id,
      event.source,
      event.sentry_event_id,
      event.signature,
      event.platform,
      event.message,
      event.stack_trace ? JSON.stringify(event.stack_trace) : null,
      event.breadcrumbs ? JSON.stringify(event.breadcrumbs) : null,
      event.context ? JSON.stringify(event.context) : null,
      event.environment,
      event.release,
      event.timestamp,
      event.status,
      event.raw_payload ? JSON.stringify(event.raw_payload) : null,
      event.created_at,
      event.updated_at,
    ]
  );
  return event;
}

/**
 * Insert a test RCA job into the database
 * Matches actual rca_jobs table schema from migrations/003_create_rca_jobs.cjs
 */
export async function insertRCAJob(job: SeedRCAJob): Promise<SeedRCAJob> {
  await query(
    `INSERT INTO rca_jobs (
      id, org_id, event_id, status, code_context_s3_url, deterministic_findings,
      error_message, retry_count, started_at, completed_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      job.id,
      job.org_id,
      job.event_id,
      job.status,
      job.code_context_s3_url || null,
      job.deterministic_findings
        ? JSON.stringify(job.deterministic_findings)
        : null,
      job.error_message || null,
      job.retry_count,
      job.started_at || null,
      job.completed_at || null,
      job.created_at,
      job.updated_at,
    ]
  );
  return job;
}

/**
 * Insert a test RCA result into the database
 * Matches actual rca_results table schema from migrations/004_create_rca_results.cjs
 */
export async function insertRCAResult(
  result: SeedRCAResult
): Promise<SeedRCAResult> {
  await query(
    `INSERT INTO rca_results (
      id, org_id, event_id, job_id, title, summary, root_cause, causal_chain,
      suggested_fix, test_intentions, evidence, confidence, llm_model,
      llm_tokens_used, processing_time_ms, user_feedback, user_notes,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      result.id,
      result.org_id,
      result.event_id,
      result.job_id,
      result.title,
      result.summary,
      result.root_cause,
      JSON.stringify(result.causal_chain),
      result.suggested_fix ? JSON.stringify(result.suggested_fix) : null,
      result.test_intentions ? JSON.stringify(result.test_intentions) : null,
      JSON.stringify(result.evidence),
      result.confidence,
      result.llm_model,
      result.llm_tokens_used || null,
      result.processing_time_ms || null,
      result.user_feedback || null,
      result.user_notes || null,
      result.created_at,
      result.updated_at,
    ]
  );
  return result;
}

/**
 * Insert a test integration into the database
 */
export async function insertIntegration(
  integration: SeedIntegration
): Promise<SeedIntegration> {
  await query(
    `INSERT INTO integrations (id, org_id, type, config, secret_id, is_active, last_verified_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      integration.id,
      integration.org_id,
      integration.type,
      JSON.stringify(integration.config),
      integration.secret_id || null,
      integration.is_active,
      integration.last_verified_at || null,
      integration.created_at,
      integration.updated_at,
    ]
  );
  return integration;
}

/**
 * Insert a test cost metric into the database
 */
export async function insertCostMetric(
  metric: SeedCostMetric
): Promise<SeedCostMetric> {
  await query(
    `INSERT INTO cost_metrics (id, org_id, date, llm_tokens_used, llm_cost_usd, github_api_calls)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (org_id, date) DO UPDATE SET
       llm_tokens_used = cost_metrics.llm_tokens_used + $4,
       llm_cost_usd = cost_metrics.llm_cost_usd + $5,
       github_api_calls = cost_metrics.github_api_calls + $6`,
    [
      metric.id,
      metric.org_id,
      metric.date,
      metric.llm_tokens_used,
      metric.llm_cost_usd,
      metric.github_api_calls,
    ]
  );
  return metric;
}

// ============================================
// Seed Scenarios
// ============================================

export interface SeedScenarioResult {
  events: SeedEvent[];
  jobs: SeedRCAJob[];
  results: SeedRCAResult[];
  integrations: SeedIntegration[];
  costMetrics: SeedCostMetric[];
}

/**
 * Seed a complete scenario with events, RCA jobs, results, integrations, and cost metrics
 */
export async function seedCompleteScenario(): Promise<SeedScenarioResult> {
  await ensureTestOrg();

  const events: SeedEvent[] = [];
  const jobs: SeedRCAJob[] = [];
  const results: SeedRCAResult[] = [];

  // Create 10 events with varying error types (which determine computed severity)
  // Error types map to severity: UnhandledRejection/Fatal=critical, TypeError=high, SyntaxError=medium, etc
  const errorTypes = [
    "UnhandledRejection", // critical (production)
    "TypeError", // high (production)
    "ReferenceError", // high (production)
    "TypeError", // high (production)
    "SyntaxError", // medium
    "NetworkError", // medium
    "ValidationError", // low
    "Warning", // low
    "Info", // low
    "Debug", // low
  ];
  const environments = [
    "production",
    "production",
    "production",
    "production",
    "staging",
    "staging",
    "development",
    "development",
    "development",
    "development",
  ];
  const statuses: SeedRCAJob["status"][] = [
    "done",
    "done",
    "done",
    "done",
    "done",
    "running",
    "pending",
    "failed",
    "done",
    "done",
  ];

  for (let i = 0; i < 10; i++) {
    const daysAgo = i;
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - daysAgo);

    const event = await insertEvent(
      createEventData({
        environment: environments[i],
        message: `Test error ${i + 1}: ${errorTypes[i]} in ${environments[i]}`,
        timestamp: createdAt,
        created_at: createdAt,
        updated_at: createdAt,
        raw_payload: {
          exception: {
            values: [
              {
                type: errorTypes[i],
                value: `Test ${errorTypes[i]} message`,
                stacktrace: {
                  frames: [
                    { filename: "src/app.ts", lineno: 42 + i, in_app: true },
                  ],
                },
              },
            ],
          },
        },
      })
    );
    events.push(event);

    const job = await insertRCAJob(
      createRCAJobData(event.id, {
        status: statuses[i],
        created_at: createdAt,
        updated_at: createdAt,
        started_at: statuses[i] !== "pending" ? createdAt : undefined,
        completed_at:
          statuses[i] === "done" || statuses[i] === "failed"
            ? createdAt
            : undefined,
      })
    );
    jobs.push(job);

    // Create RCA results for completed jobs
    if (statuses[i] === "done") {
      const result = await insertRCAResult(
        createRCAResultData(job.id, event.id, {
          confidence: 0.7 + Math.random() * 0.25,
          created_at: createdAt,
          updated_at: createdAt,
        })
      );
      results.push(result);
    }
  }

  // Create integrations
  const integrations = await Promise.all([
    insertIntegration(createIntegrationData("sentry")),
    insertIntegration(createIntegrationData("github")),
    insertIntegration(createIntegrationData("slack", { is_active: false })),
  ]);

  // Create cost metrics for the last 30 days
  const costMetrics: SeedCostMetric[] = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];

    const metric = await insertCostMetric(
      createCostMetricData(dateStr, {
        llm_tokens_used: 10000 + Math.floor(Math.random() * 40000),
        llm_cost_usd: parseFloat((0.1 + Math.random() * 0.4).toFixed(4)),
        github_api_calls: 20 + Math.floor(Math.random() * 80),
      })
    );
    costMetrics.push(metric);
  }

  return { events, jobs, results, integrations, costMetrics };
}

/**
 * Seed minimal data for specific tests
 */
export async function seedMinimal(): Promise<{
  event: SeedEvent;
  job: SeedRCAJob;
}> {
  await ensureTestOrg();

  const event = await insertEvent(createEventData());
  const job = await insertRCAJob(createRCAJobData(event.id));

  return { event, job };
}

// ============================================
// Cleanup Functions
// ============================================

/**
 * Clean all test data for the test organization
 */
export async function cleanupTestData(): Promise<void> {
  // Order matters due to foreign key constraints
  await query(
    "DELETE FROM rca_results WHERE job_id IN (SELECT id FROM rca_jobs WHERE org_id = $1)",
    [TEST_ORG_ID]
  );
  await query("DELETE FROM rca_jobs WHERE org_id = $1", [TEST_ORG_ID]);
  await query("DELETE FROM events WHERE org_id = $1", [TEST_ORG_ID]);
  await query("DELETE FROM integrations WHERE org_id = $1", [TEST_ORG_ID]);
  await query("DELETE FROM cost_metrics WHERE org_id = $1", [TEST_ORG_ID]);
}

/**
 * Close database connection (call in afterAll)
 */
export async function closeDb(): Promise<void> {
  await pool.end();
}

// ============================================
// Test Request Helpers
// ============================================

export function createAuthHeaders(
  orgId: string = TEST_ORG_ID
): Record<string, string> {
  return {
    "x-org-id": orgId,
    "Content-Type": "application/json",
  };
}

export function createInvalidAuthHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    // Missing x-org-id
  };
}
