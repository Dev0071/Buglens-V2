/**
 * API client for making authenticated HTTP requests
 * Handles authentication headers, error responses, and base URL configuration
 */

import { useAuthStore } from "@/store/auth";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

/**
 * Custom error class for API errors with status codes
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

/**
 * Make an authenticated API request
 * @param endpoint - API endpoint path
 * @param options - Fetch options with typed body
 * @returns Parsed JSON response
 * @throws ApiError on non-2xx responses
 */
async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { body, headers: customHeaders, ...rest } = options;

  // Get access token from auth store
  const accessToken = useAuthStore.getState().accessToken;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...customHeaders,
  };

  // Add Authorization header if token exists
  if (accessToken) {
    (headers as Record<string, string>)["Authorization"] =
      `Bearer ${accessToken}`;
  }

  const url = endpoint.startsWith("http")
    ? endpoint
    : `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...rest,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Handle non-2xx responses
  if (!response.ok) {
    let errorMessage = "Request failed";
    let errorData: unknown;

    try {
      errorData = await response.json();
      if (
        typeof errorData === "object" &&
        errorData !== null &&
        "message" in errorData
      ) {
        errorMessage = String((errorData as { message: unknown }).message);
      }
    } catch {
      errorMessage = response.statusText || "Request failed";
    }

    // Handle 401 - unauthorized (session expired)
    if (response.status === 401) {
      useAuthStore.getState().logout();
    }

    throw new ApiError(errorMessage, response.status, errorData);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

/**
 * API client with HTTP method helpers
 */
export const apiClient = {
  /**
   * GET request
   */
  get: <T>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: "GET" }),

  /**
   * POST request
   */
  post: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: "POST", body }),

  /**
   * PUT request
   */
  put: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: "PUT", body }),

  /**
   * PATCH request
   */
  patch: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: "PATCH", body }),

  /**
   * DELETE request
   */
  delete: <T>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: "DELETE" }),
};

/**
 * Type-safe query key factory for React Query
 * Ensures consistent query key patterns across the app
 */
export const queryKeys = {
  // Auth
  auth: {
    me: () => ["auth", "me"] as const,
  },

  // Events
  events: {
    all: () => ["events"] as const,
    list: (filters?: Record<string, unknown>) =>
      ["events", "list", filters] as const,
    detail: (id: string) => ["events", "detail", id] as const,
    rca: (eventId: string) => ["events", "rca", eventId] as const,
  },

  // RCA
  rca: {
    all: () => ["rca"] as const,
    detail: (id: string) => ["rca", "detail", id] as const,
    byEventId: (eventId: string) => ["rca", "byEvent", eventId] as const,
    timeline: (id: string) => ["rca", "timeline", id] as const,
    evidence: (id: string) => ["rca", "evidence", id] as const,
  },

  // Dashboard
  dashboard: {
    stats: () => ["dashboard", "stats"] as const,
    recentEvents: (limit?: number) =>
      ["dashboard", "recentEvents", limit] as const,
    trendChart: (period: string) =>
      ["dashboard", "trendChart", period] as const,
  },

  // Integrations
  integrations: {
    all: () => ["integrations"] as const,
    list: () => ["integrations", "list"] as const,
    detail: (id: string) => ["integrations", "detail", id] as const,
  },

  // Costs
  costs: {
    summary: () => ["costs", "summary"] as const,
    daily: (startDate: string, endDate: string) =>
      ["costs", "daily", startDate, endDate] as const,
  },

  // Settings
  settings: {
    organization: () => ["settings", "organization"] as const,
    user: () => ["settings", "user"] as const,
    notifications: () => ["settings", "notifications"] as const,
    billing: () => ["settings", "billing"] as const,
  },

  // Team
  team: {
    members: () => ["team", "members"] as const,
    invites: () => ["team", "invites"] as const,
  },

  // Profile
  profile: {
    details: () => ["profile", "details"] as const,
    notifications: () => ["profile", "notifications"] as const,
  },

  // Analytics
  analytics: {
    summary: (period: string) => ["analytics", "summary", period] as const,
    daily: (period: string) => ["analytics", "daily", period] as const,
    rcaQuality: () => ["analytics", "rcaQuality"] as const,
  },
};
