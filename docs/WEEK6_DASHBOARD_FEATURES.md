# Buglens Week 6 — Dashboard Features Specification (Part 1)

## 🎯 Design Philosophy: Decision-Driven Dashboards

**CRITICAL PRINCIPLE:** Every screen exists to help a specific person make a specific decision at a specific moment.

### The 8-Point Design Framework

Before designing ANY page, we answered these questions:

| #   | Question                                          | Why It Matters                                                    |
| --- | ------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | **Who exactly uses this?**                        | Job title, not "user". Different roles need different views.      |
| 2   | **What decision does this page exist to change?** | Without a clear decision, the page is just data decoration.       |
| 3   | **What metrics directly enable that decision?**   | Max 5. More = noise. Each needs owner + thresholds.               |
| 4   | **What time context matters?**                    | Real-time? 7-day trend? Comparison to baseline?                   |
| 5   | **How do we build trust?**                        | Data freshness indicators, source attribution, confidence scores. |
| 6   | **What's the cognitive load budget?**             | 10-second comprehension rule. Answer the question FAST.           |
| 7   | **What's the drill-down model?**                  | Summary → Anomaly → Detail → Root Cause → Action                  |
| 8   | **Who owns this page?**                           | Review cadence, deletion criteria, metric thresholds.             |

### Why This Matters

**Bad Dashboard:** "You have 47 errors" (So what? Which one? Why should I care?)

**Good Dashboard:** "3 critical bugs need attention. Highest priority: null pointer in checkout flow (94% confidence). One-click to see the fix."

Generic analytics show data. Decision-driven dashboards show **what to do next**.

---

## 📋 Implementation Status

### Phase 1: Foundation ✅ COMPLETE

- ✅ Vite + Tailwind + React Query setup
- ✅ Layout (Sidebar, Header, collapsible nav)
- ✅ Dark/Light theme with system preference
- ✅ Auth store with Zustand persistence
- ✅ Login/Signup pages with email/password auth
- ✅ Protected route wrappers
- ✅ 87 unit tests passing

### Phase 2: Core Pages ✅ COMPLETE

- ✅ Decision-driven Dashboard Home (redesigned)
- ✅ Events List with filters
- ✅ RCA Detail view with tabs
- ✅ React Query hooks
- ✅ Mock data mode for development

### Phase 3-5: See Part 2 Document

- Advanced features, analytics, settings → `WEEK6_DASHBOARD_FEATURES_PART2.md`

---

## How to Test

```bash
# Start frontend
cd web && npm run dev

# Start backend (required for auth)
npm run dev  # from root

# Run tests
cd web && npm test
```

**Dev Auth Bypass:**

```javascript
// Browser console at http://localhost:5173
localStorage.setItem(
  "buglens-auth",
  JSON.stringify({
    state: {
      accessToken: "dev-token",
      user: {
        id: "dev-1",
        email: "dev@test.com",
        name: "Dev User",
        orgId: "org-1",
        role: "admin",
      },
      organization: { id: "org-1", name: "Test Org", plan: "pro" },
    },
  })
);
location.reload();
```

---

## Page Specifications

---

## 1. Login Page (`/login`)

### Decision Framework

| Question            | Answer                                |
| ------------------- | ------------------------------------- |
| **Who?**            | New or returning user (any role)      |
| **Decision?**       | "How do I get into my account?"       |
| **Metrics?**        | None (action page, not analytics)     |
| **Trust?**          | Buglens branding, security indicators |
| **Cognitive Load?** | Minimal - single clear action         |

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                        🔍 BUGLENS                               │
│                   AI-Powered Error Analysis                     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │   Welcome back                                          │   │
│  │                                                         │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │  🐙  Continue with GitHub                       │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │  🔵  Continue with Google                       │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │   ──────────── or continue with email ────────────      │   │
│  │                                                         │   │
│  │   Email                                                 │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │ you@company.com                                 │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │   Password                                              │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │ ••••••••                                        │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │              Sign In                            │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │   Don't have an account? Sign up                        │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### API Endpoints

```typescript
POST / api / v1 / auth / login; // { email, password } → { user, tokens }
POST / api / v1 / auth / signup; // { name, email, password, organizationName } → { user, tokens }
POST / api / v1 / auth / github; // OAuth callback
POST / api / v1 / auth / google; // OAuth callback
POST / api / v1 / auth / refresh; // { refreshToken } → { accessToken }
POST / api / v1 / auth / logout; // Invalidate session
```

