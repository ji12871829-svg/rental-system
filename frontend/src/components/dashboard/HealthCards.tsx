// The Messaging band (SMS + email provider health) — extracted verbatim from
// pages/Dashboard.tsx. Renders nothing when the payload carries neither
// provider block (older backends / nothing configured yet).
import { Count, CountMoney } from '../CountUp';
import { Link } from 'react-router-dom';
import { SectionHead } from './primitives';
import type { DashboardData, LastFailure, SmsBalance } from '@rpms/shared';

export function HealthCards({ data }: { data: DashboardData }) {
  if (!data.sms && !data.email) return null;
  return (
    <div className="mt-8">
      <SectionHead label="Messaging" caption="Delivery pipelines & provider health" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.sms && <SmsHealthCard sms={data.sms} />}
        {data.email && <EmailHealthCard email={data.email} />}
      </div>
    </div>
  );
}

// Compact wallet badge mirroring the SMS page banner semantics: green ok,
// amber low, red empty; muted text for unknown/unavailable (mock mode, Twilio
// or a failed provider call) so it never looks like an alarm.
// SmsBalance (the SMS wallet contract) is imported from @rpms/shared.
function SmsWalletBadge({ balance }: { balance: SmsBalance }) {
  // Wallet amount counts up when a poll changes it; CountMoney carries the
  // currency prefix itself.
  const amount = 'balance' in balance
    ? <CountMoney value={balance.balance.amount} currency={balance.balance.currency} />
    : '';
  if (balance.state === 'unknown' || balance.state === 'unavailable') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500"
        title={balance.reason}
      >
        SMS wallet — not monitored
      </span>
    );
  }
  if (balance.state === 'empty') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
        <span className="alert-pulse h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden /> SMS wallet empty — {amount}
      </span>
    );
  }
  if (balance.state === 'low') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
        <span className="alert-pulse h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden /> SMS wallet low — {amount}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /> SMS wallet {amount}
    </span>
  );
}

// Shared shell for the two provider cards. Tone drives the left border: red
// when something needs attention (failures / empty wallet), amber for a low
// wallet, neutral otherwise. The header carries the page deep link.
function HealthCard({
  title,
  tone,
  to,
  linkLabel,
  children,
}: {
  title: string;
  tone: 'neutral' | 'warn' | 'bad';
  to: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  const border = tone === 'bad' ? 'border-l-4 border-l-red-500' : tone === 'warn' ? 'border-l-4 border-l-amber-400' : '';
  return (
    <Link
      to={to}
      className={`block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors duration-150 hover:bg-gray-50 ${border}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-gray-900">{title}</span>
        <span className="text-xs font-medium text-brand-700">{linkLabel} →</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">{children}</div>
    </Link>
  );
}

// The most recent failed send this month, with a short relative time and the
// provider's own reason. Truncates on one line; the full text is in the title
// tooltip and on the linked history page.
function LastFailureLine({ failure }: { failure: LastFailure }) {
  const ago = timeAgo(failure.at);
  return (
    <span
      className="max-w-full truncate rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700"
      title={`Last failure ${ago}: ${failure.reason}`}
    >
      <span className="font-semibold">Last failure {ago}:</span> {failure.reason}
    </span>
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function SmsHealthCard({ sms }: { sms: DashboardData['sms'] }) {
  const walletTone = sms.balance.state === 'empty' || sms.failedThisMonth > 0 ? 'bad' : sms.balance.state === 'low' ? 'warn' : 'neutral';
  return (
    <HealthCard title="SMS Gateway Provider" tone={walletTone} to="/sms" linkLabel="Manage SMS">
      <SmsWalletBadge balance={sms.balance} />
      <span className="text-sm text-gray-600">
        <span className="font-semibold text-gray-900"><Count value={sms.sentThisMonth} /></span> sent this month
      </span>
      <span className="text-sm text-gray-600">
        <span className={`font-semibold ${sms.failedThisMonth > 0 ? 'text-red-600' : 'text-gray-900'}`}><Count value={sms.failedThisMonth} /></span> failed
      </span>
      {sms.lastFailure && <LastFailureLine failure={sms.lastFailure} />}
    </HealthCard>
  );
}

function EmailHealthCard({ email }: { email: NonNullable<DashboardData['email']> }) {
  const emailTone = email.failedThisMonth > 0 ? 'bad' : email.pendingCount > 0 ? 'warn' : 'neutral';
  return (
    <HealthCard title="SMTP Relay Dispatch" tone={emailTone} to="/email-campaign" linkLabel="Tenant Email">
      <span className="text-sm text-gray-600">
        <span className="font-semibold text-gray-900"><Count value={email.sentThisMonth} /></span> sent this month
      </span>
      <span className="text-sm text-gray-600">
        <span className={`font-semibold ${email.failedThisMonth > 0 ? 'text-red-600' : 'text-gray-900'}`}><Count value={email.failedThisMonth} /></span> failed
      </span>
      {email.pendingCount > 0 && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700"
          title="Composed emails still queued — the provider has not confirmed a send yet. Check Settings for the provider status."
        >
          <span className="alert-pulse h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden /> <Count value={email.pendingCount} /> pending
        </span>
      )}
      {email.lastFailure && <LastFailureLine failure={email.lastFailure} />}
    </HealthCard>
  );
}
