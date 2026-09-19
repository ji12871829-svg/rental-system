import { useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { Suspense } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeftRight, BarChart3, BookOpen, BookUser, Building2, CalendarDays, ChevronDown, Droplets, FileBarChart, FileText, Gauge, LayoutDashboard, Loader2, LogOut, Mail, Menu, ReceiptText, Settings,
  Smartphone, Ticket, Users as UsersIcon, Wallet, X, ClipboardCheck, Zap,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { branding } from '../lib/branding';
import { routeChunks, prefetchRoute } from '../lib/routeChunks';
import { useBranding } from '../lib/BrandingContext';
import BrandingBanner from './BrandingBanner';
import { ThemeToggle } from './ThemeToggle';

// One icon set (lucide), one stroke weight (1.75), recolored via currentColor.
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  managerOnly?: boolean;
}

// Every nav destination maps to its route chunk (lib/routeChunks.ts).
// Hovering/focusing a tab header prefetches all chunks its dropdown hides,
// so opening it finds links already warm; clicking a link is then instant.
const PREFETCH_BY_PATH: Record<string, keyof typeof routeChunks> = {
  '/': 'dashboard',
  '/units': 'units',
  '/tenants': 'tenants',
  '/rent': 'rent',
  '/water-meter': 'waterMeter',
  '/water-payments': 'waterPayments',
  '/water-supply': 'waterSupply',
  '/ledger': 'ledger',
  '/receipts': 'receipts',
  '/monthly': 'monthly',
  '/expenses': 'expenses',
  '/arrears': 'arrears',
  '/sms': 'sms',
  '/email-campaign': 'emailCampaign',
  '/mpesa-review': 'mpesaReview',
  '/settings': 'settings',
  '/users': 'users',
  '/audit': 'audit',
  '/privacy-register': 'privacyRegister',
  '/instructions': 'instructions',
};

// Titled sections render as collapsible tabs: closed by default, opened only
// by clicking their header. The untitled section has no header to click and
// always renders open. The optional header icon makes the collapsed sidebar
// scannable — the icons echo the section's job, not any single page.
interface NavSection {
  title?: string;
  icon?: LucideIcon;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    // No title — the Dashboard renders flat at the top of the sidebar.
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Property',
    icon: Building2,
    items: [
      { to: '/units', label: 'Units', icon: Building2 },
      { to: '/tenants', label: 'Tenants', icon: ArrowLeftRight },
    ],
  },
  {
    title: 'Billing',
    icon: Wallet,
    items: [
      { to: '/rent', label: 'Rent Collection', icon: Wallet },
      { to: '/water-meter', label: 'Water Meter', icon: Gauge },
      { to: '/water-payments', label: 'Water Payments', icon: Droplets },
      { to: '/water-supply', label: 'Water Supply Costs', icon: FileBarChart },
    ],
  },
  {
    title: 'Records',
    icon: BookUser,
    items: [
      { to: '/ledger', label: 'Tenant Ledger', icon: BookUser },
      { to: '/receipts', label: 'Receipts', icon: Ticket },
    ],
  },
  {
    title: 'Reports',
    icon: BarChart3,
    items: [
      { to: '/monthly', label: 'Monthly Summary', icon: CalendarDays },
      { to: '/expenses', label: 'Expenses', icon: ReceiptText },
      { to: '/arrears', label: 'Arrears', icon: AlertTriangle },
    ],
  },
  {
    title: 'Messaging',
    icon: Smartphone,
    items: [
      { to: '/sms', label: 'SMS Notifications', icon: Smartphone },
      { to: '/email-campaign', label: 'Tenant Email', icon: Mail, managerOnly: true },
      { to: '/mpesa-review', label: 'M-Pesa Review', icon: ClipboardCheck, managerOnly: true },
    ],
  },
  {
    title: 'Management',
    icon: Settings,
    items: [
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/users', label: 'Users', icon: UsersIcon, adminOnly: true },
      { to: '/audit', label: 'Audit Logs', icon: FileText, adminOnly: true },
      { to: '/privacy-register', label: 'Privacy Register', icon: FileText, adminOnly: true },
    ],
  },
  {
    title: 'Help',
    icon: BookOpen,
    items: [
      { to: '/instructions', label: 'Instructions / Help', icon: BookOpen },
    ],
  },
  {
    // The drawer's old standalone quick-action block, promoted to a tab like
    // the rest — each action deep-links with ?new=1 to pre-open its form.
    title: 'Quick Actions',
    icon: Zap,
    items: [
      { to: '/rent?new=1', label: 'Record Payment', icon: Wallet },
      { to: '/water-meter?new=1', label: 'Log Reading', icon: Droplets },
      { to: '/expenses?new=1', label: 'Add Expense', icon: ReceiptText, managerOnly: true },
    ],
  },
];

