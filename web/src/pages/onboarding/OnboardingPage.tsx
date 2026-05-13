import { useNavigate } from "react-router-dom";
import { CheckCircleIcon, ArrowRightIcon } from "@heroicons/react/24/solid";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useOnboardingStatus, type OnboardingStep } from "@/lib/hooks";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { cn } from "@/lib/utils";

// Step key order — determines display order
const STEP_ORDER = ["github", "sentry", "deploy", "first_event"] as const;

function StepCard({
  step,
  index,
  isNext,
  isBlocked,
}: {
  step: OnboardingStep;
  index: number;
  isNext: boolean;
  isBlocked: boolean;
}) {
  const navigate = useNavigate();

  const badge = step.complete
    ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
    : isNext
      ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
      : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";

  return (
    <div
      className={cn(
        "card transition-all",
        step.complete && "border-green-200 dark:border-green-800",
        isNext && !step.complete && "border-brand-300 dark:border-brand-600 shadow-sm",
        isBlocked && "opacity-50"
      )}
    >
      <div className="card-body">
        <div className="flex items-start gap-4">
          {/* Step number / check */}
          <div
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold",
              step.complete
                ? "bg-green-500 text-white"
                : isNext
                  ? "bg-brand-600 text-white"
                  : "bg-gray-200 dark:bg-gray-700 text-gray-500"
            )}
          >
            {step.complete ? (
              <CheckCircleIcon className="w-5 h-5" />
            ) : (
              <span>{index + 1}</span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {step.label}
              </h3>
              <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", badge)}>
                {step.complete ? "Done" : isNext ? "Up next" : "Pending"}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {step.description}
            </p>

            {/* Contextual stats */}
            {step.complete && step.repos_count !== undefined && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                {step.repos_count} repo{step.repos_count !== 1 ? "s" : ""} connected
              </p>
            )}
            {step.complete && step.deployments_count !== undefined && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                {step.deployments_count} deployment{step.deployments_count !== 1 ? "s" : ""} tracked
              </p>
            )}
            {step.complete && step.events_count !== undefined && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                {step.events_count} event{step.events_count !== 1 ? "s" : ""} received
              </p>
            )}
          </div>

          {/* Action button */}
          {!step.complete && !isBlocked && (
            <button
              onClick={() => navigate(step.action_url)}
              className={cn(
                "btn flex items-center gap-1.5 flex-shrink-0",
                isNext ? "btn-primary" : "btn-secondary"
              )}
            >
              {isNext ? "Set up" : "Configure"}
              <ArrowRightIcon className="w-3.5 h-3.5" />
            </button>
          )}
          {step.complete && (
            <button
              onClick={() => navigate(step.action_url)}
              className="btn btn-ghost text-sm flex-shrink-0"
            >
              View
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { data: status, isLoading } = useOnboardingStatus();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!status) return null;

  const { steps, completion_pct, is_ready_for_rca, next_step } = status;

  // If fully done, send them to the dashboard
  if (next_step === "complete") {
    navigate("/dashboard", { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center py-12 px-4">
      {/* Header */}
      <div className="w-full max-w-2xl mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Set up Buglens
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Complete these steps to start receiving AI-powered root cause analysis.
            </p>
          </div>
          <button
            onClick={() => navigate("/dashboard")}
            className="btn btn-ghost text-sm text-gray-500"
          >
            Skip for now
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 mb-2">
          <div
            className="bg-brand-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${completion_pct}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {completion_pct}% complete
        </p>
      </div>

      {/* RCA readiness banner */}
      {!is_ready_for_rca && (
        <div className="w-full max-w-2xl mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg flex items-start gap-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <strong>RCA is not active yet.</strong> GitHub and Sentry must both be connected before Buglens can analyze errors.
          </p>
        </div>
      )}

      {is_ready_for_rca && (
        <div className="w-full max-w-2xl mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CheckCircleIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
            <p className="text-sm text-green-800 dark:text-green-200">
              <strong>RCA is active.</strong> Buglens will analyze errors as they arrive.
            </p>
          </div>
          <button
            onClick={() => navigate("/dashboard")}
            className="btn btn-primary text-sm"
          >
            Go to dashboard
          </button>
        </div>
      )}

      {/* Steps */}
      <div className="w-full max-w-2xl space-y-4">
        {STEP_ORDER.map((key, i) => {
          const step = steps[key];
          const isNext = next_step === key;
          // A step is blocked if a required predecessor isn't done
          // (deploy and first_event can be done in any order after github+sentry)
          const isBlocked =
            (key === "sentry" && !steps.github.complete) ||
            (key === "first_event" && !steps.sentry.complete);

          return (
            <StepCard
              key={key}
              step={step}
              index={i}
              isNext={isNext}
              isBlocked={isBlocked}
            />
          );
        })}
      </div>

      {/* Help */}
      <p className="mt-8 text-xs text-gray-400 dark:text-gray-500 text-center max-w-md">
        Need help?{" "}
        <a
          href="https://github.com/anthropics/claude-code/issues"
          className="underline hover:text-gray-600"
          target="_blank"
          rel="noreferrer"
        >
          Open an issue
        </a>{" "}
        or check the{" "}
        <button
          onClick={() => navigate("/settings/sdk")}
          className="underline hover:text-gray-600"
        >
          SDK setup guide
        </button>
        .
      </p>
    </div>
  );
}
