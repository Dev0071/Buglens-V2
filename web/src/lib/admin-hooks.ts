/**
 * Admin-specific React Query hooks for Buglens Admin Dashboard
 * Requires admin role + X-Admin-Token header for all operations
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./api-client";
import { useAdminStore } from "@/store/admin";

// ============================================
// Query Keys for Admin Operations
// ============================================

export const adminQueryKeys = {
  secrets: {
    all: ["admin", "secrets"] as const,
    status: () => [...adminQueryKeys.secrets.all, "status"] as const,
    versions: (type: string) =>
      [...adminQueryKeys.secrets.all, "versions", type] as const,
    history: (type: string) =>
      [...adminQueryKeys.secrets.all, "history", type] as const,
    alerts: (days?: number) =>
      [...adminQueryKeys.secrets.all, "alerts", days] as const,
  },
  organizations: {
    all: ["admin", "organizations"] as const,
    list: (params?: unknown) =>
      [...adminQueryKeys.organizations.all, "list", params] as const,
    detail: (id: string) =>
      [...adminQueryKeys.organizations.all, "detail", id] as const,
    usage: (id: string) =>
      [...adminQueryKeys.organizations.all, "usage", id] as const,
  },
  users: {
    all: ["admin", "users"] as const,
    list: (params?: unknown) =>
      [...adminQueryKeys.users.all, "list", params] as const,
    detail: (id: string) =>
      [...adminQueryKeys.users.all, "detail", id] as const,
  },
  system: {
    all: ["admin", "system"] as const,
    health: () => [...adminQueryKeys.system.all, "health"] as const,
    metrics: () => [...adminQueryKeys.system.all, "metrics"] as const,
    jobs: (params?: unknown) =>
      [...adminQueryKeys.system.all, "jobs", params] as const,
  },
  analytics: {
    all: ["admin", "analytics"] as const,
    global: () => [...adminQueryKeys.analytics.all, "global"] as const,
    costs: () => [...adminQueryKeys.analytics.all, "costs"] as const,
  },
  audit: {
    all: ["admin", "audit"] as const,
    logs: (params?: unknown) =>
      [...adminQueryKeys.audit.all, "logs", params] as const,
  },
};

// ============================================
// Admin API Client with Token Header
// ============================================

function getAdminHeaders(): Record<string, string> {
  const adminToken = useAdminStore.getState().adminToken;
  return adminToken ? { "X-Admin-Token": adminToken } : {};
}

async function adminRequest<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  endpoint: string,
  body?: unknown
): Promise<T> {
  const headers = getAdminHeaders();
  const options = { headers };

  switch (method) {
    case "GET":
      return apiClient.get<T>(endpoint, options);
    case "POST":
      return apiClient.post<T>(endpoint, body, options);
    case "PATCH":
      return apiClient.patch<T>(endpoint, body, options);
    case "DELETE":
      return apiClient.delete<T>(endpoint, options);
  }
}

// ============================================
// Types
// ============================================

export type SecretType =
  | "jwt_secret"
  | "encryption_key"
  | "github_webhook_secret"
  | "sentry_webhook_secret"
  | "openai_api_key";

export type SecretStatus = "healthy" | "expiring_soon" | "overdue" | "missing";

export interface SecretStatusItem {
  secret_type: SecretType;
  status: SecretStatus;
  current_key_id: string | null;
  last_rotated: string | null;
  next_rotation_due: string | null;
  days_until_expiration: number | null;
  version_count: number;
}

export interface SecretStatusResponse {
  secrets: SecretStatusItem[];
  summary: {
    total: number;
    healthy: number;
    expiring_soon: number;
    overdue: number;
    missing: number;
  };
  alerts: Array<{
    secret_type: SecretType;
    status: SecretStatus;
    days_until_expiration: number | null;
    message: string;
  }>;
}

export interface SecretVersion {
  id: string;
  version: number;
  key_id: string;
  status: "current" | "previous" | "deprecated";
  created_at: string;
  expires_at: string | null;
  rotation_interval_days: number;
}

export interface RotationHistoryEvent {
  id: string;
  old_key_id: string | null;
  new_key_id: string;
  rotation_status: "success" | "failed" | "rollback";
  rotation_reason: string;
  affected_records: number;
  duration_ms: number;
  error_message: string | null;
  created_at: string;
}

export interface RotateSecretParams {
  secret_type: SecretType;
  reason?: "manual" | "scheduled" | "security_incident" | "key_compromise";
  grace_period_days?: number;
}

export interface RotationResult {
  success: boolean;
  message: string;
  details?: {
    new_key_id: string;
    old_key_id: string | null;
    affected_records: number;
    duration_ms: number;
  };
  error?: string;
}

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro" | "enterprise";
  status: "active" | "suspended" | "deleted";
  created_at: string;
  owner_email: string;
  member_count: number;
  event_count_30d: number;
  rca_count_30d: number;
  llm_tokens_30d: number;
  cost_30d: number;
}

export interface AdminOrganizationDetail extends AdminOrganization {
  settings: Record<string, unknown>;
  integrations: Array<{
    type: string;
    status: "connected" | "disconnected";
    connected_at: string | null;
  }>;
  members: Array<{
    id: string;
    email: string;
    name: string;
    role: string;
    last_login: string | null;
  }>;
  usage_history: Array<{
    date: string;
    events: number;
    rcas: number;
    llm_tokens: number;
    cost: number;
  }>;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  org_id: string;
  org_name: string;
  role: "owner" | "admin" | "member";
  status: "active" | "suspended" | "pending";
  created_at: string;
  last_login: string | null;
  login_count: number;
}

export interface SystemHealth {
  status: "healthy" | "degraded" | "critical";
  timestamp: string;
  services: {
    database: { status: string; latency_ms: number };
    redis: { status: string; latency_ms: number };
    s3: { status: string; latency_ms: number };
    github_api: { status: string; rate_limit_remaining: number };
  };
  queues: {
    rca_jobs: {
      waiting: number;
      active: number;
      completed_24h: number;
      failed_24h: number;
    };
  };
  metrics: {
    cpu_usage: number;
    memory_usage: number;
    active_connections: number;
  };
}

export interface GlobalAnalytics {
  period: string;
  organizations: {
    total: number;
    active_30d: number;
    new_30d: number;
  };
  users: {
    total: number;
    active_30d: number;
    new_30d: number;
  };
  events: {
    total: number;
    last_30d: number;
    by_severity: Record<string, number>;
  };
  rcas: {
    total: number;
    last_30d: number;
    success_rate: number;
    avg_latency_ms: number;
  };
  costs: {
    total_30d: number;
    llm_costs: number;
    github_api_costs: number;
    infrastructure_costs: number;
  };
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  actor_type: "user" | "system" | "api";
  action: string;
  resource_type: string;
  resource_id: string;
  details: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
}

// ============================================
// Secret Management Hooks
// ============================================

/**
 * Get rotation status for all managed secrets
 */
