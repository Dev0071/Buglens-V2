import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  // Application
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

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

  // Redis
  REDIS_URL: z.string().url(),
  REDIS_MAX_RETRIES: z.coerce.number().default(3),

  // AWS
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET_NAME: z.string(),
  S3_ENDPOINT: z.string().url().optional(), // LocalStack endpoint for local dev
  SECRETS_MANAGER_PREFIX: z.string().default("buglens/"),

  // Authentication
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // LLM Configuration
  OPENAI_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(["openai", "deepseek"]).default("openai"),
  LLM_MODEL: z.string().optional(), // Override default model (e.g., "deepseek-chat")
  LLM_BASE_URL: z.string().url().optional(), // Custom API base URL for DeepSeek etc.

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
  GITHUB_APP_PRIVATE_KEY_SECRET_ID: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

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
