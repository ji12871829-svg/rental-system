// Unified sign-in — one page, two doors, chosen by tabs (see the BOMAHUT
// mock): "Landlord / Manager" signs into the staff app, "Tenant" into the
// self-service portal. The routes stay separate (staff: useAuth → cookie +
// Dashboard; tenant: usePortalAuth → portal cookie + /portal) — only the
// front door is shared.
//
// Deep links:
//   /login              → Landlord / Manager tab
//   /login?type=tenant  → Tenant tab preselected
//   /login?email=…      → email prefilled (the landing hero hands it over)
//
// The old /portal/login stays mounted for session-expiry redirects and old
// links; this page is now the way in for humans.
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePortalAuth } from '../lib/portalAuth';
import { branding } from '../lib/branding';
import { useBranding } from '../lib/BrandingContext';
import { Button, TextInput, useShake } from '../components/ui';
import { BrandLogo } from '../components/BrandLogo';
import { Toon } from '../components/Toon';
import ClerkStaffSignIn from '../components/ClerkStaffSignIn';

type Tab = 'landlord' | 'tenant';

// Clerk is deployment-optional: with no publishable key the staff tab keeps
// the classic password form — the only auth path on installs without Clerk
// (see docs/RUNBOOK-clerk-setup.md for turning Clerk on).
const CLERK_PK = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

