# 10 - Configuration & Environment

## Overview

Buglens uses environment variables for all configuration with Zod validation at startup. This ensures fail-fast behavior when configuration is invalid and provides full type safety throughout the codebase.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CONFIGURATION SYSTEM                                  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      CONFIGURATION SOURCES                              │ │
│  │                                                                         │ │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                │ │
│  │  │   .env      │    │  .env.local │    │  System ENV │                │ │
│  │  │  (defaults) │    │ (overrides) │    │ (production)│                │ │
│  │  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                │ │
│  │         │                  │                  │                        │ │
│  │         └──────────────────┼──────────────────┘                        │ │
│  │                            │                                           │ │
│  │                            ▼                                           │ │
│  │               ┌────────────────────────┐                               │ │
│  │               │    dotenv loader       │                               │ │
│  │               │    (process.env)       │                               │ │
│  │               └────────────┬───────────┘                               │ │
│  │                            │                                           │ │
│  └────────────────────────────┼───────────────────────────────────────────┘ │
│                               │                                             │
│                               ▼                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                       ZOD VALIDATION                                    │ │
│  │                                                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │  ConfigSchema.safeParse(process.env)                            │   │ │
│  │  │                                                                  │   │ │
│  │  │  ✓ Type coercion (PORT: string → number)                        │   │ │
│  │  │  ✓ Default values                                                │   │ │
│  │  │  ✓ Required field validation                                     │   │ │
│  │  │  ✓ Format validation (URLs, emails)                              │   │ │
│  │  │  ✓ Enum validation                                               │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                         │ │
│  │                            │                                            │ │
│  │              ┌─────────────┴─────────────┐                             │ │
│  │              │                           │                             │ │
│  │              ▼                           ▼                             │ │
│  │         ┌────────┐                  ┌────────┐                         │ │
│  │         │ SUCCESS│                  │ FAILURE│                         │ │
│  │         │        │                  │        │                         │ │
│  │         │ Export │                  │ Exit 1 │                         │ │
│  │         │ config │                  │ + logs │                         │ │
│  │         └────────┘                  └────────┘                         │ │
│  │                                                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                       | Purpose                            |
| -------------------------- | ---------------------------------- |
| `src/utils/config.ts`      | Configuration loader and validator |
| `.env.example`             | Template for environment variables |
| `src/utils/rate-limits.ts` | Per-plan rate limit configuration  |

---

## Configuration Module

