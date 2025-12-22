/**
 * React Query hooks for Buglens API
 * Uses mock data in development mode
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "./api-client";
import {
  isMockMode,
  mockDelay,
  mockDashboardStats,
  mockRecentEvents,
  mockEvents,
  mockRCAResults,
  mockIntegrations,
  mockEventDetail,
} from "./mock-data";
import type {
  DashboardStats,
  RecentEvent,
  EventsResponse,
  EventsQueryParams,
  EventDetail,
  RCAResult,
  Integration,
  RCAFeedback,
  CostSummary,
  OrganizationSettings,
} from "@/types/api";

/**
 * Fetch dashboard stats (total events, resolution rate, etc.)
 */
export function useDashboardStats() {
  return useQuery({
    queryKey: queryKeys.dashboard.stats(),
    queryFn: async (): Promise<DashboardStats> => {
      if (isMockMode()) {
        await mockDelay(300);
        return mockDashboardStats;
      }
      return apiClient.get<DashboardStats>("/api/dashboard/stats");
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refresh every minute
  });
}

/**
 * Fetch recent events for dashboard widget
 */
export function useRecentEvents(limit = 5) {
  return useQuery({
    queryKey: queryKeys.dashboard.recentEvents(limit),
    queryFn: async (): Promise<RecentEvent[]> => {
      if (isMockMode()) {
        await mockDelay(400);
        return mockRecentEvents.slice(0, limit);
      }
      return apiClient.get<RecentEvent[]>(`/api/events/recent?limit=${limit}`);
    },
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });
}

/**
 * Fetch paginated events list
 */
export function useEventsList(params: EventsQueryParams = {}) {
  const { page = 1, pageSize = 20, severity, status, search } = params;

  return useQuery({
    queryKey: queryKeys.events.list(params as Record<string, unknown>),
    queryFn: async (): Promise<EventsResponse> => {
      if (isMockMode()) {
        await mockDelay(500);

        // Filter mock events based on params
        let filtered = [...mockEvents.events];

        if (severity) {
          filtered = filtered.filter((e) => e.severity === severity);
        }
        if (status) {
          filtered = filtered.filter((e) => e.status === status);
        }
        if (search) {
          const searchLower = search.toLowerCase();
          filtered = filtered.filter(
            (e) =>
              e.message.toLowerCase().includes(searchLower) ||
              e.sentry_event_id.toLowerCase().includes(searchLower)
          );
        }

        // Paginate
        const start = (page - 1) * pageSize;
        const paginated = filtered.slice(start, start + pageSize);

        return {
          events: paginated,
          total: filtered.length,
          page,
          pageSize,
          totalPages: Math.ceil(filtered.length / pageSize),
        };
      }

      const queryParams = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(severity && { severity }),
        ...(status && { status }),
        ...(search && { search }),
      });

      return apiClient.get<EventsResponse>(`/api/events?${queryParams}`);
    },
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Fetch single event detail
 */
export function useEventDetail(eventId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.events.detail(eventId ?? ""),
    queryFn: async (): Promise<EventDetail | null> => {
      if (!eventId) return null;

      if (isMockMode()) {
        await mockDelay(300);
        return mockEventDetail(eventId);
      }

      return apiClient.get<EventDetail>(`/api/events/${eventId}`);
    },
    enabled: !!eventId,
  });
}

/**
 * Fetch RCA result by ID
 */
export function useRCAResult(rcaId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.rca.detail(rcaId ?? ""),
    queryFn: async (): Promise<RCAResult | null> => {
      if (!rcaId) return null;

      if (isMockMode()) {
        await mockDelay(400);
        return mockRCAResults[rcaId] ?? null;
      }

      return apiClient.get<RCAResult>(`/api/rca/${rcaId}`);
    },
    enabled: !!rcaId,
  });
}

/**
 * Fetch RCA result by event ID
 */
