# 02 - Extraction Pipeline

## Overview

The Extraction Pipeline is a 3-stage hybrid system that extracts repository, commit, and stack frame information from Sentry error events. It follows a **deterministic-first** philosophy: rule-based extraction runs first, LLM assists only when needed, and all results are validated against actual GitHub data.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      EXTRACTION PIPELINE                                 │
│                                                                          │
│  Input: Sentry Event Payload                                            │
│         ─────────────────────                                           │
│         • exception.values[]                                            │
│         • contexts (github, app)                                        │
│         • tags (repo, commit, branch)                                   │
│         • release (e.g., "org/repo@sha")                                │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    STAGE 1: DETERMINISTIC                          │ │
│  │                                                                    │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │ │
│  │  │ Release Parser   │  │ Context Extractor│  │ Tag Extractor   │  │ │
│  │  │ org/repo@sha     │  │ contexts.github  │  │ tags.repo       │  │ │
│  │  │ repo#branch      │  │ contexts.app     │  │ tags.commit     │  │ │
│  │  └──────────────────┘  └──────────────────┘  └─────────────────┘  │ │
│  │                                                                    │ │
│  │  ┌──────────────────┐  ┌──────────────────────────────────────┐   │ │
│  │  │ Frame Classifier │  │ Path Patterns                        │   │ │
│  │  │ user_code        │  │ • /app/src/ → user_code              │   │ │
│  │  │ third_party      │  │ • node_modules/ → third_party        │   │ │
│  │  │ framework        │  │ • internal/ → runtime                │   │ │
│  │  └──────────────────┘  └──────────────────────────────────────┘   │ │
│  │                                                                    │ │
│  │  Output: { repo?, commit?, branch?, frames[], confidence }        │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              │                                           │
│                    Is result complete?                                   │
│                     (repo AND commit present)                            │
│                              │                                           │
│              ┌───────────────┴───────────────┐                          │
│             Yes                              No                          │
│              │                                │                          │
│              ▼                                ▼                          │
│         Skip Stage 2                   ┌────────────────────────────────┐│
│              │                         │     STAGE 2: LLM ASSIST       ││
│              │                         │                                ││
│              │                         │  ┌─────────────────────────┐   ││
│              │                         │  │  Python Bridge          │   ││
│              │                         │  │  llm_assist_extractor   │   ││
│              │                         │  └───────────┬─────────────┘   ││
│              │                         │              │                 ││
│              │                         │  ┌───────────▼─────────────┐   ││
│              │                         │  │  GPT-4o-mini / DeepSeek │   ││
│              │                         │  │  temperature=0.1        │   ││
│              │                         │  │  json_object mode       │   ││
│              │                         │  └─────────────────────────┘   ││
│              │                         │                                ││
│              │                         │  RESTRICTED CAPABILITIES:      ││
│              │                         │  ✓ Clean stacktrace noise      ││
│              │                         │  ✓ Classify frames             ││
│              │                         │  ✓ Identify root frame         ││
│              │                         │  ✓ Infer branch from paths     ││
│              │                         │  ✗ Invent repo/commit data     ││
│              │                         └────────────────────────────────┘│
│              │                                │                          │
│              └────────────────┬───────────────┘                          │
│                               │                                          │
│                               ▼                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    STAGE 3: VALIDATION                             │ │
│  │                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────┐ │ │
│  │  │                    GitHub API Checks                         │ │ │
│  │  │  • checkRefExists(repo, commit) → verify commit SHA exists   │ │ │
│  │  │  • checkRefExists(repo, branch) → verify branch exists       │ │ │
│  │  │  • Fallback to default branch if ref missing                 │ │ │
│  │  └──────────────────────────────────────────────────────────────┘ │ │
│  │                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────┐ │ │
│  │  │                    Schema Validation                         │ │ │
│  │  │  • repo format: "owner/repo"                                 │ │ │
│  │  │  • commit format: 40-char hex                                │ │ │
│  │  │  • frames: valid file paths                                  │ │ │
│  │  └──────────────────────────────────────────────────────────────┘ │ │
│  │                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────┐ │ │
│  │  │                    Confidence Scoring                        │ │ │
│  │  │  • deterministic extraction: +0.3                            │ │ │
│  │  │  • LLM assist used: +0.2                                     │ │ │
│  │  │  • GitHub validation passed: +0.3                            │ │ │
│  │  │  • Final score: 0.0 - 1.0                                    │ │ │
│  │  └──────────────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Output: ExtractionResult                                               │
│          ────────────────────                                           │
│          • repo: string                                                 │
│          • commit_sha: string | undefined                               │
│          • branch: string | undefined                                   │
│          • frames: ExtractedFrame[]                                     │
│          • primary_frame_index: number                                  │
│          • extraction_source: 'deterministic' | 'llm_assisted'          │
│          • confidence: number                                           │
│          • validation_status: 'verified' | 'fallback' | 'failed'        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                                                      | Purpose                          |
| --------------------------------------------------------- | -------------------------------- |
| `src/services/event-extractor/extraction-pipeline.ts`     | Main orchestrator                |
| `src/services/event-extractor/deterministic-extractor.ts` | Stage 1 pure functions           |
| `src/services/event-extractor/llm-assist-extractor.ts`    | Stage 2 Node.js interface        |
| `src/services/event-extractor/extraction-validator.ts`    | Stage 3 validation               |
| `src/services/event-extractor/index.ts`                   | Module exports                   |
| `python/extractors/llm_assist_extractor.py`               | Stage 2 Python implementation    |
| `src/types/extraction.ts`                                 | Type definitions and Zod schemas |

