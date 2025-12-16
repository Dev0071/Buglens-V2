# Buglens Week 6 — Dashboard Features Specification

## Overview

Week 6 focuses on **Slack Integration** and **Web Dashboard MVP** to deliver RCA insights to users. This document defines the comprehensive feature set needed for the frontend dashboard.

---

## 🎯 Core Deliverables

### 1. Authentication & Authorization

### 2. RCA Dashboard (Main View)

### 3. RCA Detail View with Evidence Graph

### 4. Events/Errors List

### 5. Cost Analytics Dashboard

### 6. Organization Settings

### 7. Slack Integration

---

## Page-by-Page Feature Breakdown

### 1. Authentication Pages

#### Login Page (`/login`)

- **GitHub OAuth** login (primary)
- Magic link email login (secondary)
- Redirect to dashboard after auth
- Remember organization selection

#### Organization Selector (`/select-org`)

- List user's organizations
- Create new organization
- Join organization via invite

---

### 2. Dashboard Home (`/dashboard`)

**Purpose:** Overview of recent incidents and system health

#### Components:

```
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard - My Organization                      [Settings ⚙️] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────┐│
│  │ Active Errors│ │ RCAs Today   │ │ Accuracy     │ │ Avg Time││
│  │     12       │ │     8        │ │   84.2%      │ │  18 sec ││
│  │   ▲ +3       │ │   ▼ -2       │ │   ▲ +2.1%    │ │  ▼ -5s  ││
│  └──────────────┘ └──────────────┘ └──────────────┘ └─────────┘│
│                                                                 │
│  Recent RCAs                                        [View All →]│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🔴 TypeError: Cannot read 'name' of undefined   2 min ago  ││
│  │    /api/users/[id].ts:42  •  Confidence: 87%  •  [View →]  ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ 🟡 ReferenceError: db is not defined            15 min ago ││
│  │    /lib/database.ts:18   •  Confidence: 72%  •  [View →]   ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ 🔴 UnhandledPromiseRejection                    1 hour ago ││
│  │    /workers/sync.ts:94   •  Confidence: 91%  •  [View →]   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Error Trend (7 days)                     Cost This Month      │
│  ┌─────────────────────┐                 ┌────────────────────┐│
│  │     📈 Chart        │                 │  LLM:    $4.20     ││
│  │                     │                 │  GitHub: 12,450    ││
│  │                     │                 │  ROI:    3,400%    ││
│  └─────────────────────┘                 └────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

#### Features:

- **Metric Cards:** Active errors, RCAs generated, accuracy rate, avg processing time
- **Recent RCAs List:** Last 5 RCAs with quick preview
- **Error Trend Chart:** 7-day sparkline of error frequency
- **Cost Summary Widget:** Monthly LLM/API usage and ROI
- **Quick Actions:** Create test event, view all errors, go to settings

#### API Endpoints Needed:

```typescript
GET /api/v1/dashboard/summary
GET /api/v1/rca-results?limit=5&sort=created_at:desc
GET /api/v1/analytics/costs/summary
```

---

### 3. RCA List Page (`/rcas`)

**Purpose:** Browse and search all RCA results

#### Features:

```
┌─────────────────────────────────────────────────────────────────┐
│  RCA Results                                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Filters:                                                       │
│  [Environment ▼] [Status ▼] [Confidence ▼] [Date Range 📅]     │
│  [🔍 Search errors...]                                         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ID       │ Error            │ Confidence │ Time    │ Status ││
│  ├──────────┼──────────────────┼────────────┼─────────┼────────┤│
│  │ RCA-001  │ TypeError: Ca... │ ████░ 87%  │ 2m ago  │ ✅ New ││
│  │ RCA-002  │ ReferenceErr...  │ ███░░ 72%  │ 15m ago │ ✅ New ││
│  │ RCA-003  │ Unhandled...     │ █████ 91%  │ 1h ago  │ 👍 Ok  ││
│  │ RCA-004  │ SyntaxError...   │ ██░░░ 45%  │ 2h ago  │ ❌ Bad ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Showing 1-20 of 347 results         [← Prev] Page 1 [Next →]  │
└─────────────────────────────────────────────────────────────────┘
```

#### Filters:

- **Environment:** production, staging, development, all
- **Status:** pending, accurate, partially_useful, not_useful
- **Confidence Range:** slider 0-100%
- **Date Range:** today, last 7 days, last 30 days, custom
- **Search:** full-text search on error message, file path, root cause

#### Table Columns:

- ID (short UUID)
- Error message (truncated)
- Confidence meter (visual bar)
- Created time (relative)
- User feedback status
- Actions (view, copy link)

#### API Endpoints:

```typescript
GET /api/v1/rca-results?
  environment=production&
  feedback=useful&
  confidence_min=0.7&
  start_date=2025-12-01&
  end_date=2025-12-15&
  search=TypeError&
  page=1&
  limit=20
