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
  CheckCircleIcon,
  XCircleIcon,
  ClipboardDocumentIcon,
} from "@heroicons/react/24/outline";
import { cn } from "@/lib/utils";
import { apiClient, BASE_URL } from "@/lib/api-client";
import { useAuthStore } from "@/store/auth";
import {
  useOrganizationSettings,
  useUpdateSettings,
  useBillingUsage,
  useIntegrations,
  useDisconnectIntegration,
  useTeamMembers,
  useInviteMember,
  useUpdateMemberRole,
  useRemoveMember,
  useProfile,
  useUpdateProfile,
  useChangePassword,
  useDeleteAccount,
} from "@/lib/hooks";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { useToast } from "@/components/ui/toaster";

// Settings navigation items
const settingsNav = [
  { name: "Profile", href: "/settings/profile" },
  { name: "Organization", href: "/settings" },
  { name: "Team", href: "/settings/team" },
  { name: "Integrations", href: "/settings/integrations" },
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

      {/* Tab Navigation */}
      <nav className="flex border-b border-gray-200 dark:border-gray-700">
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
                "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                isActive
                  ? "border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              )}
            >
              {item.name}
            </NavLink>
          );
        })}
      </nav>

      {/* Settings Content */}
      <div>
        {location.pathname === "/settings" ? (
          <OrganizationSettings />
        ) : location.pathname === "/settings/profile" ? (
          <ProfileSettings />
        ) : location.pathname === "/settings/team" ? (
          <TeamSettings />
        ) : location.pathname === "/settings/integrations" ? (
          <IntegrationsSettings />
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Organization Settings Section
// ============================================================================

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function OrganizationSettings() {
  const { data: settings, isLoading } = useOrganizationSettings();
  const { data: billing, isLoading: billingLoading } = useBillingUsage();
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
              <p className="text-sm text-gray-500 dark:text-gray-400">Events Today</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {billingLoading ? "—" : (billing?.usage?.eventsToday ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                of {(billing?.limits?.eventsPerDay ?? settings?.limits?.eventsPerDay ?? 0).toLocaleString()} limit
              </p>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-sm text-gray-500 dark:text-gray-400">LLM Tokens Today</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {billingLoading ? "—" : formatTokens(billing?.usage?.llmTokensToday ?? 0)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                of {formatTokens(billing?.limits?.llmTokensPerDay ?? settings?.limits?.llmTokensPerDay ?? 0)} limit
              </p>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-sm text-gray-500 dark:text-gray-400">Team Members</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {billingLoading ? "—" : billing?.usage?.teamMembers ?? "—"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                of {billing?.limits?.usersAllowed ?? settings?.limits?.usersAllowed ?? "—"} allowed
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
  const disconnectMutation = useDisconnectIntegration();
  const [showSentryModal, setShowSentryModal] = useState(false);
  const [sentryConfiguring, setSentryConfiguring] = useState(false);
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
        const data = await apiClient.get<{
          allProviders: Array<{
            id: string;
            name: string;
            description: string;
            available: boolean;
            oauthRequired: boolean;
            icon: string;
          }>;
        }>("/integrations/available");
        setAvailableProviders(data.allProviders || []);
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
    authToken?: string;
  }) => {
    setSentryConfiguring(true);
    try {
      const useMockData = import.meta.env.VITE_USE_MOCK_DATA === "true";

      if (useMockData) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      } else {
        // Hit the dedicated /integrations/sentry/configure endpoint instead of
        // the generic /integrations/:type/connect. The dedicated handler
        // normalizes camelCase to snake_case, validates the api_base_url, and
        // splits the auth token into encrypted storage.
        await apiClient.post("/integrations/sentry/configure", config);
      }

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
    } finally {
      setSentryConfiguring(false);
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
            .filter((i) => i.type === "slack")
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
          isLoading={sentryConfiguring}
        />
      )}
    </div>
  );
}

function BrandIcon({ type, className }: { type: string; className?: string }) {
  switch (type) {
    case "github":
    case "github_app":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
      );
    case "slack":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" />
        </svg>
      );
    case "sentry":
      return (
        <svg viewBox="0 0 72 66" fill="currentColor" className={className}>
          <path d="M29.426 2.565a7.89 7.89 0 00-13.642 0L.733 29.398A45.462 45.462 0 0039.97 63.433h6.327a7.879 7.879 0 006.822-3.944l1.4-2.428a37.54 37.54 0 01-22.317-18.105l7.189-12.448a7.826 7.826 0 001.061-3.9c0-4.354-3.53-7.883-7.88-7.883a7.87 7.87 0 00-3.146.65zM66.64 56.05L46.31 20.86a7.84 7.84 0 00-2.91-2.95l-5.52 9.56a37.6 37.6 0 0115.72 31.94h4.22a7.88 7.88 0 006.82-13.36z" />
        </svg>
      );
    case "jira":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path d="M11.571 11.513H0a5.218 5.218 0 005.232 5.215h2.13v2.057A5.215 5.215 0 0012.575 24V12.518a1.005 1.005 0 00-1.004-1.005zm5.723-5.756H5.736a5.215 5.215 0 005.215 5.214h2.129v2.058a5.218 5.218 0 005.215 5.214V6.762a1.005 1.005 0 00-1.001-1.005zM23.013 0H11.455a5.215 5.215 0 005.215 5.215h2.129v2.057A5.215 5.215 0 0024 12.483V1.005A1.001 1.001 0 0023.013 0z" />
        </svg>
      );
    case "teams":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path d="M20.625 6.375a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0zM14.25 9H21a1.5 1.5 0 011.5 1.5v5.25a3.75 3.75 0 01-3.75 3.75h-.273A5.253 5.253 0 0114.25 21V9zm-1.5 0H3a1.5 1.5 0 00-1.5 1.5v6A5.25 5.25 0 006.75 21.75h4.5A5.25 5.25 0 0016.5 16.5v-6A1.5 1.5 0 0015 9h-2.25zM9 8.25a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
        </svg>
      );
  }
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

  return (
    <div className="card">
      <div className="card-body">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-gray-100 dark:bg-zinc-800">
              <BrandIcon type={type} className="w-5 h-5" />
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
    authToken?: string;
  }) => void;
  isLoading: boolean;
}) {
  const [projectSlug, setProjectSlug] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [dsn, setDsn] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [copied, setCopied] = useState(false);

  // Get orgId from auth store for webhook URL
  const user = useAuthStore((state) => state.user);
  const webhookUrl = `${BASE_URL}/api/v1/webhooks/sentry/${user?.orgId || "{YOUR_ORG_ID}"}`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConnect({
      projectSlug,
      organizationSlug,
      dsn: dsn || undefined,
      authToken: authToken || undefined,
    });
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

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Auth Token (Optional)
              </label>
              <input
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="sntrys_..."
                className="input w-full font-mono"
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Required only if you upload source maps to Sentry. Create at{" "}
                <strong>Settings → Account → Auth Tokens</strong> with the{" "}
                <code>project:releases</code> scope.
              </p>
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
// Profile Settings Section
// ============================================================================

function ProfileSettings() {
  const toast = useToast();
  const { data: profileData, isLoading: profileLoading } = useProfile();
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

  if (profileLoading) {
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



export default SettingsPage;
