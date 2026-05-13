import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  // Application
  NODE_ENV: z
    .enum(["development", "staging", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  FRONTEND_URL: z.string().default("http://localhost:3002"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Base URLs (validated for OAuth callbacks and notifications)
  API_BASE_URL: z.string().url().optional(), // Backend API URL (e.g., https://api.buglens.com)
  APP_BASE_URL: z.string().url().optional(), // Frontend app URL (e.g., https://app.buglens.com)

  // CORS (comma-separated origins, e.g., "https://app.buglens.com,https://buglens.com")
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((val) =>
      val ? val.split(",").map((s) => s.trim()) : undefined
    ),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(10),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((val) => val === "true"),

  // Redis — primary connection via URL or explicit components.
  // When REDIS_HOST is set the explicit vars take precedence over URL parsing,
  // which avoids issues with managed-DB URLs that omit the password or use a
  // non-standard format (e.g. DigitalOcean's DATABASE_URL binding for Redis).
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.coerce.number().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z.coerce.boolean().default(false),
  REDIS_MAX_RETRIES: z.coerce.number().default(3),

  // AWS
  // No default — must be set explicitly when S3 or Secrets Manager is used.
  // Different vendors embed regions differently in endpoint URLs (or not at all),
  // so we never infer the region from the endpoint URL.
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  SECRETS_MANAGER_PREFIX: z.string().default("buglens/"),

  // Authentication
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // LLM Configuration
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(["openai", "deepseek", "anthropic"]).default("openai"),
  LLM_MODEL: z.string().optional(),
  LLM_BASE_URL: z.string().url().optional(),

  // Development Testing
  ALLOW_DEV_ERRORS: z.coerce.boolean().default(true), // Allow processing local/dev errors

  // Sentry
  SENTRY_DSN: z.string().optional(),
  SENTRY_WEBHOOK_SECRET: z.string().optional(),

  // Slack
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),

  // GitHub
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_NAME: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_SECRET_ID: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // GitHub OAuth for login
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),

  // Google OAuth for login
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),

  // Jira (Atlassian OAuth 2.0)
  JIRA_CLIENT_ID: z.string().optional(),
  JIRA_CLIENT_SECRET: z.string().optional(),

  // Microsoft Teams (Azure AD OAuth 2.0)
  TEAMS_CLIENT_ID: z.string().optional(),
  TEAMS_CLIENT_SECRET: z.string().optional(),
  TEAMS_TENANT_ID: z.string().optional(), // 'common' for multi-tenant apps

  // Python integration
  PYTHON_BIN: z.string().default("python3"),
  PYTHON_ANALYZER_TIMEOUT_MS: z.coerce.number().default(10000),
  PYTHON_LLM_TIMEOUT_MS: z.coerce.number().default(30000), // LLM calls need more time

  // Rate Limits
  RATE_LIMIT_FREE_EVENTS_PER_HOUR: z.coerce.number().default(100),
  RATE_LIMIT_FREE_RCA_JOBS_PER_DAY: z.coerce.number().default(50),
  RATE_LIMIT_FREE_LLM_TOKENS_PER_DAY: z.coerce.number().default(100000),

  // Admin Security
  PLATFORM_ADMIN_TOKEN: z.string().min(32).optional(), // Required for secret management API
}).superRefine((env, ctx) => {
  // If S3 is configured (bucket name is set), AWS_REGION must be provided explicitly.
  // We do not infer the region from the endpoint URL because vendors encode regions
  // differently (or not at all): DO Spaces puts it in the subdomain, Cloudflare R2 uses
  // "auto", MinIO has no region in the URL, Backblaze uses a different path pattern.
  if (env.S3_BUCKET_NAME && !env.AWS_REGION) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AWS_REGION"],
      message:
        "AWS_REGION is required when S3_BUCKET_NAME is set. " +
        "Set it to match your storage provider's region (e.g. nyc3 for DO Spaces, us-east-1 for AWS).",
    });
  }
});

export type Config = z.infer<typeof envSchema>;

let config: Config;

try {
  config = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    // eslint-disable-next-line no-console -- Critical startup error before logger is available
    console.error("❌ Invalid environment variables:");
    // eslint-disable-next-line no-console -- Critical startup error before logger is available
    console.error(JSON.stringify(error.format(), null, 2));
    process.exit(1);
  }
  throw error;
}

export { config };
