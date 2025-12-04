# Buglens Architecture (UPDATED - November 2025)

## Recommended MVP Architecture

**👉 A Modular Monolith with Embedded Python Workers**

Not microservices. Not a giant distributed footprint. Not a single blob either.

Think Sentry's early architecture + LLM layer + contextual fetcher, all in one deployable unit with background workers.

---

## 🧩 Core Architecture Decisions

### Architecture Pattern: Modular Monolith

**Repository Structure:**

```
buglens/
├── src/                    # Node.js/TypeScript backend
│   ├── api/               # Fastify API server
│   ├── workers/           # BullMQ job processors
│   ├── services/          # Business logic
│   ├── integrations/      # Sentry, GitHub, Slack clients
│   └── db/                # Postgres models & migrations
├── python/                # Python components
│   ├── analyzers/         # AST analysis (tree-sitter)
│   ├── llm/               # GPT-4o-mini orchestration
│   └── timeline/          # Log reconstruction
└── web/                   # React frontend (separate deployment)
```

### ✔️ Single Backend Application (Node.js + Embedded Python)

**Node.js handles:**

-   HTTP API (Fastify)
-   Job orchestration (BullMQ)
-   GitHub API integration
-   Slack notifications
-   Database operations
-   Caching (Redis)

**Python handles (via child_process):**

-   AST analysis (tree-sitter for JS/TS, Python)
-   Deterministic rule engine
-   LLM orchestration (GPT-4o-mini only for MVP)
-   Timeline reconstruction

**Integration Method:**

-   Node.js spawns Python processes via `child_process.spawn()`
-   Communication via stdin/stdout JSON
-   Python runs in isolated venv
-   Stateless execution (no shared state)

### ✔️ Multi-Tenancy from Day 1

**Every table includes `org_id`:**

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'free', -- free, pro, enterprise
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- All tables have org_id
ALTER TABLE events ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE rca_jobs ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE rca_results ADD COLUMN org_id UUID REFERENCES organizations(id);
```

**Row-level security enabled:**

```sql
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_isolation ON events
  USING (org_id = current_setting('app.current_org_id')::UUID);
