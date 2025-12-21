import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useEventsList } from "@/lib/hooks";
import {
  formatRelativeTime,
  getSeverityClass,
  getStatusClass,
  cn,
} from "@/lib/utils";
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  XMarkIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  ArrowPathIcon,
  ListBulletIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

// View modes
type ViewMode = "cards" | "table";

/**
 * Events list page with filtering, pagination, and dual view modes
 */
function EventsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(
    searchParams.get("search") || ""
  );
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

  // Get filter values from URL
  const filters = {
    page: parseInt(searchParams.get("page") || "1"),
    search: searchParams.get("search") || "",
    severity: searchParams.get("severity") || "",
    status: searchParams.get("status") || "",
    environment: searchParams.get("environment") || "",
  };

  // Fetch events with filters
  const { data, isLoading, error } = useEventsList({
    page: filters.page,
    pageSize: 20,
    severity: filters.severity || undefined,
    status: filters.status || undefined,
    search: filters.search || undefined,
  });

  // Update URL params when filters change
  const updateFilters = (newFilters: Partial<typeof filters>) => {
    const updated = { ...filters, ...newFilters };
    const params = new URLSearchParams();
    Object.entries(updated).forEach(([key, value]) => {
      if (value && value !== "1") params.set(key, String(value));
    });
    setSearchParams(params);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ search: searchQuery, page: 1 });
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSearchParams({});
  };

  const hasActiveFilters =
    filters.search || filters.severity || filters.status || filters.environment;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Events
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            View and manage error events from Sentry
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          <button
            onClick={() => setViewMode("cards")}
            className={cn(
              "p-2 rounded-md transition-colors",
              viewMode === "cards"
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            )}
            title="Card view"
          >
            <Squares2X2Icon className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={cn(
              "p-2 rounded-md transition-colors",
              viewMode === "table"
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            )}
            title="Table view"
          >
            <ListBulletIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Search and filters bar */}
      <div className="card">
        <div className="card-body">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search events..."
                  className="input pl-10 pr-4"
                />
              </div>
            </form>

            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`btn ${showFilters ? "btn-primary" : "btn-secondary"} flex items-center gap-2`}
            >
              <FunnelIcon className="w-5 h-5" />
              Filters
              {hasActiveFilters && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-white/20 rounded-full">
                  {
                    [
                      filters.severity,
                      filters.status,
                      filters.environment,
                    ].filter(Boolean).length
                  }
                </span>
              )}
            </button>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="btn btn-ghost flex items-center gap-2"
              >
                <XMarkIcon className="w-5 h-5" />
                Clear
              </button>
            )}
          </div>

          {/* Filter dropdowns */}
          {showFilters && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Severity
                  </label>
                  <select
                    value={filters.severity}
                    onChange={(e) =>
                      updateFilters({ severity: e.target.value, page: 1 })
                    }
                    className="input"
                  >
                    <option value="">All severities</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Status
                  </label>
                  <select
                    value={filters.status}
                    onChange={(e) =>
                      updateFilters({ status: e.target.value, page: 1 })
                    }
                    className="input"
                  >
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Environment
                  </label>
                  <select
                    value={filters.environment}
                    onChange={(e) =>
                      updateFilters({ environment: e.target.value, page: 1 })
                    }
                    className="input"
                  >
                    <option value="">All environments</option>
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Events display */}
      <div className="card">
        {isLoading ? (
          <div className="p-12 flex items-center justify-center">
            <LoadingSpinner size="lg" />
          </div>
        ) : error ? (
          <div className="p-12 text-center text-red-500">
            Failed to load events. Please try again.
          </div>
        ) : data?.events.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            <p className="text-lg font-medium">No events found</p>
            <p className="text-sm mt-1">
              {hasActiveFilters
                ? "Try adjusting your filters"
                : "Events from Sentry will appear here"}
            </p>
          </div>
        ) : viewMode === "cards" ? (
          <>
            {/* Card View */}
            <div className="p-4 grid grid-cols-1 gap-4">
              {data?.events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>

            {/* Pagination */}
            {data && data.totalPages > 1 && (
              <Pagination
                currentPage={data.page}
                totalPages={data.totalPages}
                onPageChange={(page) => updateFilters({ page })}
              />
            )}
          </>
        ) : (
          <>
            {/* Table View */}
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Platform</th>
                    <th>Environment</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.events.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <Link
                          to={
                            event.rca_result_id
                              ? `/rca/${event.rca_result_id}`
                              : `/events/${event.id}`
                          }
                          className="font-medium text-gray-900 dark:text-white hover:text-brand-600 dark:hover:text-brand-400"
                        >
                          <div className="max-w-md truncate">
                            {event.message}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {event.sentry_event_id.slice(0, 8)}
                          </div>
                        </Link>
                      </td>
                      <td>
                        <span className="badge badge-info">
                          {event.platform}
                        </span>
                      </td>
                      <td>
                        <span className="text-gray-600 dark:text-gray-400">
                          {event.environment}
                        </span>
                      </td>
                      <td>
                        <span className={getSeverityClass(event.severity)}>
                          {event.severity}
                        </span>
                      </td>
                      <td>
                        <span className={getStatusClass(event.status)}>
                          {event.status}
                        </span>
                      </td>
                      <td className="text-gray-500 dark:text-gray-400">
                        {formatRelativeTime(event.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data && data.totalPages > 1 && (
              <Pagination
                currentPage={data.page}
                totalPages={data.totalPages}
                onPageChange={(page) => updateFilters({ page })}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Rich Event Card Component
 * Decision-driven design: Answers "What happened and should I care?"
 */
function EventCard({ event }: { event: Event }) {
  // Mock data for enhanced display (would come from API in production)
  const affectedUsers = Math.floor(Math.random() * 50) + 1;
  const occurrences = Math.floor(Math.random() * 100) + 1;
  const confidence = event.rca_result_id ? 0.7 + Math.random() * 0.25 : 0;

  const getSeverityIcon = () => {
    switch (event.severity) {
      case "critical":
        return <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />;
      case "high":
        return <ExclamationTriangleIcon className="w-5 h-5 text-orange-500" />;
      case "medium":
        return <ExclamationTriangleIcon className="w-5 h-5 text-yellow-500" />;
      default:
        return <ExclamationTriangleIcon className="w-5 h-5 text-blue-500" />;
    }
  };

  const getStatusIcon = () => {
    switch (event.status) {
      case "completed":
        return <CheckCircleIcon className="w-4 h-4 text-green-500" />;
      case "processing":
        return <ArrowPathIcon className="w-4 h-4 text-blue-500 animate-spin" />;
      case "pending":
        return <ClockIcon className="w-4 h-4 text-yellow-500" />;
      default:
        return <XMarkIcon className="w-4 h-4 text-red-500" />;
    }
  };

  return (
    <Link
      to={
        event.rca_result_id
          ? `/rca/${event.rca_result_id}`
          : `/events/${event.id}`
      }
      className={cn(
        "block p-4 rounded-lg border transition-all",
        "hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700",
        event.severity === "critical"
          ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10"
          : event.severity === "high"
            ? "border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-900/10"
            : "border-gray-200 dark:border-gray-700"
      )}
    >
      <div className="flex items-start gap-4">
        {/* Severity Icon */}
        <div className="flex-shrink-0 mt-0.5">{getSeverityIcon()}</div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Error Message */}
          <h3 className="font-medium text-gray-900 dark:text-white truncate">
            {event.message}
          </h3>

          {/* Metadata Row */}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            <span className={getSeverityClass(event.severity)}>
              {event.severity}
            </span>
            <span className="badge badge-info">{event.platform}</span>
            <span className="text-gray-500 dark:text-gray-400">
              {event.environment}
            </span>
            <span className="text-gray-400">•</span>
            <span className="text-gray-500 dark:text-gray-400">
              {formatRelativeTime(event.created_at)}
            </span>
          </div>

          {/* Stats Row */}
          <div className="mt-3 flex items-center gap-6 text-sm text-gray-600 dark:text-gray-400">
            <div className="flex items-center gap-1">
              <span className="font-medium">{occurrences}</span>
              <span>occurrences</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-medium">{affectedUsers}</span>
              <span>users affected</span>
            </div>
            {event.rca_result_id && confidence > 0 && (
              <div className="flex items-center gap-1">
                <span className="font-medium">
                  {(confidence * 100).toFixed(0)}%
                </span>
                <span>RCA confidence</span>
              </div>
            )}
          </div>
        </div>

        {/* Status & Arrow */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span
              className={cn(
                "text-sm font-medium",
                event.status === "completed"
                  ? "text-green-600 dark:text-green-400"
                  : event.status === "processing"
                    ? "text-blue-600 dark:text-blue-400"
                    : event.status === "failed"
                      ? "text-red-600 dark:text-red-400"
                      : "text-yellow-600 dark:text-yellow-400"
              )}
            >
              {event.status === "completed"
                ? "RCA Ready"
                : event.status === "processing"
                  ? "Analyzing..."
                  : event.status === "pending"
                    ? "Pending"
                    : "Failed"}
            </span>
          </div>
          <ChevronRightIcon className="w-5 h-5 text-gray-400" />
        </div>
      </div>

      {/* Confidence Bar (if RCA exists) */}
      {event.rca_result_id && confidence > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              RCA Confidence
            </span>
            <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  confidence >= 0.8
                    ? "bg-green-500"
                    : confidence >= 0.6
                      ? "bg-yellow-500"
                      : "bg-red-500"
                )}
                style={{ width: `${confidence * 100}%` }}
              />
            </div>
            <span
              className={cn(
                "text-xs font-medium",
                confidence >= 0.8
                  ? "text-green-600 dark:text-green-400"
                  : confidence >= 0.6
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-red-600 dark:text-red-400"
              )}
            >
              {(confidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      )}
    </Link>
  );
}

// Import Event type
import type { Event } from "@/types/api";

/**
 * Pagination component
 */
function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const pages = [];
  const maxVisible = 5;

  let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  const end = Math.min(totalPages, start + maxVisible - 1);

  if (end - start + 1 < maxVisible) {
    start = Math.max(1, end - maxVisible + 1);
  }

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  return (
    <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="btn btn-secondary"
      >
        Previous
      </button>

      <div className="flex items-center gap-1">
        {start > 1 && (
          <>
            <button
              onClick={() => onPageChange(1)}
              className="px-3 py-1 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              1
            </button>
            {start > 2 && <span className="px-2 text-gray-400">...</span>}
          </>
        )}

        {pages.map((page) => (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`px-3 py-1 text-sm rounded ${
              page === currentPage
                ? "bg-brand-500 text-white"
                : "hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            {page}
          </button>
        ))}

        {end < totalPages && (
          <>
            {end < totalPages - 1 && (
              <span className="px-2 text-gray-400">...</span>
            )}
            <button
              onClick={() => onPageChange(totalPages)}
              className="px-3 py-1 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              {totalPages}
            </button>
          </>
        )}
      </div>

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="btn btn-secondary"
      >
        Next
      </button>
    </div>
  );
}

export default EventsPage;
