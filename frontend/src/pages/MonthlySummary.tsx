import { useState } from 'react';
import { Download, Mail } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '../components/charts';
import { KpiCard, PageHeader, Select, SkeletonTable, useFetch, useToast } from '../components/ui';
import { api, authenticatedFetch } from '../lib/api';
import { money, number } from '../lib/format';

interface MonthRow {
  month: number;
  monthName: string;
  expectedRent: number;
  rentCollected: number;
  rentOutstanding: number;
  waterBilled: number;
  waterCollected: number;
  waterOutstanding: number;
  totalDue: number;
  totalCollected: number;
  totalOutstanding: number;
  collectionPercentage: number;
  paidTenants: number;
  partialTenants: number;
  unpaidTenants: number;
  occupiedUnits: number;
  vacantUnits: number;
}

interface RentRow {
  month: number;
  monthName: string;
  expectedRent: number;
  rentCollected: number;
  rentOutstanding: number;
  collectionPercentage: number;
}

interface WaterRow {
  month: number;
  monthName: string;
  waterBilled: number;
  waterCollected: number;
  waterOutstanding: number;
  waterSupplyCost: number;
  surplusDeficit: number;
}

const shortMonth = (m: number) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];

export default function MonthlySummary() {
  const now = new Date();
  const [year, setYear] = useState<string>(String(now.getFullYear()));
  const [view, setView] = useState<'COMBINED' | 'RENT' | 'WATER'>('COMBINED');

  const { data: combined } = useFetch<MonthRow[]>(
    () => api.get<{ data: MonthRow[] }>(`/api/reports/monthly?year=${year}`).then((r) => r.data),
    [year, view]
  );
  const { data: rentRows } = useFetch<RentRow[]>(
    () => view === 'RENT'
      ? api.get<{ data: RentRow[] }>(`/api/reports/monthly/rent?year=${year}`).then((r) => r.data)
      : Promise.resolve(null as unknown as RentRow[]),
    [year, view]
  );
  const { data: waterRows } = useFetch<WaterRow[]>(
    () => view === 'WATER'
      ? api.get<{ data: WaterRow[] }>(`/api/reports/monthly/water?year=${year}`).then((r) => r.data)
      : Promise.resolve(null as unknown as WaterRow[]),
    [year, view]
  );

  const rows = view === 'RENT'
    ? (rentRows ?? []) as unknown as MonthRow[]
    : view === 'WATER'
      ? (waterRows ?? []) as unknown as MonthRow[]
      : combined ?? [];

  const totals = rows.reduce(
    (acc, r: any) => ({
      due: acc.due + Number(r.expectedRent ?? 0) + Number(r.waterBilled ?? 0),
      collected: acc.collected + Number(r.rentCollected ?? 0) + Number(r.waterCollected ?? 0),
      outstanding: acc.outstanding + Number(r.rentOutstanding ?? 0) + Number(r.waterOutstanding ?? 0),
    }),
    { due: 0, collected: 0, outstanding: 0 }
  );
  const monthNames = (combined ?? []).map((r) => r.monthName);

  // Monthly report PDF: the year's figures as a one-page document. Fetched
  // with the session cookie and saved as a blob.
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const downloadReport = () => {
    setDownloading(true);
    authenticatedFetch(`/api/reports/monthly.pdf?year=${year}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.message ?? `Report download failed (${r.status}).`);
        }
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `financial-report-${year}.pdf`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => toast('error', (err as Error).message))
      .finally(() => setDownloading(false));
  };

  // Emails the report PDF to the operator (default: the business branding
  // general email). Manager/admin endpoint — 403s toast for staff.
  const [emailing, setEmailing] = useState(false);
  const emailReport = () => {
    setEmailing(true);
    api
      .post<{ data: { status: string; email_address: string } }>(
        `/api/reports/monthly/email?year=${year}`,
        {}
      )
      .then(({ data }) => {
        toast(
          'success',
          data.status === 'SENT'
            ? `Report emailed to ${data.email_address}.`
            : `Report queued for ${data.email_address} — see the email history for the result.`
        );
      })
      .catch((err) => toast('error', (err as Error).message))
      .finally(() => setEmailing(false));
  };

  return (
    <div>
      <PageHeader
        title="Monthly Summary"
        subtitle="Expected vs collected for every month of the reporting year — rent, water or combined"
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={view} onChange={(e) => setView(e.target.value as typeof view)} className="w-52">
          <option value="COMBINED">Rent + Water (combined)</option>
          <option value="RENT">Rent only</option>
          <option value="WATER">Water only</option>
        </Select>
        <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-28">
          {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </Select>
        {/* Year-at-a-glance report as a printable PDF. */}
        <button
          type="button"
          onClick={downloadReport}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 active:scale-[0.98] disabled:opacity-60"
        >
          <Download size={15} strokeWidth={1.75} aria-hidden /> {downloading ? 'Preparing…' : 'Download Report (PDF)'}
        </button>
        {/* Email the report to the operator (default: branding general email). */}
        <button
          type="button"
          onClick={emailReport}
          disabled={emailing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 active:scale-[0.98] disabled:opacity-60"
        >
          <Mail size={15} strokeWidth={1.75} aria-hidden /> {emailing ? 'Sending…' : 'Email Report'}
        </button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard label={`Total due ${year}`} value={money(totals.due)} />
        <KpiCard label={`Total collected ${year}`} value={money(totals.collected)} tone="good" />
        <KpiCard label={`Total outstanding ${year}`} value={money(totals.outstanding)} tone={totals.outstanding > 0 ? 'bad' : 'good'} />
      </div>

      {/* Charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Due vs collected by month</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={combined ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={(d: any) => shortMonth(d.month)} />
              <YAxis />
              <Tooltip formatter={(v: any) => money(v)} />
              <Legend />
              <Bar dataKey="totalDue" fill="#cbd5e1" name="Total due" />
              <Bar dataKey="totalCollected" fill="#10b981" name="Total collected" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Outstanding trend</h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={combined ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={(d: any) => shortMonth(d.month)} />
              <YAxis />
              <Tooltip formatter={(v: any) => money(v)} />
              <Legend />
              <Line type="monotone" dataKey="rentOutstanding" stroke="#ef4444" name="Rent outstanding" />
              <Line type="monotone" dataKey="waterOutstanding" stroke="#8b5cf6" name="Water outstanding" />
              <Line type="monotone" dataKey="totalOutstanding" stroke="#1d6fd6" name="Total outstanding" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {rows.length > 0 && (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Expected Rent</th>
              <th>Rent Collected</th>
              <th>Rent Outstanding</th>
              <th>Water Billed</th>
              <th>Water Collected</th>
              <th>Water Outstanding</th>
              <th>Total Due</th>
              <th>Total Collected</th>
              <th>Total Outstanding</th>
              <th>Collection %</th>
              <th>Paid / Partial / Unpaid</th>
              <th>Occupied / Vacant</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.month}>
                <td className="font-semibold text-gray-900">{monthNames[r.month - 1] ?? shortMonth(r.month)}</td>
                <td>{money(r.expectedRent)}</td>
                <td>{money(r.rentCollected)}</td>
                <td className={Number(r.rentOutstanding) > 0 ? 'font-medium text-red-600' : 'text-gray-700'}>{money(r.rentOutstanding)}</td>
                <td>{money(r.waterBilled ?? 0)}</td>
                <td>{money(r.waterCollected ?? 0)}</td>
                <td className={Number(r.waterOutstanding) > 0 ? 'font-medium text-red-600' : 'text-gray-700'}>{money(r.waterOutstanding ?? 0)}</td>
                <td className="font-medium">{money(r.totalDue)}</td>
                <td className="font-medium text-emerald-700">{money(r.totalCollected)}</td>
                <td className={Number(r.totalOutstanding) > 0 ? 'font-semibold text-red-600' : 'text-gray-700'}>{money(r.totalOutstanding)}</td>
                <td>{number(r.collectionPercentage ?? 0)}%</td>
                <td className="text-xs">
                  <span className="text-emerald-700">{r.paidTenants ?? '—'}</span> /{' '}
                  <span className="text-amber-700">{r.partialTenants ?? '—'}</span> /{' '}
                  <span className="text-red-600">{r.unpaidTenants ?? '—'}</span>
                </td>
                <td className="text-xs">{r.occupiedUnits ?? '—'} / {r.vacantUnits ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {rows.length === 0 && <SkeletonTable cols={13} rows={12} />}
    </div>
  );
}
