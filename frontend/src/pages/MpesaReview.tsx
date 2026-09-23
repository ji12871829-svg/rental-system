import { useState } from 'react';
import { PageHeader, Button, useFetch, useShake, useToast } from '../components/ui';
import { api } from '../lib/api';
import { money, formatDate } from '../lib/format';

interface SuggestedTenant { id: number; full_name: string; unit_number: string | null; }

interface ReviewRow {
  id: number;
  transaction_id: string;
  amount: number;
  account_reference: string;
  payment_kind: 'RENT' | 'WATER';
  transaction_date: string;
  phone_number: string | null;
  status: string;
  error_message: string | null;
  tenant_name: string | null;
  unit_number: string | null;
  suggested_tenant: SuggestedTenant | null;
}

interface TenantRow { id: number; full_name: string; unit_number: string | null; }

export default function MpesaReview() {
  const { toast } = useToast();
  const { data, loading, refresh } = useFetch<{ data: ReviewRow[] }>(() => api.get('/api/mpesa/review'), []);
  const { data: tenantsData } = useFetch<{ data: TenantRow[] }>(() => api.get('/api/tenants?limit=100'), []);
  const [busy, setBusy] = useState<number | null>(null);
  const [selection, setSelection] = useState<Record<number, { tenantId: string; kind: 'RENT' | 'WATER'; allocate: boolean }>>({});
  const [shakeRef, fireShake] = useShake();

  function selectionFor(row: ReviewRow) {
    return selection[row.id] ?? {
      tenantId: row.suggested_tenant ? String(row.suggested_tenant.id) : '',
      kind: row.payment_kind,
      allocate: true,
    };
  }

  async function resolve(row: ReviewRow) {
    const selected = selectionFor(row);
    if (!selected.tenantId) {
      toast('error', 'Select the tenant before resolving this payment.');
      fireShake();
      return;
    }
    setBusy(row.id);
    try {
      await api.post(`/api/mpesa/review/${row.id}/resolve`, {
        tenantId: Number(selected.tenantId),
        kind: selected.kind,
        allocate: selected.allocate,
      });
      toast('success', selected.allocate && selected.kind === 'RENT'
        ? 'M-Pesa payment posted and allocated across the oldest arrears.'
        : 'M-Pesa payment posted.');
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
      fireShake();
    } finally {
      setBusy(null);
    }
  }

  async function ignore(row: ReviewRow) {
    setBusy(row.id);
    try {
      await api.post(`/api/mpesa/review/${row.id}/ignore`, {});
      toast('success', 'Transaction moved out of review.');
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
      fireShake();
    } finally {
      setBusy(null);
    }
  }

  const rows = data?.data ?? [];
  const totalPending = rows.reduce((s, r) => s + r.amount, 0);
  const suggestedCount = rows.filter((r) => r.suggested_tenant).length;

  return (
    <div>
      <PageHeader title="M-Pesa Review" subtitle="Resolve PayBill transactions that could not be matched automatically" />
      {rows.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3 text-sm">
          <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-800"><b>{rows.length}</b> pending · <b>{money(totalPending, 'KSh')}</b> held</span>
          {suggestedCount > 0 && (
            <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-800">{suggestedCount} matched by sender phone — confirm to post</span>
          )}
        </div>
      )}
      <div ref={shakeRef} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {loading && <p className="p-6 text-sm text-gray-500">Loading review queue…</p>}
        {!loading && rows.length === 0 && <p className="p-6 text-sm text-gray-500">No unmatched M-Pesa transactions — every payment has been matched automatically.</p>}
        {!loading && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Transaction</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Resolve</th>
            </tr></thead>
            <tbody>{rows.map((row) => {
              const selected = selectionFor(row);
              return <tr key={row.id} className="border-b border-gray-100 align-top last:border-0">
                <td className="px-4 py-3 text-gray-900"><b>{row.transaction_id}</b><br /><span className="text-xs text-gray-500">{formatDate(row.transaction_date)}{row.phone_number ? ` · ${row.phone_number}` : ''}</span></td>
                <td className="px-4 py-3 text-gray-700">{row.account_reference}<br /><span className="text-xs text-red-700">{row.status}</span></td>
                <td className="px-4 py-3 font-medium">{money(row.amount, 'KSh')}</td>
                <td className="max-w-xs px-4 py-3 text-gray-600">
                  {row.error_message ?? 'Needs staff review'}
                  {row.suggested_tenant && (
                    <span className="mt-1 block text-xs font-medium text-emerald-700">
                      Likely: {row.suggested_tenant.full_name}{row.suggested_tenant.unit_number ? ` · ${row.suggested_tenant.unit_number}` : ''} (sender phone)
                    </span>
                  )}
                </td>
                <td className="min-w-72 px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <select value={selected.tenantId} onChange={(e) => setSelection((all) => ({ ...all, [row.id]: { ...selected, tenantId: e.target.value } }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                      <option value="">Select tenant</option>
                      {(tenantsData?.data ?? []).map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.full_name}{tenant.unit_number ? ` · ${tenant.unit_number}` : ''}</option>)}
                    </select>
                    <select value={selected.kind} onChange={(e) => setSelection((all) => ({ ...all, [row.id]: { ...selected, kind: e.target.value as 'RENT' | 'WATER' } }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                      <option value="RENT">Rent</option><option value="WATER">Water</option>
                    </select>
                    {selected.kind === 'RENT' && (
                      <label className="flex items-center gap-1.5 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={selected.allocate}
                          onChange={(e) => setSelection((all) => ({ ...all, [row.id]: { ...selected, allocate: e.target.checked } }))}
                        />
                        clear oldest arrears
                      </label>
                    )}
                    <Button type="button" disabled={busy === row.id} loading={busy === row.id} onClick={() => resolve(row)}>Post</Button>
                    <Button type="button" variant="secondary" disabled={busy === row.id} loading={busy === row.id} onClick={() => ignore(row)}>Ignore</Button>
                  </div>
                </td>
              </tr>;
            })}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