```

### ✔️ Infrastructure Stack

| Component       | Technology          | Purpose                                      |
| --------------- | ------------------- | -------------------------------------------- |
| **Compute**     | AWS ECS Fargate     | Single service deployment (simpler than K8s) |
| **Database**    | PostgreSQL 15 (RDS) | Events, RCA results, users, orgs             |
| **Cache/Queue** | Redis (ElastiCache) | BullMQ jobs + GitHub cache                   |
| **Storage**     | S3                  | Code snapshots, evidence bundles             |
| **Secrets**     | AWS Secrets Manager | GitHub tokens, API keys                      |
| **Monitoring**  | CloudWatch + Sentry | Metrics, logs, errors                        |
| **IaC**         | Terraform           | All infrastructure as code                   |

### ✔️ Cost Controls & Rate Limiting (Week 1 Priority)

**Per-organization limits:**

```typescript
export const RATE_LIMITS = {
    free: {
        events_per_hour: 100,
        rca_jobs_per_day: 50,
        llm_tokens_per_day: 100_000,
        github_api_calls_per_hour: 500,
    },
    pro: {
        events_per_hour: 1000,
        rca_jobs_per_day: 500,
        llm_tokens_per_day: 1_000_000,
        github_api_calls_per_hour: 2000,
    },
    enterprise: {
        events_per_hour: 10000,
        rca_jobs_per_day: 5000,
        llm_tokens_per_day: 10_000_000,
        github_api_calls_per_hour: 5000,
    },
};
```

### ✔️ Three-Tier GitHub Caching (Week 2 Priority)

**Critical for rate limit management:**

1. **Redis (hot)** - 1 hour TTL, <100ms access
2. **S3 (warm)** - 7 day retention, gzipped, <2s access
3. **Database (cold)** - Permanent for analyzed files

**Expected cache hit rate: >80%**

**Zero microservices until you have traction.**
You don't need 12 services. You need bounded modules, not distributed systems.

---

### ✔️ Hybrid LLM-Assisted Event Extraction (Week 4 Priority)

**Problem:** Source maps, file paths, and malformed Sentry events prevent reliable code fetching.

**Solution:** A three-stage extraction pipeline that uses LLM only when deterministic extraction fails.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HYBRID EVENT EXTRACTION PIPELINE                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Stage 1: DETERMINISTIC EXTRACTOR (Primary - handles 80% of events)     │
│  ════════════════════════════════════════════════════════════════════   │
│  • Rule-based, schema-driven field extraction                           │
│  • Extracts: filenames, line numbers, commit SHA, repo name,            │
│    release tags, environment, platform                                  │
│  • If all required fields present → STOP HERE (fast path)              │
│                                                                          │
│                              ↓ (if data incomplete)                      │
│                                                                          │
│  Stage 2: LLM ASSIST LAYER (When data missing/malformed)                │
│  ════════════════════════════════════════════════════════════════════   │
│  • Uses GPT-4o-mini (or local model: DeepSeek-R1 7B / Qwen-7B)         │
│  • RESTRICTED SCOPE - LLM can ONLY:                                     │
│    ✔ Identify existing fields in payload                                │
│    ✔ Suggest likely commit/branch when missing                          │
│    ✔ Repair malformed JSON                                              │
│    ✔ Interpret custom Sentry contexts                                   │
│    ✔ Deminify filenames using sourcemaps                                │
│    ✔ Clean path noise (node_modules, polyfills, etc.)                   │
│    ✔ Pick the most likely "true" frame among 20-100 frames              │
│  • LLM CANNOT invent or assume repo/commit                              │
│                                                                          │
│                              ↓ (all outputs)                             │
│                                                                          │
│  Stage 3: VERIFICATION / SANITY CHECKER (Always runs)                   │
│  ════════════════════════════════════════════════════════════════════   │
│  • Deterministic validator confirms:                                    │
│    ✔ Does this repo exist in the org's GitHub?                          │
│    ✔ Does this commit exist?                                            │
│    ✔ Does this filepath exist in the fetched repo tree?                 │
│    ✔ Does this line number exist in the file?                           │
│  • If validation fails → fallback strategies:                           │
│    - Branch inference                                                   │
│    - HEAD fallback                                                      │
│    - Default branch                                                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**What the LLM is Safe For (Stage 2):**

| Task | Why It's Safe |
|------|---------------|
| Cleaning stacktrace noise | Filtering, not creating |
| Grouping user vs library frames | Classification, not invention |
| Detecting missing release config | Identifying gaps, not filling them |
| Determining root crash location | Reordering existing data |
| Bridging ecosystems (JS/Python/Mobile) | Universal interpretation |

**What the LLM Cannot Do:**
- ❌ Invent repository names
- ❌ Create commit SHAs
- ❌ Assume file paths
- ❌ Override Stage 3 verification

**Architecture Benefits:**

| Benefit | Description |
|---------|-------------|
| **Safety** | LLM never invents data, only cleans/interprets |
| **Proof** | Every extraction has audit trail |
| **Reproducibility** | Deterministic stage gives consistent results |
| **Coverage** | Handle malformed events competitors can't |
| **Cross-platform** | React Native, Electron, mobile all work |

**File Structure:**

```
src/services/event-extractor/
├── extraction-pipeline.ts      # Orchestrates 3 stages
├── deterministic-extractor.ts  # Stage 1 - rule-based
├── llm-assist-extractor.ts     # Stage 2 - LLM enhancement
├── extraction-validator.ts     # Stage 3 - GitHub verification
└── prompts/
    └── frame-classifier.txt    # User vs vendor frames

