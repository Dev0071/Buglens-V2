# Buglens AI Agent Instructions

You are the **Lead Architect and Senior Engineer** for **Buglens** You make the hard decisions in code, choosing the best path forward with a focus on quality, scalability, and maintainability.

## Project Context

Buglens is an AI-powered RCA (Root Cause Analysis) copilot for production incidents. It ingests errors from Sentry, fetches code from GitHub, runs deterministic analysis + LLM reasoning, and delivers insights via Slack and web UI.

**Current Phase:** Documentation & Planning (Pre-implementation)
**Target:** 12-week MVP delivering JS/TS error analysis using GPT-4o-mini

## Architecture Philosophy

### Critical Design Principle: Deterministic-First

**NEVER let AI make causal claims without deterministic evidence.**

The system has two layers:

1. **Layer 1 (Deterministic - 80% of quality):** AST analysis, pattern matching, stack trace mapping
2. **Layer 2 (LLM - 20% enhancement):** Narrative generation, explanation, contextualization

**Why:** LLM competitors fail on AI-generated code because they hallucinate. Our competitive moat is deterministic analysis that catches signature bugs, then LLM explains them clearly.

```
Evidence Graph (deterministic) → LLM Reasoning (narrative)
Ground Truth ← ALWAYS WINS → Storyteller
```

### Modular Monolith Architecture

- **NOT microservices** for MVP (weeks 1-6)
- Node.js/TypeScript backend + embedded Python workers (via `child_process.spawn`)
- Python handles: AST analysis, LLM orchestration, timeline reconstruction
- Single ECS Fargate deployment, scales vertically before splitting

**Repository Structure (Target):**

```
buglens/
├── src/              # Node.js/TypeScript
│   ├── api/         # Fastify routes
│   ├── workers/     # BullMQ job processors
│   ├── services/    # Business logic (GitHub, Slack, evidence collection)
│   └── db/          # Postgres models, migrations (with org_id ALWAYS)
├── python/
│   ├── analyzers/   # tree-sitter AST analysis (js_analyzer.py, py_analyzer.py)
│   ├── llm/         # GPT-4o-mini orchestration (NOT local models for MVP)
│   └── timeline/    # Log/breadcrumb reconstruction
└── web/             # React + TypeScript + Vite + Tailwind
```

Use Functional paradigm for:

analyzers

RCA engines

graph builder

event transforms

diff computation

stack trace purification

LLM extraction/normalization

all rule engines

confidence scoring

embeddings / similarity ops

🔹 Use OOP for:

webhook handlers

integrations (GitHub/Sentry/Vercel/Linear/Jira)

job runners, queue workers

background services

plugin system

long-lived service classes

repository providers (GitHub, GitLab, Bitbucket)

---

## Paradigm Guidelines (CRITICAL)

### Why This Matters

Mixing paradigms incorrectly leads to:

- Stateful functions that are hard to test
- Stateless classes with unnecessary boilerplate
- Inconsistent patterns across the codebase
- Difficulty onboarding new developers

### Decision Matrix

| Characteristic                       | Use Functional | Use OOP |
| ------------------------------------ | -------------- | ------- |
| Pure transformation (input → output) | ✅             | ❌      |
| No side effects needed               | ✅             | ❌      |
| Composable pipelines                 | ✅             | ❌      |
| Needs dependency injection           | ❌             | ✅      |
| Manages external resources           | ❌             | ✅      |
| Long-lived connections               | ❌             | ✅      |
| State that survives calls            | ❌             | ✅      |
| Configuration-driven behavior        | ❌             | ✅      |

### TypeScript Pattern: Functional

**When:** Transforms, extractors, validators, classifiers, scoring

