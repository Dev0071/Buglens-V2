import { codeFetcherService, CodeFetcherService } from "./code-fetcher.js";
import { PythonBridge } from "./python-bridge.js";
import {
  analyzerResultSchema,
  type AnalyzerRequestPayload,
  type AnalyzerResult,
} from "../types/analyzer.js";
import type { StackFrame } from "../types/github.js";
import { logger } from "../utils/logger.js";
import { transaction } from "../db/client.js";
import type { DeterministicAnalyzerJobData } from "../workers/queues/deterministic.js";
import {
  extractRepoFromPayload,
  extractEventPayload,
  parseReleaseString,
  type RepoReference,
} from "./analyzer-utils.js";
import { enqueueEvidenceAssembly } from "../workers/queues/evidence.js";
import { ExtractionPipeline } from "./event-extractor/extraction-pipeline.js";
import type { ExtractionResult } from "../types/extraction.js";

interface JobRow {
  id: string;
  event_id: string;
  release: string | null;
  stack_trace: unknown;
  raw_payload: unknown;
}

interface RepoRecord {
  id: string;
  full_name: string;
  installation_id: string | null;
  default_branch: string;
}

export class DeterministicAnalyzerService {
  private readonly codeFetcher: CodeFetcherService;
  private readonly pythonBridge: PythonBridge;
  private readonly extractionPipeline: ExtractionPipeline;

  constructor(
    deps: {
      codeFetcher?: CodeFetcherService;
      pythonBridge?: PythonBridge;
      extractionPipeline?: ExtractionPipeline;
    } = {}
  ) {
    this.codeFetcher = deps.codeFetcher ?? codeFetcherService;
    this.pythonBridge =
      deps.pythonBridge ??
      new PythonBridge({ module: "analyzers.js_analyzer" });
    this.extractionPipeline =
      deps.extractionPipeline ?? new ExtractionPipeline();
  }