export function useSecretStatus() {
  return useQuery({
    queryKey: adminQueryKeys.secrets.status(),
    queryFn: async (): Promise<SecretStatusResponse> => {
      return adminRequest<SecretStatusResponse>("GET", "/admin/secrets/status");
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refresh every minute
  });
}

/**
 * Get all versions of a specific secret
 */
export function useSecretVersions(secretType: SecretType) {
  return useQuery({
    queryKey: adminQueryKeys.secrets.versions(secretType),
    queryFn: async (): Promise<{
      secret_type: SecretType;
      versions: SecretVersion[];
    }> => {
      return adminRequest<{
        secret_type: SecretType;
        versions: SecretVersion[];
      }>("GET", `/admin/secrets/${secretType}/versions`);
    },
    enabled: !!secretType,
    staleTime: 60 * 1000,
  });
}

/**
 * Get rotation history for a secret
 */
export function useSecretHistory(secretType: SecretType, limit = 20) {
  return useQuery({
    queryKey: adminQueryKeys.secrets.history(secretType),
    queryFn: async (): Promise<{
      secret_type: SecretType;
      history: RotationHistoryEvent[];
    }> => {
      return adminRequest<{
        secret_type: SecretType;
        history: RotationHistoryEvent[];
      }>("GET", `/admin/secrets/${secretType}/history?limit=${limit}`);
    },
    enabled: !!secretType,
    staleTime: 60 * 1000,
  });
}

/**
 * Get secrets needing attention (expiring soon or overdue)
 */
export function useSecretAlerts(warningDays = 14) {
  return useQuery({
    queryKey: adminQueryKeys.secrets.alerts(warningDays),
    queryFn: async () => {
      return adminRequest<{
        warning_threshold_days: number;
        alert_count: number;
        alerts: Array<{
          secret_type: SecretType;
          status: SecretStatus;
          current_key_id: string | null;
          last_rotated: string | null;
          next_rotation_due: string | null;
          days_until_expiration: number | null;
          recommended_action: string;
        }>;
      }>("GET", `/admin/secrets/alerts?warning_days=${warningDays}`);
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Rotate a secret (mutation)
 */
export function useRotateSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: RotateSecretParams): Promise<RotationResult> => {
      return adminRequest<RotationResult>(
        "POST",
        "/admin/secrets/rotate",
        params
      );
    },
    onSuccess: () => {
      // Invalidate all secret-related queries
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.secrets.all });
    },
  });
}

