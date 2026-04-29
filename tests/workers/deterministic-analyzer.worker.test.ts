import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Job } from "bullmq";
import type { DeterministicAnalyzerJobData } from "../../src/workers/queues/deterministic.js";

// Mock dependencies before importing the module
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/utils/config.js", () => ({
  config: {
    REDIS_URL: "redis://localhost:6379",
    DATABASE_URL: "postgres://localhost/test",
    NODE_ENV: "test",
  },
}));

vi.mock("../../src/db/client.js", () => ({
  transaction: vi.fn(),
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

// Mock the service
const mockProcess = vi.fn();
vi.mock("../../src/services/deterministic-analyzer.js", () => ({
  DeterministicAnalyzerService: vi.fn().mockImplementation(() => ({
    process: mockProcess,
  })),
}));

// Import logger for assertions
import { logger } from "../../src/utils/logger.js";
import { createDeterministicProcessor } from "../../src/workers/deterministic-analyzer.worker.js";

/**
 * Tests for Deterministic Analyzer Worker
 *
 * Uses the extracted createDeterministicProcessor function for direct testing
 * of the job processing logic. Worker event handlers and BullMQ integration
 * are tested via integration tests.
 */
describe("Deterministic Analyzer Worker", () => {
  const mockService = { process: mockProcess };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Job Processing", () => {
    it("should process job and call service.process with job data", async () => {
      mockProcess.mockResolvedValue(undefined);

      const processor = createDeterministicProcessor(mockService as any);

      const mockJobData: DeterministicAnalyzerJobData = {
        jobId: "job-123",
        eventId: "evt-456",
        orgId: "org-789",
      };

      const mockJob = {
        data: mockJobData,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      const result = await processor(mockJob);

      expect(mockProcess).toHaveBeenCalledWith(mockJobData);
      expect(mockProcess).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, durationMs: expect.any(Number) });
    });

    it("should handle AST parsing failures gracefully", async () => {
      const astError = new Error("Failed to parse AST: Unexpected token");
      mockProcess.mockRejectedValue(astError);

      const processor = createDeterministicProcessor(mockService as any);

      const mockJobData: DeterministicAnalyzerJobData = {
        jobId: "job-ast-fail",
        eventId: "evt-456",
        orgId: "org-789",
      };

      const mockJob = {
        data: mockJobData,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await expect(processor(mockJob)).rejects.toThrow(
        "Failed to parse AST: Unexpected token"
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: "job-ast-fail",
          error: "Failed to parse AST: Unexpected token",
          status: "failed",
        }),
        expect.stringContaining("failed")
      );
    });

    it("should retry on transient errors up to max retries", async () => {
      const transientError = new Error("Database connection timeout");
      mockProcess.mockRejectedValue(transientError);

      const processor = createDeterministicProcessor(mockService as any);

      // Simulate first attempt (0), should retry
      const mockJob1 = {
        data: { jobId: "job-retry", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      // First attempt fails
      await expect(processor(mockJob1)).rejects.toThrow(
        "Database connection timeout"
      );

      // Simulate second attempt
      const mockJob2 = {
        data: { jobId: "job-retry", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await expect(processor(mockJob2)).rejects.toThrow(
        "Database connection timeout"
      );

      // Third attempt (last)
      const mockJob3 = {
        data: { jobId: "job-retry", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 2,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await expect(processor(mockJob3)).rejects.toThrow(
        "Database connection timeout"
      );

      expect(mockProcess).toHaveBeenCalledTimes(3);
    });

    it("should log error details on job failure", async () => {
      const permanentError = new Error("Unrecoverable error");
      mockProcess.mockRejectedValue(permanentError);

      const processor = createDeterministicProcessor(mockService as any);

      const mockJob = {
        data: { jobId: "job-exhausted", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 2,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await expect(processor(mockJob)).rejects.toThrow("Unrecoverable error");

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: "job-exhausted",
          attempt: 3,
          error: "Unrecoverable error",
          status: "failed",
        }),
        expect.stringContaining("failed")
      );
    });

    it("should track processing time for successful jobs", async () => {
      // Simulate a job that takes 50ms
      mockProcess.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const processor = createDeterministicProcessor(mockService as any);

      const mockJobData: DeterministicAnalyzerJobData = {
        jobId: "job-timing",
        eventId: "evt-456",
        orgId: "org-789",
      };

      const mockJob = {
        data: mockJobData,
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      const result = await processor(mockJob);

      // Check that duration was logged and returned
      expect(result.durationMs).toBeGreaterThanOrEqual(50);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: "job-timing",
          status: "success",
          durationMs: expect.any(Number),
        }),
        expect.stringContaining("completed")
      );
    });

    it("should log job start with attempt information", async () => {
      mockProcess.mockResolvedValue(undefined);

      const processor = createDeterministicProcessor(mockService as any);

      const mockJob = {
        data: { jobId: "job-start", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await processor(mockJob);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: "job-start",
          attempt: 2,
          maxAttempts: 3,
          worker: "deterministic-analyzer",
        }),
        expect.stringContaining("starting")
      );
    });

    it("should handle job with default retry count", async () => {
      mockProcess.mockResolvedValue(undefined);

      const processor = createDeterministicProcessor(mockService as any);

      const mockJob = {
        data: { jobId: "job-defaults", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 0,
        opts: {}, // No attempts specified
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await processor(mockJob);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          maxAttempts: 3, // Default fallback
        }),
        expect.any(String)
      );
    });

    it("should return success result with duration on completion", async () => {
      mockProcess.mockResolvedValue(undefined);

      const processor = createDeterministicProcessor(mockService as any);

      const mockJob = {
        data: { jobId: "job-result", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      const result = await processor(mockJob);

      expect(result).toMatchObject({
        success: true,
        durationMs: expect.any(Number),
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Processor Error Handling", () => {
    it("should handle non-Error exceptions", async () => {
      mockProcess.mockRejectedValue("string error");

      const processor = createDeterministicProcessor(mockService as any);

      const mockJob = {
        data: { jobId: "job-string-err", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await expect(processor(mockJob)).rejects.toBe("string error");

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "string error",
        }),
        expect.any(String)
      );
    });

    it("should include error stack in logs when available", async () => {
      const errorWithStack = new Error("Error with stack");
      mockProcess.mockRejectedValue(errorWithStack);

      const processor = createDeterministicProcessor(mockService as any);

      const mockJob = {
        data: { jobId: "job-stack", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await expect(processor(mockJob)).rejects.toThrow("Error with stack");

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          errorStack: expect.stringContaining("Error with stack"),
        }),
        expect.any(String)
      );
    });

    it("should handle null error gracefully", async () => {
      mockProcess.mockRejectedValue(null);

      const processor = createDeterministicProcessor(mockService as any);

      const mockJob = {
        data: { jobId: "job-null", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await expect(processor(mockJob)).rejects.toBe(null);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "null",
        }),
        expect.any(String)
      );
    });

    it("should calculate duration correctly even on failure", async () => {
      mockProcess.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw new Error("Delayed failure");
      });

      const processor = createDeterministicProcessor(mockService as any);

      const mockJob = {
        data: { jobId: "job-delayed-fail", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await expect(processor(mockJob)).rejects.toThrow("Delayed failure");

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: expect.any(Number),
        }),
        expect.any(String)
      );

      // Verify duration is at least 20ms (30ms setTimeout minus OS timer tolerance)
      const logCall = vi.mocked(logger.error).mock.calls[0];
      if (
        logCall &&
        typeof logCall[0] === "object" &&
        logCall[0] !== null &&
        "durationMs" in logCall[0]
      ) {
        expect(
          (logCall[0] as { durationMs: number }).durationMs
        ).toBeGreaterThanOrEqual(20);
      }
    });

    it("should handle undefined error gracefully", async () => {
      mockProcess.mockRejectedValue(undefined);

      const processor = createDeterministicProcessor(mockService as any);

      const mockJob = {
        data: { jobId: "job-undefined", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await expect(processor(mockJob)).rejects.toBe(undefined);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "undefined",
        }),
        expect.any(String)
      );
    });
  });

  describe("Logging", () => {
    it("should log job start with complete context", async () => {
      mockProcess.mockResolvedValue(undefined);

      const processor = createDeterministicProcessor(mockService as any);

      const mockJob = {
        data: { jobId: "job-ctx", eventId: "evt-ctx", orgId: "org-ctx" },
        attemptsMade: 0,
        opts: { attempts: 5 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await processor(mockJob);

      expect(logger.info).toHaveBeenCalledWith(
        {
          jobId: "job-ctx",
          eventId: "evt-ctx",
          orgId: "org-ctx",
          attempt: 1,
          maxAttempts: 5,
          worker: "deterministic-analyzer",
        },
        "[JOB:START] Deterministic analysis starting"
      );
    });

    it("should log success with duration breakdown", async () => {
      mockProcess.mockResolvedValue(undefined);

      const processor = createDeterministicProcessor(mockService as any);

      const mockJob = {
        data: { jobId: "job-success", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await processor(mockJob);

      const successLogs = vi
        .mocked(logger.info)
        .mock.calls.filter((call) => (call[1] as string)?.includes("SUCCESS"));

      expect(successLogs.length).toBe(1);
      expect(successLogs[0][0]).toMatchObject({
        jobId: "job-success",
        status: "success",
        durationMs: expect.any(Number),
        durationSec: expect.any(String),
      });
    });

    it("should log failure with complete error context", async () => {
      const error = new Error("Test failure");
      mockProcess.mockRejectedValue(error);

      const processor = createDeterministicProcessor(mockService as any);

      const mockJob = {
        data: { jobId: "job-fail-log", eventId: "evt-1", orgId: "org-1" },
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as unknown as Job<DeterministicAnalyzerJobData>;

      await expect(processor(mockJob)).rejects.toThrow("Test failure");

      expect(logger.error).toHaveBeenCalledWith(
        {
          jobId: "job-fail-log",
          eventId: "evt-1",
          orgId: "org-1",
          durationMs: expect.any(Number),
          attempt: 2,
          error: "Test failure",
          errorStack: expect.stringContaining("Test failure"),
          worker: "deterministic-analyzer",
          status: "failed",
        },
        "[JOB:ERROR] Deterministic analysis failed"
      );
    });
  });
});