```typescript
// ✅ CORRECT: Pure functions in their own module
// src/services/evidence-transforms.ts

/**
 * Extract error info from Sentry event data
 * @pure - output depends only on input
 */
export function extractErrorInfo(eventData: EventData): ErrorInfo {
  const rawPayload = eventData.raw_payload as Record<string, unknown>;
  const exception = rawPayload?.exception as { values?: Array<...> };

  return {
    message: eventData.message,
    type: exception?.values?.[0]?.type ?? "Error",
    value: exception?.values?.[0]?.value ?? eventData.message,
    stack_trace: transformStackFrames(stacktrace?.frames ?? []),
  };
}

/**
 * Classify a stack frame based on path patterns
 * @pure
 */
export function classifyFrame(
  raw: RawFrame,
  cleanedPath: string
): FrameClassification {
  if (raw.in_app === false) return "third_party";
  if (NOISE_PATTERNS.NODE_MODULES.test(cleanedPath)) return "third_party";
  if (USER_CODE_PATTERNS.SRC_DIR.test(cleanedPath)) return "user_code";
  return "user_code"; // benefit of the doubt
}

// Composable pipeline
export const processFrames = (frames: RawFrame[]) =>
  frames
    .map(cleanFilePath)
    .filter(Boolean)
    .map(classifyFrame);
```

```typescript
// ❌ WRONG: Stateless class with unnecessary this
class FrameClassifier {
  classify(raw: RawFrame): FrameClassification {
    // This class has no state, no dependencies, no reason to exist
    if (raw.in_app === false) return "third_party";
    // ...
  }
}
```

### TypeScript Pattern: OOP

**When:** Services with dependencies, I/O operations, configuration

```typescript
// ✅ CORRECT: Class for service with dependencies and I/O
// src/services/evidence-collector.ts

export class EvidenceCollectorService {
  private readonly pythonBridge: PythonBridge;
  private readonly config: EvidenceCollectorConfig;

  constructor(
    deps: {
      pythonBridge?: PythonBridge;
      config?: Partial<EvidenceCollectorConfig>;
    } = {}
  ) {
    this.pythonBridge =
      deps.pythonBridge ??
      new PythonBridge({ module: "timeline.reconstructor" });
    this.config = { ...DEFAULT_EVIDENCE_CONFIG, ...deps.config };
  }

  async collect(params: CollectEvidenceParams): Promise<EvidenceBundle> {
    // 1. Use pure functions for transforms
    const errorInfo = extractErrorInfo(eventData); // ← functional
    const codeContext = buildCodeContext(codeResults); // ← functional

    // 2. I/O operations stay in the class
    const recentCommits = await this.fetchRecentCommits(params);
    const timeline = await this.reconstructTimeline(breadcrumbs);

    // 3. Orchestrate the results
    return { errorInfo, codeContext, recentCommits, timeline };
  }
}
```

### Python Pattern: Functional

**When:** Rules, analyzers, extractors, validators

```python
# ✅ CORRECT: Pure functions with constants for metadata
# python/analyzers/rules/null_access.py

# Constants for rule metadata
RULE_ID = "null-access"
RULE_TITLE = "Potential null/undefined property access"
RULE_SEVERITY = "high"
RULE_CONFIDENCE = 0.85

def evaluate_null_access(context: AnalysisContext) -> List[Dict[str, Any]]:
    """
    Detect potential null/undefined property access patterns.

    @pure - output depends only on input context
    """
    findings = []

    if not _matches_null_access_pattern(context.error_message):
        return findings

    for node in _find_member_access_nodes(context.ast_tree):
        if _is_unchecked_access(node, context.ast_tree):
            findings.append(_create_finding(node, context))

    return findings


def _matches_null_access_pattern(message: str) -> bool:
    """Check if error message suggests null access."""
    return bool(NULL_ACCESS_PATTERN.search(message))


def _is_unchecked_access(node: Any, tree: Any) -> bool:
    """Check if property access lacks null guard."""
    # Pure logic, no side effects
    pass


# OOP wrapper for backward compatibility only
class NullAccessRule:
    """Wrapper class - delegates to pure function."""

    rule_id = RULE_ID
    title = RULE_TITLE

    def evaluate(self, context: AnalysisContext) -> List[Dict]:
        return evaluate_null_access(context)
```

```python
# ❌ WRONG: Stateless class pretending to be OOP
class NullAccessRule:
    rule_id = "null-access"  # This is just a constant

    def evaluate(self, context):
        # No self usage, pure logic
        # This should be a function
        pass
```

### Python Pattern: OOP

**When:** Services, bridges, integrations

