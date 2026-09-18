import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { branding } from '../lib/branding';
import { useBranding } from '../lib/BrandingContext';
import { Button, TextInput } from '../components/ui';
import { BrandLogo } from '../components/BrandLogo';
import { Toon } from '../components/Toon';


export default function Login() {
  const { token, login } = useAuth();
  const { identity, supportContacts, loginIdentityLine } = useBranding();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (token) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Fetch the Dashboard chunk while the auth request is in flight — by the
      // time navigate('/') mounts the route, the module is already loaded and
      // the first post-login screen renders without the Suspense spinner.
      // A failed or slow prefetch must never block sign-in: the error is
      // swallowed here and React.lazy retries on navigation.
      const dashboardChunk = import('./Dashboard').then(
        () => undefined,
        () => undefined
      );
      await Promise.all([login(email, password), dashboardChunk]);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
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
            fetchPriority="high"
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
        {/* Compact brand header shown only where the facade panel is hidden. */}
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <BrandLogo
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm shadow-brand-500/30"
            iconSize={20}
            textClassName="text-base font-bold"
          />
          <div>
            <span className="block text-base font-semibold text-gray-900">{branding.appNameLong}</span>
            {loginIdentityLine && <span className="block text-xs text-gray-500">{loginIdentityLine}</span>}
          </div>
        </div>

        <div className="m-auto w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-gray-900">Sign in</h2>
          <p className="mt-1 text-sm text-gray-500">Manage units, rent, water and reports</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
              <TextInput type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@rpms.local" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Password</span>
              <div className="relative">
                <TextInput
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
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
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
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

          {/* Demo credentials must never ship to a real deployment. */}
          {import.meta.env.DEV && (
            <p className="mt-5 text-center text-xs text-gray-400">
              Demo accounts: admin@rpms.local / Manager@2026! / Staff@2026! — see README
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
                  <span key={c.email}>
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