python/extractors/
├── __init__.py
├── llm_assist_extractor.py     # LLM-assisted extraction
└── frame_classifier.py         # Frame classification
```

**Metrics:**

```sql
-- Track extraction stages in cost_metrics
ALTER TABLE cost_metrics ADD COLUMN extraction_stage_1_count INT DEFAULT 0;
ALTER TABLE cost_metrics ADD COLUMN extraction_stage_2_count INT DEFAULT 0;
ALTER TABLE cost_metrics ADD COLUMN extraction_stage_3_failures INT DEFAULT 0;
ALTER TABLE cost_metrics ADD COLUMN extraction_llm_tokens INT DEFAULT 0;
```

**Alert Thresholds:**
- Stage 2 trigger rate > 30% → Customer source map configuration issues
- Stage 3 failure rate > 10% → LLM quality degradation
- Extraction latency P95 > 5s → Performance investigation needed

---

## AI Architecture Table (Enterprise-Safe, Deterministic Core)

**Updated for MVP Scope: JS/TS + Python only, GPT-4o-mini only**

| **Component**                | **Use AI?**            | **Recommended Model (MVP)**      | **Why This Choice**                                                   |
| ---------------------------- | ---------------------- | -------------------------------- | --------------------------------------------------------------------- |
| **Event Extractor**          | **Hybrid (3-stage)**   | Deterministic + GPT-4o-mini assist | Stage 1: rule-based. Stage 2: LLM for cleaning. Stage 3: verification. |
| **Context Fusion Engine**    | **No (MVP)**           | Simple timestamp correlation     | Deterministic only for MVP. Embeddings in Phase 2.                    |
| **Evidence Graph Builder**   | **No (strict)**        | Deterministic graph construction | Graph built from AST, logs, commits. AI never creates edges.          |
| **Deterministic RCA Engine** | **NO (strict)**        | Tree-sitter + rule engine        | 100% rules, AST patterns, static analysis. Core of trust.             |
| **Intent Extractor**         | **Light AI (Phase 2)** | Deferred to Phase 2              | Not needed for MVP. Add in Month 4-6.                                 |
| **LLM Reasoning Layer**      | **Yes**                | **GPT-4o-mini only**             | Produces narratives, explains RCA. Non-authoritative. Cost-effective. |
| **Fix Suggestion Engine**    | **Partial AI**         | GPT-4o-mini + templates          | Templates + deterministic AST patches. AI writes explanations only.   |
| **Confidence Scorer**        | **NO**                 | Deterministic scoring            | Scores based on graph density, rule matches, evidence strength.       |
| **Explainability Store**     | **No**                 | Structured storage               | Stores decisions, prompts, evidence. No AI needed.                    |
| **Investigation UI**         | **No**                 | Pure UI                          | React components. No reasoning needed.                                |

---

## Why This Architecture Works for BOTH AI Code & Human Code

Your product debugs:

-   AI-generated spaghetti code
-   Human-written production systems
-   Mixed pipelines
-   Fast-changing codebases
-   Multi-repo microservices

### **1. Deterministic RCA is your competitive advantage**

AI-generated code has:

-   Inconsistent patterns
-   Common LLM mistakes (unawaited promises, null checks, type errors)
-   Copy-paste anti-patterns

Deterministic RCA catches:

-   Signature bugs (null/undefined access)
-   Concurrency errors
-   Typical LLM mistakes
-   Off-by-one patterns
-   Silent failures

**LLM-only competitors fail here.**

### **2. Evidence Graph is deterministic → no hallucinations**

The graph is built from:

-   AST edges (tree-sitter)
-   Commit diffs (git log)
-   Logs (Sentry breadcrumbs)
-   Stack traces
-   Deployment markers

**AI is only allowed to:**
✔ Add labels
✔ Classify nodes
✘ **NOT** generate new edges
✘ **NOT** infer causal relationships

This keeps the graph **stable, auditable, and correct**.

### **3. Fix engine uses templates, not hallucinations**

You **NEVER** allow the LLM to produce raw code patches.

You use:

-   Historical fix patterns
-   AST-based patches
-   Validated deterministic templates
-   Language-specific rule libraries

**LLM only provides:**

-   English explanation
-   Reasoning summary
-   Context narrative

This avoids "AI debugging AI" failures.

### **4. Reasoning layer cannot override deterministic logic**

**LLM = storyteller, explainer**
**Deterministic = ground truth**

This separation makes the system:

-   Trustworthy
-   Sellable to enterprises
-   Stable across model upgrades
-   Resistant to hallucination drift
-   Audit-compliant

---

## 🧠 One-sentence founder summary

**You get AI where it enhances clarity, but never where it risks correctness — creating a system that is structurally trustworthy, enterprise-safe, and defensible.**

---

## MVP Scope (Phase 1: Weeks 1-6)

### ✅ In Scope

-   **Languages:** JavaScript/TypeScript only
-   **Error Source:** Sentry only
-   **Code Source:** GitHub only
-   **LLM:** GPT-4o-mini only
-   **Delivery:** Slack + basic web UI
-   **Multi-tenancy:** Full support
-   **Caching:** Three-tier GitHub cache
-   **Cost controls:** Per-org rate limits

### ❌ Out of Scope (Phase 2+)

-   Python language support → Week 8
-   Datadog integration → Month 4
-   Local LLM models → Month 5
-   Vector search → Month 5
-   On-prem deployment → Week 11
-   SSO/SCIM → Month 5
-   Auto-PR generation → Month 6+

---

## Client Integration Flow

### How Clients Integrate with Buglens

**Step 1: Sign Up & Create Organization**

```
Client visits app.buglens.com
  ↓
