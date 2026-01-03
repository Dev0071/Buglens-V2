# Backend Architecture & Services - Comprehensive Technical Documentation

> **Buglens V2** - AI-Powered Root Cause Analysis Platform  
> **Document Version**: 1.0.0  
> **Last Updated**: January 3, 2026  
> **Maintainers**: Buglens Engineering Team

---

## Overview

This document provides comprehensive technical documentation for Buglens' backend architecture and services. It covers the complete request-response lifecycle from webhook ingestion through deterministic analysis, code fetching, evidence assembly, to background job processing.

### Core Architecture Principles

1. **Deterministic-First Philosophy**: AST analysis and pattern matching run before LLM reasoning. The LLM enhances explanations but never overrides deterministic findings.

2. **Multi-Tenancy from Day 1**: Every database table includes `org_id`, every request is organization-scoped, and Row-Level Security (RLS) enforces data isolation.

3. **3-Tier Caching Strategy**: GitHub code is cached in Redis (hot, 1hr) → S3 (warm, 7 days) → Database (permanent) to minimize API calls and prevent rate limiting.

4. **Cost Controls**: Per-organization quotas on events, RCA jobs, LLM tokens, and GitHub API calls with real-time tracking.

5. **Hybrid OOP/Functional Paradigm**:
   - **Functional**: Pure functions for transforms, extractors, validators, classifiers, scoring
   - **OOP**: Services with dependencies, I/O operations, configuration management

### Technology Stack

| Layer              | Technology                           |
| ------------------ | ------------------------------------ |
| API Server         | Node.js 20+ with Fastify             |
| Background Workers | BullMQ with Redis                    |
| Analysis Engine    | Python 3.11+ with tree-sitter        |
| LLM Integration    | OpenAI GPT-4o-mini / DeepSeek        |
| Type Safety        | TypeScript 5.x with Zod validation   |
| Inter-Process      | PythonBridge (child_process.spawn)   |

---

## Table of Contents

