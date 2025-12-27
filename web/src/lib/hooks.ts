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
      return apiClient.get<DashboardStats>("/dashboard/stats");
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
      return apiClient.get<RecentEvent[]>(
        `/dashboard/recent-events?limit=${limit}`
      );
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

      return apiClient.get<EventsResponse>(`/events?${queryParams}`);
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

      return apiClient.get<EventDetail>(`/events/${eventId}`);
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

      return apiClient.get<RCAResult>(`/rca/${rcaId}`);
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

      return apiClient.get<RCAResult>(`/events/${eventId}/rca`);
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
      return apiClient.get<Integration[]>("/integrations");
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
      return apiClient.get<CostSummary>("/costs/summary");
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
      return apiClient.get<OrganizationSettings>("/settings/organization");
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
      return apiClient.post("/rca/feedback", feedback);
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
      return apiClient.post(`/events/${eventId}/reanalyze`, {});
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
      return apiClient.patch("/settings/organization", settings);
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
      return apiClient.post(`/integrations/${type}/connect`, config);
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
      return apiClient.delete(`/integrations/${integrationId}`);
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

export interface RCAQualityData {
  period: string;
  totalRCAs: number;
  qualityBreakdown: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  };
  percentages: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  };
  avgConfidence: number;
  avgProcessingTime: number;
}

/**
 * Fetch RCA quality metrics for the last 7 days
 */
export function useRCAQuality() {
  return useQuery({
    queryKey: queryKeys.analytics.rcaQuality(),
    queryFn: async (): Promise<RCAQualityData> => {
      if (isMockMode()) {
        await mockDelay(300);
        return {
          period: "7d",
          totalRCAs: 47,
          qualityBreakdown: {
            highConfidence: 39,
            mediumConfidence: 6,
            lowConfidence: 2,
          },
          percentages: {
            highConfidence: 82,
            mediumConfidence: 12,
            lowConfidence: 6,
          },
          avgConfidence: 0.82,
          avgProcessingTime: 23.5,
        };
      }
      return apiClient.get<RCAQualityData>("/analytics/rca-quality");
    },
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });
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
        `/analytics/summary?period=${period}`
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
        `/analytics/daily?period=${period}`
      );
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ============================================================================
// Billing Hooks
// ============================================================================

export interface BillingUsage {
  plan: "free" | "pro" | "enterprise";
  limits: {
    eventsPerDay: number;
    llmTokensPerDay: number;
    usersAllowed: number;
  };
  usage: {
    eventsToday: number;
    llmTokensToday: number;
    teamMembers: number;
  };
}

/**
 * Fetch billing usage and plan information
 */
export function useBillingUsage() {
  return useQuery({
    queryKey: queryKeys.settings.billing(),
    queryFn: async (): Promise<BillingUsage> => {
      if (isMockMode()) {
        await mockDelay(300);
        return {
          plan: "pro",
          limits: {
            eventsPerDay: 1000,
            llmTokensPerDay: 500000,
            usersAllowed: 10,
          },
          usage: {
            eventsToday: 234,
            llmTokensToday: 125000,
            teamMembers: 3,
          },
        };
      }
      return apiClient.get<BillingUsage>("/settings/billing/usage");
    },
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Upgrade organization plan (mutation)
 */
export function useUpgradePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (plan: "free" | "pro" | "enterprise") => {
      if (isMockMode()) {
        await mockDelay(800);
        return { success: true, plan };
      }
      return apiClient.post("/settings/billing/upgrade", { plan });
    },
    onSuccess: () => {
      // Invalidate billing and organization queries
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.billing(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.organization(),
      });
    },
  });
}

/**
 * Delete organization (mutation)
 */
export function useDeleteOrganization() {
  return useMutation({
    mutationFn: async () => {
      if (isMockMode()) {
        await mockDelay(500);
        return { success: true };
      }
      return apiClient.delete("/settings/organization");
    },
  });
}

// ============================================================================
// Team Management Hooks
// ============================================================================

export interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  isActive: boolean;
  avatarUrl: string | null;
  githubUsername: string | null;
  slackUserId: string | null;
  createdAt: string;
  lastActiveAt: string | null;
}

export interface TeamMembersResponse {
  members: TeamMember[];
  total: number;
}

/**
 * Fetch team members for the organization
 */