```typescript
// src/utils/config.ts
import "dotenv/config";
import { z } from "zod";

/**
 * Configuration schema with validation rules
 */
const ConfigSchema = z.object({
  // ========================================================================
  // SERVER
  // ========================================================================
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // ========================================================================
  // DATABASE
  // ========================================================================
  DATABASE_URL: z.string().url().describe("PostgreSQL connection string"),

  // ========================================================================
  // REDIS
  // ========================================================================
  REDIS_URL: z
    .string()
    .url()
    .describe("Redis connection string for BullMQ and caching"),

  // ========================================================================
  // AWS
  // ========================================================================
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_EVIDENCE_BUCKET: z
    .string()
    .optional()
    .describe("S3 bucket for evidence bundles"),
  S3_CODE_CACHE_BUCKET: z
    .string()
    .optional()
    .describe("S3 bucket for code cache (tier 2)"),

  // ========================================================================
  // GITHUB APP
  // ========================================================================
  GITHUB_APP_ID: z.coerce.number().optional(),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .optional()
    .describe("RSA private key (PEM format)"),
  GITHUB_WEBHOOK_SECRET: z
    .string()
    .optional()
    .describe("Secret for GitHub webhook HMAC validation"),

  // ========================================================================
  // SENTRY
  // ========================================================================
  SENTRY_WEBHOOK_SECRET: z
    .string()
    .optional()
    .describe("Secret for Sentry webhook HMAC validation"),

  // ========================================================================
  // LLM CONFIGURATION
  // ========================================================================
  LLM_PROVIDER: z
    .enum(["openai", "deepseek"])
    .default("openai")
    .describe("LLM provider to use"),
  OPENAI_API_KEY: z
    .string()
    .optional()
    .describe("OpenAI API key (required if LLM_PROVIDER=openai)"),
  DEEPSEEK_API_KEY: z
    .string()
    .optional()
    .describe("DeepSeek API key (required if LLM_PROVIDER=deepseek)"),
  LLM_MODEL: z
    .string()
    .optional()
    .describe("Override default model (gpt-4o-mini or deepseek-chat)"),
  LLM_BASE_URL: z
    .string()
    .url()
    .optional()
    .describe("Override LLM API base URL"),
  LLM_MAX_TOKENS: z.coerce.number().default(2000),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),

  // ========================================================================
  // SLACK
  // ========================================================================
  SLACK_BOT_TOKEN: z.string().optional().describe("Slack bot OAuth token"),
  SLACK_SIGNING_SECRET: z
    .string()
    .optional()
    .describe("Slack request signing secret"),

  // ========================================================================
  // APPLICATION
  // ========================================================================
  APP_URL: z
    .string()
    .url()
    .default("http://localhost:3000")
    .describe("Public URL of the web application"),
  ALLOW_DEV_ERRORS: z.coerce
    .boolean()
    .default(false)
    .describe("Process errors from development environments"),

  // ========================================================================
  // EVIDENCE COLLECTION
  // ========================================================================
  EVIDENCE_MAX_FRAMES: z.coerce
    .number()
    .default(5)
    .describe("Maximum stack frames to fetch code for"),
  CODE_CONTEXT_LINES: z.coerce
    .number()
    .default(15)
    .describe("Lines of context around error line"),

  // ========================================================================
  // RATE LIMITS (Override defaults)
  // ========================================================================
  RATE_LIMIT_RCA_PER_HOUR: z.coerce.number().optional(),
  RATE_LIMIT_LLM_TOKENS_PER_DAY: z.coerce.number().optional(),
  RATE_LIMIT_GITHUB_API_PER_HOUR: z.coerce.number().optional(),

  // ========================================================================
  // CORS
  // ========================================================================
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .describe("Comma-separated list of allowed CORS origins"),
});

/**
 * Validate configuration at startup
 */
function loadConfig() {
  const result = ConfigSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Configuration validation failed:");
    result.error.errors.forEach((err) => {
      console.error(`   ${err.path.join(".")}: ${err.message}`);
    });
    console.error("\nPlease check your environment variables.");
    process.exit(1);
  }

  // Additional validation: LLM key must match provider
  const config = result.data;
  if (config.LLM_PROVIDER === "openai" && !config.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY required when LLM_PROVIDER=openai");
    process.exit(1);
  }
  if (config.LLM_PROVIDER === "deepseek" && !config.DEEPSEEK_API_KEY) {
    console.error("❌ DEEPSEEK_API_KEY required when LLM_PROVIDER=deepseek");
    process.exit(1);
  }

  return config;
}

export const config = loadConfig();
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Get CORS origins as array
 */
export function getCorsOrigins(): string[] {
  return config.CORS_ORIGINS.split(",").map((origin) => origin.trim());
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return config.NODE_ENV === "production";
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return config.NODE_ENV === "development";
}

/**
 * Check if running in test
 */
export function isTest(): boolean {
  return config.NODE_ENV === "test";
}
```

---

## Rate Limits Configuration

