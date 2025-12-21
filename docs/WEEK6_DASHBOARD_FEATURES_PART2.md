# Buglens Week 6 — Dashboard Features Specification (Part 2)

## Continued from Part 1

This document covers Cost Analytics, Settings, Integrations, Component Library, and Technical specifications.

---

## 6. Cost Analytics Page (`/analytics`)

### Decision Framework

| Question          | Answer                                                         |
| ----------------- | -------------------------------------------------------------- |
| **Who?**          | Engineering Manager OR Finance reviewing spend                 |
| **Decision?**     | "Is Buglens worth the money?" / "Should we upgrade our plan?"  |
| **Metrics?**      | Cost per RCA, ROI (hours saved × hourly rate), accuracy trend  |
| **Time Context?** | Monthly view with daily breakdown, month-over-month comparison |
| **Trust?**        | Show calculation methodology, link to raw data                 |
| **Drill-down?**   | Summary → Daily breakdown → Individual RCA costs               |

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ◀ Buglens  │  Cost Analytics                  [🔔] [User ▼] [☀]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Cost & ROI Analytics                      [December 2025 ▼]    │
│  Track your investment and measure returns                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 💡 TL;DR: You saved $14,325 this month. ROI: 3,400%        ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────┐│
│  │ TOTAL RCAs   │ │ LLM COST     │ │ ACCURACY     │ │ ROI     ││
│  │              │ │              │ │              │ │         ││
│  │    347       │ │   $4.20      │ │   84.2%      │ │ 3,400%  ││
│  │  ↑ 12% MoM   │ │  2.1M tokens │ │  ↑ from 79%  │ │ $14,325 ││
│  │              │ │  $0.012/RCA  │ │              │ │ saved   ││
│  │              │ │              │ │              │ │         ││
│  │ 🟢 On track  │ │ 🟢 Under cap │ │ 🟢 > 80%     │ │ 🟢 > 5x ││
│  └──────────────┘ └──────────────┘ └──────────────┘ └─────────┘│
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  📈 COST PER RCA TREND                                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │     $0.015 ─────┬─────────────────────────────────────      ││
│  │                │         ●                                  ││
│  │     $0.012 ────┼───●────────●─────●─────●─────●             ││
│  │                │                                            ││
│  │     $0.009 ────┴─────────────────────────────────────       ││
│  │           Dec 1    5       10      15      20      25       ││
│  │                                                             ││
│  │  Target: $0.015/RCA │ Current avg: $0.012/RCA ✓             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  📊 ROI CALCULATION                    📉 QUALITY BREAKDOWN     │
│  ┌────────────────────────────┐        ┌────────────────────────┐│
│  │                            │        │ Last 347 RCAs:         ││
│  │ RCAs Completed:     347    │        │                        ││
│  │ Avg Time Saved:    33 min  │        │ ████████████░░ 84.2%   ││
│  │ Total Hours:       191 hrs │        │ Accurate (292)         ││
│  │ Eng. Hourly Rate:  $75     │        │                        ││
│  │ ─────────────────────────  │        │ ██░░░░░░░░░░░░ 12.1%   ││
│  │ Value Delivered:  $14,325  │        │ Partial (42)           ││
│  │ Buglens Cost:        $420  │        │                        ││
│  │ ─────────────────────────  │        │ █░░░░░░░░░░░░░ 3.7%    ││
│  │ NET ROI:          $13,905  │        │ Wrong (13)             ││
│  │                            │        │                        ││
│  │ [Adjust Rate →]            │        │ [View Wrong RCAs →]    ││
│  └────────────────────────────┘        └────────────────────────┘│
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  📅 DAILY BREAKDOWN                                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Date       │ RCAs │ Tokens   │ Cost   │ GitHub │ Accuracy  ││
│  ├────────────┼──────┼──────────┼────────┼────────┼───────────┤│
│  │ Dec 15     │  12  │  72,400  │ $0.14  │  450   │  91.7%    ││
│  │ Dec 14     │  28  │ 168,000  │ $0.34  │  980   │  82.1%    ││
│  │ Dec 13     │  15  │  90,000  │ $0.18  │  520   │  86.7%    ││
│  │ Dec 12     │  22  │ 132,000  │ $0.26  │  780   │  81.8%    ││
│  │ Dec 11     │  18  │ 108,000  │ $0.22  │  640   │  88.9%    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  [Export CSV] [View Full History →]                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Features

