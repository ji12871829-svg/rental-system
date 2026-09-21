import { useState } from 'react';
import { PageHeader, Button, useFetch, useToast } from '../components/ui';
import { api } from '../lib/api';
import { money, formatDate } from '../lib/format';

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
}

interface TenantRow { id: number; full_name: string; unit_number: string | null; }

export default function MpesaReview() {
  const { toast } = useToast();
  const { data, loading, refresh } = useFetch<{ data: ReviewRow[] }>(() => api.get('/api/mpesa/review'), []);
  const { data: tenantsData } = useFetch<{ data: TenantRow[] }>(() => api.get('/api/tenants?limit=100'), []);
  const [busy, setBusy] = useState<number | null>(null);
  const [selection, setSelection] = useState<Record<number, { tenantId: string; kind: 'RENT' | 'WATER' }>>({});

  async function resolve(row: ReviewRow) {
    const selected = selection[row.id];
    if (!selected?.tenantId) {
      toast('error', 'Select the tenant before resolving this payment.');
      return;
    }
    setBusy(row.id);
    try {
      await api.post(`/api/mpesa/review/${row.id}/resolve`, { tenantId: Number(selected.tenantId), kind: selected.kind });
      toast('success', 'M-Pesa payment posted.');
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
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
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="M-Pesa Review" subtitle="Resolve PayBill transactions that could not be matched automatically" />
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {loading && <p className="p-6 text-sm text-gray-500">Loading review queue…</p>}
        {!loading && (data?.data.length ?? 0) === 0 && <p className="p-6 text-sm text-gray-500">No unmatched M-Pesa transactions.</p>}
        {!loading && (data?.data.length ?? 0) > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Transaction</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Resolve</th>
            </tr></thead>
            <tbody>{data!.data.map((row) => {
              const selected = selection[row.id] ?? { tenantId: '', kind: row.payment_kind };
              return <tr key={row.id} className="border-b border-gray-100 align-top last:border-0">
                <td className="px-4 py-3 text-gray-900"><b>{row.transaction_id}</b><br /><span className="text-xs text-gray-500">{formatDate(row.transaction_date)}{row.phone_number ? ` · ${row.phone_number}` : ''}</span></td>
                <td className="px-4 py-3 text-gray-700">{row.account_reference}<br /><span className="text-xs text-red-700">{row.status}</span></td>
                <td className="px-4 py-3 font-medium">{money(row.amount, 'KSh')}</td>
                <td className="max-w-xs px-4 py-3 text-gray-600">{row.error_message ?? 'Needs staff review'}</td>
                <td className="min-w-72 px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <select value={selected.tenantId} onChange={(e) => setSelection((all) => ({ ...all, [row.id]: { ...selected, tenantId: e.target.value } }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                      <option value="">Select tenant</option>
                      {(tenantsData?.data ?? []).map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.full_name}{tenant.unit_number ? ` · ${tenant.unit_number}` : ''}</option>)}
                    </select>
                    <select value={selected.kind} onChange={(e) => setSelection((all) => ({ ...all, [row.id]: { ...selected, kind: e.target.value as 'RENT' | 'WATER' } }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                      <option value="RENT">Rent</option><option value="WATER">Water</option>
                    </select>
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