/**
 * Rollback a secret rotation (mutation)
 */
export function useRollbackSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (secretType: SecretType): Promise<RotationResult> => {
      return adminRequest<RotationResult>("POST", "/admin/secrets/rollback", {
        secret_type: secretType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.secrets.all });
    },
  });
}

/**
 * Cleanup expired secrets (mutation)
 */
export function useCleanupSecrets() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<{
      success: boolean;
      message: string;
      deleted_count: number;
    }> => {
      return adminRequest<{
        success: boolean;
        message: string;
        deleted_count: number;
      }>("POST", "/admin/secrets/cleanup");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.secrets.all });
    },
  });
}

// ============================================
// Organization Management Hooks
// ============================================

interface OrganizationsListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  plan?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/**
 * List all organizations with pagination and filtering
 */
export function useAdminOrganizations(params: OrganizationsListParams = {}) {
  return useQuery({
    queryKey: adminQueryKeys.organizations.list(params),
    queryFn: async (): Promise<{
      organizations: AdminOrganization[];
      total: number;
      page: number;
      pageSize: number;
    }> => {
      const queryParams = new URLSearchParams();
      if (params.page) queryParams.set("page", String(params.page));
      if (params.pageSize) queryParams.set("pageSize", String(params.pageSize));
      if (params.search) queryParams.set("search", params.search);
      if (params.plan) queryParams.set("plan", params.plan);
      if (params.status) queryParams.set("status", params.status);
      if (params.sortBy) queryParams.set("sortBy", params.sortBy);
      if (params.sortOrder) queryParams.set("sortOrder", params.sortOrder);

      return adminRequest<{
        organizations: AdminOrganization[];
        total: number;
        page: number;
        pageSize: number;
      }>("GET", `/admin/organizations?${queryParams.toString()}`);
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Get detailed information about a specific organization
 */
export function useAdminOrganizationDetail(orgId: string) {
  return useQuery({
    queryKey: adminQueryKeys.organizations.detail(orgId),
    queryFn: async (): Promise<AdminOrganizationDetail> => {
      return adminRequest<AdminOrganizationDetail>(
        "GET",
        `/admin/organizations/${orgId}`
      );
    },
    enabled: !!orgId,
    staleTime: 60 * 1000,
  });
}

/**
 * Suspend/unsuspend an organization (mutation)
 */
export function useSuspendOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orgId,
      suspend,
      reason,
    }: {
      orgId: string;
      suspend: boolean;
      reason?: string;
    }) => {
      return adminRequest<{ success: boolean }>(
        "POST",
        `/admin/organizations/${orgId}/${suspend ? "suspend" : "unsuspend"}`,
        { reason }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.organizations.all,
      });
    },
  });
}

// ============================================
// User Management Hooks
// ============================================

interface UsersListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: string;
  status?: string;
  orgId?: string;
}

/**
 * List all users with pagination and filtering
 */
