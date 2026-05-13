import { S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { logger } from "./logger.js";

let sharedS3Client: S3Client | null = null;

/**
 * Returns a singleton S3Client configured for the current environment.
 *
 * Region comes exclusively from the AWS_REGION env var — we never infer it
 * from the endpoint URL. Different vendors embed regions differently (or not
 * at all), so URL parsing would be fragile and vendor-specific. The startup
 * config validation (config.ts superRefine) ensures AWS_REGION is always set
 * when S3_BUCKET_NAME is configured, so reaching here without a region is a
 * programming error, not a runtime condition.
 */
export function getSharedS3Client(): S3Client {
  if (sharedS3Client) return sharedS3Client;

  if (!config.AWS_REGION) {
    throw new Error(
      "AWS_REGION is not set. S3 client cannot be created without a region. " +
      "Set AWS_REGION in your environment variables."
    );
  }

  logger.debug(
    { region: config.AWS_REGION, endpoint: config.S3_ENDPOINT ?? "AWS default" },
    "Creating S3 client"
  );

  sharedS3Client = new S3Client({
    region: config.AWS_REGION,
    ...(config.S3_ENDPOINT
      ? {
          endpoint: config.S3_ENDPOINT,
          forcePathStyle: true,
        }
      : {}),
    ...(config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: config.AWS_ACCESS_KEY_ID,
            secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });

  return sharedS3Client;
}

/** Reset the singleton — used in tests only. */
export function resetS3Client(): void {
  sharedS3Client = null;
}

export function isS3Configured(): boolean {
  return !!(
    config.S3_BUCKET_NAME &&
    config.AWS_ACCESS_KEY_ID &&
    config.AWS_SECRET_ACCESS_KEY
  );
}
