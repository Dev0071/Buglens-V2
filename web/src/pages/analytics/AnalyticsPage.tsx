/**
 * Analytics Page - Cost & ROI Dashboard
 *
 * Decision-driven design answering: "Is Buglens worth the money?"
 *
 * Core question for this page:
 * - Engineering Manager: "What's our ROI?"
 * - Finance: "What are we spending?"
 * - DevOps: "Are costs trending up?"
 */

import { useState } from "react";
import { useAnalyticsSummary, useDailyAnalytics } from "@/lib/hooks";
import {
  formatNumber,
  formatCurrency,
  formatPercentage,
  cn,
} from "@/lib/utils";
import {
  CurrencyDollarIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ClockIcon,
  BoltIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

// Time period options
type TimePeriod = "7d" | "30d" | "90d";

/**
 * TL;DR Summary Banner - Top-line decision support
 */
function TLDRBanner({
  roi,
  costTrend,
  budgetStatus,
}: {
  roi: number;
  costTrend: number;
  budgetStatus: "healthy" | "warning" | "critical";
}) {
  const getBannerStyle = () => {
    if (budgetStatus === "critical") {
      return "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800";
    }
    if (budgetStatus === "warning") {
      return "bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800";
    }
    return "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800";
  };

  const getStatusIcon = () => {
    if (budgetStatus === "critical") {
      return (
        <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400" />
      );
    }
    if (budgetStatus === "warning") {
      return (
        <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
      );
    }
    return (
      <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
    );
  };

  const getMessage = () => {
    if (budgetStatus === "critical") {
      return `⚠️ Budget exceeded! Costs are ${Math.abs(costTrend)}% over limit. Review LLM usage immediately.`;
    }
    if (budgetStatus === "warning") {
      return `📊 Approaching budget limit. ${Math.abs(costTrend)}% increase this period. Consider optimizing high-volume errors.`;
    }
    if (roi > 100) {
      return `✅ Excellent ROI! Buglens saved ${formatPercentage(roi)} in engineering time. Costs stable.`;
    }
    return `✅ Costs within budget. ${roi > 0 ? `ROI: ${formatPercentage(roi)}` : "Building ROI data..."}`;
  };

  return (
    <div className={cn("card border-l-4", getBannerStyle())}>
      <div className="card-body py-4">
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <p className="font-medium text-gray-900 dark:text-white">
            {getMessage()}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Core Metric Card with trend indicator
 */
function MetricCard({
  title,
  value,
  subtitle,
  trend,
  icon: Icon,
  iconColor,
  helpText,
}: {
  title: string;
  value: string;
  subtitle?: string;
  trend?: { value: number; isPositive: boolean };
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  helpText?: string;
}) {
  return (
    <div className="card">
      <div className="card-body">
        <div className="flex items-start justify-between">
          <div
            className={cn(
              "p-2 rounded-lg",
              iconColor.includes("green")
                ? "bg-green-100 dark:bg-green-900/30"
                : iconColor.includes("blue")
                  ? "bg-blue-100 dark:bg-blue-900/30"
                  : iconColor.includes("purple")
                    ? "bg-purple-100 dark:bg-purple-900/30"
                    : "bg-gray-100 dark:bg-gray-800"
            )}
          >
            <Icon className={cn("w-5 h-5", iconColor)} />
          </div>
          {helpText && (
            <div className="group relative">
              <InformationCircleIcon className="w-4 h-4 text-gray-400 cursor-help" />
              <div className="absolute right-0 top-6 w-48 p-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-10">
                {helpText}
              </div>
            </div>
          )}
        </div>
        <div className="mt-3">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {title}
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {value}
          </p>
          {(subtitle || trend) && (
            <div className="flex items-center gap-2 mt-1">
              {trend && (
                <span
                  className={cn(
                    "flex items-center text-sm",
                    trend.isPositive
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  )}
                >
                  {trend.isPositive ? (
                    <ArrowTrendingDownIcon className="w-4 h-4 mr-1" />
                  ) : (
                    <ArrowTrendingUpIcon className="w-4 h-4 mr-1" />
                  )}
                  {Math.abs(trend.value)}%
                </span>
              )}
              {subtitle && (
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {subtitle}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Cost Trend Chart
 */
function CostTrendChart({
  data,
  period,
}: {
  data: Array<{ date: string; cost: number; tokens: number }>;
  period: TimePeriod;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Cost Trend
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Daily LLM spending over{" "}
          {period === "7d"
            ? "7 days"
            : period === "30d"
              ? "30 days"
              : "90 days"}
        </p>
      </div>
      <div className="card-body">
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-gray-200 dark:stroke-gray-700"
              />
              <XAxis
                dataKey="date"
                tickFormatter={(value) =>
                  new Date(value).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                }
                className="text-xs"
              />
              <YAxis
                tickFormatter={(value) => `$${value}`}
                className="text-xs"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--tooltip-bg, #fff)",
                  border: "1px solid var(--tooltip-border, #e5e7eb)",
                  borderRadius: "8px",
                }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, "Cost"]}
                labelFormatter={(label) =>
                  new Date(label).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })
                }
              />
              <Area
                type="monotone"
                dataKey="cost"
                stroke="#3B82F6"
                strokeWidth={2}
                fill="url(#colorCost)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/**
 * ROI Calculator Widget
 */
function ROICalculator({
  rcasGenerated,
  avgTimePerRCA,
  engineerHourlyRate,
}: {
  rcasGenerated: number;
  avgTimePerRCA: number;
  engineerHourlyRate: number;
}) {
  // Calculate time saved (manual RCA takes ~30 min, Buglens takes avgTimePerRCA seconds)
  const manualTimeMinutes = 30; // Average time to manually investigate an error
  const buglensTimeMinutes = avgTimePerRCA / 60;
  const timeSavedPerRCA = manualTimeMinutes - buglensTimeMinutes;
  const totalTimeSavedHours = (timeSavedPerRCA * rcasGenerated) / 60;
  const moneySaved = totalTimeSavedHours * engineerHourlyRate;

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          ROI Calculator
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Time and money saved this period
        </p>
      </div>
      <div className="card-body">
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <ClockIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-green-800 dark:text-green-300">
                Time Saved
              </span>
            </div>
            <p className="text-2xl font-bold text-green-900 dark:text-green-100">
              {totalTimeSavedHours.toFixed(1)}h
            </p>
            <p className="text-xs text-green-700 dark:text-green-400 mt-1">
              ~{timeSavedPerRCA.toFixed(0)} min per RCA × {rcasGenerated} RCAs
            </p>
          </div>

          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <CurrencyDollarIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                Value Generated
              </span>
            </div>
            <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
              {formatCurrency(moneySaved)}
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
              at ${engineerHourlyRate}/hr engineer rate
            </p>
          </div>
        </div>

        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            <strong>How we calculate:</strong> Each manual RCA investigation
            takes ~30 minutes. Buglens delivers results in{" "}
            {(avgTimePerRCA / 60).toFixed(1)} minutes on average, saving{" "}
            {timeSavedPerRCA.toFixed(0)} minutes per error.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Quality Breakdown Pie Chart
 */
function QualityBreakdown({
  data,
}: {
  data: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  };
}) {
  const chartData = [
    { name: "High (>80%)", value: data.highConfidence, color: "#22C55E" },
    { name: "Medium (60-80%)", value: data.mediumConfidence, color: "#F59E0B" },
    { name: "Low (<60%)", value: data.lowConfidence, color: "#EF4444" },
  ];

  const total =
    data.highConfidence + data.mediumConfidence + data.lowConfidence;

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          RCA Quality Distribution
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Confidence score breakdown
        </p>
      </div>
      <div className="card-body">
        <div className="flex items-center gap-6">
          <div className="h-[180px] w-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => [
                    `${value} (${((value / total) * 100).toFixed(1)}%)`,
                    "",
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-3">
            {chartData.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {item.name}
                  </span>
                </div>
                <span className="font-medium text-gray-900 dark:text-white">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Daily Breakdown Table
 */
function DailyBreakdownTable({
  data,
}: {
  data: Array<{
    date: string;
    events: number;
    rcas: number;
    tokens: number;
    cost: number;
    avgConfidence: number;
  }>;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Daily Breakdown
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="text-right">Events</th>
              <th className="text-right">RCAs</th>
              <th className="text-right">Tokens</th>
              <th className="text-right">Cost</th>
              <th className="text-right">Avg Confidence</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.date}>
                <td>
                  {new Date(row.date).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </td>
                <td className="text-right">{formatNumber(row.events)}</td>
                <td className="text-right">{formatNumber(row.rcas)}</td>
                <td className="text-right">{formatNumber(row.tokens)}</td>
                <td className="text-right">{formatCurrency(row.cost)}</td>
                <td className="text-right">
                  <span
                    className={cn(
                      "font-medium",
                      row.avgConfidence >= 0.8
                        ? "text-green-600 dark:text-green-400"
                        : row.avgConfidence >= 0.6
                          ? "text-yellow-600 dark:text-yellow-400"
                          : "text-red-600 dark:text-red-400"
                    )}
                  >
                    {formatPercentage(row.avgConfidence * 100)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Analytics Page Component
 */
function AnalyticsPage() {
  const [period, setPeriod] = useState<TimePeriod>("30d");

  const { data: summary, isLoading: summaryLoading } =
    useAnalyticsSummary(period);
  const { data: dailyData, isLoading: dailyLoading } =
    useDailyAnalytics(period);

  const isLoading = summaryLoading || dailyLoading;

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Default data if not loaded
  const summaryData = summary ?? {
    totalCost: 0,
    costChange: 0,
    totalTokens: 0,
    tokenChange: 0,
    totalRCAs: 0,
    rcaChange: 0,
    avgCostPerRCA: 0,
    avgTimePerRCA: 23,
    roi: 0,
    budgetUsed: 0,
    budgetLimit: 100,
    qualityBreakdown: {
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
    },
  };

  const chartData = dailyData ?? [];

  // Determine budget status
  const budgetStatus: "healthy" | "warning" | "critical" =
    summaryData.budgetUsed >= summaryData.budgetLimit
      ? "critical"
      : summaryData.budgetUsed >= summaryData.budgetLimit * 0.8
        ? "warning"
        : "healthy";

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Analytics
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Cost tracking & ROI analysis for your RCA operations
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {(["7d", "30d", "90d"] as TimePeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                period === p
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              )}
            >
              {p === "7d" ? "7 Days" : p === "30d" ? "30 Days" : "90 Days"}
            </button>
          ))}
        </div>
      </div>

      {/* TL;DR Banner */}
      <TLDRBanner
        roi={summaryData.roi}
        costTrend={summaryData.costChange}
        budgetStatus={budgetStatus}
      />

      {/* Core Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total LLM Cost"
          value={formatCurrency(summaryData.totalCost)}
          trend={{
            value: summaryData.costChange,
            isPositive: summaryData.costChange <= 0,
          }}
          subtitle="this period"
          icon={CurrencyDollarIcon}
          iconColor="text-green-600 dark:text-green-400"
          helpText="Total OpenAI API costs for RCA generation"
        />
        <MetricCard
          title="RCAs Generated"
          value={formatNumber(summaryData.totalRCAs)}
          trend={{
            value: summaryData.rcaChange,
            isPositive: summaryData.rcaChange >= 0,
          }}
          subtitle="this period"
          icon={ChartBarIcon}
          iconColor="text-blue-600 dark:text-blue-400"
          helpText="Total root cause analyses generated"
        />
        <MetricCard
          title="Cost per RCA"
          value={formatCurrency(summaryData.avgCostPerRCA)}
          subtitle="average"
          icon={BoltIcon}
          iconColor="text-purple-600 dark:text-purple-400"
          helpText="Average cost to generate one RCA report"
        />
        <MetricCard
          title="Budget Used"
          value={formatPercentage(
            (summaryData.budgetUsed / summaryData.budgetLimit) * 100
          )}
          subtitle={`$${summaryData.budgetUsed} / $${summaryData.budgetLimit}`}
          icon={ChartBarIcon}
          iconColor={
            budgetStatus === "critical"
              ? "text-red-600 dark:text-red-400"
              : budgetStatus === "warning"
                ? "text-yellow-600 dark:text-yellow-400"
                : "text-green-600 dark:text-green-400"
          }
          helpText="Monthly budget consumption"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <CostTrendChart data={chartData} period={period} />
        </div>
        <QualityBreakdown data={summaryData.qualityBreakdown} />
      </div>

      {/* ROI Calculator */}
      <ROICalculator
        rcasGenerated={summaryData.totalRCAs}
        avgTimePerRCA={summaryData.avgTimePerRCA}
        engineerHourlyRate={75} // Default hourly rate
      />

      {/* Daily Breakdown Table */}
      <DailyBreakdownTable data={chartData} />
    </div>
  );
}

export default AnalyticsPage;
