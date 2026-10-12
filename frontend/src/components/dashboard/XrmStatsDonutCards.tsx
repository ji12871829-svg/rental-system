import { money } from '../../lib/format';
import type { DashboardData } from '@rpms/shared';

interface XrmStatsDonutCardsProps {
  data: Pick<DashboardData, 'property' | 'currency' | 'reportingYear'>;
}

function Donut({ percentage, size = 140, color = '#22c55e' }: { percentage: number; size?: number; color?: string }) {
  const radius = (size - 28) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const half = size / 2;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="block rotate-[-90deg]">
        <circle cx={half} cy={half} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={14} />
        <circle cx={half} cy={half} r={radius} fill="none" stroke={color} strokeWidth={14} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center" style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
        <div className="text-xl font-bold text-gray-900">{percentage}%</div>
        <div className="text-[9px] text-gray-400 uppercase tracking-wider">Collected</div>
      </div>
    </div>
  );
}

/** xampp RMS stats-row (design-system.css §STATS CARDS):
 *   • Rent Collection — donut (collection %) + legend: Total Billed / Total Paid /
 *     Balance Due. Local data: expected rent = Total Billed, rent collected = Total
 *     Paid, rent outstanding = Balance Due.
 *   • Portfolio Occupancy — donut (occupancy %) + breakdown: Total Units / Occupied /
 *     Vacant + Add Tenants / Remove actions. Local data: property.totalUnits /
 *     occupiedUnits / vacantUnits. */
export function XrmStatsDonutCards({ data: { property, currency } }: XrmStatsDonutCardsProps) {
  const totalExpected = property.expectedRentYtd;
  const totalCollected = property.rentCollected;
  const totalDue = property.rentOutstanding;
  const collectionPct = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0;
  const totalUnits = property.totalUnits;
  const occupied = property.occupiedUnits;
  const vacant = property.vacantUnits;
  const occPct = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* ---------- Rent Collection stats card ---------- */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Rent Collection</h3>
          <div className="flex gap-2">
            {/* date-filters mirror disabled — local dashboard polls live, no date drill.
                Keep the visual slot empty so the card reads like the reference. */}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-6">
          <Donut percentage={collectionPct} color="#22c55e" />
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="h-2 w-2 rounded-full bg-gray-300" /> Total Billed
              </div>
              <div className="text-xs font-semibold text-gray-900">{money(totalExpected, currency)}</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Total Paid
              </div>
              <div className="text-xs font-semibold text-emerald-700">{money(totalCollected, currency)}</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="h-2 w-2 rounded-full bg-red-500" /> Balance Due
              </div>
              <div className="text-xs font-semibold text-red-700">{money(totalDue, currency)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Portfolio Occupancy stats card ---------- */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Portfolio Occupancy</h3>
        </div>
        <div className="mt-4 flex items-center gap-6">
          <Donut percentage={occPct} color="#3b82f6" />
          <div className="flex-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-gray-500">
                  <span className="h-2 w-2 rounded-full bg-gray-300" /> Total Units
                </div>
                <div className="text-xs font-semibold text-gray-900">{totalUnits} Units</div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-gray-500">
                  <span className="h-2 w-2 rounded-full bg-blue-500" /> Occupied
                </div>
                <div className="text-xs font-semibold text-gray-900">{occupied} Units</div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-gray-500">
                  <span className="h-2 w-2 rounded-full bg-gray-400" /> Vacant
                </div>
                <div className="text-xs font-semibold text-gray-900">{vacant} Units</div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <a
                href="/tenants?new=1"
                className="flex-1 rounded-lg border border-emerald-500 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors duration-150 hover:bg-emerald-100 active:scale-[0.98]"
              >
                + Add Tenants
              </a>
              <a
                href="/tenants"
                className="flex-1 rounded-lg border border-red-500 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors duration-150 hover:bg-red-100 active:scale-[0.98]"
              >
                − Remove
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
