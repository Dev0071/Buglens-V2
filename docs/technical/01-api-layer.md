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

| File                                | Purpose                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `src/api/app.ts`                    | Fastify application setup, plugin registration                                 |
| `src/api/server.ts`                 | Server bootstrap, port binding                                                 |
| `src/api/routes/webhooks.ts`        | Sentry webhook handler                                                         |
| `src/api/routes/github-webhooks.ts` | GitHub App webhook handler                                                     |
| `src/api/routes/health.ts`          | Health check endpoints                                                         |
| `src/api/routes/auth.ts`            | Authentication (login, signup, session management)                             |
| `src/api/routes/integrations.ts`    | Integration management (GitHub, Slack, Jira, Teams) + OAuth flows              |
| `src/api/routes/oauth.ts`           | **REMOVED** - OAuth functionality moved to integrations.ts                     |
| `src/api/routes/rca.ts`             | RCA results and analysis                                                       |
| `src/api/routes/events.ts`          | Event listing and details                                                      |
| `src/api/routes/dashboard.ts`       | Dashboard metrics and stats                                                    |
| `src/api/routes/settings.ts`        | Organization settings                                                          |
| `src/api/routes/costs.ts`           | Cost tracking and analytics                                                    |
| `src/api/routes/analytics.ts`       | Platform analytics                                                             |
| `src/api/routes/team.ts`            | Team member management                                                         |
| `src/api/routes/profile.ts`         | User profile management                                                        |
| `src/api/middleware/org-context.ts` | Multi-tenancy middleware                                                       |
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
