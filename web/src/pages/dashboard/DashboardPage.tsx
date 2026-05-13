import {
  useDashboardStats,
  useRecentEvents,
  useRCAQuality,
  useIntegrations,
  useOnboardingStatus,
} from "@/lib/hooks";
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
  ChevronRightIcon,
  ShieldExclamationIcon,
  ArrowRightIcon,
  BoltIcon,
} from "@heroicons/react/24/outline";
import { Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";

function DashboardPage() {
  const navigate = useNavigate();
  const { data: onboarding, isLoading: onboardingLoading } = useOnboardingStatus();
  const {
    data: integrations,
    isLoading: integrationsLoading,
    error: integrationsError,
  } = useIntegrations();
  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useDashboardStats();

  // Redirect to onboarding when neither GitHub nor Sentry is connected
  useEffect(() => {
    if (!onboardingLoading && onboarding) {
      const { github, sentry } = onboarding.steps;
      if (!github.complete && !sentry.complete) {
        navigate("/onboarding", { replace: true });
      }
    }
  }, [onboarding, onboardingLoading, navigate]);

  const hasConnectedIntegration = (integrations ?? []).some(
    (i) => i.status === "connected"
  );
  const hasEvents = (stats?.totalEvents ?? 0) > 0;
  const isFirstRun =
    !integrationsLoading &&
    !statsLoading &&
    !integrationsError &&
    !statsError &&
    !hasConnectedIntegration &&
    !hasEvents;

  if (isFirstRun) {
    return <GettingStartedPanel />;
  }

  return (
    <div className="space-y-6">
      <SystemHealthBanner />

      <CoreMetricsSection />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <ActionableRCAsSection />
        </div>
        <div>
          <RCAQualityPulse />
        </div>
      </div>
    </div>
  );
}

function GettingStartedPanel() {
  const steps = [
    {
      title: "Connect Sentry",
      description:
        "Point your Sentry project's webhook at Buglens so new errors flow into the analysis pipeline.",
      href: "/settings/integrations",
      cta: "Connect Sentry",
      primary: true,
    },
    {
      title: "Connect GitHub",
      description:
        "Install the GitHub App so Buglens can read your source code and resolve stack frames to real lines.",
      href: "/settings/integrations",
      cta: "Connect GitHub",
      primary: false,
    },
    {
      title: "Connect Slack (optional)",
      description:
        "Get RCA results pushed to your on-call channel as soon as they're ready.",
      href: "/settings/integrations",
      cta: "Connect Slack",
      primary: false,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-amber-50 to-white dark:from-amber-900/20 dark:to-zinc-900 border border-amber-200 dark:border-amber-800 rounded-lg p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-amber-100 dark:bg-amber-900/40 p-3">
            <BoltIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Welcome to Buglens
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-300 max-w-2xl">
              Buglens turns Sentry errors into root-cause analyses with real
              code context. Connect Sentry to start receiving events — your
              first RCA usually lands within a minute of the next error.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {steps.map((step, index) => (
          <div
            key={step.title}
            className="flex items-center justify-between gap-4 p-5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg"
          >
            <div className="flex items-start gap-4 min-w-0">
              <div
                className={cn(
                  "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold",
                  step.primary
                    ? "bg-amber-500 text-zinc-900"
                    : "bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400"
                )}
              >
                {index + 1}
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  {step.title}
                </h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {step.description}
                </p>
              </div>
            </div>
            <Link
              to={step.href}
              className={cn(
                "btn flex-shrink-0 flex items-center gap-2",
                step.primary ? "btn-primary" : "btn-secondary"
              )}
            >
              {step.cta}
              <ArrowRightIcon className="w-4 h-4" />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

function SystemHealthBanner() {
  const { data: stats } = useDashboardStats();

  const criticalCount = stats?.criticalUnresolved ?? 0;
  const highCount = stats?.highUnresolved ?? 0;
  const hasSpike = (stats?.eventsChange ?? 0) > 50;

  if (criticalCount === 0 && highCount === 0 && !hasSpike) {
    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
          <div>
            <p className="font-medium text-green-800 dark:text-green-200">
              No critical issues
            </p>
            {(stats?.pendingAnalysis ?? 0) > 0 && (
              <p className="text-sm text-green-600 dark:text-green-400">
                {stats?.pendingAnalysis} events pending analysis
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (criticalCount > 0) {
    return (
      <div className="bg-red-50 dark:bg-red-900/30 border-2 border-red-500 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FireIcon className="w-7 h-7 text-red-600 dark:text-red-400" />
            <div>
              <p className="text-base font-bold text-red-800 dark:text-red-200">
                {criticalCount} critical issue
                {criticalCount > 1 ? "s" : ""} need attention
              </p>
              {hasSpike && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  Error rate up {stats?.eventsChange}% in the last hour
                </p>
              )}
            </div>
          </div>
          <Link
            to="/events?severity=critical&status=pending,processing"
            className="btn-primary bg-red-600 hover:bg-red-700 flex items-center gap-2 flex-shrink-0"
          >
            Investigate
            <ArrowRightIcon className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-400 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-200">
              {highCount > 0 &&
                `${highCount} high-severity issue${highCount > 1 ? "s" : ""} pending`}
              {hasSpike && highCount > 0 && " · "}
              {hasSpike && `Error spike detected (+${stats?.eventsChange}%)`}
            </p>
          </div>
        </div>
        <Link
          to="/events?severity=high,critical"
          className="text-amber-700 dark:text-amber-300 hover:underline font-medium flex items-center gap-1 text-sm flex-shrink-0"
        >
          Review
          <ChevronRightIcon className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

function CoreMetricsSection() {
  const { data: stats, isLoading } = useDashboardStats();

  const metrics = [
    {
      id: "unresolved-critical",
      title: "Critical & High Issues",
      value: (stats?.criticalUnresolved ?? 0) + (stats?.highUnresolved ?? 0),
      subtitle: "Unresolved, needs triage",
      ranges: { good: 0, warning: 3, panic: 6 },
      link: "/events?severity=critical,high&status=pending,processing",
      icon: ShieldExclamationIcon,
      trend: stats?.unresolvedTrend,
    },
    {
      id: "pending-analysis",
      title: "Pending Analysis",
      value: stats?.pendingAnalysis ?? 0,
      subtitle: "Events in the pipeline",
      ranges: { good: 0, warning: 10, panic: 25 },
      link: "/events?status=pending,processing",
      icon: ClockIcon,
    },
    {
      id: "total-events",
      title: "Total Events",
      value: stats?.totalEvents ?? 0,
      subtitle: "All time",
      ranges: { good: Infinity, warning: Infinity, panic: Infinity },
      link: "/events",
      icon: FireIcon,
      neutral: true,
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
    ranges: { good: number; warning: number; panic: number };
    link: string;
    icon: React.ComponentType<{ className?: string }>;
    trend?: number;
    neutral?: boolean;
  };
  isLoading: boolean;
}

function MetricCard({ metric, isLoading }: MetricCardProps) {
  const { value, ranges, neutral } = metric;

  let status: "good" | "warning" | "panic" = "good";
  if (!neutral) {
    if (value >= ranges.panic) status = "panic";
    else if (value >= ranges.warning) status = "warning";
  }

  const cardColors = {
    good: "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20",
    warning: "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20",
    panic: "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20",
    neutral: "border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900",
  };

  const valueColors = {
    good: "text-green-700 dark:text-green-400",
    warning: "text-amber-700 dark:text-amber-400",
    panic: "text-red-700 dark:text-red-400",
    neutral: "text-gray-900 dark:text-white",
  };

  const colorKey = neutral ? "neutral" : status;

  return (
    <Link
      to={metric.link}
      className={cn(
        "card border-2 hover:shadow-md transition-shadow cursor-pointer",
        cardColors[colorKey]
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
              <metric.icon
                className={cn("w-5 h-5", valueColors[colorKey])}
              />
            </div>

            <div className="flex items-baseline gap-2">
              <span
                className={cn("text-3xl font-bold", valueColors[colorKey])}
              >
                {formatNumber(value)}
                {metric.suffix}
              </span>
              {metric.trend !== undefined && (
                <TrendIndicator value={metric.trend} />
              )}
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {metric.subtitle}
            </p>
          </>
        )}
      </div>
    </Link>
  );
}

function TrendIndicator({ value }: { value: number }) {
  if (value === 0) return null;
  const Icon = value > 0 ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;
  const color = value > 0 ? "text-red-500" : "text-green-500";
  return (
    <span className={cn("flex items-center text-sm", color)}>
      <Icon className="w-4 h-4" />
      {Math.abs(value)}%
    </span>
  );
}

interface ExtendedRecentEvent {
  id: string;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  rcaId?: string;
  confidence?: number;
}

function ActionableRCAsSection() {
  const { data: events, isLoading } = useRecentEvents(10);

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
            Recent RCAs
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Sorted by severity · confidence
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
            <div key={i} className="skeleton h-16" />
          ))}
        </div>
      ) : !actionableRCAs?.length ? (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          <CheckCircleIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No completed RCAs yet</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {actionableRCAs.map((event) => (
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
    medium: "text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30",
    low: "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30",
  };

  return (
    <Link
      to={`/rca/${event.rcaId}`}
      className="block p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
    >
      <div className="flex items-start gap-3">
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
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {formatRelativeTime(event.createdAt)}
          </p>
        </div>
        <ChevronRightIcon className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
      </div>
    </Link>
  );
}

function RCAQualityPulse() {
  const { data: qualityData, isLoading, error } = useRCAQuality();

  if (isLoading) {
    return (
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            RCA Quality
          </h2>
        </div>
        <div className="card-body">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !qualityData) {
    return (
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            RCA Quality
          </h2>
        </div>
        <div className="card-body">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No quality data yet
          </p>
        </div>
      </div>
    );
  }

  const { percentages, totalRCAs } = qualityData;

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          RCA Quality
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {totalRCAs} RCAs · last 7 days
        </p>
      </div>
      <div className="card-body space-y-4">
        <div className="h-3 flex rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800">
          <div
            className="bg-green-500 transition-all"
            style={{ width: `${percentages.highConfidence}%` }}
          />
          <div
            className="bg-amber-500 transition-all"
            style={{ width: `${percentages.mediumConfidence}%` }}
          />
          <div
            className="bg-red-500 transition-all"
            style={{ width: `${percentages.lowConfidence}%` }}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
              <span className="w-2.5 h-2.5 bg-green-500 rounded-sm" />
              High confidence
            </span>
            <span className="font-medium text-gray-900 dark:text-white">
              {percentages.highConfidence.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
              <span className="w-2.5 h-2.5 bg-amber-500 rounded-sm" />
              Medium confidence
            </span>
            <span className="font-medium text-gray-900 dark:text-white">
              {percentages.mediumConfidence.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-sm" />
              Low confidence
            </span>
            <span className="font-medium text-gray-900 dark:text-white">
              {percentages.lowConfidence.toFixed(0)}%
            </span>
          </div>
        </div>

        {percentages.lowConfidence > 10 && (
          <Link
            to="/events?confidence=low"
            className="block p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-600 dark:text-red-400 hover:underline"
          >
            Review {percentages.lowConfidence.toFixed(0)}% low-confidence RCAs →
          </Link>
        )}
      </div>
    </div>
  );
}

export default DashboardPage;
