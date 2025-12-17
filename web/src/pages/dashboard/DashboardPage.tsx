import { useDashboardStats, useRecentEvents } from "@/lib/hooks";
import {
  formatNumber,
  formatRelativeTime,
  getSeverityClass,
  getStatusClass,
} from "@/lib/utils";
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  BoltIcon,
} from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";

/**
 * Dashboard page with stats overview and recent events
 */
function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Dashboard
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Overview of your production incidents and RCA insights
        </p>
      </div>

      {/* Stats cards */}
      <StatsSection />

      {/* Recent events and quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RecentEventsSection />
        </div>
        <div>
          <QuickActionsSection />
        </div>
      </div>
    </div>
  );
}

/**
 * Stats cards section
 */
function StatsSection() {
  const { data: stats, isLoading } = useDashboardStats();

  const statCards = [
    {
      title: "Total Events",
      value: stats?.totalEvents ?? 0,
      change: stats?.eventsChange ?? 0,
      icon: ExclamationCircleIcon,
      iconColor: "text-red-500",
    },
    {
      title: "Resolved RCAs",
      value: stats?.resolvedRCAs ?? 0,
      change: stats?.resolvedChange ?? 0,
      icon: CheckCircleIcon,
      iconColor: "text-green-500",
    },
    {
      title: "Avg Resolution Time",
      value: `${stats?.avgResolutionTime ?? 0}m`,
      change: stats?.resolutionTimeChange ?? 0,
      icon: ClockIcon,
      iconColor: "text-blue-500",
      invertChange: true, // Lower is better
    },
    {
      title: "Pending Analysis",
      value: stats?.pendingAnalysis ?? 0,
      icon: BoltIcon,
      iconColor: "text-yellow-500",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {statCards.map((stat) => (
        <div key={stat.title} className="card">
          <div className="card-body">
            {isLoading ? (
              <div className="space-y-2">
                <div className="skeleton h-4 w-24" />
                <div className="skeleton h-8 w-16" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    {stat.title}
                  </span>
                  <stat.icon className={`w-5 h-5 ${stat.iconColor}`} />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-gray-900 dark:text-white">
                    {typeof stat.value === "number"
                      ? formatNumber(stat.value)
                      : stat.value}
                  </span>
                  {stat.change !== undefined && (
                    <ChangeIndicator
                      change={stat.change}
                      inverted={stat.invertChange}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Change indicator component showing positive/negative trends
 */
function ChangeIndicator({
  change,
  inverted,
}: {
  change: number;
  inverted?: boolean;
}) {
  const isPositive = inverted ? change < 0 : change > 0;
  const Icon = change > 0 ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;

  return (
    <span
      className={`flex items-center text-sm ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
    >
      <Icon className="w-4 h-4 mr-0.5" />
      {Math.abs(change)}%
    </span>
  );
}

/**
 * Recent events section
 */
function RecentEventsSection() {
  const { data: events, isLoading } = useRecentEvents(5);

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Recent Events
        </h2>
        <Link
          to="/events"
          className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="skeleton h-10 w-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-3/4" />
                  <div className="skeleton h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : events?.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            <ExclamationCircleIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No events yet</p>
            <p className="text-sm mt-1">
              Connect Sentry to start receiving events
            </p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {events?.map((event) => (
                <tr key={event.id}>
                  <td>
                    <Link
                      to={
                        event.rcaId
                          ? `/rca/${event.rcaId}`
                          : `/events/${event.id}`
                      }
                      className="font-medium text-gray-900 dark:text-white hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      {event.message.length > 60
                        ? `${event.message.slice(0, 60)}...`
                        : event.message}
                    </Link>
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
                    {formatRelativeTime(event.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * Quick actions section
 */
function QuickActionsSection() {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Quick Actions
        </h2>
      </div>
      <div className="card-body space-y-3">
        <Link
          to="/integrations"
          className="block p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
              <SentryIcon className="w-6 h-6" />
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                Connect Sentry
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Start receiving error events
              </p>
            </div>
          </div>
        </Link>

        <Link
          to="/integrations"
          className="block p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
              <SlackIcon className="w-6 h-6" />
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                Connect Slack
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Get RCA notifications
              </p>
            </div>
          </div>
        </Link>

        <Link
          to="/settings"
          className="block p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
              <span className="text-2xl">⚙️</span>
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                Configure Settings
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Set up notifications & preferences
              </p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}

/**
 * Sentry icon
 */
function SentryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 72 66" fill="currentColor">
      <path d="M29,2.26a4.67,4.67,0,0,0-8,0L14.42,13.53A32.21,32.21,0,0,1,32.17,40.19H27.55A27.68,27.68,0,0,0,12.09,17.47L6,28a15.92,15.92,0,0,1,9.23,12.17H4.62A.76.76,0,0,1,4,39.06l2.94-5a10.74,10.74,0,0,0-3.36-1.9l-2.91,5a4.54,4.54,0,0,0,1.69,6.24A4.66,4.66,0,0,0,4.62,44H19.15a19.4,19.4,0,0,0-8-17.31l2.31-4A23.87,23.87,0,0,1,23.76,44H36.07a35.88,35.88,0,0,0-16.41-31.8l4.67-8a.77.77,0,0,1,1.05-.27c.53.29,20.29,34.77,20.66,35.17a.76.76,0,0,1-.68,1.13H40.6q.09,1.91,0,3.81h4.78A4.59,4.59,0,0,0,50,39.43a4.49,4.49,0,0,0-.62-2.28Z" />
    </svg>
  );
}

/**
 * Slack icon
 */
function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

export default DashboardPage;