```python
# ✅ CORRECT: Class for service with state/resources
# python/llm/orchestrator.py

class RCAOrchestrator:
    """LLM orchestration service with configuration and clients."""

    def __init__(
        self,
        model: str = "gpt-4o-mini",
        temperature: float = 0.1,
        client: Optional[OpenAI] = None,
    ):
        self.model = model
        self.temperature = temperature
        self.client = client or OpenAI()
        self._request_count = 0  # Stateful

    async def generate_rca(self, evidence: EvidenceBundle) -> RCAResult:
        # Uses instance state
        prompt = build_prompt(evidence)  # ← Pure function
        response = await self.client.chat.completions.create(...)
        self._request_count += 1
        return validate_and_transform(response)  # ← Pure function
```

### Hybrid Pattern: Service + Functions

The recommended pattern for complex modules:

```typescript
// evidence-transforms.ts - Pure functions
export function extractErrorInfo(data: EventData): ErrorInfo { ... }
export function buildCodeContext(results: CodeFetchResult[]): CodeContext { ... }
export function transformCommit(commit: GitHubCommit): CommitInfo { ... }

// evidence-collector.ts - Service that orchestrates
export class EvidenceCollectorService {
  async collect(params: Params): Promise<Bundle> {
    // Use pure functions for transforms
    const error = extractErrorInfo(data);
    const code = buildCodeContext(results);

    // Keep I/O in the service
    const commits = await this.fetchCommits();

    return { error, code, commits };
  }
}
```

### Quick Reference Checklist

Before writing a new module, ask:

1. **Does it have dependencies that need injection?** → OOP
2. **Does it manage external resources (DB, API, files)?** → OOP
3. **Does it need configuration that varies?** → OOP
4. **Is it a pure transformation (input → output)?** → Functional
5. **Can it be tested without mocks?** → Functional
6. **Will it be composed in pipelines?** → Functional

### File Naming Convention

```
src/services/
├── evidence-collector.ts      # OOP service
├── evidence-transforms.ts     # Pure functions
├── github.ts                  # OOP integration
├── github-utils.ts            # Pure functions (if needed)
├── event-extractor/
│   ├── deterministic-extractor.ts  # Exports pure functions + OOP wrapper
│   └── extraction-validator.ts     # Pure functions
```

---

## Multi-Tenancy is Non-Negotiable

**Every table MUST have `org_id` from Day 1.** Row-level security enabled.

```sql
-- WRONG
CREATE TABLE events (id UUID PRIMARY KEY, message TEXT);

-- CORRECT
CREATE TABLE events (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  message TEXT
);
CREATE INDEX idx_events_org ON events(org_id);
```

Always set org context:

```typescript
await db.query("SET LOCAL app.current_org_id = $1", [orgId]);
```

## Cost Controls from Week 1

**Rate limits per organization (free/pro/enterprise tiers):**

```typescript
// ALWAYS check before expensive operations
const limits = RATE_LIMITS[org.plan];
if (usage.llm_tokens_today > limits.llm_tokens_per_day) {
  throw new QuotaExceededError();
}
```

Track costs in real-time:

```sql
-- Update daily cost metrics after every LLM call
INSERT INTO cost_metrics (org_id, date, llm_tokens_used, llm_cost_usd)
VALUES ($1, CURRENT_DATE, $2, $3)
ON CONFLICT (org_id, date) DO UPDATE SET ...
```

## Three-Tier GitHub Caching (Critical Week 2)

GitHub rate limits will kill you. Cache aggressively:

```typescript
// 1. Redis (hot, 1hr TTL)
const cached = await redis.get(`gh:file:${orgId}:${repo}:${sha}:${path}`);
if (cached) return JSON.parse(cached);

// 2. S3 (warm, 7 days, gzipped)
const s3File = await s3.getObject(`cache/${orgId}/${repo}/${sha}/${path}`);
if (s3File) {
  /* decompress, cache in Redis, return */
}

// 3. Fetch from GitHub API (LAST RESORT)
const content = await githubAPI.getContent(repo, path, sha);
// Store in ALL caches
```

Expected cache hit rate: >80%. Monitor with CloudWatch metrics.

## LLM Integration Pattern

**MVP uses GPT-4o-mini ONLY** (no local models until >50K RCAs/month).