export function useRCAByEventId(eventId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.rca.byEventId(eventId ?? ""),
    queryFn: async (): Promise<RCAResult | null> => {
      if (!eventId) return null;

      if (isMockMode()) {
        await mockDelay(400);
        // Find RCA that matches the event ID
        const rca = Object.values(mockRCAResults).find(
          (r) => r.event_id === eventId
        );
        return rca ?? null;
      }

      return apiClient.get<RCAResult>(`/api/events/${eventId}/rca`);
    },
    enabled: !!eventId,
  });
}

/**
 * Fetch all integrations
 */
export function useIntegrations() {
  return useQuery({
    queryKey: queryKeys.integrations.list(),
    queryFn: async (): Promise<Integration[]> => {
      if (isMockMode()) {
        await mockDelay(300);
        return mockIntegrations;
      }
      return apiClient.get<Integration[]>("/api/integrations");
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Fetch cost summary
 */
export function useCostSummary() {
  return useQuery({
    queryKey: queryKeys.costs.summary(),
    queryFn: async (): Promise<CostSummary> => {
      if (isMockMode()) {
        await mockDelay(500);
        return {
          currentMonth: {
            totalCost: 45.67,
            llmCost: 42.3,
            tokenCount: 2_150_000,
            eventsProcessed: 1_450,
          },
          previousMonth: {
            totalCost: 38.2,
            llmCost: 35.0,
          },
          dailyMetrics: Array.from({ length: 14 }, (_, i) => ({
            date: new Date(Date.now() - (13 - i) * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0],
            llm_tokens_used: 150_000 + Math.floor(Math.random() * 50_000),
            llm_cost_usd: 2.5 + Math.random() * 1.5,
            github_requests: 500 + Math.floor(Math.random() * 200),
            events_processed: 80 + Math.floor(Math.random() * 40),
          })),
          projectedMonthlyCost: 52.0,
        };
      }
      return apiClient.get<CostSummary>("/api/costs/summary");
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Fetch organization settings
 */
export function useOrganizationSettings() {
  return useQuery({
    queryKey: queryKeys.settings.organization(),
    queryFn: async (): Promise<OrganizationSettings> => {
      if (isMockMode()) {
        await mockDelay(300);
        return {
          id: "org-demo",
          name: "Buglens Demo",
          plan: "pro",
          limits: {
            eventsPerDay: 1000,
            llmTokensPerDay: 500_000,
            usersAllowed: 10,
          },
          notifications: {
            slack: {
              enabled: true,
              channel: "#bugs",
              notifyOnComplete: true,
              notifyOnError: true,
            },
            email: {
              enabled: false,
              addresses: [],
            },
          },
        };
      }
      return apiClient.get<OrganizationSettings>("/api/settings/organization");
    },
  });
}

/**
 * Submit RCA feedback (mutation)
 */
export function useSubmitRCAFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (feedback: RCAFeedback) => {
      if (isMockMode()) {
        await mockDelay(300);
        // Mock success
        return { success: true, feedbackId: `fb-${Date.now()}` };
      }
      return apiClient.post("/api/rca/feedback", feedback);
    },
    onSuccess: (_data, variables) => {
      // Invalidate the RCA query to refresh
      queryClient.invalidateQueries({
        queryKey: queryKeys.rca.detail(variables.rcaId),
      });
    },
  });
}

/**
 * Trigger re-analysis of an event (mutation)
 */
export function useReanalyzeEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (eventId: string) => {
      if (isMockMode()) {
        await mockDelay(800);
        return { jobId: `job-${Date.now()}`, status: "processing" };
      }
      return apiClient.post(`/api/events/${eventId}/reanalyze`, {});
    },
    onSuccess: (_data, eventId) => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({
        queryKey: queryKeys.events.detail(eventId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.rca.byEventId(eventId),
      });
    },
  });
}

/**
 * Update organization settings (mutation)
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: Partial<OrganizationSettings>) => {
      if (isMockMode()) {
        await mockDelay(500);
        return { success: true };
      }
      return apiClient.patch("/api/settings/organization", settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.organization(),
      });
    },
  });
}

/**
 * Connect integration (mutation)
 */
export function useConnectIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      type,
      config,
    }: {
      type: string;
      config: Record<string, unknown>;
    }) => {
      if (isMockMode()) {
        await mockDelay(1000);
        return { success: true, integrationId: `int-${type}` };
      }
      return apiClient.post(`/api/integrations/${type}/connect`, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.list(),
      });
    },
  });
}

