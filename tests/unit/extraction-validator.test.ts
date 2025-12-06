import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { ExtractionValidator } from "../../src/services/event-extractor/extraction-validator.js";
import * as githubService from "../../src/services/github.js";
import type {
  ValidationInput,
  ExtractedFrame,
} from "../../src/types/extraction.js";

// Mock the github service
vi.mock("../../src/services/github.js");

describe("ExtractionValidator", () => {
  let validator: ExtractionValidator;

  // Mock functions
  const mockGetRepoByFullName = githubService.getRepoByFullName as Mock;
  const mockFetchFileContent = githubService.fetchFileContent as Mock;
  const mockCheckRefExists = githubService.checkRefExists as Mock;

  // Test fixtures
  const testOrgId = "550e8400-e29b-41d4-a716-446655440001";

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

  const createValidationInput = (
    overrides: Partial<ValidationInput> = {}
  ): ValidationInput => ({
    org_id: testOrgId,
    repo: "test-org/test-repo",
    commit_sha: "abc123def456",
    branch: "main",
    frames: [createMockFrame("src/app.ts", 42, { is_entry_point: true })],
    ...overrides,
  });

  const createMockRepoConfig = (
    overrides: Partial<{
      installation_id: string;
      default_branch: string;
    }> = {}
  ) => ({
    installation_id: "inst-123",
    default_branch: "main",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    validator = new ExtractionValidator();

    // Default mock implementations
    mockGetRepoByFullName.mockResolvedValue(createMockRepoConfig());
    mockFetchFileContent.mockResolvedValue({ content: "file content" });
    mockCheckRefExists.mockResolvedValue(true);
  });

  describe("repository existence checks", () => {
    it("should pass when repository exists", async () => {
      const input = createValidationInput();

      const result = await validator.validate(input);

      const repoCheck = result.checks.find((c) => c.check === "repo_exists");
      expect(repoCheck?.passed).toBe(true);
    });

    it("should fail when repository is null", async () => {
      const input = createValidationInput({ repo: null });

      const result = await validator.validate(input);

      const repoCheck = result.checks.find((c) => c.check === "repo_exists");
      expect(repoCheck?.passed).toBe(false);
      expect(repoCheck?.message).toContain("No repository specified");
      expect(result.all_passed).toBe(false);
    });

    it("should fail when repository is not registered", async () => {
      mockGetRepoByFullName.mockResolvedValue(null);
      const input = createValidationInput();

      const result = await validator.validate(input);

      const repoCheck = result.checks.find((c) => c.check === "repo_exists");
      expect(repoCheck?.passed).toBe(false);
      expect(repoCheck?.message).toContain("not registered");
    });

    it("should fail when GitHub API returns error", async () => {
      mockGetRepoByFullName.mockRejectedValue(new Error("API error"));
      const input = createValidationInput();

      const result = await validator.validate(input);

      const repoCheck = result.checks.find((c) => c.check === "repo_exists");
      expect(repoCheck?.passed).toBe(false);
      expect(repoCheck?.message).toContain("Error checking repo");
    });

    it("should fail when repo has no installation_id", async () => {
      mockGetRepoByFullName.mockResolvedValue({ default_branch: "main" });
      const input = createValidationInput();

      const result = await validator.validate(input);

      expect(result.repo).toBeNull();
      expect(result.all_passed).toBe(false);
    });
  });

  describe("commit and branch validation with fallback", () => {
    it("should pass when commit exists", async () => {
      const input = createValidationInput({ commit_sha: "abc123def456" });

      const result = await validator.validate(input);

      expect(result.commit_sha).toBe("abc123def456");
      const commitCheck = result.checks.find(
        (c) => c.check === "commit_exists" || c.check === "branch_exists"
      );
      expect(commitCheck?.passed).toBe(true);
    });

    it("should fallback to branch when commit not found", async () => {
      // Commit ref fails, branch ref succeeds
      mockCheckRefExists
        .mockResolvedValueOnce(false) // commit not found
        .mockResolvedValueOnce(true); // branch found

      const input = createValidationInput({
        commit_sha: "nonexistent",
        branch: "develop",
      });

      const result = await validator.validate(input);

      expect(result.branch).toBe("develop");
      expect(result.fallbacks_used).toBeGreaterThan(0);
    });

    it("should fallback to default branch when commit and branch fail", async () => {
      // All refs fail except default branch
      mockCheckRefExists
        .mockResolvedValueOnce(false) // commit fails
        .mockResolvedValueOnce(false) // branch fails
        .mockResolvedValueOnce(true); // default branch succeeds

      const input = createValidationInput({
        commit_sha: "nonexistent",
        branch: "nonexistent-branch",
      });

      const result = await validator.validate(input);

      expect(result.branch).toBe("main");
      expect(result.fallbacks_used).toBeGreaterThanOrEqual(1);
    });

    it("should use default_branch from repo config", async () => {
      mockGetRepoByFullName.mockResolvedValue(
        createMockRepoConfig({ default_branch: "develop" })
      );
      // No commit or branch, falls back to default
      mockCheckRefExists.mockResolvedValue(true);

      const input = createValidationInput({
        commit_sha: null,
        branch: null,
      });

      const result = await validator.validate(input);

      expect(result.branch).toBe("develop");
    });

    it("should mark fallback_used in check result", async () => {
      mockCheckRefExists
        .mockResolvedValueOnce(false) // commit fails
        .mockResolvedValueOnce(true); // branch succeeds

      const input = createValidationInput({
        commit_sha: "nonexistent",
        branch: "main",
      });

      const result = await validator.validate(input);

      const branchCheck = result.checks.find(
        (c) => c.check === "branch_exists"
      );
      expect(branchCheck?.fallback_used).toBe(true);
    });

    it("should handle both commit and branch being null", async () => {
      mockFetchFileContent.mockResolvedValue({ content: "content" });

      const input = createValidationInput({
        commit_sha: null,
        branch: null,
      });

      const result = await validator.validate(input);

      expect(result.branch).toBe("main"); // Default from mock
    });
  });

  describe("frame validation", () => {
    it("should validate frame when file exists", async () => {
      // checkRefExists defaults to true in beforeEach
      // fetchFileContent defaults to returning content in beforeEach
      const input = createValidationInput({
        frames: [createMockFrame("src/app.ts", 42, { is_entry_point: true })],
      });

      const result = await validator.validate(input);

      expect(result.frames).toHaveLength(1);
      const fileCheck = result.checks.find((c) => c.check === "file_exists");
      expect(fileCheck?.passed).toBe(true);
    });

    it("should reject frame when file does not exist", async () => {
      // Repo check passes, commit check passes, but file doesn't exist
      // Mock file fetch to succeed for ref check but fail for frame validation
      mockFetchFileContent.mockImplementation(
        async (
          _instId: string,
          _owner: string,
          _repo: string,
          path: string
        ) => {
          // ref check uses package.json or README.md
          if (path === "package.json" || path === "README.md") {
            return { content: "ref-check-content" };
          }
          // Frame file doesn't exist
          return null;
        }
      );

      const input = createValidationInput({
        frames: [createMockFrame("src/missing.ts", 42)],
      });

      const result = await validator.validate(input);

      // Frame should not be in validated frames since file doesn't exist
      expect(result.frames).toHaveLength(0);
      // But check should be recorded as failed
      const fileCheck = result.checks.find((c) => c.check === "file_exists");
      expect(fileCheck?.passed).toBe(false);
    });

    it("should validate multiple frames", async () => {
      const input = createValidationInput({
        frames: [
          createMockFrame("src/app.ts", 42, { is_entry_point: true }),
          createMockFrame("src/helper.ts", 10),
          createMockFrame("src/utils.ts", 5),
        ],
      });

      const result = await validator.validate(input);

      expect(result.frames).toHaveLength(3);
    });

    it("should only include validated frames in output", async () => {
      // File exists for first two, not third
      // checkRefExists defaults to true, so only need to mock file fetches
      mockFetchFileContent
        .mockResolvedValueOnce({ content: "app.ts" })
        .mockResolvedValueOnce({ content: "helper.ts" })
        .mockResolvedValueOnce(null); // missing.ts

      const input = createValidationInput({
        frames: [
          createMockFrame("src/app.ts", 42),
          createMockFrame("src/helper.ts", 10),
          createMockFrame("src/missing.ts", 5),
        ],
      });

      const result = await validator.validate(input);

      expect(result.frames).toHaveLength(2);
      expect(result.frames.map((f) => f.file_path)).toEqual([
        "src/app.ts",
        "src/helper.ts",
      ]);
    });

    it("should identify primary frame from validated frames", async () => {
      const input = createValidationInput({
        frames: [
          createMockFrame("src/helper.ts", 10),
          createMockFrame("src/app.ts", 42, { is_entry_point: true }),
          createMockFrame("src/utils.ts", 5),
        ],
      });

      const result = await validator.validate(input);

      expect(result.primary_frame?.file_path).toBe("src/app.ts");
      expect(result.primary_frame?.is_entry_point).toBe(true);
    });

    it("should return null primary_frame when no entry point exists", async () => {
      const input = createValidationInput({
        frames: [
          createMockFrame("src/helper.ts", 10),
          createMockFrame("src/utils.ts", 5),
        ],
      });

      const result = await validator.validate(input);

      expect(result.primary_frame).toBeNull();
    });

    it("should include line_valid check for validated frames", async () => {
      const input = createValidationInput({
        frames: [createMockFrame("src/app.ts", 42)],
      });

      const result = await validator.validate(input);

      const lineCheck = result.checks.find((c) => c.check === "line_valid");
      expect(lineCheck).toBeDefined();
      expect(lineCheck?.passed).toBe(true);
    });
  });

  describe("fallback chain: commit → branch → default branch", () => {
    it("should try commit first", async () => {
      const input = createValidationInput({
        commit_sha: "abc123",
        branch: "develop",
      });

      await validator.validate(input);

      // First call should be with commit ref
      expect(mockCheckRefExists).toHaveBeenCalledWith(
        "inst-123",
        "test-org",
        "test-repo",
        "abc123",
        testOrgId
      );
    });

    it("should try branch when commit fails", async () => {
      mockCheckRefExists
        .mockResolvedValueOnce(false) // commit fails
        .mockResolvedValueOnce(true); // branch succeeds

      const input = createValidationInput({
        commit_sha: "bad-commit",
        branch: "develop",
      });

      await validator.validate(input);

      // Should check commit then branch
      expect(mockCheckRefExists).toHaveBeenNthCalledWith(
        2,
        "inst-123",
        "test-org",
        "test-repo",
        "develop",
        testOrgId
      );
    });

    it("should try default branch when both fail", async () => {
      mockGetRepoByFullName.mockResolvedValue(
        createMockRepoConfig({ default_branch: "master" })
      );
      mockCheckRefExists
        .mockResolvedValueOnce(false) // commit fails
        .mockResolvedValueOnce(false) // branch fails
        .mockResolvedValueOnce(true); // default branch succeeds

      const input = createValidationInput({
        commit_sha: "bad-commit",
        branch: "bad-branch",
      });

      await validator.validate(input);

      // Third call should be with default branch
      expect(mockCheckRefExists).toHaveBeenNthCalledWith(
        3,
        "inst-123",
        "test-org",
        "test-repo",
        "master",
        testOrgId
      );
    });

    it("should increment fallbacks_used for each fallback", async () => {
      mockCheckRefExists
        .mockResolvedValueOnce(false) // commit fails
        .mockResolvedValueOnce(true); // branch succeeds

      const input = createValidationInput({
        commit_sha: "bad-commit",
        branch: "main",
      });

      const result = await validator.validate(input);

      // One fallback: commit → branch
      expect(result.fallbacks_used).toBeGreaterThanOrEqual(1);
    });

    it("should try default branch fallback for frames when ref fails", async () => {
      // Ref check passes, but file check fails on original ref
      // Fallback to default branch for frame validation
      mockCheckRefExists.mockResolvedValue(true);
      mockFetchFileContent
        .mockResolvedValueOnce(null) // frame with original ref fails
        .mockResolvedValueOnce({ content: "file" }); // frame with default branch works

      const input = createValidationInput({
        commit_sha: "abc123",
        frames: [createMockFrame("src/app.ts", 42)],
      });

      const result = await validator.validate(input);

      expect(result.frames).toHaveLength(1);
      expect(result.fallbacks_used).toBeGreaterThan(0);
    });
  });

  describe("validation output structure", () => {
    it("should return complete output structure", async () => {
      const input = createValidationInput();

      const result = await validator.validate(input);

      expect(result).toHaveProperty("repo");
      expect(result).toHaveProperty("commit_sha");
      expect(result).toHaveProperty("branch");
      expect(result).toHaveProperty("frames");
      expect(result).toHaveProperty("primary_frame");
      expect(result).toHaveProperty("checks");
      expect(result).toHaveProperty("all_passed");
      expect(result).toHaveProperty("fallbacks_used");
      expect(result).toHaveProperty("validation_ms");
    });

    it("should track validation timing", async () => {
      const input = createValidationInput();

      const result = await validator.validate(input);

      expect(result.validation_ms).toBeGreaterThanOrEqual(0);
    });

    it("should set all_passed to true when all checks pass", async () => {
      const input = createValidationInput();

      const result = await validator.validate(input);

      expect(result.all_passed).toBe(true);
    });

    it("should set all_passed to false when any check fails", async () => {
      // checkRefExists defaults to true
      // File not found for frame
      mockFetchFileContent.mockResolvedValueOnce(null);

      const input = createValidationInput({
        frames: [createMockFrame("src/missing.ts", 42)],
      });

      const result = await validator.validate(input);

      expect(result.all_passed).toBe(false);
    });

    it("should preserve validated repo in output", async () => {
      const input = createValidationInput({ repo: "my-org/my-repo" });

      const result = await validator.validate(input);

      expect(result.repo).toBe("my-org/my-repo");
    });
  });

  describe("error handling", () => {
    it("should return failed output on unexpected error", async () => {
      mockGetRepoByFullName.mockRejectedValue(new Error("Unexpected error"));

      const input = createValidationInput();

      const result = await validator.validate(input);

      expect(result.repo).toBeNull();
      expect(result.frames).toHaveLength(0);
      expect(result.all_passed).toBe(false);
    });

    it("should handle empty frames array", async () => {
      const input = createValidationInput({ frames: [] });

      const result = await validator.validate(input);

      expect(result.frames).toHaveLength(0);
      expect(result.primary_frame).toBeNull();
    });

    it("should handle file fetch error for frame validation", async () => {
      // Ref check should pass, but frame file fetch should throw
      mockFetchFileContent.mockImplementation(
        async (
          _instId: string,
          _owner: string,
          _repo: string,
          path: string
        ) => {
          // Ref check files should pass
          if (path === "package.json" || path === "README.md") {
            return { content: "ref-check-content" };
          }
          // Frame file fetch throws error
          throw new Error("Network error");
        }
      );

      const input = createValidationInput({
        frames: [createMockFrame("src/app.ts", 42)],
      });

      const result = await validator.validate(input);

      // Frame should not be validated due to error (treated as file not found)
      expect(result.frames).toHaveLength(0);
    });

    it("should continue validating other frames after one fails", async () => {
      // checkRefExists defaults to true
      mockFetchFileContent
        .mockRejectedValueOnce(new Error("Error")) // first frame fails
        .mockResolvedValueOnce({ content: "content" }); // second frame succeeds

      const input = createValidationInput({
        frames: [
          createMockFrame("src/bad.ts", 10),
          createMockFrame("src/good.ts", 20),
        ],
      });

      const result = await validator.validate(input);

      expect(result.frames).toHaveLength(1);
      expect(result.frames[0].file_path).toBe("src/good.ts");
    });
  });

  describe("ref existence check", () => {
    it("should use checkRefExists API for ref validation", async () => {
      const input = createValidationInput({ commit_sha: "abc123" });

      await validator.validate(input);

      // Should use the proper GitHub API endpoint for ref validation
      expect(mockCheckRefExists).toHaveBeenCalled();
      expect(mockCheckRefExists).toHaveBeenCalledWith(
        "inst-123",
        "test-org",
        "test-repo",
        "abc123",
        testOrgId
      );
    });

    it("should fallback to branch when commit ref not found", async () => {
      mockCheckRefExists
        .mockResolvedValueOnce(false) // commit not found
        .mockResolvedValueOnce(true); // branch found

      const input = createValidationInput({
        commit_sha: "abc123",
        branch: "main",
      });

      await validator.validate(input);

      // Should check commit first, then branch
      expect(mockCheckRefExists).toHaveBeenCalledTimes(2);
    });

    it("should return false if ref validation fails for all refs", async () => {
      mockCheckRefExists.mockResolvedValue(false);

      const input = createValidationInput({
        commit_sha: "abc123",
        branch: "main",
      });

      const result = await validator.validate(input);

      const branchCheck = result.checks.find(
        (c) => c.check === "branch_exists"
      );
      expect(branchCheck?.message).toContain("No valid ref found");
    });
  });

  describe("installation ID handling", () => {
    it("should use installation_id from repo config", async () => {
      mockGetRepoByFullName.mockResolvedValue(
        createMockRepoConfig({ installation_id: "inst-456" })
      );

      const input = createValidationInput();

      await validator.validate(input);

      // checkRefExists should use the installation ID
      expect(mockCheckRefExists).toHaveBeenCalledWith(
        "inst-456",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });

    it("should parse owner and repo from full name", async () => {
      const input = createValidationInput({ repo: "my-company/my-service" });

      await validator.validate(input);

      expect(mockCheckRefExists).toHaveBeenCalledWith(
        expect.any(String),
        "my-company", // owner
        "my-service", // repo
        expect.any(String),
        expect.any(String)
      );
    });
  });
});