1. **TL;DR Banner** - One-sentence ROI summary for quick comprehension
2. **4 Core Metrics** - RCAs, Cost, Accuracy, ROI with thresholds
3. **Cost Trend Chart** - Visual target line for budget management
4. **ROI Calculator** - Adjustable hourly rate, transparent calculation
5. **Quality Breakdown** - Link wrong RCAs to drive improvement
6. **Daily Breakdown** - Drill-down for anomaly investigation

### API Endpoints

```typescript
GET /api/v1/analytics/costs
// Query: { startDate, endDate }
// Response:
{
  summary: {
    totalRcas: number,
    totalTokens: number,
    totalCost: number,
    avgCostPerRca: number,
    accuracy: number,
    hoursSaved: number,
    roiValue: number,
    roiPercentage: number
  },
  trend: Array<{
    date: ISO8601,
    rcas: number,
    tokens: number,
    cost: number,
    accuracy: number
  }>,
  qualityBreakdown: {
    accurate: number,
    partial: number,
    wrong: number
  }
}

GET /api/v1/analytics/roi
// Query: { hourlyRate }
// Response with adjusted calculations
```

---

## 7. Settings Pages

### 7a. Organization Settings (`/settings/organization`)

#### Decision Framework

| Question      | Answer                                                    |
| ------------- | --------------------------------------------------------- |
| **Who?**      | Admin managing organization                               |
| **Decision?** | "Is our org configured correctly?" / "Should we upgrade?" |
| **Trust?**    | Show current plan limits, usage against limits            |

#### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ◀ Buglens  │  Settings > Organization        [🔔] [User ▼] [☀] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Organization] [Team] [Integrations] [API Keys] [Billing]      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Organization Details                                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Organization Name                                           ││
│  │ ┌───────────────────────────────────────────────────────┐   ││
│  │ │ Acme Engineering                                      │   ││
│  │ └───────────────────────────────────────────────────────┘   ││
│  │                                                             ││
│  │ Organization Slug                                           ││
│  │ ┌───────────────────────────────────────────────────────┐   ││
│  │ │ acme-eng                                              │   ││
│  │ └───────────────────────────────────────────────────────┘   ││
│  │ Used in URLs: buglens.io/acme-eng                           ││
│  │                                                             ││
│  │                                        [Save Changes]       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Plan & Usage                                                   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Current Plan: PRO                               [Upgrade →] ││
│  │                                                             ││
│  │ ┌─────────────────────────────────────────────────────────┐ ││
│  │ │ RCAs This Month                                         │ ││
│  │ │ ████████████░░░░░░░░░░░░░░░░░░░░ 347 / 1000            │ ││
│  │ │                                                         │ ││
│  │ │ LLM Tokens                                              │ ││
│  │ │ ██████████████████░░░░░░░░░░░░░░ 2.1M / 5M              │ ││
│  │ │                                                         │ ││
│  │ │ Team Members                                            │ ││
│  │ │ ████████░░░░░░░░░░░░░░░░░░░░░░░░ 8 / 25                 │ ││
│  │ └─────────────────────────────────────────────────────────┘ ││
│  │                                                             ││
│  │ Resets on: January 1, 2026 (14 days)                       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Danger Zone                                                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ⚠️ Delete Organization                                      ││
│  │ This will permanently delete all data including RCAs,       ││
│  │ events, and team members. This action cannot be undone.     ││
│  │                                                             ││
│  │                            [Delete Organization]            ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 7b. Team Members (`/settings/team`)

#### Decision Framework

| Question      | Answer                              |
| ------------- | ----------------------------------- |
| **Who?**      | Admin managing team access          |
| **Decision?** | "Who has access? What can they do?" |
| **Trust?**    | Show last active, role permissions  |

#### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ◀ Buglens  │  Settings > Team                [🔔] [User ▼] [☀] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Organization] [Team] [Integrations] [API Keys] [Billing]      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Team Members (8/25)                              [Invite +]    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │ 👤 Jane Smith                          Owner                ││
│  │    jane@acme.com                       Active now           ││
│  │                                                             ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                                                             ││
│  │ 👤 John Doe                            Admin        [⚙️]    ││
│  │    john@acme.com                       2 hours ago          ││
│  │                                                             ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                                                             ││
│  │ 👤 Alice Chen                          Member       [⚙️]    ││
│  │    alice@acme.com                      1 day ago            ││
│  │                                                             ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                                                             ││
│  │ 👤 Bob Johnson                         Member       [⚙️]    ││
│  │    bob@acme.com                        3 days ago           ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Pending Invitations (2)                                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ sarah@acme.com       Invited 2 days ago       [Resend][❌]  ││
│  │ mike@acme.com        Invited 5 days ago       [Resend][❌]  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Role Permissions:                                              │
│  • Owner: Full access, billing, delete org                      │
│  • Admin: Manage team, integrations, settings                   │
│  • Member: View dashboard, RCAs, submit feedback                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 7c. Integrations (`/settings/integrations`)

#### Decision Framework

| Question      | Answer                                               |
| ------------- | ---------------------------------------------------- |
| **Who?**      | Admin setting up data sources                        |
| **Decision?** | "Are my integrations working? What's missing?"       |
| **Trust?**    | Show connection health, last sync time, error states |

#### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ◀ Buglens  │  Settings > Integrations        [🔔] [User ▼] [☀] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Organization] [Team] [Integrations] [API Keys] [Billing]      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Connected Integrations                                         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │ 🔴 SENTRY                                  🟢 Connected     ││
│  │ ─────────────────────────────────────────────────────────── ││
│  │                                                             ││
│  │ Project: my-app-production                                  ││
│  │ Webhook URL:                                                ││
│  │ https://api.buglens.io/webhooks/sentry/abc123def456         ││
│  │                                           [📋 Copy]         ││
│  │                                                             ││
│  │ Status:                                                     ││
│  │ • Last event received: 2 minutes ago ✓                      ││
│  │ • Events this month: 1,247                                  ││
│  │ • Webhook healthy: Yes ✓                                    ││
│  │                                                             ││
│  │                              [Configure] [Test] [Disconnect]││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │ 🐙 GITHUB                                  🟢 Connected     ││
│  │ ─────────────────────────────────────────────────────────── ││
│  │                                                             ││
│  │ Installation: acme-engineering                              ││
│  │ Repositories: 12 connected                                  ││
│  │                                                             ││
│  │ Status:                                                     ││
│  │ • Last code fetch: 15 minutes ago ✓                         ││
│  │ • API rate limit: 4,850/5,000 remaining                     ││
│  │ • Cache hit rate: 87%                                       ││
│  │                                                             ││
│  │                              [Configure] [Test] [Disconnect]││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │ 💬 SLACK                                   🟡 Not Connected ││
│  │ ─────────────────────────────────────────────────────────── ││
│  │                                                             ││
│  │ Get RCA notifications in your Slack channels.               ││
│  │ Choose when to notify: critical only, all, or custom.       ││
│  │                                                             ││
│  │                                          [Connect Slack →]  ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 7d. Slack Configuration (`/settings/integrations/slack`)

#### Layout (after connection)

