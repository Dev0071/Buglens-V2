# BUGLENS — Phase 2 Roadmap (Weeks 7-12)

## Polish, Scale & Enterprise-Ready

**Revised: November 2025**

---

## Phase 2 Goal

Transform the Phase 1 MVP into a production-grade, enterprise-ready product with:

- Synthetic evaluation suite for continuous quality measurement
- Python language support
- Advanced monitoring and observability
- Enterprise security features (on-prem option, SSO prep)
- Human-in-the-loop review workflow
- Cost optimizations
- Production hardening

---

## Week-by-Week Plan

### Week 7 — Evaluation Suite + Metrics Dashboard

**Goals:**

- Build synthetic error generator
- Create evaluation dataset with ground truth labels
- Implement accuracy measurement pipeline
- Build internal metrics dashboard

**Tasks:**

1. **Synthetic Error Generator**

   ```python
   # python/evaluation/synthetic_generator.py
   class SyntheticErrorGenerator:
       """Generate realistic JS/TS errors with known root causes"""

       def generate_dataset(self, count: int = 100) -> list:
           errors = []

           # Pattern 1: Null/undefined access
           errors.extend(self.generate_null_access_errors(20))

           # Pattern 2: Async/await issues
           errors.extend(self.generate_async_errors(20))

           # Pattern 3: Array out of bounds
           errors.extend(self.generate_array_errors(15))

           # Pattern 4: Type mismatches
           errors.extend(self.generate_type_errors(15))

           # Pattern 5: Promise rejections
           errors.extend(self.generate_promise_errors(15))

           # Pattern 6: API errors (404, 500, etc.)
           errors.extend(self.generate_api_errors(15))

           return errors

       def generate_null_access_errors(self, count: int) -> list:
           """Generate errors like: Cannot read property 'x' of undefined"""
           templates = [
               {
                   'code': '''
                       function getUser(id) {
                           const user = database.find(id);  // might return null
                           return user.name;  // ERROR HERE
                       }
                   ''',
                   'error': "Cannot read property 'name' of undefined",
                   'root_cause': 'Missing null check before accessing user.name',
                   'suggested_fix': 'Add null check: if (!user) return null;',
                   'confidence': 0.95
               }
               # ... more templates
           ]
           return self.instantiate_templates(templates, count)
   ```

2. **Ground Truth Labels**

   ```json
   {
     "dataset_version": "1.0.0",
     "errors": [
       {
         "id": "null_access_001",
         "code_snippet": "...",
         "stack_trace": "...",
         "breadcrumbs": [...],
         "ground_truth": {
           "root_cause": "Missing null check before accessing property",
           "affected_file": "src/users.js",
           "affected_line": 42,
           "fix_type": "add_null_check",
           "confidence": 0.95
         }
       }
     ]
   }
   ```

3. **Evaluation Pipeline**

   ```python
   # python/evaluation/evaluator.py
   class RCAEvaluator:
       def evaluate(self, dataset: list) -> dict:
           results = {
               'total': len(dataset),
               'correct': 0,
               'partially_correct': 0,
               'incorrect': 0,
               'failed': 0,
               'avg_confidence': 0,
               'avg_processing_time': 0,
               'by_error_type': {}
           }

           for test_case in dataset:
               # Run full RCA pipeline
               try:
                   rca = self.run_rca_pipeline(test_case)

                   # Compare with ground truth
                   score = self.compare_with_ground_truth(
                       rca,
                       test_case['ground_truth']
                   )

                   if score >= 0.9:
                       results['correct'] += 1
                   elif score >= 0.5:
                       results['partially_correct'] += 1
                   else:
                       results['incorrect'] += 1

                   # Track by error type
                   error_type = test_case['ground_truth']['fix_type']
                   if error_type not in results['by_error_type']:
                       results['by_error_type'][error_type] = {
                           'total': 0, 'correct': 0
                       }
                   results['by_error_type'][error_type]['total'] += 1
                   if score >= 0.9:
                       results['by_error_type'][error_type]['correct'] += 1

               except Exception as e:
                   results['failed'] += 1

           # Calculate metrics
           results['accuracy'] = results['correct'] / results['total']
           results['partial_accuracy'] = (results['correct'] + results['partially_correct']) / results['total']

           return results
   ```

4. **Metrics Dashboard (Internal)**

   ```typescript
   // api/routes/internal/metrics.ts
   app.get("/internal/metrics/rca-accuracy", async (req, res) => {
     const evaluations = await db.query(`
       SELECT
         date,
         dataset_version,
         accuracy,
         partial_accuracy,
         avg_confidence,
         by_error_type
       FROM evaluation_runs
       ORDER BY date DESC
       LIMIT 30
     `);

     res.json(evaluations);
   });
   ```

5. **Database Schema**

   ```sql
   CREATE TABLE evaluation_runs (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     dataset_version TEXT NOT NULL,
     total_cases INT NOT NULL,
     correct INT NOT NULL,
     partially_correct INT NOT NULL,
     incorrect INT NOT NULL,
     failed INT NOT NULL,
     accuracy FLOAT NOT NULL,
     partial_accuracy FLOAT NOT NULL,
     avg_confidence FLOAT,
     avg_processing_time_ms INT,
     by_error_type JSONB,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```

6. **Automated Nightly Runs**
   ```yaml
   # .github/workflows/nightly-eval.yml
   name: Nightly RCA Evaluation
   on:
     schedule:
       - cron: "0 2 * * *" # 2 AM daily
   jobs:
     evaluate:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3
         - name: Run evaluation
           run: |
             python -m evaluation.evaluator --dataset synthetic_v1.json
         - name: Upload results
           run: |
             curl -X POST $API_URL/internal/metrics/evaluation \
               -H "Authorization: Bearer $INTERNAL_TOKEN" \
               -d @results.json
   ```

**Deliverables:**

- ✅ 100+ synthetic test cases with ground truth
- ✅ Evaluation pipeline running
- ✅ Baseline accuracy measured
- ✅ Metrics dashboard showing trends
- ✅ Nightly automated evaluation

**Acceptance Criteria:**

- Baseline accuracy > 70% on synthetic dataset
- Can identify error types with lowest accuracy
- Dashboard shows accuracy trends over time
- Evaluation runs < 10 minutes for 100 cases

---

### Week 7-8 — Evaluation Suite + Bug Signature Database (Competitive Moat)

**Goals:**

- Build synthetic error generator
- Create evaluation dataset with ground truth labels
- Implement accuracy measurement pipeline
- **🔥 NEW (P1): Build Bug Signature Database for instant deterministic detection**

---

#### 🆕 Bug Signature Database (Competitive Moat - P1)

**Why This Feature:** This is our long-term competitive moat. Pattern matching before LLM = instant, deterministic, no cost. Seer doesn't have a curated pattern library.

**Signature Schema:**

