// Dashboard security card for session anomalies (GET /api/audit/anomalies):
// same-account sign-ins through BOTH credential paths minutes apart, or from
// two distinct client IPs within ten minutes. Either pattern means the
// account has two live access paths or is being used from two places at once
// — worth an admin's eyes immediately, hence the red treatment. Self-gating:
// renders nothing on error (non-admin / endpoint absent) and nothing when the
// week's trail is clean.
import { Link } from 'react-router-dom';
import { useFetch } from '../ui';
import { api } from '../../lib/api';
import { SectionHead } from './primitives';

interface Anomaly {
  kind: string;
  userId: number;
  userEmail: string | null;
  firstAction: string;
  secondAction: string;
  firstIp: string | null;
  secondIp: string | null;
  at: string;
}

interface AnomaliesResponse {
  data: { mixedPath: Anomaly[]; distinctIp: Anomaly[] };
}

export function SecurityAnomaliesStats() {
  const { data, error } = useFetch(() => api.get<AnomaliesResponse>('/api/audit/anomalies'), []);

  if (error || !data) return null;
  const { mixedPath, distinctIp } = data.data;
  const total = mixedPath.length + distinctIp.length;
  if (total === 0) return null;

  const newest = [...mixedPath, ...distinctIp].sort((a, b) => +new Date(b.at) - +new Date(a.at))[0];

  return (
    <div className="mt-8">
      <SectionHead label="Access" caption="Sign-in patterns needing review" />
      <Link
        to="/audit"
        className="block rounded-xl border border-gray-200 border-l-4 border-l-red-500 bg-white p-4 shadow-sm transition-[background-color,transform] duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover:bg-gray-50 active:scale-[0.98]"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-gray-900">Session anomalies</span>
          <span className="text-xs font-medium text-brand-700">Open audit trail →</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-sm text-gray-600">
            <span className="alert-pulse mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />
            <span className="font-semibold text-red-600">{total}</span> this week
          </span>
          {mixedPath.length > 0 && (
            <span className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{mixedPath.length}</span> mixed Clerk/password
            </span>
          )}
          {distinctIp.length > 0 && (
            <span className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{distinctIp.length}</span> distinct-IP
            </span>
          )}
          <span
            className="max-w-full truncate rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700"
            title={`Most recent: ${newest.userEmail ?? 'unknown'} — ${newest.firstAction} then ${newest.secondAction} (${newest.firstIp ?? '?'} → ${newest.secondIp ?? '?'})`}
          >
            <span className="font-semibold">Most recent {timeAgo(newest.at)}:</span>{' '}
            {newest.userEmail ?? 'unknown'} — {newest.firstAction} → {newest.secondAction}
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
