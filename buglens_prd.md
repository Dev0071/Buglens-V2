# BugLens PRD (Product Requirements Document)

## 1. Product Overview

BugLens is an AI-powered investigation copilot for production incidents. Instead of requiring developers to manually pivot between Sentry, GitHub, logs, and dashboards, BugLens automatically aggregates all relevant context, analyzes the evidence with deterministic rules + AI reasoning, and generates a concise investigation summary plus a justified suggested fix.

**MVP Scope (Phase 1):**

-   **Languages:** JavaScript/TypeScript only
-   **Error Source:** Sentry only
-   **Code Source:** GitHub only
-   **LLM:** GPT-4o-mini (cost-effective, fast)
-   **Delivery:** Slack + web UI

The product does **not** automatically push fixes; it provides a reasoned, auditable, evidence-backed recommended fix and explanation.

**Post-MVP Expansion:** Python support, Datadog integration, local LLMs, and more languages (Java, Go, Ruby).

## 2. Problem Statement

Modern production debugging requires switching across 6–12 tools, fragmenting mental context and elongating MTTR. Error messages provide surface symptoms, but identifying underlying root cause requires:

-   searching logs
-   correlating traces
-   reviewing recent code changes
-   understanding impacted traffic patterns
-   checking CI/CD and deployments
-   cross-referencing service owners and on-call metadata

Developers lose significant time and accuracy due to cognitive overhead, fragmented data, and lack of contextual synthesis.

## 3. Target Users

### Primary ICP

-   Backend & platform engineers in mid‑to‑large engineering teams (25+ engineers)
-   DevOps/SRE teams responsible for incident management
-   On-call engineers during live production issues

### Secondary ICP

-   Staff engineers or engineering managers overseeing distributed systems
-   AI-native engineering orgs using Copilot, Codeium, or similar tools

## 4. Product Goals

### Core Goals

1. Reduce time spent gathering context during incidents.
2. Reduce context-switching from 10+ tools to a single investigation panel.
3. Provide trustworthy, evidence-backed fix suggestions.
4. Provide accurate summaries that compress logs, stack traces, traces, and diffs.

### Secondary Goals

-   Improve on-call confidence.
-   Serve as a knowledge-retention layer across incidents.
-   Support AI-native debugging workflows.

## 5. Key Features

### 5.1 Data Ingestion Layer

**MVP (Phase 1):**

-   Sentry webhook integration (HMAC validated)
-   GitHub OAuth App (read-only `contents` scope)
-   Multi-tenant isolation (every event tagged with org_id)

**Phase 2:**

-   Datadog integration
-   Custom SDK for logs/telemetry
-   Additional error tracking platforms

### 5.2 Context Fusion Engine

**MVP (Phase 1 - Deterministic Only):**

-   Time-based correlation of Sentry breadcrumbs
-   Recent commits touching affected files (last 5)
-   Stack trace mapping to source code (with source map support)
-   Environment context (release, user agent, etc.)

**Phase 2:**

-   Embedding-based similarity clustering
-   Deployment timeline correlation
-   Test failure integration
-   Advanced anomaly detection

### 5.3 Investigation Pipeline

**Two-Layer Approach:**

**Layer 1: Deterministic Analysis (Core)**

-   AST-based code analysis (tree-sitter for JS/TS)
-   Pattern matching for common errors:
    -   Null/undefined access
    -   Unawaited promises
    -   Array out of bounds
    -   Type mismatches
    -   Missing error handlers
-   Stack trace to source line mapping
-   Timeline reconstruction from breadcrumbs

**Layer 2: LLM Reasoning (Augmentation)**

-   GPT-4o-mini analyzes evidence from Layer 1
-   Generates human-readable explanation
-   Suggests fix with rationale
-   Provides confidence score
-   **Critical:** LLM never overrides deterministic findings

### 5.4 LLM Reasoning Layer

**Model:** GPT-4o-mini only (MVP)

**Responsibilities:**

-   Synthesizes deterministic findings into narrative
-   Explains root cause in developer-friendly language
-   Justifies suggested fix with evidence references
-   Highlights uncertainty when evidence is weak
-   Provides alternative hypotheses when applicable

**Constraints:**

-   Temperature: 0.1 (low for consistency)
-   Max tokens: 2000 per RCA
-   Response format: Structured JSON (validated schema)
-   Evidence requirement: Every claim must reference code/log/commit
-   Cost tracking: Per-org token usage limits

**Future (Phase 2):**

-   Local LLM option (Llama 3.1 70B)
-   Fine-tuned models on reviewed RCAs

### 5.5 UI: Unified Investigation Panel

-   Summary panel (root cause hypothesis + rationale).
-   Code context view (diffs, blame, related files).
-   Evidence browser (logs, traces, alerts, commits).
-   Suggested fix section with justification + risk profile.

### 5.6 AI Future-Ready Modules