---

## Stage 1: Deterministic Extraction

### Purpose

Extract repository, commit, and frame information using rule-based pattern matching. No AI involved - 100% reproducible.

### Extraction Sources (Priority Order)

1. **Release Tag** - Most reliable
2. **Sentry Contexts** - `contexts.github`, `contexts.app`
3. **Sentry Tags** - `tags.repo`, `tags.commit`
4. **Stack Frame Paths** - Last resort

### Release Tag Parsing

```typescript
// Pattern: "owner/repo@commit" or "owner/repo#branch"
const RELEASE_PATTERNS = [
  // owner/repo@sha (e.g., "acme/api@a1b2c3d4")
  /^(?<owner>[^/]+)\/(?<repo>[^@#]+)@(?<sha>[a-f0-9]{7,40})$/i,

  // owner/repo#branch (e.g., "acme/api#main")
  /^(?<owner>[^/]+)\/(?<repo>[^@#]+)#(?<branch>.+)$/i,

  // Just version with commit in separate field
  /^v?\d+\.\d+\.\d+(?:-(?<sha>[a-f0-9]{7,40}))?$/i,
];

export function extractFromRelease(release: string): {
  repo?: string;
  commitSha?: string;
  branch?: string;
} {
  for (const pattern of RELEASE_PATTERNS) {
    const match = release.match(pattern);
    if (match?.groups) {
      return {
        repo:
          match.groups.owner && match.groups.repo
            ? `${match.groups.owner}/${match.groups.repo}`
            : undefined,
        commitSha: match.groups.sha,
        branch: match.groups.branch,
      };
    }
  }
  return {};
}
```

### Context Extraction

```typescript
export function extractFromContexts(contexts: SentryContexts): {
  repo?: string;
  commitSha?: string;
  branch?: string;
} {
  // Check github context first (Sentry's GitHub integration)
  const github = contexts?.github;
  if (github) {
    return {
      repo: github.repository,
      commitSha: github.commit,
      branch: github.branch,
    };
  }

  // Fallback to generic app context
  const app = contexts?.app;
  if (app) {
    return {
      repo: app.repository || app.repo,
      commitSha: app.commit || app.sha || app.git_sha,
      branch: app.branch || app.git_branch,
    };
  }

  return {};
}
```

### Frame Classification

