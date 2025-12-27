import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useSearchParams,
  useNavigate,
} from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { useAuthStore } from "@/store/auth";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import AuthLayout from "@/layouts/AuthLayout";
import DashboardLayout from "@/layouts/DashboardLayout";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { apiClient } from "@/lib/api-client";

// Lazy load pages for better performance
const LandingPage = lazy(() => import("@/pages/landing/LandingPage"));
const LoginPage = lazy(() => import("@/pages/auth/LoginPage"));
const SignupPage = lazy(() => import("@/pages/auth/SignupPage"));
const DashboardPage = lazy(() => import("@/pages/dashboard/DashboardPage"));
const EventsPage = lazy(() => import("@/pages/events/EventsPage"));
const EventDetailPage = lazy(() => import("@/pages/events/EventDetailPage"));
const RCADetailPage = lazy(() => import("@/pages/rca/RCADetailPage"));
const SettingsPage = lazy(() => import("@/pages/settings/SettingsPage"));
const AnalyticsPage = lazy(() => import("@/pages/analytics/AnalyticsPage"));

/**
 * OAuth callback handler - processes token from URL after OAuth redirect
 */
function OAuthCallbackHandler() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get("token");
    const provider = searchParams.get("provider");
    const error = searchParams.get("error");

    if (error) {
      // Clear URL params and show error
      navigate("/login?error=" + error, { replace: true });
      return;
    }

    if (token && provider) {
      // Set the token in the auth store
      useAuthStore.setState({ accessToken: token, isLoading: true });

      // Fetch user data with the token
      apiClient
        .get<{
          user: {
            id: string;
            email: string;
            name: string;
            orgId: string;
            orgName: string;
            role: "owner" | "admin" | "member";
            avatarUrl?: string;
          };
          organization: {
            id: string;
            name: string;
            plan: "free" | "pro" | "enterprise";
            createdAt: string;
          };
        }>("/auth/me")
        .then((response) => {
          useAuthStore.setState({
            user: response.user,
            organization: response.organization,
            isAuthenticated: true,
            isLoading: false,
          });
          // Clear URL params
          navigate("/", { replace: true });
        })
        .catch(() => {
          useAuthStore.setState({
            accessToken: null,
            isLoading: false,
            error: "Failed to verify OAuth login",
          });
          navigate("/login?error=oauth_verification_failed", { replace: true });
        });
    }
  }, [searchParams, navigate]);

  return null;
}

/**
 * Protected route wrapper - redirects to login if not authenticated
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingSpinner fullScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

/**
 * Public route wrapper - redirects to dashboard if already authenticated
 */
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingSpinner fullScreen />;
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

/**
 * Main App component with routing configuration
 */
function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="buglens-theme">
      <BrowserRouter>
        {/* Handle OAuth callback tokens */}
        <OAuthCallbackHandler />
        <Suspense fallback={<LoadingSpinner fullScreen />}>
          <Routes>
            {/* Landing page - public marketing page */}
            <Route path="/landing" element={<LandingPage />} />

            {/* Public routes */}
            <Route element={<AuthLayout />}>
              <Route
                path="/login"
                element={
                  <PublicRoute>
                    <LoginPage />
                  </PublicRoute>
                }
              />
              <Route
                path="/signup"
                element={
                  <PublicRoute>
                    <SignupPage />
                  </PublicRoute>
                }
              />
            </Route>

            {/* Protected routes */}
            <Route
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/events/:eventId" element={<EventDetailPage />} />
              <Route path="/rca/:rcaId" element={<RCADetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/team" element={<SettingsPage />} />
              <Route path="/settings/integrations" element={<SettingsPage />} />
              <Route path="/settings/api-keys" element={<SettingsPage />} />
              <Route
                path="/settings/notifications"
                element={<SettingsPage />}
              />
              <Route path="/settings/billing" element={<SettingsPage />} />
              {/* Redirect old /integrations route to settings */}
              <Route
                path="/integrations"
                element={<Navigate to="/settings/integrations" replace />}
              />
              <Route path="/analytics" element={<AnalyticsPage />} />
            </Route>

            {/* Catch all - redirect to dashboard */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <Toaster />
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
