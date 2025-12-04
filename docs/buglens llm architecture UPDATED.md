# Buglens LLM Architecture (UPDATED - November 2025)

## MVP Strategy: Simple, Cost-Effective, Production-Ready

**Key Decision: Start with GPT-4o-mini only, add complexity later.**

---

## ✅ Recommended LLM Stack (MVP - Weeks 1-6)

### 1. Deterministic + Symbolic Analysis Layer (Non-LLM) — **THE FOUNDATION**

**This is 80% of your RCA quality.**

**Purpose:**
Give the LLM structured, interpretable signals so it doesn't hallucinate.

**Components:**

| Component                 | Technology                    | Purpose                                |
| ------------------------- | ----------------------------- | -------------------------------------- |
| **AST Analyzer**          | tree-sitter (Python bindings) | Parse JS/TS code, locate error nodes   |
| **Stack Trace Mapper**    | Custom parser                 | Map stack frames to source files/lines |
| **Log Clusterer**         | Simple timestamp ordering     | Sentry breadcrumbs → timeline          |
| **Commit Diff Extractor** | GitHub API                    | Last 5 commits touching affected files |
| **Source Map Resolver**   | source-map library            | Minified → original location           |
| **Error Pattern Matcher** | Regex + heuristics            | Common error signatures                |

**Models:** No LLM here. Pure deterministic logic.

**Why this matters:**
This dramatically reduces LLM load → cheaper & more accurate. The LLM gets **structured evidence**, not raw logs.

---

### 2. LLM Reasoning Layer — **GPT-4o-mini ONLY**

**Model:** `gpt-4o-mini` (OpenAI)

**Why GPT-4o-mini for MVP?**

- ✅ **Cost-effective:** ~$0.15 per 1M input tokens, $0.60 per 1M output tokens
- ✅ **Fast:** <5s response time for 1500 token requests
- ✅ **Good enough:** 70-80% accuracy on code reasoning
- ✅ **Hosted:** No infrastructure to manage
- ✅ **Reliable:** 99.9% uptime SLA from OpenAI

**Why NOT local models for MVP?**

- ❌ Infrastructure complexity (GPU servers, model management)
- ❌ Higher latency (10-30s vs <5s)
- ❌ Operational overhead (monitoring, scaling, updates)
- ❌ Doesn't improve PMF discovery
- ❌ Costs more at low volume (<1M RCAs/month)

**Used For:**

- Final RCA narrative generation
- Root cause explanation
- Fix suggestion justification
- Confidence scoring augmentation
- Developer-friendly writeups

**Configuration:**

```python
# python/llm/orchestrator.py
from openai import OpenAI

class RCAOrchestrator:
    def __init__(self):
        self.client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
        self.model = 'gpt-4o-mini'
        self.temperature = 0.1  # Low for consistency
        self.max_tokens = 2000  # Cost control

    def generate_rca(self, evidence: dict) -> dict:
        prompt = self.build_structured_prompt(evidence)

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user', 'content': prompt}
            ],
            temperature=self.temperature,
            response_format={'type': 'json_object'},  # Structured output
            max_tokens=self.max_tokens
        )

        result = json.loads(response.choices[0].message.content)

        # Track usage
        result['llm_tokens_used'] = response.usage.total_tokens
        result['llm_cost_usd'] = self.calculate_cost(response.usage)

        return result
```

**Prompt Strategy:**

````python
SYSTEM_PROMPT = """You are an expert debugging assistant analyzing production errors.

Your output MUST be valid JSON matching this schema:
{
  "title": "Brief error title (max 100 chars)",
  "summary": "2-3 sentence overview",
  "root_cause": "Specific root cause based on evidence",
  "causal_chain": [
    {
      "step": "What happened",
      "evidence": "Specific log line, code reference, or commit",
      "confidence": 0.9
    }
  ],
  "suggested_fix": {
    "description": "What to fix and why",
    "file_path": "path/to/file.js",
    "patch_description": "Explain the change (no raw code)"
  },
  "test_intentions": [
    {
      "description": "Test to add",
      "rationale": "Why it prevents recurrence"
    }
  ],
  "confidence": 0.85
}

CRITICAL RULES:
1. Every claim MUST reference specific evidence (line number, log entry, commit hash)
2. If uncertain, lower confidence score (don't guess)
3. Never hallucinate: if no evidence exists, state "insufficient data"
4. Be specific: include variable names, function names, line numbers
5. Focus on the DIRECT cause, not symptoms

EVIDENCE HIERARCHY (trust in order):
1. Deterministic findings (AST analysis, pattern matches)
2. Stack trace (exact error location)
3. Recent commits (code changes)
4. Logs/breadcrumbs (user actions)
"""