  async process(job: DeterministicAnalyzerJobData): Promise<void> {
    try {
      const jobRow = await this.loadJob(job);

      // =================================================================
      // RUN EXTRACTION PIPELINE (3-stage hybrid extraction)
      // =================================================================
      const extractionResult = await this.runExtractionPipeline(job, jobRow);

      // Persist extraction results for later use
      await this.persistExtractionResult(job, extractionResult);

      // If extraction failed to find usable data, we can still try legacy flow
      if (!extractionResult.is_complete) {
        logger.warn(
          {
            jobId: job.jobId,
            extractionId: extractionResult.extraction_id,
            issues: extractionResult.issues,
            confidence: extractionResult.confidence,
          },
          "Extraction incomplete - attempting legacy flow"
        );
      }

      await this.markFetchingCode(job);
      const requestPayload = await this.prepareAnalyzerRequest(
        job,
        jobRow,
        extractionResult
      );

      // If no user code to analyze, skip Python analyzer and mark complete
      if (requestPayload.metadata?.no_user_code) {
        const emptyResult: AnalyzerResult = {
          analyzer: {
            name: "js_analyzer",
            version: "0.1.0",
            runtime_ms: 0,
          },
          findings: [],
          stats: {
            frames_analyzed: requestPayload.frames.length,
            code_segments: 0,
          },
        };
        await this.persistFindings(job, emptyResult);
        await this.markNoUserCode(
          job,
          requestPayload.metadata.reason ?? "No user code found"
        );
        return;
      }

      await this.markAnalyzing(job);

      const rawResult = await this.pythonBridge.execute<
        AnalyzerRequestPayload,
        unknown
      >(requestPayload);
      const parsedResult = analyzerResultSchema.parse(rawResult);

      await this.persistFindings(job, parsedResult);
      await this.markDeterministicComplete(job);

      // Enqueue evidence assembly job for LLM reasoning
      await enqueueEvidenceAssembly({
        jobId: job.jobId,
        eventId: jobRow.event_id,
        orgId: job.orgId,
      });
      logger.info(
        { jobId: job.jobId, eventId: jobRow.event_id },
        "Evidence assembly job enqueued"
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(
        { jobId: job.jobId, orgId: job.orgId, error: err.message },
        "Deterministic analyzer job failed"
      );
      await this.markFailed(job, err.message);
      throw err;
    }
  }

  /**
   * Run the 3-stage hybrid extraction pipeline
   */
  private async runExtractionPipeline(
    job: DeterministicAnalyzerJobData,
    jobRow: JobRow
  ): Promise<ExtractionResult> {
    logger.info(
      { jobId: job.jobId, eventId: jobRow.event_id },
      "Running extraction pipeline"
    );

    return this.extractionPipeline.extract(
      jobRow.event_id,
      job.orgId,
      jobRow.raw_payload
    );
  }

  /**
   * Persist extraction results to the rca_jobs table
   */
  private async persistExtractionResult(
    job: DeterministicAnalyzerJobData,
    result: ExtractionResult
  ): Promise<void> {
    await transaction(job.orgId, async (client) => {
      await client.query(
        `UPDATE rca_jobs
         SET extraction_result = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(result), job.jobId]
      );
    });
  }

  private async loadJob(job: DeterministicAnalyzerJobData): Promise<JobRow> {
    return transaction(job.orgId, async (client) => {
      const result = await client.query<JobRow>(
        `SELECT j.id, j.event_id, e.release, e.stack_trace, e.raw_payload
         FROM rca_jobs j
         INNER JOIN events e ON e.id = j.event_id
         WHERE j.id = $1
         LIMIT 1`,
        [job.jobId]
      );

      if (result.rows.length === 0) {
        throw new Error("RCA job not found");
      }

      return result.rows[0];
    });
  }

  private async prepareAnalyzerRequest(
    job: DeterministicAnalyzerJobData,
    jobRow: JobRow,
    extractionResult?: ExtractionResult
  ): Promise<AnalyzerRequestPayload> {
    // Use extraction result if available and complete
    if (extractionResult?.is_complete && extractionResult.repo) {
      return this.prepareFromExtractionResult(job, jobRow, extractionResult);
    }

    // Fall back to legacy extraction
    const frames = this.extractStackFrames(jobRow);
    if (frames.length === 0) {
      throw new Error("Missing stack frames for event");
    }

    const framesToAnalyze = this.selectFramesForAnalysis(frames);

    const repoContext = await this.resolveRepoContext(job, jobRow);
    const repoRecord = await this.loadRepository(job, repoContext.repoFullName);

    if (!repoRecord.installation_id) {
      throw new Error("Repository missing GitHub installation id");
    }

    const commitRef =
      repoContext.commitSha ?? repoRecord.default_branch ?? "main";
    if (!repoContext.commitSha) {
      logger.warn(
        {
          orgId: job.orgId,
          jobId: job.jobId,
          repo: repoRecord.full_name,
        },
        "Commit SHA missing, defaulting to repository branch"
      );
    }

    const codeSegments = [];
    for (const frame of framesToAnalyze) {
      let segmentAdded = false;

      if (this.shouldAttemptRepoFetch(frame)) {
        const result = await this.codeFetcher.fetchCodeForFrame(frame, {
          orgId: job.orgId,
          installationId: repoRecord.installation_id,
          repo: repoRecord.full_name,
          ref: commitRef,
        });

        if (result) {
          codeSegments.push({
            file_path: result.file.path,
            language: result.file.language ?? "text",
            content: result.file.content,
            error_line: frame.lineno ?? result.context.line_number,
            error_column: frame.colno ?? undefined,
          });
          segmentAdded = true;
        }
      } else {
        logger.debug(
          { file: frame.filename, line: frame.lineno },
          "Skipping repo fetch for non-user frame"
        );
      }

      if (!segmentAdded) {
        const embeddedContext = this.extractEmbeddedContext(frame);
        if (embeddedContext) {
          logger.debug(
            { file: frame.filename, line: frame.lineno },
            "Falling back to embedded code context from Sentry"
          );
          codeSegments.push(embeddedContext);
          segmentAdded = true;
        }
      }

      if (segmentAdded && codeSegments.length >= 3) {
        break;
      }
    }

    if (codeSegments.length === 0) {
      // Check if we only had non-user frames (node internals, third-party libs)
      const allFramesAreInternal = framesToAnalyze.every((frame) => {
        const filename = frame.filename ?? frame.abs_path ?? "";
        return (
          filename.startsWith("node:") ||
          filename.includes("node_modules") ||
          !filename
        );
      });

      if (allFramesAreInternal) {
        logger.info(
          { jobId: job.jobId },
          "All stack frames are internal/third-party - marking as no user code"
        );
        // Return a minimal payload indicating no user code to analyze
        return {
          org_id: job.orgId,
          repo: repoRecord.full_name,
          commit_sha: commitRef,
          frames: framesToAnalyze.map((frame) => ({
            file_path: frame.filename ?? "unknown",
            line_number: frame.lineno ?? 0,
            column_number: frame.colno ?? undefined,
            function: frame.function ?? null,
          })),
          code_segments: [],
          metadata: {
            no_user_code: true,
            reason: "All frames are Node.js internals or third-party libraries",
          },
        } as AnalyzerRequestPayload;
      }

      throw new Error("Unable to collect code contexts for stack frames");
    }

    const requestPayload: AnalyzerRequestPayload = {
      org_id: job.orgId,
      repo: repoRecord.full_name,
      commit_sha: commitRef,
      frames: framesToAnalyze.map((frame) => ({
        file_path: frame.filename ?? frame.abs_path ?? "unknown",
        line_number: frame.lineno ?? 0,
        column_number: frame.colno ?? undefined,
        function: frame.function ?? null,
      })),
      code_segments: codeSegments,
    };

    return requestPayload;
  }

  /**
   * Prepare analyzer request using extraction pipeline results
   * This is the preferred path when extraction succeeds
   */
  private async prepareFromExtractionResult(
    job: DeterministicAnalyzerJobData,
    _jobRow: JobRow, // Kept for interface consistency, may be used for fallback
    extractionResult: ExtractionResult
  ): Promise<AnalyzerRequestPayload> {
    logger.info(
      {
        jobId: job.jobId,
        extractionId: extractionResult.extraction_id,
        repo: extractionResult.repo,
        framesCount: extractionResult.frames.length,
        confidence: extractionResult.confidence,
      },
      "Preparing analyzer request from extraction result"
    );

    // Get user_code frames for analysis
    const userFrames = extractionResult.frames.filter(
      (f) => f.classification === "user_code"
    );

    if (userFrames.length === 0) {
      // No user code found in extraction
      return {
        org_id: job.orgId,
        repo: extractionResult.repo!,
        commit_sha:
          extractionResult.commit_sha ?? extractionResult.branch ?? "main",
        frames: extractionResult.frames.map((frame) => ({
          file_path: frame.file_path,
          line_number: frame.line_number,
          column_number: frame.column_number,
          function: frame.function_name ?? null,
        })),
        code_segments: [],
        metadata: {
          no_user_code: true,
          reason: "No user code frames identified by extraction pipeline",
          extraction_id: extractionResult.extraction_id,
        },
      } as AnalyzerRequestPayload;
    }

    // Load repository for code fetching
    const repoRecord = await this.loadRepository(job, extractionResult.repo!);
    if (!repoRecord.installation_id) {
      throw new Error("Repository missing GitHub installation id");
    }

    const commitRef =
      extractionResult.commit_sha ?? repoRecord.default_branch ?? "main";

    // Fetch code for user frames
    const codeSegments = [];
    const framesToAnalyze = userFrames.slice(0, 3); // Analyze top 3 user frames

    for (const frame of framesToAnalyze) {
      // Convert ExtractedFrame to StackFrame for code fetcher
      const stackFrame: StackFrame = {
        filename: frame.file_path,
        abs_path: frame.abs_path ?? null,
        lineno: frame.line_number,
        colno: frame.column_number ?? null,
        function: frame.function_name ?? null,
        context_line: frame.context_line ?? null,
        pre_context: null,
        post_context: null,
        in_app: frame.classification === "user_code",
      };

      const result = await this.codeFetcher.fetchCodeForFrame(stackFrame, {
        orgId: job.orgId,
        installationId: repoRecord.installation_id,
        repo: repoRecord.full_name,
        ref: commitRef,
      });

      if (result) {
        codeSegments.push({
          file_path: result.file.path,
          language: result.file.language ?? "text",
          content: result.file.content,
          error_line: frame.line_number,
          error_column: frame.column_number,
        });
      } else if (frame.context_line) {
        // Fall back to embedded context from Sentry
        codeSegments.push({
          file_path: frame.file_path,
          language: this.inferLanguageFromPath(frame.file_path),
          content: frame.context_line,
          error_line: frame.line_number,
          error_column: frame.column_number,
        });
      }
    }

    if (codeSegments.length === 0) {
      throw new Error("Unable to collect code contexts for extracted frames");
    }

    return {
      org_id: job.orgId,
      repo: extractionResult.repo!,
      commit_sha: commitRef,
      frames: framesToAnalyze.map((frame) => ({
        file_path: frame.file_path,
        line_number: frame.line_number,
        column_number: frame.column_number,
        function: frame.function_name ?? null,
      })),
      code_segments: codeSegments,
      metadata: {
        extraction_id: extractionResult.extraction_id,
        extraction_confidence: extractionResult.confidence,
      },
    } as AnalyzerRequestPayload;
  }

  /**
   * Infer language from file path extension
   */
  private inferLanguageFromPath(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const extMap: Record<string, string> = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      py: "python",
      rb: "ruby",
      go: "go",
      rs: "rust",
      java: "java",
    };
    return extMap[ext] ?? "text";
  }

  private shouldAttemptRepoFetch(frame: StackFrame): boolean {
    const filename = frame.filename ?? frame.abs_path ?? "";
    if (!filename) {
      return false;
    }

    if (filename.startsWith("node:")) {
      return false;
    }

    return true;
  }

  private extractStackFrames(jobRow: JobRow): StackFrame[] {
    const fromColumn = this.safeGetFrames(jobRow.stack_trace);
    if (fromColumn.length > 0) {
      return fromColumn;
    }

    return this.safeGetFrames(jobRow.raw_payload);
  }

  private safeGetFrames(source: unknown): StackFrame[] {
    if (!source) {
      return [];
    }

    const directFrames = this.extractFramesFromStacktrace(source);
    if (directFrames.length > 0) {
      return directFrames;
    }

    const eventPayload = extractEventPayload(source);
    if (!eventPayload) {
      return [];
    }

    const exceptionValues = eventPayload["exception"] as
      | { values?: Array<{ stacktrace?: { frames?: StackFrame[] } }> }
      | undefined;

    if (exceptionValues?.values && exceptionValues.values.length > 0) {
      const frames = exceptionValues.values[0]?.stacktrace?.frames;
      if (Array.isArray(frames)) {
        return frames
          .map((frame) => this.normalizeFrame(frame))
          .filter((frame): frame is StackFrame => Boolean(frame));
      }
    }

    return [];
  }

  private extractFramesFromStacktrace(source: unknown): StackFrame[] {
    if (!source || typeof source !== "object") {
      return [];
    }

    const maybeStack = source as { [key: string]: unknown };
    const frames = maybeStack["frames"] as StackFrame[] | undefined;
    if (Array.isArray(frames)) {
      return frames
        .map((frame) => this.normalizeFrame(frame))
        .filter((frame): frame is StackFrame => Boolean(frame));
    }

    return [];
  }

  private normalizeFrame(frame: Partial<StackFrame>): StackFrame | null {
    const filename = frame.filename || frame.abs_path;
    if (!filename) {
      return null;
    }

    return {
      filename,
      abs_path: frame.abs_path ?? null,
      colno: frame.colno ?? null,
      context_line: frame.context_line ?? null,
      function: frame.function ?? null,
      lineno: frame.lineno ?? null,
      pre_context: frame.pre_context ?? null,
      post_context: frame.post_context ?? null,
      in_app: frame.in_app ?? true,
    };
  }

  /**
   * Extract code context embedded in the stack frame (from Sentry).
   * This is available when Sentry captures pre_context, context_line, post_context.
   */
  private extractEmbeddedContext(frame: StackFrame): {
    file_path: string;
    language: string;
    content: string;
    error_line: number;
    error_column?: number;
  } | null {
    if (!frame.context_line || !frame.lineno) {
      return null;
    }

    // Assemble the code from pre_context + context_line + post_context
    const lines: string[] = [];
    const preContext = frame.pre_context ?? [];
    const postContext = frame.post_context ?? [];

    // Add pre-context lines
    for (const line of preContext) {
      lines.push(line);
    }

    // Add the error line
    lines.push(frame.context_line);

    // Add post-context lines
    for (const line of postContext) {
      lines.push(line);
    }

    if (lines.length === 0) {
      return null;
    }

    // Determine language from file extension
    const filename = frame.filename ?? frame.abs_path ?? "unknown";
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const language = this.inferLanguage(ext, filename);

    return {
      file_path: filename,
      language,
      content: lines.join("\n"),
      error_line: frame.lineno,
      error_column: frame.colno ?? undefined,
    };
  }

  private inferLanguage(ext: string, filename: string): string {
    const extMap: Record<string, string> = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      py: "python",
      rb: "ruby",
      go: "go",
      rs: "rust",
      java: "java",
      kt: "kotlin",
      swift: "swift",
      cs: "csharp",
      php: "php",
    };

    if (extMap[ext]) {
      return extMap[ext];
    }

    // Check for common patterns
    if (filename.includes(".js") || filename.includes("node:")) {
      return "javascript";
    }

    return "text";
  }

  private selectFramesForAnalysis(frames: StackFrame[]): StackFrame[] {
    const preferred = frames
      .slice()
      .reverse()
      .filter(
        (frame) =>
          frame.in_app !== false && Boolean(frame.filename && frame.lineno)
      );

    if (preferred.length === 0) {
      return frames
        .slice()
        .reverse()
        .filter((frame) => Boolean(frame.filename && frame.lineno))
        .slice(0, 3);
    }

    return preferred.slice(0, 3);
  }

  private async resolveRepoContext(
    job: DeterministicAnalyzerJobData,
    jobRow: JobRow
  ): Promise<RepoReference> {
    // 1. Try release string format: owner/repo@commitsha
    const releaseContext = parseReleaseString(jobRow.release);
    if (releaseContext) {
      return releaseContext;
    }

    // 2. Try extracting from payload contexts/tags
    const payloadRepo = extractRepoFromPayload(jobRow.raw_payload);
    if (payloadRepo) {
      return payloadRepo;
    }

    // 3. Fallback: If only one repo is registered for the org, use it
    const fallbackRepo = await this.getSingleRegisteredRepo(job.orgId);
    if (fallbackRepo) {
      logger.info(
        { orgId: job.orgId, repo: fallbackRepo.repoFullName },
        "Using single registered repo as fallback"
      );
      // Use the release field as commit SHA if it looks like a SHA
      const commitSha = this.isValidCommitSha(jobRow.release)
        ? jobRow.release
        : undefined;
      return {
        repoFullName: fallbackRepo.repoFullName,
        commitSha,
      };
    }

    throw new Error(
      `Unable to resolve repository for event ${jobRow.event_id} (org ${job.orgId})`
    );
  }

  private async getSingleRegisteredRepo(
    orgId: string
  ): Promise<RepoReference | null> {
    return transaction(orgId, async (client) => {
      const result = await client.query<{
        full_name: string;
        default_branch: string;
      }>(`SELECT full_name, default_branch FROM repos WHERE org_id = $1`, [
        orgId,
      ]);

      // Only use fallback if exactly one repo is registered
      if (result.rows.length === 1) {
        return {
          repoFullName: result.rows[0].full_name,
          commitSha: undefined,
        };
      }

      return null;
    });
  }

  private isValidCommitSha(value: string | null): boolean {
    if (!value) return false;
    return /^[0-9a-f]{7,40}$/i.test(value);
  }

  private async loadRepository(
    job: DeterministicAnalyzerJobData,
    fullName: string
  ): Promise<RepoRecord> {
    return transaction(job.orgId, async (client) => {
      const result = await client.query<RepoRecord>(
        `SELECT id, full_name, installation_id, default_branch
         FROM repos
         WHERE org_id = $1 AND full_name = $2
         LIMIT 1`,
        [job.orgId, fullName]
      );

      if (result.rows.length === 0) {
        throw new Error(`Repository ${fullName} not registered for org`);
      }

      return result.rows[0];
    });
  }

  private async persistFindings(
    job: DeterministicAnalyzerJobData,
    result: AnalyzerResult
  ): Promise<void> {
    return transaction(job.orgId, async (client) => {
      await client.query(
        `UPDATE rca_jobs
         SET deterministic_findings = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(result), job.jobId]
      );
    });
  }

