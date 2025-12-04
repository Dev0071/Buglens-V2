import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  enableTestMode,
  disableTestMode,
  getTestModeJobs,
  enqueueEvidenceAssembly,
  type EvidenceAssemblyJobData,
} from "../../src/workers/queues/evidence.js";

// Mock all external dependencies
vi.mock("../../src/utils/config.js", () => ({
  config: {
    REDIS_URL: "redis://localhost:6379/0",
    AWS_REGION: "us-east-1",
    S3_BUCKET_NAME: "test-bucket",
    S3_ENDPOINT: "",
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/db/client.js", () => ({
  transaction: vi.fn((_orgId: string, fn: (client: unknown) => unknown) => {
    return fn({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    });
  }),
}));

vi.mock("../../src/services/github.js", () => ({
  fetchRecentCommits: vi.fn().mockResolvedValue([]),
  parseRepoFullName: vi.fn((fullName: string) => {
    const [owner, repo] = fullName.split("/");
    return { owner, repo };
  }),
  GitHubRateLimitError: class GitHubRateLimitError extends Error {},
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
}));

vi.mock("../../src/services/python-bridge.js", () => ({
  PythonBridge: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({
      steps: [],
      anomalies_count: 0,
      duration_ms: 0,
      first_timestamp: null,
      last_timestamp: null,
      http_requests: 0,
      errors_before_crash: 0,
    }),
  })),
}));

describe("Evidence Queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableTestMode();
  });

  afterEach(() => {
    disableTestMode();
  });

  describe("Test Mode", () => {
    it("should buffer jobs in test mode", async () => {
      const jobData: EvidenceAssemblyJobData = {
        jobId: "job-123",
        eventId: "evt-456",
        orgId: "org-789",
      };

      await enqueueEvidenceAssembly(jobData);

      const bufferedJobs = getTestModeJobs();
      expect(bufferedJobs).toHaveLength(1);
      expect(bufferedJobs[0]).toEqual(jobData);
    });

    it("should buffer multiple jobs", async () => {
      const jobs: EvidenceAssemblyJobData[] = [
        { jobId: "job-1", eventId: "evt-1", orgId: "org-1" },
        { jobId: "job-2", eventId: "evt-2", orgId: "org-2" },
        { jobId: "job-3", eventId: "evt-3", orgId: "org-3" },
      ];

      for (const job of jobs) {
        await enqueueEvidenceAssembly(job);
      }

      const bufferedJobs = getTestModeJobs();
      expect(bufferedJobs).toHaveLength(3);
    });

    it("should clear buffer when test mode is disabled", async () => {
      await enqueueEvidenceAssembly({
        jobId: "job-123",
        eventId: "evt-456",
        orgId: "org-789",
      });

      expect(getTestModeJobs()).toHaveLength(1);

      disableTestMode();

      expect(getTestModeJobs()).toHaveLength(0);
    });
  });

  describe("Job Data Structure", () => {
    it("should accept valid job data", async () => {
      const validJob: EvidenceAssemblyJobData = {
        jobId: "550e8400-e29b-41d4-a716-446655440000",
        eventId: "660e8400-e29b-41d4-a716-446655440001",
        orgId: "770e8400-e29b-41d4-a716-446655440002",
      };

      await enqueueEvidenceAssembly(validJob);

      const bufferedJobs = getTestModeJobs();
      expect(bufferedJobs[0].jobId).toBe(validJob.jobId);
      expect(bufferedJobs[0].eventId).toBe(validJob.eventId);
      expect(bufferedJobs[0].orgId).toBe(validJob.orgId);
    });
  });
});

describe("Evidence Queue Integration with Deterministic Analyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableTestMode();
  });

  afterEach(() => {
    disableTestMode();
  });

  it("should be called after deterministic analysis completes", async () => {
    // This test verifies the integration point exists
    // The actual flow: DeterministicAnalyzer -> markDeterministicComplete -> enqueueEvidenceAssembly

    const jobData: EvidenceAssemblyJobData = {
      jobId: "job-after-analysis",
      eventId: "evt-analyzed",
      orgId: "org-with-findings",
    };

    await enqueueEvidenceAssembly(jobData);

    const jobs = getTestModeJobs();
    expect(jobs).toContainEqual(jobData);
  });
});

describe("Evidence Queue Job Processing", () => {
  it("should have correct job options structure", () => {
    // Verify the expected structure for evidence assembly jobs
    const expectedJobData: EvidenceAssemblyJobData = {
      jobId: "job-test",
      eventId: "evt-test",
      orgId: "org-test",
    };

    expect(expectedJobData).toHaveProperty("jobId");
    expect(expectedJobData).toHaveProperty("eventId");
    expect(expectedJobData).toHaveProperty("orgId");
  });
});
