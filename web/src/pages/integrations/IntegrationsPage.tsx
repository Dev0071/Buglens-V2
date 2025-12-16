import {
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { useIntegrations, useDisconnectIntegration } from "@/lib/hooks";

import type { Integration } from "@/types/api";

/**
 * Integrations page for managing Sentry, GitHub, and Slack connections
 */
function IntegrationsPage() {
  const { data: integrations, isLoading, refetch } = useIntegrations();

  const disconnectMutation = useDisconnectIntegration();

  // Default integrations if none exist
  const defaultIntegrations: Integration[] = [
    { id: "sentry", type: "sentry", name: "Sentry", status: "disconnected" },
    { id: "github", type: "github", name: "GitHub", status: "disconnected" },
    { id: "slack", type: "slack", name: "Slack", status: "disconnected" },
  ];

  const displayIntegrations = integrations ?? defaultIntegrations;

  const handleConnect = (type: string) => {
    // Redirect to OAuth flow based on integration type
    window.location.href = `/api/integrations/${type}/connect`;
  };

  const handleDisconnect = async (id: string) => {
    try {
      await disconnectMutation.mutateAsync(id);
      refetch();
    } catch (error) {
      console.error("Failed to disconnect integration:", error);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Integrations
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Connect your tools to enable automated RCA and notifications
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayIntegrations.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              onConnect={() => handleConnect(integration.type)}
              onDisconnect={() => handleDisconnect(integration.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Individual integration card component
 */
function IntegrationCard({
  integration,
  onConnect,
  onDisconnect,
}: {
  integration: Integration;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const isConnected = integration.status === "connected";
  const hasError = integration.status === "error";

  return (
    <div className="card">
      <div className="card-body">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <IntegrationIcon type={integration.type} />
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {integration.name}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {getIntegrationDescription(integration.type)}
              </p>
            </div>
          </div>
          <StatusIndicator status={integration.status} />
        </div>

        <div className="mt-4">
          {isConnected ? (
            <div className="space-y-3">
              {integration.metadata && (
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {getIntegrationMetadataDisplay(integration)}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={onConnect}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  <ArrowPathIcon className="w-4 h-4" />
                  Reconnect
                </button>
                <button
                  onClick={onDisconnect}
                  className="btn btn-ghost text-red-600 dark:text-red-400"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : hasError ? (
            <div className="space-y-3">
              <p className="text-sm text-red-600 dark:text-red-400">
                Connection error. Please reconnect.
              </p>
              <button onClick={onConnect} className="btn btn-primary">
                Reconnect
              </button>
            </div>
          ) : (
            <button onClick={onConnect} className="btn btn-primary w-full">
              Connect {integration.name}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Integration type icons
 */
function IntegrationIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    sentry: (
      <div className="w-12 h-12 bg-gray-900 dark:bg-gray-700 rounded-lg flex items-center justify-center">
        <svg
          className="w-8 h-8 text-white"
          viewBox="0 0 72 66"
          fill="currentColor"
        >
          <path d="M29,2.26a4.67,4.67,0,0,0-8,0L14.42,13.53A32.21,32.21,0,0,1,32.17,40.19H27.55A27.68,27.68,0,0,0,12.09,17.47L6,28a15.92,15.92,0,0,1,9.23,12.17H4.62A.76.76,0,0,1,4,39.06l2.94-5a10.74,10.74,0,0,0-3.36-1.9l-2.91,5a4.54,4.54,0,0,0,1.69,6.24A4.66,4.66,0,0,0,4.62,44H19.15a19.4,19.4,0,0,0-8-17.31l2.31-4A23.87,23.87,0,0,1,23.76,44H36.07a35.88,35.88,0,0,0-16.41-31.8l4.67-8a.77.77,0,0,1,1.05-.27c.53.29,20.29,34.77,20.66,35.17a.76.76,0,0,1-.68,1.13H40.6q.09,1.91,0,3.81h4.78A4.59,4.59,0,0,0,50,39.43a4.49,4.49,0,0,0-.62-2.28Z" />
        </svg>
      </div>
    ),
    github: (
      <div className="w-12 h-12 bg-gray-900 dark:bg-gray-700 rounded-lg flex items-center justify-center">
        <svg
          className="w-8 h-8 text-white"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
      </div>
    ),
    slack: (
      <div className="w-12 h-12 bg-white dark:bg-gray-700 rounded-lg flex items-center justify-center border border-gray-200 dark:border-gray-600">
        <svg className="w-8 h-8" viewBox="0 0 24 24">
          <path
            fill="#E01E5A"
            d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
          />
          <path
            fill="#36C5F0"
            d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
          />
          <path
            fill="#2EB67D"
            d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
          />
          <path
            fill="#ECB22E"
            d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
          />
        </svg>
      </div>
    ),
  };

  return (
    icons[type] || (
      <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-lg" />
    )
  );
}

/**
 * Status indicator component
 */
function StatusIndicator({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
        <CheckCircleIcon className="w-5 h-5" />
        Connected
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
        <XCircleIcon className="w-5 h-5" />
        Error
      </span>
    );
  }

  return (
    <span className="text-sm text-gray-500 dark:text-gray-400">
      Not connected
    </span>
  );
}

/**
 * Get description for integration type
 */
function getIntegrationDescription(type: string): string {
  const descriptions: Record<string, string> = {
    sentry: "Receive error events and stack traces",
    github: "Fetch source code for analysis",
    slack: "Get RCA notifications in your channels",
  };
  return descriptions[type] || "";
}

/**
 * Display metadata for connected integration
 */
function getIntegrationMetadataDisplay(
  integration: Integration
): React.ReactNode {
  const { type, metadata } = integration;

  if (!metadata) return null;

  switch (type) {
    case "sentry":
      return metadata.organization
        ? `Organization: ${metadata.organization}`
        : null;
    case "github":
      return metadata.login ? `Account: ${metadata.login}` : null;
    case "slack":
      return metadata.team ? `Workspace: ${metadata.team}` : null;
    default:
      return null;
  }
}

export default IntegrationsPage;
