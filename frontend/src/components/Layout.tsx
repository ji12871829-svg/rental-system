import { useEffect, useState } from 'react';
import { BrandMark } from './BrandMark';
import { Suspense } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeftRight, BarChart3, BookOpen, BookUser, Building2, CalendarDays,
  ChevronDown, Droplets, FileBarChart, FileText, Gauge, LayoutDashboard, Loader2, LogOut, Mail, Menu, ReceiptText, Settings,
  Smartphone, Ticket, Users as UsersIcon, Wallet, X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { branding } from '../lib/branding';
import { useBranding } from '../lib/BrandingContext';
import BrandingBanner from './BrandingBanner';

// One icon set (lucide), one stroke weight (1.75), recolored via currentColor.
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  managerOnly?: boolean;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/units', label: 'Units', icon: Building2 },
      { to: '/tenants', label: 'Tenants', icon: ArrowLeftRight },
      { to: '/rent', label: 'Rent Collection', icon: Wallet },
      { to: '/water-meter', label: 'Water Meter', icon: Gauge },
      { to: '/water-payments', label: 'Water Payments', icon: Droplets },
      { to: '/water-supply', label: 'Water Supply Costs', icon: FileBarChart },
      { to: '/ledger', label: 'Tenant Ledger', icon: BookUser },
      { to: '/monthly', label: 'Monthly Summary', icon: CalendarDays },
      { to: '/expenses', label: 'Expenses', icon: ReceiptText },
      { to: '/arrears', label: 'Arrears', icon: AlertTriangle },
      { to: '/receipts', label: 'Receipts', icon: Ticket },
      { to: '/sms', label: 'SMS Notifications', icon: Smartphone },
      { to: '/email-campaign', label: 'Tenant Email', icon: Mail, managerOnly: true },
    ],
  },
  {
    title: 'Management',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/users', label: 'Users', icon: UsersIcon, adminOnly: true },
      { to: '/audit', label: 'Audit Logs', icon: FileText, adminOnly: true },
      { to: '/privacy-register', label: 'Privacy Register', icon: FileText, adminOnly: true },
    ],
  },
  {
    title: 'Help',
    items: [
      { to: '/instructions', label: 'Instructions / Help', icon: BookOpen },
    ],
  },
];

