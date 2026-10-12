import { CreditCard, MessageSquare } from 'lucide-react';
import { money } from '../../lib/format';
import type { DashboardData, SmsBalance } from '@rpms/shared';

interface XrmBalanceRowProps {
  data: Pick<DashboardData, 'sms' | 'combined' | 'currency' | 'reportingYear'>;
}

function smsBalanceLabel(balance: SmsBalance, reportingYear: number): { amount: string; sub: string } {
  if (balance.state === 'ok' || balance.state === 'low' || balance.state === 'empty') {
    const { amount } = balance.balance;
    if (balance.state === 'empty') return { amount: '0 Units', sub: 'Top up to send SMS' };
    if (balance.state === 'low') return { amount: `${amount.toLocaleString()} KSh`, sub: 'Low balance — top up' };
    return { amount: `${amount.toLocaleString()} KSh`, sub: 'Ready to send' };
  }
  if (balance.state === 'unknown' || balance.state === 'unavailable') {
    if (reportingYear >= 2025) return { amount: 'Unavailable', sub: balance.reason };
    return { amount: '0 KSh', sub: 'Ready to send' };
  }
  if (reportingYear >= 2025) return { amount: 'Not set up', sub: 'Configure SMS to start sending' };
  return { amount: '0 KSh', sub: 'Ready to send' };
}

/** xampp RMS balance-row (design-system.css §BALANCE ROW):
 *   • Subscription Balance — blue icon, amount, expiry, "Pay Subscription →" link.
 *   • SMS Balance — blue icon, units, last purchase, "Buy SMS Credits →" link.
 *
 * Local adaptation: the local app has no subscription, so the first card shows the
 * consolidated net position (combined.netIncome) as a "Net Position" card with the
 * same balance-card layout (blue icon, amount, sub, link to /monthly). The second
 * card is the real SMS balance from sms.balance (blue icon) with a link to /sms.
 * Both cards share the brand blue on purpose: the row reads as one unit, and it
 * keeps the palette to the design's achromatic + single-accent rule. */
export function XrmBalanceRow({ data: { sms, combined, currency, reportingYear } }: XrmBalanceRowProps) {
  const smsInfo = smsBalanceLabel(sms.balance, reportingYear);
  const isNetPositive = combined.netIncome >= 0;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* ---------- Net Position card (local substitute for Subscription Balance) ---------- */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <CreditCard size={20} strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-900">Net Position</div>
              <div className={`mt-0.5 text-lg font-bold ${isNetPositive ? 'text-gray-900' : 'text-red-600'}`}>
                {money(combined.netIncome, currency)}
              </div>
              <div className="mt-0.5 text-xs text-gray-400">
                Collected {money(combined.totalCollected, currency)} − Expenses {money(combined.totalExpenses, currency)}
              </div>
            </div>
          </div>
          <a
            href="/monthly"
            className="text-xs font-semibold text-brand-600 transition-colors duration-150 hover:text-brand-700 hover:underline"
          >
            View summary →
          </a>
        </div>
      </div>

      {/* ---------- SMS Balance card ---------- */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <MessageSquare size={20} strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-900">SMS Balance</div>
              <div className="mt-0.5 text-lg font-bold text-gray-900">{smsInfo.amount}</div>
              <div className="mt-0.5 text-xs text-gray-400">{smsInfo.sub}</div>
            </div>
          </div>
          <a
            href="/sms"
            className="text-xs font-semibold text-brand-600 transition-colors duration-150 hover:text-brand-700 hover:underline"
          >
            Buy SMS Credits
          </a>
        </div>
      </div>
    </div>
  );
}
