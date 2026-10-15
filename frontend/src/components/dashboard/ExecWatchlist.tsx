// High-priority arrears & recovery watchlist — the dashboard's action table.
//
// Presentational by design: the page fetches `/api/reports/arrears` once and
// hands the rows here (and to the KPI card), so the "Overdue Arrears" number
// at the top of the page and every row in this table are the same query.
// Local state is only the view: search text, status filter and sort order.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Eye, Search, Send } from 'lucide-react';
import { Button, EmptyState, Select, SkeletonTable, StatusBadge, TextInput } from '../ui';
import { money, plural } from '../../lib/format';
import type { ArrearRow } from '../../pages/Arrears';

interface ExecWatchlistProps {
  rows: ArrearRow[] | null;
  loading: boolean;
  /** Report fetch failure — shown in place of the table, never a fake empty. */
  error?: string | null;
  currency: string;
}

const MAX_ROWS = 8;

export function ExecWatchlist({ rows, loading, error, currency }: ExecWatchlistProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  const visible = useMemo(() => {
    const all = rows ?? [];
    const q = query.trim().toLowerCase();
    return all
      .filter((r) => (status ? r.status === status : r.totalOutstanding > 0))
      .filter((r) =>
        q
          ? r.tenantName.toLowerCase().includes(q) ||
            r.unitNumber.toLowerCase().includes(q) ||
            r.phoneNumber.toLowerCase().includes(q)
          : true,
      )
      // Unit order (numeric-aware, so Unit 12 follows Unit 9): the operator
      // walks the building in unit order, and the list mirrors it.
      .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }))
      .slice(0, MAX_ROWS);
  }, [rows, query, status]);

  const openCount = (rows ?? []).filter((r) => r.totalOutstanding > 0).length;
  // Distinguish "nothing to chase" from "your filter hid it". Both look
  // identical in the table, but they call for different actions — telling an
  // operator to clear a search that never ran, or to loosen a status that is
  // already on "Open balances", is a dead end. This block only renders once
  // rows exist, and the subtitle above already states the true count, so the
  // empty state has to agree with it.
  const filtering = query.trim().length > 0 || status.length > 0;
  const emptyMessage =
    !filtering && openCount === 0
      ? 'No open balances right now — every tenant on the books is paid up.'
      : 'No rows match this filter — try a different status or clear the search.';

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">High-Priority Arrears &amp; Recovery Watchlist</h3>
          <p className="text-[11px] text-gray-500">
            {rows === null ? 'Loading balances…' : `${plural(openCount, 'tenant')} with an open balance, in unit order`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} strokeWidth={2} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tenant, unit, phone"
              aria-label="Search the arrears watchlist"
              className="!pl-8 !w-full min-w-[12rem]"
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="w-36">
            <option value="">Open balances</option>
            <option value="OVERDUE">Overdue</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PARTIAL">Partial</option>
            <option value="CLEARED">Cleared</option>
            <option value="OVERPAID">Overpaid</option>
          </Select>
          {/* Opens the SMS composer with the arrears audience — nothing is
              sent from here; a human still reviews and presses send. */}
          <Button variant="primary" onClick={() => navigate('/sms?compose=arrears')}>
            <Send size={14} strokeWidth={2} aria-hidden /> Send Reminders
          </Button>
        </div>
      </div>

      {loading && <SkeletonTable cols={9} rows={4} />}
      {!loading && error && <div className="p-4 text-sm text-red-600">Unable to load arrears: {error}</div>}
      {!loading && !error && (rows?.length ?? 0) === 0 && (
        <div className="p-6">
          <EmptyState message="No arrears data yet — record a payment or add a tenant to populate this watchlist." />
        </div>
      )}
      {!loading && !error && (rows?.length ?? 0) > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Unit</th>
                <th>Tenant</th>
                <th>Floor</th>
                <th>Phone</th>
                <th className="text-right">Outstanding</th>
                <th className="text-right">Months</th>
                <th>Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={r.unitId}>
                  <td className="text-xs text-gray-400">{i + 1}</td>
                  <td className="font-semibold text-gray-900">Unit {r.unitNumber}</td>
                  <td className="font-medium">{r.tenantName}</td>
                  <td className="text-xs text-gray-600">{r.floor || '—'}</td>
                  <td className="text-xs text-gray-600">{r.phoneNumber || '—'}</td>
                  <td className={`text-right font-semibold ${r.totalOutstanding > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {money(r.totalOutstanding, currency)}
                  </td>
                  <td className="text-right">{r.monthsInArrears}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        title="Open tenant ledger"
                        aria-label={`Open the ledger for ${r.tenantName}`}
                        onClick={() => navigate(`/ledger?tenant=${r.tenantId}`)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-brand-700 active:scale-95"
                      >
                        <Eye size={15} strokeWidth={1.75} aria-hidden />
                      </button>
                      <button
                        type="button"
                        title="Record a payment"
                        aria-label={`Record a payment for ${r.tenantName}`}
                        onClick={() => navigate('/rent?new=1')}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors duration-150 hover:bg-emerald-50 hover:text-emerald-700 active:scale-95"
                      >
                        <Banknote size={15} strokeWidth={1.75} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && (
            <div className="p-6">
              <EmptyState message={emptyMessage} />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">
        <span>
          Showing {visible.length} of {openCount} open balances
        </span>
        <Button variant="ghost" onClick={() => navigate('/arrears')} className="!px-2 !py-1 text-xs">
          Full arrears →
        </Button>
      </div>
    </div>
  );
}
