import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useRCAResult, useSubmitRCAFeedback } from "@/lib/hooks";
import { formatDateTime, getSeverityClass, cn } from "@/lib/utils";
import {
  ArrowLeftIcon,
  LightBulbIcon,
  WrenchScrewdriverIcon,
  DocumentTextIcon,
  ClockIcon,
  CheckCircleIcon,
  ShareIcon,
  ChartBarIcon,
  CodeBracketIcon,
  ChatBubbleLeftEllipsisIcon,
  StarIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { EvidenceGraphView } from "@/components/EvidenceGraphView";

// Tab types
type TabId = "summary" | "evidence" | "code" | "timeline" | "feedback";

interface Tab {
  id: TabId;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
}

const tabs: Tab[] = [
  { id: "summary", name: "Summary", icon: DocumentTextIcon },
  { id: "evidence", name: "Evidence Graph", icon: ChartBarIcon },
  { id: "code", name: "Code Context", icon: CodeBracketIcon },
  { id: "timeline", name: "Timeline", icon: ClockIcon },
  { id: "feedback", name: "Feedback", icon: ChatBubbleLeftEllipsisIcon },
];

/**
 * RCA detail page with 5-tab design
 * Decision-driven: "What caused this error and how do I fix it?"
 */
function RCADetailPage() {
  const { rcaId } = useParams<{ rcaId: string }>();
  const [activeTab, setActiveTab] = useState<TabId>("summary");

  const { data: rca, isLoading, error } = useRCAResult(rcaId);

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !rca) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-900 dark:text-white">
            RCA report not found
          </p>
          <Link to="/events" className="btn-primary mt-4">
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  // Confidence is displayed via the ConfidenceMeter component

  return (
    <div className="space-y-6">
      {/* Back button and header */}
      <div className="flex items-start gap-4">
        <Link
          to="/events"
          className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <ArrowLeftIcon className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {rca.title}
          </h1>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            {/* Confidence Score */}
            <ConfidenceMeter confidence={rca.confidence} />
            {rca.deterministic_only && (
              <span className="badge badge-warning">Deterministic only</span>
            )}
            <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <ClockIcon className="w-4 h-4" />
              {formatDateTime(rca.created_at)}
            </span>
          </div>
        </div>

        {/* Share Button */}
        <button
          onClick={() => navigator.clipboard.writeText(window.location.href)}
          className="btn btn-secondary flex items-center gap-2"
        >
          <ShareIcon className="w-4 h-4" />
          Share
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors",
                activeTab === tab.id
                  ? "border-brand-500 text-brand-600 dark:text-brand-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              )}
            >
              <tab.icon className="w-5 h-5" />
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === "summary" && <SummaryTab rca={rca} />}
        {activeTab === "evidence" && <EvidenceTab rca={rca} />}
        {activeTab === "code" && <CodeContextTab rca={rca} />}
        {activeTab === "timeline" && <TimelineTab rca={rca} />}
        {activeTab === "feedback" && <FeedbackTab rca={rca} />}
      </div>

      {/* Metadata Footer */}
      <div className="card">
        <div className="card-body">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
            Analysis Metadata
          </h2>
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">
                LLM Tokens:{" "}
              </span>
              <span className="font-medium text-gray-900 dark:text-white">
                {rca.llm_tokens_used.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Mode: </span>
              <span className="font-medium text-gray-900 dark:text-white">
                {rca.deterministic_only
                  ? "Deterministic Only"
                  : "Full Analysis"}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">
                Event ID:{" "}
              </span>
              <span className="font-medium font-mono text-gray-900 dark:text-white">
                {rca.event_id}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Confidence Meter Component
 */
function ConfidenceMeter({ confidence }: { confidence: number }) {
  const percentage = confidence * 100;
  const getColor = () => {
    if (confidence >= 0.8) return "text-green-600 dark:text-green-400";
    if (confidence >= 0.6) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getBgColor = () => {
    if (confidence >= 0.8) return "bg-green-500";
    if (confidence >= 0.6) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full", getBgColor())}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className={cn("text-sm font-medium", getColor())}>
        {percentage.toFixed(0)}% confidence
      </span>
    </div>
  );
}

// ============================================================================
// Summary Tab
// ============================================================================

import type { RCAResult } from "@/types/api";

function SummaryTab({ rca }: { rca: RCAResult }) {
  return (
    <div className="space-y-6">
      {/* Summary card */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <DocumentTextIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Summary
              </h2>
              <p className="mt-2 text-gray-600 dark:text-gray-300">
                {rca.summary}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Root cause and fix suggestion */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-body">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <LightBulbIcon className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Root Cause
                </h2>
                <p className="mt-2 text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                  {rca.root_cause}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <WrenchScrewdriverIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Suggested Fix
                </h2>
                <p className="mt-2 text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                  {rca.fix_suggestion}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Deterministic findings */}
      {rca.evidence.deterministic_findings.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Analysis Findings
            </h2>
            <span className="badge badge-info">
              {rca.evidence.deterministic_findings.length} findings
            </span>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {rca.evidence.deterministic_findings.map((finding, index) => (
              <div key={index} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircleIcon className="w-5 h-5 text-green-500" />
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white">
                        {finding.title}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {finding.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={getSeverityClass(finding.severity)}>
                      {finding.severity}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {Math.round(finding.confidence * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Evidence Graph Tab
// ============================================================================

function EvidenceTab({ rca }: { rca: RCAResult }) {
  // Get orgId from the RCA result or context
  // For now, we'll use a placeholder since org context is typically from auth
  const orgId = rca.org_id || "";

  return (
    <div className="space-y-6">
      {/* Interactive Evidence Graph */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Evidence Graph
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Visual representation of how evidence connects to the root cause
          </p>
        </div>
        <div className="card-body">
          <EvidenceGraphView rcaId={rca.id} orgId={orgId} />
        </div>
      </div>

      {/* Deterministic Findings Summary */}
      {rca.evidence.deterministic_findings.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Deterministic Findings
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Evidence from static code analysis
            </p>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rca.evidence.deterministic_findings.map((finding, i) => (
                <div
                  key={`finding-${i}`}
                  className={cn(
                    "p-4 rounded-lg border",
                    finding.severity === "high"
                      ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
                      : finding.severity === "medium"
                        ? "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20"
                        : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={cn(
                        "text-xs font-medium uppercase tracking-wider",
                        finding.severity === "high"
                          ? "text-red-600 dark:text-red-400"
                          : finding.severity === "medium"
                            ? "text-yellow-600 dark:text-yellow-400"
                            : "text-gray-600 dark:text-gray-400"
                      )}
                    >
                      {finding.severity}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {Math.round(finding.confidence * 100)}% confidence
                    </span>
                  </div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {finding.title}
                  </p>
                  {finding.file_path && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 truncate">
                      {finding.file_path}
                      {finding.line_number && `:${finding.line_number}`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Code Context Tab
// ============================================================================

function CodeContextTab({ rca }: { rca: RCAResult }) {
  const [selectedFile, setSelectedFile] = useState(0);

  return (
    <div className="space-y-6">
      {/* Stack trace */}
      {rca.evidence.error_info.stack_trace.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Stack Trace
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>File</th>
                  <th>Line</th>
                  <th>Function</th>
                </tr>
              </thead>
              <tbody>
                {rca.evidence.error_info.stack_trace.map((frame, index) => (
                  <tr key={index}>
                    <td className="text-gray-400">{index + 1}</td>
                    <td className="font-mono text-sm">{frame.file}</td>
                    <td className="font-mono text-sm text-brand-600 dark:text-brand-400">
                      {frame.line}
                    </td>
                    <td className="font-mono text-sm">{frame.function}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Code files */}
      {rca.evidence.code_context.files.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Related Code
            </h2>
            {/* File tabs */}
            {rca.evidence.code_context.files.length > 1 && (
              <div className="flex gap-2">
                {rca.evidence.code_context.files.map((file, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedFile(index)}
                    className={cn(
                      "px-3 py-1 text-sm font-mono rounded",
                      selectedFile === index
                        ? "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"
                        : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                    )}
                  >
                    {file.path.split("/").pop()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="card-body p-0">
            {rca.evidence.code_context.files[selectedFile] && (
              <div>
                <div className="px-4 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <span className="font-mono text-sm text-gray-600 dark:text-gray-400">
                    {rca.evidence.code_context.files[selectedFile].path}
                  </span>
                </div>
                <pre className="p-4 overflow-x-auto">
                  <code className="text-sm text-gray-800 dark:text-gray-200 font-mono whitespace-pre">
                    {rca.evidence.code_context.files[selectedFile].content}
                  </code>
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {rca.evidence.code_context.files.length === 0 && (
        <div className="card">
          <div className="card-body text-center py-12">
            <CodeBracketIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">
              No code context available for this RCA
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Timeline Tab
// ============================================================================

function TimelineTab({ rca }: { rca: RCAResult }) {
  const timeline = rca.evidence.timeline?.events || [];

  // Generate mock timeline if empty
  const timelineEvents =
    timeline.length > 0
      ? timeline
      : [
          {
            timestamp: rca.created_at,
            type: "error",
            message: rca.evidence.error_info.message,
          },
          {
            timestamp: new Date(
              new Date(rca.created_at).getTime() + 1000
            ).toISOString(),
            type: "analysis",
            message: "Started deterministic analysis",
          },
          {
            timestamp: new Date(
              new Date(rca.created_at).getTime() + 5000
            ).toISOString(),
            type: "analysis",
            message: `Found ${rca.evidence.deterministic_findings.length} patterns`,
          },
          {
            timestamp: new Date(
              new Date(rca.created_at).getTime() + 10000
            ).toISOString(),
            type: "llm",
            message: "LLM analysis completed",
          },
          {
            timestamp: new Date(
              new Date(rca.created_at).getTime() + 12000
            ).toISOString(),
            type: "complete",
            message: "RCA generation complete",
          },
        ];

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Event Timeline
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Sequence of events leading to this error
        </p>
      </div>
      <div className="card-body">
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />

          {/* Timeline events */}
          <div className="space-y-6">
            {timelineEvents.map((event, index) => (
              <div key={index} className="relative pl-10">
                {/* Timeline dot */}
                <div
                  className={cn(
                    "absolute left-2 w-5 h-5 rounded-full border-2 bg-white dark:bg-gray-900",
                    event.type === "error"
                      ? "border-red-500"
                      : event.type === "complete"
                        ? "border-green-500"
                        : "border-blue-500"
                  )}
                >
                  <div
                    className={cn(
                      "absolute inset-1 rounded-full",
                      event.type === "error"
                        ? "bg-red-500"
                        : event.type === "complete"
                          ? "bg-green-500"
                          : "bg-blue-500"
                    )}
                  />
                </div>

                {/* Event content */}
                <div className="pb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={cn(
                        "text-xs font-medium uppercase",
                        event.type === "error"
                          ? "text-red-600 dark:text-red-400"
                          : event.type === "complete"
                            ? "text-green-600 dark:text-green-400"
                            : "text-blue-600 dark:text-blue-400"
                      )}
                    >
                      {event.type}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatDateTime(event.timestamp)}
                    </span>
                  </div>
                  <p className="text-gray-700 dark:text-gray-300">
                    {event.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Feedback Tab
// ============================================================================

function FeedbackTab({ rca }: { rca: RCAResult }) {
  const [rating, setRating] = useState<number>(0);
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submitFeedback = useSubmitRCAFeedback();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) return;

    await submitFeedback.mutateAsync({
      rcaId: rca.id,
      rating: rating as 1 | 2 | 3 | 4 | 5,
      wasHelpful: helpful ?? rating >= 4,
      comment: comment || undefined,
    });

    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="card">
        <div className="card-body text-center py-12">
          <CheckCircleIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Thank you for your feedback!
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            Your feedback helps us improve RCA accuracy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Rate this RCA
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your feedback helps improve future analyses
          </p>
        </div>
        <div className="card-body">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Star Rating */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Overall Quality
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className="focus:outline-none"
                  >
                    {star <= rating ? (
                      <StarIconSolid className="w-8 h-8 text-yellow-400" />
                    ) : (
                      <StarIcon className="w-8 h-8 text-gray-300 dark:text-gray-600 hover:text-yellow-400" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Helpful? */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Was this RCA helpful in resolving the issue?
              </label>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setHelpful(true)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
                    helpful === true
                      ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                      : "border-gray-200 dark:border-gray-700 hover:border-green-300"
                  )}
                >
                  <HandThumbUpIcon className="w-5 h-5" />
                  Yes, helpful
                </button>
                <button
                  type="button"
                  onClick={() => setHelpful(false)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
                    helpful === false
                      ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                      : "border-gray-200 dark:border-gray-700 hover:border-red-300"
                  )}
                >
                  <HandThumbDownIcon className="w-5 h-5" />
                  Not helpful
                </button>
              </div>
            </div>

            {/* Comment */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Additional Comments (optional)
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                className="input"
                placeholder="What could we improve? Was the root cause accurate?"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={rating === 0 || submitFeedback.isPending}
            >
              {submitFeedback.isPending ? "Submitting..." : "Submit Feedback"}
            </button>
          </form>
        </div>
      </div>

    </div>
  );
}

export default RCADetailPage;
