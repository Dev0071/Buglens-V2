import { useState, useEffect } from "react";
import {
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentIcon,
} from "@heroicons/react/24/outline";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import {
  useIntegrations,
  useDisconnectIntegration,
  useConnectIntegration,
} from "@/lib/hooks";

import type { Integration } from "@/types/api";

/**
 * Integrations page for managing all external service connections
 */
function IntegrationsPage() {
  const { data: integrations, isLoading, refetch } = useIntegrations();
  const disconnectMutation = useDisconnectIntegration();
  const connectMutation = useConnectIntegration();

  const [showSentryModal, setShowSentryModal] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Handle URL params for OAuth callbacks
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");

    if (success) {
      const integrationName = success.replace("_connected", "").toUpperCase();
      setNotification({
        type: "success",
        message: `${integrationName} integration connected successfully!`,
      });
      // Clean up URL
      window.history.replaceState({}, "", "/integrations");
      refetch();
    } else if (error) {
      setNotification({
        type: "error",
        message: `Integration failed: ${error.replace(/_/g, " ")}`,
      });
      window.history.replaceState({}, "", "/integrations");
    }
  }, [refetch]);

  // Auto-dismiss notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Default integrations if none exist - now includes all 5
  const defaultIntegrations: Integration[] = [
    { id: "sentry", type: "sentry", name: "Sentry", status: "disconnected" },
    { id: "github", type: "github", name: "GitHub", status: "disconnected" },
    { id: "slack", type: "slack", name: "Slack", status: "disconnected" },
    { id: "jira", type: "jira", name: "Jira", status: "disconnected" },
    {
      id: "teams",
      type: "teams",
      name: "Microsoft Teams",
      status: "disconnected",
    },
  ];

  const displayIntegrations = integrations ?? defaultIntegrations;

  const handleConnect = (type: string) => {
    if (type === "sentry") {
      // Sentry uses API key configuration, not OAuth
      setShowSentryModal(true);
    } else {
      // OAuth-based integrations redirect to the OAuth flow
      window.location.href = `/api/integrations/${type}/connect`;
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await disconnectMutation.mutateAsync(id);
      setNotification({ type: "success", message: "Integration disconnected" });
      refetch();
    } catch {
      setNotification({
        type: "error",
        message: "Failed to disconnect integration",
      });
    }
  };

  const handleSentryConnect = async (config: {
    projectSlug: string;
    organizationSlug: string;
    dsn?: string;
  }) => {
    try {
      await connectMutation.mutateAsync({
        type: "sentry",
        config,
      });
      setShowSentryModal(false);
      setNotification({
        type: "success",
        message: "Sentry integration configured!",
      });
      refetch();
    } catch {
      setNotification({
        type: "error",
        message: "Failed to configure Sentry integration",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Integrations
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Connect your tools to enable automated RCA and notifications
        </p>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div
          className={`p-4 rounded-lg flex items-center gap-3 ${
            notification.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
          }`}
        >
          {notification.type === "success" ? (
            <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
          ) : (
            <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400" />
          )}
          <p
            className={
              notification.type === "success"
                ? "text-green-800 dark:text-green-200"
                : "text-red-800 dark:text-red-200"
            }
          >
            {notification.message}
          </p>
        </div>
      )}

      {/* Integration Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <>
          {/* Error Tracking Section */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Error Tracking
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayIntegrations
                .filter((i) => i.type === "sentry")
                .map((integration) => (
                  <IntegrationCard
                    key={integration.id}
                    integration={integration}
                    onConnect={() => handleConnect(integration.type)}
                    onDisconnect={() => handleDisconnect(integration.id)}
                  />
                ))}
            </div>
          </section>

          {/* Source Control Section */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Source Control
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayIntegrations
                .filter((i) => i.type === "github")
                .map((integration) => (
                  <IntegrationCard
                    key={integration.id}
                    integration={integration}
                    onConnect={() => handleConnect(integration.type)}
                    onDisconnect={() => handleDisconnect(integration.id)}
                  />
                ))}
            </div>
          </section>

          {/* Notifications Section */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Notifications
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayIntegrations
                .filter((i) => i.type === "slack" || i.type === "teams")
                .map((integration) => (
                  <IntegrationCard
                    key={integration.id}
                    integration={integration}
                    onConnect={() => handleConnect(integration.type)}
                    onDisconnect={() => handleDisconnect(integration.id)}
                  />
                ))}
            </div>
          </section>

          {/* Issue Tracking Section */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Issue Tracking
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayIntegrations
                .filter((i) => i.type === "jira")
                .map((integration) => (
                  <IntegrationCard
                    key={integration.id}
                    integration={integration}
                    onConnect={() => handleConnect(integration.type)}
                    onDisconnect={() => handleDisconnect(integration.id)}
                  />
                ))}
            </div>
          </section>
        </>
      )}

      {/* Sentry Configuration Modal */}
      {showSentryModal && (
        <SentryConfigModal
          onClose={() => setShowSentryModal(false)}
          onConnect={handleSentryConnect}
          isLoading={connectMutation.isPending}
        />
      )}
    </div>
  );
}

