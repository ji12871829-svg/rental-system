import { useState } from 'react';
import { Button, EmptyState, Field, Modal, PageHeader, Pagination, Select, SkeletonTable, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatDate } from '../lib/format';

interface RecurringExpense {
  id: number;
  description: string;
  category: string;
  amount: string;
  payment_method: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  next_due_date: string;
  active: boolean;
  last_generated_at: string | null;
  last_expense_id: number | null;
  due: boolean;
}

interface GenerationResult {
  generated: number;
  failures: { recurringId: number; error: string }[];
  remaining: number;
}

const CATEGORIES = ['WATER', 'REPAIRS', 'ELECTRICITY', 'MAINTENANCE', 'CLEANING', 'SECURITY', 'TRANSPORT', 'OTHER'];
const PAYMENT_METHODS = ['CASH', 'M_PESA', 'BANK', 'OTHER'];
const FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'YEARLY'];

const EMPTY_FORM = { description: '', category: 'SECURITY', amount: '', paymentMethod: 'M_PESA', frequency: 'MONTHLY', nextDueDate: new Date().toISOString().slice(0, 10), active: true };

export default function RecurringExpenses() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);

  const { data, loading, error } = useFetch(
    () => api.list<RecurringExpense>(`/api/recurring-expenses${qs({ page, limit: 20 })}`),
    [page, refreshKey]
  );

  const refresh = () => setRefreshKey((k) => k + 1);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setCreating(true);
  }

  function openEdit(r: RecurringExpense) {
    setForm({
      description: r.description,
      category: r.category,
      amount: String(r.amount),
      paymentMethod: r.payment_method,
      frequency: r.frequency,
      nextDueDate: r.next_due_date.slice(0, 10),
      active: r.active,
    });
    setEditing(r);
  }

  async function save() {
    if (busy) return;
    if (form.description.trim().length < 2 || !form.amount || Number(form.amount) <= 0) {
      toast('error', 'Give the cost a description and a positive amount.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        description: form.description.trim(),
        category: form.category,
        amount: Number(form.amount),
        paymentMethod: form.paymentMethod,
        frequency: form.frequency,
        nextDueDate: form.nextDueDate,
        active: form.active,
      };
      if (editing) await api.put(`/api/recurring-expenses/${editing.id}`, body);
      else await api.post('/api/recurring-expenses', body);
      toast('success', editing ? 'Recurring expense updated.' : 'Recurring expense added — the nightly sweep records it when due.');
      setEditing(null);
      setCreating(false);
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: RecurringExpense) {
    if (!window.confirm(`Delete the recurring expense "${r.description}"? Recorded expenses are kept.`)) return;
    try {
      await api.del(`/api/recurring-expenses/${r.id}`);
      toast('success', 'Recurring expense deleted.');
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  async function generate(r: RecurringExpense) {
    try {
      await api.post(`/api/recurring-expenses/${r.id}/generate`);
      toast('success', `Recorded "${r.description}" in the expense ledger and advanced the schedule.`);
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  async function generateAllDue() {
    try {
      const res = await api.post<{ data: GenerationResult }>('/api/recurring-expenses/generate-due', {});
      const { generated, failures, remaining } = res.data;
      if (generated === 0 && failures.length === 0) {
        toast('success', 'Nothing is due right now.');
      } else {
        toast(
          failures.length > 0 ? 'error' : 'success',
          `Generated ${generated} expense${generated === 1 ? '' : 's'}${failures.length ? `, ${failures.length} failed` : ''}${remaining ? `, ${remaining} still due` : ''}.`
        );
      }
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  const modalOpen = creating || editing !== null;

  return (
    <div>
      <PageHeader title="Recurring Expenses" subtitle="Standing costs the nightly sweep records automatically — garbage, security, insurance" />

      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="text-xs text-gray-500">The sweep runs once a day; “Generate” records a due period early.</div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={generateAllDue}>Generate all due</Button>
          <Button onClick={openCreate}>Add Recurring Expense</Button>
        </div>
      </div>

      {loading && <SkeletonTable cols={7} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Description</th><th>Category</th><th>Amount</th><th>Frequency</th><th>Next due</th><th>Last recorded</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {data.data.map((r) => (
                  <tr key={r.id} className={r.due && r.active ? 'bg-amber-50/60' : undefined}>
                    <td className="font-medium">
                      {r.description}
                      {!r.active && <div className="text-[10px] text-gray-400">paused</div>}
                    </td>
                    <td className="text-xs">{r.category}</td>
                    <td className="text-xs tabular-nums">{Number(r.amount).toLocaleString()}</td>
                    <td className="text-xs">{r.frequency}</td>
                    <td className="text-xs">
                      {formatDate(r.next_due_date)}
                      {r.active && r.due && (
                        <div className="text-[10px] font-semibold text-amber-600">due now</div>
                      )}
                    </td>
                    <td className="text-xs text-gray-500">
                      {r.last_generated_at ? formatDate(r.last_generated_at) : '—'}
                      {r.last_expense_id && <div className="text-[10px]">expense #{r.last_expense_id}</div>}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        {r.active && r.due && (
                          <Button variant="ghost" className="!px-2 !py-1 text-xs text-emerald-700" onClick={() => generate(r)}>Generate</Button>
                        )}
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => openEdit(r)}>Edit</Button>
                        <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-600" onClick={() => remove(r)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && <div className="p-6"><EmptyState message="No recurring expenses — add standing costs like garbage collection or the security contract." /></div>}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      <Modal open={modalOpen} title={editing ? 'Edit recurring expense' : 'Add recurring expense'} onClose={() => { setEditing(null); setCreating(false); }}>
        <div className="space-y-3">
          <Field label="Description">
            <TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Garbage collection — monthly" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Amount">
              <TextInput type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </Field>
            <Field label="Payment method">
              <Select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m.replace('_', '-')}</option>
                ))}
              </Select>
            </Field>
            <Field label="Frequency">
              <Select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Next due date" hint="The first period the sweep will record.">
            <TextInput type="date" value={form.nextDueDate} onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active (the sweep generates it when due)
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setEditing(null); setCreating(false); }}>Cancel</Button>
            <Button loading={busy} onClick={save}>{editing ? 'Save changes' : 'Add recurring expense'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