---

## 2. Signup Page (`/signup`)

### Decision Framework

| Question            | Answer                                               |
| ------------------- | ---------------------------------------------------- |
| **Who?**            | New user creating account + organization             |
| **Decision?**       | "Should I sign up for Buglens?"                      |
| **Trust?**          | Clear value prop, security indicators, OAuth options |
| **Cognitive Load?** | Minimal fields, progressive disclosure               |

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                        🔍 BUGLENS                               │
│                   AI-Powered Error Analysis                     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │   Create your account                                   │   │
│  │                                                         │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │  🐙  Sign up with GitHub                        │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │  🔵  Sign up with Google                        │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │   ──────────── or sign up with email ─────────────      │   │
│  │                                                         │   │
│  │   Full Name                                             │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │ Jane Doe                                        │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │   Work Email                                            │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │ jane@company.com                                │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │   Organization Name                                     │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │ Acme Corp                                       │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │   Password                                              │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │ ••••••••                            [👁]        │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  │   Min 8 chars, 1 uppercase, 1 number                    │   │
│  │                                                         │   │
│  │   ☑ I agree to Terms of Service and Privacy Policy     │   │
│  │                                                         │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │           Create Account                        │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │   Already have an account? Sign in                      │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Dashboard Home (`/`) — DECISION-DRIVEN REDESIGN

### Decision Framework

| Question          | Answer                                                     |
| ----------------- | ---------------------------------------------------------- |
| **Who?**          | On-call engineer, 3am, pager just fired                    |
| **Decision?**     | "Which bug do I fix first?"                                |
| **Worry?**        | "Is this a real fire or noise? Can I trust this analysis?" |
| **Metrics?**      | 3 max: Unresolved Critical, RCA Accuracy, Time to RCA      |
| **Time Context?** | Last 24h focus, 7-day trend for confidence                 |
| **Trust?**        | Data freshness bar, confidence scores, source links        |
| **Drill-down?**   | Banner → Core Metrics → Ready to Fix list → RCA Detail     |

### Design Principles Applied

1. **System Health Banner** - Immediate fire/warning/ok status (0.5 seconds)
2. **Data Freshness Bar** - "Last Sentry sync: 2 min ago" builds trust
3. **3 Core Metrics** - Not 7, not 12. Three. Each with thresholds.
4. **Ready to Fix Table** - Sorted by severity × confidence, not chronological
5. **Deploy Impact Section** - Did the last deploy make things worse?
6. **Quick Drill-down** - One click to action, not 3 clicks through charts

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ◀ Buglens                                    [🔔] [User ▼] [☀]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🟢 ALL SYSTEMS NORMAL — 0 critical, 2 high-priority pending ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Last Sentry: 2m ago │ Last GitHub: 15m ago │ RCA Queue: 3   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ │
│  │ UNRESOLVED       │ │ RCA ACCURACY     │ │ AVG TIME TO RCA  │ │
│  │ CRITICAL + HIGH  │ │ (Last 7 Days)    │ │ (Last 7 Days)    │ │
│  │                  │ │                  │ │                  │ │
│  │      2           │ │     87%          │ │    8.3 min       │ │
│  │   ↓ from 5       │ │   ↑ from 82%     │ │   ↓ from 12 min  │ │
│  │                  │ │                  │ │                  │ │
│  │ 🟢 < 3 good      │ │ 🟢 > 85% good    │ │ 🟢 < 10m good    │ │
│  │ 🟡 3-10 warning  │ │ 🟡 70-85% warn   │ │ 🟡 10-20m warn   │ │
│  │ 🔴 > 10 panic    │ │ 🔴 < 70% panic   │ │ 🔴 > 20m panic   │ │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘ │
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  🔧 READY TO FIX (sorted by severity × confidence)              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Error                      │ Severity │ Confidence │ Action ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ TypeError: Cannot read     │ 🔴 CRIT  │ ████░ 94%  │ [Fix→] ││
│  │ 'id' of undefined          │ 847 users│            │        ││
│  │ src/checkout/payment.ts:42 │          │            │        ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ ReferenceError: user not   │ 🟠 HIGH  │ ███░░ 78%  │ [Fix→] ││
│  │ defined                    │ 234 users│            │        ││
│  │ src/auth/session.ts:128    │          │            │        ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ Network timeout in API     │ 🟡 MED   │ ██░░░ 65%  │ [View] ││
│  │ call                       │ 89 users │            │        ││
│  │ src/api/client.ts:56       │          │            │        ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  📦 DEPLOY IMPACT (Last 24h)           📊 RCA QUALITY PULSE     │
│  ┌────────────────────────────┐        ┌────────────────────────┐│
│  │ v2.4.1 deployed 6h ago     │        │ Last 50 RCAs:          ││
│  │                            │        │                        ││
│  │ New errors: 2 ⚠️           │        │ ████████████░░ 84%     ││
│  │ Resolved:   5 ✓            │        │ Accurate (42)          ││
│  │ Regression: 1 🔴           │        │                        ││
│  │                            │        │ ███░░░░░░░░░░░ 12%     ││
│  │ [View Deploy Analysis →]   │        │ Partial (6)            ││
│  └────────────────────────────┘        │                        ││
│                                        │ █░░░░░░░░░░░░░ 4%      ││
│                                        │ Wrong (2)              ││
│                                        └────────────────────────┘│
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  🔍 QUICK FILTERS                                               │
│  [My Assigned] [Critical Only] [Last Hour] [Needs Review]       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### 1. System Health Banner

