import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type ChartDatum,
} from '../components/charts';
import { PageHeader, useFetch, SkeletonDashboard } from '../components/ui';
import { QuickActions } from '../components/QuickActions';
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { MONTHS, money, methodLabel } from '../lib/format';

interface DashboardData {
  reportingYear: number;
  currency: string;
  property: {
    totalUnits: number; occupiedUnits: number; vacantUnits: number;
    expectedRent: number; expectedRentYtd: number; rentCollected: number;
    rentOutstanding: number; rentCollectionRate: number; totalExpenses: number;
    netPropertyIncome: number;
  };
  water: {
    waterBilled: number; waterCollected: number; waterOutstanding: number;
    waterPurchased: number; waterSupplyCost: number; averagePurchaseCost: number;
    collectionRate: number; surplusDeficit: number; surplus: boolean;
  };
  combined: {
    totalDueThisMonth: number; totalCollected: number; totalOutstanding: number;
    rentCollected: number; waterCollected: number; totalExpenses: number; netIncome: number;
  };
  sms: {
    // Single-literal members so `state === 'x'` checks narrow exactly.
    balance:
      | { state: 'unknown'; reason: string }
      | { state: 'unavailable'; reason: string }
      | { state: 'ok'; balance: { amount: number; currency: string }; threshold: number | null }
      | { state: 'low'; balance: { amount: number; currency: string }; threshold: number | null }
      | { state: 'empty'; balance: { amount: number; currency: string }; threshold: number | null };
    sentThisMonth: number;
    failedThisMonth: number;
    // Most recent FAILED send this month, so the strip can show why without
    // a trip to Settings. Optional: older API payloads predate it.
    lastFailure?: { at: string; reason: string } | null;
  };
  email?: {
    sentThisMonth: number;
    failedThisMonth: number;
    pendingCount: number;
    lastFailure: { at: string; reason: string } | null;
  };
  charts: {
    monthlyRentCollected: { month: number; collected: number }[];
    expectedVsCollected: { month: number; expected: number; collected: number }[];
    occupiedVsVacant: { occupied: number; vacant: number };
    rentByPaymentMethod: { method: string; total: number }[];
    outstandingRentByUnit: { unitNumber: string; outstanding: number }[];
    monthlyWaterBilledVsCollected: { month: number; billed: number; collected: number }[];
    waterSupplyCostVsCollected: { month: number; supplyCost: number; collected: number }[];
    monthlyWaterSurplusDeficit: { month: number; surplusDeficit: number }[];
    outstandingWaterByUnit: { unitNumber: string; waterOutstanding: number }[];
  };
}

const PIE_COLORS = ['#1d6fd6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'];

// Live-poll cadence for the KPI strip and provider health. Quiet by design:
// failed polls keep the last good data and retry next tick, hidden tabs skip
// ticks entirely, and returning to the tab refetches immediately.
const POLL_MS = 60_000;

// Charts mount one tick after the KPI strip paints: first paint shows the
// skeleton grid, then a short timer flips to the real charts. A timeout (not
// requestAnimationFrame/requestIdleCallback) because those never fire in a
// hidden/backgrounded tab — and a dashboard that sits in a background tab
// must still render correctly when it comes forward.
function useDeferredRender(delayMs = 120): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);
  return ready;
}