export default function Layout() {
  const { legalNameDisplay, lastUpdatedDisplay } = useBranding();
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((n) => {
      if (n.adminOnly && user?.role !== 'ADMIN') return false;
      if (n.managerOnly && user?.role === 'STAFF') return false;
      return true;
    }),
  })).filter((section) => section.items.length > 0);

  useEffect(() => {
    const activeSection = visibleSections.find((section) => section.items.some((item) => (
      item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
    )));
    if (activeSection?.title) {
      setOpenSections((current) => ({ ...current, [activeSection.title as string]: true }));
    }
  }, [location.pathname, user?.role]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const nav = (
    <nav className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-3 py-4">
      {visibleSections.map((section) => (
        <div
          key={section.title ?? 'section'}
          className="space-y-1.5"
          onMouseEnter={() => {
            if (section.title) setOpenSections((current) => ({ ...current, [section.title as string]: true }));
          }}
        >
          {section.title && (
            <button
              type="button"
              id={`sidebar-${section.title.toLowerCase()}`}
              aria-controls={`sidebar-${section.title.toLowerCase()}-menu`}
              aria-expanded={openSections[section.title] ?? true}
              onClick={() => setOpenSections((current) => ({ ...current, [section.title as string]: !(current[section.title as string] ?? true) }))}
              className="group flex min-h-8 w-full items-center justify-between px-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-200"
            >
              {section.title}
              <ChevronDown size={14} strokeWidth={2} className={`text-slate-600 transition-transform duration-150 group-hover:text-slate-300 ${openSections[section.title] ?? true ? '' : '-rotate-90'}`} aria-hidden />
            </button>
          )}
          {(openSections[section.title ?? 'section'] ?? true) && <div id={`sidebar-${section.title?.toLowerCase() ?? 'section'}-menu`} className="space-y-1 pl-1">
            {section.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `group flex min-h-[40px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                  isActive
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
                }`
              }
            >
              <item.icon size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
              {item.label}
            </NavLink>
            ))}
          </div>}
        </div>
      ))}
    </nav>
  );

  const userCard = (
    <div className="border-t border-slate-700 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">
          {(user?.name ?? '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{user?.name}</div>
          <div className="text-xs text-slate-400">{user?.role.replace('_', ' ')}</div>
        </div>
        <button
          onClick={handleLogout}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-slate-700 hover:text-white active:scale-95"
          title="Logout"
          aria-label="Logout"
        >
          <LogOut size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] bg-gray-100">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col bg-slate-800 md:flex">
        {/* Logo links home. */}
        <Link to="/" className="flex items-center gap-2.5 px-4 py-4 transition-opacity duration-150 hover:opacity-90" aria-label={`${branding.appName} — go to dashboard`}>
          <BrandMark className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white" iconSize={18} />
          <div>
            <div className="text-sm font-bold text-white">Olbano Plaza</div>
            <div className="text-[11px] text-slate-400">Property Manager</div>
          </div>
        </Link>
        {nav}
        {userCard}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-gray-900/60 animate-in fade-in duration-200" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col bg-slate-800 shadow-2xl animate-in slide-in-from-left-64 duration-200">
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-sm font-bold text-white">Olbano Plaza</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 transition-colors duration-150 hover:bg-slate-700 hover:text-white"
                aria-label="Close menu"
              >
                <X size={18} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
            {nav}
            {userCard}
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <BrandingBanner />
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 md:px-6">
          <div className="flex items-center gap-2.5">
            <button
              className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors duration-150 hover:bg-gray-100 active:scale-95 md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={18} strokeWidth={1.75} aria-hidden />
            </button>
            <div className="flex items-center gap-2 md:hidden">
              <Link to="/" className="flex items-center gap-2" aria-label={`${branding.appName} — go to dashboard`}>
                <BrandMark className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white" iconSize={16} />
                <span className="text-sm font-bold text-gray-900">Olbano Plaza</span>
              </Link>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-sm font-medium text-gray-500 md:flex">
            <BarChart3 size={16} strokeWidth={1.75} className="text-brand-600" aria-hidden />
            {branding.appNameFull}
          </div>
          <div className="text-sm text-gray-600">
            <span className="hidden sm:inline">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            <span className="sm:hidden">
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-6">
          {/* Cap line length on large monitors — content stops growing past 80rem. */}
          <div className="mx-auto w-full max-w-7xl">
            {/* Inner boundary: when a page chunk is loading, only this content
                area shows the spinner — the sidebar and header stay mounted. */}
            <Suspense
              fallback={
                <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading page">
                  <Loader2 size={28} strokeWidth={1.75} className="animate-spin text-brand-600" aria-hidden />
                </div>
              }
            >
              <Outlet />
            </Suspense>
            {/* Footer with legal links — year is generated, never a stale hardcode. */}
            <footer className="mt-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-200 pb-2 pt-4 text-xs text-gray-500">
              <span>
                © {new Date().getFullYear()} {branding.appName} — {branding.appNameFull}
                {legalNameDisplay && <> · Operated by <span className="font-medium text-gray-600">{legalNameDisplay}</span></>}
                <span className="mx-1.5 text-gray-300">|</span>
                <span title="When the business identity and policy details were last updated">Last updated: {lastUpdatedDisplay}</span>
              </span>
              <nav className="flex flex-wrap gap-4" aria-label="Legal">
                <Link to="/privacy" className="transition-colors duration-150 hover:text-gray-700">Privacy Policy</Link>
                <Link to="/terms" className="transition-colors duration-150 hover:text-gray-700">Terms &amp; Conditions</Link>
                <Link to="/cookies" className="transition-colors duration-150 hover:text-gray-700">Cookies &amp; Storage</Link>
                <Link to="/refunds" className="transition-colors duration-150 hover:text-gray-700">Refund Policy</Link>
              </nav>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
