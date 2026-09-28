import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { usePortalAuth } from '../../lib/portalAuth';
import { portalApi } from '../../lib/portalApi';
import { Toon } from '../../components/Toon';

export default function PortalLogin() {
  const { tenant, loading, login } = usePortalAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Self-heal for sessions created before the portal got its own CSRF cookie:
  // such a session passes /me (JWT valid) but fails every write with 403, and
  // redirecting to /login would bounce straight back because /me still says
  // authenticated. Detect the half-configured session by /me succeeding while
  // the readable csrf half is missing, then force a clean logout.
  const [healing, setHealing] = useState(false);
  useEffect(() => {
    const hasCsrf = document.cookie.includes('rpms_portal_csrf');
    if (hasCsrf) return;
    setHealing(true);
    let cancelled = false;
    portalApi
      .get<{ data: unknown }>('/api/portal/me')
      .then(() => portalApi.post('/api/portal/logout', {}))
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHealing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || healing) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        {healing && !loading && (
          <p className="text-sm text-gray-500">Resetting your session — one moment…</p>
        )}
      </div>
    );
  }

  if (tenant) return <Navigate to="/portal" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/portal', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          {/* The same waving welcome the staff sign-in gives — tenants get
              the mascot too, not a bare icon. */}
          <Toon size={110} pose="wave" animated title="Olbano Plaza property manager mascot waving hello" />
          <h1 className="text-xl font-semibold text-gray-900">Tenant Portal</h1>
          <p className="text-sm text-gray-500">Sign in with the email your landlord registered</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-ash bg-white p-6">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-ash px-3 py-2 text-sm placeholder:text-silver focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300"
              placeholder="you@example.com"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-ash px-3 py-2 text-sm placeholder:text-silver focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300"
              placeholder="••••••••"
            />
          </label>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="press flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-gray-400">
          Access is issued by your property manager. Contact them if you haven't received credentials.
        </p>
        <p className="mt-3 text-center text-sm text-gray-500">
          Don't have access yet?{' '}
          <Link to="/register?type=tenant" className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">
            Create tenant access
          </Link>
        </p>
      </div>
    </div>
  );
}