```typescript
// src/utils/rate-limits.ts
import { config } from "./config";
import { PlanTier } from "../types/models";

/**
 * Rate limits per plan tier
 */
export interface PlanRateLimits {
  rca_per_hour: number;
  rca_per_day: number;
  llm_tokens_per_day: number;
  github_api_per_hour: number;
  max_repos: number;
  max_users: number;
  retention_days: number;
}

/**
 * Default rate limits by plan
 */
export const RATE_LIMITS: Record<PlanTier, PlanRateLimits> = {
  free: {
    rca_per_hour: 10,
    rca_per_day: 50,
    llm_tokens_per_day: 100_000,
    github_api_per_hour: 100,
    max_repos: 3,
    max_users: 5,
    retention_days: 7,
  },
  pro: {
    rca_per_hour: 100,
    rca_per_day: 500,
    llm_tokens_per_day: 1_000_000,
    github_api_per_hour: 1000,
    max_repos: 20,
    max_users: 25,
    retention_days: 30,
  },
  enterprise: {
    rca_per_hour: 1000,
    rca_per_day: 10000,
    llm_tokens_per_day: 10_000_000,
    github_api_per_hour: 5000,
    max_repos: -1, // Unlimited
    max_users: -1, // Unlimited
    retention_days: 90,
  },
};

/**
 * Get rate limits for an organization's plan
 */
export function getRateLimits(plan: PlanTier): PlanRateLimits {
  const limits = { ...RATE_LIMITS[plan] };

  // Apply environment overrides
  if (config.RATE_LIMIT_RCA_PER_HOUR) {
    limits.rca_per_hour = config.RATE_LIMIT_RCA_PER_HOUR;
  }
  if (config.RATE_LIMIT_LLM_TOKENS_PER_DAY) {
    limits.llm_tokens_per_day = config.RATE_LIMIT_LLM_TOKENS_PER_DAY;
  }
  if (config.RATE_LIMIT_GITHUB_API_PER_HOUR) {
    limits.github_api_per_hour = config.RATE_LIMIT_GITHUB_API_PER_HOUR;
  }

  return limits;
}

/**
 * Check if organization has exceeded a specific limit
 */
export async function checkOrgQuota(
  orgId: string,
  type: "rca" | "llm" | "github"
): Promise<void> {
  const redis = await getRedis();
  const plan = await getOrgPlan(orgId);
  const limits = getRateLimits(plan);

  switch (type) {
    case "rca": {
      const hourKey = `ratelimit:rca:hour:${orgId}`;
      const dayKey = `ratelimit:rca:day:${orgId}`;

      const [hourCount, dayCount] = await Promise.all([
        redis.get(hourKey).then((v) => parseInt(v || "0")),
        redis.get(dayKey).then((v) => parseInt(v || "0")),
      ]);

      if (hourCount >= limits.rca_per_hour) {
        throw new QuotaExceededError("RCA hourly limit exceeded", {
          limit: limits.rca_per_hour,
          current: hourCount,
          resetIn: await redis.ttl(hourKey),
        });
      }

      if (dayCount >= limits.rca_per_day) {
        throw new QuotaExceededError("RCA daily limit exceeded", {
          limit: limits.rca_per_day,
          current: dayCount,
          resetIn: await redis.ttl(dayKey),
        });
      }
      break;
    }

    case "llm": {
      const key = `ratelimit:llm:${orgId}`;
      const tokens = await redis.get(key).then((v) => parseInt(v || "0"));

      if (tokens >= limits.llm_tokens_per_day) {
        throw new QuotaExceededError("LLM token limit exceeded", {
          limit: limits.llm_tokens_per_day,
          current: tokens,
          resetIn: await redis.ttl(key),
        });
      }
      break;
    }

    case "github": {
      const key = `ratelimit:github:${orgId}`;
      const calls = await redis.get(key).then((v) => parseInt(v || "0"));

      if (calls >= limits.github_api_per_hour) {
        throw new QuotaExceededError("GitHub API limit exceeded", {
          limit: limits.github_api_per_hour,
          current: calls,
          resetIn: await redis.ttl(key),
        });
      }
      break;
    }
  }
}

/**
 * Track usage after operation
 */
export async function trackUsage(
  orgId: string,
  type: "rca" | "llm" | "github",
  amount: number = 1
): Promise<void> {
  const redis = await getRedis();

  switch (type) {
    case "rca": {
      const hourKey = `ratelimit:rca:hour:${orgId}`;
      const dayKey = `ratelimit:rca:day:${orgId}`;

      await Promise.all([
        redis.incr(hourKey).then(() => redis.expire(hourKey, 3600)),
        redis.incr(dayKey).then(() => redis.expire(dayKey, 86400)),
      ]);
      break;
    }

    case "llm": {
      const key = `ratelimit:llm:${orgId}`;
      await redis.incrby(key, amount);
      await redis.expire(key, 86400);
      break;
    }

    case "github": {
      const key = `ratelimit:github:${orgId}`;
      await redis.incr(key);
      await redis.expire(key, 3600);
      break;
    }
  }
}

/**
 * Track cost metrics for billing
 */
export async function trackCost(
  orgId: string,
  type: "llm",
  tokens: number,
  costUsd: number
): Promise<void> {
  await pool.query(
    `
    INSERT INTO cost_metrics (org_id, date, llm_tokens_input, llm_cost_usd)
    VALUES ($1, CURRENT_DATE, $2, $3)
    ON CONFLICT (org_id, date) DO UPDATE SET
      llm_tokens_input = cost_metrics.llm_tokens_input + EXCLUDED.llm_tokens_input,
      llm_cost_usd = cost_metrics.llm_cost_usd + EXCLUDED.llm_cost_usd,
      updated_at = NOW()
  `,
    [orgId, tokens, costUsd]
  );
}

/**
 * Custom error for quota exceeded
 */
export class QuotaExceededError extends Error {
  constructor(
    message: string,
    public readonly details: {
      limit: number;
      current: number;
      resetIn: number;
    }
  ) {
    super(message);
    this.name = "QuotaExceededError";
  }
}
```