```typescript
// types/signatures.ts
interface BugSignature {
  id: string;
  name: string;
  category:
    | "null_access"
    | "async"
    | "type"
    | "react"
    | "nextjs"
    | "express"
    | "ai_generated"
    | "other";
  patterns: {
    error_message?: RegExp[];
    stack_trace?: RegExp[];
    ast_patterns?: string[]; // AST node patterns
    code_patterns?: RegExp[];
  };
  root_cause: string;
  suggested_fix: string;
  confidence: number;
  source: "builtin" | "user_correction" | "community";
  framework?: string;
  tags: string[];
  created_at: Date;
  match_count: number; // Track effectiveness
}

// Example signatures
const BUILTIN_SIGNATURES: BugSignature[] = [
  {
    id: "nextjs-hydration-mismatch",
    name: "Next.js Hydration Mismatch",
    category: "nextjs",
    patterns: {
      error_message: [
        /Hydration failed because/i,
        /Text content does not match/i,
        /did not match.*Server:/i,
      ],
    },
    root_cause: "Server-rendered HTML does not match client-side render",
    suggested_fix:
      "Use suppressHydrationWarning prop, dynamic imports with ssr:false, or ensure consistent rendering",
    confidence: 0.95,
    source: "builtin",
    framework: "nextjs",
    tags: ["react", "ssr", "hydration"],
    created_at: new Date(),
    match_count: 0,
  },
  {
    id: "react-hooks-order",
    name: "React Hooks Order Violation",
    category: "react",
    patterns: {
      error_message: [
        /Rendered more hooks than during the previous render/i,
        /Rendered fewer hooks than expected/i,
      ],
    },
    root_cause: "Conditional hook calls violate Rules of Hooks",
    suggested_fix: "Move hooks before any conditional returns or early returns",
    confidence: 0.98,
    source: "builtin",
    framework: "react",
    tags: ["hooks", "rules-of-hooks"],
    created_at: new Date(),
    match_count: 0,
  },
  {
    id: "copilot-null-chain",
    name: "AI-Generated Null Chain (Copilot Pattern)",
    category: "ai_generated",
    patterns: {
      error_message: [
        /Cannot read propert.*of undefined/i,
        /Cannot read propert.*of null/i,
      ],
      ast_patterns: ["MemberExpression_without_OptionalChaining"],
    },
    root_cause:
      "Missing optional chaining in AI-generated code - common Copilot pattern",
    suggested_fix:
      "Add ?. operator before property access: obj?.prop instead of obj.prop",
    confidence: 0.9,
    source: "builtin",
    tags: ["copilot", "ai-generated", "optional-chaining"],
    created_at: new Date(),
    match_count: 0,
  },
  {
    id: "unawaited-promise",
    name: "Unawaited Promise",
    category: "async",
    patterns: {
      ast_patterns: ["CallExpression_async_without_await"],
      code_patterns: [/\.then\(\s*\)\s*$/, /async.*\n.*[^await]\s+\w+\(/],
    },
    root_cause: "Async function called without await, causing race condition",
    suggested_fix: "Add await keyword before async function call",
    confidence: 0.85,
    source: "builtin",
    tags: ["async", "promise", "race-condition"],
    created_at: new Date(),
    match_count: 0,
  },
  {
    id: "express-unhandled-promise",
    name: "Express Unhandled Promise Rejection",
    category: "express",
    patterns: {
      error_message: [/UnhandledPromiseRejectionWarning/i],
      stack_trace: [/express\/lib\/router/],
    },
    root_cause:
      "Async route handler throws without try/catch or express-async-errors",
    suggested_fix:
      "Wrap async handlers with try/catch or use express-async-errors middleware",
    confidence: 0.88,
    source: "builtin",
    framework: "express",
    tags: ["express", "async", "middleware"],
    created_at: new Date(),
    match_count: 0,
  },
];
```

**Signature Matcher:**

```typescript
// services/signature-matcher.ts
export class SignatureMatcher {
  private signatures: BugSignature[] = [];

  constructor() {
    // Load builtin + custom signatures
    this.signatures = [...BUILTIN_SIGNATURES];
  }

  async loadOrgSignatures(orgId: string): Promise<void> {
    // Load signatures from user corrections
    const customSignatures = await db.query(
      `
      SELECT DISTINCT ON (error_signature)
        error_signature,
        error_category,
        corrected_root_cause,
        COUNT(*) as occurrences
      FROM rca_corrections
      WHERE org_id = $1 AND occurrences >= 3
      GROUP BY error_signature, error_category, corrected_root_cause
    `,
      [orgId]
    );

    for (const correction of customSignatures) {
      this.signatures.push({
        id: `user_${correction.error_signature}`,
        name: `Custom: ${correction.error_category}`,
        category: correction.error_category,
        patterns: {
          error_message: [
            new RegExp(escapeRegex(correction.error_signature), "i"),
          ],
        },
        root_cause: correction.corrected_root_cause,
        suggested_fix: "Based on previous team corrections",
        confidence: 0.85,
        source: "user_correction",
        tags: ["custom", "learned"],
        created_at: new Date(),
        match_count: correction.occurrences,
      });
    }
  }

  match(event: Event, code?: string): SignatureMatch | null {
    const errorMessage = event.message || "";
    const stackTrace = JSON.stringify(event.stack_trace || {});

    for (const signature of this.signatures) {
      let score = 0;
      let totalPatterns = 0;

      // Check error message patterns
      if (signature.patterns.error_message) {
        totalPatterns += signature.patterns.error_message.length;
        for (const pattern of signature.patterns.error_message) {
          if (pattern.test(errorMessage)) {
            score += 1;
          }
        }
      }

      // Check stack trace patterns
      if (signature.patterns.stack_trace) {
        totalPatterns += signature.patterns.stack_trace.length;
        for (const pattern of signature.patterns.stack_trace) {
          if (pattern.test(stackTrace)) {
            score += 1;
          }
        }
      }

      // Check code patterns
      if (signature.patterns.code_patterns && code) {
        totalPatterns += signature.patterns.code_patterns.length;
        for (const pattern of signature.patterns.code_patterns) {
          if (pattern.test(code)) {
            score += 1;
          }
        }
      }

      // Match if >50% of patterns hit
      if (totalPatterns > 0 && score / totalPatterns >= 0.5) {
        // Update match count
        this.incrementMatchCount(signature.id);

        return {
          signature,
          match_score: score / totalPatterns,
          patterns_matched: score,
          patterns_total: totalPatterns,
        };
      }
    }

    return null;
  }

  private async incrementMatchCount(signatureId: string): Promise<void> {
    await db.query(
      `
      UPDATE bug_signatures
      SET match_count = match_count + 1, last_matched_at = NOW()
      WHERE id = $1
    `,
      [signatureId]
    );
  }
}

interface SignatureMatch {
  signature: BugSignature;
  match_score: number;
  patterns_matched: number;
  patterns_total: number;
}
```

**Database Schema:**

```sql
CREATE TABLE bug_signatures (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  patterns JSONB NOT NULL,
  root_cause TEXT NOT NULL,
  suggested_fix TEXT NOT NULL,
  confidence FLOAT NOT NULL,
  source TEXT NOT NULL, -- builtin, user_correction, community
  framework TEXT,
  tags TEXT[],
  match_count INT DEFAULT 0,
  last_matched_at TIMESTAMPTZ,
  org_id UUID REFERENCES organizations(id), -- NULL for builtin/community
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signatures_category ON bug_signatures(category);
CREATE INDEX idx_signatures_framework ON bug_signatures(framework);
CREATE INDEX idx_signatures_match_count ON bug_signatures(match_count DESC);
```

**Integration with RCA Pipeline:**

```typescript
// In deterministic-analyzer.ts
async function analyzeWithSignatures(
  event: Event,
  code: string
): Promise<Finding[]> {
  const findings: Finding[] = [];

  // 1. Check signature database FIRST (instant, deterministic)
  const signatureMatch = await signatureMatcher.match(event, code);

  if (signatureMatch && signatureMatch.match_score >= 0.7) {
    findings.push({
      type: "signature_match",
      signature_id: signatureMatch.signature.id,
      message: signatureMatch.signature.root_cause,
      suggestion: signatureMatch.signature.suggested_fix,
      confidence:
        signatureMatch.signature.confidence * signatureMatch.match_score,
      severity: "high",
      source: "signature_database",
      line: null, // Signature matches are pattern-level, not line-level
    });

    // If high-confidence signature match, can skip LLM entirely
    if (
      signatureMatch.signature.confidence >= 0.9 &&
      signatureMatch.match_score >= 0.8
    ) {
      return findings; // Fast path - no LLM needed
    }
  }

  // 2. Run AST analysis for line-level findings
  const astFindings = await runASTAnalysis(code, event);
  findings.push(...astFindings);

  return findings;
}
```

**Benefits:**