```
┌─────────────────────────────────────────────────────────────────┐
│ ◀ Back to Integrations  │  Slack Configuration      [User ▼]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  💬 Slack Integration                          🟢 Connected     │
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Notification Channel                                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Select channel...                                      [▼]  ││
│  │ ────────────────────────────────────────────────────────── ││
│  │ # engineering-alerts  ✓                                     ││
│  │ # incidents                                                 ││
│  │ # dev-notifications                                         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Notification Triggers                                          │
│                                                                 │
│  ☑ Critical severity errors (immediate)                        │
│  ☑ High severity errors (batched hourly)                       │
│  ☐ Medium severity errors                                       │
│  ☐ Low severity errors                                          │
│                                                                 │
│  ☑ RCA completed with high confidence (> 85%)                   │
│  ☐ All RCA completions                                          │
│  ☑ RCA marked as wrong by team member                          │
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Test Notification                                              │
│                                                                 │
│  Send a test notification to verify your configuration.         │
│                                                                 │
│  [Send Test Notification]                                       │
│                                                                 │
│  Last test: Sent successfully 5 minutes ago ✓                   │
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│                                              [Save Configuration]│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 7e. API Keys (`/settings/api-keys`)

#### Decision Framework

| Question      | Answer                                     |
| ------------- | ------------------------------------------ |
| **Who?**      | Developer integrating with Buglens API     |
| **Decision?** | "How do I authenticate? Is my key secure?" |
| **Trust?**    | Show key usage, last used, expiration      |

#### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ◀ Buglens  │  Settings > API Keys            [🔔] [User ▼] [☀] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Organization] [Team] [Integrations] [API Keys] [Billing]      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  API Keys                                    [Create New Key +] │
│                                                                 │
│  ⚠️ Treat API keys like passwords. Never commit them to git.   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │ 🔑 Production Key                                           ││
│  │    blens_prod_abc123...xyz                         [👁][📋] ││
│  │                                                             ││
│  │    Created: Dec 1, 2025                                     ││
│  │    Last used: 2 minutes ago                                 ││
│  │    Requests today: 1,247                                    ││
│  │    Expires: Never                                           ││
│  │                                                             ││
│  │                                           [Rotate] [Revoke] ││
│  │                                                             ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                                                             ││
│  │ 🔑 CI/CD Key                                                ││
│  │    blens_ci_def456...uvw                           [👁][📋] ││
│  │                                                             ││
│  │    Created: Dec 10, 2025                                    ││
│  │    Last used: 1 hour ago                                    ││
│  │    Requests today: 89                                       ││
│  │    Expires: Jan 10, 2026 (23 days)                         ││
│  │                                                             ││
│  │                                           [Rotate] [Revoke] ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                 │
│  Usage Example:                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ curl https://api.buglens.io/v1/rca-results \               ││
│  │   -H "Authorization: Bearer blens_prod_abc123..."           ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  [View API Documentation →]                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Library

### Shared Components

```typescript
// UI Components
Button; // variants: primary, secondary, danger, ghost
Input; // types: text, email, password, search
Select; // with search, multi-select option
DatePicker; // range selector, presets (today, 7d, 30d)
Modal; // sizes: sm, md, lg, fullscreen
Toast; // variants: success, error, warning, info
Badge; // severity colors, status indicators
Avatar; // user images with fallback initials
Tooltip; // hover info with delay

// Data Display
Table; // sortable, filterable, selectable rows
Pagination; // page numbers, prev/next, page size selector
MetricCard; // value + trend + threshold indicators
Chart; // Line, Bar, Pie (using Recharts)
CodeViewer; // syntax highlighting with line numbers
DiffViewer; // side-by-side or unified diff
Timeline; // vertical step list with icons

// Layout
Sidebar; // collapsible navigation
Header; // logo, search, notifications, user menu
PageContainer; // max-width wrapper with padding
Tabs; // horizontal tab navigation
Card; // content container with optional header

// Feedback
ConfidenceMeter; // visual bar (0-100%)
FeedbackPanel; // thumbs up/down with optional comment
EmptyState; // illustration + message + action
LoadingState; // skeleton loaders matching content shape
ErrorState; // error message + retry button
```

### Component: ConfidenceMeter

```typescript
interface ConfidenceMeterProps {
  value: number; // 0-100
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  thresholds?: {
    low: number; // default: 60
    medium: number; // default: 80
  };
}

// Visual:
// Low (< 60):    ██░░░░░░░░ 45% (red)
// Medium (60-80): ██████░░░░ 72% (yellow)
// High (> 80):   █████████░ 92% (green)
```

### Component: SystemHealthBanner

```typescript
interface SystemHealthBannerProps {
  state: "fire" | "warning" | "ok";
  criticalCount: number;
  highCount: number;
  message?: string;
}

