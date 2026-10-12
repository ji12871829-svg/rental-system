import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Layout from './components/Layout';
import CookieBanner from './components/CookieBanner';
import { useAuth } from './lib/auth';
import { useBranding } from './lib/BrandingContext';
import { PortalAuthProvider, usePortalAuth } from './lib/portalAuth';
import { routeChunks } from './lib/routeChunks';
import { ErrorBoundaryWithReset } from './components/ErrorBoundary';

// Route-level code splitting: every page is its own chunk, fetched on first
// visit. The initial bundle stays small; heavy pages (charts) don't slow down
// the first paint. Loaders live in routeChunks.ts so the sidebar can prefetch
// the exact same chunks on hover/focus — see lib/routeChunks.ts.
const Login = lazy(routeChunks.login);
const Landing = lazy(routeChunks.landing);
const Register = lazy(routeChunks.register);
const NotFound = lazy(() => import('./pages/NotFound'));
const Privacy = lazy(() => routeChunks.legal().then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => routeChunks.legal().then((m) => ({ default: m.Terms })));
const Cookies = lazy(() => routeChunks.legal().then((m) => ({ default: m.Cookies })));
const Refund = lazy(() => routeChunks.legal().then((m) => ({ default: m.Refund })));
const Dashboard = lazy(routeChunks.dashboard);
const Instructions = lazy(routeChunks.instructions);
const Settings = lazy(routeChunks.settings);
const Units = lazy(routeChunks.units);
const Tenants = lazy(routeChunks.tenants);
const RentCollection = lazy(routeChunks.rent);
const Water = lazy(routeChunks.water);
const TenantLedger = lazy(routeChunks.ledger);
const MonthlySummary = lazy(routeChunks.monthly);
const Expenses = lazy(routeChunks.expenses);
const Arrears = lazy(routeChunks.arrears);
const Receipts = lazy(routeChunks.receipts);
const SmsNotifications = lazy(routeChunks.sms);
const EmailHistory = lazy(routeChunks.emailHistory);
const EmailCampaign = lazy(routeChunks.emailCampaign);
const MessageTemplates = lazy(routeChunks.messageTemplates);
const Users = lazy(routeChunks.users);
const AuditLogs = lazy(routeChunks.audit);
const ClerkSignups = lazy(routeChunks.clerkSignups);
const PrivacyRegister = lazy(routeChunks.privacyRegister);
const MpesaReview = lazy(routeChunks.mpesaReview);
const Maintenance = lazy(routeChunks.maintenance);
const Vendors = lazy(routeChunks.vendors);
const ExpenseApprovals = lazy(routeChunks.expenseApprovals);
const RecurringExpenses = lazy(routeChunks.recurringExpenses);
const Penalties = lazy(routeChunks.penalties);
const Documents = lazy(routeChunks.documents);
const Vacancies = lazy(routeChunks.vacancies);
// Public vacancy board — outside the staff auth tree, like the legal pages.
const PublicVacancies = lazy(routeChunks.publicVacancies);

// Tenant portal — a separate, public-facing app shell with its own auth
// context; entirely outside the staff RequireAuth tree.
const PortalLogin = lazy(() => import('./pages/portal/PortalLogin'));
const PortalLayout = lazy(() => import('./pages/portal/PortalLayout'));
const PortalHome = lazy(() => import('./pages/portal/PortalHome'));
const PortalPayments = lazy(() => import('./pages/portal/PortalPayments'));
const PortalWater = lazy(() => import('./pages/portal/PortalWater'));
const PortalStatement = lazy(() => import('./pages/portal/PortalStatement'));

function RequirePortalAuth({ children }: { children: React.ReactNode }) {
  const { tenant, loading } = usePortalAuth();
  if (loading) return <RouteFallback />;
  if (!tenant) return <Navigate to="/portal/login" replace />;
  return <>{children}</>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <RouteFallback />;
  if (!token) {
    // The root is the public landing page for signed-out visitors; any other
    // protected URL deep-links straight to sign-in.
    return <Navigate to={location.pathname === '/' ? '/landing' : '/login'} replace />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Full-screen fallback for the first load and standalone pages (login, legal, 404).
function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white" role="status" aria-label="Loading page">
      <Loader2 size={28} strokeWidth={1.75} className="animate-spin text-brand-500" aria-hidden />
    </div>
  );
}

// Per-route document titles — one place instead of a hook in every page.
const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/instructions': 'Instructions & Help',
  '/settings': 'Settings',
  '/units': 'Units',
  '/tenants': 'Tenants',
  '/rent': 'Rent Collection',
  '/water': 'Water',
  '/ledger': 'Tenant Ledger',
  '/monthly': 'Monthly Summary',
  '/expenses': 'Expenses',
  '/arrears': 'Arrears',
  '/receipts': 'Receipts',
  '/sms': 'SMS Notifications',
  '/emails': 'Email History',
  '/email-campaign': 'Tenant Email',
  '/message-templates': 'Message Templates',
  '/users': 'Users',
  '/audit': 'Audit Logs',
  '/privacy-register': 'Privacy Register',
  '/mpesa-review': 'M-Pesa Review',
  '/login': 'Sign in',
  '/landing': 'Welcome',
  '/register': 'Create account',
  '/privacy': 'Privacy Policy',
  '/terms': 'Terms & Conditions',
  '/cookies': 'Cookie & Storage Policy',
  '/refunds': 'Refund Policy',
  '/portal': 'Tenant Portal',
  '/portal/payments': 'Portal · Payments',
  '/portal/water': 'Portal · Water',
  '/portal/statement': 'Portal · Statement',
  '/portal/login': 'Portal Sign in',
};

