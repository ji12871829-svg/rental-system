import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '../components/charts';
import { StatGroupCard, PageHeader, useFetch } from '../components/ui';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useBranding } from '../lib/BrandingContext';
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

export default function Dashboard() {
  const { identity } = useBranding();
  const { data, loading, error } = useFetch<DashboardData>(() =>
    api.get<{ data: DashboardData }>('/api/reports/dashboard').then((r) => r.data)
  );

  if (loading) return <div className="text-sm text-gray-500">Loading dashboard…</div>;
  if (error) return <div className="text-sm text-red-600">Unable to load dashboard: {error}</div>;
  if (!data) return null;

  const { property: p, water: w, combined: c, charts, currency, reportingYear } = data;
  const monthLabel = (m: number) => MONTHS[m - 1].slice(0, 3);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Reporting year ${reportingYear} — everything below updates automatically from recorded transactions`}
      />

      {/* The buildings this software runs — photo strip with subtle 1px
          outlines (pure black/white by color-scheme) for consistent depth. */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <figure className="relative overflow-hidden rounded-xl shadow-sm ring-1 ring-black/10">
          <picture>
            <source
              type="image/webp"
              srcSet="/building/building-1-480.webp 480w, /building/building-1-800.webp 800w, /building/building-1-1600.webp 1600w"
              sizes="(min-width: 640px) 50vw, 100vw"
            />
            <img
              src="/building/building-1-800.webp"
              alt="Residential building managed with RPMS"
              className="h-44 w-full object-cover transition-transform duration-300 hover:scale-[1.02] sm:h-52"
              loading="lazy"
              decoding="async"
            />
          </picture>
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-4 py-2.5 text-sm font-medium text-white">
            {identity?.address ?? 'Our building'}
          </figcaption>
        </figure>
        <figure className="relative overflow-hidden rounded-xl shadow-sm ring-1 ring-black/10">
          <picture>
            <source
              type="image/webp"
              srcSet="/building/building-2-480.webp 480w, /building/building-2-800.webp 800w, /building/building-2-1600.webp 1600w"
              sizes="(min-width: 640px) 50vw, 100vw"
            />
            <img
              src="/building/building-2-800.webp"
              alt="Second building under management"
              className="h-44 w-full object-cover transition-transform duration-300 hover:scale-[1.02] sm:h-52"
              loading="lazy"
              decoding="async"
            />
          </picture>
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-4 py-2.5 text-sm font-medium text-white">
            Managed with RPMS
          </figcaption>
        </figure>
      </div>

      {/* Property summary */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Property</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatGroupCard
          title="Units"
          stats={[
            { label: 'Total', value: p.totalUnits },
            { label: 'Occupied', value: p.occupiedUnits, tone: 'good' },
            { label: 'Vacant', value: p.vacantUnits, tone: p.vacantUnits > 0 ? 'warn' : 'good' },
          ]}
        />
        <StatGroupCard
          title="Rent"
          stats={[
            { label: 'Expected (this month)', value: money(p.expectedRent, currency) },
            { label: 'Collected', value: money(p.rentCollected, currency), sub: `${p.rentCollectionRate}% of YTD expected`, tone: 'good' },
            { label: 'Outstanding', value: money(p.rentOutstanding, currency), tone: p.rentOutstanding > 0 ? 'bad' : 'good' },
          ]}
        />
        <StatGroupCard
          title="Financials"
          stats={[
            { label: 'Total Expenses', value: money(p.totalExpenses, currency), tone: 'warn' },
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
            { label: 'Billed', value: money(w.waterBilled, currency) },
            { label: 'Collected', value: money(w.waterCollected, currency), sub: `${w.collectionRate}% collection rate`, tone: 'good' },
            { label: 'Outstanding', value: money(w.waterOutstanding, currency), tone: w.waterOutstanding > 0 ? 'bad' : 'good' },
          ]}
        />
        <StatGroupCard
          title="Water Supply"
          stats={[
            { label: 'Purchased', value: `${w.waterPurchased} units` },
            { label: 'Supply Cost', value: money(w.waterSupplyCost, currency), sub: `avg ${money(w.averagePurchaseCost, currency)}/unit` },
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
          { label: 'Rent + Water Due (this month)', value: money(c.totalDueThisMonth, currency) },
          { label: 'Total Money Collected', value: money(c.totalCollected, currency), sub: `Rent ${money(c.rentCollected, currency)} + Water ${money(c.waterCollected, currency)}`, tone: 'good' },
          { label: 'Total Outstanding', value: money(c.totalOutstanding, currency), tone: c.totalOutstanding > 0 ? 'bad' : 'good' },
          { label: 'Total Expenses', value: money(c.totalExpenses, currency) },
          { label: 'Net Property Income', value: money(c.netIncome, currency), tone: c.netIncome >= 0 ? 'good' : 'bad' },
        ]}
      />

      {/* SMS health — compact: wallet badge + this month's counts. The whole
          strip links to the SMS page. Renders nothing if the API is older. */}
      {data.sms && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">SMS</h2>
          <Link
            to="/sms"
            className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors duration-150 hover:bg-gray-50"
          >
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <SmsWalletBadge balance={data.sms.balance} />
              <span className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{data.sms.sentThisMonth}</span> sent this month
              </span>
              <span className="text-sm text-gray-600">
                <span className={`font-semibold ${data.sms.failedThisMonth > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {data.sms.failedThisMonth}
                </span>{' '}
                failed
              </span>
              <span className="ml-auto text-xs font-medium text-brand-700">Manage SMS →</span>
            </div>
          </Link>
        </div>
      )}

      {/* Charts */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">Charts</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Monthly Rent Collected">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.monthlyRentCollected}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={(d: any) => monthLabel(d.month)} />
              <YAxis />
              <Tooltip formatter={(v: any) => money(v, currency)} />
              <Bar dataKey="collected" fill="#1d6fd6" name="Rent collected" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Expected Rent vs Collected Rent">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.expectedVsCollected}>
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

        <ChartCard title="Occupied vs Vacant Units">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={[{ name: 'Occupied', value: charts.occupiedVsVacant.occupied }, { name: 'Vacant', value: charts.occupiedVsVacant.vacant }]} dataKey="value" nameKey="name" outerRadius={90} label>
                {PIE_COLORS.slice(0, 2).map((color, i) => <Cell key={i} fill={color} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Rent Collected by Payment Method">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={charts.rentByPaymentMethod} dataKey="total" nameKey="method" outerRadius={90} label={(d: any) => methodLabel(d.method)}>
                {charts.rentByPaymentMethod.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => money(v, currency)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Outstanding Rent by Unit">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.outstandingRentByUnit} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="unitNumber" width={40} />
              <Tooltip formatter={(v: any) => money(v, currency)} />
              <Bar dataKey="outstanding" fill="#ef4444" name="Outstanding" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Monthly Water Billed vs Water Collected">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.monthlyWaterBilledVsCollected}>
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

        <ChartCard title="Water Supply Cost vs Water Collected">
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

        <ChartCard title="Monthly Water Surplus / Deficit">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.monthlyWaterSurplusDeficit}>
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

        <ChartCard title="Outstanding Water by Unit">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.outstandingWaterByUnit} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="unitNumber" width={40} />
              <Tooltip formatter={(v: any) => money(v, currency)} />
              <Bar dataKey="waterOutstanding" fill="#8b5cf6" name="Outstanding" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">{title}</h3>
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