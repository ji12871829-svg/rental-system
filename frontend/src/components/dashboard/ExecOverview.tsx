// Executive dashboard top band — the header (title + current-cycle badge +
// date range + export action) and the four KPI cards that open the page:
//   1. Collected Rent (MTD)  — month-to-date against the month's target
//   2. Overdue Arrears       — open rent + water balances + overdue count
//   3. Tenant Prepayments    — credit balances held for tenants in advance
//   4. Occupancy Rate        — occupied/total with a donut
//
// Everything here reads the shared DashboardData payload (one request, the
// same contract backend/src/services/financeService.ts dashboard() returns)
// plus the arrears report rows the page fetches once and hands down, so the
// KPI cards and the watchlist table can never show different totals.
import { AlertTriangle, BadgeCheck, Building2, CalendarDays, Download, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MONTHS, money, plural } from '../../lib/format';
import type { DashboardData } from '@rpms/shared';
import type { ArrearRow } from '../../pages/Arrears';

/**
 * The month the dashboard is currently reporting through — the frontend twin
 * of the backend's `reportingThroughMonth()`: the real calendar month inside
 * the reporting year, December for a completed prior year, January for a year
 * that has not started. Used to pick the MTD / previous-month slice of
 * `charts.expectedVsCollected` and to render the cycle badge.
 */
export function currentReportingMonth(reportingYear: number): number {
  const now = new Date();
  if (reportingYear < now.getFullYear()) return 12;
  if (reportingYear > now.getFullYear()) return 1;
  return now.getMonth() + 1;
}

/** Card shell shared by the four KPI cards: label + tinted icon + body. */
function KpiShell({
  label,
  icon,
  tint,
  children,
  linkTo,
  linkLabel,
}: {
  label: string;
  icon: React.ReactNode;
  tint: string;
  children: React.ReactNode;
  // Optional hub link — turns the card into one click to the page behind
  // the number (e.g. Overdue Arrears → /arrears).
  linkTo?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">{label}</span>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tint}`} aria-hidden>
          {icon}
        </span>
      </div>
      <div className="mt-2 flex-1">{children}</div>
      {linkTo && (
        <Link to={linkTo} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 transition-colors duration-150 hover:text-brand-700 hover:underline">
          {linkLabel ?? 'View →'}
        </Link>
      )}
    </div>
  );
}

/** Small donut used by the occupancy card (SVG, no chart dependency). */
function Donut({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 56 56" className="block h-14 w-14 -rotate-90" aria-hidden>
        {/* Track uses text-gray-300 (dark-remapped) rather than gray-200: an
            unremapped track ring would stay bright white-grey on a dark card. */}
        <circle cx="28" cy="28" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-gray-300" />
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-brand-500 transition-all duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-700">{clamped}%</span>
    </div>
  );
}

/** Page head: title + supporting line on the left, cycle badge / date range /
 *  Export Pack action on the right — the reference layout's top bar. */
export function ExecOverviewHeader({ reportingYear }: { reportingYear: number }) {
  const month = currentReportingMonth(reportingYear);
  const monthName = MONTHS[month - 1] ?? '';
  const shortMonth = monthName.slice(0, 3);
  const lastDay = new Date(reportingYear, month, 0).getDate();
  const range = `${shortMonth} 1 – ${shortMonth} ${lastDay}, ${reportingYear}`;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Olbano Plaza Overview</h1>
        <p className="mt-1 text-sm text-gray-500">
          Rent, arrears and occupancy from recorded transactions · reporting year {reportingYear}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          Current cycle: {shortMonth} {reportingYear}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-600">
          <CalendarDays size={13} strokeWidth={1.75} className="text-gray-400" aria-hidden />
          {range}
        </span>
        {/* Export Pack → the Monthly Summary page, where every report export
            (PDF/CSV/email) lives. Deep-links, never a silent download.
            border-ash keeps the dark button legible in dark mode, where the
            page canvas is nearly the same black (see tailwind.config.js). */}
        <Link
          to="/monthly"
          className="inline-flex items-center gap-1.5 rounded-lg border border-ash bg-ink px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-charcoal active:scale-[0.98]"
        >
          <Download size={14} strokeWidth={2} aria-hidden />
          Export Pack
        </Link>
      </div>
    </div>
  );
}

interface ExecKpiRowProps {
  data: DashboardData;
  /** Arrears report rows (null while the first fetch is in flight). */
  arrears: ArrearRow[] | null;
}