// --- Count-up ----------------------------------------------------------------
// Animates a numeric display from its previous value toward a new one so a
// poll-driven change is *seen* rather than silently swapped. 600ms ease-out,
// requestAnimationFrame-driven. First paint shows the target immediately (no
// 0-to-N theater on load), prefers-reduced-motion jumps straight to the
// target, and a poll landing mid-animation resumes from the painted value.
function useCountUp(target: number, durationMs = 600): { value: number; flash: boolean } {
  const [display, setDisplay] = useState(target);
  const [flash, setFlash] = useState(false);
  const fromRef = useRef(target);
  const rafRef = useRef(0);
  const flashTimer = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    // Signal the change so the display can flash (CSS keyframe, index.css).
    window.clearTimeout(flashTimer.current);
    setFlash(true);
    flashTimer.current = window.setTimeout(() => setFlash(false), 1100);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || document.visibilityState === 'hidden') {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / durationMs);
      const eased = 1 - Math.pow(1 - k, 3);
      if (k < 1) {
        setDisplay(from + (target - from) * eased);
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
        setDisplay(target);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      window.clearTimeout(flashTimer.current);
      cancelAnimationFrame(rafRef.current);
      // Preserve partial progress as the next animation's start point if a
      // newer target arrived mid-flight.
      setDisplay((cur) => {
        fromRef.current = cur;
        return cur;
      });
    };
  }, [target, durationMs]);

  return { value: display, flash };
}

// Formatted count-up displays for the polled KPI strip. Both keep the label
// readable while animating (real text, no icon-only swap) and hold still
// when a poll returns unchanged numbers.
function CountMoney({ value, currency }: { value: number; currency?: string }) {
  const { value: v, flash } = useCountUp(value);
  return <span className={flash ? 'value-flash' : undefined}>{money(v, currency)}</span>;
}

function Count({ value }: { value: number }) {
  const { value: v, flash } = useCountUp(value);
  return <span className={flash ? 'value-flash' : undefined}>{Math.round(v).toLocaleString('en-KE')}</span>;
}

// ---------------------------------------------------------------------------
// Layout primitives for the operational-band design.
// ---------------------------------------------------------------------------

// Section eyebrow: tiny uppercase label left, context caption right — every
// band on the page gets one so the eye can parse the page as chapters.
function SectionHead({ label, caption }: { label: string; caption?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">{label}</h2>
      {caption && <div className="text-[11px] text-gray-400">{caption}</div>}
    </div>
  );
}