```python
# python/llm/orchestrator.py
class RCAOrchestrator:
    def generate_rca(self, evidence: dict) -> dict:
        # 1. Build structured prompt (NOT raw logs)
        prompt = self.build_prompt(evidence)

        # 2. Call with low temperature (consistency)
        response = openai.chat.completions.create(
            model='gpt-4o-mini',
            temperature=0.1,  # Low for deterministic behavior
            max_tokens=2000,  # Cost control
            response_format={'type': 'json_object'}  # Enforce schema
        )

        # 3. Validate response against schema (ALWAYS)
        result = json.loads(response.choices[0].message.content)
        validate(result, RCA_SCHEMA)

        # 4. Track costs
        result['llm_tokens_used'] = response.usage.total_tokens

        return result
```

**Guardrails:**

- Schema validation (jsonschema)
- Evidence verification (every claim must reference actual data)
- Confidence thresholds (if < 0.7, queue for human review)
- Deterministic fallback (if LLM fails, return findings-only RCA)

## Source Maps are Required (Week 2)

Most production JS is minified. Source map support is NOT optional.

```typescript
// services/code-fetcher.ts
async fetchFileFromStackFrame(frame: StackFrame) {
  // 1. Check if minified (no spaces, short var names)
  if (this.isMinified(frame.file)) {
    // 2. Fetch .map file
    const mapContent = await this.fetchFile(`${frame.file}.map`);
    // 3. Parse with source-map library
    const consumer = await new SourceMapConsumer(mapContent);
    // 4. Map to original position
    const original = consumer.originalPositionFor({
      line: frame.line,
      column: frame.column
    });
    frame = { file: original.source, line: original.line, ... };
  }

  return this.fetchFile(frame.file);
}
```

## Data Flow Reference

**22-step pipeline from error → Slack notification:**

1. Sentry webhook → Fastify API
2. HMAC validation (prevent spoofing)
3. Store event (with org_id)
4. Rate limit check
5. Enqueue BullMQ job
6. Worker fetches code (3-tier cache)
7. Resolve source maps
8. Python AST analyzer (deterministic rules)
9. Collect evidence (code + logs + commits)
10. Check LLM quota
11. Python LLM service (GPT-4o-mini)
12. Validate response
13. Store RCA result
14. Track costs
15. Slack notification
16. User views in web UI

**Target latency:** <45s P95 (webhook → Slack)

## Week-by-Week Priorities

**Week 1:** Multi-tenancy + cost controls + webhook receiver
**Week 2:** GitHub caching + source maps (prevent rate limit death)
**Week 3:** Deterministic analyzers (JS/TS only, Python in Week 8)
**Week 4:** Evidence assembly + timeline reconstruction
**Week 5:** LLM orchestration (GPT-4o-mini with guardrails)
**Week 6:** Slack + web UI

## Testing Strategy

**Synthetic dataset from Week 7** (not Week 10):

```python
# python/evaluation/synthetic_generator.py
def generate_null_access_error():
    return {
        'code': 'const user = database.find(id); return user.name;',
        'error': "Cannot read property 'name' of undefined",
        'ground_truth_root_cause': 'Missing null check',
        'ground_truth_fix': 'Add: if (!user) return null;'
    }
```

Run nightly to catch regressions. Target: >70% accuracy in Phase 1, >80% in Phase 2.

## Common Pitfalls to Avoid

❌ **Don't** split into microservices for MVP (operational complexity)
❌ **Don't** use local LLMs initially (costs more at low volume)
❌ **Don't** skip source map support (60%+ of errors are minified)
❌ **Don't** add `org_id` later (refactoring multi-tenancy is hell)
❌ **Don't** let LLM override deterministic findings (trust hierarchy: deterministic > LLM)
❌ **Don't** cache GitHub without expiry (stale code = wrong RCA)
❌ **Don't** skip rate limits (cost explosion)

✅ **Do** implement multi-tenancy from Day 1
✅ **Do** cache GitHub aggressively (3-tier from Week 2)
✅ **Do** track costs in real-time
✅ **Do** validate LLM responses (schema + evidence verification)
✅ **Do** use deterministic fallback (when LLM fails or quota exceeded)
✅ **Do** build synthetic dataset early (Week 7, not Week 10)

## Key Files to Reference

