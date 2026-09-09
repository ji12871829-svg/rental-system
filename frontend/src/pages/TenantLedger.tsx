import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState, KpiCard, PageHeader, Select, StatusBadge, useFetch } from '../components/ui';
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
              <div className="text-sm text-gray-500">Reporting year {data.reportingYear}</div>
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
