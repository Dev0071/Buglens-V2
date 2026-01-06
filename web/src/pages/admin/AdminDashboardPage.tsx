/**
 * Admin Dashboard Overview Page
 *
 * Central hub for platform administration showing:
 * - System health status
 * - Key metrics (organizations, users, events, costs)
 * - Recent alerts and issues
 * - Quick actions
 */

import { Link } from "react-router-dom";
import {
  ShieldCheckIcon,
  BuildingOfficeIcon,
  UsersIcon,
  ExclamationCircleIcon,
  CurrencyDollarIcon,
  KeyIcon,
  ServerIcon,
  ClockIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  useSecretStatus,
  useGlobalAnalytics,
  useSystemHealth,
} from "@/lib/admin-hooks";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { cn } from "@/lib/utils";

/**
 * Status indicator component
 */
function StatusBadge({
  status,
}: {
  status: "healthy" | "degraded" | "critical" | "warning";
}) {
  const config = {
    healthy: {
      color:
        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
      icon: CheckCircleIcon,
      label: "Healthy",
    },
    degraded: {
      color:
        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
      icon: ExclamationTriangleIcon,
      label: "Degraded",
    },
    critical: {
      color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
      icon: XCircleIcon,
      label: "Critical",
    },
    warning: {
      color:
        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
      icon: ExclamationTriangleIcon,
      label: "Warning",
    },
  };

  const { color, icon: Icon, label } = config[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
        color
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

/**
 * Metric card component
 */
function MetricCard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  href,
}: {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: React.ElementType;
  href?: string;
}) {
  const content = (
    <div className="card p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className="p-2 rounded-lg bg-brand-50 dark:bg-brand-900/20">
          <Icon className="w-5 h-5 text-brand-600 dark:text-brand-400" />
        </div>
        {change !== undefined && (
          <div
            className={cn(
              "flex items-center gap-1 text-xs font-medium",
              change >= 0
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            )}
          >
            {change >= 0 ? (
              <ArrowTrendingUpIcon className="w-3.5 h-3.5" />
            ) : (
              <ArrowTrendingDownIcon className="w-3.5 h-3.5" />
            )}
            {Math.abs(change)}%
          </div>
        )}
      </div>
      <div className="mt-4">
        <p className="text-2xl font-bold text-gray-900 dark:text-white">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{title}</p>
        {changeLabel && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            {changeLabel}
          </p>
        )}
      </div>
    </div>
  );

  if (href) {
    return <Link to={href}>{content}</Link>;
  }

  return content;
}

/**
 * Service status card
 */