```typescript
type SystemState = "fire" | "warning" | "ok";

interface SystemHealthBannerProps {
  criticalCount: number;
  highCount: number;
  state: SystemState;
}

// Thresholds:
// fire: criticalCount > 0
// warning: highCount > 3
// ok: otherwise
```

#### 2. Data Freshness Bar

```typescript
interface DataFreshnessProps {
  sentryLastSync: Date;
  githubLastSync: Date;
  rcaQueueDepth: number;
}

// Shows staleness warnings if:
// - Sentry > 10 minutes stale
// - GitHub > 1 hour stale
// - Queue > 10 items
```

#### 3. Core Metric Card

```typescript
interface CoreMetricProps {
  title: string;
  value: number | string;
  trend: { direction: "up" | "down" | "flat"; previous: number };
  thresholds: {
    good: { condition: string; value: number };
    warning: { condition: string; value: number };
    panic: { condition: string; value: number };
  };
}
```

#### 4. Ready to Fix Table

```typescript
interface ReadyToFixItem {
  id: string;
  title: string;
  location: string;
  severity: "critical" | "high" | "medium" | "low";
  affectedUsers: number;
  confidence: number; // 0-100
  hasHighConfidenceFix: boolean;
}

// Sorting: severity_weight * confidence DESC
// Only show items with confidence >= 60%
```

### API Endpoints

```typescript
GET /api/v1/dashboard/summary
// Response:
{
  systemHealth: {
    state: 'fire' | 'warning' | 'ok',
    criticalCount: number,
    highCount: number,
    message: string
  },
  dataFreshness: {
    sentryLastSync: ISO8601,
    githubLastSync: ISO8601,
    rcaQueueDepth: number
  },
  coreMetrics: {
    unresolvedCriticalHigh: { value: number, trend: {...}, thresholds: {...} },
    rcaAccuracy7d: { value: number, trend: {...}, thresholds: {...} },
    avgTimeToRca7d: { value: number, trend: {...}, thresholds: {...} }
  },
  readyToFix: ReadyToFixItem[],
  deployImpact: {
    version: string,
    deployedAt: ISO8601,
    newErrors: number,
    resolvedErrors: number,
    regressions: number
  },
  rcaQuality: {
    accurate: number,
    partial: number,
    wrong: number,
    total: number
  }
}
```

---

## 4. Events List Page (`/events`)

### Decision Framework