def build_structured_prompt(evidence: dict) -> str:
    """Build evidence-rich prompt with strict structure"""

    return f"""
Analyze this production error:

## ERROR
Type: {evidence['error']['type']}
Message: {evidence['error']['message']}

## STACK TRACE (top 3 frames)
{format_stack_trace(evidence['error']['stack_trace'][:3])}

## CODE CONTEXT
File: {evidence['code']['file_path']}
Line: {evidence['code']['line_number']}
Language: {evidence['code']['language']}

```{evidence['code']['language']}
{evidence['code']['snippet']}
````

## DETERMINISTIC FINDINGS (HIGH CONFIDENCE)

{format_findings(evidence['deterministic_findings'])}

## TIMELINE (last 5 events before error)

{format_timeline(evidence['timeline']['steps'][-5:])}

## RECENT COMMITS (last 5 affecting this file)

{format_commits(evidence['recent_commits'])}

## ENVIRONMENT

Release: {evidence['environment']['release']}
Environment: {evidence['environment']['environment']}

Provide root cause analysis in JSON format following the schema.
"""

````

**Cost Control:**
```python
# Track and limit per org
async def check_token_quota(org_id: str, estimated_tokens: int):
    usage = await redis.get(f"llm:tokens:{org_id}:{today}")
    plan = await db.organizations.get_plan(org_id)

    limit = RATE_LIMITS[plan]['llm_tokens_per_day']

    if int(usage or 0) + estimated_tokens > limit:
        raise QuotaExceededError(f"Daily token limit reached: {limit}")

    return True

# Cache duplicate errors
cache_key = hashlib.sha256(event_signature.encode()).hexdigest()
cached_rca = await redis.get(f"rca:cache:{cache_key}")
if cached_rca:
    return json.loads(cached_rca)

# ... generate new RCA ...

# Cache for 7 days
await redis.setex(f"rca:cache:{cache_key}", 604800, json.dumps(rca))
````

---

## ✅ LLM-Assisted Event Extraction (Week 4 - Hybrid Architecture)

**Problem:** Source maps, file paths, and malformed Sentry events prevent reliable code fetching.

**Solution:** A three-stage extraction pipeline where LLM assists only when deterministic extraction fails.

### Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HYBRID EVENT EXTRACTION PIPELINE                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Stage 1: DETERMINISTIC EXTRACTOR (80% of events)                       │
│  ────────────────────────────────────────────────                       │
│  • Rule-based field extraction (filenames, line numbers, commit SHA)    │
│  • If complete → STOP (fast path, no LLM cost)                         │
│                                                                          │
│                              ↓ (incomplete)                              │
│                                                                          │
│  Stage 2: LLM ASSIST LAYER (20% of events)                              │
│  ────────────────────────────────────────────────                       │
│  • GPT-4o-mini or local model (DeepSeek-R1 7B / Qwen-7B)               │
│  • RESTRICTED: Clean, interpret, classify - NEVER invent               │
│                                                                          │
│                              ↓ (all outputs)                             │
│                                                                          │
│  Stage 3: VERIFICATION (Always runs)                                    │
│  ────────────────────────────────────────────────                       │
│  • Validate against GitHub: repo? commit? file? line?                   │
│  • Fallback strategies if validation fails                              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### LLM Safe Tasks (Stage 2)

**What the LLM CAN do:**

| Task                            | Example                                          | Why Safe                |
| ------------------------------- | ------------------------------------------------ | ----------------------- |
| Clean stacktrace noise          | Filter `node_modules`, polyfills                 | Removing, not adding    |
| Classify user vs vendor frames  | Mark `src/api/user.ts` as user code              | Classification only     |
| Repair malformed JSON           | Fix truncated payload                            | Repair existing data    |
| Interpret custom contexts       | Parse `sentry.contexts.custom`                   | Reading, not writing    |
| Deminify filenames              | `a.js:42` → `src/app.js:42` with sourcemap hints | Using existing hints    |
| Pick true frame from 100 frames | Select most likely error location                | Selection, not creation |

**What the LLM CANNOT do:**

- ❌ Invent repository names
- ❌ Create commit SHAs
- ❌ Assume file paths that don't exist
- ❌ Override Stage 3 verification results

### Implementation

```python
# python/extractors/llm_assist_extractor.py
class LLMAssistExtractor:
    """LLM-assisted extraction for incomplete/malformed events.

    CRITICAL: This class ONLY cleans and interprets existing data.
    It NEVER invents or assumes repository/commit information.
    """

    EXTRACTION_PROMPT = """You are extracting structured data from a Sentry error event.

    STRICT RULES:
    1. ONLY identify fields that EXIST in the payload
    2. NEVER invent repository or commit information
    3. If you cannot find a field, return null
    4. Clean and normalize paths, but don't create them
    5. Mark your confidence level for each extraction

    Tasks:
    - Identify the most likely user code frame (not vendor/internal)
    - Clean minified file paths IF source map hints exist
    - Extract release/version information
    - Classify frames as user vs vendor code

    Return JSON: {
        "primary_frame": {"file": str, "line": int, "function": str} | null,
        "suggested_repo": str | null,  // Only if found in payload
        "suggested_commit": str | null,  // Only if found in payload
        "user_frames": [{"file": str, "line": int, "confidence": float}],
        "vendor_frames_removed": int,
        "cleaned_paths": [{"original": str, "cleaned": str}],
        "reasoning": str  // Explain your extraction decisions
    }
    """

    def enhance(self, event: dict, deterministic_result: dict) -> dict:
        """Enhance extraction with LLM assistance.

        Only called when deterministic extraction is incomplete.
        """
        missing_fields = self.identify_missing(deterministic_result)

        if not missing_fields:
            return deterministic_result  # Nothing to enhance

        response = self.llm.complete(
            system=self.EXTRACTION_PROMPT,
            user=json.dumps({
                'event': self._sanitize_event(event),
                'missing_fields': missing_fields,
                'partial_extraction': deterministic_result
            }),
            temperature=0.1,  # Low for consistency
            response_format={'type': 'json_object'},
            max_tokens=1000  # Extraction is small
        )

        # Parse and validate LLM response
        llm_result = json.loads(response.choices[0].message.content)
        self._validate_llm_response(llm_result)

        # Merge with deterministic results (deterministic wins on conflict)
        return self.merge_results(
            deterministic_result,
            llm_result,
            confidence_penalty=0.3  # LLM suggestions are lower confidence
        )

    def _sanitize_event(self, event: dict) -> dict:
        """Remove PII and large blobs before sending to LLM."""
        sanitized = {
            'exception': event.get('exception'),
            'release': event.get('release'),
            'environment': event.get('environment'),
            'platform': event.get('platform'),
            'contexts': event.get('contexts'),
            'tags': event.get('tags')
        }
        # Limit stack trace size
        if sanitized.get('exception', {}).get('values'):
            for exc in sanitized['exception']['values']:
                if exc.get('stacktrace', {}).get('frames'):
                    exc['stacktrace']['frames'] = exc['stacktrace']['frames'][:20]
        return sanitized