// fire:    Red background, 🔴 icon, urgent message
// warning: Yellow background, ⚠️ icon, attention message
// ok:      Green background, 🟢 icon, all-clear message
```

### Component: DataFreshnessBar

```typescript
interface DataFreshnessBarProps {
  sources: Array<{
    name: string;
    lastSync: Date;
    staleThresholdMinutes: number;
  }>;
  queueDepth?: number;
}

// Shows warning indicators when data is stale
// Clicking expands to show sync details
```

---

## State Management

### Global State (Zustand)

```typescript
// stores/auth.ts
interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  organization: Organization | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

// stores/theme.ts
interface ThemeState {
  theme: "light" | "dark" | "system";
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

// stores/ui.ts
interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}
```

### Server State (React Query)

```typescript
// Query keys for cache management
const queryKeys = {
  dashboard: ["dashboard", "summary"],
  events: (filters: EventFilters) => ["events", filters],
  event: (id: string) => ["events", id],
  rca: (id: string) => ["rca-results", id],
  rcaGraph: (id: string) => ["rca-results", id, "graph"],
  analytics: (dateRange: DateRange) => ["analytics", "costs", dateRange],
  organization: ["organization"],
  integrations: ["integrations"],
  team: ["team", "members"],
  apiKeys: ["api-keys"],
};
```

---

## API Route Summary

### Auth

```
POST /api/v1/auth/login
POST /api/v1/auth/signup
POST /api/v1/auth/logout
POST /api/v1/auth/refresh
GET  /api/v1/auth/me
```

### Dashboard

```
GET  /api/v1/dashboard/summary
```

### Events

```
GET  /api/v1/events
GET  /api/v1/events/:id
POST /api/v1/events/:id/reprocess
```

### RCA Results

```
GET  /api/v1/rca-results
GET  /api/v1/rca-results/:id
GET  /api/v1/rca-results/:id/evidence-graph
POST /api/v1/rca-results/:id/feedback
```

### Analytics

```
GET  /api/v1/analytics/costs
GET  /api/v1/analytics/roi
GET  /api/v1/analytics/quality
```

### Organization

```
GET  /api/v1/organizations/current
PUT  /api/v1/organizations/current
DELETE /api/v1/organizations/current
```

### Team

```
GET  /api/v1/team/members
POST /api/v1/team/members/invite
PUT  /api/v1/team/members/:id/role
DELETE /api/v1/team/members/:id
```

### Integrations

```
GET  /api/v1/integrations
GET  /api/v1/integrations/:type
PUT  /api/v1/integrations/:type
DELETE /api/v1/integrations/:type
POST /api/v1/integrations/:type/test
```

### API Keys

```
GET  /api/v1/api-keys
POST /api/v1/api-keys
DELETE /api/v1/api-keys/:id
POST /api/v1/api-keys/:id/rotate
```

### Webhooks (already implemented)

```
POST /api/v1/webhooks/sentry/:orgId
POST /api/v1/webhooks/github
POST /api/v1/slack/actions
```

---

## Tech Stack

| Layer             | Technology                     |
| ----------------- | ------------------------------ |
| Framework         | React 18 + TypeScript          |
| Build             | Vite                           |
| Styling           | Tailwind CSS                   |
| State (Client)    | Zustand                        |
| State (Server)    | React Query (TanStack Query)   |
| Routing           | React Router v6                |
| Charts            | Recharts                       |
| Graph Viz         | React Flow                     |
| Code Highlighting | Shiki                          |
| Forms             | React Hook Form + Zod          |
| HTTP Client       | Fetch (native)                 |
| Testing           | Vitest + React Testing Library |

---

## Theme System

### Dark Mode Implementation

```typescript
// stores/theme.ts
export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: "system",
      resolvedTheme: "light",
      setTheme: (theme) => {
        const resolved =
          theme === "system"
            ? window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light"
            : theme;
        document.documentElement.classList.toggle("dark", resolved === "dark");
        set({ theme, resolvedTheme: resolved });
      },
    }),
    { name: "buglens-theme" }
  )
);
```

### Color Palette

#### Light Mode

| Element        | Color     | Hex       |
| -------------- | --------- | --------- |
| Background     | White     | `#ffffff` |
| Surface        | Gray 50   | `#f9fafb` |
| Border         | Gray 200  | `#e5e7eb` |
| Text Primary   | Gray 900  | `#111827` |
| Text Secondary | Gray 600  | `#4b5563` |
| Primary        | Blue 600  | `#2563eb` |
| Success        | Green 600 | `#16a34a` |
| Warning        | Amber 500 | `#f59e0b` |
| Error          | Red 600   | `#dc2626` |

