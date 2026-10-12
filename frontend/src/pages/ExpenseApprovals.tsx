import { useState } from 'react';
import { Button, EmptyState, Field, Modal, PageHeader, Pagination, Select, SkeletonTable, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatDate } from '../lib/format';

interface ExpenseApproval {
  id: number;
  expense_date: string;
  description: string;
  category: string;
  amount: string;
  payment_method: string;
  reference_number: string | null;
  notes: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requested_by_name: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expense_id: number | null;
}

const CATEGORIES = ['WATER', 'REPAIRS', 'ELECTRICITY', 'MAINTENANCE', 'CLEANING', 'SECURITY', 'TRANSPORT', 'OTHER'];
const PAYMENT_METHODS = ['CASH', 'M_PESA', 'BANK', 'OTHER'];

const EMPTY_FORM = { expenseDate: new Date().toISOString().slice(0, 10), description: '', category: 'REPAIRS', amount: '', paymentMethod: 'M_PESA', referenceNumber: '', notes: '' };

export default function ExpenseApprovals() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<ExpenseApproval | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const { data, loading, error } = useFetch(
    () => api.list<ExpenseApproval>(`/api/expense-approvals${qs({ page, limit: 20, status: statusFilter || undefined })}`),
    [page, statusFilter, refreshKey]
  );

  const refresh = () => setRefreshKey((k) => k + 1);

  async function submitRequest() {
    if (busy) return;
    if (form.description.trim().length < 2 || !form.amount || Number(form.amount) <= 0) {
      toast('error', 'Describe the cost and give a positive amount.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/expense-approvals', {
        expenseDate: form.expenseDate,
        description: form.description.trim(),
        category: form.category,
        amount: Number(form.amount),
        paymentMethod: form.paymentMethod,
        referenceNumber: form.referenceNumber.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      toast('success', 'Request submitted — a manager will review it.');
      setCreating(false);
      setForm({ ...EMPTY_FORM });
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(a: ExpenseApproval, decision: 'approve' | 'reject', note?: string) {
    try {
      const res = await api.post<{ data: ExpenseApproval }>(`/api/expense-approvals/${a.id}/${decision}`, note ? { note } : {});
      toast(
        'success',
        decision === 'approve'
          ? `Approved and recorded as an expense${res.data.expense_id ? ` (#${res.data.expense_id})` : ''}.`
          : 'Request rejected.'
      );
      setRejecting(null);
      setRejectNote('');
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader title="Expense Approvals" subtitle="Proposed costs awaiting a manager's decision — approvals write straight into the expense ledger" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </Select>
        <div className="ml-auto">
          <Button onClick={() => setCreating(true)}>Request Expense</Button>
        </div>
      </div>

      {loading && <SkeletonTable cols={6} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>Requested by</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {data.data.map((a) => (
                  <tr key={a.id}>
                    <td className="text-xs text-gray-500">{formatDate(a.expense_date)}</td>
                    <td className="max-w-[260px]">
                      <div className="truncate text-xs text-gray-700" title={a.description}>{a.description}</div>
                      {a.decision_note && <div className="text-[10px] text-gray-400" title={a.decision_note}>Note: {a.decision_note}</div>}
                    </td>
                    <td className="text-xs">{a.category}</td>
                    <td className="text-xs tabular-nums">{Number(a.amount).toLocaleString()}</td>
                    <td className="text-xs">{a.requested_by_name ?? '—'}</td>
                    <td>
                      <StatusBadge status={a.status} />
                      {a.expense_id && <div className="text-[10px] text-gray-400">expense #{a.expense_id}</div>}
                    </td>
                    <td>
                      {a.status === 'PENDING' ? (
                        <div className="flex gap-1">
                          <Button variant="ghost" className="!px-2 !py-1 text-xs text-emerald-700" onClick={() => decide(a, 'approve')}>Approve</Button>
                          <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-600" onClick={() => { setRejecting(a); setRejectNote(''); }}>Reject</Button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-gray-400">{a.decided_by_name ? `by ${a.decided_by_name}` : ''}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && (
              <div className="p-6"><EmptyState message={statusFilter === 'PENDING' ? 'Nothing waiting for approval.' : 'No requests here yet.'} /></div>
            )}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      {/* Create request */}
      <Modal open={creating} title="Request an expense" onClose={() => setCreating(false)}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Expense date">
              <TextInput type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
            </Field>
            <Field label="Amount">
              <TextInput type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </Field>
          </div>
          <Field label="What is it for?">
            <TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Gate motor repair — parts" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Payment method">
              <Select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m.replace('_', '-')}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Reference (optional)">
            <TextInput value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} placeholder="Receipt / invoice number" />
          </Field>
          <Field label="Notes (optional)">
            <TextInput value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Why this cost is needed…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button loading={busy} onClick={submitRequest}>Submit request</Button>
          </div>
        </div>
      </Modal>

      {/* Reject with note */}
      <Modal open={rejecting !== null} title="Reject expense request" onClose={() => setRejecting(null)}>
        {rejecting && (
          <div className="space-y-3">
            <div className="text-sm text-gray-600">
              Rejecting <strong>{rejecting.description}</strong> ({Number(rejecting.amount).toLocaleString()}) requested by {rejecting.requested_by_name ?? 'unknown'}.
            </div>
            <Field label="Reason (optional)" hint="Helps the requester understand the decision.">
              <TextInput value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="e.g. Budget for this month is exhausted" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => decide(rejecting, 'reject', rejectNote.trim() || undefined)}>Reject request</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