export function useTeamMembers() {
  return useQuery({
    queryKey: queryKeys.team.members(),
    queryFn: async (): Promise<TeamMembersResponse> => {
      if (isMockMode()) {
        await mockDelay(300);
        return {
          members: [
            {
              id: "user-1",
              email: "owner@company.com",
              name: "Sarah Chen",
              role: "owner",
              isActive: true,
              avatarUrl: null,
              githubUsername: "sarahchen",
              slackUserId: "U12345",
              createdAt: new Date(
                Date.now() - 90 * 24 * 60 * 60 * 1000
              ).toISOString(),
              lastActiveAt: new Date().toISOString(),
            },
            {
              id: "user-2",
              email: "admin@company.com",
              name: "Mike Johnson",
              role: "admin",
              isActive: true,
              avatarUrl: null,
              githubUsername: "mikej",
              slackUserId: "U12346",
              createdAt: new Date(
                Date.now() - 60 * 24 * 60 * 60 * 1000
              ).toISOString(),
              lastActiveAt: new Date(
                Date.now() - 2 * 60 * 60 * 1000
              ).toISOString(),
            },
            {
              id: "user-3",
              email: "member@company.com",
              name: "Emily Davis",
              role: "member",
              isActive: true,
              avatarUrl: null,
              githubUsername: null,
              slackUserId: null,
              createdAt: new Date(
                Date.now() - 30 * 24 * 60 * 60 * 1000
              ).toISOString(),
              lastActiveAt: new Date(
                Date.now() - 24 * 60 * 60 * 1000
              ).toISOString(),
            },
          ],
          total: 3,
        };
      }
      return apiClient.get<TeamMembersResponse>("/team/members");
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Invite a new team member (mutation)
 */
export function useInviteMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      email: string;
      role: "admin" | "member";
      name?: string;
    }) => {
      if (isMockMode()) {
        await mockDelay(500);
        return {
          message: "Member invited successfully",
          member: {
            id: `user-${Date.now()}`,
            email: data.email,
            name: data.name || null,
            role: data.role,
            isActive: true,
            avatarUrl: null,
            githubUsername: null,
            slackUserId: null,
            createdAt: new Date().toISOString(),
            lastActiveAt: null,
          },
        };
      }
      return apiClient.post("/team/members", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.team.members() });
    },
  });
}

/**
 * Update team member role (mutation)
 */
export function useUpdateMemberRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      memberId: string;
      role: "admin" | "member";
    }) => {
      if (isMockMode()) {
        await mockDelay(300);
        return { message: "Role updated successfully" };
      }
      return apiClient.patch(`/team/members/${data.memberId}/role`, {
        role: data.role,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.team.members() });
    },
  });
}

/**
 * Remove team member (mutation)
 */
export function useRemoveMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (memberId: string) => {
      if (isMockMode()) {
        await mockDelay(300);
        return { message: "Member removed successfully" };
      }
      return apiClient.delete(`/team/members/${memberId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.team.members() });
    },
  });
}

// ============================================================================
// Profile Hooks
// ============================================================================

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
  emailVerified: boolean;
  authProvider: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface NotificationPreferences {
  emailNotifications: boolean;
  slackNotifications: boolean;
  dailyDigest: boolean;
  weeklyReport: boolean;
  notificationLevel: "all" | "high" | "critical" | "none";
}

/**
 * Fetch user profile
 */
export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile.details(),
    queryFn: async (): Promise<{ profile: UserProfile }> => {
      if (isMockMode()) {
        await mockDelay(300);
        return {
          profile: {
            id: "user-1",
            email: "user@example.com",
            name: "John Doe",
            avatarUrl: null,
            role: "owner",
            emailVerified: true,
            authProvider: "email",
            createdAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
          },
        };
      }
      return apiClient.get<{ profile: UserProfile }>("/profile");
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Update user profile (mutation)
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { name?: string; avatarUrl?: string | null }) => {
      if (isMockMode()) {
        await mockDelay(500);
        return {
          success: true,
          profile: {
            id: "user-1",
            email: "user@example.com",
            name: data.name || "John Doe",
            avatarUrl: data.avatarUrl || null,
            role: "owner",
          },
          message: "Profile updated successfully",
        };
      }
      return apiClient.patch("/profile", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.details() });
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
    },
  });
}

/**
 * Change user password (mutation)
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (data: {
      currentPassword: string;
      newPassword: string;
    }) => {
      if (isMockMode()) {
        await mockDelay(500);
        return { success: true, message: "Password changed successfully" };
      }
      return apiClient.post("/profile/change-password", data);
    },
  });
}

/**
 * Fetch notification preferences
 */
export function useNotificationPreferences() {
  return useQuery({
    queryKey: queryKeys.profile.notifications(),
    queryFn: async (): Promise<{ preferences: NotificationPreferences }> => {
      if (isMockMode()) {
        await mockDelay(300);
        return {
          preferences: {
            emailNotifications: true,
            slackNotifications: true,
            dailyDigest: false,
            weeklyReport: false,
            notificationLevel: "high",
          },
        };
      }
      return apiClient.get<{ preferences: NotificationPreferences }>(
        "/profile/notifications"
      );
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Update notification preferences (mutation)
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<NotificationPreferences>) => {
      if (isMockMode()) {
        await mockDelay(500);
        return {
          success: true,
          preferences: data,
          message: "Notification preferences updated",
        };
      }
      return apiClient.patch("/profile/notifications", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.profile.notifications(),
      });
    },
  });
}

/**
 * Delete user account (mutation)
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      if (isMockMode()) {
        await mockDelay(500);
        return { success: true, message: "Account deleted successfully" };
      }
      return apiClient.delete("/profile");
    },
  });
}
