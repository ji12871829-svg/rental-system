// Dashboard strip for Clerk sign-ups the webhook could not auto-map.
// Rendered between the messaging health cards and the charts; self-gating on
// every axis so it never becomes noise:
//   * fetch error (401 = webhook feature off, 403 = non-admin) → nothing;
//   * nothing pending → nothing (the Clerk Sign-ups page covers history);
//   * pending sign-ups exist → an amber card deep-linking to /clerk-signups.
import { Link } from 'react-router-dom';
import { useFetch } from '../ui';
import { api } from '../../lib/api';
import { SectionHead } from './primitives';

interface ClerkSignupRow {
  external_id: string;
  email: string | null;
  reason: string;
  refused_at: string;
  refusals: number;
  linked_user_id: number | null;
}

export function ClerkSignupsStats() {
  const { data, error } = useFetch(() => api.get<ClerkSignupRow[]>('/api/webhooks/clerk/signups'), []);

  if (error || !data) return null;
  const pending = data.filter((r) => r.linked_user_id === null);
  if (pending.length === 0) return null;

  // The endpoint orders by Clerk identity, not recency — sort for the
  // "last attempt" line. Plain numbers instead of CountUp: a strip that
  // counts up draws the eye to animation, not to the signal.
  const latest = [...pending].sort((a, b) => +new Date(b.refused_at) - +new Date(a.refused_at))[0];
  const attempts = pending.reduce((n, r) => n + r.refusals, 0);
  const ago = timeAgo(latest.refused_at);

  return (
    <div className="mt-8">
      <SectionHead label="Access" caption="Clerk sign-ins needing a manual link" />
      <Link
        to="/clerk-signups"
        className="block rounded-xl border border-gray-200 border-l-4 border-l-amber-400 bg-white p-4 shadow-sm transition-[background-color,transform] duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover:bg-gray-50 active:scale-[0.98]"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-gray-900">Clerk sign-ups</span>
          <span className="text-xs font-medium text-brand-700">Review sign-ups →</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-sm text-gray-600">
            <span className="alert-pulse mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
            <span className="font-semibold text-gray-900">{pending.length}</span>{' '}
            {pending.length === 1 ? 'sign-up' : 'sign-ups'} not mapped
          </span>
          <span className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{attempts}</span> failed{' '}
            {attempts === 1 ? 'attempt' : 'attempts'}
          </span>
          <span
            className="max-w-full truncate rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800"
            title={`Last attempt ${ago}: ${latest.email ?? latest.external_id} — ${latest.reason}`}
          >
            <span className="font-semibold">Last attempt {ago}:</span> {latest.email ?? latest.external_id}
          </span>
        </div>
      </Link>
    </div>
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