#### Dark Mode

| Element        | Color     | Hex       |
| -------------- | --------- | --------- |
| Background     | Gray 950  | `#030712` |
| Surface        | Gray 900  | `#111827` |
| Border         | Gray 700  | `#374151` |
| Text Primary   | Gray 100  | `#f3f4f6` |
| Text Secondary | Gray 400  | `#9ca3af` |
| Primary        | Blue 500  | `#3b82f6` |
| Success        | Green 500 | `#22c55e` |
| Warning        | Amber 400 | `#fbbf24` |
| Error          | Red 500   | `#ef4444` |

---

## Implementation Priority

### Phase 1: Foundation ✅ COMPLETE (Days 1-2)

- [x] Project setup (Vite + Tailwind + React Query)
- [x] Auth flow (email/password + OAuth buttons)
- [x] Layout components (Sidebar, Header)
- [x] API client setup
- [x] Theme toggle

### Phase 2: Core Pages ✅ COMPLETE (Days 3-4)

- [x] Dashboard home (decision-driven redesign)
- [x] Events list with filters
- [x] RCA detail view (Summary tab)
- [x] Mock data mode

### Phase 3: Advanced Features (Days 5-6)

- [ ] Evidence Graph visualization (React Flow)
- [ ] Code context viewer with syntax highlighting
- [ ] Feedback system (thumbs up/down + comment)
- [ ] Timeline tab implementation

### Phase 4: Analytics & Settings (Days 7-8)

- [ ] Cost analytics dashboard
- [ ] Organization settings
- [ ] Team management
- [ ] Slack integration config
- [ ] API keys management

### Phase 5: Polish (Days 9-10)

- [ ] Loading skeletons
- [ ] Error boundaries
- [ ] Mobile responsive (tablet minimum)
- [ ] E2E tests with Playwright

---

## Success Criteria

### Functionality

- [ ] User can sign up and log in
- [ ] Dashboard answers "which bug first?" in <10 seconds
- [ ] Events list is filterable by severity, status, date
- [ ] RCA detail shows evidence with confidence scores
- [ ] Feedback can be submitted on RCAs
- [ ] Cost analytics shows ROI calculation
- [ ] Settings allow integration configuration

### Performance

- [ ] Page load < 2 seconds (LCP)
- [ ] Time to interactive < 3 seconds
- [ ] Dashboard data refresh < 500ms

### Quality

- [ ] All API calls handle errors gracefully
- [ ] Loading states prevent layout shift
- [ ] Responsive on tablet and desktop
- [ ] Dark mode fully implemented
- [ ] 80%+ test coverage on hooks

### Trust Building

- [ ] Data freshness visible on dashboard
- [ ] Confidence scores with breakdown
- [ ] Evidence source attribution
- [ ] Clear thresholds for good/warning/panic

---

## Files Reference

### Part 1 (this document's companion)

- `WEEK6_DASHBOARD_FEATURES.md` - Design philosophy, Dashboard, Events, RCA Detail

### Code Files

- `web/src/pages/dashboard/DashboardPage.tsx` - Decision-driven dashboard
- `web/src/pages/auth/LoginPage.tsx` - Login form
- `web/src/pages/auth/SignupPage.tsx` - Signup form
- `web/src/pages/events/EventsListPage.tsx` - Events list
- `web/src/pages/rca/RCADetailPage.tsx` - RCA detail with tabs
- `web/src/store/auth.ts` - Authentication state
- `web/src/store/theme.ts` - Theme state
- `web/src/lib/hooks.ts` - React Query hooks
- `web/src/types/api.ts` - API response types
