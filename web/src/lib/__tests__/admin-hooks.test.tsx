/**
 * Admin Hooks Tests
 *
 * Tests for React Query admin hooks
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import {
  useSecretStatus,
  useAdminOrganizations,
  useAdminUsers,
  useSystemHealth,
  useAuditLogs,
  adminQueryKeys,
} from "../admin-hooks";
// Note: useAdminStore is mocked in vi.mock but imported for type reference
import type { useAdminStore as UseAdminStoreType } from "@/store/admin";

// Suppress unused variable - this type is just for documentation
void (0 as unknown as typeof UseAdminStoreType);

// Mock the API client
vi.mock("../api-client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiClient } from "../api-client";

// Mock admin store
vi.mock("@/store/admin", () => ({
  useAdminStore: {
    getState: vi.fn(() => ({ adminToken: "test-admin-token" })),
  },
}));

// Create a wrapper with QueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return Wrapper;
}

describe("Admin Query Keys", () => {
  it("generates correct keys for secrets", () => {
    expect(adminQueryKeys.secrets.all).toEqual(["admin", "secrets"]);
    expect(adminQueryKeys.secrets.status()).toEqual([
      "admin",
      "secrets",
      "status",
    ]);
    expect(adminQueryKeys.secrets.versions("jwt_secret")).toEqual([
      "admin",
      "secrets",
      "versions",
      "jwt_secret",
    ]);
  });

  it("generates correct keys for organizations", () => {
    expect(adminQueryKeys.organizations.all).toEqual([
      "admin",
      "organizations",
    ]);
    expect(adminQueryKeys.organizations.list({ page: 1 })).toEqual([
      "admin",
      "organizations",
      "list",
      { page: 1 },
    ]);
    expect(adminQueryKeys.organizations.detail("org-123")).toEqual([
      "admin",
      "organizations",
      "detail",
      "org-123",
    ]);
  });

  it("generates correct keys for users", () => {
    expect(adminQueryKeys.users.all).toEqual(["admin", "users"]);
    expect(adminQueryKeys.users.list({ role: "admin" })).toEqual([
      "admin",
      "users",
      "list",
      { role: "admin" },
    ]);
  });

  it("generates correct keys for system", () => {
    expect(adminQueryKeys.system.all).toEqual(["admin", "system"]);
    expect(adminQueryKeys.system.health()).toEqual([
      "admin",
      "system",
      "health",
    ]);
  });

  it("generates correct keys for audit", () => {
    expect(adminQueryKeys.audit.all).toEqual(["admin", "audit"]);
    expect(adminQueryKeys.audit.logs({ action: "user.login" })).toEqual([
      "admin",
      "audit",
      "logs",
      { action: "user.login" },
    ]);
  });
});

describe("useSecretStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches secret status successfully", async () => {
    const mockResponse = {
      secrets: [
        {
          secret_type: "jwt_secret",
          status: "healthy",
          current_key_id: "key-123",
          last_rotated: "2024-01-01T00:00:00Z",
          next_rotation_due: "2024-04-01T00:00:00Z",
          days_until_expiration: 90,
          version_count: 3,
        },
      ],
      summary: {
        total: 5,
        healthy: 4,
        expiring_soon: 1,
        overdue: 0,
        missing: 0,
      },
      alerts: [],
    };

    vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useSecretStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockResponse);
    expect(apiClient.get).toHaveBeenCalledWith(
      "/admin/secrets/status",
      expect.any(Object)
    );
  });

  it("handles error state", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error("Unauthorized"));

    const { result } = renderHook(() => useSecretStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeDefined();
  });
});

describe("useAdminOrganizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches organizations with default params", async () => {
    const mockResponse = {
      organizations: [
        {
          id: "org-1",
          name: "Test Org",
          slug: "test-org",
          plan: "pro",
          created_at: "2024-01-01T00:00:00Z",
          user_count: 5,
          event_count: 100,
        },
      ],
      pagination: {
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      },
    };

    vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useAdminOrganizations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockResponse);
  });

  it("supports search and filter params", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      organizations: [],
      pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
    });

    const params = { search: "test", plan: "pro" as const, page: 2 };

    const { result } = renderHook(() => useAdminOrganizations(params), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.get).toHaveBeenCalledWith(
      expect.stringContaining("search=test"),
      expect.any(Object)
    );
  });
});

describe("useAdminUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches users list", async () => {
    const mockResponse = {
      users: [
        {
          id: "user-1",
          email: "admin@example.com",
          name: "Admin User",
          role: "admin",
          org_name: "Test Org",
          is_active: true,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
      pagination: {
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      },
    };

    vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useAdminUsers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.users).toHaveLength(1);
    expect(result.current.data?.users[0].role).toBe("admin");
  });
});

describe("useSystemHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches system health status", async () => {
    const mockResponse = {
      status: "healthy",
      timestamp: "2024-01-01T00:00:00Z",
      services: {
        database: { status: "healthy", latency: 5 },
        redis: { status: "healthy", latency: 2 },
        s3: { status: "healthy" },
        github: { status: "healthy", rate_limit_remaining: 4500 },
      },
      resources: {
        memory: { used: 512, total: 1024 },
        cpu: { usage: 25 },
      },
    };

    vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useSystemHealth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.status).toBe("healthy");
    expect(result.current.data?.services.database.status).toBe("healthy");
  });
});

describe("useAuditLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches audit logs", async () => {
    const mockResponse = {
      logs: [
        {
          id: "log-1",
          actor_id: "user-1",
          actor_type: "user",
          action: "user.login",
          resource_type: "user",
          resource_id: "user-1",
          details: {},
          ip_address: "127.0.0.1",
          user_agent: "Mozilla/5.0",
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
      pagination: {
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      },
    };

    vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useAuditLogs(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.logs).toHaveLength(1);
    expect(result.current.data?.logs[0].action).toBe("user.login");
  });

  it("supports filtering by action and date range", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      logs: [],
      pagination: { total: 0, page: 1, limit: 50, totalPages: 0 },
    });

    const params = {
      action: "secret.rotated",
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    };

    const { result } = renderHook(() => useAuditLogs(params), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.get).toHaveBeenCalledWith(
      expect.stringContaining("action=secret.rotated"),
      expect.any(Object)
    );
  });
});
