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

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),

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

  // Python integration
  PYTHON_BIN: z.string().default("python3"),
  PYTHON_ANALYZER_TIMEOUT_MS: z.coerce.number().default(10000),

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
    console.error("❌ Invalid environment variables:");
    console.error(JSON.stringify(error.format(), null, 2));
    process.exit(1);
  }
  throw error;
}

export { config };