| Question          | Answer                                                       |
| ----------------- | ------------------------------------------------------------ |
| **Who?**          | Engineer triaging errors OR manager reviewing patterns       |
| **Decision?**     | "Which errors need investigation?" / "What patterns emerge?" |
| **Metrics?**      | Error count by severity, trend direction, affected users     |
| **Time Context?** | Default last 24h, expandable to 7d/30d                       |
| **Trust?**        | Source attribution (Sentry project), timestamp accuracy      |
| **Drill-down?**   | Filter → Select → View RCA → Take Action                     |

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ◀ Buglens  │  Events                         [🔔] [User ▼] [☀] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Events & Errors                                                │
│  Errors from your connected Sentry projects                     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Search errors...                                   [🔍]     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐│
│  │All (127)│ │Critical 3│ │ High 12  │ │Medium 45│ │ Low 67   ││
│  └─────────┘ └──────────┘ └──────────┘ └─────────┘ └──────────┘│
│                                                                 │
│  Filters: [Environment ▼] [Status ▼] [Date Range ▼] [Has RCA ▼]│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │ 🔴 TypeError: Cannot read property 'id' of undefined        ││
│  │    src/checkout/payment.ts:42 • Production • 2 hours ago    ││
│  │    👥 847 affected • 📊 RCA: 94% confidence                 ││
│  │    [View RCA →]                                             ││
│  │                                                             ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                                                             ││
│  │ 🟠 ReferenceError: user is not defined                      ││
│  │    src/auth/session.ts:128 • Production • 5 hours ago       ││
│  │    👥 234 affected • 📊 RCA: 78% confidence                 ││
│  │    [View RCA →]                                             ││
│  │                                                             ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                                                             ││
│  │ 🟡 NetworkError: Request timeout                            ││
│  │    src/api/client.ts:56 • Staging • 1 day ago               ││
│  │    👥 89 affected • ⏳ RCA Processing...                    ││
│  │    [View Details →]                                         ││
│  │                                                             ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                                                             ││
│  │ 🟢 ValidationError: Email format invalid                    ││
│  │    src/forms/signup.ts:23 • Production • 3 days ago         ││
│  │    👥 12 affected • ✓ Resolved                              ││
│  │    [View History →]                                         ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Showing 1-20 of 127                         [← Prev] [Next →]  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Features

1. **Severity Tabs** - Quick filtering by severity level
2. **Smart Search** - Search by error message, file path, or stack trace
3. **Multi-Filter** - Environment, status, date range, RCA availability
4. **User Impact** - Shows affected user count prominently
5. **RCA Status** - Processing, complete with confidence, or needs review
6. **Quick Actions** - Direct link to RCA or reprocess option

### Event Card Information Hierarchy

```
1. Severity indicator (color + icon)
2. Error type and message (primary text)
3. Location (file:line) + environment + time
4. Impact (affected users)
5. RCA status (confidence score or processing state)
6. Action button
```

### API Endpoints

```typescript
GET /api/v1/events
// Query params:
{
  severity?: 'critical' | 'high' | 'medium' | 'low',
  environment?: string,
  status?: 'pending' | 'processing' | 'completed' | 'failed',
  hasRca?: boolean,
  search?: string,
  startDate?: ISO8601,
  endDate?: ISO8601,
  page?: number,
  limit?: number
}

// Response:
{
  events: Event[],
  pagination: {
    total: number,
    page: number,
    limit: number,
    totalPages: number
  },
  summary: {
    critical: number,
    high: number,
    medium: number,
    low: number
  }
}

GET /api/v1/events/:id
POST /api/v1/events/:id/reprocess
```

---

## 5. RCA Detail Page (`/rca/:id`)

### Decision Framework

| Question            | Answer                                                                |
| ------------------- | --------------------------------------------------------------------- |
| **Who?**            | Engineer fixing the bug OR reviewer validating RCA quality            |
| **Decision?**       | "Is this analysis correct? Should I apply this fix?"                  |
| **Trust?**          | Evidence sources, deterministic vs LLM findings, confidence breakdown |
| **Cognitive Load?** | Progressive disclosure: Summary first, evidence on demand             |
| **Drill-down?**     | Summary → Root Cause → Evidence → Code → Timeline                     |

### Layout - Summary Tab (Default)