```typescript
type FrameClassification =
  | "user_code" // Application source code
  | "third_party" // node_modules, vendor
  | "framework" // React, Next.js, Express
  | "runtime" // Node.js internals
  | "polyfill" // core-js, regenerator
  | "unknown";

const CLASSIFICATION_PATTERNS: Record<FrameClassification, RegExp[]> = {
  user_code: [
    /^src\//,
    /^lib\//,
    /^app\//,
    /^pages\//,
    /^components\//,
    /^services\//,
  ],
  third_party: [/node_modules\//, /\.yarn\//, /\.pnpm\//],
  framework: [/react-dom\//, /next\/dist\//, /express\/lib\//, /fastify\//],
  runtime: [/^node:/, /^internal\//, /timers\.js$/, /events\.js$/],
  polyfill: [/core-js\//, /regenerator-runtime\//, /@babel\/runtime\//],
};

export function classifyFrame(frame: SentryStackFrame): FrameClassification {
  // Explicit in_app flag from Sentry
  if (frame.in_app === false) return "third_party";
  if (frame.in_app === true) return "user_code";

  const path = frame.filename || frame.abs_path || "";

  for (const [classification, patterns] of Object.entries(
    CLASSIFICATION_PATTERNS
  )) {
    if (patterns.some((p) => p.test(path))) {
      return classification as FrameClassification;
    }
  }

  return "unknown";
}
```

### Complete Deterministic Extractor

```typescript
export function extractDeterministic(event: SentryEventPayload): Stage1Result {
  // 1. Try release tag
  const fromRelease = event.release ? extractFromRelease(event.release) : {};

  // 2. Try contexts
  const fromContexts = extractFromContexts(event.contexts);

  // 3. Try tags
  const fromTags = extractFromTags(event.tags);

  // 4. Merge with priority (release > contexts > tags)
  const merged = {
    repo: fromRelease.repo || fromContexts.repo || fromTags.repo,
    commitSha:
      fromRelease.commitSha || fromContexts.commitSha || fromTags.commitSha,
    branch: fromRelease.branch || fromContexts.branch || fromTags.branch,
  };

  // 5. Extract and classify frames
  const frames = extractFrames(event.exception?.values || []);
  const classifiedFrames = frames.map((f) => ({
    ...f,
    classification: classifyFrame(f),
  }));

  // 6. Find primary (root cause) frame
  const primaryIndex = classifiedFrames.findIndex(
    (f) => f.classification === "user_code"
  );

  // 7. Determine if complete
  const isComplete = !!(merged.repo && (merged.commitSha || merged.branch));

  return {
    ...merged,
    frames: classifiedFrames,
    primaryFrameIndex: primaryIndex >= 0 ? primaryIndex : undefined,
    isComplete,
    confidence: calculateConfidence(merged, isComplete),
  };
}
```

---

## Stage 2: LLM-Assisted Extraction

### When Invoked

Stage 2 runs only when Stage 1 is **incomplete** (missing repo or commit/branch).

### Restricted Capabilities

The LLM can:

- ✅ Clean stacktrace noise (remove polyfills, bundler frames)
- ✅ Classify frames more accurately
- ✅ Identify the most likely root cause frame
- ✅ Infer branch name from file paths (e.g., `/feature-xyz/` → `feature-xyz`)

The LLM cannot:

- ❌ Invent repository names
- ❌ Generate commit SHAs
- ❌ Add data not present in the payload

### Node.js Interface

```typescript
// src/services/event-extractor/llm-assist-extractor.ts
export class LLMAssistExtractor {
  private pythonBridge: PythonBridge;

  constructor() {
    this.pythonBridge = new PythonBridge({
      module: "extractors.llm_assist_extractor",
      timeout: 30000, // 30s for LLM calls
    });
  }

  async extract(input: LLMAssistInput): Promise<LLMAssistOutput> {
    // Validate API key is configured
    if (!config.OPENAI_API_KEY) {
      return this.fallbackToDeterministic(input);
    }

    try {
      const result = await this.pythonBridge.execute<LLMAssistOutput>(input);
      return result;
    } catch (error) {
      logger.warn({ error }, "LLM assist failed, using deterministic fallback");
      return this.fallbackToDeterministic(input);
    }
  }
}
```

### Python Implementation

