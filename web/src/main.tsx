import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import App from "./App";
import "./index.css";
import * as Sentry from "@sentry/react";

const sentryDsn =
  import.meta.env.VITE_SENTRY_DSN ||
  "https://7e88d24b2ab4552003ac61022f0d6645@o4510676293517312.ingest.us.sentry.io/4510691114287104";

if (sentryDsn) {
  // Use tunnel to bypass ad blockers
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
  const tunnelUrl = `${apiUrl}/api/sentry-tunnel`;

  Sentry.init({
    dsn: sentryDsn,
    tunnel: tunnelUrl, // Route through backend to bypass ad blockers
    environment: import.meta.env.MODE,
    release: `buglens-frontend@1.0.0`,
    enabled: true, // Temporarily enabled for testing (change to import.meta.env.PROD for production)
    debug: true, // Enable debug mode to see console logs
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    sendDefaultPii: true,

    // Log before sending
    beforeSend(event) {
      // eslint-disable-next-line no-console
      console.log(
        "📤 Sentry sending event:",
        event.event_id,
        event.exception?.values?.[0]?.value
      );
      return event;
    },
  });

  // Debug log
  // eslint-disable-next-line no-console
  console.log("✅ Sentry enabled with tunnel:", tunnelUrl);
} else {
  // eslint-disable-next-line no-console
  console.warn(
    "⚠️ Sentry DSN is not set. Add VITE_SENTRY_DSN to web/.env.local to enable error reporting."
  );
}

// Expose Sentry globally for testing
if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).Sentry = Sentry;
  // eslint-disable-next-line no-console
  console.log('💡 Test: window.Sentry.captureException(new Error("test"))');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </StrictMode>
);
