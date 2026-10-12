import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ClipboardCheck, Droplets, ReceiptText, Smartphone, Wallet, Wrench } from 'lucide-react';
import { Button, EmptyState, Select, SkeletonTable, StatusBadge, useFetch } from '../../components/ui';
import { money } from '../../lib/format';
import type { TemplateKindRow } from '../../lib/api';
import type { ArrearRow } from '../../pages/Arrears';

// Local arrears table for the dashboard — fetches the arrears report for the
// dashboard's reporting year and renders a compact xampp RMS-style arrears card
// (header with period select + table + footer summary). Uses the same row type
// the Arrears page uses so the two stay in sync.
//
// Period filter: xampp RMS offers 30/60/90 days; the local backend's arrears
// endpoint is year-scoped (not rolling-window), so the local period select
// maps to a year override (current / prior / next) — same spirit (time scope)
// but honest about what the local endpoint supports.
interface ArrearsTableProps {
  reportingYear: number;
}

const YEAR_OPTIONS = [
  { value: 'current', label: 'This year' },
  { value: 'prior', label: 'Last year' },
  { value: 'next', label: 'Next year' },
];

function yearFromOption(opt: string, current: number): number {
  if (opt === 'current') return current;
  if (opt === 'prior') return current - 1;
  return current + 1;
}

export function XrmContentRow({ reportingYear }: ArrearsTableProps) {
  const navigate = useNavigate();
  const [year, setYear] = useState<string>('current');
  const targetYear = yearFromOption(year, reportingYear);

  const { data, loading, error } = useFetch<ArrearRow[]>(
    () => fetch(`/api/reports/arrears?year=${targetYear}`).then((r) => r.json()).then((body) => body.data),
    [targetYear],
  );

  const visibleArrearsRows = useMemo(() => (data ?? []).slice(0, 8), [data]);
  const summary = visibleArrearsRows.length > 0
    ? `Showing ${visibleArrearsRows.length} of ${data?.length ?? 0} tenants in arrears`
    : 'No tenants in arrears';

  if (loading) return <SkeletonTable cols={6} />;
  if (error) return <div className="text-sm text-red-600">{error}</div>;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Arrears Overview</h3>
        <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-32">
          {YEAR_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </div>

      {visibleArrearsRows.length === 0 ? (
        <EmptyState message="No tenants in arrears for this period" />
      ) : (
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Unit</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Tenant</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Due</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Paid</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Balance</th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleArrearsRows.map((r) => (
              <tr key={r.unitId} className="border-t border-gray-50">
                <td className="px-4 py-2.5 text-xs font-semibold text-gray-900">Unit {r.unitNumber}</td>
                <td className="px-4 py-2.5 text-xs font-medium text-gray-700">{r.tenantName}</td>
                <td className="px-4 py-2.5 text-right text-xs text-gray-600">{money(r.totalAmountDue)}</td>
                <td className="px-4 py-2.5 text-right text-xs text-emerald-700">{money(r.totalPaid)}</td>
                <td className={`px-4 py-2.5 text-right text-xs font-semibold ${r.totalOutstanding > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {money(r.totalOutstanding)}
                </td>
                <td className="px-4 py-2.5 text-center"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">
        <span>{summary}</span>
        <Button variant="ghost" onClick={() => navigate('/arrears')} className="!px-2 !py-1 text-xs">
          Full arrears →
        </Button>
      </div>
    </div>
  );
}


// Quick actions card — mirrors xampp RMS .quick-card / .quick-grid / .quick-item
// (design-system.css §CONTENT ROW) with local quick actions. Each item deep-links
// with ?new=1 to pre-open the target page's form.
const QUICK_ITEMS = [
  { label: 'Record Payment', to: '/rent?new=1', icon: <Wallet size={15} strokeWidth={1.75} />, managerOnly: false },
  { label: 'Log Reading', to: '/water?new=1', icon: <Droplets size={15} strokeWidth={1.75} />, managerOnly: false },
  { label: 'Add Expense', to: '/expenses?new=1', icon: <ReceiptText size={15} strokeWidth={1.75} />, managerOnly: true },
  { label: 'Add Tenant', to: '/tenants?new=1', icon: <Building2 size={15} strokeWidth={1.75} />, managerOnly: false },
  { label: 'Add Unit', to: '/units?new=1', icon: <Wrench size={15} strokeWidth={1.75} />, managerOnly: false },
  { label: 'Send SMS', to: '/sms?new=1', icon: <Smartphone size={15} strokeWidth={1.75} />, managerOnly: false },
  { label: 'Log Maintenance', to: '/maintenance?new=1', icon: <Wrench size={15} strokeWidth={1.75} />, managerOnly: true },
  { label: 'Review M-Pesa', to: '/mpesa-review?new=1', icon: <ClipboardCheck size={15} strokeWidth={1.75} />, managerOnly: true },
];

interface QuickActionsCardProps {
  userRole: string;
  selectedSmsKinds: TemplateKindRow[];
  selectedEmailKinds: TemplateKindRow[];
}

export function QuickActionsCard({ userRole, selectedSmsKinds = [], selectedEmailKinds = [] }: QuickActionsCardProps) {
  const isAdmin = userRole === 'ADMIN';
  const isManager = isAdmin || userRole === 'PROPERTY_MANAGER';

  const visible = QUICK_ITEMS.filter((item) => {
    if (item.managerOnly) return isManager;
    return true;
  });

  const hasSmsTemplateChoice = (selectedSmsKinds ?? []).length > 0;
  const hasEmailTemplateChoice = (selectedEmailKinds ?? []).length > 0;
  const hasTemplateChoice = hasSmsTemplateChoice || hasEmailTemplateChoice;

  function quickLink(to: string, templateKind?: string | null) {
    const params = new URLSearchParams();
    params.set('new', '1');
    if (templateKind) params.set('template', templateKind);
    return `${to}?${params.toString()}`;
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900">Quick Actions</h3>

      {hasTemplateChoice ? (
        <div className="mt-2 rounded-lg border border-gray-200 bg-fog p-3">
          <p className="text-xs font-medium text-graphite">Send with a saved template</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">SMS</span>
              {selectedSmsKinds.map((t) => (
                <a
                  key={t.kind}
                  href={quickLink('/sms?new=1', t.kind)}
                  className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
                >
                  {t.label}
                </a>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Email</span>
              {selectedEmailKinds.map((t) => (
                <a
                  key={t.kind}
                  href={quickLink('/emails/campaign?new=1', t.kind)}
                  className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
                >
                  {t.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {visible.map((item) => (
          <a
            key={item.to + item.label}
            href={quickLink(item.to)}
            className="group flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-medium text-gray-700 transition-[border-color,background-color,color] duration-150 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700 active:scale-[0.98]"
          >
            <span className="shrink-0 text-brand-500 group-hover:text-brand-700">{item.icon}</span>
            {item.label}
          </a>
        ))}
      </div>
    </div>
  );
}
