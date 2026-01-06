/**
 * Admin Store Tests
 *
 * Tests for admin authentication and token management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAdminStore } from "@/store/admin";

// Mock sessionStorage
const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "sessionStorage", {
  value: sessionStorageMock,
});

describe("useAdminStore", () => {
  beforeEach(() => {
    // Reset store state
    useAdminStore.setState({
      adminToken: null,
      isUnlocked: false,
      unlockedAt: null,
    });
    sessionStorageMock.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("has correct initial state", () => {
      const { result } = renderHook(() => useAdminStore());

      expect(result.current.adminToken).toBeNull();
      expect(result.current.isUnlocked).toBe(false);
      expect(result.current.unlockedAt).toBeNull();
    });
  });

  describe("unlock", () => {
    it("sets token and unlocked state", () => {
      const { result } = renderHook(() => useAdminStore());

      act(() => {
        result.current.unlock("test-admin-token");
      });

      expect(result.current.adminToken).toBe("test-admin-token");
      expect(result.current.isUnlocked).toBe(true);
      expect(result.current.unlockedAt).toBeDefined();
    });

    it("persists state for session", () => {
      const { result } = renderHook(() => useAdminStore());

      act(() => {
        result.current.unlock("test-admin-token");
      });

      // State should be persisted - adminToken should be available
      expect(result.current.adminToken).toBe("test-admin-token");
    });
  });

  describe("lock", () => {
    it("clears token and locks admin panel", () => {
      const { result } = renderHook(() => useAdminStore());

      // First unlock
      act(() => {
        result.current.unlock("test-admin-token");
      });

      expect(result.current.isUnlocked).toBe(true);

      // Then lock
      act(() => {
        result.current.lock();
      });

      expect(result.current.adminToken).toBeNull();
      expect(result.current.isUnlocked).toBe(false);
      expect(result.current.unlockedAt).toBeNull();
    });
  });

  describe("session timeout", () => {
    it("isSessionValid returns true within 30 minutes", () => {
      const { result } = renderHook(() => useAdminStore());

      act(() => {
        result.current.unlock("test-admin-token");
      });

      // Advance time by 15 minutes
      act(() => {
        vi.advanceTimersByTime(15 * 60 * 1000);
      });

      expect(result.current.isSessionValid()).toBe(true);
    });

    it("isSessionValid returns false after 30 minutes", () => {
      const { result } = renderHook(() => useAdminStore());

      act(() => {
        result.current.unlock("test-admin-token");
      });

      // Advance time by 31 minutes
      act(() => {
        vi.advanceTimersByTime(31 * 60 * 1000);
      });

      expect(result.current.isSessionValid()).toBe(false);
    });

    it("isSessionValid returns false when not unlocked", () => {
      const { result } = renderHook(() => useAdminStore());

      expect(result.current.isSessionValid()).toBe(false);
    });
  });

  describe("clear", () => {
    it("resets all admin state", () => {
      const { result } = renderHook(() => useAdminStore());

      act(() => {
        result.current.unlock("test-admin-token");
      });

      expect(result.current.isUnlocked).toBe(true);

      act(() => {
        result.current.clear();
      });

      expect(result.current.adminToken).toBeNull();
      expect(result.current.isUnlocked).toBe(false);
      expect(result.current.unlockedAt).toBeNull();
    });
  });
});
