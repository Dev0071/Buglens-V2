/**
 * System Health Page
 *
 * Admin interface for monitoring system health:
 * - Service status (Database, Redis, S3, GitHub API)
 * - Job queue monitoring
 * - Resource metrics
 * - Cache health
 */

import { useState } from "react";
import {
  ServerIcon,
  CircleStackIcon,
  CpuChipIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import { useSystemHealth, useJobQueue, useRetryJob } from "@/lib/admin-hooks";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

/**
 * Service status card
 */
function ServiceCard({
  name,
  icon: Icon,
  status,
  latency,
  extra,
}: {
  name: string;
  icon: React.ElementType;
  status: string;
  latency?: number;
  extra?: string;
}) {
  const isHealthy = status === "healthy" || status === "connected";
  const isWarning = status === "degraded" || status === "warning";

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "p-2 rounded-lg",
              isHealthy
                ? "bg-green-100 dark:bg-green-900/30"
                : isWarning
                  ? "bg-yellow-100 dark:bg-yellow-900/30"
                  : "bg-red-100 dark:bg-red-900/30"
            )}
          >
            <Icon
              className={cn(
                "w-5 h-5",
                isHealthy
                  ? "text-green-600"
                  : isWarning
                    ? "text-yellow-600"
                    : "text-red-600"
              )}
            />
          </div>
          <span className="font-medium text-gray-900 dark:text-white">
            {name}
          </span>
        </div>
        <div
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
            isHealthy
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : isWarning
                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          )}
        >
          {isHealthy ? (
            <CheckCircleIcon className="w-3.5 h-3.5" />
          ) : isWarning ? (
            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
          ) : (
            <XCircleIcon className="w-3.5 h-3.5" />
          )}
          {status}
        </div>
      </div>
      <div className="flex items-center justify-between text-sm text-gray-500">
        {latency !== undefined && <span>Latency: {latency}ms</span>}
        {extra && <span>{extra}</span>}
      </div>
    </div>
  );
}

/**
 * Queue stats card
 */
function QueueStatsCard({
  waiting,
  active,
  completed24h,
  failed24h,
}: {
  waiting: number;
  active: number;
  completed24h: number;
  failed24h: number;
}) {
  const total24h = completed24h + failed24h;
  const successRate =
    total24h > 0 ? ((completed24h / total24h) * 100).toFixed(1) : "100";

  return (
    <div className="card p-6">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
        RCA Job Queue
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {waiting}
          </p>
          <p className="text-xs text-gray-500">Waiting</p>
        </div>
        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <p className="text-2xl font-bold text-blue-600">{active}</p>
          <p className="text-xs text-gray-500">Active</p>
        </div>
        <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <p className="text-2xl font-bold text-green-600">{completed24h}</p>
          <p className="text-xs text-gray-500">Completed (24h)</p>
        </div>
        <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-2xl font-bold text-red-600">{failed24h}</p>
          <p className="text-xs text-gray-500">Failed (24h)</p>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Success Rate (24h)</span>
          <span
            className={cn(
              "text-sm font-medium",
              parseFloat(successRate) >= 95
                ? "text-green-600"
                : parseFloat(successRate) >= 80
                  ? "text-yellow-600"
                  : "text-red-600"
            )}
          >
            {successRate}%
          </span>
        </div>
        <div className="mt-2 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full",
              parseFloat(successRate) >= 95
                ? "bg-green-500"
                : parseFloat(successRate) >= 80
                  ? "bg-yellow-500"
                  : "bg-red-500"
            )}
            style={{ width: `${successRate}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Resource metrics card
 */
function ResourceMetricsCard({
  cpuUsage,
  memoryUsage,
  activeConnections,
}: {
  cpuUsage: number;
  memoryUsage: number;
  activeConnections: number;
}) {
  return (
    <div className="card p-6">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
        Resource Metrics
      </h3>
      <div className="space-y-4">
        {/* CPU */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-500">CPU Usage</span>
            <span
              className={cn(
                "text-sm font-medium",
                cpuUsage < 70
                  ? "text-green-600"
                  : cpuUsage < 90
                    ? "text-yellow-600"
                    : "text-red-600"
              )}
            >
              {cpuUsage}%
            </span>
          </div>
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                cpuUsage < 70
                  ? "bg-green-500"
                  : cpuUsage < 90
                    ? "bg-yellow-500"
                    : "bg-red-500"
              )}
              style={{ width: `${cpuUsage}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-500">Memory Usage</span>
            <span
              className={cn(
                "text-sm font-medium",
                memoryUsage < 70
                  ? "text-green-600"
                  : memoryUsage < 90
                    ? "text-yellow-600"
                    : "text-red-600"
              )}
            >
              {memoryUsage}%
            </span>
          </div>
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                memoryUsage < 70
                  ? "bg-green-500"
                  : memoryUsage < 90
                    ? "bg-yellow-500"
                    : "bg-red-500"
              )}
              style={{ width: `${memoryUsage}%` }}
            />
          </div>
        </div>

        {/* Connections */}
        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Active DB Connections</span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {activeConnections}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Job list component
 */
