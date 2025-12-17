import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * Create a wrapper component for testing with all providers
 */
export function createTestWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ThemeProvider defaultTheme="light" storageKey="test-theme">
            {children}
          </ThemeProvider>
        </BrowserRouter>
      </QueryClientProvider>
    );
  };
}

/**
 * Create a fresh query client for each test
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

/**
 * Mock API responses
 */
export const mockApiResponses = {
  dashboardStats: {
    totalEvents: 156,
    eventsChange: 12,
    resolvedRCAs: 89,
    resolvedChange: 8,
    avgResolutionTime: 23,
    resolutionTimeChange: -5,
    pendingAnalysis: 7,
  },

  recentEvents: [
    {
      id: "evt-1",
      message: "TypeError: Cannot read property 'name' of undefined",
      severity: "high",
      status: "completed",
      createdAt: new Date().toISOString(),
      rcaId: "rca-1",
    },
    {
      id: "evt-2",
      message: "ReferenceError: variable is not defined",
      severity: "medium",
      status: "processing",
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    },
  ],

  eventsList: {
    events: [
      {
        id: "evt-1",
        sentry_event_id: "abc123",
        message: "TypeError: Cannot read property 'name' of undefined",
        platform: "javascript",
        severity: "high",
        environment: "production",
        status: "completed",
        created_at: new Date().toISOString(),
        rca_result_id: "rca-1",
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  },

  rcaResult: {
    id: "rca-1",
    event_id: "evt-1",
    title: "Null reference in user profile handler",
    summary:
      "The error occurs when accessing a user object that was not found in the database.",
    root_cause: "Missing null check before accessing user.name property.",
    fix_suggestion:
      "Add null check: if (!user) return null; before accessing properties.",
    confidence: 0.85,
    evidence: {
      error_info: {
        message: "Cannot read property 'name' of undefined",
        type: "TypeError",
        stack_trace: [
          {
            file: "src/handlers/user.ts",
            line: 42,
            function: "getUserProfile",
          },
        ],
      },
      code_context: { files: [] },
      deterministic_findings: [
        {
          rule_id: "null-access",
          title: "Potential null access",
          description: "Property access without null check detected",
          severity: "high",
          confidence: 0.9,
          evidence_refs: ["line-42"],
        },
      ],
    },
    llm_tokens_used: 1250,
    deterministic_only: false,
    created_at: new Date().toISOString(),
  },

  integrations: [
    {
      id: "sentry",
      type: "sentry",
      name: "Sentry",
      status: "connected",
      metadata: { organization: "my-org" },
    },
    {
      id: "github",
      type: "github",
      name: "GitHub",
      status: "connected",
      metadata: { login: "myuser" },
    },
    { id: "slack", type: "slack", name: "Slack", status: "disconnected" },
  ],

  authUser: {
    user: {
      id: "user-1",
      email: "test@example.com",
      name: "Test User",
      orgId: "org-1",
      orgName: "Test Org",
      role: "admin",
    },
    organization: {
      id: "org-1",
      name: "Test Org",
      plan: "pro",
      createdAt: new Date().toISOString(),
    },
    accessToken: "test-token",
  },
};

export {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  render,
  screen,
  waitFor,
  fireEvent,
};