function TitleManager() {
  const { pathname } = useLocation();
  const { tabTitleBrand } = useBranding();
  useEffect(() => {
    document.title = `${TITLES[pathname] ?? 'Page not found'} · ${tabTitleBrand}`;
  }, [pathname, tabTitleBrand]);
  return null;
}

export default function App() {
  return (
    <>
      <TitleManager />
      <CookieBanner />
      <Suspense fallback={<RouteFallback />}>
        {/* Root boundary: no render error anywhere can white-screen the app.
            Route-level boundaries below catch first, keeping the damage
            narrow; this one is the last resort. Remounts on navigation, so
            browser-back recovers from a crashed deep page. */}
        <ErrorBoundaryWithReset surface="app" shell>
        <Routes>
          {/* Public surfaces — reachable before any sign-in. Wrapped in the
              portal auth provider so an already-signed-in tenant skips the
              marketing shell (same pattern as /portal/login). */}
          <Route
            path="/landing"
            element={
              <PortalAuthProvider>
                <Landing />
              </PortalAuthProvider>
            }
          />
          <Route
            path="/register"
            element={
              <PortalAuthProvider>
                <Register />
              </PortalAuthProvider>
            }
          />
          {/* Unified sign-in — serves both staff and tenant logins via tabs,
              so it needs the portal provider (and keeps the deep links
              ?type=tenant / ?email=… working). */}
          <Route
            path="/login"
            element={
              <PortalAuthProvider>
                <Login />
              </PortalAuthProvider>
            }
          />
          {/* Legal pages are public — they must be readable before signing in. */}
          <Route path="/privacy" element={<Privacy />} />
          {/* Public vacancy board — marketing surface, no session required. */}
          <Route path="/public-vacancies" element={<PublicVacancies />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/cookies" element={<Cookies />} />
          <Route path="/refunds" element={<Refund />} />
          <Route
            element={
              <RequireAuth>
                <ErrorBoundaryWithReset surface="dashboard" shell>
                  <Layout />
                </ErrorBoundaryWithReset>
              </RequireAuth>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/instructions" element={<Instructions />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/units" element={<Units />} />
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/rent" element={<RentCollection />} />
            {/* The three former water pages merged into one — old URLs redirect
                so saved bookmarks and existing habits keep working. */}
            <Route path="/water" element={<Water />} />
            <Route path="/water-meter" element={<Navigate to="/water?tab=meter" replace />} />
            <Route path="/water-payments" element={<Navigate to="/water?tab=payments" replace />} />
            <Route path="/water-supply" element={<Navigate to="/water?tab=supply" replace />} />
            <Route path="/ledger" element={<TenantLedger />} />
            <Route path="/monthly" element={<MonthlySummary />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/arrears" element={<Arrears />} />
            <Route path="/receipts" element={<Receipts />} />
            <Route path="/sms" element={<SmsNotifications />} />
            <Route path="/emails" element={<EmailHistory />} />
            <Route path="/email-campaign" element={<EmailCampaign />} />
          <Route path="/message-templates" element={<MessageTemplates />} />
            <Route path="/mpesa-review" element={<MpesaReview />} />
            <Route path="/maintenance" element={<Maintenance />} />
            <Route path="/vendors" element={<Vendors />} />
            <Route path="/expense-approvals" element={<ExpenseApprovals />} />
            <Route path="/recurring-expenses" element={<RecurringExpenses />} />
            <Route path="/penalties" element={<Penalties />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/vacancies" element={<Vacancies />} />
            <Route
              path="/users"
              element={
                <RequireAdmin>
                  <Users />
                </RequireAdmin>
              }
            />
            <Route
              path="/audit"
              element={
                <RequireAdmin>
                  <AuditLogs />
                </RequireAdmin>
              }
            />
            <Route
              path="/clerk-signups"
              element={
                <RequireAdmin>
                  <ClerkSignups />
                </RequireAdmin>
              }
            />
            <Route
              path="/privacy-register"
              element={
                <RequireAdmin>
                  <PrivacyRegister />
                </RequireAdmin>
              }
            />
          </Route>
          {/* Tenant portal — own layout + auth, outside the staff guard. */}
          <Route
            path="/portal/login"
            element={
              <PortalAuthProvider>
                <PortalLogin />
              </PortalAuthProvider>
            }
          />
          <Route
            path="/portal"
            element={
              <PortalAuthProvider>
                <RequirePortalAuth>
                  <ErrorBoundaryWithReset surface="tenant portal">
                    <PortalLayout />
                  </ErrorBoundaryWithReset>
                </RequirePortalAuth>
              </PortalAuthProvider>
            }
          >
            {/* Page-level boundaries: a crash in one portal page leaves the
                drawer and the rest of the portal usable — the fallback's
                "Back to portal home" is a real recovery path. */}
            <Route
              index
              element={
                <ErrorBoundaryWithReset surface="portal home">
                  <PortalHome />
                </ErrorBoundaryWithReset>
              }
            />
            <Route
              path="payments"
              element={
                <ErrorBoundaryWithReset surface="portal payments">
                  <PortalPayments />
                </ErrorBoundaryWithReset>
              }
            />
            <Route
              path="water"
              element={
                <ErrorBoundaryWithReset surface="portal water">
                  <PortalWater />
                </ErrorBoundaryWithReset>
              }
            />
            <Route
              path="statement"
              element={
                <ErrorBoundaryWithReset surface="portal statement">
                  <PortalStatement />
                </ErrorBoundaryWithReset>
              }
            />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
        </ErrorBoundaryWithReset>
      </Suspense>
    </>
  );
}