export default function Login() {
  const { token, login: staffLogin } = useAuth();
  const { tenant, loading: portalLoading, login: portalLogin } = usePortalAuth();
  const { identity, supportContacts, loginIdentityLine } = useBranding();
  const navigate = useNavigate();
  // ?email= prefill (landing hero hand-off) and ?type=tenant deep link.
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (params.get('type') === 'tenant' ? 'tenant' : 'landlord'));
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Clerk card in use, or the visitor asked for the password form back after
  // a bridge failure (unmapped/inactive Clerk account).
  const [clerkFallback, setClerkFallback] = useState(false);

  const isTenant = tab === 'tenant';

  // A signed-in staff user has no business on the sign-in page. A signed-in
  // tenant bounces to their portal — but only when the Tenant tab is the
  // active door, so a tenant with a staff session can still reach the staff
  // form by choosing that tab (the two sessions are independent cookies).
  if (token) return <Navigate to="/" replace />;
  if (isTenant && tenant) return <Navigate to="/portal" replace />;

  const [shakeRef, fireShake] = useShake<HTMLFormElement>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (tab === 'landlord') {
        // Prefetch the Dashboard chunk while auth is in flight so the first
        // post-login screen renders without the Suspense spinner. Failure is
        // swallowed — React.lazy retries on navigation.
        const dashboardChunk = import('./Dashboard').then(
          () => undefined,
          () => undefined
        );
        await Promise.all([staffLogin(email, password), dashboardChunk]);
        navigate('/');
      } else {
        await portalLogin(email, password);
        // Full page load, not client navigate: the portal cookie must settle
        // before /portal's guards read it (same fix as post-signup redirect).
        window.location.assign('/portal');
      }
    } catch (err) {
      setError((err as Error).message || 'Sign in failed.');
      fireShake();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full bg-white">
      {/* Facade panel — the real building this software runs, not a decorative
          gradient. Photo + scrim keeps the copy legible; srcset serves the
          right size per screen. Hidden on narrow screens, where it would only
          push the form below the fold. */}
      <div className="relative hidden w-[42%] shrink-0 overflow-hidden bg-[#0b1f3a] lg:block">
        <picture>
          <source
            type="image/webp"
            srcSet="/building/building-1-480.webp 480w, /building/building-1-800.webp 800w, /building/building-1-1600.webp 1600w"
            sizes="42vw"
          />
          <img
            src="/building/building-1-800.webp"
            alt="The building managed with RPMS — modern residential facade"
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
            decoding="async"
            // React 18 types only know the lowercase DOM attribute; camelCase
            // `fetchPriority` triggers a console warning on every render.
            {...{ fetchpriority: 'high' } as Record<string, string>}
          />
        </picture>
        {/* Scrim so the copy below stays legible over the photo. */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b1f3a] via-[#0b1f3a]/75 to-[#0b1f3a]/25" aria-hidden />
        <div className="relative flex h-full flex-col justify-between p-10">
          <div className="flex items-center gap-3">
            <BrandLogo
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/15"
              iconSize={22}
              textClassName="text-lg font-bold"
            />
            <span className="text-lg font-semibold text-white">{branding.appName}</span>
          </div>
          <div className="flex items-end gap-4">
            <Toon size={110} pose="wave" animated title="Olbano Plaza property manager mascot waving hello" />
            <div>
            <h1 className="max-w-xs text-3xl font-semibold leading-tight text-white">{branding.appNameLong}</h1>
            {loginIdentityLine && <p className="mt-2 text-sm text-slate-300">{loginIdentityLine}</p>}
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">
              Every unit, rent payment and water bill, tracked in one place.
            </p>
            </div>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-1 flex-col overflow-y-auto bg-white px-6 py-8 sm:px-10">
        <div className="m-auto w-full max-w-sm">
          {/* Wordmark — the mock's big brand name over the tabs. */}
          <div className="mb-7 flex flex-col items-center gap-2.5 text-center">
            <BrandLogo
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-md shadow-brand-600/30"
              iconSize={24}
            />
            <span className="text-2xl font-bold tracking-tight text-gray-900">{branding.appNameLong}</span>
          </div>

          {/* Role tabs — the mock's two buttons. Active tab = brand fill;
              press feedback on pointer-down, matching the motion system. */}
          <div role="tablist" aria-label="Choose sign-in type" className="grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
            <button
              type="button"
              role="tab"
              id="tab-landlord"
              aria-selected={!isTenant}
              aria-controls="signin-panel"
              onClick={() => { setTab('landlord'); setError(''); }}
              className={`min-h-[44px] rounded-lg px-3 text-sm font-semibold transition-colors active:scale-[0.98] ${
                !isTenant ? 'bg-brand-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Landlord / Manager
            </button>
            <button
              type="button"
              role="tab"
              id="tab-tenant"
              aria-selected={isTenant}
              aria-controls="signin-panel"
              onClick={() => { setTab('tenant'); setError(''); }}
              className={`min-h-[44px] rounded-lg px-3 text-sm font-semibold transition-colors active:scale-[0.98] ${
                isTenant ? 'bg-brand-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Tenant
            </button>
          </div>

          {/* Panel content keyed by tab so switching re-runs the gentle
              rise-in (killed globally under prefers-reduced-motion). */}
          <div
            key={tab}
            role="tabpanel"
            id="signin-panel"
            aria-labelledby={isTenant ? 'tab-tenant' : 'tab-landlord'}
            className="rise-in mt-6"
          >
            {!isTenant && CLERK_PK && !clerkFallback ? (
              <ClerkStaffSignIn onFallback={() => setClerkFallback(true)} />
            ) : (
              <>
            <p className="text-sm text-gray-500">
              {isTenant
                ? 'Sign in with the email your landlord or property manager registered.'
                : 'Manage units, rent, water and reports.'}
            </p>

            <form ref={shakeRef} onSubmit={submit} className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
                <TextInput
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter email"
                  autoComplete="email"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Password</span>
                <div className="relative">
                  <TextInput
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="pr-11"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 transition-colors duration-150 hover:text-gray-600 active:scale-95"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    tabIndex={0}
                  >
                    {/* Both icons stay in the DOM and cross-fade — no dependency swap. */}
                    <span className="relative flex h-[18px] w-[18px] items-center justify-center">
                      <Eye
                        size={18}
                        strokeWidth={1.75}
                        aria-hidden
                        className={`absolute transition-[opacity,transform,filter] duration-200 [transition-timing-function:cubic-bezier(0.2,0,0,1)] ${
                          showPassword ? 'scale-[0.25] opacity-0 blur-[4px]' : 'scale-100 opacity-100 blur-0'
                        }`}
                      />
                      <EyeOff
                        size={18}
                        strokeWidth={1.75}
                        aria-hidden
                        className={`absolute transition-[opacity,transform,filter] duration-200 [transition-timing-function:cubic-bezier(0.2,0,0,1)] ${
                          showPassword ? 'scale-100 opacity-100 blur-0' : 'scale-[0.25] opacity-0 blur-[4px]'
                        }`}
                      />
                    </span>
                  </button>
                </div>
              </label>
              {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
              </>
            )}

            {isTenant ? (
              <p className="mt-5 text-center text-sm text-gray-500">
                Don't have access yet?{' '}
                <Link to="/register?type=tenant" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
                  Create tenant access
                </Link>
              </p>
            ) : (
              <p className="mt-5 text-center text-sm text-gray-500">
                New here?{' '}
                <Link to="/register" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
                  Create an account
                </Link>
              </p>
            )}
          </div>

          {/* Portal session still resolving on first paint — don't flash the
              tenant tab's error path before /me answers. */}
          {portalLoading && (
            <p className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-400">
              <Loader2 size={13} className="animate-spin" aria-hidden /> Checking your session…
            </p>
          )}
        </div>

        {/* Operator identity pinned to the bottom — hidden until the real
            details are filled in (Settings page). */}
        {(identity?.address || identity?.contactPhone || supportContacts.length > 0) && (
          <footer className="mt-auto pt-8 text-center text-xs leading-5 text-gray-400">
            {(identity?.address || identity?.contactPhone) && (
              <span className="block">
                {identity?.address && <span>{identity.address}</span>}
                {identity?.address && identity?.contactPhone && (
                  <span className="mx-2" aria-hidden>
                    ·
                  </span>
                )}
                {identity?.contactPhone && (
                  <a
                    href={`tel:${identity.contactPhone.replace(/\s+/g, '')}`}
                    className="transition-colors duration-150 hover:text-gray-600 hover:underline underline-offset-2"
                  >
                    {identity.contactPhone}
                  </a>
                )}
              </span>
            )}
            {supportContacts.length > 0 && (
              <span className={`${identity?.address || identity?.contactPhone ? 'mt-0.5' : ''} block`}>
                Need help?{' '}
                {supportContacts.map((c, i) => (
                  <span key={`${c.label}:${c.email}`}>
                    {i > 0 && (
                      <span className="mx-1.5" aria-hidden>
                        ·
                      </span>
                    )}
                    {c.label}:{' '}
                    <a href={`mailto:${c.email}`} className="transition-colors duration-150 hover:text-gray-600 hover:underline underline-offset-2">
                      {c.email}
                    </a>
                  </span>
                ))}
              </span>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