-   AI-generated code context maps (dependencies + call paths).
-   Safety filters to flag hallucination risks.
-   "Model Uncertainty Gauge" for fix suggestions.
-   Role-based trust guardrails.

## 6. Non-Goals

-   No auto-fixing production code.
-   No CI/CD deployments.
-   Not a replacement for observability platforms.
-   Not a code-generation platform.

## 7. Requirements

### Functional Requirements

1. Pull incident event data from integrations.
2. Link incident to relevant commits automatically.
3. Ingest logs + traces for targeted time windows.
4. Generate an investigation summary.
5. Provide justified fix suggestions.
6. Allow developers to view supporting evidence.
7. Allow developers to dismiss or refine suggestions.
8. Strict audit logging.

### Non-Functional Requirements

**Performance:**

-   Webhook ingestion: <1s response time
-   End-to-end RCA: <45s P95 (webhook → Slack notification)
-   GitHub cache hit rate: >75%

**Cost Controls:**

-   Per-org rate limits (events/hour, LLM tokens/day)
-   GitHub API call quotas
-   Automatic cost tracking and alerting
-   Target: <$0.15 per RCA (all-in)

**Multi-Tenancy:**

-   Complete org isolation (row-level security)
-   Per-org secret management
-   Tenant-specific rate limits

**Security:**

-   TLS 1.3 everywhere
-   Secrets in AWS Secrets Manager
-   GitHub tokens: read-only scope only
-   PII auto-redaction in logs
-   Audit logging for all data access
-   SOC2-ready architecture

**Reliability:**

-   Job success rate: >90%
-   Deterministic failure modes
-   Retry logic with exponential backoff
-   Dead letter queue for failed jobs

## 8. Success Metrics

### Primary Metrics

-   **MTTR reduction:** 30%+ decrease in time to identify root cause
-   **RCA accuracy:** >70% on synthetic test dataset
-   **User satisfaction:** >60% "helpful" feedback rate
-   **Time saved:** Average 15+ minutes per investigation

### Quality Metrics

-   **Confidence calibration:** High-confidence RCAs (>0.8) are correct >85% of time
-   **False positive rate:** <15%
-   **Hallucination rate:** <5% (claims without evidence)

### Cost Metrics

-   **Cost per RCA:** <$0.15 (LLM + infrastructure)
-   **Cache efficiency:** >75% GitHub cache hit rate
-   **Token efficiency:** <1500 tokens average per RCA

### Operational Metrics

-   **Job success rate:** >90%
-   **P95 latency:** <45s (webhook → notification)
-   **Uptime:** >99%

### Adoption Metrics

-   **Active organizations:** Track weekly/monthly active orgs
-   **RCA views:** Track how many RCAs are opened in UI
-   **Slack engagement:** Click-through rate on notifications

## 9. Competitive Landscape

-   Sentry Seer
-   Datadog Bits AI
-   Honeycomb Query Assistant
-   GitHub Copilot for Pull Requests
-   FireHydrant + incident tooling

BugLens differentiates by being **cross-system**, **context-first**, and **fix-justification oriented** rather than surface-level summarization.

## 10. Risks & Mitigations

### Risk: Developers don’t trust AI outputs

Mitigation: Evidence-backed justification + uncertainty highlighting.

### Risk: Integration friction

Mitigation: OAuth integrations + minimal required scopes.

### Risk: LLM hallucinations

Mitigation: deterministic context, retrieval pipelines, and guardrails.

### Risk: Competition from Sentry & Datadog AI

Mitigation: Multi-source fusion + cross-tool workflows.

## 11. Release Plan (Revised)

### **Phase 1: MVP (Weeks 1-6)**

-   Sentry + GitHub integration
-   JavaScript/TypeScript support only
-   GPT-4o-mini reasoning
-   Slack + web UI delivery
-   Multi-tenancy from Day 1
-   Three-tier GitHub caching
-   Cost controls and rate limiting

### **Phase 2: Production Hardening (Weeks 7-12)**

-   Synthetic evaluation suite
-   Python language support
-   Monitoring and alerting
-   Human-in-the-loop review system
-   Enterprise security hardening
-   Self-hosted agent (basic)
-   SOC2 prep documentation

### **Phase 3: Growth & Optimization (Months 4-6)**

-   Datadog integration
-   Local LLM option (cost optimization)
-   Advanced caching strategies
-   More language support

### **Phase 4: Enterprise & Expansion (Months 7-12)**

-   SSO/SCIM integration
-   Advanced RBAC
-   Auto-PR generation (experimental)
-   API for third-party integrations
-   SLA guarantees

## 12. Open Questions

-   Should BugLens store any source code snapshots? If yes, how do we scope risk?
-   Should teams be able to customize the LLM’s reasoning style (brief, verbose, ultra‑technical)?
-   Should developers upvote/approve fix suggestions to train org‑specific accuracy?
-   How deeply do we integrate CI/CD as a secondary data source?
