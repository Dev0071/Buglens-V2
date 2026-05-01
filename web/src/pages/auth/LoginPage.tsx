import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useToast } from "@/components/ui/toaster";
// import * as Sentry from "@sentry/react";

/**
 * Login page component with email/password and OAuth options
 */
function LoginPage() {
  const {
    login,
    loginWithGitHub,
    loginWithGoogle,
    isLoading,
    error,
    clearError,
  } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  // Handle OAuth error parameters
  useEffect(() => {
    const errorParam = searchParams.get("error");
    const provider = searchParams.get("provider");

    if (errorParam) {
      const errorMessages: Record<string, string> = {
        oauth_cancelled: `${provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "OAuth"} sign-in was cancelled`,
        invalid_state: "Session expired. Please try signing in again.",
        oauth_failed: `${provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "OAuth"} sign-in failed. Please try again.`,
        oauth_verification_failed:
          "Failed to verify your account. Please try again.",
        access_denied:
          "Access was denied. Please check permissions and try again.",
      };

      toast.error(
        "Sign-in Error",
        errorMessages[errorParam] || "An error occurred. Please try again."
      );

      // Clear the error from URL
      searchParams.delete("error");
      searchParams.delete("provider");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      await login(email, password);
    } catch {
      // Error is handled by the store
    }
  };

  return (
    <div className="card-body space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Welcome back
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Sign in to your Buglens account
        </p>
      </div>

      {/* OAuth buttons */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={loginWithGitHub}
          disabled={isLoading}
          className="btn btn-secondary w-full flex items-center justify-center gap-2"
        >
          <GitHubIcon className="w-5 h-5" />
          Continue with GitHub
        </button>
        <button
          type="button"
          onClick={loginWithGoogle}
          disabled={isLoading}
          className="btn btn-secondary w-full flex items-center justify-center gap-2"
        >
          <GoogleIcon className="w-5 h-5" />
          Continue with Google
        </button>

        {/* Test Sentry - onClick error (manual capture) */}
        {/* <button
          type="button"
         onClick={() => {
  const error = new Error("Test error from onClick handler");

  Sentry.withScope((scope) => {
    scope.setFingerprint(["onClick-test", String(Date.now())]); // force uniqueness
    scope.setLevel("error");
    scope.setTag("source", "manual-test");
    Sentry.captureException(error);
  });
}}
          className="btn btn-danger w-full"
        >
          Test Sentry (onClick)
        </button> */}
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300 dark:border-gray-600" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
            Or continue with email
          </span>
        </div>
      </div>

      {/* Email/password form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Email address
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="input"
            placeholder="you@company.com"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="input"
            placeholder="••••••••"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="w-4 h-4 text-brand-600 border-gray-300 rounded focus:ring-brand-500"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Remember me
            </span>
          </label>
          <a
            href="/forgot-password"
            className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
          >
            Forgot password?
          </a>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="btn-primary w-full"
        >
          {isLoading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      {/* Sign up link */}
      <p className="text-center text-sm text-gray-600 dark:text-gray-400">
        Don't have an account?{" "}
        <a
          href="/signup"
          className="text-brand-600 dark:text-brand-400 hover:underline font-medium"
        >
          Sign up for free
        </a>
      </p>
    </div>
  );
}

/**
 * GitHub icon component
 */
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

/**
 * Google icon component
 */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export default LoginPage;