```

---

### 4. RCA Detail Page (`/rcas/:id`)

**Purpose:** Deep dive into a single RCA with all evidence

#### Layout:

````
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to RCAs                                                 │
│                                                                 │
│  TypeError: Cannot read property 'name' of undefined            │
│  /api/users/[id].ts:42  •  Production  •  2 minutes ago        │
│                                                                 │
│  Confidence: ████████░░ 87%                    [👍] [🔧] [❌]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Summary] [Evidence Graph] [Code] [Timeline] [Commits]         │
│  ━━━━━━━━━                                                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │  Summary                                                    ││
│  │  ─────────────────────────────────────────────────────────  ││
│  │  A null check is missing before accessing the 'name'       ││
│  │  property on the user object returned from database query. ││
│  │                                                             ││
│  │  Root Cause                                                 ││
│  │  ─────────────────────────────────────────────────────────  ││
│  │  The `findUser(id)` function returns null when user is     ││
│  │  not found, but the calling code assumes it always returns ││
│  │  a valid user object.                                      ││
│  │                                                             ││
│  │  Causal Chain                                               ││
│  │  ─────────────────────────────────────────────────────────  ││
│  │  1. User requests /api/users/999 (non-existent ID)         ││
│  │     ↓                                                       ││
│  │  2. findUser(999) returns null                              ││
│  │     ↓                                                       ││
│  │  3. Code accesses user.name without null check             ││
│  │     ↓                                                       ││
│  │  4. TypeError thrown                                        ││
│  │                                                             ││
│  │  Suggested Fix                                              ││
│  │  ─────────────────────────────────────────────────────────  ││
│  │  ```diff                                                    ││
│  │  - return { name: user.name, email: user.email };          ││
│  │  + if (!user) return null;                                  ││
│  │  + return { name: user.name, email: user.email };          ││
│  │  ```                                                        ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
````

#### Tabs:

**Tab 1: Summary (default)**

- Error summary
- Root cause explanation
- Causal chain (numbered steps)
- Suggested fix with code diff
- Test intentions (optional)

**Tab 2: Evidence Graph**

```
┌─────────────────────────────────────────────────────────────────┐
│  Evidence Graph                                                 │
│                                                                 │
│           [Error Event]                                         │
│                │                                                │
│                ├── caused by ──→ [Line 42: user.name]          │
│                │                        │                       │
│                │                        ├── introduced ──→ [abc123]
│                │                        │                  @dev  │
│                │                        │                       │
│                │                        └── triggered ──→ [null]│
│                │                                        847x    │
│                │                                                │
│                └── similar to ──→ [3 past bugs]                │
│                                                                 │
│  Legend: [●] Click node to expand details                      │
└─────────────────────────────────────────────────────────────────┘
```

- Interactive D3.js/React Flow graph
- Clickable nodes for more detail
- Edge labels show relationship type
- Confidence colors (green/yellow/red)

**Tab 3: Code Context**

```
┌─────────────────────────────────────────────────────────────────┐
│  Code Context                          /api/users/[id].ts       │
│                                                                 │
│  38 │   export async function GET(req) {                       │
│  39 │     const id = req.params.id;                            │
│  40 │     const user = await findUser(id);                     │
│  41 │                                                          │
│  42 │►    return { name: user.name, email: user.email };  ← ERROR
│  43 │   }                                                      │
│  44 │                                                          │
│                                                                 │
│  AST Findings:                                                  │
│  • [HIGH] Missing null check before property access            │
│  • [MED]  No error handling for database query                 │
└─────────────────────────────────────────────────────────────────┘
```

- Syntax-highlighted code
- Error line highlighted
- Line numbers
- AST findings list below

**Tab 4: Timeline**

- Breadcrumb events before error
- User actions leading to error
- Console logs (if captured)

**Tab 5: Commits**

- Recent commits to error file
- Commit that introduced the bug (if detected)
- Author and timestamp

#### Feedback Panel:

```
┌─────────────────────────────────────────────────────────────────┐
│  Was this RCA helpful?                                          │
│                                                                 │
│  [👍 Accurate]  [🔧 Partially Helpful]  [❌ Wrong]              │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ What was the actual root cause? (optional)                  ││
│  │ [________________________________________________]          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  [Submit Feedback]                                              │
└─────────────────────────────────────────────────────────────────┘
```

#### API Endpoints:

```typescript
GET /api/v1/rca-results/:id
GET /api/v1/rca-results/:id/evidence-graph
POST /api/v1/rca-results/:id/feedback
```

---

### 5. Events List Page (`/events`)

**Purpose:** View raw error events from Sentry

#### Features:

- Table with: message, environment, timestamp, status, RCA link
- Filters: environment, status, date range
- Click to view event detail or linked RCA
- Bulk actions: reprocess, ignore

#### API Endpoints:

```typescript
GET /api/v1/events?environment=production&status=done&page=1
GET /api/v1/events/:id
POST /api/v1/events/:id/reprocess
```

---

### 6. Cost Analytics Page (`/analytics`)

**Purpose:** Track costs and demonstrate ROI

#### Layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  Cost & ROI Analytics                      [December 2025 ▼]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────┐│
│  │ Total RCAs   │ │ LLM Cost     │ │ Accuracy     │ │ ROI     ││
│  │    347       │ │   $4.20      │ │   84.2%      │ │ 3,400%  ││
│  │              │ │  2.1M tokens │ │              │ │ $14,325 ││
│  └──────────────┘ └──────────────┘ └──────────────┘ └─────────┘│
│                                                                 │
│  Cost per RCA Trend                                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │     $0.15 ─────┬─────────────────────────────────────       ││
│  │               │         ●                                   ││
│  │     $0.12 ────┼───●────────●─────●─────●─────●              ││
│  │               │                                             ││
│  │     $0.09 ────┴─────────────────────────────────────        ││
│  │          Dec 1    5       10      15      20      25        ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐│
│  │ Quality Breakdown        │  │ Value Delivered              ││
│  │                          │  │                              ││
│  │   ████████ 82.7% Acc    │  │  Hours Saved: 191 hrs        ││
│  │   ██░░░░░░ 12.1% Partial│  │  Avg Time:   12 min (was 45) ││
│  │   █░░░░░░░  5.2% Wrong  │  │  Value:      $14,325         ││
│  │                          │  │  (at $75/hr engineering)     ││
│  └──────────────────────────┘  └──────────────────────────────┘│
│                                                                 │
│  Daily Usage                                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Date       │ RCAs │ Tokens   │ Cost   │ GitHub │ Accuracy  ││
│  ├────────────┼──────┼──────────┼────────┼────────┼───────────┤│
│  │ Dec 15     │  12  │  72,400  │ $0.14  │  450   │  91.7%    ││
│  │ Dec 14     │  28  │ 168,000  │ $0.34  │  980   │  82.1%    ││
│  │ Dec 13     │  15  │  90,000  │ $0.18  │  520   │  86.7%    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

#### Features:

- **Period Selector:** This month, last month, custom range
- **Metric Cards:** Total RCAs, LLM cost, accuracy rate, ROI
- **Cost Trend Chart:** Line chart of cost per RCA over time
- **Quality Pie Chart:** Accurate / Partial / Wrong breakdown
- **Value Calculator:** Hours saved, engineering value
- **Daily Usage Table:** Breakdown by day

#### API Endpoints:

```typescript
GET /api/v1/analytics/costs?start_date=2025-12-01&end_date=2025-12-31
GET /api/v1/analytics/costs/trends?days=30
GET /api/v1/analytics/quality
```

---

### 7. Settings Page (`/settings`)

#### Sub-pages:

**7a. Organization Settings (`/settings/organization`)**

- Organization name, slug
- Plan details (free/pro/enterprise)
- Usage limits display
- Delete organization

**7b. Integrations (`/settings/integrations`)**

```
┌─────────────────────────────────────────────────────────────────┐
│  Integrations                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🔵 Sentry                                      [Connected ✓]││
│  │ Project: my-app                                             ││
│  │ Webhook URL: https://api.buglens.io/webhooks/sentry/abc123  ││
│  │ Last event: 2 minutes ago                                   ││
│  │                                      [Configure] [Disconnect]││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🐙 GitHub                                      [Connected ✓]││
│  │ Installation: my-org                                        ││
│  │ Repositories: 12 connected                                  ││
│  │ Last sync: 1 hour ago                                       ││
│  │                                      [Configure] [Disconnect]││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 💬 Slack                                       [Connect →]  ││
│  │ Send RCA notifications to your team                        ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**7c. Slack Configuration (`/settings/integrations/slack`)**