```

### Verification Layer (Stage 3)

```typescript
// services/event-extractor/extraction-validator.ts
class ExtractionValidator {
  async verify(
    extraction: ExtractionResult,
    orgId: string
  ): Promise<VerifiedExtraction> {
    const warnings: string[] = [];
    let finalExtraction = { ...extraction };

    // 1. Verify repo exists in org's GitHub
    const repoExists = await this.github.repoExists(orgId, extraction.repo);
    if (!repoExists) {
      warnings.push(`Repository ${extraction.repo} not found`);
      finalExtraction.repo = await this.inferRepo(orgId, extraction);
    }

    // 2. Verify commit exists
    const commitExists = await this.github.commitExists(
      orgId,
      finalExtraction.repo,
      extraction.commitSha
    );
    if (!commitExists) {
      warnings.push(
        `Commit ${extraction.commitSha} not found, using default branch`
      );
      finalExtraction.commitSha = await this.getDefaultBranchHead(
        orgId,
        finalExtraction.repo
      );
    }

    // 3. Verify file exists at commit
    const fileExists = await this.github.fileExists(
      orgId,
      finalExtraction.repo,
      finalExtraction.commitSha,
      extraction.filePath
    );
    if (!fileExists) {
      warnings.push(`File ${extraction.filePath} not found at commit`);
      // Try to find similar file
      finalExtraction.filePath = await this.fuzzyMatchFile(
        orgId,
        finalExtraction.repo,
        finalExtraction.commitSha,
        extraction.filePath
      );
    }

    // 4. Verify line exists in file
    if (extraction.lineNumber) {
      const lineCount = await this.github.getFileLineCount(
        orgId,
        finalExtraction.repo,
        finalExtraction.commitSha,
        finalExtraction.filePath
      );
      if (extraction.lineNumber > lineCount) {
        warnings.push(
          `Line ${extraction.lineNumber} exceeds file length ${lineCount}`
        );
        finalExtraction.lineNumber = Math.min(extraction.lineNumber, lineCount);
      }
    }

    return {
      ...finalExtraction,
      verified: warnings.length === 0,
      warnings,
      source:
        extraction.source === "llm_assisted"
          ? "llm_verified"
          : "deterministic_verified",
    };
  }
}
```

### Cost & Latency Impact

| Scenario                  | Latency  | Cost    | Frequency |
| ------------------------- | -------- | ------- | --------- |
| Stage 1 only (happy path) | 50-200ms | $0      | ~80%      |
| Stage 1 + 2 (LLM assist)  | 1-3s     | ~$0.002 | ~18%      |
| Stage 1 + 2 + fallback    | 2-5s     | ~$0.002 | ~2%       |

**Target metrics:**

- Stage 2 trigger rate: <20%
- Stage 3 verification success: >90%
- Overall extraction latency P95: <3s

### Tracking & Alerts

```sql
-- Extend cost_metrics table
ALTER TABLE cost_metrics ADD COLUMN extraction_stage_1_count INT DEFAULT 0;
ALTER TABLE cost_metrics ADD COLUMN extraction_stage_2_count INT DEFAULT 0;
ALTER TABLE cost_metrics ADD COLUMN extraction_stage_3_failures INT DEFAULT 0;
ALTER TABLE cost_metrics ADD COLUMN extraction_llm_tokens INT DEFAULT 0;
```

**Alert thresholds:**

- Stage 2 rate > 30% for 1 hour → Customer source map configuration issues
- Stage 3 failure rate > 10% → Investigation needed
- Extraction latency P95 > 5s → Performance degradation

---

## ✅ Guardrails + Safety Layer

**Critical for credibility.**

**Components:**

### 1. Schema Validation

```python
from jsonschema import validate, ValidationError

