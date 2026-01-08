/**
 * Secret Management Page
 *
 * Admin interface for managing platform secrets:
 * - View secret rotation status
 * - Trigger manual rotations
 * - View rotation history
 * - Emergency rollback
 * - Cleanup expired versions
 */

import { useState } from "react";
import {
  KeyIcon,
  ArrowPathIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  TrashIcon,
  ArrowUturnLeftIcon,
  EyeIcon,
  ShieldExclamationIcon,
} from "@heroicons/react/24/outline";
import {
  useSecretStatus,
  useSecretVersions,
  useSecretHistory,
  useRotateSecret,
  useRollbackSecret,
  useCleanupSecrets,
  type SecretType,
  type SecretStatus,
} from "@/lib/admin-hooks";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

/**
 * Secret type display names
 */
const SECRET_TYPE_LABELS: Record<SecretType, string> = {
  jwt_secret: "JWT Secret",
  encryption_key: "Encryption Key",
  github_webhook_secret: "GitHub Webhook Secret",
  sentry_webhook_secret: "Sentry Webhook Secret",
  openai_api_key: "OpenAI API Key",
};

/**
 * Rotation reason options
 */
const ROTATION_REASONS = [
  { value: "manual", label: "Manual Rotation" },
  { value: "scheduled", label: "Scheduled Rotation" },
  { value: "security_incident", label: "Security Incident" },
  { value: "key_compromise", label: "Key Compromise" },
];

/**
 * Status badge component
 */
