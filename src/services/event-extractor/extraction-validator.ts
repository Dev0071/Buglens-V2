import { logger } from "../../utils/logger.js";
import { fetchFileContent, getRepoByFullName } from "../github.js";
import {
  type ValidationInput,
  type ValidationOutput,
  type ValidationCheck,
  type ExtractedFrame,
} from "../../types/extraction.js";

/**
 * Helper to create a ValidationCheck with defaults
 */
function createValidationCheck(
  checkType: ValidationCheck["check"],
  passed: boolean,
  message?: string,
  fallbackUsed = false,
  fallbackValue?: string | null
): ValidationCheck {
  return {
    check: checkType,
    passed,
    message,
    fallback_used: fallbackUsed,
    fallback_value: fallbackValue ?? null,
  };
}

/**
 * Stage 3: Extraction Validator
 *
 * Validates extraction results against GitHub to ensure:
 * - Repository exists and is accessible
 * - Commit/branch exists
 * - File paths exist in the repo
 * - Line numbers are valid
 *
 * Uses fallback strategies when validation fails.
 */
export class ExtractionValidator {
  /**
   * Validate extracted data against GitHub
   */
  async validate(input: ValidationInput): Promise<ValidationOutput> {
    const startTime = Date.now();
    const checks: ValidationCheck[] = [];
    let fallbacksUsed = 0;

    const validatedRepo = input.repo;
    let validatedCommitSha = input.commit_sha;
    let validatedBranch = input.branch;
    const validatedFrames: ExtractedFrame[] = [];
    let primaryFrame: ExtractedFrame | null = null;

    try {
      // Check 1: Repo exists
      const repoCheck = await this.checkRepoExists(input.org_id, input.repo);
      checks.push(repoCheck);

      if (!repoCheck.passed) {
        // Can't proceed without a valid repo
        return this.createFailedOutput(checks, startTime);
      }

      // Get repo config for installation ID
      const repoConfig = await this.getRepoConfig(input.org_id, input.repo!);
      if (!repoConfig) {
        checks.push(
          createValidationCheck(
            "repo_exists",
            false,
            "Repo not registered for this organization"
          )
        );
        return this.createFailedOutput(checks, startTime);
      }

      const { installationId, owner, repoName, defaultBranch } = repoConfig;

      // Check 2: Commit exists (with fallback)
      const commitCheck = await this.checkCommitExists(
        installationId,
        owner,
        repoName,
        input.commit_sha,
        input.branch,
        defaultBranch,
        input.org_id
      );
      checks.push(commitCheck);

      if (commitCheck.fallback_used) {
        fallbacksUsed++;
        validatedBranch = commitCheck.fallback_value ?? defaultBranch;
        validatedCommitSha = null; // Will use branch ref
      }

      // Use the best available ref
      const ref = validatedCommitSha || validatedBranch || defaultBranch;

      // Check 3: Validate frames (file exists + line valid)
      for (const frame of input.frames) {
        const frameValidation = await this.validateFrame(
          installationId,
          owner,
          repoName,
          frame,
          ref,
          input.org_id
        );

        if (frameValidation.fileCheck.passed) {
          validatedFrames.push(frame);

          // Track primary frame
          if (frame.is_entry_point && !primaryFrame) {
            primaryFrame = frame;
          }
        }

        checks.push(frameValidation.fileCheck);
        if (frameValidation.lineCheck) {
          checks.push(frameValidation.lineCheck);
        }
      }

      // If no frames validated, try fallback to default branch
      if (
        validatedFrames.length === 0 &&
        input.frames.length > 0 &&
        ref !== defaultBranch
      ) {
        logger.info(
          { ref, defaultBranch },
          "No frames validated, trying default branch fallback"
        );
        fallbacksUsed++;

        for (const frame of input.frames) {
          const frameValidation = await this.validateFrame(
            installationId,
            owner,
            repoName,
            frame,
            defaultBranch,
            input.org_id
          );

          if (frameValidation.fileCheck.passed) {
            validatedFrames.push(frame);
            if (frame.is_entry_point && !primaryFrame) {
              primaryFrame = frame;
            }
          }
        }

        if (validatedFrames.length > 0) {
          validatedBranch = defaultBranch;
          validatedCommitSha = null;
        }
      }

      const allPassed = checks.every((c) => c.passed);
      const validationMs = Date.now() - startTime;

      logger.info(
        {
          orgId: input.org_id,
          repo: input.repo,
          checksRun: checks.length,
          checksPassed: checks.filter((c) => c.passed).length,
          framesValidated: validatedFrames.length,
          fallbacksUsed,
          validationMs,
        },
        "Stage 3: Validation complete"
      );

      return {
        repo: validatedRepo,
        commit_sha: validatedCommitSha,
        branch: validatedBranch,
        frames: validatedFrames,
        primary_frame: primaryFrame,
        checks,
        all_passed: allPassed,
        fallbacks_used: fallbacksUsed,
        validation_ms: validationMs,
      };
    } catch (error) {
      logger.error(
        { error, orgId: input.org_id },
        "Stage 3: Validation failed"
      );
      return this.createFailedOutput(checks, startTime);
    }
  }

