import { Outlet } from "react-router-dom";
import Logo from "@/components/ui/Logo";

/**
 * Auth layout for login and public pages
 * Centered card layout with Buglens branding
 */
function AuthLayout() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-zinc-950 dark:to-zinc-900 p-4">
      {/* Logo and branding */}
      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Logo size="lg" showText={true} />
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          AI-powered Root Cause Analysis
        </p>
      </div>

      {/* Auth content card */}
      <div className="w-full max-w-md">
        <div className="card">
          <Outlet />
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <p>© {new Date().getFullYear()} Buglens. All rights reserved.</p>
      </div>
    </div>
  );
}

export default AuthLayout;
