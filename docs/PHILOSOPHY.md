# Buglens Design Philosophy

> The principles that guide every architectural and implementation decision in Buglens.

**Last Updated:** December 2025

---

## Executive Summary

Buglens is built on a single foundational insight: **LLM-powered debugging tools fail because they let AI make causal claims without evidence.** Our competitive moat is the opposite approach: deterministic analysis produces the ground truth, and AI only explains it.

---

## 🎯 The Deterministic-First Principle

> **80% of RCA quality comes from deterministic analysis. 20% comes from LLM enhancement.**

### The Two-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Layer 1: DETERMINISTIC                       │
│                    (Ground Truth - 80%)                         │
│                                                                 │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐    │
│   │ AST Analysis │  │Pattern Match│  │ Stack Trace Mapping │    │
│   └─────────────┘  └─────────────┘  └─────────────────────┘    │
│                           │                                     │
│                           ▼                                     │
│              ┌─────────────────────────┐                       │
│              │    Evidence Graph        │                       │
│              │  (Nodes + Edges = FACTS) │                       │
│              └─────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Layer 2: LLM                                 │
│                    (Enhancement - 20%)                          │
│                                                                 │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐    │
│   │ Narratives  │  │ Explanations│  │ Contextualization   │    │
│   └─────────────┘  └─────────────┘  └─────────────────────┘    │
│                                                                 │
│              "Here's WHY the deterministic                     │
│               findings matter to YOU"                          │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Matters

**The Problem with LLM-First Approaches:**

- AI-generated code is inconsistent and pattern-based
- LLMs hallucinate causal relationships that don't exist
- Confidence scores from LLMs are unreliable
- Model updates can cause regression in RCA quality
- Enterprises don't trust "black box" debugging

**The Buglens Solution:**

- Deterministic RCA catches signature bugs reliably
- Evidence Graph has no hallucinated connections
- Every claim can be traced to actual code/logs
- System is stable across model upgrades
- Fully auditable for enterprise compliance

---

## 🔗 The Evidence Graph Concept

> **The Evidence Graph is built from facts, not inferences.**

### What Goes IN the Graph

| Source       | Example                             | Status           |
| ------------ | ----------------------------------- | ---------------- |
| AST edges    | Function calls, variable references | ✅ Deterministic |
| Commit diffs | Lines changed, files modified       | ✅ Deterministic |
| Log entries  | Timestamps, error messages, levels  | ✅ Deterministic |
| Traces/spans | Service calls, latency data         | ✅ Deterministic |
| Stack traces | Call hierarchy, line numbers        | ✅ Deterministic |
| Dependencies | Import graphs, package versions     | ✅ Deterministic |

### What AI Can Do

| Action                | Allowed? | Why                                    |
| --------------------- | -------- | -------------------------------------- |
| Add labels to nodes   | ✅ Yes   | Classification doesn't create facts    |
| Generate explanations | ✅ Yes   | Narratives help humans understand      |
| Summarize findings    | ✅ Yes   | Synthesis of existing evidence         |
| **Create new edges**  | ❌ No    | Would hallucinate causal relationships |
| **Infer root causes** | ❌ No    | Must come from deterministic rules     |
| **Generate fix code** | ❌ No    | Uses templates, not LLM generation     |

---

## ⚖️ The Trust Hierarchy

> **When deterministic and LLM outputs conflict, deterministic ALWAYS wins.**

```
                    HIGHEST TRUST
                         ▲
                         │
         ┌───────────────┴───────────────┐
         │   Deterministic Findings      │
         │   (AST patterns, rule matches)│
         └───────────────┬───────────────┘
                         │
         ┌───────────────┴───────────────┐
         │   Evidence Graph Data         │
         │   (Logs, traces, commits)     │
         └───────────────┬───────────────┘
                         │
         ┌───────────────┴───────────────┐
         │   LLM Confidence Scores       │
         │   (Used for prioritization)   │
         └───────────────┬───────────────┘
                         │
         ┌───────────────┴───────────────┐
         │   LLM Explanations            │
         │   (Narratives, not verdicts)  │
         └───────────────────────────────┘
                         │
                         ▼
                    LOWEST TRUST
```

### In Practice