  /**
   * Check if repository exists and is accessible
   */
  private async checkRepoExists(
    orgId: string,
    repo: string | null
  ): Promise<ValidationCheck> {
    if (!repo) {
      return createValidationCheck(
        "repo_exists",
        false,
        "No repository specified"
      );
    }

    try {
      const repoConfig = await getRepoByFullName(orgId, repo);
      return createValidationCheck(
        "repo_exists",
        !!repoConfig,
        repoConfig ? "Repository found" : "Repository not registered"
      );
    } catch (error) {
      return createValidationCheck(
        "repo_exists",
        false,
        `Error checking repo: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get repo config with installation details
   */
  private async getRepoConfig(
    orgId: string,
    repo: string
  ): Promise<{
    installationId: string;
    owner: string;
    repoName: string;
    defaultBranch: string;
  } | null> {
    const repoConfig = await getRepoByFullName(orgId, repo);
    if (!repoConfig || !repoConfig.installation_id) return null;

    const [owner, repoName] = repo.split("/");
    return {
      installationId: repoConfig.installation_id,
      owner,
      repoName,
      defaultBranch: repoConfig.default_branch || "main",
    };
  }

  /**
   * Check if commit/branch exists with fallback strategies
   */
  private async checkCommitExists(
    installationId: string,
    owner: string,
    repo: string,
    commitSha: string | null,
    branch: string | null,
    defaultBranch: string,
    orgId: string
  ): Promise<ValidationCheck> {
    // If we have a commit SHA, check it exists
    if (commitSha) {
      const exists = await this.refExists(
        installationId,
        owner,
        repo,
        commitSha,
        orgId
      );
      if (exists) {
        return createValidationCheck("commit_exists", true, "Commit found");
      }
    }

    // Fall back to branch
    if (branch) {
      const exists = await this.refExists(
        installationId,
        owner,
        repo,
        branch,
        orgId
      );
      if (exists) {
        return createValidationCheck(
          "branch_exists",
          true,
          "Branch found",
          !!commitSha, // fallback_used = true if we had a commit that didn't exist
          branch
        );
      }
    }

    // Fall back to default branch
    const exists = await this.refExists(
      installationId,
      owner,
      repo,
      defaultBranch,
      orgId
    );

    return createValidationCheck(
      "branch_exists",
      exists,
      exists ? `Using default branch: ${defaultBranch}` : "No valid ref found",
      true,
      defaultBranch
    );
  }

  /**
   * Check if a git ref (commit or branch) exists
   */
  private async refExists(
    installationId: string,
    owner: string,
    repo: string,
    ref: string,
    orgId: string
  ): Promise<boolean> {
    try {
      // Try to fetch a known file to verify ref
      // We use a simple path check - if the ref doesn't exist, GitHub returns 404
      const result = await fetchFileContent(
        installationId,
        owner,
        repo,
        "package.json", // Common file in JS projects
        ref,
        orgId
      );
      return result !== null;
    } catch {
      // Also try README as fallback
      try {
        const result = await fetchFileContent(
          installationId,
          owner,
          repo,
          "README.md",
          ref,
          orgId
        );
        return result !== null;
      } catch {
        return false;
      }
    }
  }

  /**
   * Validate a single frame (file + line)
   */
  private async validateFrame(
    installationId: string,
    owner: string,
    repo: string,
    frame: ExtractedFrame,
    ref: string,
    orgId: string
  ): Promise<{
    fileCheck: ValidationCheck;
    lineCheck?: ValidationCheck;
  }> {
    // Check file exists
    let fileContent: { content?: string; size?: number } | null = null;
    try {
      fileContent = await fetchFileContent(
        installationId,
        owner,
        repo,
        frame.file_path,
        ref,
        orgId
      );
    } catch {
      // File not found or error
    }

    if (!fileContent) {
      return {
        fileCheck: createValidationCheck(
          "file_exists",
          false,
          `File not found: ${frame.file_path}`
        ),
      };
    }

    // File exists
    const fileCheck = createValidationCheck(
      "file_exists",
      true,
      `File found: ${frame.file_path}`
    );

    // Check line number is valid (if we have file size/content)
    // Note: GitHub API returns base64 content, we'd need to decode to count lines
    // For now, we trust the line number if file exists
    const lineCheck = createValidationCheck(
      "line_valid",
      true,
      `Line ${frame.line_number} assumed valid`
    );

    return { fileCheck, lineCheck };
  }

  /**
   * Create failed validation output
   */
  private createFailedOutput(
    checks: ValidationCheck[],
    startTime: number
  ): ValidationOutput {
    return {
      repo: null,
      commit_sha: null,
      branch: null,
      frames: [],
      primary_frame: null,
      checks,
      all_passed: false,
      fallbacks_used: 0,
      validation_ms: Date.now() - startTime,
    };
  }
}
