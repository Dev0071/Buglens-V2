# Buglens Documentation

> AI-powered Root Cause Analysis copilot for production incidents.

**Last Updated:** December 2025

---

## 📋 Quick Navigation

| I want to...                 | Read this                                                               |
| ---------------------------- | ----------------------------------------------------------------------- |
| Get started developing       | [Quick Start Guide](./QUICKSTART.md)                                    |
| Understand the architecture  | [Architecture Overview](./Buglens%20Architecture%20UPDATED.md)          |
| Learn the core philosophy    | [Design Philosophy](./PHILOSOPHY.md)                                    |
| See the development roadmap  | [Phase 1 Roadmap](<./Buglens%20Roadmap%20Phase%201%20(Week%201-6).md>)  |
| Build dashboard features     | [Dashboard Features](./WEEK6_DASHBOARD_FEATURES.md)                     |
| Integrate with Sentry/GitHub | [Technical: API Layer](./technical/01-api-layer.md)                     |
| Understand the data pipeline | [Technical: Extraction Pipeline](./technical/02-extraction-pipeline.md) |
| Run tests                    | [Testing Guide](./TESTING_GUIDE.md)                                     |

---

## 📚 Documentation Categories

### 🏗️ Architecture & Design

Core architectural decisions and system design.

| Document                                                        | Description                                          | Audience         |
| --------------------------------------------------------------- | ---------------------------------------------------- | ---------------- |
| [Architecture Overview](./Buglens%20Architecture%20UPDATED.md)  | Complete system architecture, data flow              | All Engineers    |
| [Design Philosophy](./PHILOSOPHY.md)                            | Core principles: Deterministic-First, Evidence Graph | All Engineers    |
| [LLM Architecture](./buglens%20llm%20architecture%20UPDATED.md) | GPT-4o-mini strategy, prompts, costs                 | ML/LLM Engineers |
| [Product Requirements](./buglens_prd.md)                        | PRD, success metrics, user stories                   | Product Team     |

### 📅 Roadmaps & Planning

Development timeline and feature planning.

| Document                                                                | Description                      | Audience         |
| ----------------------------------------------------------------------- | -------------------------------- | ---------------- |
| [Phase 1 Roadmap](<./Buglens%20Roadmap%20Phase%201%20(Week%201-6).md>)  | Weeks 1-6: MVP development       | Engineering Team |
| [Phase 2 Roadmap](<./Buglens%20Roadmap%20Phase%202%20(Week%207-12).md>) | Weeks 7-12: Production hardening | Engineering Team |
| [Progress Tracker](./PROGRESS.md)                                       | Current implementation status    | Project Manager  |

### 🔧 Technical Documentation

Deep-dive into each system component.

| Document                                                     | Description                     | Audience          |
| ------------------------------------------------------------ | ------------------------------- | ----------------- |
| [Technical Index](./technical/README.md)                     | Index of all technical docs     | All Engineers     |
| [API Layer](./technical/01-api-layer.md)                     | Fastify API, middleware, routes | Backend Engineers |
| [Extraction Pipeline](./technical/02-extraction-pipeline.md) | 3-stage extraction system       | Core Engineers    |
| [Code Fetcher](./technical/03-code-fetcher.md)               | GitHub caching strategy         | Core Engineers    |
| [Python Analysis](./technical/05-python-analysis.md)         | AST analysis with tree-sitter   | Python Engineers  |
| [Workers & Queues](./technical/07-workers-queues.md)         | BullMQ job processing           | Backend Engineers |
| [Database](./technical/08-database.md)                       | PostgreSQL, RLS, migrations     | Backend Engineers |

### 🖥️ Dashboard & UI

Frontend specifications and implementation guides.

| Document                                                         | Description              | Audience           |
| ---------------------------------------------------------------- | ------------------------ | ------------------ |
| [Dashboard Features Part 1](./WEEK6_DASHBOARD_FEATURES.md)       | Core dashboard specs     | Frontend Engineers |
| [Dashboard Features Part 2](./WEEK6_DASHBOARD_FEATURES_PART2.md) | Advanced dashboard specs | Frontend Engineers |

### 🧪 Testing & Quality

Testing strategies and guides.

| Document                                    | Description                  | Audience     |
| ------------------------------------------- | ---------------------------- | ------------ |
| [Testing Guide](./TESTING_GUIDE.md)         | Manual testing instructions  | QA/Engineers |
| [E2E Testing Guide](./E2E_TESTING_GUIDE.md) | End-to-end testing scenarios | QA/Engineers |

### 📊 Business & Strategy

Market analysis and competitive positioning.

| Document                                          | Description                         | Audience           |
| ------------------------------------------------- | ----------------------------------- | ------------------ |
| [Competitive Strategy](./COMPETITIVE_STRATEGY.md) | Sentry Seer comparison, positioning | Founders/Sales     |
| [Market Analysis](./MARKET_ANALYSIS_REPORT.md)    | Market size, competitors, gaps      | Founders/Investors |
| [Founders Note](./Founders%20note.md)             | Critical cost/scale insights        | Founders           |

### 📝 Meta & Operational

Documentation maintenance and updates.

| Document                                                    | Description                    | Audience      |
| ----------------------------------------------------------- | ------------------------------ | ------------- |
| [Quick Start Guide](./QUICKSTART.md)                        | Development setup instructions | New Engineers |
| [Documentation Updates](./DOCUMENTATION_UPDATES_SUMMARY.md) | Changelog of doc updates       | Maintainers   |
| [Weekly Audit - Week 2](./Weekly_Audit_Week02.md)           | Code review for week 2         | Tech Leads    |

---

## 🏛️ Core Principles

Before diving into implementation, understand these foundational principles:

### 1. Deterministic-First

> **80% of RCA quality comes from deterministic analysis, 20% from LLM.**

The system has two layers:

- **Layer 1 (Deterministic):** AST analysis, pattern matching, stack trace mapping
- **Layer 2 (LLM):** Narrative generation, explanation, contextualization

**Why:** LLM competitors fail on AI-generated code because they hallucinate. Our competitive moat is deterministic analysis that catches signature bugs, then LLM explains them clearly.

### 2. Multi-Tenancy from Day 1

Every table has `org_id`. Row-level security enabled. No exceptions.

### 3. Cost Controls Always

Rate limits per organization. Token tracking. Three-tier caching (Redis → S3 → API).

### 4. Evidence-Based Claims

Never let LLM make unsupported assertions. Every claim must reference actual code/logs.

---

## 🚀 Getting Started

1. **New to Buglens?** Start with the [Quick Start Guide](./QUICKSTART.md)
2. **Building a feature?** Check the relevant [Technical Doc](./technical/README.md)
3. **Understanding architecture?** Read [Architecture Overview](./Buglens%20Architecture%20UPDATED.md)
4. **Writing tests?** Follow the [Testing Guide](./TESTING_GUIDE.md)

---

## 🤖 AI Agent Instructions

For AI-assisted development, see the [Copilot Instructions](../.github/copilot-instructions.md).

---

## 📞 Support

- **Technical Questions:** Check the technical docs first, then ask the team
- **Bug Reports:** Create GitHub issues with reproduction steps
- **Feature Requests:** Discuss in team channels before implementation

---

_This documentation index was last audited on December 2025._