- Select notification channel
- Configure notification triggers
- Test notification button
- Webhook URL for interactive buttons

**7d. Team Members (`/settings/team`)**

- List members with roles
- Invite new member
- Change roles (owner, admin, member)
- Remove member

**7e. API Keys (`/settings/api-keys`)**

- Generate API keys
- Revoke keys
- Usage logs per key

---

## Component Library

### Shared Components Needed:

```typescript
// UI Components
Button; // Primary, secondary, danger variants
Input; // Text, email, search
Select; // Dropdown with search
DatePicker; // Range selector
Modal; // Overlay dialogs
Toast; // Success/error notifications
Badge; // Status indicators
Avatar; // User profile images
Tooltip; // Hover info

// Data Display
Table; // Sortable, filterable
Pagination; // Page navigation
MetricCard; // Number with trend indicator
Chart; // Line, bar, pie (Recharts)
CodeViewer; // Syntax highlighted code
DiffViewer; // Side-by-side or unified diff
Timeline; // Vertical step list

// Layout
Sidebar; // Navigation
Header; // Top bar with user menu
PageContainer; // Max-width wrapper
Tabs; // Tab navigation
Card; // Content container

// Feedback
ConfidenceMeter; // Visual confidence bar
FeedbackPanel; // Thumbs up/down with notes
EmptyState; // No data placeholder
LoadingState; // Skeleton loaders
ErrorState; // Error with retry
```

