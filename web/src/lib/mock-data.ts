/**
 * Mock data for development mode
 * When VITE_USE_MOCK_DATA=true, API calls return this mock data instead of hitting backend
 */

import type {
  DashboardStats,
  RecentEvent,
  EventsResponse,
  RCAResult,
  Integration,
} from "@/types/api";

/**
 * Check if mock data mode is enabled
 */
export const isMockMode = (): boolean => {
  return import.meta.env.VITE_USE_MOCK_DATA === "true" || import.meta.env.DEV;
};

/**
 * Simulate network delay for realistic loading states
 */
export const mockDelay = (ms = 500): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Dashboard stats mock data - decision-driven metrics
 */
export const mockDashboardStats: DashboardStats = {
  // Core metrics (what the on-call engineer cares about)
  criticalUnresolved: 0, // System healthy when 0
  highUnresolved: 2, // Should trigger warning banner
  rcaAccuracy: 84, // Based on feedback (good = >80%)
  avgResolutionTime: 23, // Seconds (good = <30s)

  // Trends (for context)
  eventsChange: 12, // % increase triggers spike warning if >50%
  unresolvedTrend: -15, // Negative = improving
  resolutionTimeChange: -5, // Negative = faster

  // Supporting metrics
  totalEvents: 156,
  resolvedRCAs: 89,
  resolvedChange: 8,
  pendingAnalysis: 7,
};

/**
 * Recent events mock data with confidence scores
 */
export const mockRecentEvents: RecentEvent[] = [
  {
    id: "evt-001",
    message: "TypeError: Cannot read property 'name' of undefined",
    severity: "high",
    status: "completed",
    createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    rcaId: "rca-001",
    confidence: 0.87,
  },
  {
    id: "evt-002",
    message: "ReferenceError: db is not defined",
    severity: "medium",
    status: "processing",
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    confidence: 0.72,
  },
  {
    id: "evt-003",
    message: "UnhandledPromiseRejection: Connection refused to database",
    severity: "critical",
    status: "completed",
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    rcaId: "rca-002",
    confidence: 0.91,
  },
  {
    id: "evt-004",
    message: "SyntaxError: Unexpected token < in JSON at position 0",
    severity: "low",
    status: "pending",
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    confidence: 0.45,
  },
  {
    id: "evt-005",
    message: "TypeError: Cannot read property 'map' of null",
    severity: "high",
    status: "completed",
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    rcaId: "rca-003",
    confidence: 0.89,
  },
];

/**
 * Full events list mock data
 */
export const mockEvents: EventsResponse = {
  events: [
    {
      id: "evt-001",
      sentry_event_id: "abc123def456",
      message: "TypeError: Cannot read property 'name' of undefined",
      platform: "javascript",
      severity: "high",
      environment: "production",
      status: "completed",
      created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      rca_result_id: "rca-001",
    },
    {
      id: "evt-002",
      sentry_event_id: "ghi789jkl012",
      message: "ReferenceError: db is not defined",
      platform: "node",
      severity: "medium",
      environment: "production",
      status: "processing",
      created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    },
    {
      id: "evt-003",
      sentry_event_id: "mno345pqr678",
      message: "UnhandledPromiseRejection: Connection refused to database",
      platform: "node",
      severity: "critical",
      environment: "production",
      status: "completed",
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      rca_result_id: "rca-002",
    },
    {
      id: "evt-004",
      sentry_event_id: "stu901vwx234",
      message: "SyntaxError: Unexpected token < in JSON at position 0",
      platform: "javascript",
      severity: "low",
      environment: "staging",
      status: "pending",
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "evt-005",
      sentry_event_id: "yza567bcd890",
      message: "TypeError: Cannot read property 'map' of null",
      platform: "javascript",
      severity: "high",
      environment: "production",
      status: "completed",
      created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      rca_result_id: "rca-003",
    },
    {
      id: "evt-006",
      sentry_event_id: "efg123hij456",
      message: "NetworkError: Failed to fetch user data from API",
      platform: "javascript",
      severity: "medium",
      environment: "production",
      status: "completed",
      created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      rca_result_id: "rca-004",
    },
    {
      id: "evt-007",
      sentry_event_id: "klm789nop012",
      message: "RangeError: Maximum call stack size exceeded",
      platform: "javascript",
      severity: "critical",
      environment: "production",
      status: "failed",
      created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "evt-008",
      sentry_event_id: "qrs345tuv678",
      message:
        "Error: ENOENT: no such file or directory, open '/tmp/config.json'",
      platform: "node",
      severity: "medium",
      environment: "staging",
      status: "completed",
      created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      rca_result_id: "rca-005",
    },
  ],
  total: 47,
  page: 1,
  pageSize: 20,
  totalPages: 3,
};

/**
 * RCA results mock data
 */
