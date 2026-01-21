import { Fragment } from "react";
import { Menu, Transition } from "@headlessui/react";
import {
  Bars3Icon,
  BellIcon,
  MagnifyingGlassIcon,
  SunIcon,
  MoonIcon,
  ComputerDesktopIcon,
  ArrowRightOnRectangleIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { useTheme } from "@/components/theme-provider";
import { useAuthStore } from "@/store/auth";

interface HeaderProps {
  onMenuClick: () => void;
}

/**
 * Header component with search, theme toggle, notifications, and user menu
 */
function Header({ onMenuClick }: HeaderProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { user, logout } = useAuthStore();

  return (
    <header className="sticky top-0 z-40 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800">
      <div className="flex items-center justify-between h-16 px-4 sm:px-6">
        {/* Left: Menu button (mobile) and search */}
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="lg:hidden p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <Bars3Icon className="w-6 h-6" />
          </button>

          {/* Search bar */}
          <div className="hidden sm:flex items-center">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search events..."
                className="input pl-10 pr-4 py-2 w-64 lg:w-80"
              />
            </div>
          </div>
        </div>

        {/* Right: Theme toggle, notifications, user menu */}
        <div className="flex items-center gap-2">
          {/* Theme toggle dropdown */}
          <ThemeDropdown
            theme={theme}
            setTheme={setTheme}
            resolvedTheme={resolvedTheme}
          />

          {/* Notifications */}
          <button className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 relative">
            <BellIcon className="w-6 h-6" />
            {/* Notification badge */}
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
          </button>

          {/* User menu */}
          <UserMenu user={user} onLogout={logout} />
        </div>
      </div>
    </header>
  );
}

/**
 * Theme toggle dropdown component
 */
function ThemeDropdown({
  theme,
  setTheme,
  resolvedTheme,
}: {
  theme: string;
  setTheme: (theme: "light" | "dark" | "system") => void;
  resolvedTheme: "light" | "dark";
}) {
  const themeOptions = [
    { value: "light" as const, label: "Light", icon: SunIcon },
    { value: "dark" as const, label: "Dark", icon: MoonIcon },
    { value: "system" as const, label: "System", icon: ComputerDesktopIcon },
  ];

  return (
    <Menu as="div" className="relative">
      <Menu.Button className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
        {resolvedTheme === "dark" ? (
          <MoonIcon className="w-6 h-6" />
        ) : (
          <SunIcon className="w-6 h-6" />
        )}
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="dropdown-menu right-0 mt-2">
          {themeOptions.map((option) => (
            <Menu.Item key={option.value}>
              {({ active }) => (
                <button
                  onClick={() => setTheme(option.value)}
                  className={`
                    dropdown-item flex items-center gap-2
                    ${active ? "bg-gray-100 dark:bg-gray-700" : ""}
                    ${theme === option.value ? "text-brand-600 dark:text-brand-400" : ""}
                  `}
                >
                  <option.icon className="w-5 h-5" />
                  {option.label}
                  {theme === option.value && (
                    <span className="ml-auto text-brand-600 dark:text-brand-400">
                      ✓
                    </span>
                  )}
                </button>
              )}
            </Menu.Item>
          ))}
        </Menu.Items>
      </Transition>
    </Menu>
  );
}

/**
 * User menu dropdown component
 */
function UserMenu({
  user,
  onLogout,
}: {
  user: { name: string; email: string; avatarUrl?: string } | null;
  onLogout: () => void;
}) {
  if (!user) return null;

  return (
    <Menu as="div" className="relative">
      <Menu.Button className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
        <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            <span className="text-white text-sm font-medium">
              {user.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <span className="hidden md:block text-sm font-medium text-gray-700 dark:text-gray-200">
          {user.name}
        </span>
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="dropdown-menu right-0 mt-2 w-56">
          {/* User info */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {user.name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {user.email}
            </p>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <Menu.Item>
              {({ active }) => (
                <a
                  href="/settings/profile"
                  className={`dropdown-item flex items-center gap-2 ${
                    active ? "bg-gray-100 dark:bg-gray-700" : ""
                  }`}
                >
                  <UserCircleIcon className="w-5 h-5" />
                  Profile Settings
                </a>
              )}
            </Menu.Item>
          </div>

          {/* Logout */}
          <div className="py-1 border-t border-gray-200 dark:border-gray-700">
            <Menu.Item>
              {({ active }) => (
                <button
                  onClick={onLogout}
                  className={`dropdown-item flex items-center gap-2 text-red-600 dark:text-red-400 w-full ${
                    active ? "bg-gray-100 dark:bg-gray-700" : ""
                  }`}
                >
                  <ArrowRightOnRectangleIcon className="w-5 h-5" />
                  Sign out
                </button>
              )}
            </Menu.Item>
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  );
}

export default Header;
