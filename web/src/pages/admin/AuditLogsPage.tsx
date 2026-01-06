/**
 * Audit Logs Page
 *
 * Admin interface for viewing audit logs:
 * - View all admin and security-related actions
 * - Filter by action type, actor, resource
 * - Export audit data
 */

import { useState } from "react";
import {
  ClockIcon,
  DocumentTextIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import { useAuditLogs, type AuditLogEntry } from "@/lib/admin-hooks";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { cn } from "@/lib/utils";

/**
 * Action type badge
 */
function ActionBadge({ action }: { action: string }) {
  const getColor = () => {
    if (action.includes("create") || action.includes("add")) {
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    }
    if (
      action.includes("delete") ||
      action.includes("remove") ||
      action.includes("suspend")
    ) {
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    }
    if (
      action.includes("update") ||
      action.includes("rotate") ||
      action.includes("change")
    ) {
      return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
    }
    return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  };

  return (
    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", getColor())}>
      {action}
    </span>
  );
}

/**
 * Actor type badge
 */
function ActorTypeBadge({ type }: { type: "user" | "system" | "api" }) {
  const config = {
    user: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    system:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    api: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };

  return (
    <span
      className={cn("px-2 py-0.5 rounded text-xs font-medium", config[type])}
    >
      {type}
    </span>
  );
}

/**
 * Log entry details modal
 */
function LogDetailsModal({
  log,
  onClose,
}: {
  log: AuditLogEntry | null;
  onClose: () => void;
}) {
  if (!log) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Audit Log Details
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Timestamp */}
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Timestamp</p>
            <p className="text-gray-900 dark:text-white">
              {new Date(log.timestamp).toLocaleString()}
            </p>
          </div>

          {/* Actor */}
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Actor</p>
            <div className="flex items-center gap-2">
              <ActorTypeBadge type={log.actor_type} />
              <span className="text-gray-900 dark:text-white">
                {log.actor_email}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">ID: {log.actor_id}</p>
          </div>

          {/* Action */}
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Action</p>
            <ActionBadge action={log.action} />
          </div>

          {/* Resource */}
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Resource</p>
            <p className="text-gray-900 dark:text-white">
              {log.resource_type}: {log.resource_id}
            </p>
          </div>

          {/* Details */}
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Details</p>
            <pre className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-sm text-gray-700 dark:text-gray-300 overflow-x-auto">
              {JSON.stringify(log.details, null, 2)}
            </pre>
          </div>

          {/* IP & User Agent */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-500 mb-1">
                IP Address
              </p>
              <p className="text-gray-900 dark:text-white font-mono text-sm">
                {log.ip_address ?? "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 mb-1">
                User Agent
              </p>
              <p className="text-gray-900 dark:text-white text-sm truncate">
                {log.user_agent ?? "N/A"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  const { data, isLoading } = useAuditLogs({
    page,
    pageSize: 50,
    action: actionFilter || undefined,
    resource_type: resourceTypeFilter || undefined,
    start_date: startDate || undefined,
    end_date: endDate || undefined,
  });

  const handleExport = () => {
    // In production, this would call an API to generate CSV
    const csvContent = [
      [
        "Timestamp",
        "Actor",
        "Action",
        "Resource Type",
        "Resource ID",
        "IP Address",
      ].join(","),
      ...(data?.logs ?? []).map((log) =>
        [
          new Date(log.timestamp).toISOString(),
          log.actor_email,
          log.action,
          log.resource_type,
          log.resource_id,
          log.ip_address ?? "",
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Audit Logs
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Security and administrative action history
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <ArrowDownTrayIcon className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Action Filter */}
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Actions</option>
            <option value="secret.rotate">Secret Rotation</option>
            <option value="secret.rollback">Secret Rollback</option>
            <option value="user.suspend">User Suspend</option>
            <option value="user.unsuspend">User Unsuspend</option>
            <option value="org.suspend">Org Suspend</option>
            <option value="org.unsuspend">Org Unsuspend</option>
            <option value="settings.update">Settings Update</option>
          </select>

          {/* Resource Type Filter */}
          <select
            value={resourceTypeFilter}
            onChange={(e) => {
              setResourceTypeFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Resources</option>
            <option value="secret">Secrets</option>
            <option value="user">Users</option>
            <option value="organization">Organizations</option>
            <option value="integration">Integrations</option>
            <option value="settings">Settings</option>
          </select>

          {/* Date Range */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Clear Filters */}
          {(actionFilter || resourceTypeFilter || startDate || endDate) && (
            <button
              onClick={() => {
                setActionFilter("");
                setResourceTypeFilter("");
                setStartDate("");
                setEndDate("");
                setPage(1);
              }}
              className="text-sm text-brand-600 hover:text-brand-700"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Logs Table */}
      {isLoading ? (
        <div className="card p-8 flex items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Timestamp
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Actor
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Action
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Resource
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  IP Address
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {data?.logs.map((log) => (
                <tr
                  key={log.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                      <ClockIcon className="w-4 h-4 text-gray-400" />
                      {new Date(log.timestamp).toLocaleString()}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ActorTypeBadge type={log.actor_type} />
                      <span className="text-sm text-gray-900 dark:text-white truncate max-w-[150px]">
                        {log.actor_email}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <ActionBadge action={log.action} />
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm text-gray-900 dark:text-white">
                        {log.resource_type}
                      </p>
                      <p className="text-xs text-gray-500 font-mono truncate max-w-[150px]">
                        {log.resource_id}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 font-mono">
                    {log.ip_address ?? "N/A"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedLog(log)}
                      className="text-brand-600 hover:text-brand-700 text-sm font-medium"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Empty State */}
          {(!data?.logs || data.logs.length === 0) && (
            <div className="p-8 text-center">
              <DocumentTextIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-500">No audit logs found</p>
            </div>
          )}

          {/* Pagination */}
          {data && data.total > 50 && (
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Showing {(page - 1) * 50 + 1} to{" "}
                {Math.min(page * 50, data.total)} of {data.total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={page * 50 >= data.total}
                  className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Details Modal */}
      <LogDetailsModal log={selectedLog} onClose={() => setSelectedLog(null)} />
    </div>
  );
}
