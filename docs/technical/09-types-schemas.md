# 09 - Types & Schemas

## Overview

Buglens uses a dual validation strategy:

1. **Zod Schemas** - Runtime validation at API boundaries (webhooks, user input)
2. **TypeScript Types** - Compile-time type safety throughout the codebase

This ensures data integrity from external sources while maintaining developer productivity with full IntelliSense support.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TYPE SYSTEM ARCHITECTURE                              │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      EXTERNAL BOUNDARY                                  │ │
│  │                                                                         │ │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                │ │
│  │  │   Sentry    │    │   GitHub    │    │    Slack    │                │ │
│  │  │  Webhook    │    │   Events    │    │  Commands   │                │ │
│  │  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                │ │
│  │         │                  │                  │                        │ │
│  │         └──────────────────┼──────────────────┘                        │ │
│  │                            │                                           │ │
│  │                            ▼                                           │ │
│  │               ┌────────────────────────┐                               │ │
│  │               │    Zod Validation      │                               │ │
│  │               │    (Runtime Check)     │                               │ │
│  │               └────────────┬───────────┘                               │ │
│  │                            │                                           │ │
│  └────────────────────────────┼───────────────────────────────────────────┘ │
│                               │                                             │
│                               ▼                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      INTERNAL DOMAIN                                    │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                    TypeScript Types                              │   │ │
│  │  │                                                                  │   │ │
│  │  │  • Inferred from Zod schemas (z.infer<typeof Schema>)           │   │ │
│  │  │  • Additional internal types (not exposed externally)           │   │ │
│  │  │  • Database model types                                          │   │ │
│  │  │  • Service interfaces                                            │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                    | Purpose                              |
| ----------------------- | ------------------------------------ |
| `src/types/sentry.ts`   | Sentry webhook types and Zod schemas |
| `src/types/models.ts`   | Database model types                 |
| `src/types/evidence.ts` | Evidence bundle types                |
| `src/types/github.ts`   | GitHub integration types             |
| `src/types/rca.ts`      | RCA result types                     |

---

## Sentry Types

