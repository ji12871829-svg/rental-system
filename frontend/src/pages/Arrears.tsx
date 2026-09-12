import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Button, EmptyState, KpiCard, PageHeader, Select, SkeletonTable, StatusBadge, useFetch, useToast } from '../components/ui';
import { api } from '../lib/api';
import { money } from '../lib/format';

interface ArrearRow {
  unitId: number;
  unitNumber: string;
  floor: string;
  tenantId: number;
  tenantName: string;
  phoneNumber: string;
  monthlyRent: number;
  waterBill: number;
  totalAmountDue: number;
  rentPaid: number;
  waterPaid: number;
  totalPaid: number;
  rentBalance: number;
  waterBalance: number;
  totalOutstanding: number;
  monthsInArrears: number;
  status: string;
}

type SortKey = 'unit' | 'total' | 'months';

export default function Arrears() {
  const navigate = useNavigate();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('total');

  const { data, loading, error } = useFetch<ArrearRow[]>(
    () => api.get<{ data: ArrearRow[] }>(`/api/reports/arrears?year=${year}`).then((r) => r.data),
    [year]
  );

  const { toast } = useToast();
  // Arrears report PDF — the year's outstanding balances as a printable
  // document. Fetched with the session token (endpoint requires auth) and
  // saved as a blob.
  const [downloading, setDownloading] = useState(false);
  const downloadReport = () => {
    const token = localStorage.getItem('rpms_token');
    if (!token) return;
    setDownloading(true);
    fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/reports/arrears.pdf?year=${year}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
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
        a.download = `arrears-report-${year}.pdf`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => toast('error', (err as Error).message))
      .finally(() => setDownloading(false));
  };

  const rows = useMemo(() => {
    let list = data ?? [];
    if (statusFilter) list = list.filter((r) => r.status === statusFilter);
    return [...list].sort((a, b) => {
      if (sortBy === 'unit') return a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true });
      if (sortBy === 'months') return b.monthsInArrears - a.monthsInArrears;
      return b.totalOutstanding - a.totalOutstanding;
    });
  }, [data, statusFilter, sortBy]);

  const totals = useMemo(() => {
    const list = data ?? [];
    return {
      rent: list.reduce((s, r) => s + Math.max(0, r.rentBalance), 0),
      water: list.reduce((s, r) => s + Math.max(0, r.waterBalance), 0),
      total: list.reduce((s, r) => s + Math.max(0, r.totalOutstanding), 0),
      overdues: list.filter((r) => r.status === 'OVERDUE' || r.status === 'UNPAID').length,
      cleared: list.filter((r) => r.status === 'CLEARED' || r.status === 'OVERPAID').length,
    };
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Arrears"
        subtitle="Who owes what — rent and water balances per occupied unit, with months in arrears"
        actions={
          <div className="flex items-center gap-2">
            <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-28">
              {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            {/* Outstanding balances as a printable PDF. */}
            <button
              type="button"
              onClick={downloadReport}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 active:scale-[0.98] disabled:opacity-60"
            >
              <Download size={15} strokeWidth={1.75} aria-hidden /> {downloading ? 'Preparing…' : 'Download Report (PDF)'}
            </button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Rent outstanding" value={money(totals.rent)} tone={totals.rent > 0 ? 'bad' : 'good'} />
        <KpiCard label="Water outstanding" value={money(totals.water)} tone={totals.water > 0 ? 'bad' : 'good'} />
        <KpiCard label="Total outstanding" value={money(totals.total)} tone={totals.total > 0 ? 'bad' : 'good'} />
        <KpiCard label="Overdue / unpaid tenants" value={totals.overdues} tone={totals.overdues > 0 ? 'warn' : 'good'} />
        <KpiCard label="Cleared tenants" value={totals.cleared} tone="good" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          <option value="OVERDUE">Overdue</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIAL">Partial</option>
          <option value="CLEARED">Cleared</option>
          <option value="OVERPAID">Overpaid</option>
        </Select>
        <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} className="w-44">
          <option value="total">Sort: highest balance</option>
          <option value="months">Sort: months in arrears</option>
          <option value="unit">Sort: unit number</option>
        </Select>
      </div>

      {loading && <SkeletonTable cols={11} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Unit</th><th>Tenant</th><th>Phone</th><th>Monthly Rent</th>
                <th>Rent Paid</th><th>Rent Balance</th>
                <th>Water Balance</th><th>Total Outstanding</th><th>Months in Arrears</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.unitId}>
                  <td className="font-semibold text-gray-900">Unit {r.unitNumber}</td>
                  <td className="font-medium">{r.tenantName}</td>
                  <td className="text-xs">{r.phoneNumber}</td>
                  <td>{money(r.monthlyRent)}</td>
                  <td>{money(r.rentPaid)}</td>
                  <td className={r.rentBalance > 0 ? 'font-medium text-red-600' : 'text-emerald-700'}>{money(r.rentBalance)}</td>
                  <td className={r.waterBalance > 0 ? 'font-medium text-red-600' : 'text-emerald-700'}>{money(r.waterBalance)}</td>
                  <td className={r.totalOutstanding > 0 ? 'font-semibold text-red-600' : 'text-emerald-700'}>{money(r.totalOutstanding)}</td>
                  <td>{r.monthsInArrears}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>
                    <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => navigate(`/ledger?tenant=${r.tenantId}`)}>
                      Ledger
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="p-6"><EmptyState message="No tenants match this filter — either everything is cleared or no tenants exist yet." /></div>}
        </div>
      )}
    </div>
  );
}