---

## State Management

### Global State (Zustand):

```typescript
interface AppState {
  user: User | null;
  organization: Organization | null;
  theme: "light" | "dark";
  sidebarCollapsed: boolean;
}
```

### Server State (React Query):

```typescript
// Query keys
["dashboard", "summary"][("rca-results", filters)][("rca-results", id)][
  ("events", filters)
][("analytics", "costs", dateRange)]["organization"]["integrations"];
```

---

## API Route Summary

### Auth

```
POST /api/v1/auth/github/callback
POST /api/v1/auth/magic-link
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

### Dashboard

```
GET  /api/v1/dashboard/summary
```

### RCA Results

```
GET  /api/v1/rca-results
GET  /api/v1/rca-results/:id
GET  /api/v1/rca-results/:id/evidence-graph
POST /api/v1/rca-results/:id/feedback
```

### Events

```
GET  /api/v1/events
GET  /api/v1/events/:id
POST /api/v1/events/:id/reprocess
```

### Analytics

```
GET  /api/v1/analytics/costs
GET  /api/v1/analytics/costs/trends
GET  /api/v1/analytics/quality
```

### Organization

```
GET  /api/v1/organizations/:id
PUT  /api/v1/organizations/:id
GET  /api/v1/organizations/:id/members
POST /api/v1/organizations/:id/members
DELETE /api/v1/organizations/:id/members/:userId
```

### Integrations

```
GET  /api/v1/integrations
GET  /api/v1/integrations/:type
PUT  /api/v1/integrations/:type
DELETE /api/v1/integrations/:type
POST /api/v1/integrations/slack/test
```

### Webhooks (already implemented)

```
POST /api/v1/webhooks/sentry/:orgId
POST /api/v1/webhooks/github
POST /api/v1/slack/actions
```

---

## Tech Stack Confirmation

| Layer             | Technology                     |
| ----------------- | ------------------------------ |
| Framework         | React 18 + TypeScript          |
| Build             | Vite                           |
| Styling           | Tailwind CSS                   |
| State (Client)    | Zustand                        |
| State (Server)    | React Query (TanStack Query)   |
| Routing           | React Router v6                |
| Charts            | Recharts                       |
| Graph Viz         | React Flow or D3.js            |
| Code Highlighting | Prism.js or Shiki              |
| Forms             | React Hook Form + Zod          |
| HTTP Client       | Axios or fetch                 |
| Testing           | Vitest + React Testing Library |

---

## Implementation Priority

### Phase 1 (Days 1-2): Foundation

- [ ] Project setup (Vite + Tailwind + React Query)
- [ ] Auth flow (GitHub OAuth)
- [ ] Layout components (Sidebar, Header)
- [ ] API client setup

### Phase 2 (Days 3-4): Core Pages

- [ ] Dashboard home with metrics
- [ ] RCA list with filters
- [ ] RCA detail view (Summary tab)

### Phase 3 (Days 5-6): Advanced Features

- [ ] Evidence Graph visualization
- [ ] Code context viewer
- [ ] Feedback system

### Phase 4 (Days 7-8): Analytics & Settings

- [ ] Cost analytics dashboard
- [ ] Settings pages
- [ ] Slack integration config

### Phase 5 (Days 9-10): Polish

- [ ] Loading states
- [ ] Error handling
- [ ] Mobile responsive
- [ ] E2E tests

---

## Success Criteria

- [ ] User can log in via GitHub OAuth
- [ ] Dashboard shows recent RCAs and metrics
- [ ] RCA list is filterable and searchable
- [ ] RCA detail shows all evidence tabs
- [ ] Evidence graph is interactive
- [ ] Feedback can be submitted
- [ ] Cost analytics shows ROI
- [ ] Settings allow integration configuration
- [ ] Responsive on tablet/desktop
- [ ] Page load < 2 seconds
- [ ] All API calls handle errors gracefully