---

## Environment File Template

```bash
# .env.example - Copy to .env and fill in values

# ============================================================================
# SERVER
# ============================================================================
NODE_ENV=development
PORT=3001
HOST=0.0.0.0
LOG_LEVEL=debug

# ============================================================================
# DATABASE
# ============================================================================
# PostgreSQL connection string
DATABASE_URL=postgres://buglens:buglens@localhost:5432/buglens

# ============================================================================
# REDIS
# ============================================================================
# Redis for BullMQ and caching
REDIS_URL=redis://localhost:6379

# ============================================================================
# AWS (Optional - for S3 storage)
# ============================================================================
AWS_REGION=us-east-1
# AWS_ACCESS_KEY_ID=your-access-key
# AWS_SECRET_ACCESS_KEY=your-secret-key
# S3_EVIDENCE_BUCKET=buglens-evidence
# S3_CODE_CACHE_BUCKET=buglens-code-cache

# ============================================================================
# GITHUB APP
# ============================================================================
# Create at: https://github.com/settings/apps
# GITHUB_APP_ID=123456
# GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
# GITHUB_WEBHOOK_SECRET=your-webhook-secret

# ============================================================================
# SENTRY
# ============================================================================
# Webhook secret from Sentry integration settings
SENTRY_WEBHOOK_SECRET=your-sentry-webhook-secret

# ============================================================================
# LLM CONFIGURATION
# ============================================================================
# Provider: 'openai' or 'deepseek'
LLM_PROVIDER=openai

# OpenAI (if LLM_PROVIDER=openai)
OPENAI_API_KEY=sk-your-openai-key

# DeepSeek (if LLM_PROVIDER=deepseek)
# DEEPSEEK_API_KEY=sk-your-deepseek-key
# LLM_BASE_URL=https://api.deepseek.com

# Optional: Override default model
# LLM_MODEL=gpt-4o-mini
LLM_MAX_TOKENS=2000
LLM_TEMPERATURE=0.1

# ============================================================================
# SLACK (Optional)
# ============================================================================
# SLACK_BOT_TOKEN=xoxb-your-bot-token
# SLACK_SIGNING_SECRET=your-signing-secret

# ============================================================================
# APPLICATION
# ============================================================================
APP_URL=http://localhost:3000

# Set to true to process errors from 'development' environment
ALLOW_DEV_ERRORS=true

# ============================================================================
# EVIDENCE COLLECTION
# ============================================================================
EVIDENCE_MAX_FRAMES=5
CODE_CONTEXT_LINES=15

# ============================================================================
# CORS
# ============================================================================
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# ============================================================================
# RATE LIMITS (Optional - overrides plan defaults)
# ============================================================================
# RATE_LIMIT_RCA_PER_HOUR=100
# RATE_LIMIT_LLM_TOKENS_PER_DAY=1000000
# RATE_LIMIT_GITHUB_API_PER_HOUR=1000
```

---

## Docker Compose Configuration

```yaml
# docker-compose.yml
version: "3.8"

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: buglens
      POSTGRES_PASSWORD: buglens
      POSTGRES_DB: buglens
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U buglens"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      SERVICES: s3
      DEFAULT_REGION: us-east-1
    volumes:
      - localstack_data:/var/lib/localstack

volumes:
  postgres_data:
  redis_data:
  localstack_data:
```

---

## Testing Configuration

```typescript
// tests/setup.ts
import { config } from "../src/utils/config";

// Override config for tests
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgres://buglens:buglens@localhost:5432/buglens_test";
process.env.REDIS_URL = "redis://localhost:6379/1"; // Different DB
process.env.LOG_LEVEL = "error"; // Quiet logs in tests

// Vitest setup
beforeAll(async () => {
  // Run migrations on test DB
  // await runMigrations();
});

afterAll(async () => {
  // Cleanup
  // await cleanupTestData();
});
```

---

## Configuration Best Practices

1. **Never commit secrets** - Use `.env.local` for local secrets, environment variables in production
2. **Validate early** - Config validation runs at module load, fails fast
3. **Use defaults wisely** - Sensible defaults for development, explicit values for production
4. **Document all variables** - `.env.example` should document every variable
5. **Type everything** - Zod provides runtime validation and TypeScript types
6. **Centralize config** - Single source of truth in `config.ts`
