import { NavLink, useLocation } from "react-router-dom";
import {
  HomeIcon,
  ExclamationCircleIcon,
  Cog6ToothIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore, useUserRole } from "@/store/auth";
import Logo, { LogoIcon } from "@/components/ui/Logo";

interface SidebarProps {
  isOpen: boolean;
  isCollapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: HomeIcon },
  { name: "Events", href: "/events", icon: ExclamationCircleIcon },
  { name: "Settings", href: "/settings", icon: Cog6ToothIcon },
];

// Admin navigation item - shown only to admin/owner roles
const adminNavItem = { name: "Admin", href: "/admin", icon: ShieldCheckIcon };

/**
 * Sidebar navigation component
 * Supports collapsed state and mobile slide-out
 */
function Sidebar({
  isOpen,
  isCollapsed,
  onClose,
  onToggleCollapse,
}: SidebarProps) {
  const location = useLocation();
  const { organization, user } = useAuthStore();

  return (
    <>
      {/* Mobile sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-zinc-900
          border-r border-gray-200 dark:border-zinc-800
          transform transition-transform duration-300 ease-in-out
          lg:hidden
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-zinc-800">
          <SidebarLogo collapsed={false} />
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>
        <SidebarContent
          collapsed={false}
          organization={organization}
          user={user}
          currentPath={location.pathname}
        />
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`
          hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:flex lg:flex-col
          bg-white dark:bg-zinc-900
          border-r border-gray-200 dark:border-zinc-800
          transition-all duration-300
          ${isCollapsed ? "lg:w-20" : "lg:w-64"}
        `}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-zinc-800">
          <SidebarLogo collapsed={isCollapsed} />
          {!isCollapsed && (
            <button
              onClick={onToggleCollapse}
              className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800"
            >
              <ChevronLeftIcon className="w-5 h-5" />
            </button>
          )}
        </div>

        {isCollapsed && (
          <button
            onClick={onToggleCollapse}
            className="absolute -right-3 top-20 p-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-full shadow-sm hover:bg-gray-50 dark:hover:bg-zinc-800"
          >
            <ChevronRightIcon className="w-4 h-4 text-gray-500" />
          </button>
        )}

        <SidebarContent
          collapsed={isCollapsed}
          organization={organization}
          user={user}
          currentPath={location.pathname}
        />
      </aside>
    </>
  );
}

/**
 * Sidebar logo with collapsed state support
 */
function SidebarLogo({ collapsed }: { collapsed: boolean }) {
  return (
    <NavLink to="/dashboard" className="flex items-center gap-2">
      {collapsed ? <LogoIcon size="md" /> : <Logo size="md" showText={true} />}
    </NavLink>
  );
}

/**
 * Sidebar content with navigation links and org selector
 */
function SidebarContent({
  collapsed,
  organization,
  user,
  currentPath,
}: {
  collapsed: boolean;
  organization: { id: string; name: string; plan: string } | null;
  user: {
    name: string;
    email: string;
    avatarUrl?: string;
    role?: "owner" | "admin" | "member";
  } | null;
  currentPath: string;
}) {
  // Check if user has admin access
  const role = useUserRole();
  const isAdminOrOwner = role === "admin" || role === "owner";

  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      {/* Organization selector */}
      {organization && !collapsed && (
        <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-800">
          <div className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Organization
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gray-200 dark:bg-zinc-800 rounded-lg flex items-center justify-center">
              <span className="text-sm font-medium text-gray-600 dark:text-zinc-300">
                {organization.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {organization.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-zinc-400 capitalize">
                {organization.plan} plan
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navigation.map((item) => {
          const isActive =
            item.href === "/"
              ? currentPath === "/"
              : currentPath.startsWith(item.href);

          return (
            <NavLink
              key={item.name}
              to={item.href}
              className={`
                sidebar-link
                ${isActive ? "active" : ""}
                ${collapsed ? "justify-center px-2" : ""}
              `}
              title={collapsed ? item.name : undefined}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.name}</span>}
            </NavLink>
          );
        })}

        {/* Admin link - only shown to admin/owner users */}
        {isAdminOrOwner && (
          <>
            <div className="my-2 border-t border-gray-200 dark:border-zinc-800" />
            <NavLink
              to={adminNavItem.href}
              className={`
                sidebar-link
                ${currentPath.startsWith("/admin") ? "active" : ""}
                ${collapsed ? "justify-center px-2" : ""}
                text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10
              `}
              title={collapsed ? adminNavItem.name : undefined}
            >
              <adminNavItem.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{adminNavItem.name}</span>}
            </NavLink>
          </>
        )}
      </nav>

      {/* User info */}
      {user && (
        <div
          className={`
          border-t border-gray-200 dark:border-zinc-800 p-4
          ${collapsed ? "flex justify-center" : ""}
        `}
        >
          {collapsed ? (
            <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center">
              <span className="text-zinc-900 text-sm font-medium">
                {user.name.charAt(0).toUpperCase()}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center">
                <span className="text-zinc-900 text-sm font-medium">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {user.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-zinc-400 truncate">
                  {user.email}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Sidebar;