| Benefit      | Impact                                           |
| ------------ | ------------------------------------------------ |
| **Speed**    | Instant detection (0ms vs 5-30s for LLM)         |
| **Cost**     | $0 per match (vs $0.15 per LLM RCA)              |
| **Accuracy** | Deterministic, always correct for known patterns |
| **Learning** | Improves from user corrections                   |
| **AI Code**  | Catches Copilot/ChatGPT signature bugs           |

---

**Tasks:**

1. **Synthetic Error Generator**

   ```python
   # python/analyzers/py_analyzer.py
   import ast

   class PythonAnalyzer:
       def analyze(self, code: str, error_line: int, error_type: str) -> dict:
           try:
               tree = ast.parse(code)
           except SyntaxError as e:
               return {
                   'findings': [{'type': 'syntax_error', 'message': str(e)}],
                   'confidence': 1.0
               }

           findings = []

           # Rule 1: AttributeError - accessing None
           if 'AttributeError' in error_type:
               findings.extend(self.check_none_access(tree, error_line))

           # Rule 2: KeyError - missing dict key
           if 'KeyError' in error_type:
               findings.extend(self.check_dict_access(tree, error_line))

           # Rule 3: IndexError - list index out of range
           if 'IndexError' in error_type:
               findings.extend(self.check_list_access(tree, error_line))

           # Rule 4: TypeError - wrong type passed
           if 'TypeError' in error_type:
               findings.extend(self.check_type_issues(tree, error_line))

           # Rule 5: NameError - undefined variable
           if 'NameError' in error_type:
               findings.extend(self.check_undefined_vars(tree, error_line))

           return {
               'findings': findings,
               'confidence': self.calculate_confidence(findings),
               'language': 'python'
           }

       def check_none_access(self, tree: ast.AST, line: int) -> list:
           """Detect accessing attributes on potentially None objects"""
           findings = []

           for node in ast.walk(tree):
               if isinstance(node, ast.Attribute) and node.lineno == line:
                   # Check if the value could be None
                   if self.could_be_none(node.value):
                       findings.append({
                           'type': 'potential_none_access',
                           'line': line,
                           'message': f'Accessing .{node.attr} on potentially None object',
                           'severity': 'high',
                           'suggestion': 'Add None check before accessing attribute'
                       })

           return findings
   ```

2. **Python Stack Trace Parser**

   ```python
   # python/parsers/python_stack_parser.py
   import re

   class PythonStackTraceParser:
       def parse(self, stack_trace: str) -> list:
           """
           Parse Python traceback into structured frames

           Example input:
           Traceback (most recent call last):
             File "/app/main.py", line 42, in process_user
               user.save()
           AttributeError: 'NoneType' object has no attribute 'save'
           """
           frames = []

           # Regex to match: File "path", line X, in function
           pattern = r'File "([^"]+)", line (\d+), in (\w+)'

           for match in re.finditer(pattern, stack_trace):
               file_path, line, function = match.groups()
               frames.append({
                   'file': file_path,
                   'line': int(line),
                   'function': function,
                   'language': 'python'
               })

           # Extract error type and message
           error_match = re.search(r'(\w+Error): (.+)$', stack_trace, re.MULTILINE)
           if error_match:
               error_type, message = error_match.groups()
           else:
               error_type, message = 'Unknown', 'Unknown error'

           return {
               'frames': frames,
               'error_type': error_type,
               'error_message': message
           }
   ```

3. **Language Detection**

   ```typescript
   // services/language-detector.ts
   export function detectLanguage(
     filePath: string,
     stackTrace: string
   ): Language {
     // By file extension
     if (filePath.endsWith(".py")) return "python";
     if (filePath.match(/\.(js|ts|jsx|tsx)$/)) return "javascript";

     // By stack trace format
     if (stackTrace.includes("Traceback (most recent call last)")) {
       return "python";
     }
     if (stackTrace.includes("at ") || stackTrace.includes("in ")) {
       return "javascript";
     }

     return "unknown";
   }
   ```

4. **Unified Analyzer Interface**

   ```typescript
   // workers/analyzer-worker.ts
   async function analyzeCode(
     code: string,
     errorLine: number,
     language: Language,
     errorType: string
   ) {
     const analyzerMap = {
       javascript: "analyzers.js_analyzer",
       python: "analyzers.py_analyzer",
     };

     const analyzer = analyzerMap[language];
     if (!analyzer) {
       throw new Error(`Unsupported language: ${language}`);
     }

     return runPythonModule(analyzer, {
       code,
       error_line: errorLine,
       error_type: errorType,
     });
   }
   ```

5. **Update Synthetic Dataset**
   - Add 50 Python error cases
   - Cover common Python patterns
   - Re-run evaluation with mixed dataset

**Deliverables:**

- ✅ Python analyzer working
- ✅ Python stack traces parsed correctly
- ✅ Multi-language support in pipeline
- ✅ Synthetic dataset includes Python errors

**Acceptance Criteria:**

- Python errors analyzed correctly (70%+ accuracy)
- Language auto-detection works
- Both JS and Python errors processed in same pipeline

---

### Week 9 — Monitoring, Observability, Alerting + Blast Radius Analysis

**Goals:**

- Comprehensive monitoring dashboards
- Alerting for failures and anomalies
- Performance optimization
- Production readiness checklist
- **🔥 NEW (P2): Implement Blast Radius Analysis for impact prioritization**

---

#### 🆕 Blast Radius Analysis (Competitive Differentiator - P2)

**Why This Feature:** Seer focuses on fixing. Buglens shows _why_ you should care about this bug first. Helps teams prioritize which bugs to fix.

**Display:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Blast Radius for TypeError at /api/users/[id]                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📍 Impact Location                                             │
│  └─ Route: /api/users/[id]                                      │
│  └─ File: src/api/users/[id]/route.ts:42                        │
│                                                                 │
│  📊 Error Metrics (Last 24h)                                    │
│  ├─ Error Count:          847 occurrences                       │
│  ├─ Error Rate:           2.3% of requests                      │
│  ├─ Unique Users:         ~340 users affected                   │
│  └─ First Seen:           2 days ago                            │
│                                                                 │
│  🔗 Affected Routes (Same Pattern)                              │
│  ├─ /api/users/[id]       (this route)                          │
│  ├─ /dashboard            (imports affected code)               │
│  └─ /profile              (calls affected API)                  │
│                                                                 │
│  💰 Business Impact (Estimated)                                 │
│  ├─ Failed Transactions:  ~$450                                 │
│  ├─ User Frustration:     HIGH (auth-related)                   │
│  └─ SLA Risk:             MEDIUM (>1% error rate)               │
│                                                                 │
│  ⚡ Priority Score: HIGH                                        │
│  └─ Reason: Revenue impact + High user count + Growing trend    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Data Model:**

```typescript
// types/blast-radius.ts
interface BlastRadius {
  error_location: {
    route: string;
    file_path: string;
    line_number: number;
  };

  metrics: {
    error_count: number;
    error_rate: number; // % of requests
    unique_users: number;
    first_seen: Date;
    last_seen: Date;
    trend: "increasing" | "stable" | "decreasing";
  };

  affected_routes: Array<{
    path: string;
    relationship: "same_file" | "imports" | "calls_api" | "same_pattern";
    error_count: number;
  }>;

  business_impact: {
    estimated_revenue_loss?: number;
    user_frustration: "low" | "medium" | "high";
    sla_risk: "none" | "low" | "medium" | "high";
  };

  priority_score: number; // 0-100
  priority_reasons: string[];
}
```

**Blast Radius Calculator:**

