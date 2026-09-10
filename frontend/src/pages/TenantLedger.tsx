import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Mail } from 'lucide-react';
import { EmptyState, KpiCard, PageHeader, Select, StatusBadge, useFetch, useToast } from '../components/ui';
import { api } from '../lib/api';
import { money } from '../lib/format';

interface TenantOption { id: number; full_name: string; unit_number: string | null }

interface LedgerRow {
  month: number;
  monthName: string;
  unit: string | null;
  expectedRent: number;
  previousWaterReading: number | null;
  currentWaterReading: number | null;
  waterConsumed: number;
  waterBill: number;
  rentPaid: number;
  waterPaid: number;
  totalPaid: number;
  rentBalance: number;
  waterBalance: number;
  totalBalance: number;
  status: string;
}

interface LedgerData {
  tenant: { id: number; fullName: string; phoneNumber: string | null };
  unit: { id: number; unitNumber: string; monthlyRent: number; waterEnabled: boolean } | null;
  reportingYear: number;
  currency: string;
  months: LedgerRow[];
  totals: {
    rentPaid: number; waterPaid: number; totalPaid: number;
    rentBalance: number; waterBalance: number; totalBalance: number;
  };
}

export default function TenantLedger() {
  const [params, setParams] = useSearchParams();
  const [tenantId, setTenantId] = useState<string>(params.get('tenant') ?? '');

  // Keep the URL in sync so the page is deep-linkable from the Tenants page.
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (tenantId) next.set('tenant', tenantId);
    else next.delete('tenant');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const { data: tenants } = useFetch(() => api.list<TenantOption>('/api/tenants?limit=100'));
  const { data, loading, error } = useFetch<LedgerData>(
    () => tenantId === ''
      ? Promise.resolve(null as unknown as LedgerData)
      : api.get<{ data: LedgerData }>(`/api/reports/tenant/${tenantId}`).then((r) => r.data),
    [tenantId]
  );

  const { toast } = useToast();
  const year = data?.reportingYear ?? new Date().getFullYear();

  // Statement PDF download — same pattern as the monthly report download:
  // fetch with the session token, save as a blob.
  const [downloading, setDownloading] = useState(false);
  const downloadStatement = () => {
    const token = localStorage.getItem('rpms_token');
    if (!token || !tenantId) return;
    setDownloading(true);
    fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/reports/tenant/${tenantId}/statement.pdf?year=${year}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.message ?? `Statement download failed (${r.status}).`);
        }
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `statement-${(data?.tenant.fullName ?? 'tenant').replace(/[^a-z0-9]+/gi, '-')}-${year}.pdf`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => toast('error', (err as Error).message))
      .finally(() => setDownloading(false));
  };

  // Emails the statement to the tenant's stored address (or an explicit one
  // server-side). Manager/admin endpoint — 403s toast for staff.
  const [emailing, setEmailing] = useState(false);
  const emailStatement = () => {
    if (!tenantId) return;
    setEmailing(true);
    api
      .post<{ data: { status: string; email_address: string } }>(
        `/api/reports/tenant/${tenantId}/statement/email?year=${year}`,
        {}
      )
      .then(({ data: row }) => {
        toast(
          'success',
          row.status === 'SENT'
            ? `Statement emailed to ${row.email_address}.`
            : `Statement queued for ${row.email_address} — see the email history for the result.`
        );
      })
      .catch((err) => toast('error', (err as Error).message))
      .finally(() => setEmailing(false));
  };

  return (
    <div>
      <PageHeader
        title="Tenant Ledger"
        subtitle="One row per billing month — expected rent, water, payments, balances and status"
      />

      <div className="mb-4 max-w-md">
        <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">— Select tenant —</option>
          {(tenants?.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name}{t.unit_number ? ` — Unit ${t.unit_number}` : ''}
            </option>
          ))}
        </Select>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading ledger…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && tenantId === '' && (
        <EmptyState message="Select a tenant to view their month-by-month ledger." />
      )}
      {!loading && !error && data && (
        <>
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-lg font-bold text-gray-900">{data.tenant.fullName}</div>
                <div className="text-sm text-gray-500">
                  {data.tenant.phoneNumber ? (
                    <a href={`tel:${data.tenant.phoneNumber.replace(/\s+/g, '')}`} className="underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline">{data.tenant.phoneNumber}</a>
                  ) : 'No phone'} ·{' '}
                  {data.unit ? `Unit ${data.unit.unitNumber} (rent ${money(data.unit.monthlyRent, data.currency)}${data.unit.waterEnabled ? ', water enabled' : ', no water billing'})` : 'No unit'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Reporting year {data.reportingYear}</span>
                {/* Yearly statement as a printable PDF / emailable to the tenant. */}
                <button
                  type="button"
                  onClick={downloadStatement}
                  disabled={downloading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 active:scale-[0.98] disabled:opacity-60"
                >
                  <Download size={15} strokeWidth={1.75} aria-hidden /> {downloading ? 'Preparing…' : 'Statement (PDF)'}
                </button>
                <button
                  type="button"
                  onClick={emailStatement}
                  disabled={emailing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 active:scale-[0.98] disabled:opacity-60"
                >
                  <Mail size={15} strokeWidth={1.75} aria-hidden /> {emailing ? 'Sending…' : 'Email Statement'}
                </button>
              </div>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Rent Paid (YTD)" value={money(data.totals.rentPaid, data.currency)} tone="good" />
            <KpiCard label="Rent Balance" value={money(data.totals.rentBalance, data.currency)} tone={data.totals.rentBalance > 0 ? 'bad' : 'good'} />
            <KpiCard label="Water Paid (YTD)" value={money(data.totals.waterPaid, data.currency)} tone="good" />
            <KpiCard label="Water Balance" value={money(data.totals.waterBalance, data.currency)} tone={data.totals.waterBalance > 0 ? 'bad' : 'good'} />
            <KpiCard label="Total Paid" value={money(data.totals.totalPaid, data.currency)} tone="good" />
            <KpiCard label="Total Balance" value={money(data.totals.totalBalance, data.currency)} tone={data.totals.totalBalance > 0 ? 'bad' : 'good'} />
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Month</th><th>Unit</th><th>Expected Rent</th>
                  <th>Water Prev</th><th>Water Curr</th><th>Consumed</th><th>Water Bill</th>
                  <th>Rent Paid</th><th>Water Paid</th><th>Total Paid</th>
                  <th>Rent Balance</th><th>Water Balance</th><th>Total Balance</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((r) => (
                  <tr key={r.month}>
                    <td className="font-medium text-gray-900">{r.monthName.slice(0, 3)}</td>
                    <td>{r.unit ?? '—'}</td>
                    <td>{money(r.expectedRent, data.currency)}</td>
                    <td>{r.previousWaterReading ?? '—'}</td>
                    <td>{r.currentWaterReading ?? '—'}</td>
                    <td>{r.waterConsumed}</td>
                    <td>{money(r.waterBill, data.currency)}</td>
                    <td>{money(r.rentPaid, data.currency)}</td>
                    <td>{money(r.waterPaid, data.currency)}</td>
                    <td className="font-medium">{money(r.totalPaid, data.currency)}</td>
                    <td className={r.rentBalance > 0 ? 'font-medium text-red-600' : 'text-gray-700'}>{money(r.rentBalance, data.currency)}</td>
                    <td className={r.waterBalance > 0 ? 'font-medium text-red-600' : 'text-gray-700'}>{money(r.waterBalance, data.currency)}</td>
                    <td className={r.totalBalance > 0 ? 'font-semibold text-red-600' : 'text-gray-700'}>{money(r.totalBalance, data.currency)}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