```typescript
// src/types/sentry.ts
import { z } from "zod";

// ============================================================================
// ZOD SCHEMAS (Runtime Validation)
// ============================================================================

/**
 * Stack frame from Sentry exception
 */
export const StackFrameSchema = z.object({
  filename: z.string().optional(),
  function: z.string().optional(),
  module: z.string().optional(),
  lineno: z.number().optional(),
  colno: z.number().optional(),
  abs_path: z.string().optional(),
  context_line: z.string().optional(),
  pre_context: z.array(z.string()).optional(),
  post_context: z.array(z.string()).optional(),
  in_app: z.boolean().optional(),
  vars: z.record(z.unknown()).optional(),
});

/**
 * Exception value from Sentry
 */
export const ExceptionValueSchema = z.object({
  type: z.string().optional(),
  value: z.string().optional(),
  module: z.string().optional(),
  thread_id: z.number().optional(),
  mechanism: z
    .object({
      type: z.string().optional(),
      handled: z.boolean().optional(),
    })
    .optional(),
  stacktrace: z
    .object({
      frames: z.array(StackFrameSchema).optional(),
    })
    .optional(),
});

/**
 * Sentry breadcrumb
 */
export const BreadcrumbSchema = z.object({
  timestamp: z.string().or(z.number()),
  type: z.string().optional(),
  category: z.string().optional(),
  level: z.enum(["fatal", "error", "warning", "info", "debug"]).optional(),
  message: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});

/**
 * User information
 */
export const UserSchema = z.object({
  id: z.string().optional(),
  email: z.string().email().optional(),
  username: z.string().optional(),
  ip_address: z.string().optional(),
});

/**
 * Sentry event data (inside webhook)
 */
export const SentryEventDataSchema = z.object({
  event_id: z.string(),
  project: z.number().optional(),
  project_slug: z.string().optional(),
  platform: z.string().optional(),
  level: z.string().optional(),
  environment: z.string().optional(),
  release: z.string().optional(),
  timestamp: z.string().or(z.number()),
  received: z.number().optional(),
  title: z.string().optional(),
  message: z.string().optional(),
  culprit: z.string().optional(),
  tags: z.array(z.tuple([z.string(), z.string()])).optional(),
  exception: z
    .object({
      values: z.array(ExceptionValueSchema).optional(),
    })
    .optional(),
  breadcrumbs: z
    .object({
      values: z.array(BreadcrumbSchema).optional(),
    })
    .optional(),
  contexts: z.record(z.unknown()).optional(),
  user: UserSchema.optional(),
  request: z
    .object({
      url: z.string().optional(),
      method: z.string().optional(),
      headers: z.record(z.string()).optional(),
      query_string: z.string().optional(),
    })
    .optional(),
  extra: z.record(z.unknown()).optional(),
  fingerprint: z.array(z.string()).optional(),
});

/**
 * Sentry webhook payload (top-level)
 */
export const SentryWebhookPayloadSchema = z.object({
  action: z.string(),
  data: z.object({
    event: SentryEventDataSchema,
    triggered_rule: z.string().optional(),
  }),
  actor: z
    .object({
      type: z.string(),
      id: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  installation: z
    .object({
      uuid: z.string(),
    })
    .optional(),
});

// ============================================================================
// TYPESCRIPT TYPES (Inferred from Zod)
// ============================================================================

export type StackFrame = z.infer<typeof StackFrameSchema>;
export type ExceptionValue = z.infer<typeof ExceptionValueSchema>;
export type Breadcrumb = z.infer<typeof BreadcrumbSchema>;
export type SentryUser = z.infer<typeof UserSchema>;
export type SentryEventData = z.infer<typeof SentryEventDataSchema>;
export type SentryWebhookPayload = z.infer<typeof SentryWebhookPayloadSchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate and parse Sentry webhook payload
 * @throws ZodError if validation fails
 */
export function parseSentryWebhook(data: unknown): SentryWebhookPayload {
  return SentryWebhookPayloadSchema.parse(data);
}

/**
 * Safe parse that returns null on failure
 */
export function safeParseSentryWebhook(
  data: unknown
): SentryWebhookPayload | null {
  const result = SentryWebhookPayloadSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Validate webhook signature (HMAC-SHA256)
 */
export function validateSentrySignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const crypto = require("crypto");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

---

## Database Model Types

```typescript
// src/types/models.ts

/**
 * Organization plan tiers
 */
export type PlanTier = "free" | "pro" | "enterprise";

/**
 * Job processing status
 */
export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Organization model
 */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: PlanTier;
  github_installation_id: number | null;
  sentry_organization_slug: string | null;
  settings: OrganizationSettings;
  created_at: Date;
  updated_at: Date;
}

export interface OrganizationSettings {
  slack_channel?: string;
  default_branch?: string;
  auto_analyze?: boolean;
  notification_level?: "all" | "high" | "none";
}

/**
 * Stored Sentry event
 */
export interface Event {
  id: string;
  org_id: string;
  sentry_event_id: string;
  sentry_project_slug: string | null;
  message: string;
  platform: string | null;
  level: string | null;
  environment: string | null;
  fingerprint: string | null;
  tags: Record<string, string>;
  raw_payload: SentryEventData;
  received_at: Date;
  created_at: Date;
}

/**
 * RCA job record
 */
