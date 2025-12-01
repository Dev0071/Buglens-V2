# Week 2 Technical Audit & Remediation Tracker

> **Scope:** Fastify API + GitHub onboarding + cache tiering. Implementation delivered through Week 2 roadmap. Findings captured during weekly review (2025-12-01).

---

## 1. Findings & Risk Assessment

| ID           | Severity | Area                | Finding                                                                                                                                                         | Impact                                                      | Owner    | Status  |
| ------------ | -------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------- | ------- |
| F-2025-02-01 | Critical | Multi-tenancy / RLS | `orgContextMiddleware` is never mounted, so `SET LOCAL app.current_org_id` is never executed. RLS policies fall back to table owner, breaking tenant isolation. | Data isolation breach; DB queries run outside tenant scope. | Backend  | ✅ Done |
| F-2025-02-02 | High     | GitHub Webhooks     | HMAC verification recomputes digest from `JSON.stringify(body)` instead of raw payload. Any canonicalization change breaks validation.                          | Webhook spoofing risk; false negatives.                     | Backend  | ✅ Done |
| F-2025-02-03 | High     | Cost Controls       | Rate-limit middleware not wired; GitHub/LLM calls skip per-plan quota checks.                                                                                   | Cost spikes; plan promises unenforced.                      | Platform | ✅ Done |
| F-2025-02-04 | Medium   | Fastify Rate Limit  | `@fastify/rate-limit` running in-memory (`redis: undefined`). No cross-instance throttling.                                                                     | Protection bypass in prod multi-instance.                   | Backend  | ✅ Done |
| F-2025-02-05 | Medium   | GitHub Repo Sync    | `registerRepositories` issues sequential `INSERT` per repo. Large org installs hammer DB.                                                                       | Slow onboarding; lock contention.                           | Backend  | ✅ Done |
| F-2025-02-06 | Low      | Tooling             | Missing automated lint/tsc/test in CI. Manual only.                                                                                                             | Regressions slip.                                           | DevEx    | ✅ Done |

---

## 2. Remediation Plan

### 2.1 Multi-Tenancy Context (F-2025-02-01)

- [x] Mount `setupOrgDecorators(server)` and `orgContextMiddleware` in `src/api/app.ts` before route registration.
- [x] Ensure webhooks and workers call `request.getOrgId()` before DB access.
- [x] Update `src/db/client.ts` helpers to require explicit orgId or throw.
- [x] Add regression tests: integration test hitting webhook with valid org, expect `SET LOCAL` (assert via spy/mock?).

### 2.2 GitHub Webhook Raw Payload (F-2025-02-02)

- [x] Enable Fastify raw-body hook (`server.addContentTypeParser('*', ...)` or `@fastify/raw-body`).
- [x] Store raw `Buffer` on request and feed into `verifyGitHubSignature`.
- [x] Add negative test (tampered payload) and positive test (exact payload).

### 2.3 Cost & Rate Control (F-2025-02-03)

- [x] Wire `createRateLimitMiddleware` into Sentry webhook route and future LLM endpoints.
- [x] Extend middleware with Redis backing (shared counters).
- [x] Add plan-based configuration coverage in `tests/integration/sentry-webhook.test.ts` (simulate plan exhaustion).

### 2.4 Fastify Rate Limit Backend (F-2025-02-04)

- [x] Provide Redis instance to `@fastify/rate-limit` via `redis: redis.client`.
- [x] Configure per-org keys to avoid global bleed.
- [ ] Test with concurrent requests across processes (integration harness using Redis mock?).

### 2.5 GitHub Repo Registration (F-2025-02-05)

- [x] Replace sequential insert with bulk UPSERT (single `INSERT ... VALUES ...` with `UNNEST`).
- [x] Add metrics around insert duration.
- [x] Integration test: simulate 50 repos; assert single query via mock/spies.

### 2.6 CI Coverage (F-2025-02-06)

- [x] Add GitHub Actions workflow running `npm run lint`, `npx tsc --noEmit`, `npm test -- --run`.
- [x] Gate PRs on workflow success.

---

## 3. Test Matrix

| Feature                    | Integration Tests                                                                                                    | E2E / Scenario Tests                                                                   | Notes                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Multi-tenancy context      | `tests/integration/sentry-webhook.test.ts`: spies `transaction` and asserts `current_setting('app.current_org_id')`. | Manual smoke: Post webhook for org A/B, ensure isolation. Future playwright API suite. | Consider surfacing org context in diagnostics endpoint. |
| GitHub webhook auth        | New `tests/integration/github-webhook-auth.test.ts`: valid vs tampered payloads + repo add/remove/bulk flows.        | Post-install flow via mocked GitHub App event (LocalStack).                            | Need raw-body support.                                  |
| Rate limiting              | `tests/integration/sentry-webhook.test.ts`: preload `events_per_hour` quota and expect 429 + headers.                | Load-test script in `scripts/` (k6 or artillery).                                      | Must leverage Redis for shared counters.                |
| Repo registration batching | `tests/integration/github-webhook-auth.test.ts`: added/removed repo coverage + 50 repo bulk insert spy.              | E2E: simulate GitHub installation with 100 repos and measure completion time.          | Perf instrumentation pending beyond duration logging.   |
| CI pipeline                | `.github/workflows/ci.yml`: migrations, lint, tsc, Vitest, Python lint/tests.                                        | Post-merge guard (GitHub Checks).                                                      | Document commands in README + required env secrets.     |

Command references:

- Type checks: `npx tsc --noEmit`
- Lint: `npm run lint`
- Unit/integration: `npm test -- --run`
- GitHub webhook harness: `node scripts/test-webhook.cjs --verify-db`

---

## 4. Ownership & Deadlines

| Workstream                | DRI            | Target Date | Dependencies                             |
| ------------------------- | -------------- | ----------- | ---------------------------------------- |
| Multi-tenancy enforcement | Backend Guild  | 2025-12-04  | Requires env fixtures with multiple orgs |
| GitHub raw payload        | Platform Guild | 2025-12-05  | Needs Fastify raw body plugin selection  |
| Cost controls wiring      | Backend Guild  | 2025-12-06  | Redis config in prod                     |
| Fastify rate-limit redis  | DevOps         | 2025-12-06  | Redis credentials in env                 |
| Repo batching             | Backend Guild  | 2025-12-08  | Postgres benchmarking harness            |
| CI workflow               | DevEx          | 2025-12-03  | GitHub Actions secrets                   |

---

## 5. Follow-Up Notes

- Update roadmap docs once remediation lands.
- Ensure synthetic dataset (Week 7 deliverable) accounts for multi-tenant contexts.
- Document minimum Node.js version (base64url support) in README.
- After fixes, rerun full suite + manual GitHub install dry-run.
