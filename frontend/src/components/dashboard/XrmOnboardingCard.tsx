import { Building2, CreditCard, Mail, Smartphone, Users } from 'lucide-react';
import type { DashboardData } from '@rpms/shared';

interface XrmOnboardingCardProps {
  reportingYear: number;
  sms: DashboardData['sms'];
  email?: DashboardData['email'];
  totalUnits: number;
}

/** Local onboarding signals — mirrors the xampp RMS onboarding-card pattern
 *  (get-started progress + Continue Setup CTA) but uses the local app's real
 *  setup milestones instead of Nyumbapay's onboarding.php flow. */
function setupProgress({ reportingYear, totalUnits, sms, email }: { reportingYear: number; totalUnits: number; sms: DashboardData['sms']; email?: DashboardData['email'] }): { done: number; total: number } {
  const items = [
    { icon: <Building2 size={15} strokeWidth={1.75} />, label: 'Property set up', done: totalUnits > 0 },
    { icon: <Users size={15} strokeWidth={1.75} />, label: 'Tenants added', done: false },
    { icon: <CreditCard size={15} strokeWidth={1.75} />, label: 'Payment mode live', done: false },
    { icon: <Smartphone size={15} strokeWidth={1.75} />, label: 'SMS configured', done: isSmsConfigured(sms, reportingYear) },
    { icon: <Mail size={15} strokeWidth={1.75} />, label: 'Email configured', done: isEmailConfigured(email) },
  ];
  // Tenants added + payment mode live are fetched on the units/tenants pages —
  // the dashboard knows units exist; tenants/payments are assumed in progress
  // until the operator opens those pages. Show them as the next milestones.
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length };
}

function isSmsConfigured(sms: DashboardData['sms'], reportingYear: number): boolean {
  const state = sms.balance.state;
  if (state === 'unknown' || state === 'unavailable') return false;
  if (state === 'ok' || state === 'low' || state === 'empty') return true;
  if (state === 'not_set_up') {
    if (reportingYear < 2025) return true;
    const d = new Date();
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    if (year > reportingYear || (year === reportingYear && month >= 4)) return true;
    return sms.sentThisMonth > 0 && sms.failedThisMonth === 0;
  }
  if (reportingYear < 2025) return true;
  const d = new Date();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  if (year > reportingYear || (year === reportingYear && month >= 4)) return true;
  return sms.sentThisMonth > 0 && sms.failedThisMonth === 0;
}
function isEmailConfigured(email: DashboardData['email'] | undefined): boolean {
  return !!email;
}

export function XrmOnboardingCard({ reportingYear, sms, email, totalUnits }: XrmOnboardingCardProps) {
  const { done, total } = setupProgress({ reportingYear, totalUnits, sms, email });
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = done >= total;

  if (allDone) return null; // xampp RMS hides the onboarding card at 100%

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 text-lg">
          ⚙️
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900">
            Getting Started: {pct}% Complete
          </h3>
          <p className="mt-0.5 text-xs text-gray-400">
            Set up your property, add tenants, and configure messaging to start collecting rent automatically.
          </p>
          <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-brand-500 transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <a
          href="/settings"
          className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-xs font-semibold text-gray-700 transition-colors duration-150 hover:bg-gray-50 active:scale-[0.98]"
        >
          Continue Setup →
        </a>
      </div>
    </div>
  );
}
