import { LogOut, User as UserIcon } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export type AppRoute = 'studio' | 'dictionary' | 'history' | 'settings';

interface TopNavProps {
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

const NAV_ITEMS: Array<{ id: AppRoute; label: string }> = [
  { id: 'studio', label: 'Studio' },
  { id: 'dictionary', label: 'Dictionary' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

export function TopNav({ activeRoute, onNavigate }: TopNavProps) {
  const { user, signInWithGoogle, signOut } = useAuth();

  return (
    <header className="w-full border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onNavigate('studio')}
          className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-700"
        >
          Clon
        </button>

        <nav className="hidden md:flex items-center gap-7" aria-label="Primary Navigation">
          {NAV_ITEMS.map((item) => {
            const active = activeRoute === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-2 focus-visible:outline-blue-700 ${
                  active
                    ? 'text-blue-700 dark:text-blue-400 border-blue-700 dark:border-blue-400'
                    : 'text-neutral-500 dark:text-neutral-400 border-transparent hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-xs font-medium text-neutral-800 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-900 whitespace-nowrap shrink-0"
              >
                <UserIcon className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
                <span className="max-w-[140px] truncate">{user.displayName || user.email}</span>
              </button>
              <button
                type="button"
                onClick={signOut}
                title="Sign Out"
                className="p-2 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={signInWithGoogle}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-blue-700 text-white hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
            >
              Sign In
            </button>
          )}
        </div>
      </div>

      <nav
        className="flex md:hidden items-center gap-5 px-4 pb-2.5 pt-2 overflow-x-auto border-t border-neutral-100 dark:border-neutral-900"
        aria-label="Mobile Navigation"
      >
        {NAV_ITEMS.map((item) => {
          const active = activeRoute === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`text-xs font-medium whitespace-nowrap shrink-0 pb-0.5 border-b-2 ${
                active
                  ? 'text-blue-700 dark:text-blue-400 border-blue-700 dark:border-blue-400'
                  : 'text-neutral-500 dark:text-neutral-400 border-transparent'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