RCA_SCHEMA = {
    "type": "object",
    "required": ["title", "summary", "root_cause", "causal_chain", "confidence"],
    "properties": {
        "title": {"type": "string", "maxLength": 200},
        "summary": {"type": "string", "maxLength": 1000},
        "root_cause": {"type": "string"},
        "causal_chain": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "required": ["step", "evidence", "confidence"],
                "properties": {
                    "step": {"type": "string"},
                    "evidence": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1}
                }
            }
        },
        "confidence": {"type": "number", "minimum": 0, "maximum": 1}
    }
}

def validate_rca_response(response: dict):
    try:
        validate(instance=response, schema=RCA_SCHEMA)
    except ValidationError as e:
        raise InvalidRCAError(f"LLM response invalid: {e.message}")
```

### 2. Evidence Verification

```python
def verify_evidence_present(rca: dict, evidence: dict) -> bool:
    """Ensure every claim references actual evidence"""

    for step in rca['causal_chain']:
        evidence_ref = step['evidence']

        # Check if reference exists in actual evidence
        if not (
            evidence_ref in str(evidence['code']) or
            evidence_ref in str(evidence['timeline']) or
            evidence_ref in str(evidence['commits']) or
            evidence_ref in str(evidence['deterministic_findings'])
        ):
            # Flag as low confidence
            step['confidence'] = min(step['confidence'], 0.5)
            step['warning'] = 'Evidence reference not found in actual data'

    return True