```typescript
// services/blast-radius-calculator.ts
export async function calculateBlastRadius(
  event: Event,
  orgId: string
): Promise<BlastRadius> {
  // 1. Get error metrics from Sentry data (aggregated)
  const metrics = await db.query(
    `
    SELECT
      COUNT(*) as error_count,
      COUNT(DISTINCT (context->>'user_id')) as unique_users,
      MIN(timestamp) as first_seen,
      MAX(timestamp) as last_seen
    FROM events
    WHERE org_id = $1
      AND signature = $2
      AND timestamp > NOW() - INTERVAL '24 hours'
  `,
    [orgId, event.signature]
  );

  // 2. Get total request count (from context or estimate)
  const totalRequests = await estimateRequestVolume(orgId, event);
  const errorRate = metrics.error_count / totalRequests;

  // 3. Find related routes (same file, imports, similar patterns)
  const affectedRoutes = await findAffectedRoutes(orgId, event);

  // 4. Calculate business impact
  const impact = calculateBusinessImpact(metrics, errorRate, event);

  // 5. Calculate priority score
  const { score, reasons } = calculatePriorityScore(
    metrics,
    impact,
    affectedRoutes
  );

  return {
    error_location: {
      route: extractRoute(event),
      file_path: event.stack_trace?.frames?.[0]?.filename || "unknown",
      line_number: event.stack_trace?.frames?.[0]?.lineno || 0,
    },
    metrics: {
      error_count: metrics.error_count,
      error_rate: errorRate,
      unique_users: metrics.unique_users,
      first_seen: metrics.first_seen,
      last_seen: metrics.last_seen,
      trend: calculateTrend(orgId, event.signature),
    },
    affected_routes: affectedRoutes,
    business_impact: impact,
    priority_score: score,
    priority_reasons: reasons,
  };
}

function calculatePriorityScore(
  metrics: Metrics,
  impact: BusinessImpact,
  routes: AffectedRoute[]
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Error volume (max 30 points)
  if (metrics.error_count > 1000) {
    score += 30;
    reasons.push("High error volume (>1000/24h)");
  } else if (metrics.error_count > 100) {
    score += 20;
    reasons.push("Medium error volume (>100/24h)");
  } else if (metrics.error_count > 10) {
    score += 10;
  }

  // User impact (max 25 points)
  if (metrics.unique_users > 100) {
    score += 25;
    reasons.push("Many users affected (>100)");
  } else if (metrics.unique_users > 10) {
    score += 15;
  }

  // Error rate (max 20 points)
  if (metrics.error_rate > 0.05) {
    score += 20;
    reasons.push("High error rate (>5%)");
  } else if (metrics.error_rate > 0.01) {
    score += 10;
    reasons.push("Elevated error rate (>1%)");
  }

  // Business impact (max 15 points)
  if (impact.user_frustration === "high") {
    score += 10;
    reasons.push("High user frustration (auth/payment related)");
  }
  if (impact.estimated_revenue_loss && impact.estimated_revenue_loss > 100) {
    score += 5;
    reasons.push(`Revenue impact (~$${impact.estimated_revenue_loss})`);
  }

  // Blast radius (max 10 points)
  if (routes.length > 3) {
    score += 10;
    reasons.push(`Multiple routes affected (${routes.length})`);
  } else if (routes.length > 1) {
    score += 5;
  }

  return { score: Math.min(100, score), reasons };
}
```

**Database Schema:**

```sql
ALTER TABLE rca_results ADD COLUMN blast_radius JSONB;
ALTER TABLE rca_results ADD COLUMN priority_score INT;
```

---

**Tasks:**

1. **CloudWatch Dashboards**

   ```typescript
   // terraform/monitoring.tf
   resource "aws_cloudwatch_dashboard" "buglens_main" {
     dashboard_name = "BugLens-Production"

     dashboard_body = jsonencode({
       widgets: [
         {
           type: "metric",
           properties: {
             metrics: [
               ["Buglens", "WebhookReceived", {stat: "Sum"}],
               [".", "RCAJobCompleted", {stat: "Sum"}],
               [".", "RCAJobFailed", {stat: "Sum"}]
             ],
             period: 300,
             stat: "Sum",
             region: "us-east-1",
             title: "Job Throughput"
           }
         },
         {
           type: "metric",
           properties: {
             metrics: [
               ["Buglens", "RCAProcessingTime", {stat: "Average"}],
               [".", "RCAProcessingTime", {stat: "p95"}],
               [".", "RCAProcessingTime", {stat: "p99"}]
             ],
             period: 300,
             stat: "Average",
             region: "us-east-1",
             title: "Processing Latency (ms)"
           }
         },
         {
           type: "metric",
           properties: {
             metrics: [
               ["Buglens", "LLMTokensUsed", {stat: "Sum"}],
               [".", "LLMCostUSD", {stat: "Sum"}]
             ],
             period: 3600,
             stat: "Sum",
             region: "us-east-1",
             title: "LLM Usage & Cost"
           }
         },
         {
           type: "metric",
           properties: {
             metrics: [
               ["Buglens", "GitHubCacheHitRate", {stat: "Average"}],
               [".", "GitHubAPICallsTotal", {stat: "Sum"}]
             ],
             period: 300,
             stat: "Average",
             region: "us-east-1",
             title: "GitHub Cache Performance"
           }
         }
       ]
     })
   }
   ```

2. **Custom Metrics**

   ```typescript
   // services/metrics.ts
   import { CloudWatch } from "@aws-sdk/client-cloudwatch";

   class MetricsService {
     private cw = new CloudWatch({ region: "us-east-1" });

     async recordWebhookReceived(orgId: string) {
       await this.putMetric("WebhookReceived", 1, [
         { Name: "OrgId", Value: orgId },
       ]);
     }

     async recordRCACompleted(
       orgId: string,
       processingTimeMs: number,
       tokensUsed: number
     ) {
       await Promise.all([
         this.putMetric("RCAJobCompleted", 1, [
           { Name: "OrgId", Value: orgId },
         ]),
         this.putMetric("RCAProcessingTime", processingTimeMs, [
           { Name: "OrgId", Value: orgId },
         ]),
         this.putMetric("LLMTokensUsed", tokensUsed, [
           { Name: "OrgId", Value: orgId },
         ]),
       ]);
     }

     async recordCacheHit(orgId: string, cacheType: "redis" | "s3" | "db") {
       await this.putMetric("GitHubCacheHit", 1, [
         { Name: "OrgId", Value: orgId },
         { Name: "CacheType", Value: cacheType },
       ]);
     }

     private async putMetric(name: string, value: number, dimensions: any[]) {
       await this.cw.putMetricData({
         Namespace: "Buglens",
         MetricData: [
           {
             MetricName: name,
             Value: value,
             Timestamp: new Date(),
             Dimensions: dimensions,
             Unit: name.includes("Time") ? "Milliseconds" : "Count",
           },
         ],
       });
     }
   }
   ```

3. **Alerting Rules**

   ```typescript
   // terraform/alarms.tf
   resource "aws_cloudwatch_metric_alarm" "job_failure_rate" {
     alarm_name          = "buglens-high-job-failure-rate"
     comparison_operator = "GreaterThanThreshold"
     evaluation_periods  = "2"
     metric_name         = "RCAJobFailed"
     namespace           = "Buglens"
     period              = "300"
     statistic           = "Sum"
     threshold           = "10"
     alarm_description   = "Alert when job failures exceed 10 in 5 minutes"
     alarm_actions       = [aws_sns_topic.alerts.arn]
   }

   resource "aws_cloudwatch_metric_alarm" "high_latency" {
     alarm_name          = "buglens-high-processing-latency"
     comparison_operator = "GreaterThanThreshold"
     evaluation_periods  = "2"
     metric_name         = "RCAProcessingTime"
     namespace           = "Buglens"
     period              = "300"
     statistic           = "Average"
     threshold           = "60000"  # 60 seconds
     alarm_description   = "Alert when average processing time exceeds 60s"
     alarm_actions       = [aws_sns_topic.alerts.arn]
   }

   resource "aws_cloudwatch_metric_alarm" "llm_cost_spike" {
     alarm_name          = "buglens-llm-cost-spike"
     comparison_operator = "GreaterThanThreshold"
     evaluation_periods  = "1"
     metric_name         = "LLMCostUSD"
     namespace           = "Buglens"
     period              = "3600"
     statistic           = "Sum"
     threshold           = "50"  # $50/hour
     alarm_description   = "Alert when LLM costs exceed $50/hour"
     alarm_actions       = [aws_sns_topic.alerts.arn]
   }
   ```

