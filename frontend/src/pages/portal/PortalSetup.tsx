import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { usePortalAuth } from '../../lib/portalAuth';
import { portalApi } from '../../lib/portalApi';
import { branding } from '../../lib/branding';

// One-time setup link landing page (/portal/setup?token=…). Replaces the old
// flow that emailed a generated password (2026-10-13 security review,
// OWASP #7/#2): the tenant opens the link from their email and chooses their
// own password. The token is single-use and expires server-side — after a
// successful save this page offers the sign-in screen instead of replaying.
export default function PortalSetup() {
  const { tenant, loading } = usePortalAuth();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // A live session has nothing to set up here — send it into the portal.
  if (!loading && tenant) return <Navigate to="/portal" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await portalApi.post('/api/portal/setup', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set your password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <h1 className="text-xl font-semibold text-gray-900">{branding.appName} — Tenant Portal</h1>
          <p className="text-sm text-gray-500">Choose a password for your portal access</p>
        </div>

        {done ? (
          <div className="space-y-4 rounded-xl border border-ash bg-white p-6 text-center">
            <p className="text-sm text-gray-700">
              Your password is set. You can now sign in to the portal with your login email.
            </p>
            <Link
              to="/portal/login"
              className="press flex w-full items-center justify-center rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
            >
              Go to sign in
            </Link>
          </div>
        ) : !token ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            This setup link is missing its token. Open the link from your email again, or ask your
            property manager to send a new one.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-ash bg-white p-6">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">New password</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-ash px-3 py-2 text-sm placeholder:text-silver focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300"
                placeholder="At least 8 characters"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Confirm password</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-ash px-3 py-2 text-sm placeholder:text-silver focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300"
                placeholder="Repeat the password"
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
              Set password
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-gray-400">
          The link works once and expires automatically. Need a new one? Ask your property manager.
        </p>
      </div>
    </div>
  );
}
