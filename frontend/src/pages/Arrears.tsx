import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, AlertTriangle } from 'lucide-react';
import { Button, EmptyState, MetricCardWithActions, PageHeader, Select, SkeletonTable, StatusBadge, useFetch, useToast } from '../components/ui';
import { api } from '../lib/api';
import { downloadBlob } from '../lib/download';
import { money } from '../lib/format';
import { useQueryParam } from '../lib/useQueryParam';

export interface ArrearRow {
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
  // Unit filter lives in the URL (?unit=2) so dashboard chart bars can
  // deep-link straight to one unit's arrears row — shared hook syncs both ways.
  const [unitFilter, setUnitFilter] = useQueryParam('unit');
  const [statusFilter, setStatusFilter] = useState('');
  // Unit order is the default: the operator walks the building in unit
  // order, and the list mirrors it. Highest-balance / months views stay one
  // click away in the sort dropdown.
  const [sortBy, setSortBy] = useState<SortKey>('unit');

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
    setDownloading(true);
    downloadBlob(`/api/reports/arrears.pdf?year=${year}`, `arrears-report-${year}.pdf`, (status) => `Report download failed (${status}).`)
      .catch((err) => toast('error', (err as Error).message))
      .finally(() => setDownloading(false));
  };

  const rows = useMemo(() => {
    let list = data ?? [];
    if (unitFilter) list = list.filter((r) => r.unitNumber === unitFilter);
    if (statusFilter) list = list.filter((r) => r.status === statusFilter);
    return [...list].sort((a, b) => {
      if (sortBy === 'unit') return a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true });
      if (sortBy === 'months') return b.monthsInArrears - a.monthsInArrears;
      return b.totalOutstanding - a.totalOutstanding;
    });
  }, [data, unitFilter, statusFilter, sortBy]);

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
        <MetricCardWithActions
          label="Rent outstanding"
          value={money(totals.rent)}
          sub="Unpaid rent across all units"
          tone={totals.rent > 0 ? 'bad' : 'good'}
          icon={<AlertTriangle size={16} strokeWidth={1.75} />}
          iconVariant={totals.rent > 0 ? 'red' : 'green'}
          actions={[
            { label: 'View Details', to: '/arrears' },
          ]}
        />
        <MetricCardWithActions
          label="Water outstanding"
          value={money(totals.water)}
          sub="Unpaid water bills"
          tone={totals.water > 0 ? 'bad' : 'good'}
          icon={<AlertTriangle size={16} strokeWidth={1.75} />}
          iconVariant={totals.water > 0 ? 'red' : 'green'}
          actions={[
            { label: 'View Details', to: '/arrears' },
          ]}
        />
        <MetricCardWithActions
          label="Total outstanding"
          value={money(totals.total)}
          sub="Rent + water"
          tone={totals.total > 0 ? 'bad' : 'good'}
          icon={<AlertTriangle size={16} strokeWidth={1.75} />}
          iconVariant={totals.total > 0 ? 'red' : 'green'}
          actions={[
            { label: 'View Details', to: '/arrears' },
            ...(totals.total > 0 ? [{ label: 'Send Reminders', to: '/sms?compose=arrears' }] : []),
          ]}
        />
        <MetricCardWithActions
          label="Overdue / unpaid tenants"
          value={totals.overdues}
          sub="Tenants past due date"
          tone={totals.overdues > 0 ? 'warn' : 'good'}
          icon={<AlertTriangle size={16} strokeWidth={1.75} />}
          iconVariant={totals.overdues > 0 ? 'red' : 'green'}
          actions={[
            { label: 'View Details', to: '/arrears' },
          ]}
        />
        <MetricCardWithActions
          label="Cleared tenants"
          value={totals.cleared}
          sub="Fully paid or overpaid"
          tone="good"
          icon={<AlertTriangle size={16} strokeWidth={1.75} />}
          iconVariant="green"
          actions={[
            { label: 'View Details', to: '/arrears' },
          ]}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {/* One option per unit with arrears data — the deep-link target for
            the dashboard's "Outstanding by Unit" charts. */}
        <Select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="w-36">
          <option value="">All units</option>
          {[...new Set((data ?? []).map((r) => r.unitNumber))]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map((u) => <option key={u} value={u}>Unit {u}</option>)}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          <option value="OVERDUE">Overdue</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIAL">Partial</option>
          <option value="CLEARED">Cleared</option>
          <option value="OVERPAID">Overpaid</option>
        </Select>
        <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} className="w-44">
          <option value="unit">Sort: unit number</option>
          <option value="total">Sort: highest balance</option>
          <option value="months">Sort: months in arrears</option>
        </Select>
      </div>

      {loading && <SkeletonTable cols={12} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th><th>Unit</th><th>Tenant</th><th>Phone</th><th>Monthly Rent</th>
                <th>Rent Paid</th><th>Rent Balance</th>
                <th>Water Balance</th><th>Total Outstanding</th><th>Months in Arrears</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.unitId}>
                  <td className="text-xs text-gray-400">{i + 1}</td>
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