export default function Layout() {
  const { legalNameDisplay, lastUpdatedDisplay } = useBranding();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Every titled section (Property, Billing, … Management, Help) is a
  // collapsible tab: closed by default, toggled only by clicking its header.
  // Only the untitled Dashboard section always renders open.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((n) => {
      if (n.adminOnly && user?.role !== 'ADMIN') return false;
      if (n.managerOnly && user?.role === 'STAFF') return false;
      return true;
    }),
  })).filter((section) => section.items.length > 0);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const nav = (
    <nav className="no-scrollbar flex-1 space-y-2 overflow-y-auto px-3 py-3">
      {visibleSections.map((section, sectionIndex) => (
        <div
          key={section.title ?? `flat-${sectionIndex}`}
          className="space-y-1"
          // Hover-intent prefetch: hovering a tab header warms every chunk its
          // dropdown hides (pure network warm-up — it does NOT open it, which
          // stays click-only by design). Links prefetch their own chunk.
          onMouseEnter={() => {
            for (const item of section.items) {
              const key = PREFETCH_BY_PATH[item.to.split('?')[0]];
              if (key) prefetchRoute(key);
            }
          }}
          onFocus={() => {
            // Keyboard path: tabbing to the header (or any link inside) warms
            // the section's chunks the same way a mouse hover does.
            for (const item of section.items) {
              const key = PREFETCH_BY_PATH[item.to.split('?')[0]];
              if (key) prefetchRoute(key);
            }
          }}
        >
          {section.title && (() => {
            const id = `sidebar-${section.title.toLowerCase().replace(/\s+/g, '-')}`;
            return (
            <button
              type="button"
              id={id}
              aria-controls={`${id}-menu`}
              aria-expanded={openSections[section.title] ?? false}
              onClick={() => setOpenSections((current) => ({ ...current, [section.title as string]: !(current[section.title as string] ?? false) }))}
              className="group flex min-h-6 w-full items-center justify-between rounded-md px-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300 transition-colors hover:bg-slate-700/60 hover:text-white"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {section.icon && <section.icon size={13} strokeWidth={1.75} aria-hidden className="shrink-0 text-slate-400 group-hover:text-slate-300" />}
                <span className="truncate">{section.title}</span>
              </span>
              {/* Item count — tells you what the dropdown hides before clicking.
                  Derived from the role-filtered list, so it matches what will
                  actually render when the tab opens. */}
              <span className="ml-1 font-normal text-slate-500 group-hover:text-slate-400">({section.items.length})</span>
              <ChevronDown size={14} strokeWidth={2} className={`ml-auto text-slate-500 transition-transform duration-150 group-hover:text-slate-300 ${openSections[section.title] ?? false ? '' : '-rotate-90'}`} aria-hidden />
            </button>
            );
          })()}
          {(section.title ? (openSections[section.title] ?? false) : true) && (
          <div id={`sidebar-${section.title?.toLowerCase().replace(/\s+/g, '-') ?? 'section'}-menu`} className="space-y-0.5 pl-1">
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `group flex min-h-[24px] items-center gap-1.5 rounded-md px-2.5 py-0.5 text-xs leading-tight font-medium transition-colors duration-150 ${
                      isActive
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
                    }`
                  }
                >
                <item.icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </div>
          )}
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
          <BrandLogo className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white" iconSize={18} />
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
                <BrandLogo className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white" iconSize={16} />
                <span className="text-sm font-bold text-gray-900">Olbano Plaza</span>
              </Link>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-sm font-medium text-gray-500 md:flex">
            <BarChart3 size={16} strokeWidth={1.75} className="text-brand-600" aria-hidden />
            {branding.appNameFull}
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="text-sm text-gray-600">
              <span className="hidden sm:inline">
                {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
              <span className="sm:hidden">
                {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
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
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <nav className="flex flex-wrap gap-4" aria-label="Legal">
                  <Link to="/privacy" className="transition-colors duration-150 hover:text-gray-700">Privacy Policy</Link>
                  <Link to="/terms" className="transition-colors duration-150 hover:text-gray-700">Terms &amp; Conditions</Link>
                  <Link to="/cookies" className="transition-colors duration-150 hover:text-gray-700">Cookies &amp; Storage</Link>
                  <Link to="/refunds" className="transition-colors duration-150 hover:text-gray-700">Refund Policy</Link>
                </nav>
              </div>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
