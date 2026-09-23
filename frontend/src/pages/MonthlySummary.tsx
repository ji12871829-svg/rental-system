import { useEffect, useState } from 'react';
import { Banknote, Download, Loader2, Mail, MessageSquare } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '../components/charts';
import { Button, KpiCard, Modal, PageHeader, Select, SkeletonTable, useFetch, useToast } from '../components/ui';
import { api, authenticatedFetch } from '../lib/api';
import { MONTHS, money, number } from '../lib/format';
import { useQueryParam } from '../lib/useQueryParam';

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
  // ?month=9 (e.g. from the Dashboard's "due this month" stat) narrows the
  // table to one month; charts and year totals stay year-wide. The shared
  // hook syncs the filter both ways with the URL.
  const [monthFilter, setMonthFilter] = useQueryParam('month');

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

  const rows = (view === 'RENT'
    ? (rentRows ?? []) as unknown as MonthRow[]
    : view === 'WATER'
      ? (waterRows ?? []) as unknown as MonthRow[]
      : combined ?? []).filter((r: any) => !monthFilter || String(r.month) === monthFilter);

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

  // --- Owner remittance (the landlord communication templates) ----------------
  // Defaults to the viewed month when one is filtered, else the current month.
  const ownerMonth = monthFilter ? Number(monthFilter) : Math.min(now.getMonth() + 1, 12);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerChannel, setOwnerChannel] = useState<'SMS' | 'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [ownerPreview, setOwnerPreview] = useState<{
    figures: {
      ownerName: string | null; propertyName: string; monthName: string; year: number;
      currency: string; totalCollected: number; managementFeePercent: number | null;
      managementFee: number; expensesTotal: number; netPayable: number; occupancyPercent: number;
    } | null;
    message: string | null;
    whatsappUrl: string | null;
  } | null>(null);
  const [ownerBusy, setOwnerBusy] = useState(false);

  useEffect(() => {
    if (!ownerOpen) { setOwnerPreview(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const fig = await api.get<{ data: NonNullable<typeof ownerPreview>['figures'] }>(
          `/api/reports/owner-remittance?month=${ownerMonth}&year=${year}`,
        ).then((r) => r.data);
        const res = await api.post<{ data: { message: string; whatsappUrl: string | null } }>(
          '/api/reports/owner-remittance',
          { month: ownerMonth, channel: ownerChannel },
        );
        if (cancelled) return;
        setOwnerPreview({ figures: fig, message: res.data.message, whatsappUrl: res.data.whatsappUrl });
      } catch (err) {
        if (!cancelled) toast('error', (err as Error).message);
        if (!cancelled) setOwnerOpen(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ownerOpen, ownerMonth, ownerChannel, year]); // eslint-disable-line react-hooks/exhaustive-deps -- toast is a stable provider callback

  const sendOwnerRemittance = (channel: 'SMS' | 'WHATSAPP' | 'EMAIL') => {
    setOwnerBusy(true);
    api
      .post<{ data: { whatsappUrl: string | null; status?: string } }>('/api/reports/owner-remittance', { month: ownerMonth, channel })
      .then(({ data }) => {
        if (data.whatsappUrl) {
          window.open(data.whatsappUrl, '_blank', 'noopener');
          toast('success', 'WhatsApp opened — review and press send.');
        } else if (channel === 'EMAIL') {
          toast('success', `Owner statement emailed (${data.status ?? 'SENT'}).`);
        } else {
          toast('success', 'Owner remittance queued.');
        }
        setOwnerOpen(false);
      })
      .catch((err) => toast('error', (err as Error).message))
      .finally(() => setOwnerBusy(false));
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
        <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="w-40">
          <option value="">All months</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
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
        {/* Owner remittance — the landlord's monthly statement, 3 channels. */}
        <Button onClick={() => setOwnerOpen(true)}>
          <Banknote size={15} strokeWidth={1.75} aria-hidden /> Send to Owner…
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* KPIs follow the month filter (the table's scope) — the label says so.
            Charts above stay year-wide for context. */}
        <KpiCard label={`Total due ${monthFilter ? `${MONTHS[Number(monthFilter) - 1]} ` : ''}${year}`} value={money(totals.due)} />
        <KpiCard label={`Total collected ${monthFilter ? `${MONTHS[Number(monthFilter) - 1]} ` : ''}${year}`} value={money(totals.collected)} tone="good" />
        <KpiCard label={`Total outstanding ${monthFilter ? `${MONTHS[Number(monthFilter) - 1]} ` : ''}${year}`} value={money(totals.outstanding)} tone={totals.outstanding > 0 ? 'bad' : 'good'} />
      </div>

      {/* Charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Due vs collected by month</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={combined ?? []} onBarClick={(d) => setMonthFilter(String(d.month))}>
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

      {/* Owner remittance modal — the landlord communication templates. */}
      <Modal open={ownerOpen} title={`Owner remittance · ${MONTHS[ownerMonth - 1]} ${year}`} onClose={() => { if (!ownerBusy) setOwnerOpen(false); }}>
        {!ownerPreview ? (
          <div className="flex items-center gap-2 p-4 text-sm text-gray-500">
            <Loader2 size={15} className="animate-spin" aria-hidden /> Preparing the remittance figures…
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            {ownerPreview.figures && (
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-4">
                <div><div className="text-xs text-gray-500">Total collected</div><div className="text-lg font-bold text-gray-900">{money(ownerPreview.figures.totalCollected)}</div></div>
                <div><div className="text-xs text-gray-500">Occupancy</div><div className="text-lg font-bold text-gray-900">{number(ownerPreview.figures.occupancyPercent)}%</div></div>
                {ownerPreview.figures.managementFeePercent !== null && (
                  <div><div className="text-xs text-gray-500">Management fee ({number(ownerPreview.figures.managementFeePercent)}%)</div><div className="text-lg font-bold text-gray-900">−{money(ownerPreview.figures.managementFee)}</div></div>
                )}
                <div><div className="text-xs text-gray-500">Expenses this month</div><div className="text-lg font-bold text-gray-900">−{money(ownerPreview.figures.expensesTotal)}</div></div>
                <div className="col-span-2 border-t border-gray-200 pt-2"><div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Net remittance to owner</div><div className="text-2xl font-bold text-emerald-700">{money(ownerPreview.figures.netPayable)}</div></div>
              </div>
            )}

            <div role="tablist" aria-label="Owner channel" className="grid grid-cols-3 gap-2 rounded-xl bg-gray-100 p-1">
              {([['SMS', 'SMS'], ['WHATSAPP', 'WhatsApp'], ['EMAIL', 'Email']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={ownerChannel === value}
                  onClick={() => setOwnerChannel(value)}
                  className={`min-h-[38px] rounded-lg px-2 text-sm font-semibold transition-colors ${
                    ownerChannel === value ? 'bg-brand-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {ownerPreview.message && (
              <div className="rounded-lg bg-gray-50 p-4 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{ownerPreview.message}</div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOwnerOpen(false)} disabled={ownerBusy}>Cancel</Button>
              <Button onClick={() => sendOwnerRemittance(ownerChannel)} disabled={ownerBusy}>
                {ownerBusy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <MessageSquare size={15} strokeWidth={2} aria-hidden />}
                {ownerChannel === 'WHATSAPP' ? 'Open WhatsApp' : ownerChannel === 'EMAIL' ? 'Email owner now' : 'Queue SMS'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