4. **Structured Logging**

   ```typescript
   // utils/logger.ts
   import winston from "winston";

   export const logger = winston.createLogger({
     level: process.env.LOG_LEVEL || "info",
     format: winston.format.combine(
       winston.format.timestamp(),
       winston.format.errors({ stack: true }),
       winston.format.json()
     ),
     defaultMeta: { service: "buglens-api" },
     transports: [
       new winston.transports.Console(),
       new winston.transports.File({
         filename: "logs/error.log",
         level: "error",
       }),
     ],
   });

   // Usage
   logger.info("RCA job started", {
     orgId,
     eventId,
     jobId,
     language: "javascript",
   });
   ```

5. **Performance Optimizations**
   - Add database indexes for slow queries
   - Implement connection pooling (Postgres, Redis)
   - Add response caching for API endpoints
   - Optimize LLM prompt lengths
   - Compress S3 uploads

6. **Load Testing**

   ```typescript
   // tests/load/rca-pipeline.test.ts
   import { check } from "k6";
   import http from "k6/http";

   export const options = {
     stages: [
       { duration: "2m", target: 10 }, // Ramp up to 10 RPS
       { duration: "5m", target: 10 }, // Stay at 10 RPS
       { duration: "2m", target: 20 }, // Ramp to 20 RPS
       { duration: "5m", target: 20 }, // Stay at 20 RPS
       { duration: "2m", target: 0 }, // Ramp down
     ],
     thresholds: {
       http_req_duration: ["p95<30000"], // 95% under 30s
       http_req_failed: ["rate<0.1"], // < 10% failures
     },
   };

   export default function () {
     const payload = JSON.stringify({
       event_id: "test-event",
       message: 'TypeError: Cannot read property "name" of undefined',
       // ... full payload
     });

     const res = http.post(
       "http://localhost:3000/api/v1/webhooks/sentry",
       payload
     );

     check(res, {
       "status is 200": (r) => r.status === 200,
       "response time < 3s": (r) => r.timings.duration < 3000,
     });
   }
   ```

**Deliverables:**

- ✅ CloudWatch dashboards live
- ✅ Alerts configured and tested
- ✅ Load testing passed (20 RPS sustained)
- ✅ Performance optimizations applied
- ✅ Structured logging implemented

**Acceptance Criteria:**

- P95 latency < 30s under load
- Job failure rate < 5%
- Cache hit rate > 80%
- Alerts fire correctly during simulated failures

---

### Week 10 — Human-in-the-Loop Review System

**Goals:**

- Build admin review UI for low-confidence RCAs
- Implement feedback collection pipeline
- Create prompt tuning workflow
- Track improvement metrics

**Tasks:**

1. **Review Queue**

   ```sql
   CREATE TABLE rca_review_queue (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     rca_result_id UUID NOT NULL REFERENCES rca_results(id),
     org_id UUID NOT NULL REFERENCES organizations(id),
     confidence FLOAT NOT NULL,
     requires_review BOOLEAN DEFAULT false,
     reviewed_by UUID REFERENCES users(id),
     review_status TEXT, -- pending, approved, rejected, needs_revision
     reviewer_notes TEXT,
     ground_truth_root_cause TEXT,
     ground_truth_fix TEXT,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     reviewed_at TIMESTAMPTZ
   );

   -- Auto-populate for low confidence
   CREATE FUNCTION queue_low_confidence_rca()
   RETURNS TRIGGER AS $$
   BEGIN
     IF NEW.confidence < 0.7 THEN
       INSERT INTO rca_review_queue (rca_result_id, org_id, confidence, requires_review)
       VALUES (NEW.id, NEW.org_id, NEW.confidence, true);
     END IF;
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER auto_queue_review
     AFTER INSERT ON rca_results
     FOR EACH ROW
     EXECUTE FUNCTION queue_low_confidence_rca();
   ```

2. **Review UI**

   ```tsx
   // web/src/pages/admin/ReviewQueue.tsx
   export function ReviewQueue() {
     const { data: queue } = useQuery("review-queue", api.getReviewQueue);
     const [selectedRCA, setSelectedRCA] = useState(null);

     return (
       <div className="grid grid-cols-3 gap-4">
         {/* Left: Queue list */}
         <div className="col-span-1">
           <h2 className="text-xl font-bold mb-4">Pending Reviews</h2>
           {queue?.map((item) => (
             <ReviewCard
               key={item.id}
               rca={item}
               onClick={() => setSelectedRCA(item)}
               selected={selectedRCA?.id === item.id}
             />
           ))}
         </div>

         {/* Right: Review form */}
         <div className="col-span-2">
           {selectedRCA && (
             <ReviewForm
               rca={selectedRCA}
               onSubmit={async (feedback) => {
                 await api.submitReview(selectedRCA.id, feedback);
                 // Refresh queue
               }}
             />
           )}
         </div>
       </div>
     );
   }

   function ReviewForm({ rca, onSubmit }) {
     const [status, setStatus] = useState("pending");
     const [notes, setNotes] = useState("");
     const [groundTruthCause, setGroundTruthCause] = useState("");
     const [groundTruthFix, setGroundTruthFix] = useState("");

     return (
       <form
         onSubmit={(e) => {
           e.preventDefault();
           onSubmit({
             status,
             notes,
             groundTruthCause,
             groundTruthFix,
           });
         }}
       >
         <h3 className="text-xl font-bold mb-4">{rca.title}</h3>

         <Section title="AI Analysis">
           <div className="bg-gray-50 p-4 rounded">
             <p>
               <strong>Summary:</strong> {rca.summary}
             </p>
             <p>
               <strong>Root Cause:</strong> {rca.root_cause}
             </p>
             <p>
               <strong>Confidence:</strong> {(rca.confidence * 100).toFixed(0)}%
             </p>
           </div>
         </Section>

         <Section title="Review Decision">
           <RadioGroup value={status} onChange={setStatus}>
             <Radio value="approved">✅ Approved - Analysis is correct</Radio>
             <Radio value="partially_correct">
               ⚠️ Partially Correct - Needs refinement
             </Radio>
             <Radio value="rejected">❌ Rejected - Analysis is wrong</Radio>
           </RadioGroup>
         </Section>

         <Section title="Ground Truth (for training)">
           <Textarea
             label="Correct Root Cause"
             value={groundTruthCause}
             onChange={setGroundTruthCause}
             placeholder="What is the actual root cause?"
           />
           <Textarea
             label="Correct Fix"
             value={groundTruthFix}
             onChange={setGroundTruthFix}
             placeholder="What is the correct fix?"
           />
         </Section>

         <Section title="Reviewer Notes">
           <Textarea
             value={notes}
             onChange={setNotes}
             placeholder="Any additional context or feedback..."
           />
         </Section>

         <Button type="submit">Submit Review</Button>
       </form>
     );
   }
   ```

3. **Feedback Pipeline**

   ```typescript
   // api/routes/admin/reviews.ts
   app.post("/api/v1/admin/reviews/:id/submit", async (req, res) => {
     const { id } = req.params;
     const { status, notes, ground_truth_cause, ground_truth_fix } = req.body;

     // Update review queue
     await db.query(
       `
       UPDATE rca_review_queue
       SET
         review_status = $1,
         reviewer_notes = $2,
         ground_truth_root_cause = $3,
         ground_truth_fix = $4,
         reviewed_by = $5,
         reviewed_at = NOW()
       WHERE id = $6
     `,
       [status, notes, ground_truth_cause, ground_truth_fix, req.user.id, id]
     );

     // If approved or rejected, add to training dataset
     if (status === "approved" || status === "rejected") {
       await db.training_examples.create({
         rca_result_id: review.rca_result_id,
         is_positive: status === "approved",
         ground_truth_cause,
         ground_truth_fix,
         reviewer_id: req.user.id,
       });
     }

     res.json({ success: true });
   });
   ```

