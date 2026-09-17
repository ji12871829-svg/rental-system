import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Layout from './components/Layout';
import CookieBanner from './components/CookieBanner';
import { useAuth } from './lib/auth';
import { useBranding } from './lib/BrandingContext';
import { PortalAuthProvider, usePortalAuth } from './lib/portalAuth';

// Route-level code splitting: every page is its own chunk, fetched on first
// visit. The initial bundle stays small; heavy pages (charts) don't slow down
// the first paint. The four legal pages share one small chunk.
const Login = lazy(() => import('./pages/Login'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Privacy = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Terms })));
const Cookies = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Cookies })));
const Refund = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Refund })));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Instructions = lazy(() => import('./pages/Instructions'));
const Settings = lazy(() => import('./pages/Settings'));
const Units = lazy(() => import('./pages/Units'));
const Tenants = lazy(() => import('./pages/Tenants'));
const RentCollection = lazy(() => import('./pages/RentCollection'));
const WaterMeter = lazy(() => import('./pages/WaterMeter'));
const WaterPayments = lazy(() => import('./pages/WaterPayments'));
const WaterSupply = lazy(() => import('./pages/WaterSupply'));
const TenantLedger = lazy(() => import('./pages/TenantLedger'));
const MonthlySummary = lazy(() => import('./pages/MonthlySummary'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Arrears = lazy(() => import('./pages/Arrears'));
const Receipts = lazy(() => import('./pages/Receipts'));
const SmsNotifications = lazy(() => import('./pages/SmsNotifications'));
const EmailCampaign = lazy(() => import('./pages/EmailCampaign'));
const Users = lazy(() => import('./pages/Users'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const PrivacyRegister = lazy(() => import('./pages/PrivacyRegister'));

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
  if (!ready) return <RouteFallback />;
  if (!token) return <Navigate to="/login" replace />;
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
    <div className="flex min-h-screen items-center justify-center bg-gray-100" role="status" aria-label="Loading page">
      <Loader2 size={28} strokeWidth={1.75} className="animate-spin text-brand-600" aria-hidden />
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
  '/water-meter': 'Water Meter',
  '/water-payments': 'Water Payments',
  '/water-supply': 'Water Supply Costs',
  '/ledger': 'Tenant Ledger',
  '/monthly': 'Monthly Summary',
  '/expenses': 'Expenses',
  '/arrears': 'Arrears',
  '/receipts': 'Receipts',
  '/sms': 'SMS Notifications',
  '/email-campaign': 'Tenant Email',
  '/users': 'Users',
  '/audit': 'Audit Logs',
  '/privacy-register': 'Privacy Register',
  '/login': 'Sign in',
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
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Legal pages are public — they must be readable before signing in. */}
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/cookies" element={<Cookies />} />
          <Route path="/refunds" element={<Refund />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/instructions" element={<Instructions />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/units" element={<Units />} />
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/rent" element={<RentCollection />} />
            <Route path="/water-meter" element={<WaterMeter />} />
            <Route path="/water-payments" element={<WaterPayments />} />
            <Route path="/water-supply" element={<WaterSupply />} />
            <Route path="/ledger" element={<TenantLedger />} />
            <Route path="/monthly" element={<MonthlySummary />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/arrears" element={<Arrears />} />
            <Route path="/receipts" element={<Receipts />} />
            <Route path="/sms" element={<SmsNotifications />} />
            <Route path="/email-campaign" element={<EmailCampaign />} />
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
                  <PortalLayout />
                </RequirePortalAuth>
              </PortalAuthProvider>
            }
          >
            <Route index element={<PortalHome />} />
            <Route path="payments" element={<PortalPayments />} />
            <Route path="water" element={<PortalWater />} />
            <Route path="statement" element={<PortalStatement />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}