export interface RCAJob {
  id: string;
  org_id: string;
  event_id: string;
  status: JobStatus;
  priority: number;
  error_message: string | null;
  retry_count: number;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * RCA result record
 */
export interface RCAResult {
  id: string;
  org_id: string;
  event_id: string;
  root_cause: string;
  confidence: number;
  suggested_fix: string | null;
  evidence_summary: EvidenceSummary;
  deterministic_findings: DeterministicFinding[];
  llm_response: LLMResponse | null;
  llm_model: string | null;
  llm_tokens_used: number | null;
  llm_cost_usd: number | null;
  execution_time_ms: number | null;
  user_feedback: -1 | 0 | 1 | null;
  created_at: Date;
}

/**
 * Repository record
 */
export interface Repo {
  id: string;
  org_id: string;
  full_name: string;
  github_installation_id: number | null;
  default_branch: string;
  is_private: boolean;
  last_analyzed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Integration record
 */
export interface Integration {
  id: string;
  org_id: string;
  type: "sentry" | "github" | "slack";
  enabled: boolean;
  config: IntegrationConfig;
  created_at: Date;
  updated_at: Date;
}

export type IntegrationConfig =
  | SentryIntegrationConfig
  | GitHubIntegrationConfig
  | SlackIntegrationConfig;

export interface SentryIntegrationConfig {
  webhook_secret: string;
  organization_slug: string;
}

export interface GitHubIntegrationConfig {
  installation_id: number;
  app_id: number;
}

export interface SlackIntegrationConfig {
  webhook_url: string;
  channel: string;
  bot_token?: string;
}

/**
 * Cost metrics record
 */
export interface CostMetrics {
  id: string;
  org_id: string;
  date: Date;
  rca_count: number;
  rca_success_count: number;
  rca_failure_count: number;
  llm_tokens_input: number;
  llm_tokens_output: number;
  llm_cost_usd: number;
  github_api_calls: number;
  github_cache_hits: number;
  evidence_storage_bytes: number;
  created_at: Date;
  updated_at: Date;
}
```

---

## Evidence Types

```typescript
// src/types/evidence.ts
import { z } from "zod";

// ============================================================================
// ERROR INFO
// ============================================================================

export interface ErrorInfo {
  message: string;
  type: string;
  value: string;
  stack_trace: NormalizedStackFrame[];
  tags: Record<string, string>;
  fingerprint?: string;
  timestamp: string;
}

export interface NormalizedStackFrame {
  file: string;
  line: number;
  column?: number;
  function: string;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  in_app: boolean;
}

// ============================================================================
// CODE CONTEXT
// ============================================================================

export interface CodeContext {
  frames: CodeContextFrame[];
  files_fetched: number;
  files_available: number;
}

export interface CodeContextFrame {
  file: string;
  line?: number;
  snippet?: string;
  full_file?: string;
  highlighted_line?: string;
  language?: string;
  error?: string;
}

// ============================================================================
// TIMELINE
// ============================================================================

export interface Timeline {
  events: TimelineEvent[];
  duration_ms: number;
  error_timestamp?: string;
}

export interface TimelineEvent {
  timestamp: string;
  category: string;
  message: string;
  level: string;
  data: Record<string, unknown>;
  relative_ms: number;
}

// ============================================================================
// COMMIT INFO
// ============================================================================

export interface CommitInfo {
  sha: string;
  short_sha: string;
  message: string;
  author: string;
  date: string;
  files_changed: number;
}

// ============================================================================
// AST FINDINGS (Deterministic)
// ============================================================================

export const DeterministicFindingSchema = z.object({
  rule_id: z.string(),
  title: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  confidence: z.number().min(0).max(1),
  message: z.string(),
  line_start: z.number(),
  line_end: z.number(),
  column_start: z.number().optional(),
  column_end: z.number().optional(),
  code_snippet: z.string(),
  suggested_fix: z.string().optional(),
  explanation: z.string().optional(),
});

export type DeterministicFinding = z.infer<typeof DeterministicFindingSchema>;

// ============================================================================
// EVIDENCE METADATA
// ============================================================================

export interface EvidenceMetadata {
  confidence: number;
  completeness: number;
  gaps: string[];
  sources: {
    error: boolean;
    code: boolean;
    ast: boolean;
    timeline: boolean;
    commits: boolean;
  };
}

// ============================================================================
// EVIDENCE BUNDLE (Complete)
// ============================================================================

export interface EvidenceBundle {
  errorInfo: ErrorInfo;
  codeContext: CodeContext;
  timeline: Timeline;
  commits: CommitInfo[];
  astFindings: DeterministicFinding[];
  metadata: EvidenceMetadata;
}

// ============================================================================
// EVIDENCE SUMMARY (Stored in DB)
// ============================================================================

export interface EvidenceSummary {
  error_type: string;
  error_message: string;
  files_analyzed: number;
  deterministic_findings_count: number;
  top_finding: string | null;
  timeline_events_count: number;
  recent_commits_count: number;
  confidence: number;
}
```

---

## RCA Types

```typescript
// src/types/rca.ts
import { z } from "zod";

// ============================================================================
// LLM RESPONSE SCHEMA
// ============================================================================

export const LLMResponseSchema = z.object({
  root_cause: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  evidence_citations: z.array(
    z.object({
      type: z.enum([
        "code",
        "stack_trace",
        "timeline",
        "commit",
        "ast_finding",
      ]),
      reference: z.string(),
      relevance: z.string(),
    })
  ),
  suggested_fix: z.object({
    description: z.string(),
    code: z.string().optional(),
    file: z.string().optional(),
    line: z.number().optional(),
  }),
  related_issues: z.array(z.string()).optional(),
  prevention_advice: z.string().optional(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

// ============================================================================
// RCA OUTPUT
// ============================================================================

export interface RCAOutput {
  rootCause: string;
  confidence: number;
  suggestedFix: string;
  reasoning: string;
  evidenceSummary: EvidenceSummary;
  tokensUsed: number;
  cost: number;
  model: string;
  llmResponse: LLMResponse;
}

// ============================================================================
// RCA REQUEST/RESPONSE
// ============================================================================

export interface GenerateRCARequest {
  evidence: EvidenceBundle;
  options?: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
  };
}

export interface GenerateRCAResponse {
  success: boolean;
  rca?: RCAOutput;
  error?: string;
  executionTimeMs: number;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate LLM response against schema
 */
export function validateLLMResponse(data: unknown): LLMResponse {
  return LLMResponseSchema.parse(data);
}

/**
 * Safe parse LLM response
 */
export function safeParseLLMResponse(data: unknown): LLMResponse | null {
  const result = LLMResponseSchema.safeParse(data);
  if (!result.success) {
    console.error("LLM response validation failed:", result.error.errors);
    return null;
  }
  return result.data;
}
```

---

## GitHub Types

```typescript
// src/types/github.ts
import { z } from "zod";

// ============================================================================
// WEBHOOK SCHEMAS
// ============================================================================

export const InstallationPayloadSchema = z.object({
  action: z.enum([
    "created",
    "deleted",
    "suspend",
    "unsuspend",
    "new_permissions_accepted",
  ]),
  installation: z.object({
    id: z.number(),
    account: z.object({
      login: z.string(),
      id: z.number(),
      type: z.enum(["User", "Organization"]),
    }),
    app_id: z.number(),
  }),
  repositories: z
    .array(
      z.object({
        id: z.number(),
        full_name: z.string(),
        private: z.boolean(),
        default_branch: z.string().optional(),
      })
    )
    .optional(),
  sender: z
    .object({
      login: z.string(),
      id: z.number(),
    })
    .optional(),
});

export const RepositoryEventSchema = z.object({
  action: z.enum(["added", "removed", "renamed"]),
  installation: z.object({
    id: z.number(),
  }),
  repositories_added: z
    .array(
      z.object({
        id: z.number(),
        full_name: z.string(),
        private: z.boolean(),
      })
    )
    .optional(),
  repositories_removed: z
    .array(
      z.object({
        id: z.number(),
        full_name: z.string(),
      })
    )
    .optional(),
});

export type InstallationPayload = z.infer<typeof InstallationPayloadSchema>;
export type RepositoryEvent = z.infer<typeof RepositoryEventSchema>;

// ============================================================================
// API TYPES
// ============================================================================

export interface GitHubFile {
  path: string;
  content: string;
  sha: string;
  size: number;
  encoding: "base64" | "utf-8";
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  files?: Array<{
    filename: string;
    status: "added" | "modified" | "removed";
    additions: number;
    deletions: number;
  }>;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}

// ============================================================================
// SERVICE TYPES
// ============================================================================

export interface FetchFileOptions {
  orgId: string;
  repo: string;
  ref: string;
  filePath: string;
}

export interface FetchFileResult {
  content: string;
  sha: string;
  fromCache: "redis" | "s3" | false;
}

export interface RepoInput {
  fullName: string;
  defaultBranch: string;
  private: boolean;
}
```

---

## Config Types

```typescript
// src/types/config.ts
import { z } from "zod";

/**
 * Environment configuration schema
 */
export const ConfigSchema = z.object({
  // Server
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default("0.0.0.0"),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // AWS
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_EVIDENCE_BUCKET: z.string().optional(),
  S3_CODE_CACHE_BUCKET: z.string().optional(),

  // GitHub App
  GITHUB_APP_ID: z.coerce.number().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // Sentry
  SENTRY_WEBHOOK_SECRET: z.string().optional(),

  // LLM
  LLM_PROVIDER: z.enum(["openai", "deepseek"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  LLM_BASE_URL: z.string().url().optional(),

  // Slack
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // App
  APP_URL: z.string().url().default("http://localhost:3000"),
  ALLOW_DEV_ERRORS: z.coerce.boolean().default(false),

  // Limits
  EVIDENCE_MAX_FRAMES: z.coerce.number().default(5),
  CODE_CONTEXT_LINES: z.coerce.number().default(15),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Validate environment configuration
 */
export function validateConfig(env: NodeJS.ProcessEnv): Config {
  const result = ConfigSchema.safeParse(env);

  if (!result.success) {
    console.error("Configuration validation failed:");
    result.error.errors.forEach((err) => {
      console.error(`  ${err.path.join(".")}: ${err.message}`);
    });
    throw new Error("Invalid configuration");
  }

  return result.data;
}
```

---

## Type Guards

```typescript
// src/types/guards.ts

import { JobStatus, PlanTier } from "./models";

/**
 * Type guard for job status
 */
export function isValidJobStatus(status: string): status is JobStatus {
  return ["pending", "processing", "completed", "failed", "cancelled"].includes(
    status
  );
}

/**
 * Type guard for plan tier
 */
export function isValidPlanTier(plan: string): plan is PlanTier {
  return ["free", "pro", "enterprise"].includes(plan);
}

/**
 * Type guard for checking if value is non-null
 */
export function isNotNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Type guard for checking if error has message
 */
export function isErrorWithMessage(
  error: unknown
): error is { message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  );
}

/**
 * Extract error message safely
 */
export function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}
```

---

## Usage Examples

```typescript
// Validating webhook payload
import { parseSentryWebhook, SentryWebhookPayload } from "./types/sentry";

app.post("/webhooks/sentry", async (req, reply) => {
  let payload: SentryWebhookPayload;

  try {
    payload = parseSentryWebhook(req.body);
  } catch (error) {
    logger.warn({ error }, "Invalid Sentry webhook payload");
    return reply.status(400).send({ error: "Invalid payload" });
  }

  // payload is now fully typed
  const eventId = payload.data.event.event_id;
  const message = payload.data.event.message;
  // ...
});

// Using type guards
import { isNotNull, getErrorMessage } from "./types/guards";

const results = await Promise.all(files.map(fetchFile));
const successfulResults = results.filter(isNotNull);

try {
  await processData(data);
} catch (error) {
  logger.error({ error: getErrorMessage(error) }, "Processing failed");
}
```