function JobsList() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const {
    data: jobData,
    isLoading,
    refetch,
  } = useJobQueue({
    status: statusFilter || undefined,
    limit: 50,
  });
  const retryJob = useRetryJob();
  const toast = useToast();

  const handleRetry = async (jobId: string) => {
    try {
      await retryJob.mutateAsync(jobId);
      toast.success(
        "Job Requeued",
        "The job has been added back to the queue."
      );
      refetch();
    } catch (error) {
      toast.error(
        "Error",
        error instanceof Error ? error.message : "Failed to retry job"
      );
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">
          Recent Jobs
        </h3>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="">All Status</option>
            <option value="waiting">Waiting</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <button
            onClick={() => refetch()}
            className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            <ArrowPathIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 flex items-center justify-center">
          <LoadingSpinner size="md" />
        </div>
      ) : (
        <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
          {jobData?.jobs.map((job) => (
            <div
              key={job.id}
              className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "p-1.5 rounded-full",
                      job.status === "completed"
                        ? "bg-green-100 text-green-600"
                        : job.status === "active"
                          ? "bg-blue-100 text-blue-600"
                          : job.status === "waiting"
                            ? "bg-gray-100 text-gray-600"
                            : "bg-red-100 text-red-600"
                    )}
                  >
                    {job.status === "completed" ? (
                      <CheckCircleIcon className="w-4 h-4" />
                    ) : job.status === "active" ? (
                      <PlayIcon className="w-4 h-4" />
                    ) : job.status === "waiting" ? (
                      <ClockIcon className="w-4 h-4" />
                    ) : (
                      <XCircleIcon className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      Job {job.id.slice(0, 8)}...
                    </p>
                    <p className="text-xs text-gray-500">
                      Event: {job.event_id.slice(0, 8)}... • Attempt{" "}
                      {job.attempts}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "text-xs font-medium px-2 py-0.5 rounded",
                      job.status === "completed"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : job.status === "active"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          : job.status === "waiting"
                            ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    )}
                  >
                    {job.status}
                  </span>
                  {job.status === "failed" && (
                    <button
                      onClick={() => handleRetry(job.id)}
                      disabled={retryJob.isPending}
                      className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
              {job.error && (
                <p className="mt-2 text-xs text-red-500 truncate">
                  {job.error}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                Created: {new Date(job.created_at).toLocaleString()}
                {job.completed_at &&
                  ` • Completed: ${new Date(job.completed_at).toLocaleString()}`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SystemHealthPage() {
  const { data: health, isLoading, refetch } = useSystemHealth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            System Health
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Monitor platform services and resources
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            Last updated:{" "}
            {health?.timestamp
              ? new Date(health.timestamp).toLocaleTimeString()
              : "N/A"}
          </span>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Overall Status */}
      <div
        className={cn(
          "card p-4",
          health?.status === "healthy"
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
            : health?.status === "degraded"
              ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        )}
      >
        <div className="flex items-center gap-3">
          {health?.status === "healthy" ? (
            <CheckCircleIcon className="w-6 h-6 text-green-600" />
          ) : health?.status === "degraded" ? (
            <ExclamationTriangleIcon className="w-6 h-6 text-yellow-600" />
          ) : (
            <XCircleIcon className="w-6 h-6 text-red-600" />
          )}
          <div>
            <p
              className={cn(
                "font-semibold",
                health?.status === "healthy"
                  ? "text-green-800 dark:text-green-200"
                  : health?.status === "degraded"
                    ? "text-yellow-800 dark:text-yellow-200"
                    : "text-red-800 dark:text-red-200"
              )}
            >
              System Status: {health?.status?.toUpperCase() ?? "UNKNOWN"}
            </p>
            <p
              className={cn(
                "text-sm",
                health?.status === "healthy"
                  ? "text-green-600 dark:text-green-400"
                  : health?.status === "degraded"
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-red-600 dark:text-red-400"
              )}
            >
              {health?.status === "healthy"
                ? "All services are operating normally"
                : health?.status === "degraded"
                  ? "Some services are experiencing issues"
                  : "Critical issues detected"}
            </p>
          </div>
        </div>
      </div>

      {/* Services */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <ServiceCard
          name="Database"
          icon={CircleStackIcon}
          status={health?.services.database.status ?? "unknown"}
          latency={health?.services.database.latency_ms}
        />
        <ServiceCard
          name="Redis"
          icon={ServerIcon}
          status={health?.services.redis.status ?? "unknown"}
          latency={health?.services.redis.latency_ms}
        />
        <ServiceCard
          name="S3 Cache"
          icon={CircleStackIcon}
          status={health?.services.s3.status ?? "unknown"}
          latency={health?.services.s3.latency_ms}
        />
        <ServiceCard
          name="GitHub API"
          icon={CpuChipIcon}
          status={health?.services.github_api.status ?? "unknown"}
          extra={`${health?.services.github_api.rate_limit_remaining ?? 0} requests remaining`}
        />
      </div>

      {/* Queue Stats & Resource Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <QueueStatsCard
          waiting={health?.queues.rca_jobs.waiting ?? 0}
          active={health?.queues.rca_jobs.active ?? 0}
          completed24h={health?.queues.rca_jobs.completed_24h ?? 0}
          failed24h={health?.queues.rca_jobs.failed_24h ?? 0}
        />
        <ResourceMetricsCard
          cpuUsage={health?.metrics.cpu_usage ?? 0}
          memoryUsage={health?.metrics.memory_usage ?? 0}
          activeConnections={health?.metrics.active_connections ?? 0}
        />
      </div>

      {/* Jobs List */}
      <JobsList />
    </div>
  );
}
