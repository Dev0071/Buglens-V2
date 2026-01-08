/**
 * Settings Page with Sub-Navigation
 *
 * Decision-driven design answering:
 * - "How do I configure my organization?"
 * - "Who has access to what?"
 * - "How do I manage integrations?"
 * - "What's my API key?"
 */

import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BuildingOfficeIcon,
  UsersIcon,
  PuzzlePieceIcon,
  KeyIcon,
  CreditCardIcon,
  BellIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClipboardDocumentIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/store/auth";
import {
  useOrganizationSettings,
  useUpdateSettings,
  useIntegrations,
  useConnectIntegration,
  useDisconnectIntegration,
  useBillingUsage,
  useUpgradePlan,
  useTeamMembers,
  useInviteMember,
  useUpdateMemberRole,
  useRemoveMember,
  useProfile,
  useUpdateProfile,
  useChangePassword,
  useNotificationPreferences,
  useDeleteAccount,
} from "@/lib/hooks";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { useToast } from "@/components/ui/toaster";

// Settings navigation items
const settingsNav = [
  {
    name: "Profile",
    href: "/settings/profile",
    icon: UserCircleIcon,
    description: "Your personal settings",
  },
  {
    name: "Organization",
    href: "/settings",
    icon: BuildingOfficeIcon,
    description: "Organization details and preferences",
  },
  {
    name: "Team",
    href: "/settings/team",
    icon: UsersIcon,
    description: "Manage team members and roles",
  },
  {
    name: "Integrations",
    href: "/settings/integrations",
    icon: PuzzlePieceIcon,
    description: "Configure Sentry, GitHub, and Slack",
  },
  {
    name: "API Keys",
    href: "/settings/api-keys",
    icon: KeyIcon,
    description: "Manage API access tokens",
  },
  {
    name: "Notifications",
    href: "/settings/notifications",
    icon: BellIcon,
    description: "Configure alerts and notifications",
  },
  {
    name: "Billing",
    href: "/settings/billing",
    icon: CreditCardIcon,
    description: "Subscription and payment settings",
  },
];

/**
 * Settings layout with side navigation
 */
