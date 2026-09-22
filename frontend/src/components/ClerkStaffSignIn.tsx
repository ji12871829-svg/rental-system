// Staff sign-in through Clerk — shown on /login's Landlord/Manager tab only
// when VITE_CLERK_PUBLISHABLE_KEY is configured (main.tsx gates the provider,
// this component gates the UI). Renders Clerk's hosted <SignIn/>; the moment
// a Clerk session exists it exchanges it for the app's own staff cookie via
// POST /api/auth/clerk/session (see backend/src/routes/clerkAuthRoutes.ts)
// and enters the dashboard — the rest of the app can't tell a Clerk sign-in
// from a password sign-in.
//
// Bridge failure — the Clerk account isn't mapped to a local user, or the
// local user is INACTIVE — surfaces a generic message and hands the visitor
// back to the password form (onFallback), so an unmapped or half-migrated
// Clerk setup can never lock staff out.
import { useEffect, useState } from 'react';
import { SignIn, useUser } from '@clerk/react';
import { Loader2 } from 'lucide-react';

export default function ClerkStaffSignIn({ onFallback }: { onFallback: () => void }) {
  const { isLoaded, isSignedIn } = useUser();
  const [error, setError] = useState('');
  const [bridging, setBridging] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || bridging) return;
    setBridging(true);
    fetch('/api/auth/clerk/session', { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message || 'Sign in failed. Use the password form instead.');
        }
      })
      .then(() => window.location.assign('/'))
      .catch((err: Error) => {
        setError(err.message);
        setBridging(false);
      });
  }, [isLoaded, isSignedIn, bridging]);

  return (
    <div className="space-y-3">
      {!isLoaded || (isSignedIn && bridging) ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Signing you in…
        </p>
      ) : (
        <SignIn routing="hash" />
      )}
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={onFallback}
        className="w-full text-center text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
      >
        Use password sign-in instead
      </button>
    </div>
  );
}