/**
 * Disconnect integration (mutation)
 */
export function useDisconnectIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (integrationId: string) => {
      if (isMockMode()) {
        await mockDelay(500);
        return { success: true };
      }
      return apiClient.delete(`/api/integrations/${integrationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.list(),
      });
    },
  });
}

// ============================================================================
// Analytics Hooks
// ============================================================================

export interface AnalyticsSummary {
  totalCost: number;
  costChange: number;
  totalTokens: number;
  tokenChange: number;
  totalRCAs: number;
  rcaChange: number;
  avgCostPerRCA: number;
  avgTimePerRCA: number;
  roi: number;
  budgetUsed: number;
  budgetLimit: number;
  qualityBreakdown: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  };
}

export interface DailyAnalytics {
  date: string;
  events: number;
  rcas: number;
  tokens: number;
  cost: number;
  avgConfidence: number;
}

/**
 * Fetch analytics summary for a given time period
 */
export function useAnalyticsSummary(period: "7d" | "30d" | "90d" = "30d") {
  return useQuery({
    queryKey: ["analytics", "summary", period],
    queryFn: async (): Promise<AnalyticsSummary> => {
      if (isMockMode()) {
        await mockDelay(400);

        // Generate realistic mock data based on period
        const multiplier = period === "7d" ? 1 : period === "30d" ? 4 : 12;

        return {
          totalCost: 45.67 * multiplier + Math.random() * 10,
          costChange: -8.5 + Math.random() * 20,
          totalTokens: 2_150_000 * multiplier,
          tokenChange: -5 + Math.random() * 15,
          totalRCAs: 156 * multiplier,
          rcaChange: 12 + Math.random() * 10,
          avgCostPerRCA: 0.12 + Math.random() * 0.05,
          avgTimePerRCA: 23 + Math.random() * 10,
          roi: 180 + Math.random() * 50,
          budgetUsed: 45.67 * multiplier,
          budgetLimit: 100 * multiplier,
          qualityBreakdown: {
            highConfidence: Math.floor(100 * multiplier + Math.random() * 20),
            mediumConfidence: Math.floor(40 * multiplier + Math.random() * 10),
            lowConfidence: Math.floor(16 * multiplier + Math.random() * 5),
          },
        };
      }
      return apiClient.get<AnalyticsSummary>(
        `/api/analytics/summary?period=${period}`
      );
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Fetch daily analytics data for charts
 */
export function useDailyAnalytics(period: "7d" | "30d" | "90d" = "30d") {
  return useQuery({
    queryKey: ["analytics", "daily", period],
    queryFn: async (): Promise<DailyAnalytics[]> => {
      if (isMockMode()) {
        await mockDelay(500);

        const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
        const data: DailyAnalytics[] = [];

        for (let i = days - 1; i >= 0; i--) {
          const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
          data.push({
            date: date.toISOString().split("T")[0],
            events: Math.floor(30 + Math.random() * 50),
            rcas: Math.floor(25 + Math.random() * 40),
            tokens: Math.floor(50000 + Math.random() * 30000),
            cost: 1.2 + Math.random() * 2,
            avgConfidence: 0.7 + Math.random() * 0.2,
          });
        }

        return data;
      }
      return apiClient.get<DailyAnalytics[]>(
        `/api/analytics/daily?period=${period}`
      );
    },
    staleTime: 5 * 60 * 1000,
  });
}