// Small pill badge used in card headers (collection %, margin, wallet…).
function Badge({ tone = 'good', children, title }: { tone?: 'good' | 'bad' | 'warn' | 'neutral'; children: React.ReactNode; title?: string }) {
  const tones: Record<string, string> = {
    good: 'bg-emerald-100 text-emerald-700',
    bad: 'bg-red-100 text-red-700',
    warn: 'bg-amber-100 text-amber-700',
    neutral: 'bg-gray-100 text-gray-600',
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

// Big-number card: uppercase mini title row (with optional right-side badge /
// link), a huge money/count figure, then a muted footer line. The shell the
// whole KPI band uses.
function KpiCard({
  title,
  badge,
  linkTo,
  linkLabel,
  children,
  footer,
}: {
  title: React.ReactNode;
  badge?: React.ReactNode;
  linkTo?: string;
  linkLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {/* flex-wrap: when the title + badge + link don't fit one row, the
          right side drops below the title instead of squeezing the title
          into three stacked lines. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500 sm:flex-none">{title}</span>
        <span className="flex shrink-0 items-center gap-2">
          {badge}
          {linkTo && (
            <Link
              to={linkTo}
              className="text-[11px] font-semibold text-brand-700 underline-offset-2 transition-colors hover:text-brand-800 hover:underline"
            >
              {linkLabel} →
            </Link>
          )}
        </span>
      </div>
      <div className="mt-3 flex-1">{children}</div>
      {footer && <div className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-500">{footer}</div>}
    </div>
  );
}

// Huge figure + optional caption underneath, the KpiCard body workhorse.
function BigFigure({ value, caption, tone = 'default' }: { value: React.ReactNode; caption?: React.ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn' }) {
  const tones: Record<string, string> = {
    default: 'text-gray-900',
    good: 'text-emerald-600',
    bad: 'text-red-600',
    warn: 'text-amber-600',
  };
  return (
    <div>
      <div className={`text-2xl font-bold tracking-tight tabular-nums sm:text-[1.7rem] ${tones[tone]}`}>{value}</div>
      {caption && <div className="mt-0.5 text-[11px] text-gray-400">{caption}</div>}
    </div>
  );
}

// Multi-column stat row inside a card (the reference's 3-up figures with a
// caption under each number).
function FigureRow({ items }: { items: { label: string; value: React.ReactNode; caption?: React.ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn' }[] }) {
  const tones: Record<string, string> = {
    default: 'text-gray-900',
    good: 'text-emerald-600',
    bad: 'text-red-600',
    warn: 'text-amber-600',
  };
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label}>
          <div className="text-[11px] font-medium text-gray-500">{it.label}</div>
          <div className={`mt-0.5 text-lg font-bold tabular-nums sm:text-xl ${tones[it.tone ?? 'default']}`}>{it.value}</div>
          {it.caption && <div className="mt-0.5 text-[11px] text-gray-400">{it.caption}</div>}
        </div>
      ))}
    </div>
  );
}

// Occupancy progress: brand segment for occupied, amber tail for vacant.
function OccupancyBar({ total, occupied, vacant }: { total: number; occupied: number; vacant: number }) {
  const occPct = total > 0 ? Math.round((occupied / total) * 100) : 0;
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100"
      role="img"
      aria-label={`${occPct}% occupied, ${vacant} vacant of ${total} units`}
    >
      <div className="h-full bg-brand-600 transition-[width] duration-700" style={{ width: `${occPct}%` }} />
      <div className="h-full bg-amber-400 transition-[width] duration-700" style={{ width: `${total > 0 ? (vacant / total) * 100 : 0}%` }} />
    </div>
  );
}

// Ranked outstanding list — the reference's horizontal red/purple bars with
// the amount right-aligned on each row. Bars scale to the largest debt; each
// row deep-links into the arrears page pre-filtered to that unit.
function OutstandingList({
  rows,
  currency,
  barClass,
  onSelect,
}: {
  rows: { unitNumber: string; [k: string]: number | string }[];
  currency: string;
  barClass: string;
  onSelect: (row: { unitNumber: string }) => void;
}) {
  const key = rows.length > 0 && 'outstanding' in rows[0] ? 'outstanding' : 'waterOutstanding';
  // Only units that actually owe, worst first, capped like the reference's
  // five-row lists — a clean property shows the all-current message, not
  // ten rows of KSh 0.
  const debtors = rows.filter((r) => Number(r[key]) > 0).slice(0, 5);
  const max = Math.max(...debtors.map((r) => Number(r[key])), 1);
  if (debtors.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-400">Nothing outstanding — every unit is current.</p>;
  }
  return (
    <ul className="space-y-2.5">
      {debtors.map((r) => {
        const amount = Number(r[key]);
        return (
          <li key={r.unitNumber}>
            <button
              type="button"
              onClick={() => onSelect({ unitNumber: r.unitNumber })}
              className="group flex w-full items-center gap-3 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-gray-50"
              title={`Open arrears for unit ${r.unitNumber}`}
            >
              <span className="w-24 shrink-0 truncate text-xs font-semibold text-gray-700 sm:w-28">{r.unitNumber}</span>
              <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
                <span
                  className={`block h-full rounded-full ${barClass} transition-[width] duration-700`}
                  style={{ width: `${Math.max(4, (amount / max) * 100)}%` }}
                />
              </span>
              <span className="w-24 shrink-0 text-right text-xs font-bold tabular-nums text-gray-900 sm:w-28">
                {money(amount, currency)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function Dashboard() {
  // Live dashboard: refetch every 60s while the page is open. Polls stay
  // calm by design: a failed poll keeps the last good KPIs on screen (the
  // next tick retries silently) and identical payloads never re-render.
  const { data: latest, loading, error, refresh } = useFetch<DashboardData>(() =>
    api.get<{ data: DashboardData }>('/api/reports/dashboard').then((r) => r.data)
  );
  const [data, setData] = useState<DashboardData | null>(null);
  // Set only when a poll fails BEFORE anything has ever loaded — the one
  // case where there is no last-good data to keep showing.
  const [fatalError, setFatalError] = useState<string | null>(null);
  // A poll returning identical data still yields a fresh object; this ref
  // detects real change so unchanged payloads skip setData entirely.
  const lastJsonRef = useRef<string>('');
  useEffect(() => {
    if (!latest) return;
    const json = JSON.stringify(latest);
    if (json === lastJsonRef.current) return;
    lastJsonRef.current = json;
    setData(latest);
  }, [latest]);
  useEffect(() => {
    if (error && !data) setFatalError(error);
    else if (!error || data) setFatalError(null);
  }, [error, data]);

  // The 60s tick pauses in hidden tabs (browsers throttle timers there
  // anyway); returning to the tab refetches immediately so the strip is
  // current the moment you look at it.
  useEffect(() => {
    const tick = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // Hooks must sit above the early returns below — they power the chart
  // deep-link handlers rendered further down.
  const navigate = useNavigate();
  const chartsReady = useDeferredRender();
  // Charts re-mount only when the chart data itself changes: recharts
  // re-animates bars/pies on mount, so keying the grid on the serialized
  // charts keeps identical polls from replaying the draw every minute.
  const chartsKey = useMemo(() => (data ? JSON.stringify(data.charts) : ''), [data]);

  // Quick actions are shared with the mobile drawer (QuickActions component):
  // each lands with ?new=1 to open or focus the target page's form.

  // Chart → page deep links: month bars open Receipts pre-filtered to that
  // month (rent bars → RENT receipts, water bars → WATER receipts); unit bars
  // open Arrears pre-filtered to that unit.
  const monthReceipts = (type: 'RENT' | 'WATER') => (d: ChartDatum) =>
    navigate(`/receipts?month=${d.month}&receiptType=${type}`);
  const unitArrearsDirect = (row: { unitNumber: string }) =>
    navigate(`/arrears?unit=${encodeURIComponent(row.unitNumber)}`);

  // Skeleton and error pages are for the FIRST load only; once data exists,
  // polls refresh in place and transient failures keep last-good numbers.
  if (!data) {
    if (loading) return <SkeletonDashboard />;
    if (fatalError) return <div className="text-sm text-red-600">Unable to load dashboard: {fatalError}</div>;
    return null;
  }

  const { property: p, water: w, combined: c, charts, currency, reportingYear } = data;
  const monthLabel = (m: number) => MONTHS[m - 1].slice(0, 3);

  // Derived presentation figures for the badges and progress bars.
  const occPct = p.totalUnits > 0 ? Math.round((p.occupiedUnits / p.totalUnits) * 100) : 0;
  const vacPct = Math.max(0, 100 - occPct);
  const revenue = p.rentCollected + w.waterCollected;
  const marginPct = revenue > 0 ? Math.round((p.netPropertyIncome / revenue) * 100) : 0;
  const waterSurplusPct = w.surplus && w.waterSupplyCost > 0 ? Math.round((w.surplusDeficit / w.waterSupplyCost) * 100) : null;
  const methodTotal = charts.rentByPaymentMethod.reduce((sum, m) => sum + m.total, 0);
  const dominantMethod = charts.rentByPaymentMethod.reduce<{ method: string; total: number } | null>(
    (best, m) => (!best || m.total > best.total ? m : best), null,
  );
  const dominantShare = dominantMethod && methodTotal > 0 ? Math.round((dominantMethod.total / methodTotal) * 100) : 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Reporting year ${reportingYear} — everything below updates automatically from recorded transactions`}
        actions={<QuickActions variant="header" />}
      />

      {/* -------------------------------------------------- PROPERTY band */}
      <SectionHead label="Property" caption={`All ${p.totalUnits} units · live from the rent ledger`} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard
          title="Units Allocation"
          linkTo="/units"
          linkLabel="View all units"
          footer={<span><Count value={p.vacantUnits} /> vacant · turnover visible on the Units page</span>}
        >
          <BigFigure value={<Count value={p.totalUnits} />} caption="Total units" />
          <div className="mt-3">
            <OccupancyBar total={p.totalUnits} occupied={p.occupiedUnits} vacant={p.vacantUnits} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="good">{p.occupiedUnits} Occupied ({occPct}%)</Badge>
              {p.vacantUnits > 0 && <Badge tone="warn">{p.vacantUnits} Vacant ({vacPct}%)</Badge>}
            </div>
          </div>
        </KpiCard>

        <KpiCard
          title="Monthly Rent Ledger"
          badge={<Badge tone="good">{p.rentCollectionRate}% YTD Collected</Badge>}
          linkTo="/rent"
          linkLabel="Rent"
          footer={
            <span>
              Collected: <span className="font-semibold text-emerald-600">{money(p.rentCollected, currency)}</span>
              {' · '}Arrears: <span className="font-semibold text-red-600">{money(p.rentOutstanding, currency)}</span>
            </span>
          }
        >
          <BigFigure
            value={<CountMoney value={p.expectedRent} currency={currency} />}
            caption="Expected rent (this month)"
          />
        </KpiCard>

        <KpiCard
          title="Property Financial Yield"
          badge={
            <Badge tone={marginPct >= 0 ? 'good' : 'bad'} title="Net income as a share of money collected">
              {marginPct >= 0 ? '+' : ''}{marginPct}% Margin
            </Badge>
          }
          linkTo="/expenses"
          linkLabel="Expense ledger"
          footer={<span>Maintenance &amp; ops outflow: <span className="font-semibold text-amber-600">{money(p.totalExpenses, currency)}</span></span>}
        >
          <BigFigure
            value={<CountMoney value={p.netPropertyIncome} currency={currency} />}
            caption="Net property income"
            tone={p.netPropertyIncome >= 0 ? 'good' : 'bad'}
          />
        </KpiCard>
      </div>

      {/* ----------------------------------------------------- WATER band */}
      <div className="mt-8">
        <SectionHead label="Water" caption="Bulk distribution & meter yield" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <KpiCard
            title="Water Invoicing & Recovery"
            badge={<Badge tone={w.collectionRate >= 90 ? 'good' : w.collectionRate >= 70 ? 'warn' : 'bad'}>{w.collectionRate}% collection</Badge>}
            linkTo="/water-meter"
            linkLabel="Meter registry"
            footer={<span>Sub-metered usage — readings from each unit's meter</span>}
          >
            <FigureRow
              items={[
                { label: 'Total billed', value: <CountMoney value={w.waterBilled} currency={currency} /> },
                { label: 'Collected', value: <CountMoney value={w.waterCollected} currency={currency} />, tone: 'good' },
                { label: 'Outstanding', value: <CountMoney value={w.waterOutstanding} currency={currency} />, tone: w.waterOutstanding > 0 ? 'bad' : 'good' },
              ]}
            />
          </KpiCard>

          <KpiCard
            title="Bulk Inflow & Gross Margin"
            badge={
              waterSurplusPct != null ? (
                <Badge tone="good" title="Water surplus as a share of supply cost">+{waterSurplusPct}% Surplus</Badge>
              ) : w.surplus ? undefined : (
                <Badge tone="bad">Running deficit</Badge>
              )
            }
            linkTo="/water-supply"
            linkLabel="Water supply"
            footer={<span>Bulk purchase → per-unit sub-meter billing</span>}
          >
            <FigureRow
              items={[
                { label: 'Purchased', value: <><Count value={w.waterPurchased} /> units</>, caption: 'Metered volume' },
                { label: 'Supply cost', value: <CountMoney value={w.waterSupplyCost} currency={currency} />, caption: `avg ${money(w.averagePurchaseCost, currency)}/unit` },
                {
                  label: w.surplus ? 'Surplus' : 'Deficit',
                  value: <CountMoney value={Math.abs(w.surplusDeficit)} currency={currency} />,
                  tone: w.surplus ? 'good' : 'bad',
                },
              ]}
            />
          </KpiCard>
        </div>
      </div>

      {/* ------------------------------------------------- COMBINED band */}
      <div className="mt-8">
        <SectionHead label="Combined" caption="Consolidated real-time position" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <CombinedCell
            label="Rent + Water Due (this month)"
            value={<CountMoney value={c.totalDueThisMonth} currency={currency} />}
            caption="Total operational billing"
            to={`/monthly?month=${new Date().getMonth() + 1}`}
          />
          <CombinedCell
            label="Total Money Collected"
            value={<CountMoney value={c.totalCollected} currency={currency} />}
            caption={<span>Rent {money(c.rentCollected, currency)} + Water {money(c.waterCollected, currency)}</span>}
            tone="good"
            to="/receipts"
          />
          <CombinedCell
            label="Total Outstanding"
            value={<CountMoney value={c.totalOutstanding} currency={currency} />}
            caption={c.totalOutstanding > 0 ? 'Default/arrears risk' : 'All current'}
            tone={c.totalOutstanding > 0 ? 'bad' : 'good'}
            to="/arrears"
          />
          <CombinedCell
            label="Total Expenses"
            value={<CountMoney value={c.totalExpenses} currency={currency} />}
            caption="Repairs, bulk power & crew"
            tone="warn"
            to="/expenses"
          />
          <CombinedCell
            label="Net Property Income"
            value={<CountMoney value={c.netIncome} currency={currency} />}
            caption={c.netIncome >= 0 ? 'Consolidated net positive' : 'Negative — review expenses'}
            tone={c.netIncome >= 0 ? 'good' : 'bad'}
          />
        </div>
      </div>

      {/* ------------------------------------------------ MESSAGING band */}
      {(data.sms || data.email) && (
        <div className="mt-8">
          <SectionHead label="Messaging" caption="Delivery pipelines & provider health" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.sms && <SmsHealthCard sms={data.sms} />}
            {data.email && <EmailHealthCard email={data.email} />}
          </div>
        </div>
      )}

      {/* -------------------------------------------------- CHARTS band */}
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

          <ChartCard title="Monthly Water Net Balance" meta={<Badge tone={w.surplus ? 'good' : 'bad'}>{w.surplus ? 'All Positive' : 'Deficit Present'}</Badge>} to="/water-supply">
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
    </div>
  );
}

// One cell of the combined strip: tiny label, big colored figure, caption —
// the whole cell deep-links to the page behind the number.
function CombinedCell({
  label,
  value,
  caption,
  tone = 'default',
  to,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: 'default' | 'good' | 'bad' | 'warn';
  to?: string;
}) {
  const tones: Record<string, string> = {
    default: 'text-gray-900',
    good: 'text-emerald-600',
    bad: 'text-red-600',
    warn: 'text-amber-600',
  };
  const body = (
    <>
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tones[tone]}`}>{value}</div>
      {caption && <div className="mt-0.5 text-[11px] text-gray-400">{caption}</div>}
    </>
  );
  return to ? (
    <Link
      to={to}
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors duration-150 hover:bg-gray-50"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">{body}</div>
  );
}

function ChartCard({ title, meta, to, children }: { title: string; meta?: React.ReactNode; to?: string; children: React.ReactNode }) {
  return (
    <div className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">
          {to ? (
            <Link
              to={to}
              className="underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </h3>
        {meta && <span className="shrink-0 text-[11px] font-medium text-gray-400">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

// Compact wallet badge mirroring the SMS page banner semantics: green ok,
// amber low, red empty; muted text for unknown/unavailable (mock mode, Twilio
// or a failed provider call) so it never looks like an alarm.
// Members are single-literal so `state === 'x'` narrows exactly (this tsc
// build narrows unions at the member level, not the literal level).
type BalanceUnion =
  | { state: 'unknown'; reason: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'ok'; balance: { amount: number; currency: string }; threshold: number | null }
  | { state: 'low'; balance: { amount: number; currency: string }; threshold: number | null }
  | { state: 'empty'; balance: { amount: number; currency: string }; threshold: number | null };

function SmsWalletBadge({ balance }: { balance: BalanceUnion }) {
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

interface LastFailure {
  at: string;
  reason: string;
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
