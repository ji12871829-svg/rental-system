// Executive dashboard feed row — the two live lists under the watchlist:
//   • Live Payment Gateway Stream — the most recent rent receipts, newest first
//   • Unit Turnovers & Repairs    — open maintenance work + the vacant-unit count
//
// Both panels fetch their own list on mount (the endpoints are cheap, staff-
// scoped reads) so the dashboard page keeps only the two payloads it cannot
// render without: the dashboard summary and the arrears report.
import { Link, useNavigate } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { EmptyState, SkeletonTable, StatusBadge, useFetch } from '../ui';
import { api } from '../../lib/api';
import { formatDate, methodLabel, money, plural } from '../../lib/format';

interface PaymentRow {
  id: number;
  payment_date: string;
  amount: string;
  payment_method: string;
  receipt_number: string | null;
  tenant_name: string;
  unit_number: string;
}

interface MaintenanceRow {
  id: number;
  title: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED';
  reported_at: string;
  unit_number: string | null;
}

/** Initials for the row avatar — "Dago Bogala" → "DB". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/** Most recent rent payments, newest first (the endpoint sorts payment_date DESC). */
export function ExecPaymentStream({ currency }: { currency: string }) {
  const { data, loading, error } = useFetch<PaymentRow[]>(() =>
    api.list<PaymentRow>('/api/rent/payments?page=1&limit=6').then((r) => r.data),
  );
  const rows = data ?? [];

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Live Payment Gateway Stream</h3>
          <p className="text-[11px] text-gray-500">Latest receipts across cash, M-Pesa and bank</p>
        </div>
        <Link to="/rent" className="text-[11px] font-semibold text-brand-700 hover:underline">
          View all →
        </Link>
      </div>

      {loading && <div className="p-3"><SkeletonTable cols={3} rows={3} /></div>}
      {error && <div className="p-4 text-sm text-red-600">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="p-4">
          <EmptyState message="No payments recorded yet — the stream fills as receipts are minted." />
        </div>
      )}
      {!loading && !error && rows.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700"
                aria-hidden
              >
                {initials(p.tenant_name) || '?'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-gray-900">{p.tenant_name}</span>
                <span className="block truncate text-[11px] text-gray-500">
                  Unit {p.unit_number} · {methodLabel(p.payment_method)}
                  {p.receipt_number ? ` · ${p.receipt_number}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-xs font-bold text-emerald-700">{money(p.amount, currency)}</span>
                <span className="block text-[10px] text-gray-400">{formatDate(p.payment_date)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Repairs and turnover: the newest maintenance requests (the endpoint already
 * orders by priority then recency) plus the vacant-unit count from the
 * dashboard payload, which is what "turnover" means here — empty units that
 * need a make-ready before the next tenancy.
 */
export function ExecTurnovers({ vacantUnits }: { vacantUnits: number }) {
  const navigate = useNavigate();
  const { data, loading, error } = useFetch<MaintenanceRow[]>(() =>
    api.list<MaintenanceRow>('/api/maintenance?page=1&limit=5').then((r) => r.data),
  );
  const requests = data ?? [];

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Unit Turnovers &amp; Repairs</h3>
          <p className="text-[11px] text-gray-500">Open work orders and units awaiting make-ready</p>
        </div>
        <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
          {vacantUnits} vacant
        </span>
      </div>

      {loading && <div className="p-3"><SkeletonTable cols={3} rows={3} /></div>}
      {error && <div className="p-4 text-sm text-red-600">{error}</div>}
      {!loading && !error && requests.length === 0 && (
        <div className="p-4">
          <EmptyState message="No repair requests — log one from the Maintenance board when a tenant reports a problem." />
        </div>
      )}
      {!loading && !error && requests.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600" aria-hidden>
                <Wrench size={15} strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-gray-900">{r.title}</span>
                <span className="block truncate text-[11px] text-gray-500">
                  {r.unit_number ? `Unit ${r.unit_number}` : 'Whole property'} · reported {formatDate(r.reported_at)}
                </span>
              </span>
              <span className="shrink-0">
                <StatusBadge status={r.status} />
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">
        <span>{plural(vacantUnits, 'unit')} ready to let</span>
        <button
          type="button"
          onClick={() => navigate('/maintenance')}
          className="font-semibold text-brand-700 hover:underline"
        >
          Maintenance board →
        </button>
      </div>
    </div>
  );
}
