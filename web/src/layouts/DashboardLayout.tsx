import { Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import { useOnboardingStatus } from "@/lib/hooks";

/**
 * Dashboard layout with sidebar navigation and header
 * Responsive design with collapsible sidebar on mobile
 */
function SetupBanner() {
  const navigate = useNavigate();
  const { data: onboarding } = useOnboardingStatus();

  if (!onboarding) return null;

  const { is_ready_for_rca, completion_pct, next_step } = onboarding;

  // Fully done — no banner
  if (next_step === "complete") return null;

  // Neither github nor sentry: let DashboardPage handle the redirect
  // Show banner only for partial setups (at least one step done)
  if (completion_pct === 0) return null;

  return (
    <div className={`px-6 py-2 text-sm flex items-center justify-between gap-4 ${is_ready_for_rca ? "bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-700" : "bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700"}`}>
      <span className={is_ready_for_rca ? "text-green-800 dark:text-green-200" : "text-amber-800 dark:text-amber-200"}>
        {is_ready_for_rca
          ? `Setup ${completion_pct}% complete — RCA is active`
          : `Setup ${completion_pct}% complete — finish setup to activate RCA`}
      </span>
      <button
        onClick={() => navigate("/onboarding")}
        className="text-xs font-medium underline whitespace-nowrap"
      >
        Continue setup →
      </button>
    </div>
  );
}

function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main content area */}
      <div
        className={`
          transition-all duration-300
          ${sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"}
        `}
      >
        {/* Header */}
        <Header onMenuClick={() => setSidebarOpen(true)} />

        {/* Setup progress banner */}
        <SetupBanner />

        {/* Page content */}
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default DashboardLayout;