```

### 3. Confidence Thresholds

```python
def apply_confidence_policy(rca: dict):
    """Adjust confidence based on evidence quality"""

    # If no deterministic findings, cap confidence at 0.7
    if not rca.get('deterministic_findings'):
        rca['confidence'] = min(rca['confidence'], 0.7)

    # If timeline is sparse (<3 events), cap at 0.6
    if len(rca.get('timeline', {}).get('steps', [])) < 3:
        rca['confidence'] = min(rca['confidence'], 0.6)

    # If no recent commits, cap at 0.65
    if not rca.get('recent_commits'):
        rca['confidence'] = min(rca['confidence'], 0.65)

    # Queue for human review if confidence < 0.7
    if rca['confidence'] < 0.7:
        rca['requires_review'] = True

    return rca
```

### 4. Deterministic Fallback

```python
def generate_rca_with_fallback(evidence: dict):
    try:
        # Try LLM first
        rca = llm_orchestrator.generate_rca(evidence)
        rca = apply_confidence_policy(rca)

        if rca['confidence'] < 0.5:
            # Too uncertain, use deterministic only
            return generate_deterministic_only_rca(evidence)

        return rca

    except (LLMError, QuotaExceededError):
        # LLM failed, fall back to deterministic
        return generate_deterministic_only_rca(evidence)

def generate_deterministic_only_rca(evidence: dict):
    """Generate RCA from deterministic findings only"""
    findings = evidence['deterministic_findings']

    if not findings:
        return {
            'title': 'Error requires manual investigation',
            'summary': 'Insufficient deterministic signals to auto-analyze',
            'root_cause': 'Unknown - needs human review',
            'confidence': 0.0,
            'requires_review': True
        }

    # Use top finding
    top_finding = findings[0]

    return {
        'title': f"{top_finding['type']}: {top_finding['message']}",
        'summary': top_finding['message'],
        'root_cause': top_finding['suggestion'],
        'causal_chain': [
            {
                'step': top_finding['message'],
                'evidence': f"Line {top_finding['line']}",
                'confidence': top_finding['confidence']
            }
        ],
        'confidence': top_finding['confidence'],
        'source': 'deterministic_only'
    }
```

---

## ✅ Cost Tracking & Optimization

### Real-time Cost Tracking

```sql
CREATE TABLE cost_metrics (
  id UUID PRIMARY KEY,
  org_id UUID REFERENCES organizations(id),
  date DATE NOT NULL,
  llm_tokens_used INT DEFAULT 0,
  llm_cost_usd DECIMAL(10,4) DEFAULT 0,
  rca_count INT DEFAULT 0,
  cache_hits INT DEFAULT 0,
  cache_misses INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, date)
);

-- Track per RCA
INSERT INTO cost_metrics (org_id, date, llm_tokens_used, llm_cost_usd, rca_count)
VALUES ($1, CURRENT_DATE, $2, $3, 1)
ON CONFLICT (org_id, date) DO UPDATE SET
  llm_tokens_used = cost_metrics.llm_tokens_used + $2,
  llm_cost_usd = cost_metrics.llm_cost_usd + $3,
  rca_count = cost_metrics.rca_count + 1;
```

### Optimization Strategies

**1. Aggressive Caching**

```python
# Cache by event signature (hash of error message + stack trace)
def get_event_signature(event: dict) -> str:
    key_parts = [
        event['message'],
        event['exception_type'],
        event['stack_trace'][:3]  # Top 3 frames
    ]
    return hashlib.sha256(json.dumps(key_parts).encode()).hexdigest()

# Check cache before LLM call
signature = get_event_signature(event)
cached = await redis.get(f"rca:{signature}")
if cached:
    metrics.record_cache_hit(org_id)
    return json.loads(cached)
