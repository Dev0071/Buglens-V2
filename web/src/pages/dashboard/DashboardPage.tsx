import { useDashboardStats, useRecentEvents } from "@/lib/hooks";
import {
  formatNumber,
  formatRelativeTime,
  getSeverityClass,
  cn,
} from "@/lib/utils";
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  FireIcon,
  XCircleIcon,
  ChevronRightIcon,
  ShieldExclamationIcon,
  CodeBracketIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";

/**
 * =============================================================================
 * BUGLENS DASHBOARD - DECISION-DRIVEN DESIGN
 * =============================================================================
 *
 * USER DEFINITION:
 * ----------------
 * Job Title: On-Call Engineer / Engineering Lead
 *
 * Primary Responsibility:
 * - Triaging production incidents and ensuring bugs get fixed quickly
 *
 * Recurring Decision (Daily):
 * - "Which bug do I investigate first?" and "Is this RCA trustworthy enough to act on?"
 *
 * When They Open Buglens:
 * - During on-call shift when Slack/PagerDuty alerts them
 * - Morning standup prep to see overnight incidents
 * - After deploy to verify no new regressions
 *
 * What They Worry About:
 * - Missing a critical bug that impacts users
 * - Wasting time on an incorrect RCA
 * - Not knowing if a recent deploy broke something
 *
 * CORE DECISION THIS DASHBOARD EXISTS FOR:
 * ----------------------------------------
 * "After viewing this dashboard, the engineer will:
 *  1. Know IMMEDIATELY if there's a fire that needs attention
 *  2. Trust which RCA to act on first (based on confidence + severity)
 *  3. Identify if a recent deploy caused new errors"
 *
 * BAD DECISION THIS PREVENTS:
 * ---------------------------
 * - Investigating low-priority bugs while critical ones go unnoticed
 * - Acting on a low-confidence RCA and wasting 2 hours debugging the wrong thing
 * - Deploying to production without checking for regression spikes
 *
 * =============================================================================
 */

function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Data freshness indicator - TRUST */}
      <DataFreshnessBar />

      {/* PRIORITY 1: Is there a fire right now? */}
      <SystemHealthBanner />

      {/* PRIORITY 2: What needs attention? (3 core metrics) */}
      <CoreMetricsSection />

      {/* PRIORITY 3: Actionable items - sorted by urgency */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <ActionableRCAsSection />
          <RecentDeployImpact />
        </div>
        <div className="space-y-6">
          <RCAQualityPulse />
          <QuickFilters />
        </div>
      </div>
    </div>
  );
}

/**
 * Data freshness indicator - builds trust
 */
function DataFreshnessBar() {
  const lastUpdated = new Date();

  return (
    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          Live data
        </span>
        <span>
          Last updated: {formatRelativeTime(lastUpdated.toISOString())}
        </span>
      </div>
      <span className="text-gray-400 dark:text-gray-500">
        Source: Sentry webhooks • Deterministic analysis
      </span>
    </div>
  );
}

/**
 * System Health Banner - answers "Is there a fire?"
 * Shows only when there's something urgent
 */