function SettingsPage() {
  const location = useLocation();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Settings
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage your organization, team, and integrations
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Settings Navigation */}
        <nav className="lg:w-64 flex-shrink-0">
          <div className="card">
            <div className="p-2">
              {settingsNav.map((item) => {
                const isActive =
                  (item.href === "/settings" &&
                    location.pathname === "/settings") ||
                  (item.href !== "/settings" &&
                    location.pathname.startsWith(item.href));

                return (
                  <NavLink
                    key={item.name}
                    to={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                      isActive
                        ? "bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "w-5 h-5",
                        isActive
                          ? "text-brand-600 dark:text-brand-400"
                          : "text-gray-500 dark:text-gray-400"
                      )}
                    />
                    <span className="font-medium">{item.name}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Settings Content */}
        <div className="flex-1 min-w-0">
          {/* Render nested routes or default content */}
          {location.pathname === "/settings" ? (
            <OrganizationSettings />
          ) : location.pathname === "/settings/profile" ? (
            <ProfileSettings />
          ) : location.pathname === "/settings/team" ? (
            <TeamSettings />
          ) : location.pathname === "/settings/integrations" ? (
            <IntegrationsSettings />
          ) : location.pathname === "/settings/api-keys" ? (
            <APIKeysSettings />
          ) : location.pathname === "/settings/notifications" ? (
            <NotificationSettings />
          ) : location.pathname === "/settings/billing" ? (
            <BillingSettings />
          ) : (
            <Outlet />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Organization Settings Section
// ============================================================================

function OrganizationSettings() {
  const { data: settings, isLoading } = useOrganizationSettings();
  const updateSettings = useUpdateSettings();
  const { success, error: showError } = useToast();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: "",
    timezone: "UTC",
    defaultEnvironment: "production",
  });
  const [copied, setCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (isLoading) {
    return (
      <div className="card">
        <div className="card-body flex items-center justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateSettings.mutateAsync({
        name: formData.name || settings?.name,
      });
      success("Settings updated", "Organization settings saved successfully");
    } catch (err) {
      showError("Update failed", "Failed to update organization settings");
    }
  };

  const handleCopyOrgId = async () => {
    try {
      await navigator.clipboard.writeText(settings?.id || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      showError("Copy failed", "Failed to copy organization ID");
    }
  };

  const handleDeleteOrganization = async () => {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }

    try {
      // TODO: Call delete organization API
      // await deleteOrganization(settings?.id);
      success("Organization deleted", "Your organization has been deleted");
      // Redirect to sign up or landing page
      navigate("/signup");
    } catch (err) {
      showError("Delete failed", "Failed to delete organization");
    }
  };

  return (
    <div className="space-y-6">
      {/* Organization Info Card */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Organization Details
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Basic information about your organization
          </p>
        </div>
        <div className="card-body">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Organization Name
              </label>
              <input
                type="text"
                value={formData.name || settings?.name || ""}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                className="input max-w-md"
                placeholder="Your organization name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Organization ID
              </label>
              <div className="flex items-center gap-2">
                <code className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm font-mono">
                  {settings?.id || "org-xxxxx"}
                </code>
                <button
                  type="button"
                  className="btn btn-ghost text-sm"
                  onClick={handleCopyOrgId}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Timezone
              </label>
              <select
                value={formData.timezone}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, timezone: e.target.value }))
                }
                className="input max-w-md"
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">Eastern Time (US)</option>
                <option value="America/Los_Angeles">Pacific Time (US)</option>
                <option value="Europe/London">London</option>
                <option value="Europe/Paris">Paris</option>
                <option value="Asia/Tokyo">Tokyo</option>
              </select>
            </div>

            <div className="pt-4">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={updateSettings.isPending}
              >
                {updateSettings.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Plan & Usage Card */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Plan & Usage
          </h2>
        </div>
        <div className="card-body">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-gray-900 dark:text-white">
                  {settings?.plan?.toUpperCase() || "PRO"} Plan
                </span>
                <span className="badge badge-success">Active</span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {settings?.plan === "enterprise"
                  ? "Unlimited events and team members"
                  : `Up to ${settings?.limits?.eventsPerDay?.toLocaleString() ?? "1,000"} events/day`}
              </p>
            </div>
            <button className="btn btn-secondary">Upgrade Plan</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Events Today
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                156
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                of {settings?.limits?.eventsPerDay?.toLocaleString() ?? "1,000"}{" "}
                limit
              </p>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                LLM Tokens Today
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                245K
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                of{" "}
                {((settings?.limits.llmTokensPerDay || 500000) / 1000).toFixed(
                  0
                )}
                K limit
              </p>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Team Members
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                5
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                of {settings?.limits.usersAllowed} allowed
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="card border-red-200 dark:border-red-800">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">
            Danger Zone
          </h2>
        </div>
        <div className="card-body">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                Delete Organization
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Permanently delete this organization and all its data
              </p>
            </div>
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="btn bg-red-600 hover:bg-red-700 text-white"
              >
                Delete Organization
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteOrganization}
                  className="btn bg-red-600 hover:bg-red-700 text-white"
                >
                  Confirm Delete
                </button>
              </div>
            )}
          </div>
          {showDeleteConfirm && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">
                ⚠️ This action cannot be undone. All data will be permanently
                deleted.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Team Settings Section
// ============================================================================

function TeamSettings() {
  const toast = useToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const { data: teamData, isLoading, error } = useTeamMembers();
  const inviteMutation = useInviteMember();
  const updateRoleMutation = useUpdateMemberRole();
  const removeMutation = useRemoveMember();

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await inviteMutation.mutateAsync({
        email: inviteEmail,
        role: inviteRole,
        name: inviteName || undefined,
      });
      toast.success(
        "Invitation Sent",
        `Invited ${inviteEmail} as ${inviteRole}`
      );
      setInviteEmail("");
      setInviteName("");
      setInviteRole("member");
    } catch (err) {
      toast.error(
        "Invitation Failed",
        "Failed to send invitation. Please try again."
      );
    }
  };

  const handleRoleChange = async (
    memberId: string,
    newRole: "admin" | "member"
  ) => {
    try {
      await updateRoleMutation.mutateAsync({ memberId, role: newRole });
      toast.success("Role Updated", `Member role updated to ${newRole}`);
      setEditingMember(null);
    } catch (err) {
      toast.error(
        "Update Failed",
        "Failed to update role. Only owners can change roles."
      );
    }
  };

  const handleRemove = async (memberId: string) => {
    try {
      await removeMutation.mutateAsync(memberId);
      toast.success("Member Removed", "Team member has been removed");
      setConfirmRemove(null);
    } catch (err) {
      toast.error(
        "Remove Failed",
        "Failed to remove member. Check permissions."
      );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="card-body text-center py-8">
          <p className="text-red-500">Failed to load team members</p>
        </div>
      </div>
    );
  }

  const teamMembers = teamData?.members || [];

  return (
    <div className="space-y-6">
      {/* Invite Member Card */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Invite Team Member
          </h2>
        </div>
        <div className="card-body">
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="input"
                  required
                />
              </div>
              <div className="w-48">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name (optional)
                </label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="John Doe"
                  className="input"
                />
              </div>
            </div>
            <div className="flex gap-4 items-end">
              <div className="w-40">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(e.target.value as "admin" | "member")
                  }
                  className="input"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={inviteMutation.isPending}
              >
                {inviteMutation.isPending ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  "Send Invite"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Team Members List */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Team Members
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {teamMembers.length} member{teamMembers.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {teamMembers.map((member) => (
            <div
              key={member.id}
              className="p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-100 dark:bg-brand-900/30 rounded-full flex items-center justify-center">
                  <span className="text-brand-700 dark:text-brand-400 font-medium">
                    {(member.name || member.email)
                      .split(/[\s@]/)
                      .slice(0, 2)
                      .map((n) => n[0]?.toUpperCase())
                      .join("")}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {member.name || member.email.split("@")[0]}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {member.email}
                  </p>
                  {member.lastActiveAt && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Last active:{" "}
                      {new Date(member.lastActiveAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4">
                {editingMember === member.id && member.role !== "owner" ? (
                  <div className="flex items-center gap-2">
                    <select
                      defaultValue={member.role}
                      className="input text-sm py-1"
                      onChange={(e) =>
                        handleRoleChange(
                          member.id,
                          e.target.value as "admin" | "member"
                        )
                      }
                      disabled={updateRoleMutation.isPending}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      className="btn btn-ghost text-sm"
                      onClick={() => setEditingMember(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <span
                      className={cn(
                        "badge",
                        member.role === "owner"
                          ? "badge-info"
                          : member.role === "admin"
                            ? "badge-success"
                            : "badge-warning"
                      )}
                    >
                      {member.role}
                    </span>
                    {member.role !== "owner" && (
                      <>
                        <button
                          className="btn btn-ghost text-sm"
                          onClick={() => setEditingMember(member.id)}
                        >
                          Edit
                        </button>
                        {confirmRemove === member.id ? (
                          <div className="flex items-center gap-2">
                            <button
                              className="btn btn-ghost text-sm text-red-600 dark:text-red-400"
                              onClick={() => handleRemove(member.id)}
                              disabled={removeMutation.isPending}
                            >
                              {removeMutation.isPending ? "..." : "Confirm"}
                            </button>
                            <button
                              className="btn btn-ghost text-sm"
                              onClick={() => setConfirmRemove(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-ghost text-sm text-red-600 dark:text-red-400"
                            onClick={() => setConfirmRemove(member.id)}
                          >
                            Remove
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          {teamMembers.length === 0 && (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              No team members yet. Invite your first team member above.
            </div>
          )}
        </div>
      </div>

      {/* Role Permissions */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Role Permissions
          </h2>
        </div>
        <div className="card-body">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 font-medium text-gray-500 dark:text-gray-400">
                  Permission
                </th>
                <th className="text-center py-2 font-medium text-gray-500 dark:text-gray-400">
                  Owner
                </th>
                <th className="text-center py-2 font-medium text-gray-500 dark:text-gray-400">
                  Admin
                </th>
                <th className="text-center py-2 font-medium text-gray-500 dark:text-gray-400">
                  Member
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  name: "View Events & RCAs",
                  owner: true,
                  admin: true,
                  member: true,
                },
                {
                  name: "Manage Integrations",
                  owner: true,
                  admin: true,
                  member: false,
                },
                {
                  name: "Invite Members",
                  owner: true,
                  admin: true,
                  member: false,
                },
                {
                  name: "Change Member Roles",
                  owner: true,
                  admin: false,
                  member: false,
                },
                {
                  name: "Manage Billing",
                  owner: true,
                  admin: false,
                  member: false,
                },
                {
                  name: "Delete Organization",
                  owner: true,
                  admin: false,
                  member: false,
                },
              ].map((perm) => (
                <tr
                  key={perm.name}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="py-2 text-gray-700 dark:text-gray-300">
                    {perm.name}
                  </td>
                  <td className="py-2 text-center">
                    {perm.owner ? "✅" : "❌"}
                  </td>
                  <td className="py-2 text-center">
                    {perm.admin ? "✅" : "❌"}
                  </td>
                  <td className="py-2 text-center">
                    {perm.member ? "✅" : "❌"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Integrations Settings Section
// ============================================================================

function IntegrationsSettings() {
  const { data: integrations, isLoading, refetch } = useIntegrations();
  const connectMutation = useConnectIntegration();
  const disconnectMutation = useDisconnectIntegration();
  const [showSentryModal, setShowSentryModal] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<
    Array<{
      id: string;
      name: string;
      description: string;
      available: boolean;
      oauthRequired: boolean;
      icon: string;
    }>
  >([]);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Fetch available providers from platform
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await fetch("/api/integrations/available");
        if (response.ok) {
          const data = await response.json();
          setAvailableProviders(data.allProviders || []);
        }
      } catch {
        // Fallback to defaults if fetch fails
        setAvailableProviders([
          {
            id: "github",
            name: "GitHub",
            description: "Connect GitHub repositories for code analysis",
            available: true,
            oauthRequired: true,
            icon: "github",
          },
          {
            id: "slack",
            name: "Slack",
            description: "Receive RCA notifications in Slack",
            available: true,
            oauthRequired: true,
            icon: "slack",
          },
          {
            id: "sentry",
            name: "Sentry",
            description: "Receive error events from Sentry",
            available: true,
            oauthRequired: false,
            icon: "sentry",
          },
        ]);
      }
    };
    fetchProviders();
  }, []);

  // Handle URL params for OAuth callbacks
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");

    if (success) {
      const integrationName = success.replace("_connected", "").toUpperCase();
      setNotification({
        type: "success",
        message: `${integrationName} integration connected successfully!`,
      });
      window.history.replaceState({}, "", "/settings/integrations");
      refetch();
    } else if (error) {
      setNotification({
        type: "error",
        message: `Integration failed: ${error.replace(/_/g, " ")}`,
      });
      window.history.replaceState({}, "", "/settings/integrations");
    }
  }, [refetch]);

  if (isLoading) {
    return (
      <div className="card">
        <div className="card-body flex items-center justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  // Default integrations if none exist
  const defaultIntegrations = [
    { id: "sentry", type: "sentry", name: "Sentry", status: "disconnected" },
    { id: "github", type: "github", name: "GitHub", status: "disconnected" },
    { id: "slack", type: "slack", name: "Slack", status: "disconnected" },
    { id: "jira", type: "jira", name: "Jira", status: "disconnected" },
    {
      id: "teams",
      type: "teams",
      name: "Microsoft Teams",
      status: "disconnected",
    },
  ];

  const displayIntegrations = integrations ?? defaultIntegrations;

  // Helper to check if a provider is available at platform level
  const isProviderAvailable = (type: string) => {
    const provider = availableProviders.find(
      (p) => p.id === type || p.id === `${type}_app`
    );
    return provider?.available ?? true; // Default to true if not loaded yet
  };

  const handleConnect = async (type: string) => {
    if (type === "sentry") {
      setShowSentryModal(true);
    } else {
      // OAuth-based integrations - get auth URL from backend and redirect
      try {
        const data = await apiClient.get<{ authUrl: string; method?: string }>(
          `/integrations/${type}/connect`
        );

        if (data.authUrl) {
          // Redirect to OAuth provider
          window.location.href = data.authUrl;
        } else {
          setNotification({
            type: "error",
            message: "No authentication URL received",
          });
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to connect integration";
        setNotification({
          type: "error",
          message,
        });
      }
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await disconnectMutation.mutateAsync(id);
      setNotification({ type: "success", message: "Integration disconnected" });
      refetch();
    } catch {
      setNotification({
        type: "error",
        message: "Failed to disconnect integration",
      });
    }
  };

  const handleSentryConnect = async (config: {
    projectSlug: string;
    organizationSlug: string;
    dsn?: string;
  }) => {
    try {
      await connectMutation.mutateAsync({ type: "sentry", config });
      setShowSentryModal(false);
      setNotification({
        type: "success",
        message: "Sentry integration configured!",
      });
      refetch();
    } catch {
      setNotification({
        type: "error",
        message: "Failed to configure Sentry integration",
      });
    }
  };

  const getIntegrationDescription = (type: string) => {
    const descriptions: Record<string, string> = {
      sentry: "Receive error events and stack traces",
      github: "Fetch source code for analysis",
      slack: "Get RCA notifications in your channels",
      jira: "Create and link issues automatically",
      teams: "Get notifications in Microsoft Teams",
    };
    return descriptions[type] || "";
  };

  return (
    <div className="space-y-6">
      {/* Notification Banner */}
      {notification && (
        <div
          className={`p-4 rounded-lg flex items-center gap-3 ${
            notification.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
          }`}
        >
          {notification.type === "success" ? (
            <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
          ) : (
            <XCircleIcon className="w-5 h-5 text-red-600 dark:text-red-400" />
          )}
          <p
            className={
              notification.type === "success"
                ? "text-green-800 dark:text-green-200"
                : "text-red-800 dark:text-red-200"
            }
          >
            {notification.message}
          </p>
        </div>
      )}

      {/* Error Tracking */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Error Tracking
        </h2>
        <div className="space-y-4">
          {displayIntegrations
            .filter((i) => i.type === "sentry")
            .map((integration) => (
              <IntegrationCard
                key={integration.id}
                type={integration.type}
                name={integration.name}
                description={getIntegrationDescription(integration.type)}
                status={integration.status}
                available={isProviderAvailable(integration.type)}
                onConnect={() => handleConnect(integration.type)}
                onDisconnect={() => handleDisconnect(integration.id)}
              />
            ))}
        </div>
      </section>

      {/* Source Control */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Source Control
        </h2>
        <div className="space-y-4">
          {displayIntegrations
            .filter((i) => i.type === "github")
            .map((integration) => (
              <IntegrationCard
                key={integration.id}
                type={integration.type}
                name={integration.name}
                description={getIntegrationDescription(integration.type)}
                status={integration.status}
                available={isProviderAvailable(integration.type)}
                onConnect={() => handleConnect(integration.type)}
                onDisconnect={() => handleDisconnect(integration.id)}
              />
            ))}
        </div>
      </section>

      {/* Notifications */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Notifications
        </h2>
        <div className="space-y-4">
          {displayIntegrations
            .filter((i) => i.type === "slack" || i.type === "teams")
            .map((integration) => (
              <IntegrationCard
                key={integration.id}
                type={integration.type}
                name={integration.name}
                description={getIntegrationDescription(integration.type)}
                status={integration.status}
                available={isProviderAvailable(integration.type)}
                onConnect={() => handleConnect(integration.type)}
                onDisconnect={() => handleDisconnect(integration.id)}
              />
            ))}
        </div>
      </section>

      {/* Issue Tracking */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Issue Tracking
        </h2>
        <div className="space-y-4">
          {displayIntegrations
            .filter((i) => i.type === "jira")
            .map((integration) => (
              <IntegrationCard
                key={integration.id}
                type={integration.type}
                name={integration.name}
                description={getIntegrationDescription(integration.type)}
                status={integration.status}
                available={isProviderAvailable(integration.type)}
                onConnect={() => handleConnect(integration.type)}
                onDisconnect={() => handleDisconnect(integration.id)}
              />
            ))}
        </div>
      </section>

      {/* Sentry Configuration Modal */}
      {showSentryModal && (
        <SentryConfigModal
          onClose={() => setShowSentryModal(false)}
          onConnect={handleSentryConnect}
          isLoading={connectMutation.isPending}
        />
      )}
    </div>
  );
}

// Integration Card Component for Settings
function IntegrationCard({
  type,
  name,
  description,
  status,
  available = true,
  onConnect,
  onDisconnect,
}: {
  type: string;
  name: string;
  description: string;
  status: string;
  available?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const isConnected = status === "connected";

  const getIcon = () => {
    switch (type) {
      case "sentry":
        return "🔴";
      case "github":
      case "github_app":
        return "🐙";
      case "slack":
        return "💬";
      case "jira":
        return "🔷";
      case "teams":
        return "💜";
      default:
        return "🔌";
    }
  };

  return (
    <div className="card">
      <div className="card-body">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-2xl">
              {getIcon()}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {name}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {description}
              </p>
              {!available && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Not configured on this platform. Contact support.
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isConnected ? (
              <button
                className="btn btn-ghost text-red-600 dark:text-red-400"
                onClick={onDisconnect}
              >
                Disconnect
              </button>
            ) : available ? (
              <button className="btn btn-primary" onClick={onConnect}>
                Connect
              </button>
            ) : (
              <button className="btn btn-secondary" disabled>
                Unavailable
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Sentry Configuration Modal
function SentryConfigModal({
  onClose,
  onConnect,
  isLoading,
}: {
  onClose: () => void;
  onConnect: (config: {
    projectSlug: string;
    organizationSlug: string;
    dsn?: string;
  }) => void;
  isLoading: boolean;
}) {
  const [projectSlug, setProjectSlug] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [dsn, setDsn] = useState("");
  const [copied, setCopied] = useState(false);

  // Get orgId from auth store for webhook URL
  const user = useAuthStore((state) => state.user);
  const webhookUrl = `${window.location.origin}/api/v1/webhooks/sentry/${user?.orgId || "{YOUR_ORG_ID}"}`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConnect({ projectSlug, organizationSlug, dsn: dsn || undefined });
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4">
        <div className="p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Configure Sentry Integration
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Organization Slug
              </label>
              <input
                type="text"
                value={organizationSlug}
                onChange={(e) => setOrganizationSlug(e.target.value)}
                placeholder="my-organization"
                className="input w-full"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Project Slug
              </label>
              <input
                type="text"
                value={projectSlug}
                onChange={(e) => setProjectSlug(e.target.value)}
                placeholder="my-project"
                className="input w-full"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                DSN (Optional)
              </label>
              <input
                type="text"
                value={dsn}
                onChange={(e) => setDsn(e.target.value)}
                placeholder="https://xxx@sentry.io/xxx"
                className="input w-full"
              />
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Webhook URL (Add this to Sentry)
              </label>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={webhookUrl}
                  readOnly
                  className="input w-full text-sm bg-white dark:bg-gray-800 font-mono"
                />
                <button
                  type="button"
                  onClick={copyToClipboard}
                  className="btn btn-secondary flex items-center gap-1 whitespace-nowrap"
                >
                  <ClipboardDocumentIcon className="w-4 h-4" />
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                In Sentry: Go to{" "}
                <strong>
                  Settings → Integrations → Internal Integrations → Create New
                  Integration
                </strong>
                . Add this webhook URL under <strong>Webhooks</strong> and
                subscribe to <strong>error.created</strong> events.
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || !projectSlug || !organizationSlug}
                className="btn btn-primary flex-1"
              >
                {isLoading ? "Connecting..." : "Connect Sentry"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// API Keys Settings Section
// ============================================================================

function APIKeysSettings() {
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);

  // Mock API keys
  const apiKeys = [
    {
      id: "key-1",
      name: "Production API Key",
      prefix: "blk_prod_",
      createdAt: "2024-01-10T10:00:00Z",
      lastUsed: "2024-01-15T14:30:00Z",
      scopes: ["read:events", "read:rca"],
    },
    {
      id: "key-2",
      name: "CI/CD Pipeline",
      prefix: "blk_ci_",
      createdAt: "2024-01-05T09:00:00Z",
      lastUsed: null,
      scopes: ["read:events"],
    },
  ];

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    // Generate a mock key
    const key = `blk_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    setNewKeyValue(key);
  };

  return (
    <div className="space-y-6">
      {/* Create New Key Card */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            API Keys
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Manage API access for programmatic integrations
          </p>
        </div>
        <div className="card-body">
          {newKeyValue ? (
            <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">
                ✅ API Key Created! Copy it now - you won't see it again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 rounded-lg text-sm font-mono break-all">
                  {newKeyValue}
                </code>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    navigator.clipboard.writeText(newKeyValue);
                  }}
                >
                  Copy
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setNewKeyValue(null);
                    setNewKeyName("");
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateKey} className="flex gap-4">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g., Production API Key)"
                className="input flex-1"
                required
              />
              <button type="submit" className="btn btn-primary">
                Create API Key
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Existing Keys List */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Active Keys
          </h2>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {apiKeys.map((key) => (
            <div key={key.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {key.name}
                  </p>
                  <code className="text-sm text-gray-500 dark:text-gray-400 font-mono">
                    {key.prefix}••••••••
                  </code>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <span>
                      Created: {new Date(key.createdAt).toLocaleDateString()}
                    </span>
                    <span>
                      Last used:{" "}
                      {key.lastUsed
                        ? new Date(key.lastUsed).toLocaleDateString()
                        : "Never"}
                    </span>
                  </div>
                </div>
                <button className="btn btn-ghost text-red-600 dark:text-red-400 text-sm">
                  Revoke
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                {key.scopes.map((scope) => (
                  <span
                    key={scope}
                    className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs text-gray-600 dark:text-gray-400"
                  >
                    {scope}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API Documentation Link */}
      <div className="card bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-800">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-brand-900 dark:text-brand-100">
                API Documentation
              </h3>
              <p className="text-sm text-brand-700 dark:text-brand-300">
                Learn how to use the Buglens API for custom integrations
              </p>
            </div>
            <a
              href="/docs/api"
              className="btn bg-brand-600 hover:bg-brand-700 text-white"
            >
              View Docs →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Notification Settings Section
// ============================================================================

function NotificationSettings() {
  const { data: settings } = useOrganizationSettings();

  return (
    <div className="space-y-6">
      {/* Email Notifications */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Email Notifications
          </h2>
        </div>
        <div className="card-body space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                Enable Email Notifications
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Receive RCA summaries via email
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                defaultChecked={settings?.notifications?.email?.enabled}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-300 dark:peer-focus:ring-brand-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-brand-600" />
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Email Recipients
            </label>
            <input
              type="text"
              placeholder="Enter email addresses, separated by commas"
              className="input"
              defaultValue={settings?.notifications?.email?.addresses?.join(
                ", "
              )}
            />
          </div>
        </div>
      </div>

      {/* Slack Notifications */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Slack Notifications
          </h2>
        </div>
        <div className="card-body space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                Enable Slack Notifications
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Post RCA results to a Slack channel
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                defaultChecked={settings?.notifications?.slack?.enabled}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-300 dark:peer-focus:ring-brand-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-brand-600" />
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Default Channel
            </label>
            <input
              type="text"
              placeholder="#bugs"
              className="input max-w-xs"
              defaultValue={settings?.notifications?.slack?.channel}
            />
          </div>

          <div className="pt-4 space-y-3">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Notify when:
            </p>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300"
                defaultChecked={
                  settings?.notifications?.slack?.notifyOnComplete
                }
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                RCA analysis completes
              </span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300"
                defaultChecked={settings?.notifications?.slack?.notifyOnError}
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Analysis fails or encounters an error
              </span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300"
                defaultChecked
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Critical severity event received
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button className="btn btn-primary">Save Notification Settings</button>
      </div>
    </div>
  );
}

// ============================================================================
// Profile Settings Section
// ============================================================================

function ProfileSettings() {
  const toast = useToast();
  const { data: profileData, isLoading: profileLoading } = useProfile();
  const { isLoading: notifLoading } = useNotificationPreferences();
  const updateProfileMutation = useUpdateProfile();
  const changePasswordMutation = useChangePassword();
  // TODO: Add notification preferences UI using useUpdateNotificationPreferences
  const deleteAccountMutation = useDeleteAccount();

  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Initialize form with profile data
  useEffect(() => {
    if (profileData?.profile) {
      setName(profileData.profile.name || "");
      setAvatarUrl(profileData.profile.avatarUrl || "");
    }
  }, [profileData]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfileMutation.mutateAsync({
        name: name || undefined,
        avatarUrl: avatarUrl || null,
      });
      toast.success("Profile Updated", "Your profile has been updated");
    } catch {
      toast.error("Update Failed", "Failed to update profile");
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Password Mismatch", "New passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error(
        "Password Too Short",
        "Password must be at least 8 characters"
      );
      return;
    }
    try {
      await changePasswordMutation.mutateAsync({
        currentPassword,
        newPassword,
      });
      toast.success("Password Changed", "Your password has been updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      toast.error("Change Failed", "Failed to change password");
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await deleteAccountMutation.mutateAsync();
      toast.success("Account Deleted", "Your account has been deleted");
      // Redirect to login after deletion
      window.location.href = "/login";
    } catch {
      toast.error("Delete Failed", "Failed to delete account");
    }
  };

  if (profileLoading || notifLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const profile = profileData?.profile;
  const isOAuthUser = profile?.authProvider && profile.authProvider !== "email";

  return (
    <div className="space-y-6">
      {/* Profile Information */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Profile Information
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Update your personal information
          </p>
        </div>
        <div className="card-body">
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={profile?.email || ""}
                disabled
                className="input w-full bg-gray-100 dark:bg-gray-800 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">
                Email cannot be changed
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your full name"
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Avatar URL
              </label>
              <input
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/avatar.png"
                className="input w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter a URL to your profile picture
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={updateProfileMutation.isPending}
              >
                {updateProfileMutation.isPending ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  "Save Changes"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Account Details */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Account Details
          </h2>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">Role:</span>
              <span className="ml-2 font-medium text-gray-900 dark:text-white capitalize">
                {profile?.role || "member"}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">
                Auth Provider:
              </span>
              <span className="ml-2 font-medium text-gray-900 dark:text-white capitalize">
                {profile?.authProvider || "email"}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">
                Email Verified:
              </span>
              <span
                className={`ml-2 font-medium ${profile?.emailVerified ? "text-green-600" : "text-yellow-600"}`}
              >
                {profile?.emailVerified ? "Yes" : "No"}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">
                Member Since:
              </span>
              <span className="ml-2 font-medium text-gray-900 dark:text-white">
                {profile?.createdAt
                  ? new Date(profile.createdAt).toLocaleDateString()
                  : "-"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Change Password (only for email users) */}
      {!isOAuthUser && (
        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Change Password
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Update your account password
            </p>
          </div>
          <div className="card-body">
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="input w-full"
                  required
                  minLength={8}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="input w-full"
                  required
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={changePasswordMutation.isPending}
                >
                  {changePasswordMutation.isPending ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    "Change Password"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isOAuthUser && (
        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Password
            </h2>
          </div>
          <div className="card-body">
            <p className="text-gray-500 dark:text-gray-400">
              Your account is linked to {profile?.authProvider}. Password
              management is handled by your OAuth provider.
            </p>
          </div>
        </div>
      )}

      {/* Danger Zone */}
      <div className="card border-red-200 dark:border-red-900">
        <div className="card-header bg-red-50 dark:bg-red-900/20">
          <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">
            Danger Zone
          </h2>
          <p className="text-sm text-red-500 dark:text-red-400">
            Irreversible actions
          </p>
        </div>
        <div className="card-body">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                Delete Account
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Permanently delete your account and all associated data
              </p>
            </div>
            <button
              className="btn bg-red-600 hover:bg-red-700 text-white"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete Account
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Confirm Account Deletion
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to delete your account? This action cannot
              be undone and all your data will be permanently removed.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="btn btn-secondary"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="btn bg-red-600 hover:bg-red-700 text-white"
                onClick={handleDeleteAccount}
                disabled={deleteAccountMutation.isPending}
              >
                {deleteAccountMutation.isPending ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  "Delete Account"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Billing Settings Section
// ============================================================================

function BillingSettings() {
  const toast = useToast();
  const { data: billingData, isLoading, error } = useBillingUsage();
  const upgradeMutation = useUpgradePlan();

  const handleUpgrade = async (plan: "free" | "pro" | "enterprise") => {
    if (plan === "enterprise") {
      // Open contact sales page or modal
      window.open(
        "mailto:sales@buglens.io?subject=Enterprise%20Plan%20Inquiry",
        "_blank"
      );
      return;
    }

    try {
      await upgradeMutation.mutateAsync(plan);
      toast.success(
        "Plan Updated",
        `Successfully switched to ${plan.toUpperCase()} plan`
      );
    } catch (err) {
      toast.error(
        "Upgrade Failed",
        "Failed to upgrade plan. Please try again."
      );
    }
  };

  const currentPlan = billingData?.plan || "free";

  const plans = [
    {
      id: "free" as const,
      name: "Free",
      price: 0,
      features: [
        `${billingData?.limits?.eventsPerDay || 100} events/day`,
        `${((billingData?.limits?.llmTokensPerDay || 50000) / 1000).toFixed(0)}K LLM tokens/day`,
        `${billingData?.limits?.usersAllowed || 3} team members`,
        "7-day history",
      ],
      current: currentPlan === "free",
    },
    {
      id: "pro" as const,
      name: "Pro",
      price: 49,
      features: [
        "1,000 events/day",
        "500K LLM tokens/day",
        "10 team members",
        "30-day history",
        "Priority support",
      ],
      current: currentPlan === "pro",
      recommended: true,
    },
    {
      id: "enterprise" as const,
      name: "Enterprise",
      price: null,
      features: [
        "Unlimited events",
        "Unlimited LLM tokens",
        "Unlimited team members",
        "Unlimited history",
        "SLA guarantee",
        "Dedicated support",
      ],
      current: currentPlan === "enterprise",
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="card-body text-center py-8">
          <p className="text-red-500">Failed to load billing information</p>
        </div>
      </div>
    );
  }

  const priceMap: Record<string, number> = { free: 0, pro: 49, enterprise: 0 };

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Current Plan
          </h2>
        </div>
        <div className="card-body">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xl font-bold text-gray-900 dark:text-white">
                {currentPlan.toUpperCase()} Plan
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {currentPlan === "free"
                  ? "No billing"
                  : "Billed monthly • Next billing date: Feb 1, 2024"}
              </p>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {currentPlan === "enterprise"
                ? "Custom"
                : `$${priceMap[currentPlan]}`}
              {currentPlan !== "enterprise" && currentPlan !== "free" && (
                <span className="text-sm font-normal">/month</span>
              )}
            </p>
          </div>

          {/* Usage Stats */}
          {billingData?.usage && billingData?.limits && (
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {billingData.usage.eventsToday?.toLocaleString() || 0}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Events Today /{" "}
                  {billingData.limits.eventsPerDay?.toLocaleString() || "100"}
                </p>
              </div>
              <div className="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {((billingData.usage.llmTokensToday || 0) / 1000).toFixed(1)}K
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Tokens Today /{" "}
                  {(
                    (billingData.limits.llmTokensPerDay || 50000) / 1000
                  ).toFixed(0)}
                  K
                </p>
              </div>
              <div className="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {billingData.usage.teamMembers || 0}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Team Members / {billingData.limits.usersAllowed || 3}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Plan Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={cn(
              "card relative",
              plan.recommended && "ring-2 ring-brand-500",
              plan.current && "bg-brand-50 dark:bg-brand-900/20"
            )}
          >
            {plan.recommended && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-brand-500 text-white text-xs font-medium px-2 py-1 rounded-full">
                  Recommended
                </span>
              </div>
            )}
            <div className="card-body">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {plan.name}
              </h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
                {plan.price === null ? (
                  "Custom"
                ) : plan.price === 0 ? (
                  "Free"
                ) : (
                  <>
                    ${plan.price}
                    <span className="text-sm font-normal text-gray-500">
                      /mo
                    </span>
                  </>
                )}
              </p>
              <ul className="mt-4 space-y-2">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
                  >
                    <span className="text-green-500">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                className={cn(
                  "btn w-full mt-6",
                  plan.current
                    ? "btn-secondary"
                    : plan.recommended
                      ? "btn-primary"
                      : "btn-secondary"
                )}
                disabled={plan.current || upgradeMutation.isPending}
                onClick={() => handleUpgrade(plan.id)}
              >
                {upgradeMutation.isPending ? (
                  <LoadingSpinner size="sm" />
                ) : plan.current ? (
                  "Current Plan"
                ) : plan.price === null ? (
                  "Contact Sales"
                ) : (
                  "Upgrade"
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Payment Method */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Payment Method
          </h2>
        </div>
        <div className="card-body">
          {currentPlan === "free" ? (
            <p className="text-gray-500 dark:text-gray-400">
              No payment method required for free plan
            </p>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-8 bg-gradient-to-r from-blue-600 to-blue-800 rounded flex items-center justify-center">
                  <span className="text-white text-xs font-bold">VISA</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    •••• •••• •••• 4242
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Expires 12/25
                  </p>
                </div>
              </div>
              <button className="btn btn-secondary">Update Card</button>
            </div>
          )}
        </div>
      </div>

      {/* Billing History */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Billing History
          </h2>
        </div>
        {currentPlan === "free" ? (
          <div className="card-body">
            <p className="text-gray-500 dark:text-gray-400">
              No billing history for free plan
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {[
              { date: "Jan 1, 2024", amount: 49.0, status: "Paid" },
              { date: "Dec 1, 2023", amount: 49.0, status: "Paid" },
              { date: "Nov 1, 2023", amount: 49.0, status: "Paid" },
            ].map((invoice, i) => (
              <div key={i} className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {invoice.date}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}{" "}
                    Plan
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="badge badge-success">{invoice.status}</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    ${invoice.amount.toFixed(2)}
                  </span>
                  <button className="btn btn-ghost text-sm">Download</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsPage;
