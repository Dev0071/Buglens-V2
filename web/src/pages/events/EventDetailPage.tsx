import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { formatDateTime, getSeverityClass, getStatusClass } from "@/lib/utils";
import {
  ArrowLeftIcon,
  ClockIcon,
  CodeBracketIcon,
  ServerIcon,
} from "@heroicons/react/24/outline";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

interface EventDetail {
  id: string;
  sentry_event_id: string;
  sentry_issue_id: string;
  message: string;
  platform: string;
  severity: string;
  environment: string;
  status: string;
  raw_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  rca_job?: {
    id: string;
    status: string;
    rca_result_id?: string;
  };
}

/**
 * Event detail page showing raw event data and RCA status
 */
function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();

  const {
    data: event,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.events.detail(eventId!),
    queryFn: () => apiClient.get<EventDetail>(`/events/${eventId}`),
    enabled: !!eventId,
  });

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-900 dark:text-white">
            Event not found
          </p>
          <Link to="/events" className="btn-primary mt-4">
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

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
          <h1 className="text-xl font-bold text-gray-900 dark:text-white break-words">
            {event.message}
          </h1>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <span className={getSeverityClass(event.severity)}>
              {event.severity}
            </span>
            <span className={getStatusClass(event.status)}>{event.status}</span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {event.sentry_event_id}
            </span>
          </div>
        </div>
      </div>

      {/* RCA status card */}
      {event.rca_job && (
        <div className="card">
          <div className="card-body">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Root Cause Analysis
            </h2>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={getStatusClass(event.rca_job.status)}>
                  {event.rca_job.status}
                </span>
                {event.rca_job.status === "processing" && (
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Analysis in progress...
                  </span>
                )}
              </div>
              {event.rca_job.rca_result_id && (
                <Link
                  to={`/rca/${event.rca_job.rca_result_id}`}
                  className="btn-primary"
                >
                  View RCA Report
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Event metadata */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-body">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Event Details
            </h2>
            <dl className="space-y-3">
              <div className="flex items-center gap-3">
                <ServerIcon className="w-5 h-5 text-gray-400" />
                <div>
                  <dt className="text-sm text-gray-500 dark:text-gray-400">
                    Platform
                  </dt>
                  <dd className="font-medium text-gray-900 dark:text-white">
                    {event.platform}
                  </dd>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <CodeBracketIcon className="w-5 h-5 text-gray-400" />
                <div>
                  <dt className="text-sm text-gray-500 dark:text-gray-400">
                    Environment
                  </dt>
                  <dd className="font-medium text-gray-900 dark:text-white">
                    {event.environment}
                  </dd>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <ClockIcon className="w-5 h-5 text-gray-400" />
                <div>
                  <dt className="text-sm text-gray-500 dark:text-gray-400">
                    Received
                  </dt>
                  <dd className="font-medium text-gray-900 dark:text-white">
                    {formatDateTime(event.created_at)}
                  </dd>
                </div>
              </div>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Sentry Info
            </h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">
                  Event ID
                </dt>
                <dd className="font-mono text-sm text-gray-900 dark:text-white break-all">
                  {event.sentry_event_id}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 dark:text-gray-400">
                  Issue ID
                </dt>
                <dd className="font-mono text-sm text-gray-900 dark:text-white">
                  {event.sentry_issue_id}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {/* Raw payload */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Raw Payload
          </h2>
          <button
            onClick={() =>
              navigator.clipboard.writeText(
                JSON.stringify(event.raw_payload, null, 2)
              )
            }
            className="btn btn-secondary text-sm"
          >
            Copy JSON
          </button>
        </div>
        <div className="p-4 max-h-96 overflow-auto">
          <pre className="text-sm">
            <code className="text-gray-800 dark:text-gray-200">
              {JSON.stringify(event.raw_payload, null, 2)}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}

export default EventDetailPage;