Creates account (email + password or OAuth)
  ↓
Creates organization (gets org_id, API key)
  ↓
Redirected to onboarding flow
```

**Step 2: Connect Sentry (Error Source)**

What's Missing for Production
For a production system, you'd want to add:

Feature	Status	Notes
GitHub App install flow	✅ Works	Auto-creates org + repos
Self-service web signup	❌ Missing	Would need auth (e.g., Auth0, Clerk)
Sentry integration UI	❌ Missing	User needs to manually configure webhook URL
API to list org_id	❌ Missing	Currently requires DB query
Dashboard	❌ Week 6	Web UI planned for Week 6


```
Client navigates to Settings → Integrations → Sentry
  ↓
Enters Sentry organization slug
  ↓
Buglens generates webhook URL:
  https://api.buglens.com/v1/webhooks/sentry?org={org_id}&secret={hmac_secret}
  ↓
Client copies webhook URL
  ↓
Client adds webhook to Sentry project settings:
  - Project → Settings → Webhooks
  - Paste Buglens webhook URL
  - Select event types: "error", "issue"
  - Save
  ↓
Sentry sends test event
  ↓
Buglens receives & validates (HMAC signature)
  ↓
Integration status: ✅ Connected
```

**Step 3: Connect GitHub (Code Source)**

```
Client clicks "Connect GitHub" in Buglens
  ↓
OAuth flow initiated:
  - Redirects to GitHub OAuth consent screen
  - Requests permissions: read:repo (read-only)
  - Client approves for specific repositories
  ↓
GitHub redirects back with auth code
  ↓
Buglens exchanges code for access token
  ↓
Token stored in AWS Secrets Manager (encrypted)
  ↓
Client selects which repos to analyze
  ↓
Buglens verifies access (test API call)
  ↓
Integration status: ✅ Connected
```

**Step 4: Connect Slack (Notification Delivery)**

```
Client clicks "Connect Slack" in Buglens
  ↓
OAuth flow initiated:
  - Redirects to Slack OAuth consent screen
  - Requests permissions: chat:write, chat:write.public
  - Client approves for workspace
  ↓
Slack redirects back with access token
  ↓
Token stored in AWS Secrets Manager
  ↓