1. **RCA Engine finds a null-pointer pattern** → This is the root cause
2. **LLM generates an explanation** → "The user object was undefined because..."
3. **If LLM contradicts RCA Engine** → Ignore LLM, trust deterministic finding
4. **If LLM provides additional context** → Include as supplementary information

---

## 🛡️ Enterprise-Safe Design

> **Every architectural decision prioritizes auditability and reliability.**

### Component Decisions

| Component                | Use AI? | Rationale                                             |
| ------------------------ | ------- | ----------------------------------------------------- |
| Deterministic RCA Engine | ❌ No   | Core moat. 100% rules, AST patterns, static analysis  |
| Evidence Graph Builder   | Partial | Graph construction is deterministic. AI only labels.  |
| Confidence Scorer        | ❌ No   | Based on rule matches, graph density. No LLM scores.  |
| Fix Suggestion Engine    | Partial | Templates + AST patches. AI writes explanations only. |
| LLM Reasoning Layer      | ✅ Yes  | Narratives, summaries. Non-authoritative.             |
| Intent Extractor         | ✅ Yes  | Infer intent from comments/names. Safe, lightweight.  |

### Why Enterprises Trust This

1. **Auditable:** Every RCA can be traced to specific evidence
2. **Stable:** Model updates don't change core analysis
3. **Compliant:** No "AI made this decision" black boxes
4. **Defensible:** Can explain exactly why each finding was produced

---

## 🔧 Fix Suggestion Philosophy

> **AI never writes code. It only explains fixes.**

### The Fix Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Pattern Detection (Deterministic)                        │
│    "Found null-pointer access pattern at line 42"           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Template Selection (Deterministic)                       │
│    "Selecting 'add-null-check' template for JavaScript"     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. AST Patch Generation (Deterministic)                     │
│    "Generating if (!user) return null; at correct location" │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Explanation Generation (LLM)                             │
│    "Add a null check because database.find() can return     │
│     undefined when no record matches the query..."          │
└─────────────────────────────────────────────────────────────┘
```

### Why This Works

- **Historical patterns:** We learn from millions of actual fixes
- **Language-specific rules:** Templates respect language idioms
- **No hallucination:** LLM can't invent incorrect patches
- **Works for AI code:** Catches systematic LLM coding mistakes

---

## 📊 Confidence Scoring

> **Confidence comes from evidence density, not LLM assertions.**

### Confidence Factors

| Factor                   | Weight | Source        |
| ------------------------ | ------ | ------------- |
| Rule match strength      | 40%    | Deterministic |
| Evidence graph density   | 25%    | Deterministic |
| Historical pattern match | 20%    | Deterministic |
| Code context coverage    | 15%    | Deterministic |
| LLM confidence           | 0%     | Not used      |

### Why We Don't Use LLM Confidence

LLM confidence scores are:

- Inconsistent across runs
- Not calibrated to actual accuracy
- Prone to overconfidence on hallucinations
- Model-dependent (changes with updates)

---

## 🌟 The Buglens Advantage

### What We Do Better Than LLM-First Competitors

| Scenario                      | LLM-First Tools        | Buglens                      |
| ----------------------------- | ---------------------- | ---------------------------- |
| AI-generated spaghetti code   | Hallucinate causes     | Catch signature bugs         |
| Fast-changing codebases       | Outdated training data | Real-time AST analysis       |
| Multi-repo microservices      | Lose context           | Evidence graph connects dots |
| Enterprise audit requirements | Black box              | Full traceability            |
| Model version upgrades        | RCA quality changes    | Core analysis unchanged      |

### One-Sentence Summary

**Buglens gets AI where it enhances clarity, but never where it risks correctness — creating a system that is structurally trustworthy, enterprise-safe, and defensible.**

---

## 📚 Related Documentation

- [Architecture Overview](./Buglens%20Architecture%20UPDATED.md) - Full system design
- [LLM Architecture](./buglens%20llm%20architecture%20UPDATED.md) - LLM strategy details
- [Extraction Pipeline](./technical/02-extraction-pipeline.md) - 3-stage evidence collection

---

_This philosophy document consolidates principles from multiple architectural documents. It serves as the single source of truth for Buglens design decisions._