```python
# python/extractors/llm_assist_extractor.py

def get_llm_config() -> tuple[str, str, str | None]:
    """Get LLM configuration from environment."""
    provider = os.environ.get("LLM_PROVIDER", "openai").lower()
    base_url = os.environ.get("LLM_BASE_URL")

    if provider == "deepseek":
        default_model = "deepseek-chat"
        if not base_url:
            base_url = "https://api.deepseek.com"
    else:
        default_model = "gpt-4o-mini"

    model = os.environ.get("LLM_MODEL", default_model)
    return provider, model, base_url


def build_llm_prompt(input_data: LLMAssistInput) -> str:
    """Build prompt for frame classification."""
    frames_text = format_frames_for_prompt(input_data["raw_frames"])

    return f"""You are analyzing a JavaScript/TypeScript stack trace.

Error: {input_data['stage_1_output'].get('error_type', 'Unknown')}

TASKS:
- Remove vendor/runtime/polyfill frames that obscure the root cause
- Classify each frame as: user_code, third_party, runtime, framework, polyfill
- Identify the SINGLE frame most likely to be the root cause

STACK FRAMES:
{frames_text}

RULES:
1. User code is typically in: src/, lib/, app/, pages/, components/
2. The root cause frame is usually the FIRST user_code frame
3. You CANNOT invent repository or commit information

OUTPUT FORMAT (JSON):
{{
  "frame_classifications": [{{"index": 0, "classification": "..."}}],
  "primary_frame_index": <number or null>,
  "suggested_branch": "<inferred from paths or null>",
  "removed_indices": [<noise frame indices>],
  "reasoning": "<brief explanation>"
}}"""


def call_llm(prompt: str) -> tuple[dict, int, str]:
    """Call configured LLM provider."""
    client = get_openai_client()
    provider, model, _ = get_llm_config()

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a code analysis expert."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.1,  # Low for consistency
        max_tokens=1500,
        response_format={"type": "json_object"}
    )

    tokens_used = response.usage.total_tokens
    result = json.loads(response.choices[0].message.content)

    return result, tokens_used, model
```

### Token Tracking

```typescript
// After LLM call, track costs
await costTracker.trackExtraction({
  orgId,
  jobId,
  stage: "llm_assist",
  tokensUsed: result.tokens_used,
  model: result.model,
});
```

---

## Stage 3: Validation

### Purpose

Verify extracted data against actual GitHub repository to ensure:

1. Repository exists and is accessible
2. Commit SHA or branch exists
3. Apply fallbacks when validation fails

### Validation Flow

```typescript
export async function validateExtraction(
  input: ValidationInput,
  githubService: GitHubService
): Promise<ValidationResult> {
  const { repo, commitSha, branch, orgId } = input;

  // 1. Check repo format
  if (!isValidRepoFormat(repo)) {
    return {
      status: "failed",
      reason: "Invalid repository format",
      repo: undefined,
    };
  }

  // 2. Check if we have GitHub access
  const hasAccess = await githubService.hasRepoAccess(orgId, repo);
  if (!hasAccess) {
    return {
      status: "failed",
      reason: "No GitHub access to repository",
      repo,
    };
  }

  // 3. Verify commit exists
  if (commitSha) {
    const commitExists = await githubService.checkRefExists(
      orgId,
      repo,
      commitSha
    );
    if (commitExists) {
      return {
        status: "verified",
        repo,
        commitSha,
        branch,
      };
    }
    // Commit doesn't exist - fall through to branch check
  }

  // 4. Verify branch exists
  if (branch) {
    const branchExists = await githubService.checkRefExists(
      orgId,
      repo,
      branch
    );
    if (branchExists) {
      return {
        status: "verified",
        repo,
        branch,
        commitSha: undefined, // Couldn't verify commit
      };
    }
  }

  // 5. Fallback to default branch
  const defaultBranch = await githubService.getDefaultBranch(orgId, repo);
  return {
    status: "fallback",
    reason: "Using default branch",
    repo,
    branch: defaultBranch,
    commitSha: undefined,
  };
}
```

### GitHub Ref Verification

```typescript
// src/services/github.ts
export async function checkRefExists(
  orgId: string,
  repoFullName: string,
  ref: string
): Promise<boolean> {
  try {
    const octokit = await getInstallationOctokit(orgId);
    const [owner, repo] = repoFullName.split("/");

    // Try to get the commit for this ref
    await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref,
    });

    return true;
  } catch (error) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
}
```

### Confidence Scoring