Client selects notification channel (#engineering, #alerts, etc.)
  ↓
Buglens sends test message to channel
  ↓
Integration status: ✅ Connected
```

**Step 5: Trigger First Error (Testing)**

```
Client triggers test error in their app
  ↓
Sentry captures error → sends webhook to Buglens
  ↓
Buglens processes (see Data Flow below)
  ↓
Slack notification sent within 30-45 seconds
  ↓
Client clicks "View Details" → opens web UI
  ↓
Setup complete! 🎉
```

---

## Data Flow (After Integration)

```
1. Error occurs in client's application
   ↓
2. Sentry captures error → sends webhook to Buglens
   POST https://api.buglens.com/v1/webhooks/sentry?org={org_id}&secret={hmac}
   Headers: x-sentry-signature (HMAC for validation)
   ↓
3. Fastify API receives webhook
   - Validates HMAC signature (prevent spoofing)
   - Extracts org_id from query params
   - Sets org context for multi-tenancy
   ↓
4. Normalize Sentry payload
   - Extract: error message, type, stack trace, breadcrumbs
   - Parse environment, release, user context
   - Generate event signature (for deduplication)
   ↓
5. Store in events table (with org_id)
   INSERT INTO events (org_id, sentry_event_id, signature, stack_trace, ...)
   ↓
6. Check rate limits
   - Query: events created in last hour for org_id
   - If exceeds plan limit → return 429 (Too Many Requests)
   - If within limit → proceed
   ↓
7. Enqueue RCA job in BullMQ
   queue.add('rca-job', {
     event_id,
     org_id,
     priority: event.environment === 'production' ? 'high' : 'normal'
   })
   ↓
8. Return 200 OK to Sentry (< 1s response time)
   ↓
9. BullMQ worker picks up job (async processing starts)
   ↓
10. Worker fetches code from GitHub (via 3-tier cache)
    - Extract file path + line number from stack trace
    - Check Redis cache (key: org_id:repo:sha:path)
    - If miss → check S3 cache
    - If miss → fetch from GitHub API (store in all caches)
    ↓
11. Resolve source maps (if minified)
    - Fetch .map file from GitHub
    - Map minified location → original source
    ↓
12. Call Python analyzer (deterministic rules)
    spawn('python', ['-m', 'analyzers.js_analyzer'])
    stdin: { code, error_line, error_type }
    stdout: { findings: [...], confidence: 0.85 }
    ↓
13. Collect evidence bundle
    - Code snippet (50 lines before/after)
    - Deterministic findings
    - Timeline (last 10 Sentry breadcrumbs)
    - Recent commits (last 5 touching file)
    - Environment context
    ↓
14. Check LLM token quota
    - Query: tokens used today for org_id
    - If exceeds plan limit → use deterministic-only RCA
    - If within limit → proceed to LLM
    ↓
15. Call Python LLM service (GPT-4o-mini)
    spawn('python', ['-m', 'llm.orchestrator'])
    stdin: { evidence_bundle }
    stdout: { title, summary, root_cause, causal_chain, suggested_fix, confidence }
    ↓
16. Validate LLM response
    - Check JSON schema
    - Verify evidence references exist
    - Apply confidence thresholds
    - Flag for review if confidence < 0.7
    ↓
17. Store RCA result in database
    INSERT INTO rca_results (org_id, event_id, title, root_cause, ...)
    ↓
18. Track costs
    UPDATE cost_metrics SET llm_tokens_used += X, llm_cost_usd += Y
    WHERE org_id = ? AND date = CURRENT_DATE
    ↓
19. Send Slack notification
    - Format RCA as Slack blocks (summary, confidence, actions)
    - POST to Slack webhook
    - Include "View Details" button → links to web UI
    ↓
20. User receives Slack notification (total time: 30-45s from error)
    ↓
21. User clicks "View Details" → opens web UI
    GET https://app.buglens.com/rca/{rca_id}
    - Renders: title, summary, root cause, code viewer, timeline, suggested fix
    - User can mark: "Helpful" / "Not Helpful"
    ↓
22. User feedback stored
    UPDATE rca_results SET user_feedback = 'helpful' WHERE id = ?
```

---

## Integration Requirements (Client Side)

### What Clients Need

**1. Sentry Account**

-   Active Sentry project with error tracking enabled
-   Admin access to add webhooks
-   Project DSN already configured in their app

**2. GitHub Repository**

-   Code hosted on GitHub (public or private)
-   Admin or owner access to install GitHub Apps
-   Repository contains the code that Sentry is tracking

**3. Slack Workspace**

-   Active Slack workspace
-   Permission to add apps to workspace
-   Channel where notifications should be sent

**4. Application Requirements**

-   JavaScript/TypeScript application (MVP)
-   Source maps generated and available (for minified code)
-   Sentry SDK already integrated
-   Errors being captured by Sentry

### What Clients DON'T Need

❌ No code changes required (Buglens is bolt-on)
❌ No SDK to install
❌ No infrastructure to manage
❌ No sensitive data leaves their environment (we only fetch public code)
❌ No persistent storage of source code (cached temporarily)

---

## Security & Privacy (Client Concerns)

### What Buglens Accesses

**From Sentry:**

-   ✅ Error messages and stack traces
-   ✅ Breadcrumbs (user actions leading to error)
-   ✅ Environment context (release, environment name)
-   ❌ **NOT** user PII (automatically redacted)
-   ❌ **NOT** sensitive environment variables

**From GitHub:**

-   ✅ Source code files (read-only, specific files only)
-   ✅ Commit history (last 5 commits per file)
-   ✅ File metadata (language, size)
-   ❌ **NOT** write access (can't modify code)
-   ❌ **NOT** access to issues, PRs, or discussions
-   ❌ **NOT** repository settings

**From Slack:**

-   ✅ Permission to post messages to selected channel
-   ❌ **NOT** read message history
-   ❌ **NOT** access to DMs or private channels (unless explicitly added)

### Data Retention

| Data Type      | Retention | Storage                        |
| -------------- | --------- | ------------------------------ |
| Error events   | 30 days   | PostgreSQL (encrypted at rest) |
| RCA results    | 90 days   | PostgreSQL (encrypted at rest) |
| Code snapshots | 7 days    | S3 (encrypted, gzipped)        |
| Redis cache    | 1 hour    | Redis (ephemeral)              |
| Audit logs     | 1 year    | CloudWatch (enterprise only)   |

### Compliance

-   ✅ **TLS 1.3** for all data in transit
-   ✅ **Encryption at rest** (RDS, S3)
-   ✅ **PII auto-redaction** in logs
-   ✅ **HMAC validation** prevents webhook spoofing
-   ✅ **Read-only GitHub access** (can't modify code)
-   ✅ **Row-level security** (multi-tenant isolation)
-   ✅ **SOC2 prep** (Week 11)
-   ✅ **Self-hosted option** (Week 11 - for enterprise)

---

## Troubleshooting Integration

### Common Issues

**1. Sentry webhook not working**

```
Symptoms: Errors in Sentry, but no RCAs in Buglens
Causes:
  - Wrong webhook URL (check org_id and secret)
  - HMAC signature mismatch (regenerate secret)
  - Network firewall blocking outbound webhooks
  - Event types not selected (must include "error")

Solution:
  - Go to Settings → Integrations → Sentry
  - Click "Test Connection"
  - Check Sentry webhook logs for delivery status
```

**2. GitHub integration failing**

```
Symptoms: "Unable to fetch code" in RCA
Causes:
  - Repository not selected in Buglens settings
  - GitHub App uninstalled or revoked
  - File path in stack trace doesn't match repo structure
  - Private repo requires GitHub App installation

Solution:
  - Verify repo is listed in Settings → Integrations → GitHub
  - Re-authenticate GitHub if needed
  - Check stack trace file paths match repo structure
```

**3. Slack notifications not appearing**

```
Symptoms: RCA completed, but no Slack message
Causes:
  - Slack App removed from workspace
  - Channel deleted or Buglens removed from channel
  - Slack rate limit hit (>1 msg/second)

Solution:
  - Re-connect Slack integration
  - Verify Buglens is in the selected channel
  - Check Slack App permissions
```

**4. Source maps not resolving**

```
Symptoms: RCA shows minified code instead of original
Causes:
  - Source maps not uploaded to same location as code
  - Wrong sourceMappingURL in minified file
  - Source maps not accessible (404)

Solution:
  - Ensure .map files are in same directory as .js files
  - Verify source maps are committed to GitHub
  - Check webpack/vite config generates correct sourceMappingURL
```

---

## Security & Compliance

### Security Controls (Week 1)

-   ✅ Multi-tenancy with row-level security
-   ✅ HMAC signature validation (webhooks)
-   ✅ JWT authentication (API)
-   ✅ Secrets in AWS Secrets Manager
-   ✅ GitHub tokens: read-only scope
-   ✅ Rate limiting per org
-   ✅ PII redaction in logs

### Compliance (Week 11)

-   Audit logging for all data access
-   Encryption at rest (RDS, S3)
-   Encryption in transit (TLS 1.3)
-   SOC2 preparation documentation
-   Self-hosted option (basic)

---

## Cost Model (MVP)

### Infrastructure (per month)

-   ECS Fargate: ~$100
-   RDS Postgres: ~$50
-   Redis: ~$30
-   S3: ~$20
-   CloudWatch: ~$20
-   **Subtotal: ~$220/month**

### Variable Costs

-   LLM (GPT-4o-mini): ~$0.10-$0.15 per 1000 tokens
-   Average RCA: ~1500 tokens = $0.15-$0.20
-   **Target cost per RCA: <$0.15**

### Optimization Strategies

1. Cache duplicate event signatures (avoid re-processing)
2. Aggressive GitHub caching (reduce API calls)
3. Token limit per job (max 2000 tokens)
4. Fallback to smaller context for low-priority errors
5. Rate limits prevent runaway costs

---

## Monitoring & SLOs

### Key Metrics

-   **Job success rate:** > 90%
-   **P95 latency:** < 45s (webhook → Slack)
-   **Cache hit rate:** > 75%
-   **RCA accuracy:** > 70% (on synthetic dataset)
-   **User satisfaction:** > 60% "helpful" feedback

### Alerts

-   Job failure rate > 10% for 5+ minutes
-   Average latency > 60s
-   LLM cost > $50/hour
-   GitHub rate limit hit
-   Database connection errors

---

## Team Requirements

**MVP Team (Weeks 1-12):**

-   1 Full-stack Engineer (TypeScript/React)
-   1 Backend/ML Engineer (Python/LLM)
-   0.5 DevOps/SRE (Infrastructure)

**Total: 2.5 engineers for 12 weeks**

---

## Migration Path (Post-MVP)

### Month 4-6: Optimization

-   Add Python language support
-   Implement local LLM option (cost reduction)
-   Advanced caching (vector embeddings)
-   Datadog integration

### Month 7-9: Enterprise

-   SSO/SCIM
-   On-prem deployment (full)
-   Advanced RBAC
-   SLA guarantees

### Month 10-12: Expansion

-   More languages (Java, Go, Ruby)
-   Auto-PR generation (experimental)
-   Advanced analytics
-   API for third-party integrations

---

## Key Design Principles

1. **Deterministic First:** Never let AI make causal claims without evidence
2. **Multi-tenant Always:** Every table has org_id from Day 1
3. **Cost Conscious:** Rate limits and caching from Week 1
4. **Security by Default:** Least privilege, encryption, audit logs
5. **Simple First:** Monolith before microservices
6. **Measure Everything:** Synthetic dataset and continuous eval

---

This architecture is **battle-tested, cost-effective, and enterprise-ready** while remaining simple enough to ship in 12 weeks.
