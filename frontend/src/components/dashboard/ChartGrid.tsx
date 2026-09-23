// The nine-chart grid — presentational section extracted verbatim from
// pages/Dashboard.tsx. Includes the deferred-mount timer (charts paint one
// tick after the KPI strip), the serialization key that stops identical
// polls from replaying recharts draw animations, and the chart → page deep
// links (month bars open Receipts pre-filtered, unit bars open Arrears).
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type ChartDatum,
} from '../charts';
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { MONTHS, money, methodLabel } from '../../lib/format';
import { Badge, ChartCard, OutstandingList, SectionHead } from './primitives';
import type { DashboardData } from '@rpms/shared';

const PIE_COLORS = ['#1d6fd6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'];

// Charts mount one tick after the KPI strip paints: first paint shows the
// skeleton grid, then a short timer flips to the real charts. A timeout (not
// requestAnimationFrame/requestIdleCallback) because those never fire in a
// hidden/backgrounded tab — and a dashboard that sits in a background tab
// must still render correctly when it comes forward. The count-up displays
// live in components/CountUp.tsx (shared with the health cards below).
function useDeferredRender(delayMs = 120): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);
  return ready;
}

export function ChartGrid({ charts, currency, reportingYear, water }: {
  charts: DashboardData['charts'];
  currency: string;
  reportingYear: number;
  water: DashboardData['water'];
}) {
  // Charts re-mount only when the chart data itself changes: recharts
  // re-animates bars/pies on mount, so keying the grid on the serialized
  // charts keeps identical polls from replaying the draw every minute.
  const chartsKey = useMemo(() => JSON.stringify(charts), [charts]);
  const chartsReady = useDeferredRender();

  // Chart → page deep links: month bars open Receipts pre-filtered to that
  // month (rent bars → RENT receipts, water bars → WATER receipts); unit bars
  // open Arrears pre-filtered to that unit.
  const navigate = useNavigate();
  const monthReceipts = (type: 'RENT' | 'WATER') => (d: ChartDatum) =>
    navigate(`/receipts?month=${d.month}&receiptType=${type}`);
  const unitArrearsDirect = (row: { unitNumber: string }) =>
    navigate(`/arrears?unit=${encodeURIComponent(row.unitNumber)}`);

  const monthLabel = (m: number) => MONTHS[m - 1].slice(0, 3);

  // Derived presentation figures for the occupancy badge and water net bar.
  const occPct = charts.occupiedVsVacant.occupied + charts.occupiedVsVacant.vacant > 0
    ? Math.round((charts.occupiedVsVacant.occupied / (charts.occupiedVsVacant.occupied + charts.occupiedVsVacant.vacant)) * 100)
    : 0;
  const methodTotal = charts.rentByPaymentMethod.reduce((sum, m) => sum + m.total, 0);
  const dominantMethod = charts.rentByPaymentMethod.reduce<{ method: string; total: number } | null>(
    (best, m) => (!best || m.total > best.total ? m : best), null,
  );
  const dominantShare = dominantMethod && methodTotal > 0 ? Math.round((dominantMethod.total / methodTotal) * 100) : 0;

  return (
    <div className="mt-8">
      <SectionHead label="Charts" caption={<>FY {reportingYear} · click any chart to drill in</>} />
      {chartsReady ? (
      <div key={chartsKey} className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ChartCard title="Monthly Rent Collected" meta={currency} to="/rent">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.monthlyRentCollected} onBarClick={monthReceipts('RENT')}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={(d: any) => monthLabel(d.month)} />
              <YAxis />
              <Tooltip formatter={(v: any) => money(v, currency)} />
              <Bar dataKey="collected" fill="#1d6fd6" name="Rent collected" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Expected vs Collected Rent" to="/rent">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.expectedVsCollected} onBarClick={monthReceipts('RENT')}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={(d: any) => monthLabel(d.month)} />
              <YAxis />
              <Tooltip formatter={(v: any) => money(v, currency)} />
              <Legend />
              <Bar dataKey="expected" fill="#cbd5e1" name="Expected" />
              <Bar dataKey="collected" fill="#10b981" name="Collected" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Unit Occupancy Spread"
          meta={<Badge tone={occPct >= 90 ? 'good' : 'warn'}>{occPct}% Occupied</Badge>}
          to="/units"
        >
          <div className="relative">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart onSliceClick={() => navigate('/units')}>
                <Pie
                  data={[{ name: 'Occupied', value: charts.occupiedVsVacant.occupied }, { name: 'Vacant', value: charts.occupiedVsVacant.vacant }]}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={92}
                  label={false}
                >
                  <Cell fill="#1d6fd6" />
                  <Cell fill="#f59e0b" />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            {/* Donut center readout — pointer-events none so slice clicks pass through. */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold tabular-nums text-gray-900">{occPct}%</span>
              <span className="text-[11px] text-gray-500">Occupancy</span>
            </div>
            <div className="mt-1 flex justify-center gap-4 text-[11px] text-gray-600">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-brand-600" aria-hidden /> Occupied: {charts.occupiedVsVacant.occupied}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-400" aria-hidden /> Vacant: {charts.occupiedVsVacant.vacant}</span>
            </div>
          </div>
        </ChartCard>

        <ChartCard
          title="Payment Method Mix"
          meta={money(methodTotal, currency)}
          to="/receipts"
        >
          <div className="relative">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart onSliceClick={() => navigate('/receipts')}>
                {/* Method-filtered receipts don't exist as a page filter yet, so
                    slice clicks land on the receipts list as a whole. */}
                <Pie data={charts.rentByPaymentMethod} dataKey="total" nameKey="method" innerRadius={62} outerRadius={92} label={false}>
                  {charts.rentByPaymentMethod.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => money(v, currency)} />
              </PieChart>
            </ResponsiveContainer>
            {dominantMethod && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="max-w-[7rem] truncate text-center text-sm font-bold text-gray-900">{methodLabel(dominantMethod.method)}</span>
                <span className="text-[11px] text-gray-500">{dominantShare}% dominant</span>
              </div>
            )}
            <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
              {charts.rentByPaymentMethod.map((m, i) => (
                <span key={m.method} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} aria-hidden />
                  {methodLabel(m.method)} {methodTotal > 0 ? Math.round((m.total / methodTotal) * 100) : 0}%
                </span>
              ))}
            </div>
          </div>
        </ChartCard>

        <ChartCard
          title="Top Outstanding Rent"
          meta={<Link to="/arrears" className="font-semibold text-brand-700 hover:underline">Full arrears →</Link>}
        >
          <OutstandingList rows={charts.outstandingRentByUnit} currency={currency} barClass="bg-red-500" onSelect={unitArrearsDirect} />
        </ChartCard>

        <ChartCard title="Water Billed vs Collected" meta={currency} to="/water-payments">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.monthlyWaterBilledVsCollected} onBarClick={monthReceipts('WATER')}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={(d: any) => monthLabel(d.month)} />
              <YAxis />
              <Tooltip formatter={(v: any) => money(v, currency)} />
              <Legend />
              <Bar dataKey="billed" fill="#60a5fa" name="Billed" />
              <Bar dataKey="collected" fill="#10b981" name="Collected" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Supply Cost vs Collected" meta={currency} to="/water-supply">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={charts.waterSupplyCostVsCollected}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={(d: any) => monthLabel(d.month)} />
              <YAxis />
              <Tooltip formatter={(v: any) => money(v, currency)} />
              <Legend />
              <Line type="monotone" dataKey="supplyCost" stroke="#f59e0b" name="Supply cost" />
              <Line type="monotone" dataKey="collected" stroke="#10b981" name="Collected" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Monthly Water Net Balance" meta={<Badge tone={water.surplus ? 'good' : 'bad'}>{water.surplus ? 'All Positive' : 'Deficit Present'}</Badge>} to="/water-supply">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.monthlyWaterSurplusDeficit} onBarClick={() => navigate('/water-supply')}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={(d: any) => monthLabel(d.month)} />
              <YAxis />
              <Tooltip formatter={(v: any) => money(v, currency)} />
              <Bar dataKey="surplusDeficit" name="Surplus / Deficit">
                {charts.monthlyWaterSurplusDeficit.map((d, i) => (
                  <Cell key={i} fill={d.surplusDeficit >= 0 ? '#10b981' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Outstanding Water by Unit"
          meta={<Link to="/arrears" className="font-semibold text-brand-700 hover:underline">Arrears →</Link>}
        >
          <OutstandingList rows={charts.outstandingWaterByUnit} currency={currency} barClass="bg-purple-500" onSelect={unitArrearsDirect} />
        </ChartCard>
      </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="h-[318px] animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
          ))}
        </div>
      )}
    </div>
  );
}