4. **Training Data Export**

   ```python
   # scripts/export-training-data.py
   """Export reviewed RCAs for prompt tuning"""

   def export_training_data(output_file: str):
       reviews = db.query("""
           SELECT
               r.evidence,
               r.root_cause as ai_root_cause,
               r.suggested_fix as ai_fix,
               q.ground_truth_root_cause,
               q.ground_truth_fix,
               q.review_status
           FROM rca_results r
           JOIN rca_review_queue q ON q.rca_result_id = r.id
           WHERE q.reviewed_at IS NOT NULL
       """)

       training_data = []
       for review in reviews:
           training_data.append({
               'input': {
                   'error': review['evidence']['error'],
                   'code': review['evidence']['code'],
                   'deterministic_findings': review['evidence']['deterministic_findings']
               },
               'expected_output': {
                   'root_cause': review['ground_truth_root_cause'],
                   'suggested_fix': review['ground_truth_fix']
               },
               'ai_output': {
                   'root_cause': review['ai_root_cause'],
                   'suggested_fix': review['ai_fix']
               },
               'was_correct': review['review_status'] == 'approved'
           })

       with open(output_file, 'w') as f:
           json.dump(training_data, f, indent=2)
   ```

5. **Metrics Dashboard**
   - Review queue size over time
   - Approval rate by confidence bucket
   - Most common error types needing review
   - Reviewer throughput

**Deliverables:**

- ✅ Review queue auto-populated
- ✅ Admin UI for reviewing RCAs
- ✅ Ground truth data collected
- ✅ Training data export working

**Acceptance Criteria:**

- Low confidence RCAs (< 70%) auto-queued
- Admin can review and approve/reject
- Ground truth data exported for 20+ reviews
- Metrics show improvement over time

---

### Week 11 — Enterprise Features, Security Hardening + Team Knowledge Graph

**Goals:**

- On-premise deployment option (basic)
- Security audit and hardening
- SSO preparation
- Compliance documentation (SOC2 prep)
- **🔥 NEW (P3): Implement Team Knowledge Graph for expert routing**

---

#### 🆕 Team Knowledge Graph (Competitive Differentiator - P3)

**Why This Feature:** Reduces MTTR by routing bugs to the right person immediately. Shows who owns what code and who has resolved similar issues.