function SystemHealthBanner() {
  const { data: stats } = useDashboardStats();

  // Calculate from stats - in real impl these come from backend
  const criticalCount = stats?.criticalUnresolved ?? 0;
  const highCount = stats?.highUnresolved ?? 0;
  const hasSpike = (stats?.eventsChange ?? 0) > 50;

  // No banner if everything is calm
  if (criticalCount === 0 && highCount === 0 && !hasSpike) {
    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <CheckCircleIcon className="w-6 h-6 text-green-600 dark:text-green-400" />
          <div>
            <p className="font-medium text-green-800 dark:text-green-200">
              System healthy — no critical issues
            </p>
            <p className="text-sm text-green-600 dark:text-green-400">
              {stats?.pendingAnalysis ?? 0} events pending analysis
            </p>
          </div>
        </div>
      </div>
    );
  }

  // FIRE: Critical issues need attention
  if (criticalCount > 0) {
    return (
      <div className="bg-red-50 dark:bg-red-900/30 border-2 border-red-500 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FireIcon className="w-8 h-8 text-red-600 dark:text-red-400" />
            <div>
              <p className="text-lg font-bold text-red-800 dark:text-red-200">
                {criticalCount} critical issue
                {criticalCount > 1 ? "s" : ""} requires immediate attention
              </p>
              <p className="text-sm text-red-600 dark:text-red-400">
                {hasSpike &&
                  `Error rate up ${stats?.eventsChange}% in last hour • `}
                Click to investigate
              </p>
            </div>
          </div>
          <Link
            to="/events?severity=critical&status=pending,processing"
            className="btn-primary bg-red-600 hover:bg-red-700 flex items-center gap-2"
          >
            Investigate Now
            <ArrowRightIcon className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  // WARNING: High severity or spike
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-500 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ExclamationTriangleIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-200">
              {highCount > 0 &&
                `${highCount} high-severity issue${highCount > 1 ? "s" : ""} pending`}
              {hasSpike && highCount > 0 && " • "}
              {hasSpike && `Error spike detected (+${stats?.eventsChange}%)`}
            </p>
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Review recommended before deploying
            </p>
          </div>
        </div>
        <Link
          to="/events?severity=high,critical"
          className="text-amber-700 dark:text-amber-300 hover:underline font-medium flex items-center gap-1"
        >
          Review
          <ChevronRightIcon className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

/**
 * Core Metrics - 3 metrics that drive decisions
 * Each has: owner, good/bad/panic range, clear action
 */
function CoreMetricsSection() {
  const { data: stats, isLoading } = useDashboardStats();

  const metrics = [
    {
      id: "unresolved-critical",
      title: "Unresolved Critical/High",
      value: (stats?.criticalUnresolved ?? 0) + (stats?.highUnresolved ?? 0),
      subtitle: "Needs triage",
      owner: "On-call engineer",
      ranges: { good: 0, warning: 3, panic: 5 },
      action: "Triage and assign",
      link: "/events?severity=critical,high&status=pending,processing",
      icon: ShieldExclamationIcon,
      trend: stats?.unresolvedTrend,
    },
    {
      id: "rca-accuracy",
      title: "RCA Accuracy (7d)",
      value: stats?.rcaAccuracy ?? 84,
      suffix: "%",
      subtitle: "Based on feedback",
      owner: "Platform team",
      ranges: { good: 80, warning: 70, panic: 60 },
      action: "Review low-confidence RCAs",
      link: "/events?feedback=wrong",
      icon: CheckCircleIcon,
      invertRanges: true,
    },
    {
      id: "avg-resolution",
      title: "Avg Time to RCA",
      value: stats?.avgResolutionTime ?? 23,
      suffix: "s",
      subtitle: "From error to root cause",
      owner: "Platform team",
      ranges: { good: 30, warning: 45, panic: 60 },
      action: "Check queue backlog",
      link: "/events?status=processing",
      icon: ClockIcon,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {metrics.map((metric) => (
        <MetricCard key={metric.id} metric={metric} isLoading={isLoading} />
      ))}
    </div>
  );
}

interface MetricCardProps {
  metric: {
    id: string;
    title: string;
    value: number;
    suffix?: string;
    subtitle: string;
    owner: string;
    ranges: { good: number; warning: number; panic: number };
    action: string;
    link: string;
    icon: React.ComponentType<{ className?: string }>;
    trend?: number;
    invertRanges?: boolean;
  };
  isLoading: boolean;
}

function MetricCard({ metric, isLoading }: MetricCardProps) {
  const { value, ranges, invertRanges } = metric;

  // Determine status based on ranges
  let status: "good" | "warning" | "panic" = "good";
  if (invertRanges) {
    if (value < ranges.panic) status = "panic";
    else if (value < ranges.warning) status = "warning";
  } else {
    if (value >= ranges.panic) status = "panic";
    else if (value >= ranges.warning) status = "warning";
  }

  const statusColors = {
    good: "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
    warning:
      "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
    panic: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
  };

  const valueColors = {
    good: "text-green-700 dark:text-green-400",
    warning: "text-amber-700 dark:text-amber-400",
    panic: "text-red-700 dark:text-red-400",
  };

  return (
    <Link
      to={metric.link}
      className={cn(
        "card border-2 hover:shadow-md transition-shadow cursor-pointer",
        statusColors[status]
      )}
    >
      <div className="card-body">
        {isLoading ? (
          <div className="space-y-2">
            <div className="skeleton h-4 w-32" />
            <div className="skeleton h-10 w-20" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {metric.title}
              </span>
              <metric.icon className={cn("w-5 h-5", valueColors[status])} />
            </div>

            <div className="flex items-baseline gap-2">
              <span className={cn("text-3xl font-bold", valueColors[status])}>
                {formatNumber(value)}
                {metric.suffix}
              </span>
              {metric.trend !== undefined && (
                <TrendIndicator
                  value={metric.trend}
                  inverted={metric.id === "avg-resolution"}
                />
              )}
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {metric.subtitle}
            </p>

            {status !== "good" && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Action: {metric.action}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Link>
  );
}

function TrendIndicator({
  value,
  inverted,
}: {
  value: number;
  inverted?: boolean;
}) {
  const Icon = value > 0 ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;

  const color = inverted
    ? value < 0
      ? "text-green-500"
      : "text-red-500"
    : value > 0
      ? "text-red-500"
      : "text-green-500";

  if (value === 0) return null;

  return (
    <span className={cn("flex items-center text-sm", color)}>
      <Icon className="w-4 h-4" />
      {Math.abs(value)}%
    </span>
  );
}

// Extended type for events with confidence
interface ExtendedRecentEvent {
  id: string;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  rcaId?: string;
  confidence?: number;
}

/**
 * Actionable RCAs - sorted by urgency (severity × confidence)
 * Only shows RCAs that are ready to act on
 */
function ActionableRCAsSection() {
  const { data: events, isLoading } = useRecentEvents(10);

  // Filter to only completed RCAs and sort by urgency
  const actionableRCAs = (events as ExtendedRecentEvent[] | undefined)
    ?.filter((e) => e.status === "completed" && e.rcaId)
    ?.sort((a, b) => {
      const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
      const aWeight = severityWeight[a.severity] * (a.confidence ?? 0.85);
      const bWeight = severityWeight[b.severity] * (b.confidence ?? 0.85);
      return bWeight - aWeight;
    })
    ?.slice(0, 5);

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Ready to Fix
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            RCAs sorted by severity × confidence
          </p>
        </div>
        <Link
          to="/events?status=completed"
          className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
        >
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-20" />
          ))}
        </div>
      ) : actionableRCAs?.length === 0 ? (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          <CheckCircleIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No RCAs pending action</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {actionableRCAs?.map((event) => (
            <ActionableRCAItem key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionableRCAItem({ event }: { event: ExtendedRecentEvent }) {
  const confidence = event.confidence ?? 0.85;
  const confidencePercent = Math.round(confidence * 100);

  const confidenceStatus =
    confidence >= 0.8 ? "high" : confidence >= 0.6 ? "medium" : "low";
  const confidenceColors = {
    high: "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30",
    medium:
      "text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30",
    low: "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30",
  };

  return (
    <Link
      to={`/rca/${event.rcaId}`}
      className="block p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "w-2 h-2 mt-2 rounded-full flex-shrink-0",
            event.severity === "critical" && "bg-red-500",
            event.severity === "high" && "bg-orange-500",
            event.severity === "medium" && "bg-yellow-500",
            event.severity === "low" && "bg-gray-400"
          )}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={getSeverityClass(event.severity)}>
              {event.severity}
            </span>
            <span
              className={cn(
                "px-2 py-0.5 text-xs font-medium rounded",
                confidenceColors[confidenceStatus]
              )}
            >
              {confidencePercent}% confidence
            </span>
          </div>

          <p className="font-medium text-gray-900 dark:text-white truncate">
            {event.message}
          </p>

          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {formatRelativeTime(event.createdAt)}
          </p>
        </div>

        <ChevronRightIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
      </div>
    </Link>
  );
}

/**
 * Recent Deploy Impact - answers "Did my deploy break something?"
 */
function RecentDeployImpact() {
  // Mock data - in real impl, correlate with GitHub deploy events
  const recentDeploy = {
    sha: "abc123f",
    message: "feat: add user profile caching",
    author: "dev@team.com",
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    errorsAfter: 3,
    errorsBefore: 1,
    status: "warning" as const,
  };

  const statusConfig = {
    ok: {
      bg: "bg-green-50 dark:bg-green-900/20",
      border: "border-green-200 dark:border-green-800",
      icon: CheckCircleIcon,
      iconColor: "text-green-600 dark:text-green-400",
      label: "No issues detected",
    },
    warning: {
      bg: "bg-amber-50 dark:bg-amber-900/20",
      border: "border-amber-200 dark:border-amber-800",
      icon: ExclamationTriangleIcon,
      iconColor: "text-amber-600 dark:text-amber-400",
      label: "Possible regression",
    },
    problem: {
      bg: "bg-red-50 dark:bg-red-900/20",
      border: "border-red-200 dark:border-red-800",
      icon: XCircleIcon,
      iconColor: "text-red-600 dark:text-red-400",
      label: "Regression detected",
    },
  };

  const config = statusConfig[recentDeploy.status];

  return (
    <div className={cn("card border", config.border, config.bg)}>
      <div className="card-header">
        <div className="flex items-center gap-2">
          <CodeBracketIcon className="w-5 h-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Last Deploy Impact
          </h2>
        </div>
      </div>
      <div className="card-body">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <config.icon className={cn("w-5 h-5", config.iconColor)} />
              <span className={cn("font-medium", config.iconColor)}>
                {config.label}
              </span>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400">
              <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
                {recentDeploy.sha}
              </code>{" "}
              {recentDeploy.message}
            </p>

            <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
              {formatRelativeTime(recentDeploy.timestamp)} by{" "}
              {recentDeploy.author}
            </p>
          </div>

          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {recentDeploy.errorsAfter}
            </div>
            <div className="text-xs text-gray-500">
              errors since deploy
              {recentDeploy.errorsAfter > recentDeploy.errorsBefore && (
                <span className="text-red-500 ml-1">
                  (+{recentDeploy.errorsAfter - recentDeploy.errorsBefore})
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * RCA Quality Pulse - builds confidence in the system
 */
function RCAQualityPulse() {
  const qualityData = {
    accurate: 82,
    partial: 12,
    wrong: 6,
    totalFeedback: 47,
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          RCA Quality (7 days)
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Based on {qualityData.totalFeedback} user reviews
        </p>
      </div>
      <div className="card-body space-y-4">
        {/* Quality bar */}
        <div className="h-4 flex rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800">
          <div
            className="bg-green-500 transition-all"
            style={{ width: `${qualityData.accurate}%` }}
            title={`Accurate: ${qualityData.accurate}%`}
          />
          <div
            className="bg-amber-500 transition-all"
            style={{ width: `${qualityData.partial}%` }}
            title={`Partial: ${qualityData.partial}%`}
          />
          <div
            className="bg-red-500 transition-all"
            style={{ width: `${qualityData.wrong}%` }}
            title={`Wrong: ${qualityData.wrong}%`}
          />
        </div>

        {/* Legend */}
        <div className="flex justify-between text-xs">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-green-500 rounded" />
            Accurate {qualityData.accurate}%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-amber-500 rounded" />
            Partial {qualityData.partial}%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-red-500 rounded" />
            Wrong {qualityData.wrong}%
          </span>
        </div>

        {/* Action if quality is low */}
        {qualityData.wrong > 10 && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm">
            <p className="font-medium text-red-700 dark:text-red-300">
              High wrong rate detected
            </p>
            <Link
              to="/events?feedback=wrong"
              className="text-red-600 dark:text-red-400 hover:underline"
            >
              Review incorrect RCAs →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Quick Filters - drill-down shortcuts
 */
function QuickFilters() {
  const filters = [
    {
      label: "Critical unresolved",
      count: 2,
      link: "/events?severity=critical&status=pending,processing",
      color: "text-red-600 bg-red-50 dark:bg-red-900/20",
    },
    {
      label: "Low confidence RCAs",
      count: 5,
      link: "/events?confidence=low",
      color: "text-amber-600 bg-amber-50 dark:bg-amber-900/20",
    },
    {
      label: "Processing > 60s",
      count: 1,
      link: "/events?status=processing&slow=true",
      color: "text-blue-600 bg-blue-50 dark:bg-blue-900/20",
    },
    {
      label: "Needs feedback",
      count: 12,
      link: "/events?feedback=none",
      color: "text-gray-600 bg-gray-50 dark:bg-gray-800",
    },
  ];

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Quick Filters
        </h2>
      </div>
      <div className="card-body space-y-2">
        {filters.map((filter) => (
          <Link
            key={filter.label}
            to={filter.link}
            className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          >
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {filter.label}
            </span>
            <span
              className={cn(
                "px-2 py-1 text-xs font-bold rounded-full",
                filter.color
              )}
            >
              {filter.count}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default DashboardPage;