```

**2. Token Budget**

```python
def truncate_context(evidence: dict, max_tokens: int = 1500) -> dict:
    """Trim evidence to fit token budget"""

    # Priority order: deterministic findings > stack trace > code > logs > commits

    # Always include (required)
    base = {
        'error': evidence['error'],
        'deterministic_findings': evidence['deterministic_findings']
    }

    remaining_tokens = max_tokens - estimate_tokens(base)

    # Add code snippet (truncated if needed)
    if remaining_tokens > 200:
        evidence['code']['snippet'] = truncate_snippet(
            evidence['code']['snippet'],
            max_lines=50
        )
        base['code'] = evidence['code']
        remaining_tokens -= estimate_tokens(evidence['code'])

    # Add timeline (last 5 events only)
    if remaining_tokens > 100:
        base['timeline'] = {
            'steps': evidence['timeline']['steps'][-5:]
        }
        remaining_tokens -= estimate_tokens(base['timeline'])

    # Add commits (last 3 only)
    if remaining_tokens > 100:
        base['recent_commits'] = evidence['recent_commits'][:3]

    return base
```

**3. Batch Processing**

```python
# For low-priority errors, batch and process during off-peak
async def queue_low_priority_rca(event: Event):
    if event.environment != 'production':
        # Queue for batch processing (cheaper, slower)
        await redis.lpush('rca:batch:queue', event.id)
    else:
        # Process immediately
        await queue_rca_job(event)
```

---

## Migration Path (Post-MVP)

### Month 4-6: Add Local LLM Option

```python
class RCAOrchestrator:
    def __init__(self, model_type: str = 'gpt-4o-mini'):
        if model_type == 'gpt-4o-mini':
            self.backend = OpenAIBackend()
        elif model_type == 'llama-70b-local':
            self.backend = LocalLLMBackend()  # vLLM server
        elif model_type == 'claude-sonnet':
            self.backend = AnthropicBackend()
```

**When to switch to local LLM:**

- Processing >50K RCAs/month (cost breakeven)
- Need lower latency (<2s response time)
- Data residency requirements
- Fine-tuning on proprietary data

### Month 7-9: Add Fine-Tuning

```python
# Export training data from human reviews
def export_training_data():
    reviews = db.query("""
        SELECT
            r.evidence,
            r.root_cause as ai_output,
            q.ground_truth_root_cause as correct_output
        FROM rca_results r
        JOIN rca_review_queue q ON q.rca_result_id = r.id
        WHERE q.review_status = 'approved'
    """)

    return [
        {
            'messages': [
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user', 'content': build_prompt(r['evidence'])},
                {'role': 'assistant', 'content': r['correct_output']}
            ]
        }
        for r in reviews
    ]

# Fine-tune GPT-4o-mini
from openai import OpenAI
client = OpenAI()

client.fine_tuning.jobs.create(
    training_file='training_data.jsonl',
    model='gpt-4o-mini-2024-07-18',
    suffix='buglens-v1'
)
```

---

## Summary: Why This Works

### MVP Advantages

✅ **Simple:** One LLM provider, straightforward integration
✅ **Cost-effective:** <$0.15 per RCA at scale
✅ **Fast to ship:** No infrastructure setup
✅ **Reliable:** 99.9% uptime from OpenAI
✅ **Proven:** Battle-tested by thousands of companies

### Foundation for Growth

✅ **Deterministic core:** 80% quality comes from non-LLM analysis
✅ **Modular design:** Easy to swap LLM backend later
✅ **Cost tracking:** Know exactly when to migrate to local models
✅ **Guardrails:** Prevent hallucinations from Day 1

### Cost Projection

- **MVP (0-1K RCAs/month):** GPT-4o-mini = $150-300/month ✅ Best choice
- **Growth (1K-50K RCAs/month):** GPT-4o-mini = $1.5K-15K/month ✅ Still good
- **Scale (50K+ RCAs/month):** Local Llama 70B = $3K-5K/month ✅ Consider migration

**You can always optimize later. Ship with GPT-4o-mini first.**