````
┌─────────────────────────────────────────────────────────────────┐
│ ◀ Back to Events  │  RCA Detail               [🔔] [User ▼] [☀]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TypeError: Cannot read property 'id' of undefined              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🔴 CRITICAL │ 👥 847 users │ ⏱ 8.2 min analysis            ││
│  │ Production  │ First seen: 2h ago │ Last seen: 5 min ago     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ CONFIDENCE SCORE                                         │   │
│  │                                                          │   │
│  │ ████████████████████░░░░  94%                           │   │
│  │                                                          │   │
│  │ Breakdown:                                               │   │
│  │ • Deterministic rules: 3 findings (HIGH confidence)      │   │
│  │ • LLM analysis: Consistent with evidence                 │   │
│  │ • Code context: Exact match found                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Summary] [Evidence Graph] [Code Context] [Timeline] [Feedback]│
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  📋 ROOT CAUSE                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ The error occurs in `processPayment()` at line 42 of       ││
│  │ `src/checkout/payment.ts`. The function attempts to        ││
│  │ access `user.id` without first checking if `user` exists.  ││
│  │                                                            ││
│  │ This happens when:                                         ││
│  │ 1. Session expires during checkout flow                    ││
│  │ 2. `getUser()` returns null instead of throwing            ││
│  │ 3. No null guard before property access                    ││
│  │                                                            ││
│  │ Evidence: ✓ AST analysis confirmed missing null check      ││
│  │          ✓ Stack trace matches code location               ││
│  │          ✓ Pattern matches "null-access" rule              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  🔧 SUGGESTED FIX                                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ```diff                                                    ││
│  │ // src/checkout/payment.ts:40-45                           ││
│  │                                                            ││
│  │ async function processPayment(cartId: string) {            ││
│  │   const user = await getUser();                            ││
│  │ - const userId = user.id;                                  ││
│  │ + if (!user) {                                             ││
│  │ +   throw new AuthenticationError('User session expired'); ││
│  │ + }                                                        ││
│  │ + const userId = user.id;                                  ││
│  │   return chargeCard(userId, cartId);                       ││
│  │ }                                                          ││
│  │ ```                                                        ││
│  │                                                            ││
│  │ [📋 Copy Fix] [🔗 Open in GitHub] [✅ Mark as Applied]     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  📊 DETERMINISTIC FINDINGS (High Trust)                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Rule: null-access │ Confidence: 95%                        ││
│  │ "Potential null/undefined property access detected"        ││
│  │ Location: payment.ts:42, column 23                         ││
│  │ Pattern: Member access without preceding null check        ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ Rule: missing-error-boundary │ Confidence: 78%             ││
│  │ "Async function lacks try-catch wrapper"                   ││
│  │ Location: payment.ts:40-46                                 ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  💬 FEEDBACK                                                    │
│  Was this analysis helpful?                                     │
│  [👍 Accurate] [🤔 Partially Helpful] [👎 Wrong]               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
````

### Tab: Evidence Graph

```
┌─────────────────────────────────────────────────────────────────┐
│  [Summary] [Evidence Graph] [Code Context] [Timeline] [Feedback]│
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Evidence Relationship Graph                                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │        ┌─────────────┐                                      ││
│  │        │   ERROR     │                                      ││
│  │        │ TypeError   │                                      ││
│  │        └──────┬──────┘                                      ││
│  │               │                                             ││
│  │        ┌──────▼──────┐                                      ││
│  │        │ STACK FRAME │                                      ││
│  │        │ payment.ts  │                                      ││
│  │        │ line 42     │                                      ││
│  │        └──────┬──────┘                                      ││
│  │               │                                             ││
│  │    ┌──────────┼──────────┐                                  ││
│  │    │          │          │                                  ││
│  │ ┌──▼───┐  ┌───▼───┐  ┌───▼────┐                            ││
│  │ │ CODE │  │ RULE  │  │ COMMIT │                            ││
│  │ │CONTEXT│ │FINDING│  │ abc123 │                            ││
│  │ │      │  │null-  │  │ 2d ago │                            ││
│  │ │      │  │access │  │        │                            ││
│  │ └──────┘  └───────┘  └────────┘                            ││
│  │                                                             ││
│  │  Legend: [Error] [Stack] [Code] [Rule] [Commit]            ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Click any node to see details                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Tab: Code Context

```
┌─────────────────────────────────────────────────────────────────┐
│  [Summary] [Evidence Graph] [Code Context] [Timeline] [Feedback]│
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  📁 src/checkout/payment.ts                    [Open in GitHub] │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 38 │                                                       ││
│  │ 39 │ // Process payment for cart                           ││
│  │ 40 │ async function processPayment(cartId: string) {       ││
│  │ 41 │   const user = await getUser();                       ││
│  │ 42▶│   const userId = user.id;  // ← ERROR HERE           ││
│  │ 43 │   return chargeCard(userId, cartId);                  ││
│  │ 44 │ }                                                     ││
│  │ 45 │                                                       ││
│  │ 46 │ async function getUser(): Promise<User | null> {      ││
│  │ 47 │   const session = getSession();                       ││
│  │ 48 │   if (!session) return null;  // ← Returns null!      ││
│  │ 49 │   return session.user;                                ││
│  │ 50 │ }                                                     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Related Files:                                                 │
│  • src/auth/session.ts (getSession definition)                 │
│  • src/types/user.ts (User type definition)                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Tab: Timeline