/**
 * Sentry configuration modal component
 */
function SentryConfigModal({
  onClose,
  onConnect,
  isLoading,
}: {
  onClose: () => void;
  onConnect: (config: {
    projectSlug: string;
    organizationSlug: string;
    dsn?: string;
  }) => void;
  isLoading: boolean;
}) {
  const [projectSlug, setProjectSlug] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [dsn, setDsn] = useState("");
  const [copied, setCopied] = useState(false);

  const webhookUrl = `${window.location.origin}/api/v1/webhooks/sentry`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConnect({ projectSlug, organizationSlug, dsn: dsn || undefined });
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4">
        <div className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Configure Sentry Integration
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Organization Slug
              </label>
              <input
                type="text"
                value={organizationSlug}
                onChange={(e) => setOrganizationSlug(e.target.value)}
                placeholder="my-organization"
                className="input w-full"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Found in your Sentry URL: sentry.io/organizations/
                <strong>my-organization</strong>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Project Slug
              </label>
              <input
                type="text"
                value={projectSlug}
                onChange={(e) => setProjectSlug(e.target.value)}
                placeholder="my-project"
                className="input w-full"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Found in your project settings
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                DSN (Optional)
              </label>
              <input
                type="text"
                value={dsn}
                onChange={(e) => setDsn(e.target.value)}
                placeholder="https://xxx@sentry.io/xxx"
                className="input w-full"
              />
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Webhook URL (Add this to Sentry)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={webhookUrl}
                  readOnly
                  className="input w-full text-sm bg-white dark:bg-gray-800"
                />
                <button
                  type="button"
                  onClick={copyToClipboard}
                  className="btn btn-secondary flex items-center gap-1"
                >
                  <ClipboardDocumentIcon className="w-4 h-4" />
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Go to Sentry → Settings → Integrations → Webhooks and add this
                URL
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || !projectSlug || !organizationSlug}
                className="btn btn-primary flex-1"
              >
                {isLoading ? "Connecting..." : "Connect Sentry"}
              </button>
            </div>
          </form>
        </div>
      </div>
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
      <div className="w-12 h-12 bg-[#362D59] rounded-lg flex items-center justify-center">
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
    jira: (
      <div className="w-12 h-12 bg-[#0052CC] rounded-lg flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="white">
          <path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.005 1.005 0 0 0 23.013 0z" />
        </svg>
      </div>
    ),
    teams: (
      <div className="w-12 h-12 bg-[#5059C9] rounded-lg flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="white">
          <path d="M20.625 8.5h-6.25a.625.625 0 0 0-.625.625v6.25c0 .345.28.625.625.625h6.25c.345 0 .625-.28.625-.625v-6.25a.625.625 0 0 0-.625-.625zM17.5 4.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5zM10 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 7.5c-2.67 0-8 1.34-8 4v2.5h16v-2.5c0-2.66-5.33-4-8-4z" />
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
    jira: "Create and link issues automatically",
    teams: "Get notifications in Microsoft Teams",
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
      return metadata.organization_slug
        ? `Organization: ${metadata.organization_slug}`
        : null;
    case "github":
      return metadata.login ? `Account: ${metadata.login}` : null;
    case "slack":
      return metadata.team_name ? `Workspace: ${metadata.team_name}` : null;
    case "jira":
      return metadata.cloud_id ? `Site connected` : null;
    case "teams":
      return metadata.tenant_id ? `Tenant connected` : null;
    default:
      return null;
  }
}

export default IntegrationsPage;
