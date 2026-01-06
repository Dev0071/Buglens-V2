/**
 * Admin Layout
 *
 * Wrapper for admin pages that:
 * - Checks admin role
 * - Requires admin token unlock
 * - Provides admin-specific navigation
 */

import { useState } from "react";
import { Outlet, NavLink, Navigate, useLocation } from "react-router-dom";
import {
  ShieldCheckIcon,
  HomeIcon,
  KeyIcon,
  BuildingOfficeIcon,
  UsersIcon,
  ServerIcon,
  ClockIcon,
  ChartBarIcon,
  LockClosedIcon,
  ChevronLeftIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore, useUserRole } from "@/store/auth";
import { useAdminStore, useIsAdminUnlocked } from "@/store/admin";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { LogoIcon } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";

const adminNavigation = [
  { name: "Overview", href: "/admin", icon: HomeIcon },
  { name: "Secrets", href: "/admin/secrets", icon: KeyIcon },
  {
    name: "Organizations",
    href: "/admin/organizations",
    icon: BuildingOfficeIcon,
  },
  { name: "Users", href: "/admin/users", icon: UsersIcon },
  { name: "System Health", href: "/admin/system", icon: ServerIcon },
  { name: "Audit Logs", href: "/admin/audit", icon: ClockIcon },
  { name: "Analytics", href: "/admin/analytics", icon: ChartBarIcon },
];

/**
 * Admin unlock screen
 */
function AdminUnlockScreen() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { unlock } = useAdminStore();

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    // Validate token length
    if (token.length < 32) {
      setError("Admin token must be at least 32 characters");
      setIsLoading(false);
      return;
    }

    // In a real implementation, you might validate the token with the server first
    // For now, we just store it and let API calls fail if invalid
    try {
      unlock(token);
    } catch (err) {
      setError("Failed to unlock admin panel");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <LogoIcon size="xl" className="w-16 h-16" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Admin Access
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Enter your admin token to access the admin panel
          </p>
        </div>

        <div className="card p-6">
          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label
                htmlFor="admin-token"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Admin Token
              </label>
              <div className="relative">
                <input
                  id="admin-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Enter your admin token"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  autoFocus
                />
                <LockClosedIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Token from PLATFORM_ADMIN_TOKEN environment variable
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !token}
              className="w-full py-2 px-4 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <LoadingSpinner size="sm" />
              ) : (
                <>
                  <ShieldCheckIcon className="w-5 h-5" />
                  Unlock Admin Panel
                </>
              )}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <NavLink
              to="/"
              className="flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-brand-600"
            >
              <ChevronLeftIcon className="w-4 h-4" />
              Back to Dashboard
            </NavLink>
          </div>
        </div>

        <p className="text-center text-xs text-gray-500 mt-4">
          Admin access is logged and monitored
        </p>
      </div>
    </div>
  );
}

/**
 * Admin layout with sidebar
 */
function AdminLayoutContent() {
  const location = useLocation();
  const { user } = useAuthStore();
  const { lock } = useAdminStore();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="h-16 flex items-center gap-3 px-4 border-b border-gray-200 dark:border-gray-700">
          <LogoIcon size="md" />
          <div>
            <span className="font-semibold text-gray-900 dark:text-white">
              Admin Panel
            </span>
            <p className="text-xs text-gray-500">Buglens Platform</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-1">
          {adminNavigation.map((item) => {
            const isActive =
              item.href === "/admin"
                ? location.pathname === "/admin"
                : location.pathname.startsWith(item.href);

            return (
              <NavLink
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                )}
              >
                <item.icon
                  className={cn(
                    "w-5 h-5",
                    isActive
                      ? "text-brand-600 dark:text-brand-400"
                      : "text-gray-500 dark:text-gray-400"
                  )}
                />
                {item.name}
              </NavLink>
            );
          })}
        </nav>

        {/* User & Lock */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-brand-100 dark:bg-brand-900/30 rounded-full flex items-center justify-center">
              <span className="text-sm font-medium text-brand-600">
                {user?.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {user?.name}
              </p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <NavLink
              to="/"
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              <ChevronLeftIcon className="w-4 h-4" />
              Exit Admin
            </NavLink>
            <button
              onClick={lock}
              className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
              title="Lock Admin Panel"
            >
              <LockClosedIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64 min-h-screen">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/**
 * Admin Layout wrapper with access control
 */
export default function AdminLayout() {
  const role = useUserRole();
  const isUnlocked = useIsAdminUnlocked();
  const { isAuthenticated, isLoading } = useAuthStore();

  // Wait for auth state to load
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Redirect if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Check admin role
  if (role !== "admin" && role !== "owner") {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="text-center">
          <ShieldCheckIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Access Denied
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            You don't have permission to access the admin panel.
          </p>
          <NavLink
            to="/"
            className="text-brand-600 hover:text-brand-700 font-medium"
          >
            Return to Dashboard
          </NavLink>
        </div>
      </div>
    );
  }

  // Show unlock screen if not unlocked
  if (!isUnlocked) {
    return <AdminUnlockScreen />;
  }

  // Show admin content
  return <AdminLayoutContent />;
}