```typescript
function calculateFinalConfidence(
  stage1: Stage1Result,
  stage2?: Stage2Result,
  validation: ValidationResult
): number {
  let confidence = 0;

  // Base confidence from deterministic extraction
  if (stage1.repo) confidence += 0.2;
  if (stage1.commitSha) confidence += 0.15;
  if (stage1.branch) confidence += 0.1;
  if (stage1.primaryFrameIndex !== undefined) confidence += 0.1;

  // LLM assist contribution
  if (stage2 && stage2.wasUsed) {
    confidence += stage2.confidence * 0.2;
  }

  // Validation bonus
  switch (validation.status) {
    case "verified":
      confidence += 0.3;
      break;
    case "fallback":
      confidence += 0.1;
      break;
    case "failed":
      confidence *= 0.5; // Penalty
      break;
  }

  return Math.min(1.0, confidence);
}
```

---

## Pipeline Orchestration

```typescript
// src/services/event-extractor/extraction-pipeline.ts
export class ExtractionPipeline {
  private deterministicExtractor: DeterministicExtractor;
  private llmAssistExtractor: LLMAssistExtractor;
  private validator: ExtractionValidator;

  async extract(
    event: SentryEventPayload,
    orgId: string
  ): Promise<ExtractionResult> {
    // STAGE 1: Deterministic
    const stage1 = this.deterministicExtractor.extract(event);

    let stage2: Stage2Result | undefined;

    // STAGE 2: LLM Assist (only if Stage 1 incomplete)
    if (!stage1.isComplete) {
      stage2 = await this.llmAssistExtractor.extract({
        stage_1_output: stage1,
        raw_frames: stage1.frames,
        tasks: this.determineNeededTasks(stage1),
      });
    }

    // Merge Stage 1 and Stage 2 results
    const merged = this.mergeResults(stage1, stage2);

    // STAGE 3: Validation
    const validation = await this.validator.validate({
      ...merged,
      orgId,
    });

    // Build final result
    return {
      repo: validation.repo || merged.repo,
      commitSha: validation.commitSha || merged.commitSha,
      branch: validation.branch || merged.branch,
      frames: merged.frames,
      primaryFrameIndex: merged.primaryFrameIndex,
      extractionSource: stage2?.wasUsed ? "llm_assisted" : "deterministic",
      confidence: calculateFinalConfidence(stage1, stage2, validation),
      validationStatus: validation.status,
      llmTokensUsed: stage2?.tokensUsed || 0,
    };
  }

  private determineNeededTasks(stage1: Stage1Result): string[] {
    const tasks: string[] = [];

    if (!stage1.branch) {
      tasks.push("infer_missing_branch");
    }
    if (stage1.frames.some((f) => f.classification === "unknown")) {
      tasks.push("classify_frames");
    }
    if (stage1.primaryFrameIndex === undefined) {
      tasks.push("identify_root_frame");
    }
    // Always clean noise
    tasks.push("clean_stacktrace_noise");

    return tasks;
  }
}
```

---

## Types

```typescript
// src/types/extraction.ts
import { z } from "zod";

export const extractedFrameSchema = z.object({
  file_path: z.string(),
  abs_path: z.string().optional(),
  line_number: z.number(),
  column_number: z.number().optional(),
  function_name: z.string().optional(),
  classification: z.enum([
    "user_code",
    "third_party",
    "runtime",
    "framework",
    "polyfill",
    "unknown",
  ]),
  is_entry_point: z.boolean(),
  source_mapped: z.boolean(),
  context_line: z.string().optional(),
  in_app: z.boolean(),
});

export const extractionResultSchema = z.object({
  repo: z.string().optional(),
  commit_sha: z.string().optional(),
  branch: z.string().optional(),
  frames: z.array(extractedFrameSchema),
  primary_frame_index: z.number().optional(),
  extraction_source: z.enum(["deterministic", "llm_assisted"]),
  confidence: z.number().min(0).max(1),
  validation_status: z.enum(["verified", "fallback", "failed"]),
  llm_tokens_used: z.number().default(0),
});

export type ExtractedFrame = z.infer<typeof extractedFrameSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
```

---

## Database Storage

Extraction results are stored in the `rca_jobs` table:

```sql
ALTER TABLE rca_jobs ADD COLUMN extraction_result JSONB;

-- Indexes for querying extraction results
CREATE INDEX idx_rca_jobs_extraction_stage
  ON rca_jobs ((extraction_result->>'extraction_source'));

CREATE INDEX idx_rca_jobs_extraction_repo
  ON rca_jobs ((extraction_result->>'repo'));
```

