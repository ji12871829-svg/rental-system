import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Building2, Loader2 } from 'lucide-react';
import { usePortalAuth } from '../../lib/portalAuth';
import { portalApi } from '../../lib/portalApi';

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
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-100">
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Building2 className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold text-gray-900">Tenant Portal</h1>
          <p className="text-sm text-gray-500">Sign in with the email your landlord registered</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="••••••••"
            />
          </label>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-gray-400">
          Access is issued by your property manager. Contact them if you haven't received credentials.
        </p>
      </div>
    </div>
  );
}