```
┌─────────────────────────────────────────────────────────────────┐
│  [Summary] [Evidence Graph] [Code Context] [Timeline] [Feedback]│
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Event Timeline (reconstructed from breadcrumbs)                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │  14:23:01  ● User clicked "Checkout"                       ││
│  │            │ category: ui.click                             ││
│  │            │                                                ││
│  │  14:23:02  ● Cart loaded successfully                      ││
│  │            │ category: fetch, status: 200                   ││
│  │            │                                                ││
│  │  14:23:03  ● Session check initiated                       ││
│  │            │ category: auth                                 ││
│  │            │                                                ││
│  │  14:23:03  ● Session expired (null returned)  ⚠️           ││
│  │            │ category: auth, status: expired                ││
│  │            │                                                ││
│  │  14:23:03  ● processPayment() called                       ││
│  │            │ category: function                             ││
│  │            │                                                ││
│  │  14:23:03  ✖ TypeError thrown                   🔴         ││
│  │              Cannot read property 'id' of undefined         ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Total duration: 2.3 seconds                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Tab: Feedback

```
┌─────────────────────────────────────────────────────────────────┐
│  [Summary] [Evidence Graph] [Code Context] [Timeline] [Feedback]│
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Rate This Analysis                                             │
│                                                                 │
│  How accurate was this RCA?                                     │
│                                                                 │
│  ┌─────────┐  ┌─────────────────┐  ┌─────────┐                 │
│  │   👍    │  │       🤔        │  │   👎    │                 │
│  │Accurate │  │Partially Helpful│  │  Wrong  │                 │
│  └─────────┘  └─────────────────┘  └─────────┘                 │
│                                                                 │
│  What was the actual root cause? (optional)                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │                                                             ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Did you apply the suggested fix?                               │
│  ○ Yes, exactly as suggested                                    │
│  ○ Yes, with modifications                                      │
│  ○ No, fixed differently                                        │
│  ○ No, not applicable                                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   Submit Feedback                           ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Your feedback improves our analysis accuracy.                  │
│  Current org accuracy: 87% (based on 142 reviews)               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### API Endpoints

```typescript
GET /api/v1/rca-results/:id
// Response:
{
  id: string,
  eventId: string,
  status: 'processing' | 'completed' | 'failed',
  confidence: number,
  confidenceBreakdown: {
    deterministicFindings: number,
    llmConsistency: number,
    codeContextMatch: number
  },
  summary: string,
  rootCause: {
    description: string,
    evidence: string[],
    location: { file: string, line: number, column: number }
  },
  suggestedFix: {
    description: string,
    diff: string,
    file: string,
    startLine: number,
    endLine: number
  },
  deterministicFindings: Array<{
    ruleId: string,
    title: string,
    confidence: number,
    description: string,
    location: { file: string, line: number }
  }>,
  stackTrace: StackFrame[],
  codeContext: Array<{
    file: string,
    content: string,
    highlightLine: number,
    startLine: number
  }>,
  timeline: Array<{
    timestamp: ISO8601,
    category: string,
    message: string,
    level: 'info' | 'warning' | 'error'
  }>,
  metadata: {
    llmTokensUsed: number,
    analysisTimeMs: number,
    model: string
  },
  createdAt: ISO8601,
  updatedAt: ISO8601
}

GET /api/v1/rca-results/:id/evidence-graph
// Returns nodes and edges for React Flow visualization

POST /api/v1/rca-results/:id/feedback
// Body:
{
  rating: 'accurate' | 'partial' | 'wrong',
  actualRootCause?: string,
  fixApplied: 'exact' | 'modified' | 'different' | 'not-applicable'
}
```

---

## Continued in Part 2

See `WEEK6_DASHBOARD_FEATURES_PART2.md` for:

- Cost Analytics Page (Decision: "Is Buglens worth the money?")
- Settings Pages (Decision: "How do I configure my organization?")
- Integrations Configuration (Decision: "Are my integrations healthy?")
- Component Library
- Theme System
- Tech Stack
- Implementation Priority
- Success Criteria
