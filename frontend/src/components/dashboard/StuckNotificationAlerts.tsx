// Dashboard sticky-notification alert: surfaces counts of PENDING and
// failed/ERRONEOUS emails and SMS so delivery problems surface without
// opening the history pages. Self-gates on every axis:
//   * fetch error (401 = feature off, 403 = non-admin) → nothing;
//   * nothing stuck → nothing (the history pages cover plain history);
//   * something stuck → a red card with counts and a one-click route to the
//     relevant history page.
import { Link } from 'react-router-dom';
import { useFetch } from '../ui';
import { api } from '../../lib/api';
import { SectionHead } from './primitives';

interface StuckNotifications {
  data: {
    sms: { pending: number; failed: number; erroneous: number; lastFailure: { at: string; reason: string } | null };
    email: { pending: number; failed: number; erroneous: number; lastFailure: { at: string; reason: string } | null };
  };
}

export function StuckNotificationAlerts() {
  const { data, error } = useFetch(() => api.get<StuckNotifications>('/api/reports/notification-stuck'), []);

  if (error || !data) return null;

  const sms = data.data.sms;
  const email = data.data.email;

  const smsStuck = sms.pending + sms.failed + sms.erroneous;
  const emailStuck = email.pending + email.failed + email.erroneous;
  if (smsStuck === 0 && emailStuck === 0) return null;

  const smsParts: { label: string; tone: 'warn' | 'bad' }[] = [];
  if (sms.pending > 0) smsParts.push({ label: `${sms.pending} pending`, tone: 'warn' });
  if (sms.failed > 0) smsParts.push({ label: `${sms.failed} failed`, tone: 'bad' });
  if (sms.erroneous > 0) smsParts.push({ label: `${sms.erroneous} erroneous`, tone: 'bad' });

  const emailParts: { label: string; tone: 'warn' | 'bad' }[] = [];
  if (email.pending > 0) emailParts.push({ label: `${email.pending} pending`, tone: 'warn' });
  if (email.failed > 0) emailParts.push({ label: `${email.failed} failed`, tone: 'bad' });
  if (email.erroneous > 0) emailParts.push({ label: `${email.erroneous} erroneous`, tone: 'bad' });

  return (
    <div className="mt-8">
      <SectionHead label="Delivery" caption="Stuck notifications — review before the next sweep" />
      <div className="space-y-3">
        {smsStuck > 0 && (
          <Link
            to="/sms"
            className="block rounded-xl border border-gray-200 border-l-4 border-l-red-500 bg-white p-4 shadow-sm transition-[background-color,transform] duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover:bg-gray-50 active:scale-[0.98]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-gray-900">SMS notifications stuck</span>
              <span className="text-xs font-medium text-brand-700">Review SMS →</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              {smsParts.map(({ label, tone }) => (
                <span
                  key={label}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    tone === 'bad' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {tone === 'bad' && <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />}
                  {tone === 'warn' && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />}
                  {label}
                </span>
              ))}
            </div>
          </Link>
        )}

        {emailStuck > 0 && (
          <Link
            to="/emails"
            className="block rounded-xl border border-gray-200 border-l-4 border-l-red-500 bg-white p-4 shadow-sm transition-[background-color,transform] duration-150 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover:bg-gray-50 active:scale-[0.98]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-gray-900">Email notifications stuck</span>
              <span className="text-xs font-medium text-brand-700">Review emails →</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              {emailParts.map(({ label, tone }) => (
                <span
                  key={label}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    tone === 'bad' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {tone === 'bad' && <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />}
                  {tone === 'warn' && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />}
                  {label}
                </span>
              ))}
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}