/** Four KPI cards. */
export function ExecKpiRow({ data, arrears }: ExecKpiRowProps) {
  const { property, combined, charts, currency, reportingYear } = data;
  const month = currentReportingMonth(reportingYear);
  const monthName = (MONTHS[month - 1] ?? '').slice(0, 3);

  // Collected MTD vs the month's target, plus the delta against last month —
  // both slices of the same expectedVsCollected series the chart below uses.
  const current = charts.expectedVsCollected.find((s) => s.month === month);
  const previous = charts.expectedVsCollected.find((s) => s.month === month - 1);
  const collected = current?.collected ?? 0;
  const target = current?.expected ?? 0;
  const attainment = target > 0 ? Math.min(100, Math.round((collected / target) * 1000) / 10) : 0;
  const previousMonthName = (MONTHS[month - 2] ?? '').slice(0, 3);
  const deltaPct =
    previous && previous.collected > 0 ? ((collected - previous.collected) / previous.collected) * 100 : null;

  // Arrears counts come from the report rows (same source as the watchlist).
  // While the fetch is in flight the cards show an em dash instead of a
  // confident-looking zero.
  const inArrears = arrears ? arrears.filter((r) => r.totalOutstanding > 0).length : null;
  const overdue = arrears ? arrears.filter((r) => r.status === 'OVERDUE' || r.status === 'UNPAID').length : null;
  const advances = combined.tenantAdvances;

  const occupancyPct =
    property.totalUnits > 0 ? Math.round((property.occupiedUnits / property.totalUnits) * 100) : 0;

  const deltaGood = (deltaPct ?? 0) >= 0;

  return (
    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {/* 1. Collected rent, month to date */}
      <KpiShell label="Collected Rent (MTD)" tint="bg-emerald-50 text-emerald-600" icon={<Wallet size={16} strokeWidth={1.75} />}>
        <div className="text-2xl font-bold text-gray-900">{money(collected, currency)}</div>
        {deltaPct !== null ? (
          <span
            className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
              deltaGood ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {deltaGood ? <TrendingUp size={11} strokeWidth={2.5} aria-hidden /> : <TrendingDown size={11} strokeWidth={2.5} aria-hidden />}
            {deltaGood ? '+' : ''}
            {deltaPct.toFixed(1)}% vs {previousMonthName}
          </span>
        ) : null}
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div className="h-full rounded-full bg-brand-500 transition-all duration-700" style={{ width: `${attainment}%` }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-gray-500">
          <span className="truncate">{attainment}% of {money(target, currency)}</span>
          <span className="shrink-0 font-semibold text-gray-600">{monthName} target</span>
        </div>
      </KpiShell>

      {/* 2. Overdue arrears — rent + water still open this reporting year.
          One click on the card footer opens the full debtors list. */}
      <KpiShell label="Overdue Arrears" tint="bg-red-50 text-red-600" icon={<AlertTriangle size={16} strokeWidth={1.75} />} linkTo="/arrears" linkLabel="View debtors →">
        <div className="text-2xl font-bold text-gray-900">{money(combined.totalOutstanding, currency)}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
            {overdue ?? '—'} Overdue
          </span>
          <span className="text-[11px] text-gray-500">
            {inArrears === null
              ? 'loading tenants…'
              : `${plural(inArrears, 'tenant')} ${inArrears === 1 ? 'needs' : 'need'} attention`}
          </span>
        </div>
        <div className="mt-3 text-[11px] text-gray-500">Rent + water balances still open this reporting year</div>
      </KpiShell>

      {/* 3. Tenant prepayments — credit balances, carried not chased */}
      <KpiShell label="Tenant Prepayments" tint="bg-blue-50 text-blue-800" icon={<BadgeCheck size={16} strokeWidth={1.75} />}>
        <div className="text-2xl font-bold text-gray-900">{money(advances?.total ?? 0, currency)}</div>
        <div className="mt-1 text-[11px] text-gray-500">
          {advances ? `${plural(advances.count, 'tenant')} paying in advance` : 'credit balances held'}
        </div>
        <div className="mt-3 text-[11px] text-gray-500">Prepaid rent carried into the next cycle</div>
      </KpiShell>

      {/* 4. Occupancy — donut + unit split */}
      <KpiShell label="Occupancy Rate" tint="bg-amber-50 text-amber-700" icon={<Building2 size={16} strokeWidth={1.75} />}>
        <div className="flex items-center gap-3">
          <Donut pct={occupancyPct} />
          <div className="min-w-0">
            <div className="text-2xl font-bold text-gray-900">{occupancyPct}%</div>
            <div className="text-[11px] text-gray-500">
              {property.occupiedUnits}/{property.totalUnits} units live
            </div>
            <div className="text-[11px] text-gray-400">{property.vacantUnits} vacant</div>
          </div>
        </div>
      </KpiShell>
    </div>
  );
}