function StatusBadge({ status }: { status: SecretStatus }) {
  const config: Record<
    SecretStatus,
    { color: string; icon: React.ElementType; label: string }
  > = {
    healthy: {
      color:
        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
      icon: CheckCircleIcon,
      label: "Healthy",
    },
    expiring_soon: {
      color:
        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
      icon: ExclamationTriangleIcon,
      label: "Expiring Soon",
    },
    overdue: {
      color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
      icon: XCircleIcon,
      label: "Overdue",
    },
    missing: {
      color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400",
      icon: ShieldExclamationIcon,
      label: "Missing",
    },
  };

  const { color, icon: Icon, label } = config[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
        color
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

/**
 * Rotation confirmation modal
 */
function RotationModal({
  isOpen,
  secretType,
  onClose,
  onConfirm,
  isLoading,
}: {
  isOpen: boolean;
  secretType: SecretType | null;
  onClose: () => void;
  onConfirm: (reason: string, gracePeriodDays: number) => void;
  isLoading: boolean;
}) {
  const [reason, setReason] = useState("manual");
  const [gracePeriodDays, setGracePeriodDays] = useState(7);

  if (!isOpen || !secretType) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Rotate {SECRET_TYPE_LABELS[secretType]}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Rotation Reason
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
            >
              {ROTATION_REASONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Grace Period (days)
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={gracePeriodDays}
              onChange={(e) => setGracePeriodDays(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Previous version will remain valid for this period
            </p>
          </div>

          {(reason === "security_incident" || reason === "key_compromise") && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <p className="text-sm text-red-700 dark:text-red-400">
                ⚠️ This will immediately invalidate the current secret. Ensure
                all dependent services are prepared.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason, gracePeriodDays)}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading && <ArrowPathIcon className="w-4 h-4 animate-spin" />}
            Rotate Secret
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Secret detail panel
 */
function SecretDetailPanel({
  secretType,
  onClose,
}: {
  secretType: SecretType;
  onClose: () => void;
}) {
  const { data: versions, isLoading: versionsLoading } =
    useSecretVersions(secretType);
  const { data: history, isLoading: historyLoading } =
    useSecretHistory(secretType);

  const isLoading = versionsLoading || historyLoading;

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {SECRET_TYPE_LABELS[secretType]} Details
        </h3>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <XCircleIcon className="w-5 h-5" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <LoadingSpinner size="md" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Versions */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Versions
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-gray-200 dark:border-gray-700">
                    <th className="pb-2 font-medium text-gray-500">Version</th>
                    <th className="pb-2 font-medium text-gray-500">Key ID</th>
                    <th className="pb-2 font-medium text-gray-500">Status</th>
                    <th className="pb-2 font-medium text-gray-500">Created</th>
                    <th className="pb-2 font-medium text-gray-500">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {versions?.versions.map((v) => (
                    <tr
                      key={v.id}
                      className="border-b border-gray-100 dark:border-gray-800"
                    >
                      <td className="py-2 text-gray-900 dark:text-white">
                        v{v.version}
                      </td>
                      <td className="py-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                        {v.key_id}
                      </td>
                      <td className="py-2">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded text-xs font-medium",
                            v.status === "current"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : v.status === "previous"
                                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                : "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400"
                          )}
                        >
                          {v.status}
                        </span>
                      </td>
                      <td className="py-2 text-gray-600 dark:text-gray-400">
                        {new Date(v.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 text-gray-600 dark:text-gray-400">
                        {v.expires_at
                          ? new Date(v.expires_at).toLocaleDateString()
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* History */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Rotation History
            </h4>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {history?.history.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                >
                  <div
                    className={cn(
                      "p-1.5 rounded-full",
                      event.rotation_status === "success"
                        ? "bg-green-100 text-green-600"
                        : event.rotation_status === "rollback"
                          ? "bg-yellow-100 text-yellow-600"
                          : "bg-red-100 text-red-600"
                    )}
                  >
                    {event.rotation_status === "success" ? (
                      <CheckCircleIcon className="w-4 h-4" />
                    ) : event.rotation_status === "rollback" ? (
                      <ArrowUturnLeftIcon className="w-4 h-4" />
                    ) : (
                      <XCircleIcon className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {event.rotation_status === "success"
                        ? "Rotated"
                        : event.rotation_status === "rollback"
                          ? "Rolled back"
                          : "Failed"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {event.rotation_reason} • {event.duration_ms}ms •{" "}
                      {event.affected_records} records affected
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(event.created_at).toLocaleString()}
                    </p>
                    {event.error_message && (
                      <p className="text-xs text-red-500 mt-1">
                        {event.error_message}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SecretManagementPage() {
  const { data: secretStatus, isLoading, refetch } = useSecretStatus();
  const [rotatingSecret, setRotatingSecret] = useState<SecretType | null>(null);
  const [showDetails, setShowDetails] = useState<SecretType | null>(null);
  const [showRollbackDialog, setShowRollbackDialog] = useState(false);
  const [rollbackSecretType, setRollbackSecretType] =
    useState<SecretType | null>(null);
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const rotateSecret = useRotateSecret();
  const rollbackSecret = useRollbackSecret();
  const cleanupSecrets = useCleanupSecrets();
  const toast = useToast();

  const handleRotate = async (reason: string, gracePeriodDays: number) => {
    if (!rotatingSecret) return;

    try {
      const result = await rotateSecret.mutateAsync({
        secret_type: rotatingSecret,
        reason: reason as
          | "manual"
          | "scheduled"
          | "security_incident"
          | "key_compromise",
        grace_period_days: gracePeriodDays,
      });

      if (result.success) {
        toast.success("Secret Rotated", result.message);
        setRotatingSecret(null);
        refetch();
      } else {
        toast.error("Rotation Failed", result.error ?? "Unknown error");
      }
    } catch (error) {
      toast.error(
        "Error",
        error instanceof Error ? error.message : "Failed to rotate secret"
      );
    }
  };

  const handleRollback = async (secretType: SecretType) => {
    setRollbackSecretType(secretType);
    setShowRollbackDialog(true);
  };

  const confirmRollback = async () => {
    if (!rollbackSecretType) return;

    setIsProcessing(true);
    try {
      const result = await rollbackSecret.mutateAsync(rollbackSecretType);

      if (result.success) {
        toast.success("Rollback Complete", result.message);
        refetch();
        setShowRollbackDialog(false);
      } else {
        toast.error("Rollback Failed", result.error ?? "Unknown error");
      }
    } catch (error) {
      toast.error(
        "Error",
        error instanceof Error ? error.message : "Failed to rollback"
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCleanup = async () => {
    setShowCleanupDialog(true);
  };

  const confirmCleanup = async () => {
    setIsProcessing(true);
    try {
      const result = await cleanupSecrets.mutateAsync();
      toast.success("Cleanup Complete", result.message);
      refetch();
      setShowCleanupDialog(false);
    } catch (error) {
      toast.error(
        "Error",
        error instanceof Error ? error.message : "Failed to cleanup"
      );
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Secret Management
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Manage platform secrets and encryption keys
          </p>
        </div>
        <button
          onClick={handleCleanup}
          disabled={cleanupSecrets.isPending}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          {cleanupSecrets.isPending ? (
            <ArrowPathIcon className="w-4 h-4 animate-spin" />
          ) : (
            <TrashIcon className="w-4 h-4" />
          )}
          Cleanup Expired
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {secretStatus?.summary.total ?? 0}
          </p>
          <p className="text-sm text-gray-500">Total Secrets</p>
        </div>
        <div className="card p-4 text-center bg-green-50 dark:bg-green-900/20">
          <p className="text-2xl font-bold text-green-600">
            {secretStatus?.summary.healthy ?? 0}
          </p>
          <p className="text-sm text-gray-500">Healthy</p>
        </div>
        <div className="card p-4 text-center bg-yellow-50 dark:bg-yellow-900/20">
          <p className="text-2xl font-bold text-yellow-600">
            {secretStatus?.summary.expiring_soon ?? 0}
          </p>
          <p className="text-sm text-gray-500">Expiring Soon</p>
        </div>
        <div className="card p-4 text-center bg-red-50 dark:bg-red-900/20">
          <p className="text-2xl font-bold text-red-600">
            {(secretStatus?.summary.overdue ?? 0) +
              (secretStatus?.summary.missing ?? 0)}
          </p>
          <p className="text-sm text-gray-500">Needs Attention</p>
        </div>
      </div>

      {/* Alerts */}
      {secretStatus?.alerts && secretStatus.alerts.length > 0 && (
        <div className="card bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 p-4">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-orange-800 dark:text-orange-200">
                Secrets Requiring Attention
              </h3>
              <ul className="mt-2 space-y-1">
                {secretStatus.alerts.map((alert) => (
                  <li
                    key={alert.secret_type}
                    className="text-sm text-orange-700 dark:text-orange-300"
                  >
                    • {alert.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Secrets List */}
        <div className={cn("lg:col-span-2", showDetails && "lg:col-span-1")}>
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white">
                Managed Secrets
              </h2>
            </div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {secretStatus?.secrets.map((secret) => (
                <div
                  key={secret.secret_type}
                  className={cn(
                    "p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors",
                    showDetails === secret.secret_type &&
                      "bg-brand-50 dark:bg-brand-900/20"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
                        <KeyIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {SECRET_TYPE_LABELS[secret.secret_type]}
                        </p>
                        <p className="text-xs text-gray-500">
                          {secret.current_key_id
                            ? `Key: ${secret.current_key_id}`
                            : "No key set"}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={secret.status} />
                  </div>

                  <div className="mt-3 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-4 text-gray-500">
                      <span className="flex items-center gap-1">
                        <ClockIcon className="w-4 h-4" />
                        {secret.last_rotated
                          ? `Rotated ${new Date(secret.last_rotated).toLocaleDateString()}`
                          : "Never rotated"}
                      </span>
                      {secret.days_until_expiration !== null && (
                        <span
                          className={cn(
                            secret.days_until_expiration <= 0
                              ? "text-red-500"
                              : secret.days_until_expiration <= 7
                                ? "text-yellow-500"
                                : ""
                          )}
                        >
                          {secret.days_until_expiration <= 0
                            ? "Expired"
                            : `${secret.days_until_expiration} days left`}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setShowDetails(
                            showDetails === secret.secret_type
                              ? null
                              : secret.secret_type
                          )
                        }
                        className="p-1.5 text-gray-500 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="View Details"
                      >
                        <EyeIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setRotatingSecret(secret.secret_type)}
                        disabled={rotateSecret.isPending}
                        className="p-1.5 text-gray-500 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="Rotate Secret"
                      >
                        <ArrowPathIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRollback(secret.secret_type)}
                        disabled={
                          rollbackSecret.isPending || secret.version_count < 2
                        }
                        className="p-1.5 text-gray-500 hover:text-orange-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-30"
                        title="Rollback"
                      >
                        <ArrowUturnLeftIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Detail Panel */}
        {showDetails && (
          <div className="lg:col-span-2">
            <SecretDetailPanel
              secretType={showDetails}
              onClose={() => setShowDetails(null)}
            />
          </div>
        )}
      </div>

      {/* Rotation Modal */}
      <RotationModal
        isOpen={!!rotatingSecret}
        secretType={rotatingSecret}
        onClose={() => setRotatingSecret(null)}
        onConfirm={handleRotate}
        isLoading={rotateSecret.isPending}
      />

      {/* Rollback Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showRollbackDialog}
        onClose={() => setShowRollbackDialog(false)}
        onConfirm={confirmRollback}
        title="Rollback Secret"
        message={`Are you sure you want to rollback ${rollbackSecretType ? SECRET_TYPE_LABELS[rollbackSecretType] : "this secret"}? This will restore the previous version and may affect services currently using this secret.`}
        confirmText="Rollback Secret"
        variant="danger"
        isLoading={isProcessing}
      />

      {/* Cleanup Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showCleanupDialog}
        onClose={() => setShowCleanupDialog(false)}
        onConfirm={confirmCleanup}
        title="Cleanup Expired Secrets"
        message="This will permanently delete all expired secret versions. This action cannot be undone. Are you sure you want to continue?"
        confirmText="Delete Expired Versions"
        variant="danger"
        isLoading={isProcessing}
      />
    </div>
  );
}