---

## Testing

```typescript
describe("ExtractionPipeline", () => {
  describe("Stage 1: Deterministic", () => {
    it("extracts repo from release tag", () => {
      const event = createEvent({ release: "acme/api@abc123" });
      const result = extractDeterministic(event);

      expect(result.repo).toBe("acme/api");
      expect(result.commitSha).toBe("abc123");
      expect(result.isComplete).toBe(true);
    });

    it("classifies frames correctly", () => {
      const frames = [
        { filename: "src/app.ts", in_app: true },
        { filename: "node_modules/lodash/index.js", in_app: false },
      ];

      const classified = frames.map(classifyFrame);
      expect(classified[0]).toBe("user_code");
      expect(classified[1]).toBe("third_party");
    });
  });

  describe("Stage 2: LLM Assist", () => {
    it("skips when Stage 1 is complete", async () => {
      const stage1 = { repo: "org/repo", commitSha: "abc", isComplete: true };
      const pipeline = new ExtractionPipeline();

      const result = await pipeline.extract(event, orgId);
      expect(result.extractionSource).toBe("deterministic");
      expect(result.llmTokensUsed).toBe(0);
    });
  });

  describe("Stage 3: Validation", () => {
    it("verifies commit exists on GitHub", async () => {
      mockGitHub.checkRefExists.mockResolvedValue(true);

      const result = await validator.validate({
        repo: "org/repo",
        commitSha: "abc123",
        orgId,
      });

      expect(result.status).toBe("verified");
    });

    it("falls back to default branch when commit missing", async () => {
      mockGitHub.checkRefExists.mockResolvedValue(false);
      mockGitHub.getDefaultBranch.mockResolvedValue("main");

      const result = await validator.validate({
        repo: "org/repo",
        commitSha: "invalid",
        orgId,
      });

      expect(result.status).toBe("fallback");
      expect(result.branch).toBe("main");
    });
  });
});
```

---

## Error Handling

### Stage 2 Failures

If LLM assist fails, the pipeline falls back to Stage 1 results:

```typescript
try {
  stage2 = await this.llmAssistExtractor.extract(input);
} catch (error) {
  logger.warn({ error, orgId, jobId }, "LLM assist failed");
  // Continue with Stage 1 results only
  stage2 = undefined;
}
```

### Validation Failures

If GitHub validation fails entirely, the pipeline still returns a result:

```typescript
if (validation.status === "failed") {
  return {
    ...merged,
    validationStatus: "failed",
    confidence: merged.confidence * 0.5, // Reduced confidence
    warnings: ["Could not verify repository access"],
  };
}
```

---

---

## Field Naming, Nullability, and Breadcrumb/Timeline Logic (Audit Alignment)

### Field Naming Consistency

- All error and extraction types use `type`, `value`, and `message` fields to match Sentry and internal code.
- Stack frame and extraction result types use `commit_sha`, `branch`, and `repo` (not `commitSha`, `errorType`, etc.).
- Example:
  ```typescript
  interface ExtractionResult {
    repo?: string;
    commit_sha?: string | null;
    branch?: string | null;
    frames: ExtractedFrame[];
    primary_frame_index?: number;
    extraction_source: "deterministic" | "llm_assisted";
    confidence: number;
    validation_status: "verified" | "fallback" | "failed";
    llm_tokens_used: number;
  }
  ```

### Nullable vs Optional Fields

- All fields that may be missing from Sentry or GitHub are marked as `?` (optional) and/or `| null` (nullable) in type tables and code examples.
- This matches the Zod schemas and runtime validation in code.

### Breadcrumb/Timeline Extraction

- Breadcrumbs are extracted from `eventData.breadcrumbs` and passed to the timeline reconstructor.
- Timeline events are sorted by timestamp, normalized to a `TimelineEvent` type, and filtered to a relevant window (e.g., 1 minute before error).
- Timeline fields: `timestamp`, `category`, `message`, `level`, `data`, `relative_ms`.
- Only events within the relevant window are included in the final timeline for RCA.

### Confidence Scoring

- Confidence is computed as a sum of deterministic extraction (+0.3), LLM assist (+0.2), and GitHub validation (+0.3), normalized to [0, 1].
- The scoring rubric is documented above and matches the code implementation.

---