### Part 1: API Layer (Lines 52-678)
- [Application Setup](#01---api-layer)
- [Webhook Handlers (Sentry, GitHub)](#sentry-webhook-handler-webhooksts)
- [Multi-Tenancy Middleware](#multi-tenancy-middleware-org-contextts)
- [Rate Limiting](#rate-limiting-rate-limitts)
- [Health Endpoints](#health-endpoints-healthts)
- [Error Handling](#error-handling)
- [Security Considerations](#security-considerations)

### Part 2: Extraction Pipeline (Lines 679-1549)
- [3-Stage Architecture](#02---extraction-pipeline)
- [Stage 1: Deterministic Extraction](#stage-1-deterministic-extraction)
- [Stage 2: LLM-Assisted Extraction](#stage-2-llm-assisted-extraction)
- [Stage 3: Validation](#stage-3-validation)
- [Confidence Scoring](#confidence-scoring)
- [Error Recovery](#error-recovery-strategies)

### Part 3: Code Fetcher (Lines 1550-2252)
- [3-Tier Caching Strategy](#03---code-fetcher)
- [File Path Cleaning](#file-path-cleaning)
- [Source Map Resolution](#source-map-resolution)
- [Batch Fetching](#batch-fetching-optimization)
- [Cache Warming](#cache-warming)
- [Metrics & Monitoring](#metrics--monitoring)

### Part 4: Evidence Assembly (Lines 2253-3267)
- [Evidence Collector Service](#06---evidence-assembly)
- [Pure Transform Functions](#evidence-transforms-pure-functions)
- [Timeline Reconstruction](#timeline-reconstruction-python)
- [Confidence Scoring](#confidence-scoring-algorithm)
- [Storage Strategy (S3 + PostgreSQL)](#evidence-storage)
- [Evidence Graph Building](#evidence-graph-structure)

### Part 5: Python Analysis Engine (Lines 3268-4368)
- [Functional Paradigm Implementation](#05---python-analysis-engine)
- [JavaScript/TypeScript Analyzer](#javascript-typescript-analyzer-js_analyzerpy)
- [Rule Engine](#rule-engine-functional-implementation)
  - Null/Undefined Access Detection
  - Async Pattern Analysis
  - AI-Generated Code Signatures
- [Node.js Bridge](#nodejs-bridge-pythonbridgetsmd)
- [Testing Strategy](#testing-strategy)

### Part 6: Workers & Queues (Lines 4369-5469)
- [Queue Architecture (BullMQ)](#07---workers--queues)
- [Worker Implementation](#worker-bootstrap)
  - Deterministic Analyzer Worker
  - Evidence Assembly Worker
  - LLM Reasoning Worker
  - Token Refresh Worker
- [Job Scheduling](#job-scheduling)
- [Rate Limiting & Retry](#rate-limiting--retry)
- [Monitoring & Observability](#monitoring)

---

## Quick Reference

### Key File Locations

```
src/
├── api/
│   ├── app.ts                    # Fastify setup, plugins, middleware
│   ├── routes/
│   │   ├── webhooks.ts          # Sentry webhook handler
│   │   ├── github-webhooks.ts   # GitHub App webhooks
│   │   ├── integrations.ts      # OAuth flows (GitHub, Slack, Jira, Teams)
│   │   └── ...                  # Other API routes
│   └── middleware/
│       └── org-context.ts       # Multi-tenancy middleware
├── services/
│   ├── event-extractor/
│   │   ├── extraction-pipeline.ts      # 3-stage orchestrator
│   │   ├── deterministic-extractor.ts  # Stage 1 (pure functions)
│   │   ├── llm-assist-extractor.ts     # Stage 2 (Node.js interface)
│   │   └── extraction-validator.ts     # Stage 3 (GitHub validation)
│   ├── code-fetcher.ts          # 3-tier cache + GitHub API
│   ├── cache.ts                 # Redis/S3/DB cache implementation
│   ├── github.ts                # GitHub App authentication
│   ├── evidence-collector.ts    # Evidence assembly (OOP service)
│   ├── evidence-transforms.ts   # Pure transform functions
│   ├── python-bridge.ts         # Node-Python IPC
│   └── llm-service.ts           # GPT-4o-mini orchestration
└── workers/
    ├── index.ts                        # Worker bootstrap
    ├── deterministic-analyzer.worker.ts
    └── queues/
        ├── deterministic.ts
        ├── evidence.ts
        ├── llm-reasoning.ts
        └── token-refresh.ts

python/
├── analyzers/
│   ├── js_analyzer.py          # Main analyzer (functional)
│   ├── base.py                 # Data structures
│   └── rules/                  # Individual rule modules
│       ├── null_access.py
│       ├── async_race_condition.py
│       ├── unawaited_promises.py
│       └── ...
├── extractors/
│   └── llm_assist_extractor.py # Stage 2 LLM extraction
└── timeline/
    └── reconstructor.py        # Timeline correlation (pure functions)
```

### Rate Limits (Per Organization)

| Plan       | Events/Hour | RCA Jobs/Day | LLM Tokens/Day | GitHub API/Hour |
| ---------- | ----------- | ------------ | -------------- | --------------- |
| Free       | 100         | 50           | 100,000        | 500             |
| Pro        | 1,000       | 500          | 1,000,000      | 2,000           |
| Enterprise | 10,000      | 5,000        | 10,000,000     | 5,000           |

### RCA Job Status Flow

```
pending → processing → completed
                    └→ failed (retryable: true/false)
```

---

## Document Sections

The following sections contain the complete merged content from individual technical documentation files. All content has been preserved without modification to ensure accuracy and completeness.

---

# 01 - API Layer

## Overview

The API layer is built on **Fastify**, a high-performance Node.js web framework. It handles incoming webhooks from Sentry and GitHub, enforces multi-tenancy, rate limiting, and routes requests to the appropriate services.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         API Layer                                    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                     Fastify Server                           │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │    │
│  │  │    CORS     │  │     JWT      │  │   Global Rate      │  │    │
│  │  │  (origins)  │  │  (auth)      │  │   Limit (100/min)  │  │    │
│  │  └─────────────┘  └──────────────┘  └────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│  ┌───────────────────────────┼───────────────────────────────────┐  │
│  │                     Middleware                                 │  │
│  │  ┌────────────────────┐  ┌────────────────────────────────┐   │  │
│  │  │   org-context.ts   │  │      rate-limit.ts             │   │  │
│  │  │  - Extract org_id  │  │  - Per-org quotas              │   │  │
│  │  │  - Set RLS context │  │  - Resource-based limits       │   │  │
│  │  │  - Load org data   │  │  - Plan enforcement            │   │  │
│  │  └────────────────────┘  └────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────┼───────────────────────────────────┐  │
│  │                       Routes                                   │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────┐  │  │
│  │  │   webhooks.ts    │  │ github-webhooks  │  │  health.ts  │  │  │
│  │  │  /sentry/:org_id │  │    /github       │  │  /health    │  │  │
│  │  │                  │  │                  │  │  /ready     │  │  │
│  │  └──────────────────┘  └──────────────────┘  └─────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Files

| File                                | Purpose                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `src/api/app.ts`                    | Fastify application setup, plugin registration                                |
| `src/api/server.ts`                 | Server bootstrap, port binding                                                |
| `src/api/routes/webhooks.ts`        | Sentry webhook handler                                                        |
| `src/api/routes/github-webhooks.ts` | GitHub App webhook handler                                                    |
| `src/api/routes/health.ts`          | Health check endpoints                                                        |
| `src/api/routes/auth.ts`            | Authentication (login, signup, session management)                            |
| `src/api/routes/integrations.ts`    | Integration management (GitHub, Slack, Jira, Teams) + OAuth flows             |
| `src/api/routes/oauth.ts`           | **REMOVED** - OAuth functionality moved to integrations.ts                    |
| `src/api/routes/rca.ts`             | RCA results and analysis                                                      |
| `src/api/routes/events.ts`          | Event listing and details                                                     |
| `src/api/routes/dashboard.ts`       | Dashboard metrics and stats                                                   |
| `src/api/routes/settings.ts`        | Organization settings                                                         |
| `src/api/routes/costs.ts`           | Cost tracking and analytics                                                   |
| `src/api/routes/analytics.ts`       | Platform analytics                                                            |
| `src/api/routes/team.ts`            | Team member management                                                        |
| `src/api/routes/profile.ts`         | User profile management                                                       |
| `src/api/middleware/org-context.ts` | Multi-tenancy middleware                                                      |
| `src/api/middleware/rate-limit.ts`  | **NOTE**: Global rate limiting is configured in app.ts via @fastify/rate-limit |

---

## Application Setup (`app.ts`)

### Plugin Registration Order

```typescript
export const server = Fastify({
  logger: logger,
  requestIdHeader: "x-request-id",
  disableRequestLogging: false,
});

// 1. Raw body preservation (for HMAC verification)
server.removeContentTypeParser("application/json");
server.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (request, body, done) => {
    const buffer = body as Buffer;
    (request as FastifyRequest & { rawBody?: Buffer }).rawBody = buffer;
    const json = JSON.parse(buffer.toString("utf-8"));
    done(null, json);
  }
);

// 2. Organization context decorators
setupOrgDecorators(server);
server.addHook("preHandler", orgContextMiddleware);

// 3. CORS (explicit origins in production)
await server.register(cors, {
  origin:
    config.NODE_ENV === "test"
      ? true
      : config.CORS_ORIGINS && Array.isArray(config.CORS_ORIGINS)
        ? config.CORS_ORIGINS
        : config.NODE_ENV === "production"
          ? ["https://app.buglens.com", "https://buglens.com"]
          : ["http://localhost:3000", "http://localhost:5173"],
  credentials: true,
});

// 4. JWT authentication
await server.register(jwt, {
  secret: config.JWT_SECRET,
});

// 5. Cookie support (for session management)
await server.register(cookie, {
  secret: config.JWT_SECRET,
  parseOptions: {},
});

// 6. Global rate limiting (100 req/min per org/IP)
await server.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
  cache: 10000,
  redis: config.NODE_ENV === "test" ? undefined : redis.client,
  keyGenerator: (request) => request.getOrgId() || request.ip,
});

// 7. Route registration
await server.register(healthRoutes, { prefix: "/api/v1" });
await server.register(webhookRoutes, { prefix: "/api/v1" });
await server.register(githubWebhookRoutes, { prefix: "/api/v1" });
await server.register(authRoutes, { prefix: "/api" });
await server.register(rcaRoutes, { prefix: "/api" });
await server.register(dashboardRoutes, { prefix: "/api" });
await server.register(eventsRoutes, { prefix: "/api" });
await server.register(integrationsRoutes, { prefix: "/api" }); // Handles OAuth flows
await server.register(settingsRoutes, { prefix: "/api" });
await server.register(costsRoutes, { prefix: "/api" });
await server.register(analyticsRoutes, { prefix: "/api" });
await server.register(teamRoutes, { prefix: "/api" });
await server.register(profileRoutes, { prefix: "/api" });

  return server;
}
```

### Decorators Added to Request

```typescript
// org-context.ts
declare module "fastify" {
  interface FastifyRequest {
    orgContext?: OrgContext;
    getOrgId(): string | undefined;
    setOrgContext(ctx: OrgContext): void;
  }
}

interface OrgContext {
  orgId: string;
  plan: "free" | "pro" | "enterprise";
  settings: Record<string, unknown>;
}
```

---

## Sentry Webhook Handler (`webhooks.ts`)

### Endpoint

```
POST /api/v1/webhooks/sentry/:org_id
```

### Request Flow

```
┌────────────────────────────────────────────────────────────────────┐
│                    Sentry Webhook Flow                              │
└────────────────────────────────────────────────────────────────────┘

1. Extract org_id from URL params
   │
   ▼
2. Validate org_id is UUID format
   │ Invalid? → 400 Bad Request
   ▼
3. Check org exists in database
   │ Not found? → 404 Not Found
   ▼
4. HMAC Signature Verification (if secret configured)
   │ Invalid? → 401 Unauthorized
   ▼
5. Parse webhook payload (Zod validation)
   │ Invalid? → 400 Bad Request
   ▼
6. Environment Filter
   │ Is local/dev? → 200 OK (ignored)
   ▼
7. Stack Trace Validation
   │ No stack trace? → 200 OK (ignored)
   ▼
8. Rate Limit Check (events_per_hour)
   │ Exceeded? → 429 Too Many Requests
   ▼
9. Transaction:
   ├─ Check duplicate (sentry_event_id)
   │   Duplicate? → 200 OK (skipped)
   ├─ INSERT events
   ├─ INSERT rca_jobs (status: pending)
   └─ ENQUEUE deterministic-analyzer job
   │
   ▼
10. Return 200 OK with event_id
```

### HMAC Signature Verification

```typescript
// Raw body must be preserved for correct HMAC calculation
const payloadBuffer = requestWithRawBody.rawBody;

const hmac = crypto.createHmac("sha256", config.SENTRY_WEBHOOK_SECRET);
hmac.update(payloadBuffer);
const expectedSignature = hmac.digest("hex");

// Timing-safe comparison to prevent timing attacks
const signatureValid = crypto.timingSafeEqual(
  Buffer.from(signature, "hex"),
  Buffer.from(expectedSignature, "hex")
);
```

### Environment Filtering

```typescript
const IGNORED_ENVIRONMENTS = new Set([
  "local",
  "localhost",
  "development",
  "dev",
  "test",
  "testing",
]);

const ALLOWED_ENVIRONMENTS = new Set([
  "production",
  "prod",
  "staging",
  "stage",
  "uat",
  "qa",
  "preprod",
]);

function shouldProcessEnvironment(environment: string | null): {
  shouldProcess: boolean;
  reason?: string;
} {
  // ALLOW_DEV_ERRORS=true bypasses this check for testing
  if (config.ALLOW_DEV_ERRORS && IGNORED_ENVIRONMENTS.has(normalizedEnv)) {
    return { shouldProcess: true };
  }

  if (IGNORED_ENVIRONMENTS.has(normalizedEnv)) {
    return {
      shouldProcess: false,
      reason: `Environment '${environment}' is local/development`,
    };
  }

  return { shouldProcess: true };
}
```

### Response Codes

| Code | Scenario                              |
| ---- | ------------------------------------- |
| 200  | Event stored successfully             |
| 200  | Event ignored (local/dev environment) |
| 200  | Event ignored (no stack trace)        |
| 200  | Duplicate event (already processed)   |
| 400  | Invalid org_id format                 |
| 400  | Invalid webhook payload               |
| 401  | Missing/invalid HMAC signature        |
| 404  | Organization not found                |
| 429  | Rate limit exceeded                   |
| 500  | Internal server error                 |

---

## GitHub Webhook Handler (`github-webhooks.ts`)

### Endpoint

```
POST /api/v1/webhooks/github
```

### Supported Events

| Event                       | Action    | Handler                         |
| --------------------------- | --------- | ------------------------------- |
| `installation`              | `created` | Create organization, sync repos |
| `installation`              | `deleted` | Mark repos as uninstalled       |
| `installation_repositories` | `added`   | Register new repos              |
| `installation_repositories` | `removed` | Unregister repos                |
| `push`                      | -         | Update repo metadata            |

### Signature Verification

```typescript
function verifyGitHubSignature(
  payload: Buffer,
  signature: string,
  secret: string
): boolean {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  const expected = `sha256=${hmac.digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

### Installation Flow

```
GitHub App Installed
        │
        ▼
┌───────────────────┐
│ installation.created │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐     ┌───────────────────┐
│ Find/Create Org   │────▶│ Store GitHub      │
│ by account name   │     │ installation_id   │
└───────────────────┘     └─────────┬─────────┘
                                    │
                                    ▼
                          ┌───────────────────┐
                          │ Register all      │
                          │ repositories      │
                          │ (batch insert)    │
                          └───────────────────┘
```

---

## Multi-Tenancy Middleware (`org-context.ts`)

### Purpose

Every request must be associated with an organization for:

- Row-Level Security (RLS) context
- Rate limit tracking
- Plan-based feature access

### Implementation

```typescript
export async function orgContextMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Extract org_id from various sources
  const orgId =
    request.params.org_id || // URL param
    request.headers["x-org-id"] || // Header
    request.user?.orgId; // JWT claim

  if (!orgId) {
    // Some routes don't require org context (health, github webhooks)
    return;
  }

  // Validate UUID format
  if (!isValidUUID(orgId)) {
    return reply.status(400).send({
      error: "Bad Request",
      message: "Invalid organization ID format",
    });
  }

  // Load organization from database
  const org = await loadOrganization(orgId);
  if (!org) {
    return reply.status(404).send({
      error: "Not Found",
      message: "Organization not found",
    });
  }

  // Set context on request
  request.setOrgContext({
    orgId: org.id,
    plan: org.plan,
    settings: org.settings,
  });

  // Set RLS context for database queries
  await setOrgContext(orgId);
}
```

---

## Rate Limiting (`rate-limit.ts`)

### Two-Tier Rate Limiting

1. **Global**: 100 requests/minute per org/IP (Fastify plugin)
2. **Resource-specific**: Per-resource quotas based on plan

### Resource Rate Limiter

```typescript
export function createRateLimitMiddleware(options: {
  resource: "events" | "rca_jobs" | "llm_tokens" | "github_api";
  windowMs?: number;
}): FastifyPreHandler {
  return async (request, reply) => {
    const orgId = request.getOrgId();
    if (!orgId) {
      request.log.warn({ resource }, "Rate limit skipped: missing org context");
      return;
    }

    const plan = request.orgContext?.plan || "free";
    const limits = RATE_LIMITS[plan];
    const maxAllowed = getMaxForResource(limits, options.resource);

    // Get current usage from Redis
    const currentUsage = await redis.getCurrentUsage(orgId, options.resource);

    if (currentUsage >= maxAllowed) {
      return reply.status(429).send({
        error: "Rate Limit Exceeded",
        message: "Quota exceeded for this resource",
        resource: options.resource,
        limit: maxAllowed,
        retryAfter: getRetryAfter(options.resource),
      });
    }

    // Increment counter
    await redis.incrementUsage(orgId, options.resource);
  };
}
```

### Limits Configuration

```typescript
// src/utils/rate-limits.ts
export const RATE_LIMITS = {
  free: {
    events_per_hour: 100,
    rca_jobs_per_day: 50,
    llm_tokens_per_day: 100_000,
    github_api_calls_per_hour: 500,
  },
  pro: {
    events_per_hour: 1_000,
    rca_jobs_per_day: 500,
    llm_tokens_per_day: 1_000_000,
    github_api_calls_per_hour: 2_000,
  },
  enterprise: {
    events_per_hour: 10_000,
    rca_jobs_per_day: 5_000,
    llm_tokens_per_day: 10_000_000,
    github_api_calls_per_hour: 5_000,
  },
};
```

---

## Health Endpoints (`health.ts`)

### `/health`

Basic liveness check.

```typescript
server.get("/health", async () => ({
  status: "healthy",
  timestamp: new Date().toISOString(),
}));
```

### `/ready`

Readiness check with dependency verification.

```typescript
server.get("/ready", async () => {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
  };

  const allOk = Object.values(checks).every((c) => c === "ok");

  return {
    status: allOk ? "ready" : "not ready",
    checks,
  };
});

async function checkDatabase(): Promise<"ok" | "error"> {
  try {
    await pool.query("SELECT 1");
    return "ok";
  } catch {
    return "error";
  }
}

async function checkRedis(): Promise<"ok" | "error"> {
  try {
    await redis.ping();
    return "ok";
  } catch {
    return "error";
  }
}
```

---

## Error Handling

### Global Error Handler

```typescript
server.setErrorHandler((error, request, reply) => {
  request.log.error({ error }, "Request error");

  // Known error types
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: "Validation Error",
      details: error.format(),
    });
  }

  if (error instanceof UnauthorizedError) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: error.message,
    });
  }

  // Generic server error
  return reply.status(500).send({
    error: "Internal Server Error",
    message:
      config.NODE_ENV === "development" ? error.message : "An error occurred",
  });
});
```

---

## Testing

### Unit Tests

```typescript
// tests/unit/health.test.ts
describe("Health endpoints", () => {
  it("returns healthy status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "healthy" });
  });
});
```

### Integration Tests

```typescript
// tests/integration/sentry-webhook.test.ts
describe("Sentry webhook", () => {
  it("stores valid event", async () => {
    const payload = createValidSentryPayload();
    const signature = generateHMAC(payload, TEST_SECRET);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/webhooks/sentry/${TEST_ORG_ID}`,
      headers: {
        "sentry-hook-signature": signature,
        "content-type": "application/json",
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "received",
      event_id: expect.any(String),
    });
  });

  it("rejects invalid signature", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/webhooks/sentry/${TEST_ORG_ID}`,
      headers: {
        "sentry-hook-signature": "invalid",
      },
      payload: {},
    });

    expect(response.statusCode).toBe(401);
  });
});
```

---

## Security Considerations

1. **HMAC Verification**: All webhooks verified with timing-safe comparison
2. **Rate Limiting**: Global + per-resource limits prevent abuse
3. **Input Validation**: Zod schemas validate all payloads
4. **RLS Context**: Database queries scoped to organization
5. **No Secret Logging**: Debug logs redact sensitive values
6. **CORS**: Explicit origins in production
# 02 - Extraction Pipeline

## Overview

The Extraction Pipeline is a 3-stage hybrid system that extracts repository, commit, and stack frame information from Sentry error events. It follows a **deterministic-first** philosophy: rule-based extraction runs first, LLM assists only when needed, and all results are validated against actual GitHub data.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      EXTRACTION PIPELINE                                 │
│                                                                          │
│  Input: Sentry Event Payload                                            │
│         ─────────────────────                                           │
│         • exception.values[]                                            │
│         • contexts (github, app)                                        │
│         • tags (repo, commit, branch)                                   │
│         • release (e.g., "org/repo@sha")                                │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    STAGE 1: DETERMINISTIC                          │ │
│  │                                                                    │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │ │
│  │  │ Release Parser   │  │ Context Extractor│  │ Tag Extractor   │  │ │
│  │  │ org/repo@sha     │  │ contexts.github  │  │ tags.repo       │  │ │
│  │  │ repo#branch      │  │ contexts.app     │  │ tags.commit     │  │ │
│  │  └──────────────────┘  └──────────────────┘  └─────────────────┘  │ │
│  │                                                                    │ │
│  │  ┌──────────────────┐  ┌──────────────────────────────────────┐   │ │
│  │  │ Frame Classifier │  │ Path Patterns                        │   │ │
│  │  │ user_code        │  │ • /app/src/ → user_code              │   │ │
│  │  │ third_party      │  │ • node_modules/ → third_party        │   │ │
│  │  │ framework        │  │ • internal/ → runtime                │   │ │
│  │  └──────────────────┘  └──────────────────────────────────────┘   │ │
│  │                                                                    │ │
│  │  Output: { repo?, commit?, branch?, frames[], confidence }        │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              │                                           │
│                    Is result complete?                                   │
│                     (repo AND commit present)                            │
│                              │                                           │
│              ┌───────────────┴───────────────┐                          │
│             Yes                              No                          │
│              │                                │                          │
│              ▼                                ▼                          │
│         Skip Stage 2                   ┌────────────────────────────────┐│
│              │                         │     STAGE 2: LLM ASSIST       ││
│              │                         │                                ││
│              │                         │  ┌─────────────────────────┐   ││
│              │                         │  │  Python Bridge          │   ││
│              │                         │  │  llm_assist_extractor   │   ││
│              │                         │  └───────────┬─────────────┘   ││
│              │                         │              │                 ││
│              │                         │  ┌───────────▼─────────────┐   ││
│              │                         │  │  GPT-4o-mini / DeepSeek │   ││
│              │                         │  │  temperature=0.1        │   ││
│              │                         │  │  json_object mode       │   ││
│              │                         │  └─────────────────────────┘   ││
│              │                         │                                ││
│              │                         │  RESTRICTED CAPABILITIES:      ││
│              │                         │  ✓ Clean stacktrace noise      ││
│              │                         │  ✓ Classify frames             ││
│              │                         │  ✓ Identify root frame         ││
│              │                         │  ✓ Infer branch from paths     ││
│              │                         │  ✗ Invent repo/commit data     ││
│              │                         └────────────────────────────────┘│
│              │                                │                          │
│              └────────────────┬───────────────┘                          │
│                               │                                          │
│                               ▼                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    STAGE 3: VALIDATION                             │ │
│  │                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────┐ │ │
│  │  │                    GitHub API Checks                         │ │ │
│  │  │  • checkRefExists(repo, commit) → verify commit SHA exists   │ │ │
│  │  │  • checkRefExists(repo, branch) → verify branch exists       │ │ │
│  │  │  • Fallback to default branch if ref missing                 │ │ │
│  │  └──────────────────────────────────────────────────────────────┘ │ │
│  │                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────┐ │ │
│  │  │                    Schema Validation                         │ │ │
│  │  │  • repo format: "owner/repo"                                 │ │ │
│  │  │  • commit format: 40-char hex                                │ │ │
│  │  │  • frames: valid file paths                                  │ │ │
│  │  └──────────────────────────────────────────────────────────────┘ │ │
│  │                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────┐ │ │
│  │  │                    Confidence Scoring                        │ │ │
│  │  │  • deterministic extraction: +0.3                            │ │ │
│  │  │  • LLM assist used: +0.2                                     │ │ │
│  │  │  • GitHub validation passed: +0.3                            │ │ │
│  │  │  • Final score: 0.0 - 1.0                                    │ │ │
│  │  └──────────────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Output: ExtractionResult                                               │
│          ────────────────────                                           │
│          • repo: string                                                 │
│          • commit_sha: string | undefined                               │
│          • branch: string | undefined                                   │
│          • frames: ExtractedFrame[]                                     │
│          • primary_frame_index: number                                  │
│          • extraction_source: 'deterministic' | 'llm_assisted'          │
│          • confidence: number                                           │
│          • validation_status: 'verified' | 'fallback' | 'failed'        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                                                      | Purpose                          |
| --------------------------------------------------------- | -------------------------------- |
| `src/services/event-extractor/extraction-pipeline.ts`     | Main orchestrator                |
| `src/services/event-extractor/deterministic-extractor.ts` | Stage 1 pure functions           |
| `src/services/event-extractor/llm-assist-extractor.ts`    | Stage 2 Node.js interface        |
| `src/services/event-extractor/extraction-validator.ts`    | Stage 3 validation               |
| `src/services/event-extractor/index.ts`                   | Module exports                   |
| `python/extractors/llm_assist_extractor.py`               | Stage 2 Python implementation    |
| `src/types/extraction.ts`                                 | Type definitions and Zod schemas |

---

## Stage 1: Deterministic Extraction

### Purpose

Extract repository, commit, and frame information using rule-based pattern matching. No AI involved - 100% reproducible.

### Extraction Sources (Priority Order)

1. **Release Tag** - Most reliable
2. **Sentry Contexts** - `contexts.github`, `contexts.app`
3. **Sentry Tags** - `tags.repo`, `tags.commit`
4. **Stack Frame Paths** - Last resort

### Release Tag Parsing

```typescript
// Pattern: "owner/repo@commit" or "owner/repo#branch"
const RELEASE_PATTERNS = [
  // owner/repo@sha (e.g., "acme/api@a1b2c3d4")
  /^(?<owner>[^/]+)\/(?<repo>[^@#]+)@(?<sha>[a-f0-9]{7,40})$/i,

  // owner/repo#branch (e.g., "acme/api#main")
  /^(?<owner>[^/]+)\/(?<repo>[^@#]+)#(?<branch>.+)$/i,

  // Just version with commit in separate field
  /^v?\d+\.\d+\.\d+(?:-(?<sha>[a-f0-9]{7,40}))?$/i,
];

export function extractFromRelease(release: string): {
  repo?: string;
  commitSha?: string;
  branch?: string;
} {
  for (const pattern of RELEASE_PATTERNS) {
    const match = release.match(pattern);
    if (match?.groups) {
      return {
        repo:
          match.groups.owner && match.groups.repo
            ? `${match.groups.owner}/${match.groups.repo}`
            : undefined,
        commitSha: match.groups.sha,
        branch: match.groups.branch,
      };
    }
  }
  return {};
}
```

### Context Extraction

```typescript
export function extractFromContexts(contexts: SentryContexts): {
  repo?: string;
  commitSha?: string;
  branch?: string;
} {
  // Check github context first (Sentry's GitHub integration)
  const github = contexts?.github;
  if (github) {
    return {
      repo: github.repository,
      commitSha: github.commit,
      branch: github.branch,
    };
  }

  // Fallback to generic app context
  const app = contexts?.app;
  if (app) {
    return {
      repo: app.repository || app.repo,
      commitSha: app.commit || app.sha || app.git_sha,
      branch: app.branch || app.git_branch,
    };
  }

  return {};
}
```

### Frame Classification

```typescript
type FrameClassification =
  | "user_code" // Application source code
  | "third_party" // node_modules, vendor
  | "framework" // React, Next.js, Express
  | "runtime" // Node.js internals
  | "polyfill" // core-js, regenerator
  | "unknown";

const CLASSIFICATION_PATTERNS: Record<FrameClassification, RegExp[]> = {
  user_code: [
    /^src\//,
    /^lib\//,
    /^app\//,
    /^pages\//,
    /^components\//,
    /^services\//,
  ],
  third_party: [/node_modules\//, /\.yarn\//, /\.pnpm\//],
  framework: [/react-dom\//, /next\/dist\//, /express\/lib\//, /fastify\//],
  runtime: [/^node:/, /^internal\//, /timers\.js$/, /events\.js$/],
  polyfill: [/core-js\//, /regenerator-runtime\//, /@babel\/runtime\//],
};

export function classifyFrame(frame: SentryStackFrame): FrameClassification {
  // Explicit in_app flag from Sentry
  if (frame.in_app === false) return "third_party";
  if (frame.in_app === true) return "user_code";

  const path = frame.filename || frame.abs_path || "";

  for (const [classification, patterns] of Object.entries(
    CLASSIFICATION_PATTERNS
  )) {
    if (patterns.some((p) => p.test(path))) {
      return classification as FrameClassification;
    }
  }

  return "unknown";
}
```

### Complete Deterministic Extractor

```typescript
export function extractDeterministic(event: SentryEventPayload): Stage1Result {
  // 1. Try release tag
  const fromRelease = event.release ? extractFromRelease(event.release) : {};

  // 2. Try contexts
  const fromContexts = extractFromContexts(event.contexts);

  // 3. Try tags
  const fromTags = extractFromTags(event.tags);

  // 4. Merge with priority (release > contexts > tags)
  const merged = {
    repo: fromRelease.repo || fromContexts.repo || fromTags.repo,
    commitSha:
      fromRelease.commitSha || fromContexts.commitSha || fromTags.commitSha,
    branch: fromRelease.branch || fromContexts.branch || fromTags.branch,
  };

  // 5. Extract and classify frames
  const frames = extractFrames(event.exception?.values || []);
  const classifiedFrames = frames.map((f) => ({
    ...f,
    classification: classifyFrame(f),
  }));

  // 6. Find primary (root cause) frame
  const primaryIndex = classifiedFrames.findIndex(
    (f) => f.classification === "user_code"
  );

  // 7. Determine if complete
  const isComplete = !!(merged.repo && (merged.commitSha || merged.branch));

  return {
    ...merged,
    frames: classifiedFrames,
    primaryFrameIndex: primaryIndex >= 0 ? primaryIndex : undefined,
    isComplete,
    confidence: calculateConfidence(merged, isComplete),
  };
}
```

---

## Stage 2: LLM-Assisted Extraction

### When Invoked

Stage 2 runs only when Stage 1 is **incomplete** (missing repo or commit/branch).

### Restricted Capabilities

The LLM can:

- ✅ Clean stacktrace noise (remove polyfills, bundler frames)
- ✅ Classify frames more accurately
- ✅ Identify the most likely root cause frame
- ✅ Infer branch name from file paths (e.g., `/feature-xyz/` → `feature-xyz`)

The LLM cannot:

- ❌ Invent repository names
- ❌ Generate commit SHAs
- ❌ Add data not present in the payload

### Node.js Interface

```typescript
// src/services/event-extractor/llm-assist-extractor.ts
export class LLMAssistExtractor {
  private pythonBridge: PythonBridge;

  constructor() {
    this.pythonBridge = new PythonBridge({
      module: "extractors.llm_assist_extractor",
      timeout: 30000, // 30s for LLM calls
    });
  }

  async extract(input: LLMAssistInput): Promise<LLMAssistOutput> {
    // Validate API key is configured
    if (!config.OPENAI_API_KEY) {
      return this.fallbackToDeterministic(input);
    }

    try {
      const result = await this.pythonBridge.execute<LLMAssistOutput>(input);
      return result;
    } catch (error) {
      logger.warn({ error }, "LLM assist failed, using deterministic fallback");
      return this.fallbackToDeterministic(input);
    }
  }
}
```

### Python Implementation

```python
# python/extractors/llm_assist_extractor.py

def get_llm_config() -> tuple[str, str, str | None]:
    """Get LLM configuration from environment."""
    provider = os.environ.get("LLM_PROVIDER", "openai").lower()
    base_url = os.environ.get("LLM_BASE_URL")

    if provider == "deepseek":
        default_model = "deepseek-chat"
        if not base_url:
            base_url = "https://api.deepseek.com"
    else:
        default_model = "gpt-4o-mini"

    model = os.environ.get("LLM_MODEL", default_model)
    return provider, model, base_url


def build_llm_prompt(input_data: LLMAssistInput) -> str:
    """Build prompt for frame classification."""
    frames_text = format_frames_for_prompt(input_data["raw_frames"])

    return f"""You are analyzing a JavaScript/TypeScript stack trace.

Error: {input_data['stage_1_output'].get('error_type', 'Unknown')}

TASKS:
- Remove vendor/runtime/polyfill frames that obscure the root cause
- Classify each frame as: user_code, third_party, runtime, framework, polyfill
- Identify the SINGLE frame most likely to be the root cause

STACK FRAMES:
{frames_text}

RULES:
1. User code is typically in: src/, lib/, app/, pages/, components/
2. The root cause frame is usually the FIRST user_code frame
3. You CANNOT invent repository or commit information

OUTPUT FORMAT (JSON):
{{
  "frame_classifications": [{{"index": 0, "classification": "..."}}],
  "primary_frame_index": <number or null>,
  "suggested_branch": "<inferred from paths or null>",
  "removed_indices": [<noise frame indices>],
  "reasoning": "<brief explanation>"
}}"""


def call_llm(prompt: str) -> tuple[dict, int, str]:
    """Call configured LLM provider."""
    client = get_openai_client()
    provider, model, _ = get_llm_config()

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a code analysis expert."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.1,  # Low for consistency
        max_tokens=1500,
        response_format={"type": "json_object"}
    )

    tokens_used = response.usage.total_tokens
    result = json.loads(response.choices[0].message.content)

    return result, tokens_used, model
```

### Token Tracking

```typescript
// After LLM call, track costs
await costTracker.trackExtraction({
  orgId,
  jobId,
  stage: "llm_assist",
  tokensUsed: result.tokens_used,
  model: result.model,
});
```

---

## Stage 3: Validation

### Purpose

Verify extracted data against actual GitHub repository to ensure:

1. Repository exists and is accessible
2. Commit SHA or branch exists
3. Apply fallbacks when validation fails

### Validation Flow

```typescript
export async function validateExtraction(
  input: ValidationInput,
  githubService: GitHubService
): Promise<ValidationResult> {
  const { repo, commitSha, branch, orgId } = input;

  // 1. Check repo format
  if (!isValidRepoFormat(repo)) {
    return {
      status: "failed",
      reason: "Invalid repository format",
      repo: undefined,
    };
  }

  // 2. Check if we have GitHub access
  const hasAccess = await githubService.hasRepoAccess(orgId, repo);
  if (!hasAccess) {
    return {
      status: "failed",
      reason: "No GitHub access to repository",
      repo,
    };
  }

  // 3. Verify commit exists
  if (commitSha) {
    const commitExists = await githubService.checkRefExists(
      orgId,
      repo,
      commitSha
    );
    if (commitExists) {
      return {
        status: "verified",
        repo,
        commitSha,
        branch,
      };
    }
    // Commit doesn't exist - fall through to branch check
  }

  // 4. Verify branch exists
  if (branch) {
    const branchExists = await githubService.checkRefExists(
      orgId,
      repo,
      branch
    );
    if (branchExists) {
      return {
        status: "verified",
        repo,
        branch,
        commitSha: undefined, // Couldn't verify commit
      };
    }
  }

  // 5. Fallback to default branch
  const defaultBranch = await githubService.getDefaultBranch(orgId, repo);
  return {
    status: "fallback",
    reason: "Using default branch",
    repo,
    branch: defaultBranch,
    commitSha: undefined,
  };
}
```

### GitHub Ref Verification

```typescript
// src/services/github.ts
export async function checkRefExists(
  orgId: string,
  repoFullName: string,
  ref: string
): Promise<boolean> {
  try {
    const octokit = await getInstallationOctokit(orgId);
    const [owner, repo] = repoFullName.split("/");

    // Try to get the commit for this ref
    await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref,
    });

    return true;
  } catch (error) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
}
```

### Confidence Scoring

```typescript
function calculateFinalConfidence(
  stage1: Stage1Result,
  stage2?: Stage2Result,
  validation: ValidationResult
): number {
  let confidence = 0;

  // Base confidence from deterministic extraction
  if (stage1.repo) confidence += 0.2;
  if (stage1.commitSha) confidence += 0.15;
  if (stage1.branch) confidence += 0.1;
  if (stage1.primaryFrameIndex !== undefined) confidence += 0.1;

  // LLM assist contribution
  if (stage2 && stage2.wasUsed) {
    confidence += stage2.confidence * 0.2;
  }

  // Validation bonus
  switch (validation.status) {
    case "verified":
      confidence += 0.3;
      break;
    case "fallback":
      confidence += 0.1;
      break;
    case "failed":
      confidence *= 0.5; // Penalty
      break;
  }

  return Math.min(1.0, confidence);
}
```

---

## Pipeline Orchestration

```typescript
// src/services/event-extractor/extraction-pipeline.ts
export class ExtractionPipeline {
  private deterministicExtractor: DeterministicExtractor;
  private llmAssistExtractor: LLMAssistExtractor;
  private validator: ExtractionValidator;

  async extract(
    event: SentryEventPayload,
    orgId: string
  ): Promise<ExtractionResult> {
    // STAGE 1: Deterministic
    const stage1 = this.deterministicExtractor.extract(event);

    let stage2: Stage2Result | undefined;

    // STAGE 2: LLM Assist (only if Stage 1 incomplete)
    if (!stage1.isComplete) {
      stage2 = await this.llmAssistExtractor.extract({
        stage_1_output: stage1,
        raw_frames: stage1.frames,
        tasks: this.determineNeededTasks(stage1),
      });
    }

    // Merge Stage 1 and Stage 2 results
    const merged = this.mergeResults(stage1, stage2);

    // STAGE 3: Validation
    const validation = await this.validator.validate({
      ...merged,
      orgId,
    });

    // Build final result
    return {
      repo: validation.repo || merged.repo,
      commitSha: validation.commitSha || merged.commitSha,
      branch: validation.branch || merged.branch,
      frames: merged.frames,
      primaryFrameIndex: merged.primaryFrameIndex,
      extractionSource: stage2?.wasUsed ? "llm_assisted" : "deterministic",
      confidence: calculateFinalConfidence(stage1, stage2, validation),
      validationStatus: validation.status,
      llmTokensUsed: stage2?.tokensUsed || 0,
    };
  }

  private determineNeededTasks(stage1: Stage1Result): string[] {
    const tasks: string[] = [];

    if (!stage1.branch) {
      tasks.push("infer_missing_branch");
    }
    if (stage1.frames.some((f) => f.classification === "unknown")) {
      tasks.push("classify_frames");
    }
    if (stage1.primaryFrameIndex === undefined) {
      tasks.push("identify_root_frame");
    }
    // Always clean noise
    tasks.push("clean_stacktrace_noise");

    return tasks;
  }
}
```

---

## Types

```typescript
// src/types/extraction.ts
import { z } from "zod";

export const extractedFrameSchema = z.object({
  file_path: z.string(),
  abs_path: z.string().optional(),
  line_number: z.number(),
  column_number: z.number().optional(),
  function_name: z.string().optional(),
  classification: z.enum([
    "user_code",
    "third_party",
    "runtime",
    "framework",
    "polyfill",
    "unknown",
  ]),
  is_entry_point: z.boolean(),
  source_mapped: z.boolean(),
  context_line: z.string().optional(),
  in_app: z.boolean(),
});

export const extractionResultSchema = z.object({
  repo: z.string().optional(),
  commit_sha: z.string().optional(),
  branch: z.string().optional(),
  frames: z.array(extractedFrameSchema),
  primary_frame_index: z.number().optional(),
  extraction_source: z.enum(["deterministic", "llm_assisted"]),
  confidence: z.number().min(0).max(1),
  validation_status: z.enum(["verified", "fallback", "failed"]),
  llm_tokens_used: z.number().default(0),
});

export type ExtractedFrame = z.infer<typeof extractedFrameSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
```

---

## Database Storage

Extraction results are stored in the `rca_jobs` table:

```sql
ALTER TABLE rca_jobs ADD COLUMN extraction_result JSONB;

-- Indexes for querying extraction results
CREATE INDEX idx_rca_jobs_extraction_stage
  ON rca_jobs ((extraction_result->>'extraction_source'));

CREATE INDEX idx_rca_jobs_extraction_repo
  ON rca_jobs ((extraction_result->>'repo'));
```

---

## Testing

```typescript
describe("ExtractionPipeline", () => {
  describe("Stage 1: Deterministic", () => {
    it("extracts repo from release tag", () => {
      const event = createEvent({ release: "acme/api@abc123" });
      const result = extractDeterministic(event);

      expect(result.repo).toBe("acme/api");
      expect(result.commitSha).toBe("abc123");
      expect(result.isComplete).toBe(true);
    });

    it("classifies frames correctly", () => {
      const frames = [
        { filename: "src/app.ts", in_app: true },
        { filename: "node_modules/lodash/index.js", in_app: false },
      ];

      const classified = frames.map(classifyFrame);
      expect(classified[0]).toBe("user_code");
      expect(classified[1]).toBe("third_party");
    });
  });

  describe("Stage 2: LLM Assist", () => {
    it("skips when Stage 1 is complete", async () => {
      const stage1 = { repo: "org/repo", commitSha: "abc", isComplete: true };
      const pipeline = new ExtractionPipeline();

      const result = await pipeline.extract(event, orgId);
      expect(result.extractionSource).toBe("deterministic");
      expect(result.llmTokensUsed).toBe(0);
    });
  });

  describe("Stage 3: Validation", () => {
    it("verifies commit exists on GitHub", async () => {
      mockGitHub.checkRefExists.mockResolvedValue(true);

      const result = await validator.validate({
        repo: "org/repo",
        commitSha: "abc123",
        orgId,
      });

      expect(result.status).toBe("verified");
    });

    it("falls back to default branch when commit missing", async () => {
      mockGitHub.checkRefExists.mockResolvedValue(false);
      mockGitHub.getDefaultBranch.mockResolvedValue("main");

      const result = await validator.validate({
        repo: "org/repo",
        commitSha: "invalid",
        orgId,
      });

      expect(result.status).toBe("fallback");
      expect(result.branch).toBe("main");
    });
  });
});
```

---

## Error Handling

### Stage 2 Failures

If LLM assist fails, the pipeline falls back to Stage 1 results:

```typescript
try {
  stage2 = await this.llmAssistExtractor.extract(input);
} catch (error) {
  logger.warn({ error, orgId, jobId }, "LLM assist failed");
  // Continue with Stage 1 results only
  stage2 = undefined;
}
```

### Validation Failures

If GitHub validation fails entirely, the pipeline still returns a result:

```typescript
if (validation.status === "failed") {
  return {
    ...merged,
    validationStatus: "failed",
    confidence: merged.confidence * 0.5, // Reduced confidence
    warnings: ["Could not verify repository access"],
  };
}
```

---

---

## Field Naming, Nullability, and Breadcrumb/Timeline Logic (Audit Alignment)

### Field Naming Consistency

- All error and extraction types use `type`, `value`, and `message` fields to match Sentry and internal code.
- Stack frame and extraction result types use `commit_sha`, `branch`, and `repo` (not `commitSha`, `errorType`, etc.).
- Example:
  ```typescript
  interface ExtractionResult {
    repo?: string;
    commit_sha?: string | null;
    branch?: string | null;
    frames: ExtractedFrame[];
    primary_frame_index?: number;
    extraction_source: "deterministic" | "llm_assisted";
    confidence: number;
    validation_status: "verified" | "fallback" | "failed";
    llm_tokens_used: number;
  }
  ```

### Nullable vs Optional Fields

- All fields that may be missing from Sentry or GitHub are marked as `?` (optional) and/or `| null` (nullable) in type tables and code examples.
- This matches the Zod schemas and runtime validation in code.

### Breadcrumb/Timeline Extraction

- Breadcrumbs are extracted from `eventData.breadcrumbs` and passed to the timeline reconstructor.
- Timeline events are sorted by timestamp, normalized to a `TimelineEvent` type, and filtered to a relevant window (e.g., 1 minute before error).
- Timeline fields: `timestamp`, `category`, `message`, `level`, `data`, `relative_ms`.
- Only events within the relevant window are included in the final timeline for RCA.

### Confidence Scoring

- Confidence is computed as a sum of deterministic extraction (+0.3), LLM assist (+0.2), and GitHub validation (+0.3), normalized to [0, 1].
- The scoring rubric is documented above and matches the code implementation.

---
# 03 - Code Fetcher

## Overview

The Code Fetcher is responsible for retrieving source code from GitHub repositories for stack trace analysis. It implements a **3-tier caching strategy** to minimize GitHub API calls and avoid rate limiting.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CODE FETCHER                                        │
│                                                                              │
│  Input: StackFrame { file_path, line_number, repo, commit_sha }             │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         3-TIER CACHE                                   │ │
│  │                                                                        │ │
│  │   ┌─────────────────────────────────────────────────────────────────┐ │ │
│  │   │  TIER 1: REDIS (Hot Cache)                                      │ │ │
│  │   │  ─────────────────────────                                      │ │ │
│  │   │  • TTL: 1 hour                                                  │ │ │
│  │   │  • Key: gh:file:{org}:{repo}:{sha}:{path}                       │ │ │
│  │   │  • Latency: ~1ms                                                │ │ │
│  │   │  • For: Recently accessed files                                 │ │ │
│  │   │                                                                 │ │ │
│  │   │  ┌─── HIT ──▶ Return immediately                               │ │ │
│  │   │  │                                                              │ │ │
│  │   │  └─── MISS ─▶ Continue to Tier 2                               │ │ │
│  │   └─────────────────────────────────────────────────────────────────┘ │ │
│  │                              │                                         │ │
│  │                              ▼                                         │ │
│  │   ┌─────────────────────────────────────────────────────────────────┐ │ │
│  │   │  TIER 2: S3 (Warm Cache)                                        │ │ │
│  │   │  ──────────────────────                                         │ │ │
│  │   │  • TTL: 7 days                                                  │ │ │
│  │   │  • Path: cache/github/{org}/{repo}/{sha}/{path}.gz              │ │ │
│  │   │  • Compression: gzip                                            │ │ │
│  │   │  • Latency: ~50-100ms                                           │ │ │
│  │   │  • For: Cross-instance sharing, persistence                     │ │ │
│  │   │                                                                 │ │ │
│  │   │  ┌─── HIT ──▶ Populate Redis ──▶ Return                        │ │ │
│  │   │  │                                                              │ │ │
│  │   │  └─── MISS ─▶ Continue to Tier 3                               │ │ │
│  │   └─────────────────────────────────────────────────────────────────┘ │ │
│  │                              │                                         │ │
│  │                              ▼                                         │ │
│  │   ┌─────────────────────────────────────────────────────────────────┐ │ │
│  │   │  TIER 3: DATABASE (code_snapshots table)                        │ │ │
│  │   │  ─────────────────────────────────────                          │ │ │
│  │   │  • TTL: Indefinite (commit-based)                               │ │ │
│  │   │  • Latency: ~5-20ms                                             │ │ │
│  │   │  • For: Permanent storage by commit SHA                         │ │ │
│  │   │                                                                 │ │ │
│  │   │  ┌─── HIT ──▶ Populate S3 + Redis ──▶ Return                   │ │ │
│  │   │  │                                                              │ │ │
│  │   │  └─── MISS ─▶ Continue to GitHub API                           │ │ │
│  │   └─────────────────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                              │                                               │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                       GITHUB API (Last Resort)                         │ │
│  │                                                                        │ │
│  │  • Rate limit: 5000/hour per installation                             │ │
│  │  • Endpoint: GET /repos/{owner}/{repo}/contents/{path}?ref={sha}      │ │
│  │  • Response: Base64 encoded content                                   │ │
│  │                                                                        │ │
│  │  ┌─── SUCCESS ──▶ Populate ALL caches ──▶ Return                      │ │
│  │  │                                                                    │ │
│  │  └─── ERROR ──▶ Return error or source map fallback                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  Output: { content: string, source: 'redis'|'s3'|'database'|'github' }      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                           | Purpose                     |
| ------------------------------ | --------------------------- |
| `src/services/code-fetcher.ts` | Main code fetcher service   |
| `src/services/cache.ts`        | 3-tier cache implementation |
| `src/services/github.ts`       | GitHub API integration      |
| `src/types/github.ts`          | Type definitions            |

---

## Code Fetcher Service

### Class Structure

```typescript
// src/services/code-fetcher.ts
export class CodeFetcher {
  private cache: CacheService;
  private github: GitHubService;

  constructor(deps?: { cache?: CacheService; github?: GitHubService }) {
    this.cache = deps?.cache ?? new CacheService();
    this.github = deps?.github ?? new GitHubService();
  }

  async fetchCodeForFrame(params: FetchParams): Promise<CodeFetchResult> {
    const { orgId, repo, commitSha, filePath } = params;

    // Validate and clean file path
    const cleanedPath = this.cleanFilePath(filePath);
    this.validateFilePath(cleanedPath);

    // Try 3-tier cache
    const cached = await this.cache.get(orgId, repo, commitSha, cleanedPath);
    if (cached) {
      return { content: cached.content, source: cached.source, cached: true };
    }

    // Fetch from GitHub
    const content = await this.fetchFromGitHub(
      orgId,
      repo,
      commitSha,
      cleanedPath
    );

    // Store in all cache tiers
    await this.cache.store(orgId, repo, commitSha, cleanedPath, content);

    return { content, source: "github", cached: false };
  }
}
```

### File Path Cleaning

Stack traces often contain non-standard paths that need normalization:

```typescript
private cleanFilePath(rawPath: string): string {
  let path = rawPath;

  // 1. Remove webpack:// prefix
  path = path.replace(/^webpack:\/\/[^/]*\//, '');

  // 2. Remove file:// prefix
  path = path.replace(/^file:\/\//, '');

  // 3. Remove container paths
  const containerPatterns = [
    '/var/task/',          // AWS Lambda
    '/app/',               // Docker common
    '/home/runner/work/',  // GitHub Actions
    '/opt/nodejs/',        // Lambda layers
  ];
  for (const prefix of containerPatterns) {
    if (path.startsWith(prefix)) {
      path = path.slice(prefix.length);
      break;
    }
  }

  // 4. Normalize to repo-relative path
  const srcIndex = path.indexOf('src/');
  if (srcIndex > 0) {
    path = path.slice(srcIndex);
  }

  // 5. Remove leading slashes
  path = path.replace(/^\/+/, '');

  return path;
}
```

### Path Traversal Protection

```typescript
private readonly PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//, // ../
  /\.\.\\/, // ..\\
  /^\/etc\//i,
  /^\/var\//i,
  /^\/proc\//i,
  /\0/, // null bytes
];

private validateFilePath(filePath: string): void {
  for (const pattern of this.PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(filePath)) {
      logger.warn({ filePath }, 'Path traversal attempt detected');
      throw new Error('Invalid file path: potential path traversal');
    }
  }

  // Must be relative path
  if (filePath.startsWith('/')) {
    throw new Error('Absolute paths not allowed');
  }
}
```

---

## 3-Tier Cache Service

### Cache Key Structure

```typescript
// Redis key
const redisKey = `gh:file:${orgId}:${repo}:${sha}:${path}`;

// S3 path
const s3Path = `cache/github/${orgId}/${repo}/${sha}/${sanitizePath(path)}.gz`;

// Database query
const dbQuery = `
  SELECT content FROM code_snapshots
  WHERE org_id = $1 AND repo_full_name = $2 AND commit_sha = $3 AND file_path = $4
`;
```

### Implementation

```typescript
// src/services/cache.ts
export class CacheService {
  private redis: Redis;
  private s3: S3Client;

  async get(
    orgId: string,
    repo: string,
    sha: string,
    path: string
  ): Promise<CacheResult | null> {
    // Tier 1: Redis
    const redisKey = this.buildRedisKey(orgId, repo, sha, path);
    const redisResult = await this.redis.get(redisKey);
    if (redisResult) {
      return { content: redisResult, source: "redis" };
    }

    // Tier 2: S3
    const s3Result = await this.getFromS3(orgId, repo, sha, path);
    if (s3Result) {
      // Populate Redis
      await this.setRedis(redisKey, s3Result, 3600); // 1 hour
      return { content: s3Result, source: "s3" };
    }

    // Tier 3: Database
    const dbResult = await this.getFromDatabase(orgId, repo, sha, path);
    if (dbResult) {
      // Populate S3 and Redis
      await this.storeInS3(orgId, repo, sha, path, dbResult);
      await this.setRedis(redisKey, dbResult, 3600);
      return { content: dbResult, source: "database" };
    }

    return null;
  }

  async store(
    orgId: string,
    repo: string,
    sha: string,
    path: string,
    content: string
  ): Promise<void> {
    // Store in all tiers in parallel
    await Promise.all([
      this.setRedis(this.buildRedisKey(orgId, repo, sha, path), content, 3600),
      this.storeInS3(orgId, repo, sha, path, content),
      this.storeInDatabase(orgId, repo, sha, path, content),
    ]);
  }
}
```

### S3 Storage (Gzip Compressed)

```typescript
private async storeInS3(
  orgId: string,
  repo: string,
  sha: string,
  path: string,
  content: string
): Promise<void> {
  const s3Path = this.buildS3Path(orgId, repo, sha, path);

  // Compress content
  const compressed = await gzip(Buffer.from(content, 'utf-8'));

  await this.s3.send(new PutObjectCommand({
    Bucket: config.S3_BUCKET_NAME,
    Key: s3Path,
    Body: compressed,
    ContentEncoding: 'gzip',
    ContentType: 'text/plain',
    Metadata: {
      'x-buglens-org-id': orgId,
      'x-buglens-repo': repo,
      'x-buglens-sha': sha,
    },
  }));
}

private async getFromS3(
  orgId: string,
  repo: string,
  sha: string,
  path: string
): Promise<string | null> {
  const s3Path = this.buildS3Path(orgId, repo, sha, path);

  try {
    const response = await this.s3.send(new GetObjectCommand({
      Bucket: config.S3_BUCKET_NAME,
      Key: s3Path,
    }));

    const body = await response.Body?.transformToByteArray();
    if (!body) return null;

    // Decompress
    const decompressed = await gunzip(Buffer.from(body));
    return decompressed.toString('utf-8');
  } catch (error) {
    if (error.name === 'NoSuchKey') return null;
    throw error;
  }
}
```

### Database Storage

```typescript
private async storeInDatabase(
  orgId: string,
  repo: string,
  sha: string,
  path: string,
  content: string
): Promise<void> {
  await pool.query(`
    INSERT INTO code_snapshots (org_id, repo_full_name, commit_sha, file_path, content)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (org_id, repo_full_name, commit_sha, file_path)
    DO UPDATE SET content = $5, updated_at = NOW()
  `, [orgId, repo, sha, path, content]);
}
```

---

## Source Map Resolution

When the fetched file is minified, we attempt to resolve the original source:

```typescript
import { SourceMapConsumer } from "source-map";

export class CodeFetcher {
  async fetchWithSourceMap(params: FetchParams): Promise<CodeFetchResult> {
    const result = await this.fetchCodeForFrame(params);

    // Check if content looks minified
    if (!this.looksMinified(result.content)) {
      return result;
    }

    // Try to fetch source map
    const mapPath = `${params.filePath}.map`;
    try {
      const mapResult = await this.fetchCodeForFrame({
        ...params,
        filePath: mapPath,
      });

      const consumer = await new SourceMapConsumer(mapResult.content);

      // Map to original position
      const original = consumer.originalPositionFor({
        line: params.lineNumber,
        column: params.columnNumber || 0,
      });

      if (original.source) {
        // Fetch the original source
        const originalResult = await this.fetchCodeForFrame({
          ...params,
          filePath: original.source,
        });

        return {
          ...originalResult,
          sourceMapped: true,
          originalLine: original.line,
          originalColumn: original.column,
        };
      }
    } catch (error) {
      logger.debug({ error, path: mapPath }, "Source map resolution failed");
    }

    return result;
  }

  private looksMinified(content: string): boolean {
    const lines = content.split("\n");

    // Minified files typically have very long lines
    const avgLineLength = content.length / lines.length;
    if (avgLineLength > 500) return true;

    // Very few lines for large content
    if (content.length > 10000 && lines.length < 50) return true;

    return false;
  }
}
```

---

## GitHub API Integration

### Fetching File Content

```typescript
private async fetchFromGitHub(
  orgId: string,
  repo: string,
  sha: string,
  path: string
): Promise<string> {
  const octokit = await this.github.getInstallationOctokit(orgId);
  const [owner, repoName] = repo.split('/');

  // Check rate limit before request
  await this.github.checkRateLimit(orgId);

  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo: repoName,
      path,
      ref: sha,
    });

    // Track API call for rate limiting
    await this.github.trackApiCall(orgId);

    if (Array.isArray(response.data)) {
      throw new Error('Path is a directory, not a file');
    }

    if (response.data.type !== 'file') {
      throw new Error(`Unexpected content type: ${response.data.type}`);
    }

    // Decode base64 content
    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
    return content;
  } catch (error) {
    if (error.status === 404) {
      throw new FileNotFoundError(path, repo, sha);
    }
    if (error.status === 403 && error.message.includes('rate limit')) {
      throw new RateLimitError(orgId);
    }
    throw error;
  }
}
```

### Rate Limit Handling

```typescript
async checkRateLimit(orgId: string): Promise<void> {
  const usage = await redis.get(`gh:ratelimit:${orgId}`);
  const plan = await this.getOrgPlan(orgId);
  const limit = RATE_LIMITS[plan].github_api_calls_per_hour;

  if (usage && parseInt(usage) >= limit) {
    throw new RateLimitError(
      `GitHub API rate limit exceeded (${usage}/${limit} calls/hour)`
    );
  }
}

async trackApiCall(orgId: string): Promise<void> {
  const key = `gh:ratelimit:${orgId}`;
  const count = await redis.incr(key);

  // Set expiry on first increment
  if (count === 1) {
    await redis.expire(key, 3600); // 1 hour
  }
}
```

---

## Batch Fetching

For efficiency, we support fetching multiple files in parallel:

```typescript
async fetchBatch(frames: StackFrame[], orgId: string): Promise<Map<string, CodeFetchResult>> {
  const results = new Map<string, CodeFetchResult>();

  // Deduplicate by unique file path
  const uniqueFrames = this.deduplicateFrames(frames);

  // Fetch in parallel with concurrency limit
  const limit = pLimit(5); // Max 5 concurrent requests

  await Promise.all(
    uniqueFrames.map(frame =>
      limit(async () => {
        try {
          const result = await this.fetchCodeForFrame({
            orgId,
            repo: frame.repo,
            commitSha: frame.commitSha,
            filePath: frame.filePath,
            lineNumber: frame.lineNumber,
          });
          results.set(this.frameKey(frame), result);
        } catch (error) {
          logger.warn({ error, frame }, 'Failed to fetch code for frame');
          results.set(this.frameKey(frame), {
            content: null,
            error: error.message,
            cached: false,
          });
        }
      })
    )
  );

  return results;
}
```

---

## Types

```typescript
// src/types/github.ts
export interface FetchParams {
  orgId: string;
  repo: string;
  commitSha: string;
  filePath: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface CodeFetchResult {
  content: string | null;
  source: "redis" | "s3" | "database" | "github";
  cached: boolean;
  sourceMapped?: boolean;
  originalLine?: number;
  originalColumn?: number;
  error?: string;
  fetchDurationMs?: number;
}

export interface CacheResult {
  content: string;
  source: "redis" | "s3" | "database";
}

// Custom errors
export class FileNotFoundError extends Error {
  constructor(
    public readonly path: string,
    public readonly repo: string,
    public readonly sha: string
  ) {
    super(`File not found: ${path} in ${repo}@${sha}`);
    this.name = "FileNotFoundError";
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}
```

---

## Metrics & Monitoring

### Cache Hit Rate

```typescript
async trackCacheMetrics(orgId: string, hit: boolean, tier: string): Promise<void> {
  const date = new Date().toISOString().split('T')[0];
  const key = `cache:metrics:${orgId}:${date}`;

  await redis.hincrby(key, 'total', 1);
  if (hit) {
    await redis.hincrby(key, `hits:${tier}`, 1);
  } else {
    await redis.hincrby(key, 'misses', 1);
  }
}

// Expected: >80% cache hit rate
async getCacheHitRate(orgId: string): Promise<number> {
  const date = new Date().toISOString().split('T')[0];
  const metrics = await redis.hgetall(`cache:metrics:${orgId}:${date}`);

  const total = parseInt(metrics.total || '0');
  const hits = parseInt(metrics['hits:redis'] || '0') +
               parseInt(metrics['hits:s3'] || '0') +
               parseInt(metrics['hits:database'] || '0');

  return total > 0 ? hits / total : 0;
}
```

---

## Testing

```typescript
describe("CodeFetcher", () => {
  describe("cleanFilePath", () => {
    it("removes webpack prefix", () => {
      const fetcher = new CodeFetcher();
      expect(fetcher.cleanFilePath("webpack://myapp/src/index.ts")).toBe(
        "src/index.ts"
      );
    });

    it("removes container paths", () => {
      const fetcher = new CodeFetcher();
      expect(fetcher.cleanFilePath("/var/task/src/handler.ts")).toBe(
        "src/handler.ts"
      );
    });
  });

  describe("validateFilePath", () => {
    it("rejects path traversal", () => {
      const fetcher = new CodeFetcher();
      expect(() => fetcher.validateFilePath("../../../etc/passwd")).toThrow(
        "potential path traversal"
      );
    });
  });

  describe("3-tier cache", () => {
    it("returns from Redis on hit", async () => {
      mockRedis.get.mockResolvedValue("cached content");

      const result = await cache.get(orgId, repo, sha, path);

      expect(result).toEqual({
        content: "cached content",
        source: "redis",
      });
      expect(mockS3.send).not.toHaveBeenCalled();
    });

    it("populates Redis after S3 hit", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockS3.send.mockResolvedValue({ Body: gzippedContent });

      await cache.get(orgId, repo, sha, path);

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.any(String),
        "decompressed content",
        "EX",
        3600
      );
    });
  });
});
```

---

## Performance Considerations

1. **Cache warming**: On first error from a repo, consider pre-fetching common files
2. **Compression**: S3 storage uses gzip to reduce storage costs and transfer time
3. **Batch requests**: Fetch multiple frames in parallel with concurrency limits
4. **Source map caching**: Cache resolved source maps separately from minified files
5. **TTL strategy**:
   - Redis: 1 hour (memory is expensive)
   - S3: 7 days (storage is cheap)
   - Database: Indefinite (commit SHA is immutable)
# 06 - Evidence Assembly

## Overview

The Evidence Assembly subsystem collects, correlates, and packages all available evidence for Root Cause Analysis. It acts as the bridge between raw data collection (Sentry events, GitHub code, logs) and the LLM reasoning layer.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EVIDENCE ASSEMBLY                                     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      DATA SOURCES                                       │ │
│  │                                                                         │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │ │
│  │  │   Sentry    │ │   GitHub    │ │  Breadcrumb │ │   Commit    │       │ │
│  │  │   Event     │ │    Code     │ │    Logs     │ │   History   │       │ │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘       │ │
│  │         │               │               │               │              │ │
│  │         └───────────────┴───────────────┴───────────────┘              │ │
│  │                                   │                                     │ │
│  └───────────────────────────────────┼─────────────────────────────────────┘ │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    EVIDENCE COLLECTOR                                   │ │
│  │                                                                         │ │
│  │  ┌────────────────────────────────────────────────────────────────┐    │ │
│  │  │  1. extractErrorInfo()     - Parse error metadata              │    │ │
│  │  │  2. buildCodeContext()     - Assemble relevant code snippets   │    │ │
│  │  │  3. reconstructTimeline()  - Order breadcrumbs chronologically │    │ │
│  │  │  4. getRecentCommits()     - Fetch git history for context     │    │ │
│  │  │  5. calculateConfidence()  - Score evidence completeness       │    │ │
│  │  └────────────────────────────────────────────────────────────────┘    │ │
│  │                                                                         │ │
│  └─────────────────────────────────────┬───────────────────────────────────┘ │
│                                        │                                     │
│                                        ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      EVIDENCE BUNDLE                                    │ │
│  │                                                                         │ │
│  │  EvidenceBundle {                                                        │ │
│  │    bundle_id: UUID,                                                      │ │
│  │    created_at: ISO timestamp,                                            │ │
│  │    org_id: UUID,                                                         │ │
│  │    event_id: UUID,                                                       │ │
│  │    job_id: UUID,                                                         │ │
│  │                                                                          │ │
│  │    error: {                                                              │ │
│  │      message: string,                                                    │ │
│  │      type: string,                                                       │ │
│  │      value?: string,                                                     │ │
│  │      stack_trace: [                                                      │ │
│  │        { file, line, column, function, in_app }                          │ │
│  │      ],                                                                  │ │
│  │      tags?: Record<string, string>,                                      │ │
│  │      fingerprint?: string[],                                             │ │
│  │      timestamp?: string,                                                 │ │
│  │    },                                                                    │ │
│  │                                                                          │ │
│  │    code: {                                                               │ │
│  │      primary: CodeContext | null, // main error location                 │ │
│  │      related: CodeContext[], // other stack frames                       │ │
│  │      repo: string,                                                       │ │
│  │      commit_sha: string | null,                                          │ │
│  │    },                                                                    │ │
│  │                                                                          │ │
│  │    deterministic_findings: DeterministicFinding[],                       │ │
│  │                                                                          │ │
│  │    timeline: Timeline | null,                                            │ │
│  │    recent_commits: CommitInfo[],                                         │ │
│  │    environment: EnvironmentContext,                                      │ │
│  │                                                                          │ │
│  │    metadata: {                                                           │ │
│  │      sentry_event_id: string,                                            │ │
│  │      processing_started_at: string,                                      │ │
│  │      code_fetch_source: "github" | "redis_cache" | "s3_cache" | "embedded" | null,
│  │      source_map_used: boolean,                                           │ │
│  │      validation_passed: boolean,                                         │ │
│  │      validation_errors?: string[],                                       │ │
│  │    },                                                                    │ │
│  │  }                                                                      │ │
│  │                                                                         │ │
│  │  Stored in: S3 (gzipped) + Postgres (metadata)                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                                  | Purpose                          |
| ------------------------------------- | -------------------------------- |
| `src/services/evidence-collector.ts`  | Main evidence collection service |
| `src/services/evidence-transforms.ts` | Pure transformation functions    |
| `python/timeline/reconstructor.py`    | Timeline reconstruction logic    |
| `python/evidence/bundle_builder.py`   | Evidence packaging for LLM       |

---

## Evidence Collector Service

### Service Flow (src/services/evidence-collector.ts)

The `EvidenceCollectorService` orchestrates evidence assembly for each RCA job. It uses pure functions for all stateless transforms and delegates I/O to service methods. The process:

1. **Extract error info** from the event payload (`extractErrorInfo`).
2. **Build code context** from fetched code (`buildCodeContext`).
3. **Fetch recent commits** for the error file (`fetchRecentCommits`).
4. **Reconstruct timeline** from breadcrumbs (`reconstructTimeline`).
5. **Extract environment context** (`extractEnvironmentContext`).
6. **Extract deterministic findings** from analyzer result (`extractDeterministicFindings`).
7. **Determine code fetch source** for cache metrics (`determineCodeFetchSource`).
8. **Assemble EvidenceBundle** and validate against schema.

All stateless transforms are pure functions in `evidence-transforms.ts`. The final bundle is validated with Zod (`evidenceBundleSchema`).

**Note:** The field `deterministic_findings` is the canonical output of the deterministic analyzer (AST rules, pattern matching, etc). There is no longer an `astFindings` or `findings` field—use `deterministic_findings` throughout.

**Confidence scoring** is handled by `calculateEvidenceConfidence` (see below).
private readonly github: GitHubService;
private readonly pythonBridge: PythonBridge;

constructor(
deps: {
codeFetcher?: CodeFetcherService;
github?: GitHubService;
pythonBridge?: PythonBridge;
} = {}
) {
this.codeFetcher = deps.codeFetcher ?? new CodeFetcherService();
this.github = deps.github ?? new GitHubService();
this.pythonBridge =
deps.pythonBridge ??
new PythonBridge({
module: "timeline.reconstructor",
});
}

async collect(params: CollectEvidenceParams): Promise<EvidenceBundle> {
const { eventId, orgId, eventData, repo, ref } = params;

    // 1. Extract error info (pure function)
    const errorInfo = extractErrorInfo(eventData);

    // 2. Fetch code for each stack frame
    const codeResults = await this.fetchCodeForStackTrace(
      orgId,
      repo,
      ref,
      errorInfo.stack_trace
    );

    // 3. Build code context (pure function)
    const codeContext = buildCodeContext(codeResults);

    // 4. Run AST analysis on fetched code
    const astFindings = await this.runASTAnalysis(codeResults, errorInfo);

    // 5. Reconstruct timeline from breadcrumbs
    const timeline = await this.reconstructTimeline(
      eventData.breadcrumbs || []
    );

    // 6. Get recent commits for context
    const commits = await this.getRecentCommits(
      orgId,
      repo,
      errorInfo.stack_trace[0]?.file
    );

    // 7. Calculate metadata (pure function)
    const metadata = calculateEvidenceConfidence({
      errorInfo,
      codeContext,
      timeline,
      commits,
      astFindings,
    });

    return {
      errorInfo,
      codeContext,
      timeline,
      commits,
      astFindings,
      metadata,
    };

}

private async fetchCodeForStackTrace(
orgId: string,
repo: string,
ref: string,
stackTrace: StackFrame[]
): Promise<CodeFetchResult[]> {
// Fetch code for top N frames (configurable)
const maxFrames = config.EVIDENCE_MAX_FRAMES || 5;
const framesToFetch = stackTrace
.filter((frame) => frame.in_app !== false)
.slice(0, maxFrames);

    const results = await Promise.all(
      framesToFetch.map((frame) =>
        this.codeFetcher
          .fetchWithContext({
            orgId,
            repo,
            ref,
            filePath: frame.file,
            lineNumber: frame.line,
            contextLines: 15,
          })
          .catch((error) => ({
            frame,
            error: error.message,
            code: null,
          }))
      )
    );

    return results;

}

private async runASTAnalysis(
codeResults: CodeFetchResult[],
errorInfo: ErrorInfo
): Promise<ASTFinding[]> {
const allFindings: ASTFinding[] = [];

    for (const result of codeResults) {
      if (!result.code) continue;

      try {
        const analysisResult = await this.pythonBridge.analyze({
          sourceCode: result.code.fullFile,
          errorMessage: errorInfo.message,
          errorType: errorInfo.type,
          filePath: result.frame.file,
          lineNumber: result.frame.line,
        });

        allFindings.push(...analysisResult.findings);
      } catch (error) {
        logger.warn(
          {
            error,
            file: result.frame.file,
          },
          "AST analysis failed for file"
        );
      }
    }

    // Sort by confidence and dedupe
    return allFindings.sort((a, b) => b.confidence - a.confidence).slice(0, 10); // Top 10 findings

}

private async reconstructTimeline(
breadcrumbs: Breadcrumb[]
): Promise<Timeline> {
if (breadcrumbs.length === 0) {
return { events: [], duration_ms: 0 };
}

    // Use Python for complex timeline reconstruction
    const result = await this.pythonBridge.call("reconstruct_timeline", {
      breadcrumbs,
    });

    return result;

}

private async getRecentCommits(
orgId: string,
repo: string,
filePath?: string
): Promise<CommitInfo[]> {
try {
const commits = await this.github.getRecentCommits(
orgId,
repo,
filePath,
10 // Last 10 commits
);

      return commits.map(transformCommit);
    } catch (error) {
      logger.warn({ error, repo }, "Failed to fetch commits");
      return [];
    }

}
}

````

---


## Evidence Transforms (Pure Functions)

```typescript
// src/services/evidence-transforms.ts

/**
 * Extract structured error information from Sentry event.
 * @pure - output depends only on input
 */
export function extractErrorInfo(eventData: SentryEvent): ErrorInfo {
  const rawPayload = eventData.raw_payload as Record<string, unknown>;
  const exception = rawPayload?.exception as ExceptionData | undefined;
  const firstException = exception?.values?.[0];

  return {
    message: eventData.message || firstException?.value || "Unknown error",
    type: firstException?.type || "Error",
    value: firstException?.value || eventData.message || "",
    stack_trace: transformStackFrames(firstException?.stacktrace?.frames || []),
    tags: eventData.tags || {},
    fingerprint: eventData.fingerprint,
    timestamp: eventData.timestamp,
  };
}

/**
 * Transform raw stack frames to normalized format.
 * @pure
 */
export function transformStackFrames(frames: RawStackFrame[]): StackFrame[] {
  return frames
    .filter((frame) => frame.filename) // Must have filename
    .map((frame) => ({
      file: cleanFilePath(frame.filename),
      line: frame.lineno,
      column: frame.colno,
      function: frame.function || "<anonymous>",
      context_line: frame.context_line,
      pre_context: frame.pre_context || [],
      post_context: frame.post_context || [],
      in_app: frame.in_app ?? isUserCode(frame.filename),
    }))
    .reverse(); // Sentry sends oldest first, we want newest first
}

/**
 * Clean and normalize file path.
 * @pure
 */
export function cleanFilePath(rawPath: string): string {
  let path = rawPath;

  // Remove webpack prefixes
  path = path.replace(/^webpack:\/\/[^/]+\//, "");
  path = path.replace(/^\[project\]\//, "");

  // Remove query strings
  path = path.split("?")[0];

  // Normalize node_modules paths
  path = path.replace(/.*node_modules\//, "node_modules/");

  return path;
}

/**
 * Determine if file is user code (not third-party).
 * @pure
 */
export function isUserCode(filePath: string): boolean {
  const thirdPartyPatterns = [
    /node_modules/,
    /\.next\/static/,
    /__webpack__/,
    /vendor\//,
    /polyfill/,
  ];

  return !thirdPartyPatterns.some((pattern) => pattern.test(filePath));
}

/**
 * Build code context from fetched code results.
 * @pure
 */
export function buildCodeContext(results: CodeFetchResult[]): CodeContext {
  const frames: CodeContextFrame[] = [];

  for (const result of results) {
    if (!result.code) {
      frames.push({
        file: result.frame.file,
        error: result.error || "Code not available",
        snippet: null,
      });
      continue;
    }

    frames.push({
      file: result.frame.file,
      line: result.frame.line,
      snippet: result.code.snippet,
      full_file: result.code.fullFile,
      highlighted_line: result.code.highlightedLine,
      language: detectLanguage(result.frame.file),
    });
  }

  return {
    frames,
    files_fetched: results.length,
    files_available: results.filter((r) => r.code).length,
  };
}

/**
 * Transform GitHub commit to simplified format.
 * @pure
 */
export function transformCommit(commit: GitHubCommit): CommitInfo {
  return {
    sha: commit.sha,
    short_sha: commit.sha.substring(0, 7),
    message: commit.message.split("\n")[0], // First line only
    author: commit.author,
    date: commit.date,
    files_changed: commit.files?.length || 0,
  };
}


### Confidence Scoring

The confidence score for an evidence bundle is computed by `calculateEvidenceConfidence` (pure function). The scoring rubric is:

- **Error info:** up to 25 points (message + stack trace)
- **Code context:** up to 30 points (files available)
- **Deterministic findings:** up to 25 points (high-confidence findings)
- **Timeline:** up to 10 points (breadcrumb events)
- **Commits:** up to 10 points (recent commit context)

Gaps are recorded for missing evidence. The final confidence is normalized to [0, 1]. If confidence < 0.7, the bundle may be flagged for human review.

See `calculateEvidenceConfidence` in `src/services/evidence-transforms.ts` for details.

/**
 * Detect programming language from file extension.
 * @pure
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rb: "ruby",
    go: "go",
    java: "java",
  };
  return langMap[ext || ""] || "unknown";
}
````

---

## Timeline Reconstruction (Python)

```python
# python/timeline/reconstructor.py
"""
Timeline reconstruction from Sentry breadcrumbs.

All functions are PURE - output depends only on input.
"""
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from datetime import datetime


@dataclass
class TimelineEvent:
    """A single event in the reconstructed timeline."""
    timestamp: str
    category: str
    message: str
    level: str
    data: Dict[str, Any]
    relative_ms: int  # Milliseconds before error


@dataclass
class Timeline:
    """Reconstructed timeline with events."""
    events: List[TimelineEvent]
    duration_ms: int
    error_timestamp: str


def reconstruct_timeline(
    breadcrumbs: List[Dict[str, Any]],
    error_timestamp: Optional[str] = None,
) -> Timeline:
    """
    Reconstruct chronological timeline from breadcrumbs.

    @pure - output depends only on inputs
    """
    if not breadcrumbs:
        return Timeline(events=[], duration_ms=0, error_timestamp='')

    # Sort by timestamp
    sorted_crumbs = sorted(
        breadcrumbs,
        key=lambda b: b.get('timestamp', ''),
    )

    # Determine error timestamp (last event or provided)
    if error_timestamp:
        error_ts = _parse_timestamp(error_timestamp)
    else:
        error_ts = _parse_timestamp(sorted_crumbs[-1].get('timestamp', ''))

    # Transform to timeline events
    events = []
    for crumb in sorted_crumbs:
        event = _transform_breadcrumb(crumb, error_ts)
        if event:
            events.append(event)

    # Calculate duration
    if events:
        duration_ms = abs(events[0].relative_ms - events[-1].relative_ms)
    else:
        duration_ms = 0

    return Timeline(
        events=events,
        duration_ms=duration_ms,
        error_timestamp=error_ts.isoformat() if error_ts else '',
    )


def _transform_breadcrumb(
    crumb: Dict[str, Any],
    error_ts: Optional[datetime],
) -> Optional[TimelineEvent]:
    """Transform single breadcrumb to timeline event."""
    timestamp_str = crumb.get('timestamp', '')
    if not timestamp_str:
        return None

    crumb_ts = _parse_timestamp(timestamp_str)

    # Calculate relative time (negative = before error)
    if crumb_ts and error_ts:
        relative_ms = int((crumb_ts - error_ts).total_seconds() * 1000)
    else:
        relative_ms = 0

    return TimelineEvent(
        timestamp=timestamp_str,
        category=crumb.get('category', 'default'),
        message=_extract_message(crumb),
        level=crumb.get('level', 'info'),
        data=crumb.get('data', {}),
        relative_ms=relative_ms,
    )


def _extract_message(crumb: Dict[str, Any]) -> str:
    """Extract human-readable message from breadcrumb."""
    # Direct message
    if crumb.get('message'):
        return crumb['message']

    # HTTP request
    if crumb.get('category') == 'http':
        method = crumb.get('data', {}).get('method', 'GET')
        url = crumb.get('data', {}).get('url', '')
        status = crumb.get('data', {}).get('status_code', '')
        return f"{method} {url} → {status}"

    # Console log
    if crumb.get('category') == 'console':
        return crumb.get('data', {}).get('message', '')

    # Navigation
    if crumb.get('category') == 'navigation':
        to_url = crumb.get('data', {}).get('to', '')
        return f"Navigate to {to_url}"

    # Click
    if crumb.get('category') == 'ui.click':
        target = crumb.get('message', '') or crumb.get('data', {}).get('target', '')
        return f"Click: {target}"

    # Default: use category
    return crumb.get('category', 'Event')


def _parse_timestamp(ts: str) -> Optional[datetime]:
    """Parse timestamp string to datetime."""
    if not ts:
        return None

    try:
        # ISO format
        if 'T' in ts:
            return datetime.fromisoformat(ts.replace('Z', '+00:00'))
        # Unix timestamp
        if ts.isdigit():
            return datetime.fromtimestamp(int(ts))
        # Float timestamp
        return datetime.fromtimestamp(float(ts))
    except (ValueError, TypeError):
        return None


def filter_relevant_events(
    timeline: Timeline,
    error_message: str,
    window_ms: int = 60000,  # 1 minute before error
) -> Timeline:
    """
    Filter timeline to events likely relevant to error.

    @pure
    """
    relevant = []

    for event in timeline.events:
        # Within time window
        if event.relative_ms < -window_ms:
            continue

        # High-signal categories
        if event.category in ('error', 'exception', 'http', 'fetch'):
            relevant.append(event)
            continue

        # Console errors/warnings
        if event.category == 'console' and event.level in ('error', 'warning'):
            relevant.append(event)
            continue

        # Failed HTTP requests
        if event.category == 'http':
            status = event.data.get('status_code', 200)
            if status >= 400:
                relevant.append(event)
                continue

    return Timeline(
        events=relevant,
        duration_ms=timeline.duration_ms,
        error_timestamp=timeline.error_timestamp,
    )


def summarize_timeline(timeline: Timeline) -> str:
    """
    Create human-readable timeline summary.

    @pure
    """
    if not timeline.events:
        return "No timeline events available."

    lines = []

    # Group by category
    by_category: Dict[str, List[TimelineEvent]] = {}
    for event in timeline.events:
        cat = event.category
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(event)

    lines.append(f"Timeline: {len(timeline.events)} events over {timeline.duration_ms}ms")
    lines.append("")

    for category, events in by_category.items():
        lines.append(f"[{category}] {len(events)} events:")
        for event in events[-3:]:  # Last 3 per category
            relative = _format_relative_time(event.relative_ms)
            lines.append(f"  {relative}: {event.message}")

    return '\n'.join(lines)


def _format_relative_time(ms: int) -> str:
    """Format relative time as human-readable string."""
    if ms == 0:
        return "at error"
    if ms > 0:
        return f"+{ms}ms"

    abs_ms = abs(ms)
    if abs_ms < 1000:
        return f"-{abs_ms}ms"
    if abs_ms < 60000:
        return f"-{abs_ms // 1000}s"
    return f"-{abs_ms // 60000}m"
```

---

## Evidence Storage

### S3 Storage (Evidence Bundles)

```typescript
// src/services/evidence-storage.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export class EvidenceStorageService {
  private s3: S3Client;
  private bucket: string;

  constructor() {
    this.s3 = new S3Client({ region: config.AWS_REGION });
    this.bucket = config.S3_EVIDENCE_BUCKET;
  }

  async store(
    orgId: string,
    eventId: string,
    bundle: EvidenceBundle
  ): Promise<string> {
    const key = `evidence/${orgId}/${eventId}.json.gz`;

    // Compress
    const json = JSON.stringify(bundle);
    const compressed = await gzipAsync(json);

    // Store
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: compressed,
        ContentType: "application/json",
        ContentEncoding: "gzip",
        Metadata: {
          "x-org-id": orgId,
          "x-event-id": eventId,
          "x-confidence": String(bundle.metadata.confidence),
        },
      })
    );

    // Also store metadata in Postgres for querying
    await this.storeMetadata(orgId, eventId, bundle.metadata);

    return key;
  }

  async retrieve(
    orgId: string,
    eventId: string
  ): Promise<EvidenceBundle | null> {
    const key = `evidence/${orgId}/${eventId}.json.gz`;

    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      const compressed = await response.Body?.transformToByteArray();
      if (!compressed) return null;

      const json = await gunzipAsync(Buffer.from(compressed));
      return JSON.parse(json.toString());
    } catch (error) {
      if (error.name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }

  private async storeMetadata(
    orgId: string,
    eventId: string,
    metadata: EvidenceMetadata
  ): Promise<void> {
    await pool.query(
      `
      INSERT INTO evidence_metadata (
        org_id, event_id, confidence, completeness,
        has_code, has_ast, has_timeline, has_commits, gaps
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (org_id, event_id) DO UPDATE SET
        confidence = EXCLUDED.confidence,
        completeness = EXCLUDED.completeness,
        updated_at = NOW()
    `,
      [
        orgId,
        eventId,
        metadata.confidence,
        metadata.completeness,
        metadata.sources.code,
        metadata.sources.ast,
        metadata.sources.timeline,
        metadata.sources.commits,
        metadata.gaps,
      ]
    );
  }
}
```

---

## Types

```typescript
// src/types/evidence.ts
export interface ErrorInfo {
  message: string;
  type: string;
  value: string;
  stack_trace: StackFrame[];
  tags: Record<string, string>;
  fingerprint?: string;
  timestamp: string;
}

export interface StackFrame {
  file: string;
  line: number;
  column?: number;
  function: string;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  in_app: boolean;
}

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

export interface CommitInfo {
  sha: string;
  short_sha: string;
  message: string;
  author: string;
  date: string;
  files_changed: number;
}

export interface ASTFinding {
  rule_id: string;
  title: string;
  severity: "high" | "medium" | "low";
  confidence: number;
  message: string;
  line_start: number;
  line_end: number;
  code_snippet: string;
  suggested_fix?: string;
}

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

export interface EvidenceBundle {
  errorInfo: ErrorInfo;
  codeContext: CodeContext;
  timeline: Timeline;
  commits: CommitInfo[];
  astFindings: ASTFinding[];
  metadata: EvidenceMetadata;
}
```

---

## Testing

```typescript
// tests/unit/evidence-transforms.test.ts
import { describe, it, expect } from "vitest";
import {
  extractErrorInfo,
  transformStackFrames,
  cleanFilePath,
  calculateEvidenceConfidence,
} from "../../src/services/evidence-transforms";

describe("extractErrorInfo", () => {
  it("extracts error info from Sentry event", () => {
    const event = {
      message: "Test error",
      raw_payload: {
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Cannot read property x of undefined",
              stacktrace: {
                frames: [{ filename: "app.js", lineno: 10, function: "test" }],
              },
            },
          ],
        },
      },
    };

    const info = extractErrorInfo(event as any);

    expect(info.type).toBe("TypeError");
    expect(info.value).toContain("Cannot read property");
    expect(info.stack_trace).toHaveLength(1);
  });
});

describe("cleanFilePath", () => {
  it("removes webpack prefixes", () => {
    expect(cleanFilePath("webpack://app/src/index.js")).toBe("src/index.js");
    expect(cleanFilePath("[project]/src/app.ts")).toBe("src/app.ts");
  });

  it("normalizes node_modules paths", () => {
    expect(cleanFilePath("/app/node_modules/lodash/index.js")).toBe(
      "node_modules/lodash/index.js"
    );
  });
});

describe("calculateEvidenceConfidence", () => {
  it("returns high confidence with complete evidence", () => {
    const bundle = {
      errorInfo: { message: "Error", stack_trace: [{ file: "a.js" }] },
      codeContext: { files_available: 3 },
      astFindings: [{ confidence: 0.9 }],
      timeline: { events: [{}] },
      commits: [{}],
    };

    const metadata = calculateEvidenceConfidence(bundle as any);

    expect(metadata.confidence).toBeGreaterThan(0.7);
    expect(metadata.gaps).toHaveLength(0);
  });

  it("identifies gaps when data missing", () => {
    const bundle = {
      errorInfo: { message: "Error" },
    };

    const metadata = calculateEvidenceConfidence(bundle as any);

    expect(metadata.confidence).toBeLessThan(0.3);
    expect(metadata.gaps).toContain("No source code available");
  });
});
```
# 05 - Python Analysis Engine

## Overview

The Python Analysis Engine provides deterministic code analysis using AST (Abstract Syntax Tree) parsing with tree-sitter. This is **Layer 1** of Buglens' analysis - the ground truth that cannot be hallucinated. LLM enhancement (Layer 2) only explains what deterministic analysis finds.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PYTHON ANALYSIS ENGINE                                │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      ANALYSIS PIPELINE                                  │ │
│  │                                                                         │ │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐ │ │
│  │  │   Source    │    │    Parse    │    │   Pattern   │    │  Rule    │ │ │
│  │  │    Code     │───▶│    AST      │───▶│   Matcher   │───▶│  Engine  │ │ │
│  │  └─────────────┘    └─────────────┘    └─────────────┘    └──────────┘ │ │
│  │                                                                │        │ │
│  │                                                                ▼        │ │
│  │                                                         ┌──────────┐   │ │
│  │                                                         │ Findings │   │ │
│  │                                                         └──────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                       TREE-SITTER PARSERS                               │ │
│  │                                                                         │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │ │
│  │  │  JavaScript  │  │  TypeScript  │  │    Python    │  │    JSX     │  │ │
│  │  │    Parser    │  │    Parser    │  │    Parser    │  │   Parser   │  │ │
│  │  │ tree-sitter- │  │ tree-sitter- │  │ tree-sitter- │  │ tree-sitter│  │ │
│  │  │  javascript  │  │  typescript  │  │    python    │  │    -tsx    │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘  │ │
│  │                                                                         │ │
│  │  Phase 1 (MVP): JavaScript + TypeScript                                │ │
│  │  Phase 2:       Python                                                  │ │
│  │  Phase 3:       Go, Java, Ruby                                          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        RULE CATEGORIES                                  │ │
│  │                                                                         │ │
│  │  Null/Undefined Access       │  Async/Promise Patterns                 │ │
│  │  • Optional chaining missing │  • Unhandled rejections                 │ │
│  │  • Null guard absent         │  • Missing await                        │ │
│  │  • Type narrowing needed     │  • Race conditions                      │ │
│  │                              │                                          │ │
│  │  Type Coercion Issues        │  Array/Object Operations                │ │
│  │  • Loose equality (==)       │  • Index out of bounds                  │ │
│  │  • Implicit conversions      │  • Missing property checks              │ │
│  │  • parseInt without radix    │  • Spread on undefined                  │ │
│  │                              │                                          │ │
│  │  Error Handling              │  AI-Generated Code Signatures           │ │
│  │  • Empty catch blocks        │  • Common ChatGPT patterns              │ │
│  │  • Swallowed errors          │  • Copilot-typical mistakes             │ │
│  │  • Missing finally           │  • LLM hallucination artifacts          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                                  | Purpose                                |
| ------------------------------------- | -------------------------------------- |
| `python/analyzers/js_analyzer.py`     | JavaScript/TypeScript analyzer (main)  |
| `python/analyzers/base.py`            | Core data structures and base types    |
| `python/analyzers/rules/`             | Individual rule implementations        |
| `python/utils/tree_sitter_utils.py`   | Tree-sitter helper functions (if any)  |

**Note**: There is no `ast_analyzer.py` or `pattern_matcher.py` - the implementation uses a functional paradigm with pure functions in `js_analyzer.py` and rule modules.

---

## Core Analyzer

### JavaScript/TypeScript Analyzer (js_analyzer.py)

The actual implementation uses a **functional paradigm** with pure functions, not an OOP `ASTAnalyzer` class. The analyzer exports a main `analyze` function that orchestrates rule evaluation.

```python
# python/analyzers/js_analyzer.py
from __future__ import annotations

import json
import sys
import time
from typing import Any, Dict, List

from tree_sitter import Language, Parser
from tree_sitter_javascript import language as javascript_language
from tree_sitter_typescript import language_typescript, language_tsx

from .base import AnalysisContext, CodeSegment, RuleFunction
from .rules import RULE_FUNCTIONS

SUPPORTED_LANGUAGES = {"javascript", "typescript", "tsx", "jsx"}
ANALYZER_NAME = "js_analyzer"
ANALYZER_VERSION = "1.0.0"


# Pure Functions for Analysis (Functional Paradigm)


def create_parser(language: str) -> Parser:
    """Pure factory function to create appropriate parser for language."""
    lang_lower = language.lower()
    if lang_lower in ("tsx", "jsx"):
        return Parser(Language(language_tsx()))
    elif lang_lower in ("typescript", "ts"):
        return Parser(Language(language_typescript()))
    return Parser(Language(javascript_language()))


def parse_code_segment(segment: CodeSegment) -> AnalysisContext:
    """Pure function to parse a code segment and create analysis context."""
    parser = create_parser(segment.language)
    tree = parser.parse(bytes(segment.content, "utf-8"))
    return AnalysisContext(segment, tree, {})


def extract_segments(payload: Dict[str, Any]) -> List[CodeSegment]:
    """Pure function to extract code segments from payload."""
    return [
        CodeSegment(
            file_path=segment.get("file_path", "unknown"),
            language=segment.get("language", "text"),
            content=segment.get("content", ""),
            error_line=int(segment.get("error_line", 1)),
            error_column=segment.get("error_column"),
        )
        for segment in payload.get("code_segments", [])
        if segment.get("language", "text").lower() in SUPPORTED_LANGUAGES
    ]


def apply_rules(context: AnalysisContext, rules: List[RuleFunction]) -> List[Dict[str, Any]]:
    """Pure function to apply all rules to a context and collect findings."""
    findings: List[Dict[str, Any]] = []
    for rule_fn in rules:
        findings.extend(rule_fn(context))
    return findings


def analyze_segment(segment: CodeSegment, rules: List[RuleFunction], metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Pure function to analyze a single code segment."""
    parser = create_parser(segment.language)
    tree = parser.parse(bytes(segment.content, "utf-8"))
    context = AnalysisContext(segment, tree, metadata)
    return apply_rules(context, rules)


def analyze(payload: Dict[str, Any], rules: List[RuleFunction] = RULE_FUNCTIONS) -> Dict[str, Any]:
    """
    Pure function to analyze a payload and return results.
    
    This is the main entry point for functional analysis.
    """
    start_time = time.time()

    segments = extract_segments(payload)
    findings: List[Dict[str, Any]] = []

    for segment in segments:
        findings.extend(analyze_segment(segment, rules, payload))

    runtime_ms = int((time.time() - start_time) * 1000)

    return {
        "analyzer": {
            "name": ANALYZER_NAME,
            "version": ANALYZER_VERSION,
        },
        "findings": findings,
        "segments_analyzed": len(segments),
        "total_findings": len(findings),
        "runtime_ms": runtime_ms,
    }
```

### Data Structures (base.py)

```python
# python/analyzers/base.py
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional


@dataclass
class CodeSegment:
    """A segment of code to analyze."""
    file_path: str
    language: str
    content: str
    error_line: int
    error_column: Optional[int] = None


@dataclass
class AnalysisContext:
    """Context passed to all rule evaluators."""
    segment: CodeSegment
    tree: Any  # tree-sitter Tree object
    metadata: Dict[str, Any]


# Type alias for rule functions
RuleFunction = Callable[[AnalysisContext], List[Dict[str, Any]]]
```
            else:
                raise ValueError(f"Unsupported language: {language}")

            parser = Parser(lang)
            self.parsers[language] = parser

        return self.parsers[language]

    def analyze(
        self,
        source_code: str,
        error_message: str,
        error_type: str,
        file_path: str,
        line_number: Optional[int] = None,
    ) -> List[Finding]:
        """
        Run all deterministic rules against source code.

        Returns findings sorted by confidence (highest first).
        """
        # Detect language from file extension
        language = self._detect_language(file_path)

        # Parse AST
        parser = self.get_parser(language)
        tree = parser.parse(source_code.encode('utf-8'))

        # Build context
        context = AnalysisContext(
            source_code=source_code,
            ast_tree=tree,
            error_message=error_message,
            error_type=error_type,
            file_path=file_path,
            language=language,
            line_number=line_number,
        )

        # Run all rules (functional)
        findings: List[Finding] = []
        for rule_fn in self.rules:
            rule_findings = rule_fn(context)
            findings.extend(rule_findings)

        # Sort by confidence, then severity
        severity_order = {'high': 0, 'medium': 1, 'low': 2}
        findings.sort(
            key=lambda f: (-f.confidence, severity_order.get(f.severity, 3))
        )

        return findings

    def _detect_language(self, file_path: str) -> str:
        """Detect language from file extension."""
        ext_map = {
            '.js': 'javascript',
            '.jsx': 'jsx',
            '.ts': 'typescript',
            '.tsx': 'tsx',
            '.mjs': 'javascript',
            '.cjs': 'javascript',
        }
        for ext, lang in ext_map.items():
            if file_path.endswith(ext):
                return lang
        return 'javascript'  # Default
```

---

## Rule Engine

### Rule Pattern (Functional)

```python
# python/analyzers/rules/null_access.py
"""
Null/undefined access detection rule.

All functions in this module are PURE - output depends only on input.
"""
import re
from typing import List, Dict, Any
from tree_sitter import Node

from ..ast_analyzer import AnalysisContext, Finding

# Constants for rule metadata
RULE_ID = "null-access"
RULE_TITLE = "Potential null/undefined property access"
RULE_SEVERITY = "high"
BASE_CONFIDENCE = 0.85

# Patterns that suggest null access errors
NULL_ACCESS_PATTERNS = [
    re.compile(r"Cannot read propert(?:y|ies) ['\"]?(\w+)['\"]? of (undefined|null)", re.I),
    re.compile(r"(\w+) is not defined", re.I),
    re.compile(r"undefined is not an object", re.I),
    re.compile(r"null is not an object", re.I),
    re.compile(r"TypeError: (\w+)\.(\w+) is not a function", re.I),
]


def evaluate_null_access(context: AnalysisContext) -> List[Finding]:
    """
    Detect potential null/undefined property access patterns.

    @pure - output depends only on input context
    """
    findings = []

    # Check if error message suggests null access
    property_name = _extract_property_from_error(context.error_message)
    if not property_name:
        return findings

    # Find member access expressions in AST
    member_accesses = _find_member_access_nodes(context.ast_tree.root_node)

    for node in member_accesses:
        # Check if this access matches the error
        if not _matches_error_property(node, property_name):
            continue

        # Check if access is unguarded
        if _is_unchecked_access(node, context.ast_tree.root_node):
            finding = _create_finding(node, property_name, context)
            findings.append(finding)

    return findings


def _extract_property_from_error(message: str) -> str | None:
    """Extract property name from error message."""
    for pattern in NULL_ACCESS_PATTERNS:
        match = pattern.search(message)
        if match:
            groups = match.groups()
            # Return the property name (varies by pattern)
            return groups[0] if groups else None
    return None


def _find_member_access_nodes(root: Node) -> List[Node]:
    """Find all member_expression nodes in AST."""
    nodes = []

    def traverse(node: Node):
        if node.type == 'member_expression':
            nodes.append(node)
        for child in node.children:
            traverse(child)

    traverse(root)
    return nodes


def _matches_error_property(node: Node, property_name: str) -> bool:
    """Check if member access matches the error property."""
    # Get property part of member expression (right side)
    property_node = node.child_by_field_name('property')
    if property_node and property_node.text:
        return property_node.text.decode('utf-8') == property_name
    return False


def _is_unchecked_access(node: Node, root: Node) -> bool:
    """
    Check if property access lacks null guard.

    Looks for:
    - Optional chaining (?.)
    - if (x !== null) checks
    - Nullish coalescing (??)
    """
    parent = node.parent

    # Check for optional chaining (already safe)
    if node.type == 'optional_chain_expression':
        return False

    # Check parent chain for guards
    while parent:
        # Inside if condition checking for null
        if parent.type == 'if_statement':
            condition = parent.child_by_field_name('condition')
            if condition and _is_null_check(condition, node):
                return False

        # Ternary with null check
        if parent.type == 'ternary_expression':
            condition = parent.child_by_field_name('condition')
            if condition and _is_null_check(condition, node):
                return False

        # Logical AND short-circuit (x && x.prop)
        if parent.type == 'binary_expression':
            operator = parent.child_by_field_name('operator')
            if operator and operator.text == b'&&':
                left = parent.child_by_field_name('left')
                if left and _references_same_object(left, node):
                    return False

        parent = parent.parent

    return True


def _is_null_check(condition: Node, access: Node) -> bool:
    """Check if condition is a null/undefined check for the accessed object."""
    # Look for patterns like: x !== null, x != null, x !== undefined
    condition_text = condition.text.decode('utf-8') if condition.text else ''

    object_node = access.child_by_field_name('object')
    if not object_node or not object_node.text:
        return False

    object_name = object_node.text.decode('utf-8')

    null_check_patterns = [
        f'{object_name} !== null',
        f'{object_name} !== undefined',
        f'{object_name} != null',
        f'{object_name}',  # Truthy check
    ]

    return any(pattern in condition_text for pattern in null_check_patterns)


def _references_same_object(node: Node, access: Node) -> bool:
    """Check if node references the same object as the member access."""
    object_node = access.child_by_field_name('object')
    if not object_node or not node.text or not object_node.text:
        return False
    return node.text == object_node.text


def _create_finding(
    node: Node,
    property_name: str,
    context: AnalysisContext
) -> Finding:
    """Create a Finding object from AST node."""
    # Get line info
    start_line = node.start_point[0] + 1
    end_line = node.end_point[0] + 1
    start_col = node.start_point[1]
    end_col = node.end_point[1]

    # Extract code snippet
    lines = context.source_code.split('\n')
    snippet_lines = lines[max(0, start_line-2):min(len(lines), end_line+1)]
    code_snippet = '\n'.join(snippet_lines)

    # Adjust confidence based on context
    confidence = BASE_CONFIDENCE
    if context.line_number and abs(context.line_number - start_line) <= 2:
        confidence = min(confidence + 0.1, 1.0)  # Boost if near error line

    return Finding(
        rule_id=RULE_ID,
        title=RULE_TITLE,
        severity=RULE_SEVERITY,
        confidence=confidence,
        message=f"Property '{property_name}' accessed without null check. The object may be null or undefined at runtime.",
        line_start=start_line,
        line_end=end_line,
        column_start=start_col,
        column_end=end_col,
        code_snippet=code_snippet,
        suggested_fix=_generate_fix(node, property_name, context),
        explanation=f"Add optional chaining (?.{property_name}) or a null check before accessing this property.",
    )


def _generate_fix(node: Node, property_name: str, context: AnalysisContext) -> str:
    """Generate suggested code fix."""
    if not node.text:
        return ''

    original = node.text.decode('utf-8')
    object_node = node.child_by_field_name('object')

    if object_node and object_node.text:
        object_name = object_node.text.decode('utf-8')
        return f"{object_name}?.{property_name}"

    return original.replace('.', '?.')
```

### Async Pattern Rule

```python
# python/analyzers/rules/async_patterns.py
"""
Async/Promise pattern detection rule.
"""
import re
from typing import List
from tree_sitter import Node

from ..ast_analyzer import AnalysisContext, Finding

RULE_ID = "async-patterns"
RULE_TITLE = "Async/Promise pattern issue"


def evaluate_async_patterns(context: AnalysisContext) -> List[Finding]:
    """Detect async/promise-related issues."""
    findings = []

    # Check for unhandled promise rejection patterns
    findings.extend(_find_unhandled_promises(context))

    # Check for missing await
    findings.extend(_find_missing_await(context))

    # Check for promise constructor anti-patterns
    findings.extend(_find_promise_constructor_issues(context))

    return findings


def _find_unhandled_promises(context: AnalysisContext) -> List[Finding]:
    """Find promises without .catch() or try/catch."""
    findings = []

    # Look for .then() without .catch()
    call_expressions = _find_nodes_by_type(context.ast_tree.root_node, 'call_expression')

    for node in call_expressions:
        # Check if it's a .then() call
        callee = node.child_by_field_name('function')
        if not callee or callee.type != 'member_expression':
            continue

        property_node = callee.child_by_field_name('property')
        if not property_node or property_node.text != b'then':
            continue

        # Check if there's a subsequent .catch()
        if not _has_catch_handler(node):
            findings.append(Finding(
                rule_id=RULE_ID,
                title="Unhandled Promise rejection",
                severity="medium",
                confidence=0.75,
                message="Promise chain has .then() without .catch(). Unhandled rejections crash Node.js processes.",
                line_start=node.start_point[0] + 1,
                line_end=node.end_point[0] + 1,
                column_start=node.start_point[1],
                column_end=node.end_point[1],
                code_snippet=_extract_snippet(context.source_code, node),
                suggested_fix="Add .catch(error => { /* handle error */ })",
            ))

    return findings


def _find_missing_await(context: AnalysisContext) -> List[Finding]:
    """Find async functions where await may be missing."""
    findings = []

    # Only check if error suggests async issue
    if not _suggests_async_error(context.error_message):
        return findings

    # Find all call expressions in async functions
    async_functions = _find_nodes_by_type(
        context.ast_tree.root_node,
        ['async_function', 'async_arrow_function', 'async_method_definition']
    )

    for async_fn in async_functions:
        # Find calls that might return promises but aren't awaited
        calls = _find_nodes_by_type(async_fn, 'call_expression')

        for call in calls:
            parent = call.parent

            # Check if call is awaited
            if parent and parent.type == 'await_expression':
                continue

            # Check if call looks like it returns a promise
            if _looks_like_async_call(call):
                findings.append(Finding(
                    rule_id=RULE_ID,
                    title="Possible missing await",
                    severity="medium",
                    confidence=0.6,
                    message="Function call may return a Promise but is not awaited. This could cause race conditions or unexpected behavior.",
                    line_start=call.start_point[0] + 1,
                    line_end=call.end_point[0] + 1,
                    column_start=call.start_point[1],
                    column_end=call.end_point[1],
                    code_snippet=_extract_snippet(context.source_code, call),
                    suggested_fix="Add 'await' before the function call",
                ))

    return findings


def _suggests_async_error(message: str) -> bool:
    """Check if error message suggests async issue."""
    async_patterns = [
        r"promise",
        r"async",
        r"await",
        r"undefined is not a function",
        r"\.then is not a function",
    ]
    message_lower = message.lower()
    return any(re.search(p, message_lower) for p in async_patterns)


def _looks_like_async_call(node: Node) -> bool:
    """Heuristic: does this call look like it returns a Promise?"""
    callee = node.child_by_field_name('function')
    if not callee:
        return False

    # Get function name
    name = ''
    if callee.type == 'identifier':
        name = callee.text.decode('utf-8') if callee.text else ''
    elif callee.type == 'member_expression':
        prop = callee.child_by_field_name('property')
        name = prop.text.decode('utf-8') if prop and prop.text else ''

    # Common async function patterns
    async_patterns = [
        'fetch', 'axios', 'request',
        'find', 'findOne', 'findById', 'save', 'create', 'update', 'delete',
        'query', 'execute', 'run',
        'read', 'write', 'readFile', 'writeFile',
        'send', 'post', 'get', 'put', 'patch',
    ]

    return any(p in name.lower() for p in async_patterns)


def _has_catch_handler(then_call: Node) -> bool:
    """Check if .then() is followed by .catch()."""
    parent = then_call.parent

    # Check if this .then() is the object of another member access
    if parent and parent.type == 'member_expression':
        grandparent = parent.parent
        if grandparent and grandparent.type == 'call_expression':
            # Check if the next method is .catch()
            property_node = parent.child_by_field_name('property')
            if property_node and property_node.text == b'catch':
                return True

    return False


def _find_nodes_by_type(root: Node, types) -> List[Node]:
    """Find all nodes of given type(s)."""
    if isinstance(types, str):
        types = [types]

    nodes = []

    def traverse(node: Node):
        if node.type in types:
            nodes.append(node)
        for child in node.children:
            traverse(child)

    traverse(root)
    return nodes


def _extract_snippet(source: str, node: Node, context_lines: int = 1) -> str:
    """Extract code snippet around node."""
    lines = source.split('\n')
    start = max(0, node.start_point[0] - context_lines)
    end = min(len(lines), node.end_point[0] + context_lines + 1)
    return '\n'.join(lines[start:end])
```

---

## AI-Generated Code Detection

```python
# python/analyzers/rules/ai_signatures.py
"""
Detection of common AI-generated code patterns and mistakes.

This is Buglens' competitive moat: catching bugs that LLMs commonly introduce.
"""
import re
from typing import List
from tree_sitter import Node

from ..ast_analyzer import AnalysisContext, Finding

RULE_ID = "ai-generated-pattern"
RULE_TITLE = "AI-generated code pattern"


# Patterns commonly introduced by LLMs
AI_CODE_PATTERNS = {
    # ChatGPT tends to use these placeholder patterns
    'placeholder_comments': [
        re.compile(r'// TODO: implement'),
        re.compile(r'// Add your code here'),
        re.compile(r'// Your implementation'),
        re.compile(r'// Handle error'),
        re.compile(r'// Process the data'),
    ],

    # Copilot common mistakes
    'incorrect_api_usage': [
        re.compile(r'\.map\s*\(\s*async'),  # async in map without Promise.all
        re.compile(r'JSON\.parse\([^)]+\)(?!\s*catch)'),  # unhandled parse errors
    ],

    # Generic LLM hallucinations
    'non_existent_apis': [
        'Array.prototype.flatMap',  # Before Node 11
        'Object.fromEntries',  # Before Node 12
        'Promise.allSettled',  # Before Node 12.9
    ],

    # Overly confident patterns (no error handling)
    'missing_validation': [
        re.compile(r'const\s+\{[^}]+\}\s*=\s*(?:req\.body|request\.body|data)\s*;?\s*$'),
    ],
}


def evaluate_ai_signatures(context: AnalysisContext) -> List[Finding]:
    """Detect patterns commonly produced by AI code generators."""
    findings = []

    # Check for placeholder comments (AI often leaves these)
    findings.extend(_find_placeholder_comments(context))

    # Check for async map without Promise.all
    findings.extend(_find_async_map_issues(context))

    # Check for unhandled JSON.parse
    findings.extend(_find_unhandled_json_parse(context))

    # Check for missing input validation
    findings.extend(_find_missing_validation(context))

    return findings


def _find_placeholder_comments(context: AnalysisContext) -> List[Finding]:
    """Find TODO/placeholder comments left by AI."""
    findings = []

    for i, line in enumerate(context.source_code.split('\n')):
        for pattern in AI_CODE_PATTERNS['placeholder_comments']:
            if pattern.search(line):
                findings.append(Finding(
                    rule_id=RULE_ID,
                    title="AI placeholder comment",
                    severity="low",
                    confidence=0.9,
                    message="This looks like a placeholder comment from AI-generated code. The actual implementation may be missing.",
                    line_start=i + 1,
                    line_end=i + 1,
                    column_start=0,
                    column_end=len(line),
                    code_snippet=line,
                    suggested_fix="Implement the actual logic or remove if not needed",
                ))

    return findings


def _find_async_map_issues(context: AnalysisContext) -> List[Finding]:
    """Find async callbacks in .map() without Promise.all."""
    findings = []

    # Find all .map() calls
    call_expressions = _find_nodes_by_type(context.ast_tree.root_node, 'call_expression')

    for call in call_expressions:
        callee = call.child_by_field_name('function')
        if not callee or callee.type != 'member_expression':
            continue

        prop = callee.child_by_field_name('property')
        if not prop or prop.text != b'map':
            continue

        # Check if callback is async
        arguments = call.child_by_field_name('arguments')
        if not arguments:
            continue

        for arg in arguments.children:
            if arg.type in ('arrow_function', 'function_expression'):
                # Check for async keyword
                if _is_async_function(arg):
                    # Check if wrapped in Promise.all
                    if not _wrapped_in_promise_all(call):
                        findings.append(Finding(
                            rule_id=RULE_ID,
                            title="Async map without Promise.all",
                            severity="high",
                            confidence=0.9,
                            message="Using async function in .map() without Promise.all() returns an array of promises, not resolved values. This is a common AI-generated code mistake.",
                            line_start=call.start_point[0] + 1,
                            line_end=call.end_point[0] + 1,
                            column_start=call.start_point[1],
                            column_end=call.end_point[1],
                            code_snippet=_extract_snippet(context.source_code, call),
                            suggested_fix="Wrap with Promise.all(): await Promise.all(items.map(async item => ...))",
                        ))

    return findings


def _find_unhandled_json_parse(context: AnalysisContext) -> List[Finding]:
    """Find JSON.parse without try/catch."""
    findings = []

    # Only check if error suggests parse issue
    if 'JSON' not in context.error_message and 'parse' not in context.error_message.lower():
        return findings

    call_expressions = _find_nodes_by_type(context.ast_tree.root_node, 'call_expression')

    for call in call_expressions:
        callee = call.child_by_field_name('function')
        if not callee or callee.type != 'member_expression':
            continue

        # Check for JSON.parse
        obj = callee.child_by_field_name('object')
        prop = callee.child_by_field_name('property')

        if not obj or not prop:
            continue

        if obj.text == b'JSON' and prop.text == b'parse':
            # Check if inside try block
            if not _is_inside_try_block(call):
                findings.append(Finding(
                    rule_id=RULE_ID,
                    title="Unhandled JSON.parse",
                    severity="medium",
                    confidence=0.85,
                    message="JSON.parse can throw on invalid JSON. AI-generated code often omits error handling.",
                    line_start=call.start_point[0] + 1,
                    line_end=call.end_point[0] + 1,
                    column_start=call.start_point[1],
                    column_end=call.end_point[1],
                    code_snippet=_extract_snippet(context.source_code, call),
                    suggested_fix="Wrap in try/catch: try { JSON.parse(str) } catch (e) { /* handle invalid JSON */ }",
                ))

    return findings


def _find_missing_validation(context: AnalysisContext) -> List[Finding]:
    """Find request body destructuring without validation."""
    findings = []

    # Look for object pattern in variable declarator with req.body
    variable_declarators = _find_nodes_by_type(
        context.ast_tree.root_node, 'variable_declarator'
    )

    for decl in variable_declarators:
        name = decl.child_by_field_name('name')
        value = decl.child_by_field_name('value')

        if not name or not value:
            continue

        # Check if destructuring from request body
        if name.type == 'object_pattern':
            value_text = value.text.decode('utf-8') if value.text else ''
            if any(pattern in value_text for pattern in ['req.body', 'request.body', 'ctx.body']):
                findings.append(Finding(
                    rule_id=RULE_ID,
                    title="Missing input validation",
                    severity="medium",
                    confidence=0.7,
                    message="Destructuring request body without validation. AI often generates code that trusts user input.",
                    line_start=decl.start_point[0] + 1,
                    line_end=decl.end_point[0] + 1,
                    column_start=decl.start_point[1],
                    column_end=decl.end_point[1],
                    code_snippet=_extract_snippet(context.source_code, decl),
                    suggested_fix="Add validation with Zod, Joi, or manual checks before using request data",
                ))

    return findings


def _is_async_function(node: Node) -> bool:
    """Check if function node is async."""
    # Check for 'async' keyword
    for child in node.children:
        if child.type == 'async':
            return True
    return False


def _wrapped_in_promise_all(map_call: Node) -> bool:
    """Check if .map() call is wrapped in Promise.all()."""
    parent = map_call.parent
    while parent:
        if parent.type == 'call_expression':
            callee = parent.child_by_field_name('function')
            if callee and callee.type == 'member_expression':
                obj = callee.child_by_field_name('object')
                prop = callee.child_by_field_name('property')
                if obj and prop:
                    if obj.text == b'Promise' and prop.text in (b'all', b'allSettled'):
                        return True
        parent = parent.parent
    return False


def _is_inside_try_block(node: Node) -> bool:
    """Check if node is inside a try block."""
    parent = node.parent
    while parent:
        if parent.type == 'try_statement':
            return True
        parent = parent.parent
    return False


def _find_nodes_by_type(root: Node, types) -> List[Node]:
    """Find all nodes of given type(s)."""
    if isinstance(types, str):
        types = [types]
    nodes = []
    def traverse(node: Node):
        if node.type in types:
            nodes.append(node)
        for child in node.children:
            traverse(child)
    traverse(root)
    return nodes


def _extract_snippet(source: str, node: Node, context_lines: int = 1) -> str:
    """Extract code snippet around node."""
    lines = source.split('\n')
    start = max(0, node.start_point[0] - context_lines)
    end = min(len(lines), node.end_point[0] + context_lines + 1)
    return '\n'.join(lines[start:end])
```

---

## Node.js Bridge

### Calling Python from Node.js

```typescript
// src/services/python-bridge.ts
import { spawn, ChildProcess } from "child_process";

export interface AnalysisRequest {
  sourceCode: string;
  errorMessage: string;
  errorType: string;
  filePath: string;
  lineNumber?: number;
}

export interface AnalysisResult {
  findings: Finding[];
  parseErrors?: string[];
  executionTimeMs: number;
}

export class PythonBridge {
  private pythonPath: string;
  private modulePath: string;

  constructor(options: { pythonPath?: string; modulePath?: string } = {}) {
    this.pythonPath = options.pythonPath || "python3";
    this.modulePath = options.modulePath || "./python";
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const process = spawn(
        this.pythonPath,
        ["-m", "analyzers.ast_analyzer", "--json"],
        {
          cwd: this.modulePath,
          env: { ...process.env, PYTHONPATH: this.modulePath },
        }
      );

      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      process.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      // Send request as JSON to stdin
      process.stdin.write(JSON.stringify(request));
      process.stdin.end();

      process.on("close", (code) => {
        const executionTimeMs = Date.now() - startTime;

        if (code !== 0) {
          reject(new Error(`Python analyzer failed: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve({
            ...result,
            executionTimeMs,
          });
        } catch (parseError) {
          reject(new Error(`Failed to parse Python output: ${stdout}`));
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        process.kill();
        reject(new Error("Python analyzer timeout"));
      }, 30000);
    });
  }
}
```

---

## Testing

```python
# tests/unit/test_null_access_rule.py
import pytest
from python.analyzers.ast_analyzer import ASTAnalyzer

@pytest.fixture
def analyzer():
    return ASTAnalyzer()

def test_detects_null_access_without_guard(analyzer):
    source = """
const user = await db.findUser(id);
console.log(user.name);  // No null check!
"""
    findings = analyzer.analyze(
        source_code=source,
        error_message="Cannot read property 'name' of undefined",
        error_type="TypeError",
        file_path="test.js",
        line_number=3,
    )

    assert len(findings) >= 1
    assert findings[0].rule_id == "null-access"
    assert findings[0].confidence >= 0.8

def test_ignores_optional_chaining(analyzer):
    source = """
const user = await db.findUser(id);
console.log(user?.name);  // Safe!
"""
    findings = analyzer.analyze(
        source_code=source,
        error_message="Cannot read property 'name' of undefined",
        error_type="TypeError",
        file_path="test.js",
    )

    # Should NOT find issues (optional chaining is safe)
    null_access_findings = [f for f in findings if f.rule_id == "null-access"]
    assert len(null_access_findings) == 0

def test_detects_async_map_without_promise_all(analyzer):
    source = """
const results = items.map(async item => {
    return await processItem(item);
});
"""
    findings = analyzer.analyze(
        source_code=source,
        error_message="results[0].then is not a function",
        error_type="TypeError",
        file_path="test.js",
    )

    ai_findings = [f for f in findings if f.rule_id == "ai-generated-pattern"]
    assert any("Promise.all" in f.message for f in ai_findings)
```

---

## Configuration

```yaml
# python/config/analyzer_config.yaml
rules:
  null-access:
    enabled: true
    severity: high
    confidence_threshold: 0.7

  async-patterns:
    enabled: true
    severity: medium
    confidence_threshold: 0.6

  ai-generated-pattern:
    enabled: true
    severity: medium
    confidence_threshold: 0.7

  error-handling:
    enabled: true
    severity: medium
    confidence_threshold: 0.65

  type-coercion:
    enabled: true
    severity: low
    confidence_threshold: 0.6

parsing:
  timeout_ms: 10000
  max_file_size_kb: 500

output:
  max_findings: 20
  include_snippets: true
  snippet_context_lines: 2
```
# 07 - Workers & Queues

## Overview

Buglens uses BullMQ and Redis to process all asynchronous and long-running operations via background jobs. This ensures fast webhook/API responses and reliable, scalable processing for:

- Deterministic RCA analysis (AST, stack trace, code fetch)
- Evidence assembly (code context, timeline, commits)
- LLM reasoning (GPT-4o-mini)
- Token refresh (OAuth lifecycle)

## Actual Queue/Worker Architecture (2025)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        WORKERS & QUEUES (BullMQ)                            │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  deterministic-analyzer   │  Deterministic RCA (AST, stack, code)    │  │
│  │  evidence-assembly        │  Evidence bundle assembly                │  │
│  │  llm-reasoning            │  LLM narrative generation                │  │
│  │  token-refresh            │  OAuth token lifecycle                   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  All queues use BullMQ, Redis, and per-queue concurrency/retry config │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File Structure

| File                                           | Purpose                                  |
| ---------------------------------------------- | ---------------------------------------- |
| `src/workers/index.ts`                         | Worker bootstrap (starts all workers)    |
| `src/workers/deterministic-analyzer.worker.ts` | Deterministic analyzer worker entrypoint |
| `src/workers/queues/deterministic.ts`          | Deterministic analyzer queue config      |
| `src/workers/queues/evidence.ts`               | Evidence assembly queue config           |
| `src/workers/queues/llm-reasoning.ts`          | LLM reasoning queue config               |
| `src/workers/queues/token-refresh.ts`          | Token refresh queue config               |

## Queue/Worker Details

### 1. Deterministic Analyzer Queue

- **Queue Name:** `deterministic-analyzer`
- **Job Data:** `{ jobId, eventId, orgId }`
- **Worker:** `deterministic-analyzer.worker.ts`
- **Concurrency:** 1
- **Attempts:** 3 (exponential backoff)
- **Purpose:**
  - Runs deterministic RCA pipeline (AST, stack trace, code fetch)
  - Calls Python analyzer for findings
  - Enqueues evidence-assembly job on success

### 2. Evidence Assembly Queue

- **Queue Name:** `evidence-assembly`
- **Job Data:** `{ jobId, eventId, orgId }`
- **Worker:** `queues/evidence.ts`
- **Concurrency:** 5
- **Attempts:** 3 (exponential backoff)
- **Purpose:**
  - Collects code context, timeline, recent commits
  - Builds evidence bundle for LLM
  - Enqueues llm-reasoning job

### 3. LLM Reasoning Queue

- **Queue Name:** `llm-reasoning`
- **Job Data:** `{ jobId, eventId, orgId }`
- **Worker:** `queues/llm-reasoning.ts`
- **Concurrency:** 3
- **Attempts:** 2 (exponential backoff)
- **Purpose:**
  - Calls LLM (GPT-4o-mini) for narrative RCA
  - Stores RCA result, triggers notifications

### 4. Token Refresh Queue

- **Queue Name:** `token-refresh`
- **Job Data:** `{ type, orgId?, integrationId? }`
- **Worker:** `queues/token-refresh.ts`
- **Concurrency:** 1
- **Attempts:** 2 (fixed backoff)
- **Purpose:**
  - Periodic OAuth token refresh
  - Token health checks

## Worker Bootstrap

All workers are started from `src/workers/index.ts`:

```typescript
import { startDeterministicAnalyzerWorker } from "./deterministic-analyzer.worker.js";
import { startEvidenceWorker } from "./queues/evidence.js";
import { startLLMWorker } from "./queues/llm-reasoning.js";
import {
  startTokenRefreshWorker,
  initializeTokenScheduler,
} from "./queues/token-refresh.js";

async function bootstrap() {
  startDeterministicAnalyzerWorker();
  startEvidenceWorker();
  startLLMWorker();
  startTokenRefreshWorker();
  await initializeTokenScheduler();
}
```

## Queue Configuration Example

```typescript
// src/workers/queues/deterministic.ts
import { Queue, type JobsOptions } from "bullmq";
import { config } from "../../utils/config.js";

export const DETERMINISTIC_QUEUE_NAME = "deterministic-analyzer";

const defaultJobOptions: JobsOptions = {
  removeOnComplete: 100,
  removeOnFail: 100,
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
};

export function getQueue() {
  return new Queue(DETERMINISTIC_QUEUE_NAME, {
    connection: { host: "localhost", port: 6379 },
    defaultJobOptions,
  });
}
```

## Rate Limiting & Retry

- Per-org rate limits are enforced in job handlers (see `checkOrgQuota`)
- Each queue sets its own concurrency and retry/backoff policy
- No dead letter queue (failed jobs are logged and can be retried manually)

## Job Data Types

| Queue                  | Job Data Type                  |
| ---------------------- | ------------------------------ |
| deterministic-analyzer | `DeterministicAnalyzerJobData` |
| evidence-assembly      | `EvidenceAssemblyJobData`      |
| llm-reasoning          | `LLMReasoningJobData`          |
| token-refresh          | `TokenRefreshJobData`          |

## Summary

- All queues are defined in `src/workers/queues/`
- Each queue has its own config, job data type, and worker
- No `src/services/queue.ts` or `rca-worker.ts` exists (old docs)
- All job types, concurrency, and retry policies are set per-queue
- See code for up-to-date job data interfaces and queue options
  export interface QueueConfig {
  name: string;
  concurrency: number;
  priority: number;
  retries: number;
  backoff: {
  type: "exponential" | "fixed";
  delay: number;
  };
  }

export const QUEUE_CONFIGS: Record<keyof typeof QUEUES, QueueConfig> = {
RCA_JOBS: {
name: QUEUES.RCA_JOBS,
concurrency: 3,
priority: 1,
retries: 3,
backoff: {
type: "exponential",
delay: 5000, // 5s, 10s, 20s
},
},
CODE_FETCH: {
name: QUEUES.CODE_FETCH,
concurrency: 5,
priority: 2,
retries: 5,
backoff: {
type: "exponential",
delay: 2000, // 2s, 4s, 8s, 16s, 32s
},
},
NOTIFICATIONS: {
name: QUEUES.NOTIFICATIONS,
concurrency: 10,
priority: 3,
retries: 3,
backoff: {
type: "fixed",
delay: 10000, // 10s between retries
},
},
COST_TRACKING: {
name: QUEUES.COST_TRACKING,
concurrency: 1,
priority: 4,
retries: 1,
backoff: {
type: "fixed",
delay: 1000,
},
},
};

// Create queue instance
export function createQueue(queueName: keyof typeof QUEUES): Queue {
const queueConfig = QUEUE_CONFIGS[queueName];

return new Queue(queueConfig.name, {
connection: redisConnection,
defaultJobOptions: {
attempts: queueConfig.retries,
backoff: queueConfig.backoff,
removeOnComplete: {
age: 86400, // Keep completed jobs for 24 hours
count: 1000, // Keep last 1000 completed
},
removeOnFail: {
age: 604800, // Keep failed jobs for 7 days
},
},
});
}

// Create worker instance
export function createWorker<T, R>(
queueName: keyof typeof QUEUES,
processor: (job: Job<T>) => Promise<R>
): Worker<T, R> {
const queueConfig = QUEUE_CONFIGS[queueName];

return new Worker<T, R>(queueConfig.name, processor, {
connection: redisConnection,
concurrency: queueConfig.concurrency,
limiter: {
max: 100,
duration: 60000, // 100 jobs per minute max
},
});
}

// Queue health check
export async function checkQueueHealth(): Promise<Record<string, QueueHealth>> {
const health: Record<string, QueueHealth> = {};

for (const [key, config] of Object.entries(QUEUE_CONFIGS)) {
const queue = createQueue(key as keyof typeof QUEUES);

    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
    ]);

    health[config.name] = {
      waiting,
      active,
      completed,
      failed,
      isPaused: await queue.isPaused(),
    };

    await queue.close();

}

return health;
}

interface QueueHealth {
waiting: number;
active: number;
completed: number;
failed: number;
isPaused: boolean;
}

````

---

## RCA Worker

```typescript
// src/workers/rca-worker.ts
import { Job } from "bullmq";
import { createWorker, createQueue, QUEUES } from "../services/queue";
import { EvidenceCollectorService } from "../services/evidence-collector";
import { LLMOrchestrator } from "../services/llm-orchestrator";
import { EvidenceStorageService } from "../services/evidence-storage";
import { pool } from "../db/client";
import { logger } from "../utils/logger";
import { checkOrgQuota, trackCost } from "../utils/rate-limits";

export interface RCAJobData {
  eventId: string;
  orgId: string;
  eventData: SentryEvent;
  repo: string;
  ref: string;
  priority?: "high" | "normal" | "low";
}

export interface RCAJobResult {
  rcaId: string;
  confidence: number;
  rootCause: string;
  suggestedFix: string;
  executionTimeMs: number;
}

// Services (initialized once)
const evidenceCollector = new EvidenceCollectorService();
const llmOrchestrator = new LLMOrchestrator();
const evidenceStorage = new EvidenceStorageService();
const notificationQueue = createQueue("NOTIFICATIONS");

export const rcaWorker = createWorker<RCAJobData, RCAJobResult>(
  "RCA_JOBS",
  async (job: Job<RCAJobData>) => {
    const startTime = Date.now();
    const { eventId, orgId, eventData, repo, ref } = job.data;

    logger.info({ jobId: job.id, eventId, orgId }, "Starting RCA job");

    try {
      // 1. Check organization quota
      await checkOrgQuota(orgId, "rca");

      // 2. Update job status
      await updateJobStatus(eventId, "processing");
      await job.updateProgress(10);

      // 3. Collect evidence
      logger.debug({ eventId }, "Collecting evidence");
      const evidence = await evidenceCollector.collect({
        eventId,
        orgId,
        eventData,
        repo,
        ref,
      });
      await job.updateProgress(40);

      // 4. Store evidence bundle
      await evidenceStorage.store(orgId, eventId, evidence);
      await job.updateProgress(50);

      // 5. Check LLM quota before expensive operation
      await checkOrgQuota(orgId, "llm");

      // 6. Generate RCA with LLM
      logger.debug(
        { eventId, confidence: evidence.metadata.confidence },
        "Generating RCA"
      );
      const rca = await llmOrchestrator.generateRCA(evidence);
      await job.updateProgress(80);

      // 7. Track costs
      await trackCost(orgId, "llm", rca.tokensUsed, rca.cost);

      // 8. Store RCA result
      const rcaId = await storeRCAResult(orgId, eventId, rca);
      await job.updateProgress(90);

      // 9. Queue notification
      await notificationQueue.add("slack-notification", {
        orgId,
        eventId,
        rcaId,
        channel: await getSlackChannel(orgId),
        rca: {
          rootCause: rca.rootCause,
          confidence: rca.confidence,
          suggestedFix: rca.suggestedFix,
        },
      });

      // 10. Complete
      await updateJobStatus(eventId, "completed");
      await job.updateProgress(100);

      const executionTimeMs = Date.now() - startTime;
      logger.info(
        {
          jobId: job.id,
          eventId,
          rcaId,
          executionTimeMs,
          confidence: rca.confidence,
        },
        "RCA job completed"
      );

      return {
        rcaId,
        confidence: rca.confidence,
        rootCause: rca.rootCause,
        suggestedFix: rca.suggestedFix,
        executionTimeMs,
      };
    } catch (error) {
      logger.error({ error, jobId: job.id, eventId }, "RCA job failed");
      await updateJobStatus(eventId, "failed", error.message);
      throw error;
    }
  }
);

// Event handlers
rcaWorker.on("completed", (job, result) => {
  logger.info(
    {
      jobId: job.id,
      rcaId: result.rcaId,
      executionTimeMs: result.executionTimeMs,
    },
    "RCA job success"
  );
});

rcaWorker.on("failed", (job, error) => {
  logger.error(
    {
      jobId: job?.id,
      error: error.message,
      stack: error.stack,
    },
    "RCA job failure"
  );
});

rcaWorker.on("stalled", (jobId) => {
  logger.warn({ jobId }, "RCA job stalled");
});

// Helper functions
async function updateJobStatus(
  eventId: string,
  status: string,
  error?: string
): Promise<void> {
  await pool.query(
    `
    UPDATE rca_jobs
    SET status = $1, error_message = $2, updated_at = NOW()
    WHERE event_id = $3
  `,
    [status, error || null, eventId]
  );
}

async function storeRCAResult(
  orgId: string,
  eventId: string,
  rca: RCAOutput
): Promise<string> {
  const result = await pool.query(
    `
    INSERT INTO rca_results (
      org_id, event_id, root_cause, confidence, suggested_fix,
      evidence_summary, llm_tokens_used, llm_cost_usd
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `,
    [
      orgId,
      eventId,
      rca.rootCause,
      rca.confidence,
      rca.suggestedFix,
      JSON.stringify(rca.evidenceSummary),
      rca.tokensUsed,
      rca.cost,
    ]
  );

  return result.rows[0].id;
}

async function getSlackChannel(orgId: string): Promise<string | null> {
  const result = await pool.query(
    `
    SELECT config->>'slack_channel' as channel
    FROM integrations
    WHERE org_id = $1 AND type = 'slack' AND enabled = true
  `,
    [orgId]
  );

  return result.rows[0]?.channel || null;
}
````

---

## Code Fetch Worker

```typescript
// src/workers/code-fetch-worker.ts
import { Job } from "bullmq";
import { createWorker } from "../services/queue";
import { CodeFetcherService } from "../services/code-fetcher";
import { logger } from "../utils/logger";

export interface CodeFetchJobData {
  orgId: string;
  repo: string;
  ref: string;
  files: Array<{
    path: string;
    lineNumber?: number;
  }>;
  requestId: string;
}

export interface CodeFetchJobResult {
  requestId: string;
  results: Array<{
    path: string;
    content: string | null;
    error: string | null;
  }>;
  cacheHits: number;
  cacheMisses: number;
}

const codeFetcher = new CodeFetcherService();

export const codeFetchWorker = createWorker<
  CodeFetchJobData,
  CodeFetchJobResult
>("CODE_FETCH", async (job: Job<CodeFetchJobData>) => {
  const { orgId, repo, ref, files, requestId } = job.data;

  logger.debug(
    {
      jobId: job.id,
      requestId,
      fileCount: files.length,
    },
    "Starting code fetch job"
  );

  const results: CodeFetchJobResult["results"] = [];
  let cacheHits = 0;
  let cacheMisses = 0;

  // Process files in parallel (respecting rate limits internally)
  const fetchPromises = files.map(async (file) => {
    try {
      const result = await codeFetcher.fetch({
        orgId,
        repo,
        ref,
        filePath: file.path,
      });

      if (result.fromCache) {
        cacheHits++;
      } else {
        cacheMisses++;
      }

      return {
        path: file.path,
        content: result.content,
        error: null,
      };
    } catch (error) {
      cacheMisses++;
      return {
        path: file.path,
        content: null,
        error: error.message,
      };
    }
  });

  const fetchResults = await Promise.all(fetchPromises);
  results.push(...fetchResults);

  // Update progress
  await job.updateProgress(100);

  logger.info(
    {
      jobId: job.id,
      requestId,
      totalFiles: files.length,
      successful: results.filter((r) => r.content).length,
      cacheHits,
      cacheMisses,
    },
    "Code fetch job completed"
  );

  return {
    requestId,
    results,
    cacheHits,
    cacheMisses,
  };
});
```

---

## Notification Worker

```typescript
// src/workers/notification-worker.ts
import { Job } from "bullmq";
import { createWorker } from "../services/queue";
import { SlackService } from "../services/slack";
import { logger } from "../utils/logger";

export interface NotificationJobData {
  type: "slack" | "email" | "webhook";
  orgId: string;
  eventId: string;
  rcaId: string;
  channel?: string;
  email?: string;
  webhookUrl?: string;
  rca: {
    rootCause: string;
    confidence: number;
    suggestedFix: string;
  };
}

const slackService = new SlackService();

export const notificationWorker = createWorker<NotificationJobData, void>(
  "NOTIFICATIONS",
  async (job: Job<NotificationJobData>) => {
    const { type, orgId, eventId, rcaId, rca } = job.data;

    logger.debug(
      {
        jobId: job.id,
        type,
        eventId,
      },
      "Starting notification job"
    );

    try {
      switch (type) {
        case "slack":
          await sendSlackNotification(job.data);
          break;
        case "email":
          await sendEmailNotification(job.data);
          break;
        case "webhook":
          await sendWebhookNotification(job.data);
          break;
        default:
          throw new Error(`Unknown notification type: ${type}`);
      }

      logger.info(
        {
          jobId: job.id,
          type,
          eventId,
          rcaId,
        },
        "Notification sent"
      );
    } catch (error) {
      logger.error(
        {
          error,
          jobId: job.id,
          type,
        },
        "Notification failed"
      );
      throw error;
    }
  }
);

async function sendSlackNotification(data: NotificationJobData): Promise<void> {
  if (!data.channel) {
    logger.warn({ orgId: data.orgId }, "No Slack channel configured");
    return;
  }

  const confidenceEmoji = getConfidenceEmoji(data.rca.confidence);

  await slackService.sendMessage({
    channel: data.channel,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${confidenceEmoji} Buglens RCA Report`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Confidence:* ${Math.round(data.rca.confidence * 100)}%`,
          },
          {
            type: "mrkdwn",
            text: `*Event:* ${data.eventId.substring(0, 8)}`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Root Cause:*\n${data.rca.rootCause}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Suggested Fix:*\n\`\`\`${data.rca.suggestedFix}\`\`\``,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View Full Report",
            },
            url: `${config.APP_URL}/rca/${data.rcaId}`,
          },
        ],
      },
    ],
  });
}

async function sendEmailNotification(data: NotificationJobData): Promise<void> {
  // TODO: Implement email notifications (Phase 2)
  logger.info({ email: data.email }, "Email notifications not yet implemented");
}

async function sendWebhookNotification(
  data: NotificationJobData
): Promise<void> {
  if (!data.webhookUrl) return;

  await fetch(data.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_id: data.eventId,
      rca_id: data.rcaId,
      root_cause: data.rca.rootCause,
      confidence: data.rca.confidence,
      suggested_fix: data.rca.suggestedFix,
    }),
  });
}

function getConfidenceEmoji(confidence: number): string {
  if (confidence >= 0.8) return "🎯";
  if (confidence >= 0.6) return "🔍";
  if (confidence >= 0.4) return "🤔";
  return "⚠️";
}
```

---

## Job Scheduler

```typescript
// src/services/job-scheduler.ts
import { createQueue, QUEUES } from "./queue";
import { RCAJobData } from "../workers/rca-worker";
import { logger } from "../utils/logger";
import { checkOrgQuota } from "../utils/rate-limits";

const rcaQueue = createQueue("RCA_JOBS");
const codeFetchQueue = createQueue("CODE_FETCH");

export async function scheduleRCAJob(
  data: RCAJobData,
  options: { priority?: "high" | "normal" | "low"; delay?: number } = {}
): Promise<string> {
  const { priority = "normal", delay } = options;

  // Pre-check quota (fail fast)
  try {
    await checkOrgQuota(data.orgId, "rca");
  } catch (error) {
    logger.warn(
      {
        orgId: data.orgId,
        error: error.message,
      },
      "RCA quota exceeded, job not scheduled"
    );
    throw error;
  }

  // Calculate priority value (lower = higher priority)
  const priorityMap = { high: 1, normal: 5, low: 10 };
  const priorityValue = priorityMap[priority];

  const job = await rcaQueue.add("process-rca", data, {
    priority: priorityValue,
    delay,
    jobId: `rca-${data.eventId}`, // Prevent duplicates
  });

  logger.info(
    {
      jobId: job.id,
      eventId: data.eventId,
      orgId: data.orgId,
      priority,
    },
    "RCA job scheduled"
  );

  return job.id!;
}

export async function scheduleCodeFetch(
  orgId: string,
  repo: string,
  ref: string,
  files: Array<{ path: string; lineNumber?: number }>
): Promise<string> {
  const requestId = crypto.randomUUID();

  const job = await codeFetchQueue.add("fetch-code", {
    orgId,
    repo,
    ref,
    files,
    requestId,
  });

  return requestId;
}

// Graceful shutdown
export async function shutdownQueues(): Promise<void> {
  logger.info("Shutting down queues...");

  await Promise.all([rcaQueue.close(), codeFetchQueue.close()]);

  logger.info("Queues shut down");
}
```

---

## Worker Management

### Starting Workers

```typescript
// src/workers/index.ts
import { rcaWorker } from "./rca-worker";
import { codeFetchWorker } from "./code-fetch-worker";
import { notificationWorker } from "./notification-worker";
import { logger } from "../utils/logger";

const workers = [rcaWorker, codeFetchWorker, notificationWorker];

export async function startWorkers(): Promise<void> {
  logger.info(`Starting ${workers.length} workers...`);

  // Workers start automatically when created
  // Add global error handlers
  for (const worker of workers) {
    worker.on("error", (error) => {
      logger.error({ error, worker: worker.name }, "Worker error");
    });
  }

  logger.info("All workers started");
}

export async function stopWorkers(): Promise<void> {
  logger.info("Stopping workers...");

  await Promise.all(workers.map((w) => w.close()));

  logger.info("All workers stopped");
}

// Graceful shutdown handler
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down...");
  await stopWorkers();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down...");
  await stopWorkers();
  process.exit(0);
});
```

### Running Workers (Separate Process)

```bash
# Start workers independently from API
npx tsx src/workers/start.ts
```

```typescript
// src/workers/start.ts
import { startWorkers } from "./index";
import { logger } from "../utils/logger";

async function main() {
  logger.info("Starting Buglens workers...");
  await startWorkers();
  logger.info("Workers running. Press Ctrl+C to stop.");
}

main().catch((error) => {
  logger.error({ error }, "Failed to start workers");
  process.exit(1);
});
```

---

## Monitoring

### Queue Metrics

```typescript
// src/api/routes/admin/queues.ts
server.get("/admin/queues", async (request, reply) => {
  const health = await checkQueueHealth();

  return reply.send({
    status: "ok",
    queues: health,
    timestamp: new Date().toISOString(),
  });
});

server.post("/admin/queues/:name/pause", async (request, reply) => {
  const { name } = request.params as { name: string };
  const queue = getQueueByName(name);

  await queue.pause();

  return reply.send({ paused: true });
});

server.post("/admin/queues/:name/resume", async (request, reply) => {
  const { name } = request.params as { name: string };
  const queue = getQueueByName(name);

  await queue.resume();

  return reply.send({ paused: false });
});
```

### Dashboard Integration

Use [Bull Board](https://github.com/felixmosh/bull-board) for visual monitoring:

```typescript
// src/api/admin/bull-board.ts
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import { createQueue, QUEUES } from "../../services/queue";

export function setupBullBoard(server: FastifyInstance) {
  const serverAdapter = new FastifyAdapter();

  const queues = Object.keys(QUEUES).map(
    (key) => new BullMQAdapter(createQueue(key as keyof typeof QUEUES))
  );

  createBullBoard({
    queues,
    serverAdapter,
  });

  serverAdapter.setBasePath("/admin/queues");
  server.register(serverAdapter.registerPlugin(), {
    basePath: "/admin/queues",
    prefix: "/admin/queues",
  });
}
```

---

## Testing

```typescript
// tests/unit/queue.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scheduleRCAJob } from "../../src/services/job-scheduler";
import { createQueue } from "../../src/services/queue";

vi.mock("../../src/services/queue", () => ({
  createQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({ id: "test-job-id" }),
  })),
}));

vi.mock("../../src/utils/rate-limits", () => ({
  checkOrgQuota: vi.fn().mockResolvedValue(true),
}));

describe("Job Scheduler", () => {
  it("schedules RCA job with correct data", async () => {
    const mockQueue = { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
    vi.mocked(createQueue).mockReturnValue(mockQueue as any);

    const jobData = {
      eventId: "event-123",
      orgId: "org-456",
      eventData: {} as any,
      repo: "owner/repo",
      ref: "main",
    };

    const jobId = await scheduleRCAJob(jobData);

    expect(jobId).toBe("job-1");
    expect(mockQueue.add).toHaveBeenCalledWith(
      "process-rca",
      jobData,
      expect.objectContaining({
        priority: 5, // normal
        jobId: "rca-event-123",
      })
    );
  });

  it("respects priority setting", async () => {
    const mockQueue = { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
    vi.mocked(createQueue).mockReturnValue(mockQueue as any);

    await scheduleRCAJob(
      { eventId: "e", orgId: "o", eventData: {} as any, repo: "r", ref: "r" },
      { priority: "high" }
    );

    expect(mockQueue.add).toHaveBeenCalledWith(
      "process-rca",
      expect.anything(),
      expect.objectContaining({ priority: 1 })
    );
  });
});
```