**Display:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Code Ownership & Expertise                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  File: src/api/payments/checkout.ts                             │
│                                                                 │
│  👤 Primary Expert: @alice                                      │
│     └─ Resolved 12 bugs in /payments/*                          │
│     └─ Avg resolution time: 18 min                              │
│                                                                 │
│  📝 Last Editor: @bob (2 days ago)                              │
│     └─ Commit: "Add tax calculation"                            │
│                                                                 │
│  👥 Code Reviewers:                                             │
│     └─ @charlie (reviewed 8 PRs)                                │
│     └─ @diana (reviewed 3 PRs)                                  │
│                                                                 │
│  ────────────────────────────────────────────────────────────   │
│                                                                 │
│  🎯 Suggested Assignee: @alice                                  │
│     Reason: Most expertise + fastest resolution time            │
│                                                                 │
│  [ Assign to @alice ]  [ Notify on Slack ]                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Data Model:**

```typescript
// types/team-knowledge.ts
interface CodeOwnership {
  file_path: string;
  directory_path: string; // For pattern matching

  experts: Array<{
    user_id: string;
    github_username: string;
    expertise_score: number;
    bugs_resolved: number;
    avg_resolution_time_ms: number;
    last_active_at: Date;
  }>;

  recent_editors: Array<{
    user_id: string;
    github_username: string;
    commit_sha: string;
    commit_message: string;
    committed_at: Date;
  }>;

  reviewers: Array<{
    user_id: string;
    github_username: string;
    reviews_count: number;
  }>;
}

interface ExpertSuggestion {
  user_id: string;
  github_username: string;
  score: number;
  reasons: string[];
  notification_method: "slack" | "email" | "github_mention";
}
```

**Database Schema:**

```sql
CREATE TABLE code_expertise (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  github_username TEXT NOT NULL,
  file_pattern TEXT NOT NULL,  -- e.g., 'src/api/payments/*'
  bugs_resolved INT DEFAULT 0,
  total_resolution_time_ms BIGINT DEFAULT 0,
  last_resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, github_username, file_pattern)
);

CREATE INDEX idx_expertise_org_pattern ON code_expertise(org_id, file_pattern);
CREATE INDEX idx_expertise_bugs ON code_expertise(org_id, bugs_resolved DESC);

-- Track who resolves which RCAs
CREATE TABLE rca_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rca_id UUID REFERENCES rca_results(id),
  org_id UUID REFERENCES organizations(id),
  resolved_by_user_id UUID REFERENCES users(id),
  resolved_by_github TEXT,
  resolution_time_ms BIGINT,
  resolution_method TEXT,  -- 'fixed', 'wont_fix', 'duplicate'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Expertise Calculator:**

```typescript
// services/expertise-tracker.ts
export class ExpertiseTracker {
  async trackResolution(
    rca: RCAResult,
    resolvedBy: string,
    resolutionTimeMs: number
  ): Promise<void> {
    const filePath = rca.evidence.code?.file_path || "";
    const pattern = this.getDirectoryPattern(filePath);

    // Upsert expertise record
    await db.query(
      `
      INSERT INTO code_expertise (org_id, github_username, file_pattern, bugs_resolved, total_resolution_time_ms, last_resolved_at)
      VALUES ($1, $2, $3, 1, $4, NOW())
      ON CONFLICT (org_id, github_username, file_pattern)
      DO UPDATE SET
        bugs_resolved = code_expertise.bugs_resolved + 1,
        total_resolution_time_ms = code_expertise.total_resolution_time_ms + $4,
        last_resolved_at = NOW(),
        updated_at = NOW()
    `,
      [rca.org_id, resolvedBy, pattern, resolutionTimeMs]
    );

    // Track resolution for analytics
    await db.query(
      `
      INSERT INTO rca_resolutions (rca_id, org_id, resolved_by_github, resolution_time_ms, resolution_method)
      VALUES ($1, $2, $3, $4, 'fixed')
    `,
      [rca.id, rca.org_id, resolvedBy, resolutionTimeMs]
    );
  }

  async getExperts(
    orgId: string,
    filePath: string
  ): Promise<ExpertSuggestion[]> {
    const pattern = this.getDirectoryPattern(filePath);

    const experts = await db.query(
      `
      SELECT
        github_username,
        bugs_resolved,
        total_resolution_time_ms / NULLIF(bugs_resolved, 0) as avg_resolution_time,
        last_resolved_at
      FROM code_expertise
      WHERE org_id = $1
        AND $2 LIKE file_pattern || '%'
      ORDER BY bugs_resolved DESC, last_resolved_at DESC
      LIMIT 5
    `,
      [orgId, filePath]
    );

    return experts.map((e, i) => ({
      github_username: e.github_username,
      user_id: null, // Lookup if mapped to Buglens user
      score: this.calculateExpertScore(e),
      reasons: this.getExpertReasons(e),
      notification_method: "slack",
    }));
  }

  private calculateExpertScore(expert: any): number {
    let score = 0;

    // Bugs resolved (max 50 points)
    score += Math.min(50, expert.bugs_resolved * 5);

    // Resolution speed (max 30 points)
    const avgTimeMinutes = expert.avg_resolution_time / 60000;
    if (avgTimeMinutes < 15) score += 30;
    else if (avgTimeMinutes < 30) score += 20;
    else if (avgTimeMinutes < 60) score += 10;

    // Recency (max 20 points)
    const daysSinceActive =
      (Date.now() - new Date(expert.last_resolved_at).getTime()) / 86400000;
    if (daysSinceActive < 7) score += 20;
    else if (daysSinceActive < 30) score += 10;

    return score;
  }

  private getExpertReasons(expert: any): string[] {
    const reasons: string[] = [];
    reasons.push(`Resolved ${expert.bugs_resolved} bugs in this area`);

    const avgTimeMinutes = Math.round(expert.avg_resolution_time / 60000);
    reasons.push(`Avg resolution time: ${avgTimeMinutes} minutes`);

    return reasons;
  }

  private getDirectoryPattern(filePath: string): string {
    // Convert 'src/api/payments/checkout.ts' to 'src/api/payments/*'
    const parts = filePath.split("/");
    parts.pop(); // Remove filename
    return parts.join("/") + "/*";
  }
}
```

**Integration with RCA:**

```typescript
// Add to RCA result generation
const expertise = await expertiseTracker.getExperts(
  orgId,
  codeContext.file_path
);

rcaResult.suggested_assignee = expertise[0] || null;
rcaResult.code_experts = expertise;
```

---

**Tasks:**

1. **Self-Hosted Agent (Basic)**

   ```yaml
   # docker-compose.self-hosted.yml
   version: "3.8"
   services:
     buglens-agent:
       image: buglens/agent:latest
       environment:
         - BUGLENS_API_KEY=${API_KEY}
         - BUGLENS_CLOUD_URL=https://api.buglens.com
         - GITHUB_TOKEN=${GITHUB_TOKEN}
         - AGENT_MODE=self_hosted
       volumes:
         - ./config:/app/config
       networks:
         - customer-vpc

     postgres:
       image: postgres:15
       environment:
         - POSTGRES_DB=buglens
         - POSTGRES_PASSWORD=${DB_PASSWORD}
       volumes:
         - postgres-data:/var/lib/postgresql/data

     redis:
       image: redis:7
       volumes:
         - redis-data:/data

   volumes:
     postgres-data:
     redis-data:
   ```

2. **Agent Code Fetcher (Local)**

   ```typescript
   // agent/code-fetcher-local.ts
   /**
    * For self-hosted: fetch code from local Git repos
    * instead of GitHub API
    */
   export class LocalCodeFetcher {
     async fetchFile(
       repoPath: string,
       filePath: string,
       sha: string
     ): Promise<string> {
       // Use git show to get file at specific commit
       const { stdout } = await execPromise(
         `git -C ${repoPath} show ${sha}:${filePath}`
       );
       return stdout;
     }

     async getRecentCommits(
       repoPath: string,
       filePath: string,
       count: number = 5
     ) {
       const { stdout } = await execPromise(
         `git -C ${repoPath} log -n ${count} --pretty=format:"%H|%an|%ae|%at|%s" -- ${filePath}`
       );

       return stdout.split("\n").map((line) => {
         const [hash, author, email, timestamp, message] = line.split("|");
         return {
           hash,
           author,
           email,
           timestamp: parseInt(timestamp),
           message,
         };
       });
     }
   }
   ```

3. **Security Hardening Checklist**
   - [ ] Input validation on all API endpoints
   - [ ] SQL injection prevention (parameterized queries)
   - [ ] XSS prevention (sanitize user input)
   - [ ] CSRF tokens on state-changing operations
   - [ ] Rate limiting per IP and per org
   - [ ] DDoS protection (CloudFront + WAF)
   - [ ] Secret rotation mechanism
   - [ ] Encryption at rest (RDS, S3)
   - [ ] Encryption in transit (TLS 1.3)
   - [ ] Audit logging for all data access
   - [ ] PII redaction in logs
   - [ ] Dependency scanning (Snyk/Dependabot)
   - [ ] Container scanning (Trivy)
   - [ ] Penetration testing (basic)

4. **Audit Logging**

   ```sql
   CREATE TABLE audit_logs (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id UUID REFERENCES organizations(id),
     user_id UUID REFERENCES users(id),
     action TEXT NOT NULL, -- webhook_received, rca_generated, code_accessed, etc.
     resource_type TEXT,
     resource_id UUID,
     ip_address INET,
     user_agent TEXT,
     metadata JSONB,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE INDEX idx_audit_logs_org_time ON audit_logs(org_id, created_at DESC);
   CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
   ```

5. **PII Redaction**

   ```typescript
   // utils/redaction.ts
   export function redactPII(text: string): string {
     let redacted = text;

     // Email addresses
     redacted = redacted.replace(
       /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
       "[EMAIL_REDACTED]"
     );

     // Credit card numbers
     redacted = redacted.replace(
       /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
       "[CC_REDACTED]"
     );

     // API keys (common patterns)
     redacted = redacted.replace(
       /\b(sk|pk)_[a-zA-Z0-9]{32,}\b/g,
       "[API_KEY_REDACTED]"
     );

     // AWS keys
     redacted = redacted.replace(/AKIA[0-9A-Z]{16}/g, "[AWS_KEY_REDACTED]");

     // Social Security Numbers
     redacted = redacted.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN_REDACTED]");

     return redacted;
   }
   ```

6. **SOC2 Prep Documentation**
   - Data flow diagram
   - Encryption policies
   - Access control policies
   - Incident response plan
   - Backup and recovery procedures
   - Change management process

**Deliverables:**

- ✅ Self-hosted agent Docker image
- ✅ Security hardening complete
- ✅ Audit logging implemented
- ✅ PII redaction working
- ✅ SOC2 prep docs ready

**Acceptance Criteria:**

- Self-hosted agent can process RCAs locally
- Security scan shows no critical vulnerabilities
- Audit logs capture all sensitive operations
- PII automatically redacted from logs

---

### Week 12 — Polish, Documentation & Launch Prep

**Goals:**

- Comprehensive documentation
- Onboarding flow optimization
- Final testing and bug fixes
- Launch readiness review

**Tasks:**

1. **Documentation**

   **Quick Start Guide**

   ```markdown
   # BugLens Quick Start

   ## 1. Sign Up

   Visit https://app.buglens.com and create an account

   ## 2. Connect Sentry

   1. Go to Settings → Integrations
   2. Click "Connect Sentry"
   3. Enter your Sentry organization slug
   4. Add webhook URL to Sentry project settings

   ## 3. Connect GitHub

   1. Click "Connect GitHub"
   2. Authorize BugLens app (read-only access)
   3. Select repositories to analyze

   ## 4. Connect Slack

   1. Click "Connect Slack"
   2. Choose channel for RCA notifications
   3. Test connection

   ## 5. Trigger Test Error

   Trigger an error in your app and see RCA in Slack within 60 seconds!
   ```

   **API Documentation**
   - OpenAPI spec for all endpoints
   - Authentication guide
   - Webhook payload examples
   - Rate limiting details

   **Architecture Documentation**
   - System architecture diagram
   - Data flow diagrams
   - Database schema documentation
   - Deployment guide

2. **Onboarding Flow**

   ```tsx
   // web/src/components/Onboarding.tsx
   export function OnboardingFlow() {
     const [step, setStep] = useState(1);
     const [completedSteps, setCompletedSteps] = useState([]);

     const steps = [
       {
         id: "sentry",
         title: "Connect Sentry",
         description: "Link your Sentry project to start receiving errors",
         component: <SentrySetup onComplete={() => markComplete("sentry")} />,
       },
       {
         id: "github",
         title: "Connect GitHub",
         description: "Grant read-only access to fetch code context",
         component: <GitHubSetup onComplete={() => markComplete("github")} />,
       },
       {
         id: "slack",
         title: "Connect Slack",
         description: "Choose where to receive RCA notifications",
         component: <SlackSetup onComplete={() => markComplete("slack")} />,
       },
       {
         id: "test",
         title: "Test Integration",
         description: "Trigger a test error to verify setup",
         component: <TestIntegration />,
       },
     ];

     return (
       <div className="max-w-3xl mx-auto p-8">
         <h1 className="text-3xl font-bold mb-8">Welcome to BugLens! 🐛</h1>

         <ProgressBar
           steps={steps.length}
           current={step}
           completed={completedSteps.length}
         />

         <div className="mt-8">{steps[step - 1].component}</div>

         <div className="flex justify-between mt-8">
           <Button
             variant="secondary"
             onClick={() => setStep(Math.max(1, step - 1))}
             disabled={step === 1}
           >
             Previous
           </Button>
           <Button
             onClick={() => setStep(Math.min(steps.length, step + 1))}
             disabled={!completedSteps.includes(steps[step - 1].id)}
           >
             Next
           </Button>
         </div>
       </div>
     );
   }
   ```

3. **Testing Checklist**

   **Unit Tests**
   - [ ] All services have >80% coverage
   - [ ] All API endpoints tested
   - [ ] All analyzers tested with synthetic data

   **Integration Tests**
   - [ ] Full webhook → RCA → Slack flow
   - [ ] GitHub code fetching with cache layers
   - [ ] Multi-tenant isolation verified
   - [ ] Rate limiting working correctly

   **E2E Tests**
   - [ ] User signup → onboarding → first RCA
   - [ ] Slack notification delivery
   - [ ] Web UI navigation
   - [ ] Feedback submission

   **Performance Tests**
   - [ ] Load test: 20 RPS sustained
   - [ ] Spike test: 100 RPS for 1 minute
   - [ ] Soak test: 10 RPS for 1 hour

   **Security Tests**
   - [ ] Dependency vulnerabilities < high
   - [ ] Container vulnerabilities < critical
   - [ ] OWASP Top 10 checks passed
   - [ ] Penetration test results reviewed

4. **Monitoring Runbooks**

   ```markdown
   # Runbook: High Job Failure Rate

   ## Alert

   Job failure rate > 10% for 5+ minutes

   ## Immediate Actions

   1. Check CloudWatch logs for error patterns
   2. Check GitHub API rate limit status
   3. Check LLM service availability (OpenAI status page)
   4. Check database connection pool

   ## Investigation

   1. Query failed jobs:
      SELECT \* FROM rca_jobs WHERE status='failed' ORDER BY updated_at DESC LIMIT 20
   2. Group by error type to identify pattern
   3. Check if failures isolated to specific org

   ## Resolution

   - If GitHub rate limit: wait or increase limits
   - If LLM timeout: increase timeout or retry
   - If database: scale up or check query performance
   - If code issue: rollback deployment

   ## Prevention

   - Implement circuit breaker for external services
   - Add more aggressive retries
   - Increase resource limits if capacity issue
   ```

5. **Final Optimizations**
   - Database query optimization
   - API response time improvements
   - Frontend bundle size reduction
   - Image optimization
   - CDN configuration

6. **Launch Checklist**
   - [ ] Production infrastructure deployed
   - [ ] DNS configured
   - [ ] SSL certificates valid
   - [ ] Monitoring dashboards live
   - [ ] Alerts configured and tested
   - [ ] Backup and recovery tested
   - [ ] Incident response plan documented
   - [ ] Support email/chat configured
   - [ ] Marketing site live
   - [ ] Pricing page published
   - [ ] Terms of Service and Privacy Policy published
   - [ ] Customer success playbook ready
   - [ ] Demo environment ready
   - [ ] Beta customer list ready
   - [ ] Feedback collection process defined

**Deliverables:**

- ✅ Complete documentation published
- ✅ Onboarding flow polished
- ✅ All tests passing
- ✅ Runbooks written
- ✅ Launch checklist complete

**Acceptance Criteria:**

- New user can complete onboarding in < 10 minutes
- All test suites green
- Performance meets SLAs
- Security audit passed
- Demo-ready for customers

---

## Phase 2 Success Metrics

### Quality Improvements

- ✅ RCA accuracy improved from 70% → 80%+
- ✅ User "helpful" feedback rate > 70%
- ✅ False positive rate < 10%

### Scale Metrics

- ✅ Handle 10,000 events/hour aggregate
- ✅ Support 50+ organizations
- ✅ Multi-language support (JS/TS + Python)

### Enterprise Readiness

- ✅ Self-hosted option available
- ✅ Security audit passed
- ✅ SOC2 prep complete
- ✅ 99.5% uptime achieved

### Operational Excellence

- ✅ P95 latency < 30s
- ✅ Job success rate > 95%
- ✅ Cost per RCA < $0.10
- ✅ On-call incidents < 2/week

---

## What's NOT in Phase 2 (Post-Launch)

- ❌ Auto-PR generation
- ❌ Datadog integration
- ❌ Local LLM models (70B+)
- ❌ Advanced graph database (Neo4j)
- ❌ SSO/SCIM (enterprise auth)
- ❌ Custom ML model training
- ❌ Real-time collaboration features
- ❌ Advanced analytics dashboard
- ❌ White-label option
- ❌ API for third-party integrations

---

## Post-Launch Roadmap (Months 4-6)

### Month 4: Growth & Optimization

- Add Datadog integration
- Implement local LLM option (cost optimization)
- Advanced caching strategies
- Customer success automation

### Month 5: Enterprise Features

- SSO/SCIM integration
- Advanced RBAC
- Custom retention policies
- White-label option
- SLA guarantees

### Month 6: Product Expansion

- More language support (Java, Go, Ruby)
- Auto-PR generation (experimental)
- Advanced analytics
- API for integrations
- Slack app marketplace listing

---

## Team & Resources (Phase 2)

**Team (unchanged):**

- 1 Full-stack Engineer
- 1 Backend/ML Engineer
- 0.5 DevOps/SRE

**Infrastructure Costs (Phase 2):**

- ECS Fargate: ~$150/month (scaled up)
- RDS Postgres: ~$100/month (larger instance)
- Redis: ~$50/month
- S3: ~$50/month
- LLM (GPT-4o-mini): ~$300-500/month (10 orgs)
- CloudWatch: ~$50/month
- **Total: ~$700-900/month**

**Additional Costs:**

- Security audit: $5,000 (one-time)
- Legal (ToS, Privacy): $2,000 (one-time)
- Marketing site: $3,000 (one-time)

---

## Launch Go/No-Go Criteria

### Technical Requirements

- ✅ End-to-end flow working for JS/TS and Python
- ✅ Multi-tenancy verified with 10+ test orgs
- ✅ Performance SLAs met under load
- ✅ Security audit passed
- ✅ Monitoring and alerting working
- ✅ Backup and recovery tested

### Product Requirements

- ✅ Onboarding < 10 minutes
- ✅ RCA accuracy > 75% on real data
- ✅ User feedback mechanism working
- ✅ Slack + Web UI polished

### Business Requirements

- ✅ Documentation complete
- ✅ Support process defined
- ✅ Pricing determined
- ✅ Legal docs published
- ✅ 5+ beta customers committed

### Operational Requirements

- ✅ On-call rotation defined
- ✅ Incident response plan documented
- ✅ Runbooks written
- ✅ Escalation paths clear

---

## Success Definition

**Phase 2 is complete when:**

1. **Product is production-ready** - Can handle real customer load with >95% reliability
2. **Quality is validated** - RCA accuracy >75%, user satisfaction >70%
3. **Enterprise-safe** - Security hardened, compliant, audit-ready
4. **Scalable** - Can handle 10,000 events/hour across 50+ orgs
5. **Observable** - Full monitoring, alerting, and operational excellence
6. **Documented** - Customers and team can self-serve

**You're ready to onboard real customers and iterate based on feedback.**
