/**
 * Users Management Page
 *
 * Admin interface for managing platform users:
 * - View all users with search/filter
 * - User details and activity
 * - Suspend/unsuspend users
 */

import { useState } from "react";
import {
  MagnifyingGlassIcon,
  BuildingOfficeIcon,
  ClockIcon,
  NoSymbolIcon,
  CheckCircleIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import {
  useAdminUsers,
  useAdminUserDetail,
  useSuspendUser,
} from "@/lib/admin-hooks";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import InputDialog from "@/components/ui/InputDialog";

/**
 * Role badge component
 */
function RoleBadge({ role }: { role: "owner" | "admin" | "member" }) {
  const config = {
    owner:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    member: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };

  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded text-xs font-medium capitalize",
        config[role]
      )}
    >
      {role}
    </span>
  );
}

/**
 * Status badge component
 */
function StatusBadge({
  status,
}: {
  status: "active" | "suspended" | "pending";
}) {
  const config = {
    active:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    suspended: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    pending:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
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
 * User detail panel
 */
function UserDetailPanel({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const { data: user, isLoading } = useAdminUserDetail(userId);
  const suspendUser = useSuspendUser();
  const toast = useToast();
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const action = user?.status === "suspended" ? "unsuspend" : "suspend";

  const handleSuspendToggle = async (reason: string) => {
    if (!user) return;

    setIsProcessing(true);
    try {
      await suspendUser.mutateAsync({
        userId: user.id,
        suspend: action === "suspend",
        reason,
      });

      toast.success(`User ${action}ed`, `${user.name} has been ${action}ed.`);
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

  if (!user) {
    return (
      <div className="card p-6">
        <p className="text-gray-500">User not found</p>
      </div>
    );
  }

  return (
    <div className="card p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-brand-100 dark:bg-brand-900/30 rounded-full flex items-center justify-center">
            <span className="text-xl font-bold text-brand-600">
              {user.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {user.name}
            </h3>
            <p className="text-sm text-gray-500">{user.email}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          ×
        </button>
      </div>

      {/* Status & Role */}
      <div className="flex items-center gap-3">
        <RoleBadge role={user.role} />
        <StatusBadge status={user.status} />
      </div>

      {/* Organization */}
      <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <BuildingOfficeIcon className="w-5 h-5 text-gray-400" />
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {user.org_name}
          </p>
          <p className="text-xs text-gray-500">Organization</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {user.login_count}
          </p>
          <p className="text-xs text-gray-500">Total Logins</p>
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {user.last_login
              ? new Date(user.last_login).toLocaleDateString()
              : "Never"}
          </p>
          <p className="text-xs text-gray-500">Last Login</p>
        </div>
      </div>

      {/* Created */}
      <div>
        <p className="text-sm text-gray-500 mb-1">Member Since</p>
        <p className="text-gray-900 dark:text-white">
          {new Date(user.created_at).toLocaleDateString()}
        </p>
      </div>

      {/* Activity */}
      {user.activity && user.activity.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Recent Activity
          </p>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {user.activity.slice(0, 10).map((activity, idx) => (
              <div key={idx} className="flex items-center gap-2 py-1 text-sm">
                <ClockIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-gray-900 dark:text-white">
                  {activity.action}
                </span>
                <span className="text-gray-500 text-xs ml-auto">
                  {new Date(activity.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sessions */}
      {user.sessions && user.sessions.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Active Sessions
          </p>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {user.sessions.map((session) => (
              <div
                key={session.id}
                className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs"
              >
                <p className="text-gray-900 dark:text-white">
                  {session.ip_address}
                </p>
                <p className="text-gray-500 truncate">{session.user_agent}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setShowSuspendDialog(true)}
          disabled={suspendUser.isPending || user.role === "owner"}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm",
            user.status === "suspended"
              ? "bg-green-600 hover:bg-green-700 text-white"
              : "bg-red-600 hover:bg-red-700 text-white",
            "disabled:opacity-50"
          )}
        >
          {user.status === "suspended" ? (
            <>
              <CheckCircleIcon className="w-4 h-4" />
              Unsuspend User
            </>
          ) : (
            <>
              <NoSymbolIcon className="w-4 h-4" />
              Suspend User
            </>
          )}
        </button>
        {user.role === "owner" && (
          <p className="text-xs text-gray-500 text-center mt-2">
            Organization owners cannot be suspended
          </p>
        )}
      </div>

      <InputDialog
        isOpen={showSuspendDialog}
        onClose={() => setShowSuspendDialog(false)}
        onConfirm={handleSuspendToggle}
        title={`${user.status === "suspended" ? "Unsuspend" : "Suspend"} User`}
        message={`You are about to ${user.status === "suspended" ? "unsuspend" : "suspend"} ${user.name}. Please provide a reason for this action.`}
        inputLabel="Reason"
        inputPlaceholder={`Enter reason for ${user.status === "suspended" ? "unsuspending" : "suspending"} this user...`}
        confirmText={
          user.status === "suspended" ? "Unsuspend User" : "Suspend User"
        }
        variant={user.status === "suspended" ? "warning" : "danger"}
        isLoading={isProcessing}
        multiline
      />
    </div>
  );
}

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { data, isLoading } = useAdminUsers({
    page,
    pageSize: 20,
    search: search || undefined,
    role: roleFilter || undefined,
    status: statusFilter || undefined,
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Users
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage platform users
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
              placeholder="Search users by name or email..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
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
            <option value="pending">Pending</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Users List */}
        <div className={cn("lg:col-span-2", selectedUserId && "lg:col-span-1")}>
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
                      User
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Organization
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Role
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Last Login
                    </th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {data?.users.map((user) => (
                    <tr
                      key={user.id}
                      className={cn(
                        "hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer",
                        selectedUserId === user.id &&
                          "bg-brand-50 dark:bg-brand-900/20"
                      )}
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-brand-100 dark:bg-brand-900/30 rounded-full flex items-center justify-center">
                            <span className="text-sm font-medium text-brand-600">
                              {user.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">
                              {user.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {user.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {user.org_name}
                      </td>
                      <td className="px-4 py-3">
                        <RoleBadge role={user.role} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={user.status} />
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400">
                        {user.last_login
                          ? new Date(user.last_login).toLocaleDateString()
                          : "Never"}
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
        {selectedUserId && (
          <div className="lg:col-span-2">
            <UserDetailPanel
              userId={selectedUserId}
              onClose={() => setSelectedUserId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
