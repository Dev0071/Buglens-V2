import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuthStore } from "@/store/auth";

// Mock the API client
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import { apiClient } from "@/lib/api-client";

describe("useAuthStore", () => {
  beforeEach(() => {
    // Reset store state before each test
    useAuthStore.setState({
      user: null,
      organization: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
    // Clear localStorage
    localStorage.clear();
    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("has correct initial state", () => {
      const { result } = renderHook(() => useAuthStore());

      expect(result.current.user).toBeNull();
      expect(result.current.organization).toBeNull();
      expect(result.current.accessToken).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe("login", () => {
    it("successfully logs in user", async () => {
      const mockResponse = {
        user: {
          id: "user-1",
          email: "test@example.com",
          name: "Test User",
          orgId: "org-1",
          orgName: "Test Org",
          role: "admin" as const,
        },
        organization: {
          id: "org-1",
          name: "Test Org",
          plan: "pro" as const,
          createdAt: new Date().toISOString(),
        },
        accessToken: "test-token",
      };

      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login("test@example.com", "password");
      });

      expect(result.current.user).toEqual(mockResponse.user);
      expect(result.current.organization).toEqual(mockResponse.organization);
      expect(result.current.accessToken).toBe("test-token");
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("handles login failure", async () => {
      const error = new Error("Invalid credentials");
      vi.mocked(apiClient.post).mockRejectedValue(error);

      const { result } = renderHook(() => useAuthStore());

      // Login should throw and set error state
      let loginError: Error | null = null;
      await act(async () => {
        try {
          await result.current.login("test@example.com", "wrong-password");
        } catch (e) {
          loginError = e as Error;
        }
      });

      expect(loginError).toBeTruthy();
      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.error).toBe("Invalid credentials");
    });

    it("sets loading state during login", async () => {
      let resolveLogin: () => void;
      const loginPromise = new Promise<void>((resolve) => {
        resolveLogin = resolve;
      });

      vi.mocked(apiClient.post).mockImplementation(async () => {
        await loginPromise;
        return {
          user: {
            id: "user-1",
            email: "test@example.com",
            name: "Test",
            orgId: "org-1",
            orgName: "Org",
            role: "admin" as const,
          },
          organization: {
            id: "org-1",
            name: "Org",
            plan: "pro" as const,
            createdAt: "",
          },
          accessToken: "token",
        };
      });

      const { result } = renderHook(() => useAuthStore());

      // Start login without awaiting
      act(() => {
        result.current.login("test@example.com", "password");
      });

      // Check loading state
      expect(result.current.isLoading).toBe(true);

      // Complete login
      await act(async () => {
        resolveLogin!();
        await new Promise((resolve) => setTimeout(resolve, 10)); // Let the promise resolve
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("logout", () => {
    it("clears all auth state", async () => {
      // First, set up authenticated state
      useAuthStore.setState({
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
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });

      vi.mocked(apiClient.post).mockResolvedValue({});

      const { result } = renderHook(() => useAuthStore());

      expect(result.current.isAuthenticated).toBe(true);

      act(() => {
        result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.organization).toBeNull();
      expect(result.current.accessToken).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });

    it("calls logout API endpoint", () => {
      vi.mocked(apiClient.post).mockResolvedValue({});

      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.logout();
      });

      expect(apiClient.post).toHaveBeenCalledWith("/api/auth/logout");
    });
  });

  describe("clearError", () => {
    it("clears error state", () => {
      useAuthStore.setState({ error: "Some error" });

      const { result } = renderHook(() => useAuthStore());

      expect(result.current.error).toBe("Some error");

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe("setLoading", () => {
    it("sets loading state", () => {
      const { result } = renderHook(() => useAuthStore());

      expect(result.current.isLoading).toBe(false);

      act(() => {
        result.current.setLoading(true);
      });

      expect(result.current.isLoading).toBe(true);

      act(() => {
        result.current.setLoading(false);
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("refreshSession", () => {
    it("refreshes session when access token exists", async () => {
      useAuthStore.setState({ accessToken: "existing-token" });

      const mockResponse = {
        user: {
          id: "user-1",
          email: "test@example.com",
          name: "Test User",
          orgId: "org-1",
          orgName: "Test Org",
          role: "admin" as const,
        },
        organization: {
          id: "org-1",
          name: "Test Org",
          plan: "pro" as const,
          createdAt: new Date().toISOString(),
        },
      };

      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.refreshSession();
      });

      expect(result.current.user).toEqual(mockResponse.user);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isLoading).toBe(false);
    });

    it("clears state when session is invalid", async () => {
      useAuthStore.setState({
        accessToken: "invalid-token",
        user: {
          id: "user-1",
          email: "test@example.com",
          name: "Test",
          orgId: "org-1",
          orgName: "Org",
          role: "admin",
        },
        isAuthenticated: true,
      });

      vi.mocked(apiClient.get).mockRejectedValue(new Error("Unauthorized"));

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.refreshSession();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });

    it("does nothing when no access token", async () => {
      useAuthStore.setState({ accessToken: null });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.refreshSession();
      });

      expect(apiClient.get).not.toHaveBeenCalled();
      expect(result.current.isLoading).toBe(false);
    });
  });
});