function ServiceStatusCard({
  name,
  status,
  latency,
  extra,
}: {
  name: string;
  status: string;
  latency?: number;
  extra?: string;
}) {
  const isHealthy = status === "healthy" || status === "connected";

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "w-2 h-2 rounded-full",
            isHealthy ? "bg-green-500" : "bg-red-500"
          )}
        />
        <span className="text-sm font-medium text-gray-900 dark:text-white">
          {name}
        </span>
      </div>
      <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
        {latency !== undefined && <span>{latency}ms</span>}
        {extra && <span>{extra}</span>}
        <span className={isHealthy ? "text-green-600" : "text-red-600"}>
          {status}
        </span>
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { data: secretStatus, isLoading: secretsLoading } = useSecretStatus();
  const { data: analytics, isLoading: analyticsLoading } = useGlobalAnalytics();
  const { data: health, isLoading: healthLoading } = useSystemHealth();

  const isLoading = secretsLoading || analyticsLoading || healthLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Calculate alert count
  const alertCount =
    (secretStatus?.summary.expiring_soon ?? 0) +
    (secretStatus?.summary.overdue ?? 0) +
    (secretStatus?.summary.missing ?? 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Admin Dashboard
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Platform overview and administration
          </p>
        </div>
        <StatusBadge status={health?.status ?? "healthy"} />
      </div>

      {/* Alerts Banner */}
      {alertCount > 0 && (
        <div className="card bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 p-4">
          <div className="flex items-center gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            <div className="flex-1">
              <p className="font-medium text-orange-800 dark:text-orange-200">
                {alertCount} secret{alertCount > 1 ? "s" : ""} need attention
              </p>
              <p className="text-sm text-orange-600 dark:text-orange-400">
                {secretStatus?.summary.overdue ?? 0} overdue,{" "}
                {secretStatus?.summary.expiring_soon ?? 0} expiring soon,{" "}
                {secretStatus?.summary.missing ?? 0} missing
              </p>
            </div>
            <Link
              to="/admin/secrets"
              className="text-sm font-medium text-orange-700 dark:text-orange-300 hover:underline"
            >
              View Details →
            </Link>
          </div>
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Organizations"
          value={analytics?.organizations.total ?? 0}
          change={
            analytics?.organizations.new_30d
              ? Math.round(
                  (analytics.organizations.new_30d /
                    analytics.organizations.total) *
                    100
                )
              : 0
          }
          changeLabel={`${analytics?.organizations.new_30d ?? 0} new this month`}
          icon={BuildingOfficeIcon}
          href="/admin/organizations"
        />
        <MetricCard
          title="Users"
          value={analytics?.users.total ?? 0}
          change={
            analytics?.users.new_30d
              ? Math.round(
                  (analytics.users.new_30d / analytics.users.total) * 100
                )
              : 0
          }
          changeLabel={`${analytics?.users.active_30d ?? 0} active this month`}
          icon={UsersIcon}
          href="/admin/users"
        />
        <MetricCard
          title="Events (30d)"
          value={analytics?.events.last_30d ?? 0}
          icon={ExclamationCircleIcon}
        />
        <MetricCard
          title="Total Cost (30d)"
          value={`$${(analytics?.costs.total_30d ?? 0).toFixed(2)}`}
          icon={CurrencyDollarIcon}
          href="/admin/analytics"
        />
      </div>

      {/* System Status & Secrets Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Health */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              System Health
            </h2>
            <Link
              to="/admin/system"
              className="text-sm text-brand-600 hover:text-brand-700"
            >
              View All →
            </Link>
          </div>
          <div className="space-y-1">
            <ServiceStatusCard
              name="Database"
              status={health?.services.database.status ?? "unknown"}
              latency={health?.services.database.latency_ms}
            />
            <ServiceStatusCard
              name="Redis"
              status={health?.services.redis.status ?? "unknown"}
              latency={health?.services.redis.latency_ms}
            />
            <ServiceStatusCard
              name="S3 Cache"
              status={health?.services.s3.status ?? "unknown"}
              latency={health?.services.s3.latency_ms}
            />
            <ServiceStatusCard
              name="GitHub API"
              status={health?.services.github_api.status ?? "unknown"}
              extra={`${health?.services.github_api.rate_limit_remaining ?? 0} remaining`}
            />
          </div>

          {/* Queue Stats */}
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Job Queue
            </h3>
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {health?.queues.rca_jobs.waiting ?? 0}
                </p>
                <p className="text-xs text-gray-500">Waiting</p>
              </div>
              <div>
                <p className="text-xl font-bold text-blue-600">
                  {health?.queues.rca_jobs.active ?? 0}
                </p>
                <p className="text-xs text-gray-500">Active</p>
              </div>
              <div>
                <p className="text-xl font-bold text-green-600">
                  {health?.queues.rca_jobs.completed_24h ?? 0}
                </p>
                <p className="text-xs text-gray-500">Completed (24h)</p>
              </div>
              <div>
                <p className="text-xl font-bold text-red-600">
                  {health?.queues.rca_jobs.failed_24h ?? 0}
                </p>
                <p className="text-xs text-gray-500">Failed (24h)</p>
              </div>
            </div>
          </div>
        </div>

        {/* Secret Status */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Secret Status
            </h2>
            <Link
              to="/admin/secrets"
              className="text-sm text-brand-600 hover:text-brand-700"
            >
              Manage →
            </Link>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="text-center p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
              <p className="text-xl font-bold text-gray-900 dark:text-white">
                {secretStatus?.summary.total ?? 0}
              </p>
              <p className="text-xs text-gray-500">Total</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
              <p className="text-xl font-bold text-green-600">
                {secretStatus?.summary.healthy ?? 0}
              </p>
              <p className="text-xs text-gray-500">Healthy</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20">
              <p className="text-xl font-bold text-yellow-600">
                {secretStatus?.summary.expiring_soon ?? 0}
              </p>
              <p className="text-xs text-gray-500">Expiring</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-900/20">
              <p className="text-xl font-bold text-red-600">
                {(secretStatus?.summary.overdue ?? 0) +
                  (secretStatus?.summary.missing ?? 0)}
              </p>
              <p className="text-xs text-gray-500">Action Needed</p>
            </div>
          </div>

          {/* Secret List */}
          <div className="space-y-2">
            {secretStatus?.secrets.slice(0, 5).map((secret) => (
              <div
                key={secret.secret_type}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <KeyIcon className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {secret.secret_type.replace(/_/g, " ")}
                  </span>
                </div>
                <StatusBadge
                  status={
                    secret.status === "healthy"
                      ? "healthy"
                      : secret.status === "expiring_soon"
                        ? "warning"
                        : "critical"
                  }
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RCA Performance */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          RCA Performance (30 days)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">
              {analytics?.rcas.total.toLocaleString() ?? 0}
            </p>
            <p className="text-sm text-gray-500">Total RCAs</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-green-600">
              {((analytics?.rcas.success_rate ?? 0) * 100).toFixed(1)}%
            </p>
            <p className="text-sm text-gray-500">Success Rate</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-blue-600">
              {((analytics?.rcas.avg_latency_ms ?? 0) / 1000).toFixed(1)}s
            </p>
            <p className="text-sm text-gray-500">Avg Latency</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-purple-600">
              ${(analytics?.costs.llm_costs ?? 0).toFixed(2)}
            </p>
            <p className="text-sm text-gray-500">LLM Costs</p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link
            to="/admin/secrets"
            className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <KeyIcon className="w-6 h-6 text-brand-600" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              Rotate Secrets
            </span>
          </Link>
          <Link
            to="/admin/system"
            className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <ServerIcon className="w-6 h-6 text-brand-600" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              System Health
            </span>
          </Link>
          <Link
            to="/admin/audit"
            className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <ClockIcon className="w-6 h-6 text-brand-600" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              Audit Logs
            </span>
          </Link>
          <Link
            to="/admin/analytics"
            className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <ShieldCheckIcon className="w-6 h-6 text-brand-600" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              Platform Analytics
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
