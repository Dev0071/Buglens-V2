import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { ExtractionPipeline } from "../../src/services/event-extractor/extraction-pipeline.js";
import { DeterministicExtractor } from "../../src/services/event-extractor/deterministic-extractor.js";
import { LLMAssistExtractor } from "../../src/services/event-extractor/llm-assist-extractor.js";
import { ExtractionValidator } from "../../src/services/event-extractor/extraction-validator.js";
import { costTracker } from "../../src/services/cost-tracker.js";
import type {
  DeterministicExtractorOutput,
  LLMAssistOutput,
  ValidationOutput,
  ExtractedFrame,
} from "../../src/types/extraction.js";

// Mock dependencies
vi.mock("../../src/services/event-extractor/deterministic-extractor.js");
vi.mock("../../src/services/event-extractor/llm-assist-extractor.js");
vi.mock("../../src/services/event-extractor/extraction-validator.js");
vi.mock("../../src/services/cost-tracker.js");

describe("ExtractionPipeline", () => {
  let pipeline: ExtractionPipeline;
  let mockDeterministicExtractor: { extract: Mock };
  let mockLLMAssistExtractor: {
    extract: Mock;
    shouldTriggerLLM: Mock;
    determineNeededTasks: Mock;
  };
  let mockValidator: { validate: Mock };

  // Test fixtures
  const testEventId = "550e8400-e29b-41d4-a716-446655440000";
  const testOrgId = "550e8400-e29b-41d4-a716-446655440001";

  const createMockFrame = (
    filePath: string,
    lineNumber: number,
    isEntryPoint = false
  ): ExtractedFrame => ({
    file_path: filePath,
    line_number: lineNumber,
    classification: "user_code",
    is_entry_point: isEntryPoint,
    source_mapped: false,
    in_app: true,
  });

  const createStage1Output = (
    overrides: Partial<DeterministicExtractorOutput> = {}
  ): DeterministicExtractorOutput => ({
    repo: "test-org/test-repo",
    commit_sha: "abc123def456",
    branch: "main",
    release_tag: "v1.0.0",
    frames: [createMockFrame("src/app.ts", 42, true)],
    error_type: "TypeError",
    error_message: "Cannot read property 'foo' of undefined",
    platform: "javascript",
    environment: "production",
    is_complete: true,
    missing_fields: [],
    extraction_ms: 15,
    ...overrides,
  });

  const createValidationOutput = (
    overrides: Partial<ValidationOutput> = {}
  ): ValidationOutput => ({
    repo: "test-org/test-repo",
    commit_sha: "abc123def456",
    branch: "main",
    frames: [createMockFrame("src/app.ts", 42, true)],
    primary_frame: createMockFrame("src/app.ts", 42, true),
    checks: [{ check: "repo_exists", passed: true, fallback_used: false }],
    all_passed: true,
    fallbacks_used: 0,
    validation_ms: 50,
    ...overrides,
  });

  const createLLMAssistOutput = (
    overrides: Partial<LLMAssistOutput> = {}
  ): LLMAssistOutput => ({
    frames: [createMockFrame("src/app.ts", 42, true)],
    primary_frame_index: 0,
    suggested_branch: null,
    cleaned_frames_count: 1,
    removed_noise_count: 5,
    model: "gpt-4o-mini",
    tokens_used: 500,
    reasoning: "Cleaned noise frames",
    confidence: 0.85,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock instances
    mockDeterministicExtractor = { extract: vi.fn() };
    mockLLMAssistExtractor = {
      extract: vi.fn(),
      shouldTriggerLLM: vi.fn(),
      determineNeededTasks: vi.fn(),
    };
    mockValidator = { validate: vi.fn() };

    // Configure mocks
    (DeterministicExtractor as unknown as Mock).mockImplementation(
      () => mockDeterministicExtractor
    );
    (LLMAssistExtractor as unknown as Mock).mockImplementation(
      () => mockLLMAssistExtractor
    );
    (ExtractionValidator as unknown as Mock).mockImplementation(
      () => mockValidator
    );

    // Mock cost tracker
    (costTracker.recordExtraction as Mock).mockResolvedValue(undefined);

    pipeline = new ExtractionPipeline();
  });

  describe("3-stage pipeline orchestration", () => {
    it("should run Stage 1 deterministic extraction first", async () => {
      const stage1Output = createStage1Output();
      mockDeterministicExtractor.extract.mockResolvedValue(stage1Output);
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      const payload = { exception: { values: [] } };
      await pipeline.extract(testEventId, testOrgId, payload);

      expect(mockDeterministicExtractor.extract).toHaveBeenCalledTimes(1);
      expect(mockDeterministicExtractor.extract).toHaveBeenCalledWith({
        event_id: testEventId,
        org_id: testOrgId,
        raw_payload: payload,
      });
    });

    it("should skip Stage 2 when Stage 1 is complete", async () => {
      const stage1Output = createStage1Output({ is_complete: true });
      mockDeterministicExtractor.extract.mockResolvedValue(stage1Output);
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      const result = await pipeline.extract(testEventId, testOrgId, {});

      expect(mockLLMAssistExtractor.extract).not.toHaveBeenCalled();
      expect(result.stages_used).not.toContain("stage_2_llm_assist");
      expect(result.stages_used).toContain("stage_1_deterministic");
      expect(result.stages_used).toContain("stage_3_validation");
    });

    it("should always run Stage 3 validation", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output()
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      const result = await pipeline.extract(testEventId, testOrgId, {});

      expect(mockValidator.validate).toHaveBeenCalledTimes(1);
      expect(result.stages_used).toContain("stage_3_validation");
    });

    it("should pass correct data through all stages", async () => {
      const frames = [
        createMockFrame("src/services/auth.ts", 100, true),
        createMockFrame("src/utils/helper.ts", 50),
      ];
      const stage1Output = createStage1Output({ frames });
      mockDeterministicExtractor.extract.mockResolvedValue(stage1Output);
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(
        createValidationOutput({ frames, primary_frame: frames[0] })
      );

      const result = await pipeline.extract(testEventId, testOrgId, {});

      expect(result.frames).toHaveLength(2);
      expect(result.primary_frame?.file_path).toBe("src/services/auth.ts");
    });
  });

  describe("Stage 2 transition logic", () => {
    it("should trigger Stage 2 when shouldTriggerLLM returns true", async () => {
      const stage1Output = createStage1Output({
        is_complete: false,
        missing_fields: ["commit_sha"],
      });
      mockDeterministicExtractor.extract.mockResolvedValue(stage1Output);
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(true);
      mockLLMAssistExtractor.extract.mockResolvedValue(createLLMAssistOutput());
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      const result = await pipeline.extract(testEventId, testOrgId, {
        exception: { values: [{ stacktrace: { frames: [] } }] },
      });

      expect(mockLLMAssistExtractor.extract).toHaveBeenCalledTimes(1);
      expect(result.stages_used).toContain("stage_2_llm_assist");
    });

    it("should not trigger Stage 2 when Stage 1 is complete", async () => {
      const stage1Output = createStage1Output({ is_complete: true });
      mockDeterministicExtractor.extract.mockResolvedValue(stage1Output);
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      await pipeline.extract(testEventId, testOrgId, {});

      expect(mockLLMAssistExtractor.extract).not.toHaveBeenCalled();
    });

    it("should use LLM frames when Stage 2 runs", async () => {
      const stage1Frames = [createMockFrame("src/old.ts", 1)];
      const llmFrames = [
        createMockFrame("src/cleaned.ts", 42, true),
        createMockFrame("src/helper.ts", 10),
      ];

      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ frames: stage1Frames, is_complete: false })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(true);
      mockLLMAssistExtractor.extract.mockResolvedValue(
        createLLMAssistOutput({ frames: llmFrames })
      );
      mockValidator.validate.mockResolvedValue(
        createValidationOutput({ frames: llmFrames })
      );

      const result = await pipeline.extract(testEventId, testOrgId, {
        exception: { values: [{ stacktrace: { frames: [] } }] },
      });

      // Validator should receive LLM frames, not Stage 1 frames
      expect(mockValidator.validate).toHaveBeenCalledWith(
        expect.objectContaining({
          frames: llmFrames,
        })
      );
      expect(result.frames).toEqual(llmFrames);
    });

    it("should update branch from LLM suggestion", async () => {
      const stage1Output = createStage1Output({
        branch: null,
        is_complete: false,
      });
      mockDeterministicExtractor.extract.mockResolvedValue(stage1Output);
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(true);
      mockLLMAssistExtractor.extract.mockResolvedValue(
        createLLMAssistOutput({ suggested_branch: "feature/new-api" })
      );
      mockValidator.validate.mockResolvedValue(
        createValidationOutput({ branch: "feature/new-api" })
      );

      await pipeline.extract(testEventId, testOrgId, {
        exception: { values: [{ stacktrace: { frames: [] } }] },
      });

      // Verify branch was updated before validation
      expect(mockValidator.validate).toHaveBeenCalledWith(
        expect.objectContaining({
          branch: "feature/new-api",
        })
      );
    });
  });

  describe("confidence score calculation", () => {
    it("should calculate high confidence when Stage 1 complete and validation passes", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ is_complete: true })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(
        createValidationOutput({
          all_passed: true,
          fallbacks_used: 0,
        })
      );

      const result = await pipeline.extract(testEventId, testOrgId, {});

      // Base: 0.4 (complete) + 0.3 (validation) + 0.2 (frames) + 0.1 (primary)
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("should reduce confidence when fallbacks are used", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ is_complete: true })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(
        createValidationOutput({
          all_passed: true,
          fallbacks_used: 3, // -0.15 penalty
        })
      );

      const result = await pipeline.extract(testEventId, testOrgId, {});

      // Should be reduced by 3 * 0.05 = 0.15
      expect(result.confidence).toBeLessThan(0.9);
    });

    it("should reduce confidence when LLM is used", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ is_complete: false })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(true);
      mockLLMAssistExtractor.extract.mockResolvedValue(
        createLLMAssistOutput({ tokens_used: 500 })
      );
      mockValidator.validate.mockResolvedValue(
        createValidationOutput({ all_passed: true })
      );

      const resultWithLLM = await pipeline.extract(testEventId, testOrgId, {
        exception: { values: [{ stacktrace: { frames: [] } }] },
      });

      // Should have -0.05 penalty for LLM usage
      expect(resultWithLLM.confidence).toBeLessThan(1.0);
    });

    it("should have low confidence when validation fails", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ is_complete: false })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(
        createValidationOutput({
          all_passed: false,
          frames: [],
          primary_frame: null,
        })
      );

      const result = await pipeline.extract(testEventId, testOrgId, {});

      // Base: 0.2 (incomplete) + 0.1 (validation failed) = 0.3
      expect(result.confidence).toBeLessThanOrEqual(0.4);
    });

    it("should clamp confidence to [0, 1] range", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ is_complete: false })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(
        createValidationOutput({
          all_passed: false,
          fallbacks_used: 100, // Extreme penalty
          frames: [],
          primary_frame: null,
        })
      );

      const result = await pipeline.extract(testEventId, testOrgId, {});

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("error recovery and fallback behavior", () => {
    it("should return error result when pipeline throws", async () => {
      mockDeterministicExtractor.extract.mockRejectedValue(
        new Error("Database connection failed")
      );

      const result = await pipeline.extract(testEventId, testOrgId, {});

      expect(result.is_complete).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.issues).toContain(
        "Pipeline error: Database connection failed"
      );
      expect(result.frames).toHaveLength(0);
    });

    it("should handle Stage 2 LLM failure gracefully", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ is_complete: false })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(true);
      mockLLMAssistExtractor.extract.mockRejectedValue(
        new Error("LLM service unavailable")
      );
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      // Pipeline should catch LLM error internally and continue
      // Note: The actual implementation handles this in LLMAssistExtractor
      // This test verifies pipeline-level error handling
      const result = await pipeline.extract(testEventId, testOrgId, {
        exception: { values: [{ stacktrace: { frames: [] } }] },
      });

      // Should still complete with Stage 1 frames
      expect(result.extraction_id).toBeDefined();
    });

    it("should handle validator failure gracefully", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output()
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockRejectedValue(
        new Error("GitHub API rate limited")
      );

      const result = await pipeline.extract(testEventId, testOrgId, {});

      expect(result.is_complete).toBe(false);
      expect(
        result.issues.some((i) => i.includes("GitHub API rate limited"))
      ).toBe(true);
    });

    it("should track issues from missing fields", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({
          is_complete: false,
          missing_fields: ["repo", "commit_sha"],
        })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      const result = await pipeline.extract(testEventId, testOrgId, {});

      expect(result.issues).toContain("Missing: repo, commit_sha");
    });

    it("should track issues from failed validation checks", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output()
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(
        createValidationOutput({
          all_passed: false,
          checks: [
            { check: "repo_exists", passed: true, fallback_used: false },
            {
              check: "file_exists",
              passed: false,
              message: "File not found: src/missing.ts",
              fallback_used: false,
            },
          ],
        })
      );

      const result = await pipeline.extract(testEventId, testOrgId, {});

      expect(result.issues.some((i) => i.includes("file_exists"))).toBe(true);
    });
  });

  describe("cost tracking integration", () => {
    it("should record extraction metrics after successful extraction", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output()
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      await pipeline.extract(testEventId, testOrgId, {});

      expect(costTracker.recordExtraction).toHaveBeenCalledWith(
        expect.objectContaining({
          org_id: testOrgId,
          stage_reached: 1, // Only Stage 1
          is_complete: true,
          llm_tokens_used: 0,
          validation_passed: true,
        })
      );
    });

    it("should record Stage 2 metrics when LLM is used", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ is_complete: false })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(true);
      mockLLMAssistExtractor.extract.mockResolvedValue(
        createLLMAssistOutput({ tokens_used: 750 })
      );
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      await pipeline.extract(testEventId, testOrgId, {
        exception: { values: [{ stacktrace: { frames: [] } }] },
      });

      expect(costTracker.recordExtraction).toHaveBeenCalledWith(
        expect.objectContaining({
          stage_reached: 2, // Stage 2 used
          llm_tokens_used: 750,
        })
      );
    });

    it("should not fail extraction if cost tracking fails", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output()
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(createValidationOutput());
      (costTracker.recordExtraction as Mock).mockRejectedValue(
        new Error("Metrics DB down")
      );

      const result = await pipeline.extract(testEventId, testOrgId, {});

      // Should still return valid result despite metrics failure
      expect(result.is_complete).toBe(true);
      expect(result.extraction_id).toBeDefined();
    });

    it("should include extraction time in metrics", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output()
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      await pipeline.extract(testEventId, testOrgId, {});

      expect(costTracker.recordExtraction).toHaveBeenCalledWith(
        expect.objectContaining({
          extraction_ms: expect.any(Number),
        })
      );
    });
  });

  describe("extraction result completeness", () => {
    it("should mark result complete when repo and frames are present", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output()
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      const result = await pipeline.extract(testEventId, testOrgId, {});

      expect(result.is_complete).toBe(true);
    });

    it("should mark result incomplete when repo is missing", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ repo: null })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(
        createValidationOutput({ repo: null })
      );

      const result = await pipeline.extract(testEventId, testOrgId, {});

      expect(result.is_complete).toBe(false);
    });

    it("should mark result incomplete when no frames validated", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output()
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(false);
      mockValidator.validate.mockResolvedValue(
        createValidationOutput({ frames: [], primary_frame: null })
      );

      const result = await pipeline.extract(testEventId, testOrgId, {});

      expect(result.is_complete).toBe(false);
    });

    it("should set final stage to last stage used", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ is_complete: false })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(true);
      mockLLMAssistExtractor.extract.mockResolvedValue(createLLMAssistOutput());
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      const result = await pipeline.extract(testEventId, testOrgId, {
        exception: { values: [{ stacktrace: { frames: [] } }] },
      });

      expect(result.extraction_stage).toBe("stage_3_validation");
      expect(result.stages_used).toEqual([
        "stage_1_deterministic",
        "stage_2_llm_assist",
        "stage_3_validation",
      ]);
    });
  });

  describe("raw frame extraction from payload", () => {
    it("should extract frames from Sentry exception payload", async () => {
      const rawFrames = [
        { filename: "src/app.ts", lineno: 10 },
        { filename: "src/helper.ts", lineno: 20 },
      ];
      const payload = {
        exception: {
          values: [{ stacktrace: { frames: rawFrames } }],
        },
      };

      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ is_complete: false })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(true);
      mockLLMAssistExtractor.extract.mockResolvedValue(createLLMAssistOutput());
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      await pipeline.extract(testEventId, testOrgId, payload);

      expect(mockLLMAssistExtractor.extract).toHaveBeenCalledWith(
        expect.anything(),
        rawFrames,
        expect.anything()
      );
    });

    it("should handle multiple exception values", async () => {
      const payload = {
        exception: {
          values: [
            { stacktrace: { frames: [{ filename: "src/a.ts", lineno: 1 }] } },
            { stacktrace: { frames: [{ filename: "src/b.ts", lineno: 2 }] } },
          ],
        },
      };

      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ is_complete: false })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(true);
      mockLLMAssistExtractor.extract.mockResolvedValue(createLLMAssistOutput());
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      await pipeline.extract(testEventId, testOrgId, payload);

      // Should combine frames from all exceptions
      expect(mockLLMAssistExtractor.extract).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          { filename: "src/a.ts", lineno: 1 },
          { filename: "src/b.ts", lineno: 2 },
        ]),
        expect.anything()
      );
    });

    it("should handle missing exception gracefully", async () => {
      mockDeterministicExtractor.extract.mockResolvedValue(
        createStage1Output({ is_complete: false })
      );
      mockLLMAssistExtractor.shouldTriggerLLM.mockReturnValue(true);
      mockLLMAssistExtractor.extract.mockResolvedValue(createLLMAssistOutput());
      mockValidator.validate.mockResolvedValue(createValidationOutput());

      await pipeline.extract(testEventId, testOrgId, {
        message: "No stacktrace",
      });

      // Should call with empty array
      expect(mockLLMAssistExtractor.extract).toHaveBeenCalledWith(
        expect.anything(),
        [],
        expect.anything()
      );
    });
  });
});