export function useAdminUsers(params: UsersListParams = {}) {
  return useQuery({
    queryKey: adminQueryKeys.users.list(params),
    queryFn: async (): Promise<{
      users: AdminUser[];
      total: number;
      page: number;
      pageSize: number;
    }> => {
      const queryParams = new URLSearchParams();
      if (params.page) queryParams.set("page", String(params.page));
      if (params.pageSize) queryParams.set("pageSize", String(params.pageSize));
      if (params.search) queryParams.set("search", params.search);
      if (params.role) queryParams.set("role", params.role);
      if (params.status) queryParams.set("status", params.status);
      if (params.orgId) queryParams.set("orgId", params.orgId);

      return adminRequest<{
        users: AdminUser[];
        total: number;
        page: number;
        pageSize: number;
      }>("GET", `/admin/users?${queryParams.toString()}`);
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Get detailed information about a specific user
 */
export function useAdminUserDetail(userId: string) {
  return useQuery({
    queryKey: adminQueryKeys.users.detail(userId),
    queryFn: async () => {
      return adminRequest<
        AdminUser & {
          activity: Array<{
            action: string;
            timestamp: string;
            details: string;
          }>;
          sessions: Array<{
            id: string;
            ip_address: string;
            user_agent: string;
            created_at: string;
            last_active: string;
          }>;
        }
      >("GET", `/admin/users/${userId}`);
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

/**
 * Suspend/unsuspend a user (mutation)
 */
export function useSuspendUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      suspend,
      reason,
    }: {
      userId: string;
      suspend: boolean;
      reason?: string;
    }) => {
      return adminRequest<{ success: boolean }>(
        "POST",
        `/admin/users/${userId}/${suspend ? "suspend" : "unsuspend"}`,
        { reason }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users.all });
    },
  });
}

// ============================================
// System Health Hooks
// ============================================

/**
 * Get system health status
 */
export function useSystemHealth() {
  return useQuery({
    queryKey: adminQueryKeys.system.health(),
    queryFn: async (): Promise<SystemHealth> => {
      return adminRequest<SystemHealth>("GET", "/admin/system/health");
    },
    staleTime: 10 * 1000, // 10 seconds
    refetchInterval: 30 * 1000, // Refresh every 30 seconds
  });
}

/**
 * Get RCA job queue status
 */
export function useJobQueue(params: { status?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: adminQueryKeys.system.jobs(params),
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      if (params.status) queryParams.set("status", params.status);
      if (params.limit) queryParams.set("limit", String(params.limit));

      return adminRequest<{
        jobs: Array<{
          id: string;
          event_id: string;
          org_id: string;
          status: string;
          created_at: string;
          started_at: string | null;
          completed_at: string | null;
          error: string | null;
          attempts: number;
        }>;
        total: number;
        queue_stats: {
          waiting: number;
          active: number;
          completed: number;
          failed: number;
        };
      }>("GET", `/admin/system/jobs?${queryParams.toString()}`);
    },
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
  });
}

/**
 * Retry a failed job (mutation)
 */
export function useRetryJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      return adminRequest<{ success: boolean; message: string }>(
        "POST",
        `/admin/system/jobs/${jobId}/retry`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.system.jobs() });
    },
  });
}

// ============================================
// Global Analytics Hooks
// ============================================

/**
 * Get global platform analytics
 */
export function useGlobalAnalytics() {
  return useQuery({
    queryKey: adminQueryKeys.analytics.global(),
    queryFn: async (): Promise<GlobalAnalytics> => {
      return adminRequest<GlobalAnalytics>("GET", "/admin/system/analytics");
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Get global cost breakdown
 */
export function useGlobalCosts() {
  return useQuery({
    queryKey: adminQueryKeys.analytics.costs(),
    queryFn: async () => {
      return adminRequest<{
        total: number;
        by_category: Record<string, number>;
        by_organization: Array<{
          org_id: string;
          org_name: string;
          cost: number;
          percentage: number;
        }>;
        trend: Array<{
          date: string;
          cost: number;
        }>;
      }>("GET", "/admin/analytics/costs");
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ============================================
// Audit Log Hooks
// ============================================

interface AuditLogParams {
  page?: number;
  pageSize?: number;
  action?: string;
  actor_id?: string;
  resource_type?: string;
  start_date?: string;
  end_date?: string;
}

/**
 * Get audit logs with filtering
 */
export function useAuditLogs(params: AuditLogParams = {}) {
  return useQuery({
    queryKey: adminQueryKeys.audit.logs(params),
    queryFn: async (): Promise<{
      logs: AuditLogEntry[];
      total: number;
      page: number;
      pageSize: number;
    }> => {
      const queryParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.set(key, String(value));
      });

      return adminRequest<{
        logs: AuditLogEntry[];
        total: number;
        page: number;
        pageSize: number;
      }>("GET", `/admin/audit/logs?${queryParams.toString()}`);
    },
    staleTime: 30 * 1000,
  });
}
