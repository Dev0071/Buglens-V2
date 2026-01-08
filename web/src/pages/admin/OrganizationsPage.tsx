/**
 * Organizations Management Page
 *
 * Admin interface for managing platform organizations:
 * - View all organizations with search/filter
 * - Organization details and usage metrics
 * - Suspend/unsuspend organizations
 */

import { useState } from "react";
import {
  BuildingOfficeIcon,
  MagnifyingGlassIcon,
  UsersIcon,
  ExclamationCircleIcon,
  CurrencyDollarIcon,
  ChevronRightIcon,
  NoSymbolIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import {
  useAdminOrganizations,
  useAdminOrganizationDetail,
  useSuspendOrganization,
} from "@/lib/admin-hooks";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import InputDialog from "@/components/ui/InputDialog";

/**
 * Plan badge component
 */
function PlanBadge({ plan }: { plan: "free" | "pro" | "enterprise" }) {
  const config = {
    free: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    pro: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    enterprise:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  };

  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded text-xs font-medium capitalize",
        config[plan]
      )}
    >
      {plan}
    </span>
  );
}

/**
 * Status badge component
 */
function StatusBadge({
  status,
}: {
  status: "active" | "suspended" | "deleted";
}) {
  const config = {
    active:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    suspended: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    deleted: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
  };

  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded text-xs font-medium capitalize",
        config[status]
      )}
    >
      {status}
    </span>
  );
}

/**
 * Organization detail panel
 */
function OrganizationDetailPanel({
  orgId,
  onClose,
}: {
  orgId: string;
  onClose: () => void;
}) {
  const { data: org, isLoading } = useAdminOrganizationDetail(orgId);
  const suspendOrg = useSuspendOrganization();
  const toast = useToast();
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSuspendToggle = async (reason: string) => {
    if (!org) return;

    const action = org.status === "suspended" ? "unsuspend" : "suspend";
    setIsProcessing(true);
    try {
      await suspendOrg.mutateAsync({
        orgId: org.id,
        suspend: action === "suspend",
        reason,
      });

      toast.success(
        `Organization ${action}ed`,
        `${org.name} has been ${action}ed.`
      );
      setShowSuspendDialog(false);
    } catch (error) {
      toast.error(
        "Error",
        error instanceof Error ? error.message : "Operation failed"
      );
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="card p-6 flex items-center justify-center h-96">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="card p-6">
        <p className="text-gray-500">Organization not found</p>
      </div>
    );
  }

  return (
    <div className="card p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-brand-100 dark:bg-brand-900/30 rounded-lg flex items-center justify-center">
            <span className="text-xl font-bold text-brand-600">
              {org.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {org.name}
            </h3>
            <p className="text-sm text-gray-500">{org.slug}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          ×
        </button>
      </div>

      {/* Status & Plan */}
      <div className="flex items-center gap-3">
        <PlanBadge plan={org.plan} />
        <StatusBadge status={org.status} />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <UsersIcon className="w-4 h-4" />
            Members
          </div>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {org.member_count}
          </p>
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <ExclamationCircleIcon className="w-4 h-4" />
            Events (30d)
          </div>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {org.event_count_30d.toLocaleString()}
          </p>
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <BuildingOfficeIcon className="w-4 h-4" />
            RCAs (30d)
          </div>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {org.rca_count_30d.toLocaleString()}
          </p>
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <CurrencyDollarIcon className="w-4 h-4" />
            Cost (30d)
          </div>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            ${org.cost_30d.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Owner */}
      <div>
        <p className="text-sm text-gray-500 mb-1">Owner</p>
        <p className="text-gray-900 dark:text-white">{org.owner_email}</p>
      </div>

      {/* Created Date */}
      <div>
        <p className="text-sm text-gray-500 mb-1">Created</p>
        <p className="text-gray-900 dark:text-white">
          {new Date(org.created_at).toLocaleDateString()}
        </p>
      </div>

      {/* Integrations */}
      <div>
        <p className="text-sm text-gray-500 mb-2">Integrations</p>
        <div className="flex flex-wrap gap-2">
          {org.integrations.map((integration) => (
            <span
              key={integration.type}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium capitalize",
                integration.status === "connected"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
              )}
            >
              {integration.type}
            </span>
          ))}
        </div>
      </div>

      {/* Members Preview */}
      <div>
        <p className="text-sm text-gray-500 mb-2">Team Members</p>
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {org.members.slice(0, 5).map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0"
            >
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {member.name}
                </p>
                <p className="text-xs text-gray-500">{member.email}</p>
              </div>
              <span className="text-xs text-gray-500 capitalize">
                {member.role}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setShowSuspendDialog(true)}
          disabled={suspendOrg.isPending}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm",
            org.status === "suspended"
              ? "bg-green-600 hover:bg-green-700 text-white"
              : "bg-red-600 hover:bg-red-700 text-white"
          )}
        >
          {org.status === "suspended" ? (
            <>
              <CheckCircleIcon className="w-4 h-4" />
              Unsuspend Organization
            </>
          ) : (
            <>
              <NoSymbolIcon className="w-4 h-4" />
              Suspend Organization
            </>
          )}
        </button>
      </div>

      <InputDialog
        isOpen={showSuspendDialog}
        onClose={() => setShowSuspendDialog(false)}
        onConfirm={handleSuspendToggle}
        title={`${org.status === "suspended" ? "Unsuspend" : "Suspend"} Organization`}
        message={`You are about to ${org.status === "suspended" ? "unsuspend" : "suspend"} ${org.name}. Please provide a reason for this action.`}
        inputLabel="Reason"
        inputPlaceholder={`Enter reason for ${org.status === "suspended" ? "unsuspending" : "suspending"} this organization...`}
        confirmText={
          org.status === "suspended"
            ? "Unsuspend Organization"
            : "Suspend Organization"
        }
        variant={org.status === "suspended" ? "warning" : "danger"}
        isLoading={isProcessing}
        multiline
      />
    </div>
  );
}

