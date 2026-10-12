import { AlertTriangle, ArrowRight, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { money } from '../../lib/format';
import type { DashboardData } from '@rpms/shared';

interface XrmArrearsMetricCardsProps {
  data: Pick<DashboardData, 'combined' | 'currency' | 'reportingYear'> & {
    outstandingRentUnits: number;
  };
}

/** xampp RMS metric-row (design-system.css §METRIC CARDS):
 *   • Tenant Arrears — red icon, KES amount, "X Tenants currently in debt" sub,
 *     View Details + Send Reminders actions.
 *   • Tenant Advance — green icon, KES amount, "X Tenants with credit balances" sub,
 *     View Details action.
 *
 * Local adaptation uses DashboardData.combined.totalOutstanding (rent + water
 * outstanding) as the arrears figure. The advance figure comes from real
 * per-tenant credit balances (combined.tenantAdvances from the backend)
 * when the payload carries them — falling back to the old derived-negative
 * view of totalOutstanding on payloads that predate the field. The arrears
 * unit count comes from charts.outstandingRentByUnit filtered to > 0 (in the
 * dashboard payload). */
export function XrmArrearsMetricCards({ data }: XrmArrearsMetricCardsProps) {
  const { totalOutstanding, tenantAdvances } = data.combined;
  const { currency } = data;
  const arrears = Math.max(0, totalOutstanding);
  // Real credit-balance data wins; older payloads only expose the negative
  // outstanding view (portfolio-wide overpayment, no per-tenant truth).
  const advances = tenantAdvances ? tenantAdvances.total : (totalOutstanding < 0 ? Math.abs(totalOutstanding) : 0);
  const advanceCount = tenantAdvances ? tenantAdvances.count : null;
  const isArrears = arrears > 0;
  const isAdvances = advances > 0;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* ---------- Tenant Arrears card ---------- */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-900">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
            <AlertTriangle size={15} strokeWidth={1.75} />
          </div>
          Tenant Arrears
        </div>
        <div className={`mt-3 text-xl font-bold tabular-nums ${isArrears ? 'text-red-700' : 'text-emerald-700'}`}>
          {money(arrears, currency)}
        </div>
        <div className="mt-1 text-xs text-gray-400">
          <strong className="text-gray-900">{data.outstandingRentUnits} units</strong>
          {' '}currently in debt
        </div>
        <div className="mt-4 flex gap-2">
          <Link
            to="/arrears"
            className="flex-1 flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 hover:border-gray-300 active:scale-[0.98]"
          >
            View Details <ArrowRight size={13} strokeWidth={2} className="ml-1" />
          </Link>
          <Link
            to="/sms?compose=arrears"
            className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-brand-700 active:scale-[0.98]"
          >
            Send Reminders
          </Link>
        </div>
      </div>

      {/* ---------- Tenant Advance card ---------- */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-900">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <Wallet size={15} strokeWidth={1.75} />
          </div>
          Tenant Advance
        </div>
        <div className={`mt-3 text-xl font-bold tabular-nums ${isAdvances ? 'text-emerald-700' : 'text-gray-400'}`}>
          {money(advances, currency)}
        </div>
        <div className="mt-1 text-xs text-gray-400">
          <strong className="text-gray-900">{isAdvances ? `${advanceCount ?? 0} Tenants` : 'No tenants'}</strong>
          {' '}with credit balances
        </div>
        {/* flex row, not a bare div: `flex-1` on the link only works as a flex
            item, and preflight's `svg { display: block }` splits an inline link
            around the arrow icon (narrow first fragment + stray second one). */}
        <div className="mt-4 flex gap-2">
          <Link
            to="/tenants"
            className="flex-1 flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 hover:border-gray-300 active:scale-[0.98]"
          >
            View Details <ArrowRight size={13} strokeWidth={2} className="ml-1" />
          </Link>
        </div>
      </div>
    </div>
  );
}