export const mockRCAResults: Record<string, RCAResult> = {
  "rca-001": {
    id: "rca-001",
    event_id: "evt-001",
    title: "Null reference in user profile handler",
    summary:
      "The error occurs when accessing a user object that was not found in the database. The findUser function returns null for non-existent users, but the calling code assumes a valid user object is always returned.",
    root_cause: `The root cause is a missing null check before accessing the 'name' property on the user object returned from the database query.

The code flow:
1. User requests /api/users/999 where 999 is a non-existent ID
2. findUser(999) is called and returns null
3. Code immediately accesses user.name without checking if user exists
4. TypeError is thrown because null has no 'name' property

This is a common pattern in database queries where the absence of a result needs explicit handling.`,
    fix_suggestion: `Add a null check before accessing user properties:

\`\`\`diff
export async function GET(req) {
  const id = req.params.id;
  const user = await findUser(id);

+ if (!user) {
+   return new Response('User not found', { status: 404 });
+ }

  return { name: user.name, email: user.email };
}
\`\`\`

Alternatively, use optional chaining with a fallback:
\`\`\`typescript
return { name: user?.name ?? 'Unknown', email: user?.email ?? '' };
\`\`\``,
    confidence: 0.87,
    evidence: {
      error_info: {
        message: "Cannot read property 'name' of undefined",
        type: "TypeError",
        stack_trace: [
          { file: "src/api/users/[id].ts", line: 42, function: "GET" },
          { file: "src/lib/router.ts", line: 156, function: "handleRequest" },
          {
            file: "node_modules/fastify/lib/route.js",
            line: 234,
            function: "routeHandler",
          },
        ],
      },
      code_context: {
        files: [
          {
            path: "src/api/users/[id].ts",
            content: `import { findUser } from '@/lib/db';

export async function GET(req) {
  const id = req.params.id;
  const user = await findUser(id);

  // BUG: Missing null check here
  return { name: user.name, email: user.email };
}`,
            highlighted_lines: [8],
          },
        ],
      },
      deterministic_findings: [
        {
          rule_id: "null-access",
          title: "Potential null/undefined property access",
          description:
            "Property 'name' is accessed on 'user' which may be null or undefined. The findUser function has a return type that includes null.",
          severity: "high",
          confidence: 0.92,
          evidence_refs: ["line-8-user.name"],
        },
        {
          rule_id: "missing-error-handling",
          title: "No error handling for database query",
          description:
            "The database query result is not validated before use. Consider adding error handling for the case when the query fails or returns no results.",
          severity: "medium",
          confidence: 0.78,
          evidence_refs: ["line-5-findUser"],
        },
      ],
    },
    llm_tokens_used: 1250,
    deterministic_only: false,
    created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  "rca-002": {
    id: "rca-002",
    event_id: "evt-003",
    title: "Database connection failure in worker process",
    summary:
      "The database connection was refused because the connection pool was exhausted. The worker process attempted to open more connections than the maximum allowed by the database server.",
    root_cause: `The root cause is connection pool exhaustion due to:
1. Connection pool size set too low (default 10)
2. Long-running transactions holding connections
3. Missing connection release in error paths

When the pool is exhausted, new connection requests fail with "Connection refused".`,
    fix_suggestion: `1. Increase connection pool size:
\`\`\`typescript
const pool = new Pool({
  max: 50, // Increase from default 10
  idleTimeoutMillis: 30000,
});
\`\`\`

2. Ensure connections are released:
\`\`\`typescript
const client = await pool.connect();
try {
  await client.query('...');
} finally {
  client.release(); // Always release
}
\`\`\``,
    confidence: 0.91,
    evidence: {
      error_info: {
        message: "Connection refused to database",
        type: "UnhandledPromiseRejection",
        stack_trace: [
          { file: "src/workers/sync.ts", line: 94, function: "syncData" },
          { file: "src/lib/db.ts", line: 23, function: "query" },
        ],
      },
      code_context: { files: [] },
      deterministic_findings: [
        {
          rule_id: "connection-leak",
          title: "Potential connection leak",
          description:
            "Database connections may not be properly released in all code paths.",
          severity: "high",
          confidence: 0.85,
          evidence_refs: [],
        },
      ],
    },
    llm_tokens_used: 980,
    deterministic_only: false,
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  },
  "rca-003": {
    id: "rca-003",
    event_id: "evt-005",
    title: "Null array passed to map function",
    summary:
      "The items array is null when the API response is empty, causing .map() to throw.",
    root_cause: "API returns null instead of empty array when no items exist.",
    fix_suggestion: "Use `items ?? []` or `items || []` before calling .map()",
    confidence: 0.82,
    evidence: {
      error_info: {
        message: "Cannot read property 'map' of null",
        type: "TypeError",
        stack_trace: [
          {
            file: "src/components/ItemList.tsx",
            line: 24,
            function: "ItemList",
          },
        ],
      },
      code_context: { files: [] },
      deterministic_findings: [],
    },
    llm_tokens_used: 650,
    deterministic_only: false,
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
};

/**
 * Integrations mock data
 */
export const mockIntegrations: Integration[] = [
  {
    id: "int-sentry",
    type: "sentry",
    name: "Sentry",
    status: "connected",
    configuredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    metadata: {
      organization: "buglens-demo",
      projects: ["web-app", "api-server"],
    },
  },
  {
    id: "int-github",
    type: "github",
    name: "GitHub",
    status: "connected",
    configuredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    metadata: { login: "buglens-bot", repos: 3 },
  },
  {
    id: "int-slack",
    type: "slack",
    name: "Slack",
    status: "disconnected",
  },
];

/**
 * Event detail mock data
 */
export const mockEventDetail = (eventId: string) => {
  const event = mockEvents.events.find((e) => e.id === eventId);
  if (!event) return null;

  return {
    ...event,
    sentry_issue_id: `ISSUE-${eventId.slice(-3)}`,
    raw_payload: {
      event_id: event.sentry_event_id,
      project: "buglens-demo",
      platform: event.platform,
      level: event.severity,
      message: event.message,
      timestamp: event.created_at,
      contexts: {
        browser: { name: "Chrome", version: "120.0" },
        os: { name: "macOS", version: "14.0" },
      },
      tags: {
        environment: event.environment,
        release: "v1.2.3",
      },
    },
    updated_at: event.created_at,
    rca_job: event.rca_result_id
      ? {
          id: `job-${eventId}`,
          status: event.status,
          rca_result_id: event.rca_result_id,
        }
      : undefined,
  };
};
