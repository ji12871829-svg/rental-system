// Public account creation — one page, two flows, chosen by ?type= or tabs:
//
//   * tenant   → POST /api/portal/register (claim portal access with the
//                email staff already have on file; signs straight in)
//   * landlord → POST /api/auth/register   (request a staff account; the row
//                is created INACTIVE and an admin activates it in Users)
//
// Reachable from the landing page's two cards, the staff login page and the
// portal login page (?type=tenant / ?type=landlord preselect the tab).
// Public, unauthenticated, branded through BrandingContext like every other
// public surface.
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building2, CheckCircle2, KeyRound, UserRound } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { Toon } from '../components/Toon';
import { Button, TextInput, useShake } from '../components/ui';
import { useBranding } from '../lib/BrandingContext';
import { branding } from '../lib/branding';
import { useAuth } from '../lib/auth';
import { usePortalAuth } from '../lib/portalAuth';
import { api } from '../lib/api';
import { portalApi } from '../lib/portalApi';

type Flow = 'tenant' | 'landlord';

export default function Register() {
  const { identity } = useBranding();
  const { token, ready } = useAuth();
  const { tenant } = usePortalAuth();
  const [params] = useSearchParams();

  const initial = params.get('type') === 'landlord' ? 'landlord' : params.get('type') === 'tenant' ? 'tenant' : null;
  const [flow, setFlow] = useState<Flow>(initial ?? 'tenant');

  // Already signed in? The registration pages are meaningless — go home.
  if (ready && token) return <Navigate to="/" replace />;
  if (tenant) return <Navigate to="/portal" replace />;

  return (
    <div className="flex min-h-screen w-full bg-white">
      {/* Left facade — same treatment as Login */}
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
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b1f3a] via-[#0b1f3a]/75 to-[#0b1f3a]/25" aria-hidden />
        <div className="relative flex h-full flex-col justify-between p-10">
          <Link to="/" className="flex items-center gap-3" aria-label="Back to the landing page">
            <BrandLogo
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/15"
              iconSize={22}
              textClassName="text-lg font-bold"
            />
            <span className="text-lg font-semibold text-white">{branding.appName}</span>
          </Link>
          <div className="flex items-end gap-4">
            <Toon size={110} pose="wave" animated title="Olbano Plaza property manager mascot waving hello" />
            <div>
              <h1 className="max-w-xs text-3xl font-semibold leading-tight text-white">
                {flow === 'tenant' ? 'Claim your tenant portal access' : 'Request your staff account'}
              </h1>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">
                {flow === 'tenant'
                  ? 'Set your own password and pay rent, check balances and download receipts anytime.'
                  : 'An administrator reviews every request before the dashboard unlocks.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-1 flex-col overflow-y-auto bg-white px-6 py-8 sm:px-10">
        <div className="mb-6 flex items-center justify-between lg:mb-8">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800">
            <ArrowLeft size={16} aria-hidden /> Back
          </Link>
          <div className="flex items-center gap-2 lg:hidden">
            <BrandLogo
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white shadow-sm shadow-brand-500/30"
              iconSize={17}
            />
            <span className="text-sm font-semibold text-gray-900">{branding.appName}</span>
          </div>
        </div>

        <div className="m-auto w-full max-w-md">
          <h2 className="text-2xl font-semibold text-gray-900">Create account</h2>
          <p className="mt-1 text-sm text-gray-500">Choose the account type that fits you.</p>

          {/* Flow tabs */}
          <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="Account type">
            {(
              [
                { key: 'tenant', label: 'Tenant', icon: UserRound },
                { key: 'landlord', label: 'Landlord / Agent', icon: KeyRound },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={flow === key}
                onClick={() => setFlow(key)}
                className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  flow === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Icon size={15} aria-hidden /> {label}
              </button>
            ))}
          </div>

          <div className="mt-6">
            {flow === 'tenant' ? <TenantForm /> : <LandlordForm />}
          </div>

          <div className="mt-6 border-t border-gray-100 pt-4 text-center text-sm text-gray-500">
            Already have an account?{' '}
            {flow === 'tenant' ? (
              <Link to="/login?type=tenant" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
                Sign in to the tenant portal
              </Link>
            ) : (
              <Link to="/login" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
                Sign in as staff
              </Link>
            )}
          </div>

          {identity?.legalName && (
            <p className="mt-6 text-center text-xs text-gray-400">{identity.legalName}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// Tenant flow — claim portal access
// -------------------------------------------------------------------------
function TenantForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [unit, setUnit] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shakeRef, fireShake] = useShake<HTMLFormElement>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      fireShake();
      return;
    }
    setBusy(true);
    try {
      await portalApi.post<{ data: { name: string; email: string } }>('/api/portal/register', {
        email: email.trim(),
        password,
        unit: unit.trim() || undefined,
      });
      // Signed in already — straight to the portal home. A full page load
      // (not SPA navigate) guarantees the fresh session cookie is settled
      // before the portal's auth provider probes /me — avoids a one-time
      // bounce through the portal login.
      window.location.assign('/portal');
    } catch (err) {
      setError((err as Error).message || 'Could not create your access. Try again.');
      fireShake();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={shakeRef} onSubmit={submit} className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-xl bg-brand-50 px-3.5 py-3 text-sm text-brand-800">
        <Building2 size={17} className="mt-0.5 shrink-0" aria-hidden />
        <p>
          Your tenancy must already exist — your property manager adds it with your email address.
          This form sets <b>your password</b> for that record.
        </p>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Email on file</span>
        <TextInput type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Create password</span>
        <TextInput type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Confirm password</span>
        <TextInput type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">
          Unit number <span className="font-normal text-gray-400">(only if staff have several tenants on one email)</span>
        </span>
        <TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. A-204" />
      </label>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <Button type="submit" disabled={busy} loading={busy} className="w-full">
        {busy ? 'Creating access…' : 'Create portal access'}
      </Button>
    </form>
  );
}

// -------------------------------------------------------------------------
// Landlord flow — request a staff account
// -------------------------------------------------------------------------
function LandlordForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shakeRef, fireShake] = useShake<HTMLFormElement>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.post<{ data: { bootstrap?: boolean } }>('/api/auth/register', {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        password,
      });
      // bootstrap=true means this was the FIRST account on the install: the
      // backend already activated it as ADMIN and set the session cookie —
      // a hard navigation lets the auth provider read it and the dashboard
      // guards accept it (same pattern as the tenant portal redirect).
      if (res.data?.bootstrap) {
        setBootstrapped(true);
        setTimeout(() => window.location.assign('/'), 1500);
        return;
      }
      setDone(true);
    } catch (err) {
      setError((err as Error).message || 'Could not submit your request. Try again.');
      fireShake();
    } finally {
      setBusy(false);
    }
  }

  if (bootstrapped) {
    return (
      <div className="rounded-2xl border border-brand-100 bg-brand-50 p-6 text-center" role="status">
        <CheckCircle2 size={40} className="mx-auto text-brand-600" aria-hidden />
        <h3 className="mt-3 text-lg font-semibold text-gray-900">Welcome aboard!</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Your administrator account is ready — taking you to the dashboard…
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-brand-100 bg-brand-50 p-6 text-center" role="status">
        <CheckCircle2 size={40} className="mx-auto text-brand-600" aria-hidden />
        <h3 className="mt-3 text-lg font-semibold text-gray-900">Request received</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          An administrator will review and activate your account. Once approved, sign in with the
          email and password you chose.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            to="/login"
            className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Go to sign in
          </Link>
          <Link
            to="/"
            className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form ref={shakeRef} onSubmit={submit} className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-xl bg-gray-50 px-3.5 py-3 text-sm text-gray-600">
        <KeyRound size={17} className="mt-0.5 shrink-0 text-gray-500" aria-hidden />
        <p>
          This sends a <b>request</b> — your dashboard unlocks only after an administrator activates
          the account. <span className="font-medium text-gray-800">Setting up a fresh system?</span>{' '}
          The first account created becomes the active administrator automatically.
        </p>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Full name</span>
        <TextInput required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Wanjiku" autoComplete="name" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
        <TextInput type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">
          Phone <span className="font-normal text-gray-400">(optional)</span>
        </span>
        <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254 …" autoComplete="tel" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Choose password</span>
        <TextInput type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
      </label>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <Button type="submit" disabled={busy} loading={busy} className="w-full">
        {busy ? 'Submitting request…' : 'Request staff account'}
      </Button>
    </form>
  );
}
