# Buglens

AI-powered Root Cause Analysis copilot for production incidents.

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.11+
- PostgreSQL 15+
- Redis 7+
- AWS account (for production)

### Development Setup

1. **Install Node dependencies:**

```bash
npm install
```

2. **Setup Python environment:**

```bash
cd python
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
```

3. **Configure environment:**

```bash
cp .env.example .env
# Edit .env with your credentials
```

4. **Run database migrations:**

```bash
npm run migrate:up
```

5. **Start development server:**

```bash
npm run dev
```

### Project Structure

```
buglens/
├── src/                  # Node.js/TypeScript backend
│   ├── api/             # Fastify API routes
│   ├── workers/         # BullMQ job processors
│   ├── services/        # Business logic
│   ├── db/              # Database models & migrations
│   ├── types/           # TypeScript type definitions
│   └── utils/           # Shared utilities
├── python/              # Python workers
│   ├── analyzers/       # AST analysis & deterministic rules
│   ├── llm/             # GPT-4o-mini orchestration
│   ├── timeline/        # Log reconstruction
│   └── utils/           # Python utilities
├── web/                 # React frontend
├── tests/               # Test suites
├── terraform/           # Infrastructure as code
└── scripts/             # Build & deployment scripts
```

### Architecture

**Modular Monolith** - Single Node.js application with embedded Python workers.

- **API Server:** Fastify + TypeScript
- **Queue:** BullMQ + Redis
- **Database:** PostgreSQL 15 with row-level security
- **Cache:** Three-tier (Redis → S3 → Database)
- **LLM:** GPT-4o-mini (no local models for MVP)
- **Python Integration:** child_process with stdin/stdout JSON

### Key Principles

1. **Deterministic-First:** 80% quality from AST/pattern matching, 20% from LLM
2. **Multi-Tenancy:** Every table has `org_id`, row-level security enabled
3. **Cost Controls:** Rate limits per org, token tracking, three-tier caching
4. **Evidence-Based:** Never let LLM make unsupported claims

### Development Workflow

When implementing features, always:

1. Define the **Schema** (Database & Zod)
2. Define the **Interface** (Types)
3. Write the **Test Case** (Vitest for TS, Pytest for Python)
4. Implement the **Logic**

### Scripts

```bash
npm run dev          # Start development server
npm run build        # Build TypeScript
npm run test         # Run tests
npm run lint         # Lint code
npm run format       # Format code
npm run migrate:up   # Apply database migrations
npm run worker       # Start BullMQ worker
```

### Testing

```bash
# TypeScript tests
npm test

# Python tests
cd python
pytest
```

Load testing scenarios using `k6` live in `scripts/k6/` (see the README in that directory). Run them against a local stack to validate rate-limiting behaviour before large refactors.

### Continuous Integration

Buglens uses a GitHub Actions pipeline defined in `.github/workflows/ci.yml`. The workflow provisions PostgreSQL and Redis services, applies migrations, and enforces linting/type-checking/testing for both TypeScript and Python workspaces.

**Required CI Secrets / Environment Variables**

| Variable                | Purpose                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | Connection string to ephemeral Postgres service (set to `postgresql://postgres:postgres@localhost:5432/buglens_test` in CI). |
| `REDIS_URL`             | Redis connection used by rate limits (`redis://localhost:6379`).                                                             |
| `S3_BUCKET_NAME`        | Temporary name for artifact bucket (CI uses `buglens-ci-artifacts`).                                                         |
| `JWT_SECRET`            | Symmetric key required for Fastify JWT plugin during tests.                                                                  |
| `SENTRY_WEBHOOK_SECRET` | Shared secret for signed Sentry webhook tests.                                                                               |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for GitHub webhook HMAC tests.                                                                                 |

**Local Stack Expectations**

- The workflow spins up Docker services for PostgreSQL 15 and Redis 7; ensure matching versions locally (`docker-compose up postgres redis`).
- Database migrations run via `npm run migrate:up`; migrations must be idempotent and self-contained.
- Redis-backed rate limiting is exercised in integration tests—flush keys between local test runs if you exceed quotas.
- Python checks (`black`, `mypy`, `pytest`) execute after Node tests; keep `requirements.txt` and `requirements-dev.txt` synchronized with runtime needs.

To replicate the CI locally:

```bash
# Start dependencies with docker-compose
docker-compose up -d postgres redis

# Apply migrations and run quality gates
npm run migrate:up
npm run lint
npx tsc --noEmit
npm test -- --run

# Python quality gates
cd python
black --check .
mypy .
pytest
```

### Documentation

- [Architecture](./Buglens%20Architecture%20UPDATED.md)
- [Phase 1 Roadmap (Weeks 1-6)](<./Buglens%20Roadmap%20Phase%201%20(Week%201-6).md>)
- [Phase 2 Roadmap (Weeks 7-12)](<./Buglens%20Roadmap%20Phase%202%20(Week%207-12).md>)
- [LLM Architecture](./buglens%20llm%20architecture%20UPDATED.md)
- [Product Requirements](./buglens_prd.md)
- [AI Agent Instructions](./.github/copilot-instructions.md)

## License

Proprietary - All rights reserved