  private async markFetchingCode(
    job: DeterministicAnalyzerJobData
  ): Promise<void> {
    await transaction(job.orgId, async (client) => {
      await client.query(
        `UPDATE rca_jobs
         SET status = 'fetching_code',
             started_at = COALESCE(started_at, NOW()),
             updated_at = NOW()
         WHERE id = $1`,
        [job.jobId]
      );
    });
  }

  private async markAnalyzing(
    job: DeterministicAnalyzerJobData
  ): Promise<void> {
    await transaction(job.orgId, async (client) => {
      await client.query(
        `UPDATE rca_jobs
         SET status = 'analyzing',
             updated_at = NOW()
         WHERE id = $1`,
        [job.jobId]
      );
    });
  }

  private async markDeterministicComplete(
    job: DeterministicAnalyzerJobData
  ): Promise<void> {
    await transaction(job.orgId, async (client) => {
      await client.query(
        `UPDATE rca_jobs
         SET status = 'deterministic_complete',
             updated_at = NOW()
         WHERE id = $1`,
        [job.jobId]
      );
    });
  }

  private async markNoUserCode(
    job: DeterministicAnalyzerJobData,
    reason: string
  ): Promise<void> {
    await transaction(job.orgId, async (client) => {
      await client.query(
        `UPDATE rca_jobs
         SET status = 'no_user_code',
             error_message = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [reason.slice(0, 512), job.jobId]
      );
    });
  }

  private async markFailed(
    job: DeterministicAnalyzerJobData,
    reason: string
  ): Promise<void> {
    await transaction(job.orgId, async (client) => {
      await client.query(
        `UPDATE rca_jobs
         SET status = 'failed',
             error_message = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [reason.slice(0, 512), job.jobId]
      );
    });
  }
}