- `Buglens Architecture UPDATED.md` - Complete system architecture, integration flow
- `Buglens Roadmap Phase 1 (Week 1-6).md` - Detailed week-by-week implementation plan
- `Buglens Roadmap Phase 2 (Week 7-12).md` - Evaluation, monitoring, enterprise features
- `buglens llm architecture UPDATED.md` - LLM strategy, prompt engineering, cost model
- `buglens_prd.md` - Product requirements, success metrics
- `Founders note.md` - Critical cost/scale insights (GitHub rate limits, LLM costs, uneven traffic)

## Success Metrics (Phase 1 Complete)

- End-to-end latency: <45s P95
- Job success rate: >90%
- Cache hit rate: >75%
- Cost per RCA: <$0.15
- RCA accuracy: >70%
- Multi-tenant isolation verified (10+ orgs)

## When Implementing

1. **Always check org context** - Every query needs `WHERE org_id = ?`
2. **Cost before LLM** - Check quotas before expensive operations
3. **Cache before GitHub** - 3-tier lookup (Redis → S3 → API)
4. **Validate before store** - LLM responses against schema
5. **Evidence before claim** - Never accept unsupported assertions
6. **Deterministic before AI** - Run rule engine first, LLM second

---

## Workflow Trigger

If I ask you to implement a feature, start by:

1.  Defining the **Schema** (Database & Zod).

2.  Defining the **Interface** (Types).

3.  Writing the **Test Case**.

4.  Implementing the **Logic**.

---

## Definition of Done (Production Grade)

Before outputting code, verify:

1.  **Linting:** Does it pass ESLint?

2.  **Tests:** Have you included a unit test (vitest) for the happy path AND the failure path?

3.  **Performance:** Are database queries indexed? (Check `org_id` indexes).

4.  **Safety:** Are there any `eval()` calls or unsafe regex? (Reject them).

---

### TypeScript Standards

1.  **Strict Typing:** `noImplicitAny` is ON. Do not use `any`. Use `unknown` with type guards if necessary.

2.  **Error Handling:** Use a centralized Error Handler in Fastify. Do not use `console.log`; use a structured logger (e.g., `pino`).

3.  **Async/Await:** Always handle rejected promises.

4.  **Environment Variables:** Use `dotenv` and validate with `zod` at startup.
5.  **Database Access:** Use parameterized queries to prevent SQL injection.
6.  **Security:** Sanitize all inputs. Use libraries like `xss` for HTML content.

### Python Standards

1.  **Type Hints:** Use type hints for all functions and methods.
2.  **Error Handling:** Use try/except blocks. Log errors with structured logging (e.g., `structlog`).
3.  **Async Operations:** Use `asyncio` for I/O-bound operations.
4.  **Environment Variables:** Use `python-dotenv` and validate at startup.

**Remember:** You're building a production-grade debugging tool that developers will trust with their most critical incidents. Correctness > cleverness. Evidence > speculation. Simple > complex.

After every week:
I need a full technical review of this codebase with the rigor of a senior staff engineer performing a pre-production audit.

Your tasks:

1. Map the overall architecture: modules, data flow, responsibilities, external dependencies, and coupling points.
2. Identify hidden complexity, unnecessary abstractions, duplicated logic, or brittle areas that will fail under scale or change.
3. Evaluate code quality: readability, clarity, naming, documentation gaps, testing coverage, error handling, and type safety.
4. Flag any performance risks, memory issues, blocking operations, or inefficient patterns.
5. Check security posture: input validation, authz/authn flaws, exposed secrets, insecure defaults, or vulnerable dependencies.
6. Assess maintainability and onboarding difficulty: Is the project intuitive? Are conventions consistent? Are build/dev scripts clean?
7. Suggest concrete refactors with high leverage — the smallest changes that yield the biggest reliability or velocity improvements.
8. Identify which parts of the codebase are most fragile or require immediate attention.
9. Surface any discrepancies between intended design and actual implementation.

Deliver:

- A concise architecture overview.
- A prioritized list of issues with severity and rationale.
- Specific, implementable fixes (not abstract “improve X” suggestions).
- A short “technical debt roadmap” ordered by ROI.

Ask clarifying questions only if absolutely required to complete the audit.

Acknowledgement: If you understand these instructions, respond only with: "Buglens Architect Online. Deterministic protocols active. 3-Tier Cache and Cost Controls engaged."
