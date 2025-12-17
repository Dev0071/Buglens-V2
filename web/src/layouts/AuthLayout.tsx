import { Outlet } from "react-router-dom";

/**
 * Auth layout for login and public pages
 * Centered card layout with Buglens branding
 */
function AuthLayout() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4">
      {/* Logo and branding */}
      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <BuglensLogo className="w-10 h-10" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Buglens
          </h1>
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

/**
 * Buglens logo component
 */
function BuglensLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Magnifying glass */}
      <circle
        cx="18"
        cy="18"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        className="text-brand-500"
      />
      <line
        x1="25.5"
        y1="25.5"
        x2="35"
        y2="35"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="text-brand-500"
      />
      {/* Bug icon inside */}
      <path
        d="M18 12v12M14 15h8M14 21h8M12 18h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="text-brand-700 dark:text-brand-300"
      />
    </svg>
  );
}

export default AuthLayout;