export default function OrganizationsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const { data, isLoading } = useAdminOrganizations({
    page,
    pageSize: 20,
    search: search || undefined,
    plan: planFilter || undefined,
    status: statusFilter || undefined,
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Organizations
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage platform organizations
        </p>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search organizations..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Plan Filter */}
          <select
            value={planFilter}
            onChange={(e) => {
              setPlanFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Plans</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Organizations List */}
        <div className={cn("lg:col-span-2", selectedOrgId && "lg:col-span-1")}>
          {isLoading ? (
            <div className="card p-8 flex items-center justify-center">
              <LoadingSpinner size="lg" />
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Organization
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Plan
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Events
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Cost
                    </th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {data?.organizations.map((org) => (
                    <tr
                      key={org.id}
                      className={cn(
                        "hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer",
                        selectedOrgId === org.id &&
                          "bg-brand-50 dark:bg-brand-900/20"
                      )}
                      onClick={() => setSelectedOrgId(org.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                              {org.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">
                              {org.name}
                            </p>
                            <p className="text-xs text-gray-500">{org.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <PlanBadge plan={org.plan} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={org.status} />
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                        {org.event_count_30d.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                        ${org.cost_30d.toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRightIcon className="w-4 h-4 text-gray-400" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {data && data.total > 20 && (
                <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    Showing {(page - 1) * 20 + 1} to{" "}
                    {Math.min(page * 20, data.total)} of {data.total}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(page - 1)}
                      disabled={page === 1}
                      className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setPage(page + 1)}
                      disabled={page * 20 >= data.total}
                      className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedOrgId && (
          <div className="lg:col-span-2">
            <OrganizationDetailPanel
              orgId={selectedOrgId}
              onClose={() => setSelectedOrgId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
