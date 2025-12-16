import { useParams, Link } from "react-router-dom";
import { useRCAResult } from "@/lib/hooks";
import {
  formatDateTime,
  formatConfidence,
  getSeverityClass,
} from "@/lib/utils";
import {
  ArrowLeftIcon,
  LightBulbIcon,
  WrenchScrewdriverIcon,
  DocumentTextIcon,
  ClockIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

/**
 * RCA detail page showing full analysis results
 */
function RCADetailPage() {
  const { rcaId } = useParams<{ rcaId: string }>();

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

  const { value: confidenceValue, colorClass: confidenceClass } =
    formatConfidence(rca.confidence);

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
            <span className={`text-sm font-medium ${confidenceClass}`}>
              {confidenceValue} confidence
            </span>
            {rca.deterministic_only && (
              <span className="badge badge-warning">Deterministic only</span>
            )}
            <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <ClockIcon className="w-4 h-4" />
              {formatDateTime(rca.created_at)}
            </span>
          </div>
        </div>
      </div>

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
                  <th>File</th>
                  <th>Line</th>
                  <th>Function</th>
                </tr>
              </thead>
              <tbody>
                {rca.evidence.error_info.stack_trace.map((frame, index) => (
                  <tr key={index}>
                    <td className="font-mono text-sm">{frame.file}</td>
                    <td className="font-mono text-sm">{frame.line}</td>
                    <td className="font-mono text-sm">{frame.function}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Code context */}
      {rca.evidence.code_context.files.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Related Code
            </h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {rca.evidence.code_context.files.map((file, index) => (
              <div key={index} className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-sm text-gray-600 dark:text-gray-400">
                    {file.path}
                  </span>
                </div>
                <pre className="text-sm overflow-x-auto">
                  <code className="text-gray-800 dark:text-gray-200">
                    {file.content}
                  </code>
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
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
          </div>
        </div>
      </div>
    </div>
  );
}

export default RCADetailPage;
