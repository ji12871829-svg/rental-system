// Portal shell — sidebar layout mirroring the staff app's Layout, with
// tenant-focused navigation (Home, Payments, Water, Statement). No staff
// routes leak in: this renders only inside /portal routes.

import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { CreditCard, Droplets, FileText, Home, LogOut, Menu, X } from 'lucide-react';
import { usePortalAuth } from '../../lib/portalAuth';
import { branding } from '../../lib/branding';
import { BrandLogo } from '../../components/BrandLogo';
import { ThemeToggle } from '../../components/ThemeToggle';

const navItems = [
  { to: '/portal', label: 'Home', icon: Home, end: true },
  { to: '/portal/payments', label: 'Payments', icon: CreditCard },
  { to: '/portal/water', label: 'Water', icon: Droplets },
  { to: '/portal/statement', label: 'Statement', icon: FileText },
];

export default function PortalLayout() {
  const { tenant, logout } = usePortalAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {navItems.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            `flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-[background-color,color,transform] duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] ${
              isActive
                ? 'bg-brand-500 text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/5 hover:text-white'
            }`
          }
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </NavLink>
      ))}
      <button
        onClick={async () => {
          // Full-page redirect, not navigate(): the auth guards are keyed on
          // the auth state that logout() just cleared, so during the lazy
          // /landing load React can re-run RequirePortalAuth/RequireAuth and
          // yank the signed-out user back to a login form. A hard redirect
          // sidesteps the SPA transition entirely — same idiom the http
          // client uses for session loss. Landing is public, so it always
          // renders the signed-out marketing shell.
          await logout();
          window.location.href = '/landing';
        }}
        className="mt-auto flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm font-medium text-gray-400 transition-[background-color,color,transform] duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover:bg-white/5 hover:text-white active:scale-[0.98]"
      >
        <LogOut className="h-4 w-4 shrink-0" />
        Sign out
      </button>
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-ink md:flex">
        <div className="flex items-center gap-2 px-4 py-5">
          <BrandLogo className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white" iconSize={16} />
          <div>
            <p className="text-sm font-semibold text-white">Tenant Portal</p>
            {/* The operator's real business name — 'RMS' was a pre-rebrand
                leftover the landing redesign's identity rules surfaced. */}
            <p className="text-xs text-gray-400">{branding.appName}</p>
          </div>
        </div>
        {nav}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-gray-900/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-ink shadow-xl">
            <div className="flex items-center justify-between px-4 py-5">
              <div className="flex items-center gap-2">
                <BrandLogo className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white" iconSize={16} />
                <p className="text-sm font-semibold text-white">Tenant Portal</p>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <p className="text-sm font-semibold text-gray-900">Tenant Portal</p>
          <ThemeToggle />
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>

        <footer className="border-t border-gray-200 px-4 py-4 text-center text-xs text-gray-400 md:px-8">
          Signed in as {tenant?.name} · {tenant?.email ?? ''}
        </footer>
      </div>
    </div>
  );
}
