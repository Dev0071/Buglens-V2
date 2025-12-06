import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { LLMAssistExtractor } from "../../src/services/event-extractor/llm-assist-extractor.js";
import { PythonBridge } from "../../src/services/python-bridge.js";
import type {
  DeterministicExtractorOutput,
  ExtractedFrame,
  LLMAssistTask,
} from "../../src/types/extraction.js";

// Mock the PythonBridge
vi.mock("../../src/services/python-bridge.js");

describe("LLMAssistExtractor", () => {
  let extractor: LLMAssistExtractor;
  let mockPythonBridge: { execute: Mock };

  // Test fixtures
  const createMockFrame = (
    filePath: string,
    lineNumber: number,
    options: Partial<ExtractedFrame> = {}
  ): ExtractedFrame => ({
    file_path: filePath,
    line_number: lineNumber,
    classification: "user_code",
    is_entry_point: false,
    source_mapped: false,
    in_app: true,
    ...options,
  });

  const createStage1Output = (
    overrides: Partial<DeterministicExtractorOutput> = {}
  ): DeterministicExtractorOutput => ({
    repo: "test-org/test-repo",
    commit_sha: "abc123def456",
    branch: "main",
    release_tag: "v1.0.0",
    frames: [createMockFrame("src/app.ts", 42, { is_entry_point: true })],
    error_type: "TypeError",
    error_message: "Cannot read property 'foo' of undefined",
    platform: "javascript",
    environment: "production",
    is_complete: true,
    missing_fields: [],
    extraction_ms: 15,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock PythonBridge
    mockPythonBridge = { execute: vi.fn() };
    (PythonBridge as unknown as Mock).mockImplementation(
      () => mockPythonBridge
    );

    extractor = new LLMAssistExtractor();
  });

  describe("determineNeededTasks", () => {
    it("should return empty array when no tasks needed", () => {
      const output = createStage1Output({
        frames: [createMockFrame("src/app.ts", 10, { is_entry_point: true })],
        branch: "main",
        commit_sha: "abc123",
      });

      const tasks = extractor.determineNeededTasks(output);

      expect(tasks).toEqual([]);
    });

    it("should include clean_stacktrace_noise when many frames", () => {
      const frames = Array.from({ length: 15 }, (_, i) =>
        createMockFrame(`src/file${i}.ts`, i + 1)
      );
      const output = createStage1Output({ frames });

      const tasks = extractor.determineNeededTasks(output);

      expect(tasks).toContain("clean_stacktrace_noise");
    });

    it("should include classify_frames when unknown frames exist", () => {
      const frames = [
        createMockFrame("src/app.ts", 10),
        createMockFrame("lib/helper.ts", 20, { classification: "unknown" }),
      ];
      const output = createStage1Output({ frames });

      const tasks = extractor.determineNeededTasks(output);

      expect(tasks).toContain("classify_frames");
    });

    it("should include identify_root_frame when many user_code frames", () => {
      const frames = [
        createMockFrame("src/a.ts", 10, { classification: "user_code" }),
        createMockFrame("src/b.ts", 20, { classification: "user_code" }),
        createMockFrame("src/c.ts", 30, { classification: "user_code" }),
        createMockFrame("src/d.ts", 40, { classification: "user_code" }),
      ];
      const output = createStage1Output({ frames });

      const tasks = extractor.determineNeededTasks(output);

      expect(tasks).toContain("identify_root_frame");
    });

    it("should include infer_missing_branch when branch and commit missing", () => {
      const output = createStage1Output({ branch: null, commit_sha: null });

      const tasks = extractor.determineNeededTasks(output);

      expect(tasks).toContain("infer_missing_branch");
    });

    it("should not include infer_missing_branch when commit exists", () => {
      const output = createStage1Output({ branch: null, commit_sha: "abc123" });

      const tasks = extractor.determineNeededTasks(output);

      expect(tasks).not.toContain("infer_missing_branch");
    });

    it("should not include infer_missing_branch when branch exists", () => {
      const output = createStage1Output({ branch: "main", commit_sha: null });

      const tasks = extractor.determineNeededTasks(output);

      expect(tasks).not.toContain("infer_missing_branch");
    });

    it("should combine multiple tasks when needed", () => {
      const frames = Array.from({ length: 15 }, (_, i) =>
        createMockFrame(`src/file${i}.ts`, i + 1, {
          classification: i % 2 === 0 ? "user_code" : "unknown",
        })
      );
      const output = createStage1Output({
        frames,
        branch: null,
        commit_sha: null,
      });

      const tasks = extractor.determineNeededTasks(output);

      expect(tasks).toContain("clean_stacktrace_noise");
      expect(tasks).toContain("classify_frames");
      expect(tasks).toContain("identify_root_frame");
      expect(tasks).toContain("infer_missing_branch");
    });
  });

  describe("shouldTriggerLLM", () => {
    it("should return false when Stage 1 is complete", () => {
      const output = createStage1Output({ is_complete: true });

      const result = extractor.shouldTriggerLLM(output);

      expect(result).toBe(false);
    });

    it("should return false when completeness score is above threshold", () => {
      // repo (0.3) + frames (0.3) + primary (0.2) = 0.8 > 0.7
      const output = createStage1Output({
        is_complete: false, // Explicit false to test score calculation
        repo: "test-org/test-repo",
        commit_sha: null, // Missing commit
        frames: [createMockFrame("src/app.ts", 10, { is_entry_point: true })],
      });

      const result = extractor.shouldTriggerLLM(output);

      expect(result).toBe(false);
    });

    it("should return true when completeness score is below threshold", () => {
      // No repo, no commit = 0 score < 0.7
      const output = createStage1Output({
        is_complete: false,
        repo: null,
        commit_sha: null,
        frames: [],
      });

      const result = extractor.shouldTriggerLLM(output);

      expect(result).toBe(true);
    });

    it("should consider repo weight (0.3)", () => {
      const withRepo = createStage1Output({
        is_complete: false,
        repo: "test-org/test-repo",
        commit_sha: null,
        frames: [],
      });
      const withoutRepo = createStage1Output({
        is_complete: false,
        repo: null,
        commit_sha: null,
        frames: [],
      });

      // Without repo, score is 0 < 0.7 → trigger
      expect(extractor.shouldTriggerLLM(withoutRepo)).toBe(true);
      // With repo (0.3) still < 0.7 → trigger
      expect(extractor.shouldTriggerLLM(withRepo)).toBe(true);
    });

    it("should consider commit weight (0.2)", () => {
      const output = createStage1Output({
        is_complete: false,
        repo: "test-org/test-repo", // 0.3
        commit_sha: "abc123", // 0.2
        frames: [], // 0
      });

      // 0.3 + 0.2 = 0.5 < 0.7 → trigger
      expect(extractor.shouldTriggerLLM(output)).toBe(true);
    });

    it("should consider user frames weight (0.3)", () => {
      const output = createStage1Output({
        is_complete: false,
        repo: "test-org/test-repo", // 0.3
        commit_sha: "abc123", // 0.2
        frames: [createMockFrame("src/app.ts", 10)], // 0.3
      });

      // 0.3 + 0.2 + 0.3 = 0.8 > 0.7 → don't trigger
      expect(extractor.shouldTriggerLLM(output)).toBe(false);
    });

    it("should consider clear primary frame weight (0.2)", () => {
      const output = createStage1Output({
        is_complete: false,
        repo: "test-org/test-repo", // 0.3
        commit_sha: null, // 0
        frames: [
          createMockFrame("src/app.ts", 10, { is_entry_point: true }), // 0.3 + 0.2
        ],
      });

      // 0.3 + 0.3 + 0.2 = 0.8 > 0.7 → don't trigger
      expect(extractor.shouldTriggerLLM(output)).toBe(false);
    });

    it("should not count multiple primary frames as clear", () => {
      const output = createStage1Output({
        is_complete: false,
        repo: null, // 0
        commit_sha: null, // 0
        frames: [
          createMockFrame("src/a.ts", 10, { is_entry_point: true }),
          createMockFrame("src/b.ts", 20, { is_entry_point: true }),
        ], // 0.3 (frames) but 0 for clear primary (multiple)
      });

      // Only 0.3 < 0.7 → trigger
      expect(extractor.shouldTriggerLLM(output)).toBe(true);
    });
  });

  describe("createPassThroughOutput", () => {
    it("should create pass-through output when no tasks needed", async () => {
      const stage1Output = createStage1Output({
        frames: [createMockFrame("src/app.ts", 10, { is_entry_point: true })],
      });

      const result = await extractor.extract(stage1Output, [], {});

      expect(result.model).toBe("passthrough");
      expect(result.tokens_used).toBe(0);
      expect(result.frames).toEqual(stage1Output.frames);
    });

    it("should set primary_frame_index correctly in pass-through", async () => {
      const frames = [
        createMockFrame("src/a.ts", 10),
        createMockFrame("src/b.ts", 20, { is_entry_point: true }),
        createMockFrame("src/c.ts", 30),
      ];
      const stage1Output = createStage1Output({ frames });

      const result = await extractor.extract(stage1Output, [], {});

      expect(result.primary_frame_index).toBe(1);
    });

    it("should return null primary_frame_index when no entry point", async () => {
      const frames = [
        createMockFrame("src/a.ts", 10),
        createMockFrame("src/b.ts", 20),
      ];
      const stage1Output = createStage1Output({ frames });

      const result = await extractor.extract(stage1Output, [], {});

      expect(result.primary_frame_index).toBeNull(); // No entry point found
    });

    it("should include pass-through reasoning", async () => {
      const stage1Output = createStage1Output();

      const result = await extractor.extract(stage1Output, [], {});

      expect(result.reasoning).toContain("not needed");
    });

    it("should set confidence to 0.7 for pass-through", async () => {
      const stage1Output = createStage1Output();

      const result = await extractor.extract(stage1Output, [], {});

      expect(result.confidence).toBe(0.7);
    });
  });

  describe("extract with LLM", () => {
    it("should call Python bridge when tasks are needed", async () => {
      const manyFrames = Array.from({ length: 15 }, (_, i) =>
        createMockFrame(`src/file${i}.ts`, i + 1)
      );
      const stage1Output = createStage1Output({ frames: manyFrames });
      const rawFrames = manyFrames.map((f) => ({
        filename: f.file_path,
        lineno: f.line_number,
      }));

      mockPythonBridge.execute.mockResolvedValue({
        frames: manyFrames.slice(0, 5),
        primary_frame_index: 0,
        suggested_branch: null,
        cleaned_frames_count: 5,
        removed_noise_count: 10,
        model: "gpt-4o-mini",
        tokens_used: 500,
        reasoning: "Cleaned noise frames",
        confidence: 0.85,
      });

      await extractor.extract(stage1Output, rawFrames, {});

      expect(mockPythonBridge.execute).toHaveBeenCalledTimes(1);
    });

    it("should pass correct input to Python bridge", async () => {
      const frames = Array.from({ length: 15 }, (_, i) =>
        createMockFrame(`src/file${i}.ts`, i + 1)
      );
      const stage1Output = createStage1Output({ frames });
      const rawFrames = [{ filename: "src/test.ts", lineno: 1 }];
      const context = { repo_languages: ["typescript"] };

      mockPythonBridge.execute.mockResolvedValue({
        frames: [],
        primary_frame_index: null,
        suggested_branch: null,
        cleaned_frames_count: 0,
        removed_noise_count: 0,
        model: "gpt-4o-mini",
        tokens_used: 100,
        reasoning: "Test",
        confidence: 0.5,
      });

      await extractor.extract(stage1Output, rawFrames, context);

      expect(mockPythonBridge.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          stage_1_output: stage1Output,
          tasks: expect.any(Array),
          raw_frames: rawFrames,
          context,
        })
      );
    });

    it("should limit frames sent to LLM", async () => {
      const manyFrames = Array.from({ length: 100 }, (_, i) =>
        createMockFrame(`src/file${i}.ts`, i + 1)
      );
      const stage1Output = createStage1Output({ frames: manyFrames });
      const rawFrames = Array.from({ length: 100 }, (_, i) => ({
        filename: `src/file${i}.ts`,
        lineno: i + 1,
      }));

      mockPythonBridge.execute.mockResolvedValue({
        frames: [],
        primary_frame_index: null,
        suggested_branch: null,
        cleaned_frames_count: 0,
        removed_noise_count: 0,
        model: "gpt-4o-mini",
        tokens_used: 100,
        reasoning: "Test",
        confidence: 0.5,
      });

      await extractor.extract(stage1Output, rawFrames, {});

      // MAX_LLM_FRAMES = 50
      const callArg = mockPythonBridge.execute.mock.calls[0][0];
      expect(callArg.raw_frames.length).toBeLessThanOrEqual(50);
    });

    it("should return LLM result when valid", async () => {
      const cleanedFrames = [
        createMockFrame("src/clean.ts", 10, { is_entry_point: true }),
      ];
      const stage1Output = createStage1Output({
        frames: Array.from({ length: 15 }, (_, i) =>
          createMockFrame(`src/file${i}.ts`, i + 1)
        ),
      });

      mockPythonBridge.execute.mockResolvedValue({
        frames: cleanedFrames,
        primary_frame_index: 0,
        suggested_branch: "feature/api",
        cleaned_frames_count: 1,
        removed_noise_count: 14,
        model: "gpt-4o-mini",
        tokens_used: 750,
        reasoning: "Identified root cause",
        confidence: 0.9,
      });

      const result = await extractor.extract(stage1Output, [], {});

      expect(result.frames).toEqual(cleanedFrames);
      expect(result.suggested_branch).toBe("feature/api");
      expect(result.tokens_used).toBe(750);
      expect(result.model).toBe("gpt-4o-mini");
    });
  });

  describe("error handling", () => {
    it("should return pass-through on Python bridge error", async () => {
      const frames = Array.from({ length: 15 }, (_, i) =>
        createMockFrame(`src/file${i}.ts`, i + 1)
      );
      const stage1Output = createStage1Output({ frames });

      mockPythonBridge.execute.mockRejectedValue(
        new Error("Python process crashed")
      );

      const result = await extractor.extract(stage1Output, [], {});

      expect(result.model).toBe("passthrough");
      expect(result.frames).toEqual(frames);
      expect(result.tokens_used).toBe(0);
    });

    it("should return pass-through on invalid LLM output", async () => {
      const frames = Array.from({ length: 15 }, (_, i) =>
        createMockFrame(`src/file${i}.ts`, i + 1)
      );
      const stage1Output = createStage1Output({ frames });

      mockPythonBridge.execute.mockResolvedValue({
        // Invalid output - missing required fields
        frames: null,
        invalid_field: true,
      });

      const result = await extractor.extract(stage1Output, [], {});

      expect(result.model).toBe("passthrough");
      expect(result.frames).toEqual(frames);
    });

    it("should handle timeout gracefully", async () => {
      const frames = Array.from({ length: 15 }, (_, i) =>
        createMockFrame(`src/file${i}.ts`, i + 1)
      );
      const stage1Output = createStage1Output({ frames });

      mockPythonBridge.execute.mockRejectedValue(
        new Error("Operation timed out")
      );

      const result = await extractor.extract(stage1Output, [], {});

      expect(result.model).toBe("passthrough");
      expect(result.reasoning).toContain("not needed");
    });

    it("should preserve stage1 frames on any error", async () => {
      const originalFrames = [
        createMockFrame("src/important.ts", 42, { is_entry_point: true }),
        createMockFrame("src/helper.ts", 10),
      ];
      const stage1Output = createStage1Output({
        frames: Array.from({ length: 15 }, (_, i) =>
          i < 2 ? originalFrames[i] : createMockFrame(`src/file${i}.ts`, i + 1)
        ),
      });

      mockPythonBridge.execute.mockRejectedValue(new Error("Unexpected error"));

      const result = await extractor.extract(stage1Output, [], {});

      // Should preserve all original frames
      expect(result.frames).toEqual(stage1Output.frames);
    });
  });

  describe("task determination edge cases", () => {
    it("should handle empty frames array", () => {
      const output = createStage1Output({ frames: [] });

      const tasks = extractor.determineNeededTasks(output);

      expect(tasks).not.toContain("clean_stacktrace_noise");
      expect(tasks).not.toContain("identify_root_frame");
    });

    it("should handle exactly 10 frames (boundary)", () => {
      const frames = Array.from({ length: 10 }, (_, i) =>
        createMockFrame(`src/file${i}.ts`, i + 1)
      );
      const output = createStage1Output({ frames });

      const tasks = extractor.determineNeededTasks(output);

      // 10 frames should NOT trigger (need > 10)
      expect(tasks).not.toContain("clean_stacktrace_noise");
    });

    it("should handle exactly 11 frames (just over boundary)", () => {
      const frames = Array.from({ length: 11 }, (_, i) =>
        createMockFrame(`src/file${i}.ts`, i + 1)
      );
      const output = createStage1Output({ frames });

      const tasks = extractor.determineNeededTasks(output);

      expect(tasks).toContain("clean_stacktrace_noise");
    });

    it("should handle exactly 3 user_code frames (boundary)", () => {
      const frames = [
        createMockFrame("src/a.ts", 10, { classification: "user_code" }),
        createMockFrame("src/b.ts", 20, { classification: "user_code" }),
        createMockFrame("src/c.ts", 30, { classification: "user_code" }),
      ];
      const output = createStage1Output({ frames });

      const tasks = extractor.determineNeededTasks(output);

      // 3 frames should NOT trigger (need > 3)
      expect(tasks).not.toContain("identify_root_frame");
    });

    it("should handle 4 user_code frames (just over boundary)", () => {
      const frames = [
        createMockFrame("src/a.ts", 10, { classification: "user_code" }),
        createMockFrame("src/b.ts", 20, { classification: "user_code" }),
        createMockFrame("src/c.ts", 30, { classification: "user_code" }),
        createMockFrame("src/d.ts", 40, { classification: "user_code" }),
      ];
      const output = createStage1Output({ frames });

      const tasks = extractor.determineNeededTasks(output);

      expect(tasks).toContain("identify_root_frame");
    });

    it("should handle mixed classification frames", () => {
      const frames = [
        createMockFrame("src/app.ts", 10, { classification: "user_code" }),
        createMockFrame("lib/vendor.ts", 20, { classification: "third_party" }),
        createMockFrame("unknown/file.ts", 30, { classification: "unknown" }),
        createMockFrame("src/util.ts", 40, { classification: "user_code" }),
      ];
      const output = createStage1Output({ frames });

      const tasks = extractor.determineNeededTasks(output);

      expect(tasks).toContain("classify_frames");
      expect(tasks).not.toContain("identify_root_frame"); // Only 2 user_code
    });
  });
});
