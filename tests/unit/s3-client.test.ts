import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock config and logger before importing s3-client
vi.mock("../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("getSharedS3Client", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("throws a clear error when AWS_REGION is not set", async () => {
    vi.doMock("../../src/utils/config.js", () => ({
      config: {
        AWS_REGION: undefined,
        S3_ENDPOINT: undefined,
        AWS_ACCESS_KEY_ID: undefined,
        AWS_SECRET_ACCESS_KEY: undefined,
      },
    }));
    const { getSharedS3Client } = await import("../../src/utils/s3-client.js");
    expect(() => getSharedS3Client()).toThrow("AWS_REGION is not set");
  });

  it("creates a client when AWS_REGION is set", async () => {
    vi.doMock("../../src/utils/config.js", () => ({
      config: {
        AWS_REGION: "nyc3",
        S3_ENDPOINT: "https://nyc3.digitaloceanspaces.com",
        AWS_ACCESS_KEY_ID: "test-key",
        AWS_SECRET_ACCESS_KEY: "test-secret",
      },
    }));
    const { getSharedS3Client } = await import("../../src/utils/s3-client.js");
    expect(() => getSharedS3Client()).not.toThrow();
  });

  it("returns the same instance on repeated calls (singleton)", async () => {
    vi.doMock("../../src/utils/config.js", () => ({
      config: {
        AWS_REGION: "us-east-1",
        S3_ENDPOINT: undefined,
        AWS_ACCESS_KEY_ID: undefined,
        AWS_SECRET_ACCESS_KEY: undefined,
      },
    }));
    const { getSharedS3Client } = await import("../../src/utils/s3-client.js");
    const a = getSharedS3Client();
    const b = getSharedS3Client();
    expect(a).toBe(b);
  });
});
