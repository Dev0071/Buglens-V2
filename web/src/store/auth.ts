import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { apiClient } from "@/lib/api-client";

/**
 * User interface representing authenticated user data
 */
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  orgId: string;
  orgName: string;
  role: "owner" | "admin" | "member";
}

/**
 * Organization interface for multi-tenant context
 */
export interface Organization {
  id: string;
  name: string;
  plan: "free" | "pro" | "enterprise";
  createdAt: string;
}

interface AuthState {
  user: User | null;
  organization: Organization | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthActions {
  login: (email: string, password: string) => Promise<void>;
  signup: (
    name: string,
    email: string,
    password: string,
    orgName: string
  ) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
  clearError: () => void;
  setLoading: (loading: boolean) => void;
}

type AuthStore = AuthState & AuthActions;

const initialState: AuthState = {
  user: null,
  organization: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: false, // Start as false - will be set by rehydration callback if needed
  error: null,
};

/**
 * Auth store using Zustand with persistence
 * Handles user authentication state and organization context
 */
export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      /**
       * Login with email and password
       */
      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          const response = await apiClient.post<{
            user: User;
            organization: Organization;
            accessToken: string;
          }>("/auth/login", { email, password });

          set({
            user: response.user,
            organization: response.organization,
            accessToken: response.accessToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Login failed";
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      /**
       * Signup with email, password, and organization
       */
      signup: async (
        name: string,
        email: string,
        password: string,
        orgName: string
      ) => {
        set({ isLoading: true, error: null });

        try {
          const response = await apiClient.post<{
            user: User;
            organization: Organization;
            accessToken: string;
          }>("/auth/signup", {
            name,
            email,
            password,
            organizationName: orgName,
          });

          set({
            user: response.user,
            organization: response.organization,
            accessToken: response.accessToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Signup failed";
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      /**
       * Login with Google OAuth
       * Redirects to backend API server for OAuth flow initiation.
       * Uses VITE_API_URL environment variable to ensure correct domain.
       */
      loginWithGoogle: async () => {
        set({ isLoading: true, error: null });

        try {
          // Redirect to Google OAuth endpoint using configured API URL
          // Must use API domain directly (not frontend proxy) for OAuth to work correctly
          window.location.href = `${import.meta.env.VITE_API_URL}/api/auth/google`;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Google login failed";
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      /**
       * Login with GitHub OAuth
       * Redirects to backend API server for OAuth flow initiation.
       * Uses VITE_API_URL environment variable to ensure correct domain.
       */
      loginWithGitHub: async () => {
        set({ isLoading: true, error: null });

        try {
          // Redirect to GitHub OAuth endpoint using configured API URL
          // Must use API domain directly (not frontend proxy) for OAuth to work correctly
          window.location.href = `${import.meta.env.VITE_API_URL}/api/auth/github`;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "GitHub login failed";
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      /**
       * Logout and clear session
       */
      logout: () => {
        // Clear all auth state
        set(initialState);
        set({ isLoading: false }); // Override isLoading after reset

        // Call logout endpoint to invalidate server session
        apiClient.post("/auth/logout").catch(() => {
          // Ignore logout errors - user is already logged out locally
        });
      },

      /**
       * Refresh session from server
       * Called on app mount to restore session
       */
      refreshSession: async () => {
        const { accessToken } = get();

        if (!accessToken) {
          set({ isLoading: false });
          return;
        }

        try {
          const response = await apiClient.get<{
            user: User;
            organization: Organization;
          }>("/auth/me");

          set({
            user: response.user,
            organization: response.organization,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          // Session invalid - clear auth state
          set({
            ...initialState,
            isLoading: false,
          });
        }
      },

      /**
       * Clear error message
       */
      clearError: () => set({ error: null }),

      /**
       * Set loading state manually
       */
      setLoading: (loading: boolean) => set({ isLoading: loading }),
    }),
    {
      name: "buglens-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        user: state.user,
        organization: state.organization,
        // Persist isAuthenticated to prevent redirect flash on reload
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // After rehydration, check if session is still valid
        if (state?.accessToken) {
          // If we have a token, set loading true while we validate
          useAuthStore.setState({ isLoading: true });

          // If we have a token, assume authenticated until proven otherwise
          // This prevents redirect flash while refreshSession validates
          if (state.user && state.organization) {
            useAuthStore.setState({ isAuthenticated: true });
          }
          state.refreshSession();
        } else {
          // No token = not authenticated, ensure loading is false
          useAuthStore.setState({ isLoading: false, isAuthenticated: false });
        }
      },
    }
  )
);

/**
 * Selector to get current organization ID
 * Used for multi-tenant API calls
 */
export const useOrgId = () => useAuthStore((state) => state.organization?.id);

/**
 * Selector to get current user role
 */
export const useUserRole = () => useAuthStore((state) => state.user?.role);

/**
 * Selector to check if user has specific permission
 */
export const useHasPermission = (
  permission: "read" | "write" | "admin" | "owner"
) => {
  const role = useAuthStore((state) => state.user?.role);

  const rolePermissions: Record<string, string[]> = {
    member: ["read"],
    admin: ["read", "write", "admin"],
    owner: ["read", "write", "admin", "owner"],
  };

  return role ? (rolePermissions[role]?.includes(permission) ?? false) : false;
};
