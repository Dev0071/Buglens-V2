/**
 * Admin Store for Buglens Admin Dashboard
 * Manages admin-specific state including admin token
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface AdminState {
  /** Admin token for sensitive operations (X-Admin-Token header) */
  adminToken: string | null;
  /** Whether admin panel is unlocked */
  isUnlocked: boolean;
  /** Last unlock timestamp */
  unlockedAt: number | null;
  /** Admin session timeout (30 minutes) */
  sessionTimeoutMs: number;
}

interface AdminActions {
  /** Set admin token and unlock panel */
  unlock: (token: string) => void;
  /** Lock admin panel */
  lock: () => void;
  /** Check if session is still valid */
  isSessionValid: () => boolean;
  /** Clear admin state */
  clear: () => void;
}

type AdminStore = AdminState & AdminActions;

const ADMIN_SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

const initialState: AdminState = {
  adminToken: null,
  isUnlocked: false,
  unlockedAt: null,
  sessionTimeoutMs: ADMIN_SESSION_TIMEOUT,
};

/**
 * Admin store using Zustand with persistence
 * Handles admin token and session management
 */
export const useAdminStore = create<AdminStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      /**
       * Unlock admin panel with token
       */
      unlock: (token: string) => {
        set({
          adminToken: token,
          isUnlocked: true,
          unlockedAt: Date.now(),
        });
      },

      /**
       * Lock admin panel
       */
      lock: () => {
        set({
          adminToken: null,
          isUnlocked: false,
          unlockedAt: null,
        });
      },

      /**
       * Check if admin session is still valid (not timed out)
       */
      isSessionValid: () => {
        const { isUnlocked, unlockedAt, sessionTimeoutMs } = get();
        if (!isUnlocked || !unlockedAt) return false;
        return Date.now() - unlockedAt < sessionTimeoutMs;
      },

      /**
       * Clear all admin state
       */
      clear: () => {
        set(initialState);
      },
    }),
    {
      name: "buglens-admin",
      storage: createJSONStorage(() => sessionStorage), // Use sessionStorage for security
      partialize: (state) => ({
        adminToken: state.adminToken,
        isUnlocked: state.isUnlocked,
        unlockedAt: state.unlockedAt,
      }),
      onRehydrateStorage: () => (state) => {
        // Check if session is still valid after rehydration
        if (state && state.unlockedAt) {
          const elapsed = Date.now() - state.unlockedAt;
          if (elapsed >= ADMIN_SESSION_TIMEOUT) {
            // Session expired - lock the panel
            useAdminStore.setState({
              adminToken: null,
              isUnlocked: false,
              unlockedAt: null,
            });
          }
        }
      },
    }
  )
);

/**
 * Selector to check if admin is currently unlocked
 */
export const useIsAdminUnlocked = () =>
  useAdminStore((state) => state.isUnlocked && state.isSessionValid());

/**
 * Selector to get admin token
 */
export const useAdminToken = () => useAdminStore((state) => state.adminToken);
