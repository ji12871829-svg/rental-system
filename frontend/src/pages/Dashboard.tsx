import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type ChartDatum,
} from '../components/charts';
import { StatGroupCard, PageHeader, useFetch, SkeletonDashboard } from '../components/ui';
import { QuickActions } from '../components/QuickActions';
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
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

export default function Dashboard() {
  const { data, loading, error } = useFetch<DashboardData>(() =>
    api.get<{ data: DashboardData }>('/api/reports/dashboard').then((r) => r.data)
  );
  // Hooks must sit above the early returns below — they power the chart
  // deep-link handlers rendered further down.
  const navigate = useNavigate();
  const chartsReady = useDeferredRender();

  // Quick actions are shared with the mobile drawer (QuickActions component):
  // each lands with ?new=1 to open or focus the target page's form.

  // Chart → page deep links: month bars open Receipts pre-filtered to that
  // month (rent bars → RENT receipts, water bars → WATER receipts); unit bars
  // open Arrears pre-filtered to that unit.
  const monthReceipts = (type: 'RENT' | 'WATER') => (d: ChartDatum) =>
    navigate(`/receipts?month=${d.month}&receiptType=${type}`);
  const unitArrears = (d: ChartDatum) => navigate(`/arrears?unit=${encodeURIComponent(String(d.unitNumber))}`);

  if (loading) return <SkeletonDashboard />;
  if (error) return <div className="text-sm text-red-600">Unable to load dashboard: {error}</div>;
  if (!data) return null;

  const { property: p, water: w, combined: c, charts, currency, reportingYear } = data;
  const monthLabel = (m: number) => MONTHS[m - 1].slice(0, 3);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Reporting year ${reportingYear} — everything below updates automatically from recorded transactions`}
        actions={<QuickActions variant="header" />}
      />

      {/* Property summary */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Property</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatGroupCard
          title="Units"
          stats={[
            { label: 'Total', value: p.totalUnits, to: '/units' },
            { label: 'Occupied', value: p.occupiedUnits, tone: 'good', to: '/units' },
            { label: 'Vacant', value: p.vacantUnits, tone: p.vacantUnits > 0 ? 'warn' : 'good', to: '/units' },
          ]}
        />
        <StatGroupCard
          title="Rent"
          stats={[
            { label: 'Expected (this month)', value: money(p.expectedRent, currency), to: '/rent' },
            { label: 'Collected', value: money(p.rentCollected, currency), sub: `${p.rentCollectionRate}% of YTD expected`, tone: 'good', to: '/rent' },
            { label: 'Outstanding', value: money(p.rentOutstanding, currency), tone: p.rentOutstanding > 0 ? 'bad' : 'good', to: '/arrears' },
          ]}
        />
        <StatGroupCard
          title="Financials"
          stats={[
            { label: 'Total Expenses', value: money(p.totalExpenses, currency), tone: 'warn', to: '/expenses' },
            { label: 'Net Property Income', value: money(p.netPropertyIncome, currency), tone: p.netPropertyIncome >= 0 ? 'good' : 'bad' },
          ]}
        />
      </div>

      {/* Water summary */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">Water</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <StatGroupCard
          title="Water Billing"
          stats={[
            { label: 'Billed', value: money(w.waterBilled, currency), to: '/water-meter' },
            { label: 'Collected', value: money(w.waterCollected, currency), sub: `${w.collectionRate}% collection rate`, tone: 'good', to: '/water-payments' },
            { label: 'Outstanding', value: money(w.waterOutstanding, currency), tone: w.waterOutstanding > 0 ? 'bad' : 'good', to: '/arrears' },
          ]}
        />
        <StatGroupCard
          title="Water Supply"
          stats={[
            { label: 'Purchased', value: `${w.waterPurchased} units`, to: '/water-supply' },
            { label: 'Supply Cost', value: money(w.waterSupplyCost, currency), sub: `avg ${money(w.averagePurchaseCost, currency)}/unit`, to: '/water-supply' },
            {
              label: w.surplus ? 'Surplus' : 'Deficit',
              value: money(Math.abs(w.surplusDeficit), currency),
              tone: w.surplus ? 'good' : 'bad',
            },
          ]}
        />
      </div>

      {/* Combined summary */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">Combined</h2>
      <StatGroupCard
        stats={[
          { label: 'Rent + Water Due (this month)', value: money(c.totalDueThisMonth, currency), to: `/monthly?month=${new Date().getMonth() + 1}` },
          { label: 'Total Money Collected', value: money(c.totalCollected, currency), sub: `Rent ${money(c.rentCollected, currency)} + Water ${money(c.waterCollected, currency)}`, tone: 'good', to: '/receipts' },
          { label: 'Total Outstanding', value: money(c.totalOutstanding, currency), tone: c.totalOutstanding > 0 ? 'bad' : 'good', to: '/arrears' },
          { label: 'Total Expenses', value: money(c.totalExpenses, currency), to: '/expenses' },
          { label: 'Net Property Income', value: money(c.netIncome, currency), tone: c.netIncome >= 0 ? 'good' : 'bad' },
        ]}
      />

      {/* Provider status — SMS wallet + delivery failures for both channels,
          surfacing provider reasons inline so Settings is only needed to fix
          config, not to discover a problem. Renders nothing if API is older. */}
      {(data.sms || data.email) && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Messaging</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.sms && <SmsHealthCard sms={data.sms} />}
            {data.email && <EmailHealthCard email={data.email} />}
          </div>
        </div>
      )}

      {/* Charts — deferred past first paint. The KPI strip above is the
          information the dashboard exists for; ten hand-rolled SVG charts
          are below the fold and don't need to block it. Renders skeletons
          until the browser is idle (or 600ms passes on older browsers),
          then mounts all charts in one commit. */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">Charts</h2>
      {chartsReady ? (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Monthly Rent Collected" to="/rent">
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

        <ChartCard title="Expected Rent vs Collected Rent" to="/rent">
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

        <ChartCard title="Occupied vs Vacant Units" to="/units">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart onSliceClick={() => navigate('/units')}>
              <Pie data={[{ name: 'Occupied', value: charts.occupiedVsVacant.occupied }, { name: 'Vacant', value: charts.occupiedVsVacant.vacant }]} dataKey="value" nameKey="name" outerRadius={90} label>
                {PIE_COLORS.slice(0, 2).map((color, i) => <Cell key={i} fill={color} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Rent Collected by Payment Method" to="/receipts">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart onSliceClick={() => navigate('/receipts')}>
            {/* Method-filtered receipts don't exist as a page filter yet, so
                slice clicks land on the receipts list as a whole. */}
              <Pie data={charts.rentByPaymentMethod} dataKey="total" nameKey="method" outerRadius={90} label={(d: any) => methodLabel(d.method)}>
                {charts.rentByPaymentMethod.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => money(v, currency)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Outstanding Rent by Unit" to="/arrears">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.outstandingRentByUnit} layout="vertical" onBarClick={unitArrears}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="unitNumber" width={40} />
              <Tooltip formatter={(v: any) => money(v, currency)} />
              <Bar dataKey="outstanding" fill="#ef4444" name="Outstanding" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Monthly Water Billed vs Water Collected" to="/water-payments">
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

        <ChartCard title="Water Supply Cost vs Water Collected" to="/water-supply">
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

        <ChartCard title="Monthly Water Surplus / Deficit" to="/water-supply">
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

        <ChartCard title="Outstanding Water by Unit" to="/arrears">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.outstandingWaterByUnit} layout="vertical" onBarClick={unitArrears}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="unitNumber" width={40} />
              <Tooltip formatter={(v: any) => money(v, currency)} />
              <Bar dataKey="waterOutstanding" fill="#8b5cf6" name="Outstanding" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="h-[318px] animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
          ))}
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, to, children }: { title: string; to?: string; children: React.ReactNode }) {
  return (
    <div className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
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
  const amount = 'balance' in balance
    ? `${balance.balance.currency} ${balance.balance.amount.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`
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
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden /> SMS wallet empty — {amount}
      </span>
    );
  }
  if (balance.state === 'low') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden /> SMS wallet low — {amount}
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
    <HealthCard title="SMS" tone={walletTone} to="/sms" linkLabel="Manage SMS">
      <SmsWalletBadge balance={sms.balance} />
      <span className="text-sm text-gray-600">
        <span className="font-semibold text-gray-900">{sms.sentThisMonth}</span> sent this month
      </span>
      <span className="text-sm text-gray-600">
        <span className={`font-semibold ${sms.failedThisMonth > 0 ? 'text-red-600' : 'text-gray-900'}`}>{sms.failedThisMonth}</span> failed
      </span>
      {sms.lastFailure && <LastFailureLine failure={sms.lastFailure} />}
    </HealthCard>
  );
}

function EmailHealthCard({ email }: { email: NonNullable<DashboardData['email']> }) {
  const emailTone = email.failedThisMonth > 0 ? 'bad' : email.pendingCount > 0 ? 'warn' : 'neutral';
  return (
    <HealthCard title="Email" tone={emailTone} to="/email-campaign" linkLabel="Tenant Email">
      <span className="text-sm text-gray-600">
        <span className="font-semibold text-gray-900">{email.sentThisMonth}</span> sent this month
      </span>
      <span className="text-sm text-gray-600">
        <span className={`font-semibold ${email.failedThisMonth > 0 ? 'text-red-600' : 'text-gray-900'}`}>{email.failedThisMonth}</span> failed
      </span>
      {email.pendingCount > 0 && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700"
          title="Composed emails still queued — the provider has not confirmed a send yet. Check Settings for the provider status."
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden /> {email.pendingCount} pending
        </span>
      )}
      {email.lastFailure && <LastFailureLine failure={email.lastFailure} />}
    </HealthCard>
  );
}