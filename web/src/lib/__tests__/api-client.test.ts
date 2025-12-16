import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiClient, ApiError, queryKeys } from "@/lib/api-client";
import { useAuthStore } from "@/store/auth";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("apiClient", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useAuthStore.setState({
      accessToken: null,
      user: null,
      organization: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  describe("GET requests", () => {
    it("makes GET request with correct URL", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: "test" }),
      });

      const result = await apiClient.get("/test-endpoint");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/test-endpoint"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
      expect(result).toEqual({ data: "test" });
    });

    it("includes Authorization header when token exists", async () => {
      useAuthStore.setState({ accessToken: "test-token" });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: "test" }),
      });

      await apiClient.get("/protected-endpoint");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });
  });

  describe("POST requests", () => {
    it("makes POST request with body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true }),
      });

      const body = { name: "test", value: 123 };
      await apiClient.post("/create", body);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    });
  });

  describe("PUT requests", () => {
    it("makes PUT request with body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ updated: true }),
      });

      const body = { id: 1, name: "updated" };
      await apiClient.put("/update/1", body);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(body),
        })
      );
    });
  });

  describe("PATCH requests", () => {
    it("makes PATCH request with body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ patched: true }),
      });

      const body = { field: "value" };
      await apiClient.patch("/patch/1", body);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify(body),
        })
      );
    });
  });

  describe("DELETE requests", () => {
    it("makes DELETE request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ deleted: true }),
      });

      await apiClient.delete("/delete/1");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  describe("error handling", () => {
    it("throws ApiError on non-2xx response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () => Promise.resolve({ message: "Invalid data" }),
      });

      await expect(apiClient.get("/bad-request")).rejects.toThrow(ApiError);

      try {
        await apiClient.get("/bad-request");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(400);
        expect((error as ApiError).message).toBe("Invalid data");
      }
    });

    it("logs out user on 401 response", async () => {
      useAuthStore.setState({
        accessToken: "expired-token",
        isAuthenticated: true,
      });

      const logoutSpy = vi.spyOn(useAuthStore.getState(), "logout");

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () => Promise.resolve({ message: "Token expired" }),
      });

      await expect(apiClient.get("/protected")).rejects.toThrow(ApiError);
      expect(logoutSpy).toHaveBeenCalled();
    });

    it("handles 204 No Content response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
      });

      const result = await apiClient.delete("/resource/1");

      expect(result).toBeUndefined();
    });

    it("handles non-JSON error response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("Not JSON")),
      });

      try {
        await apiClient.get("/error");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).message).toBe("Internal Server Error");
      }
    });
  });
});

describe("queryKeys", () => {
  describe("events", () => {
    it("generates correct keys", () => {
      expect(queryKeys.events.all()).toEqual(["events"]);
      expect(queryKeys.events.list({ status: "completed" })).toEqual([
        "events",
        "list",
        { status: "completed" },
      ]);
      expect(queryKeys.events.detail("evt-123")).toEqual([
        "events",
        "detail",
        "evt-123",
      ]);
      expect(queryKeys.events.rca("evt-123")).toEqual([
        "events",
        "rca",
        "evt-123",
      ]);
    });
  });

  describe("rca", () => {
    it("generates correct keys", () => {
      expect(queryKeys.rca.all()).toEqual(["rca"]);
      expect(queryKeys.rca.detail("rca-123")).toEqual([
        "rca",
        "detail",
        "rca-123",
      ]);
      expect(queryKeys.rca.byEventId("evt-123")).toEqual([
        "rca",
        "byEvent",
        "evt-123",
      ]);
      expect(queryKeys.rca.timeline("rca-123")).toEqual([
        "rca",
        "timeline",
        "rca-123",
      ]);
      expect(queryKeys.rca.evidence("rca-123")).toEqual([
        "rca",
        "evidence",
        "rca-123",
      ]);
    });
  });

  describe("dashboard", () => {
    it("generates correct keys", () => {
      expect(queryKeys.dashboard.stats()).toEqual(["dashboard", "stats"]);
      expect(queryKeys.dashboard.recentEvents()).toEqual([
        "dashboard",
        "recentEvents",
        undefined,
      ]);
      expect(queryKeys.dashboard.recentEvents(5)).toEqual([
        "dashboard",
        "recentEvents",
        5,
      ]);
      expect(queryKeys.dashboard.trendChart("7d")).toEqual([
        "dashboard",
        "trendChart",
        "7d",
      ]);
    });
  });

  describe("integrations", () => {
    it("generates correct keys", () => {
      expect(queryKeys.integrations.all()).toEqual(["integrations"]);
      expect(queryKeys.integrations.list()).toEqual(["integrations", "list"]);
      expect(queryKeys.integrations.detail("int-123")).toEqual([
        "integrations",
        "detail",
        "int-123",
      ]);
    });
  });

  describe("settings", () => {
    it("generates correct keys", () => {
      expect(queryKeys.settings.organization()).toEqual([
        "settings",
        "organization",
      ]);
      expect(queryKeys.settings.user()).toEqual(["settings", "user"]);
      expect(queryKeys.settings.notifications()).toEqual([
        "settings",
        "notifications",
      ]);
    });
  });

  describe("costs", () => {
    it("generates correct keys", () => {
      expect(queryKeys.costs.summary()).toEqual(["costs", "summary"]);
      expect(queryKeys.costs.daily("2024-01-01", "2024-01-31")).toEqual([
        "costs",
        "daily",
        "2024-01-01",
        "2024-01-31",
      ]);
    });
  });

  describe("auth", () => {
    it("generates correct keys", () => {
      expect(queryKeys.auth.me()).toEqual(["auth", "me"]);
    });
  });
});
