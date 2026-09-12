import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '../components/charts';
import { Button, EmptyState, Field, KpiCard, Modal, PageHeader, Pagination, Select, SkeletonTable, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { MONTHS, categoryLabel, formatDate, methodLabel, money } from '../lib/format';

interface Expense {
  id: number;
  expense_date: string;
  description: string;
  category: string;
  amount: string;
  payment_method: string;
  reference_number: string | null;
  notes: string | null;
}

interface Summary {
  reportingYear: number;
  totalExpenses: number;
  byCategory: { category: string; total: number }[];
  byMonth: { month: number; monthName: string; total: number }[];
}

const CATEGORIES = ['WATER', 'REPAIRS', 'ELECTRICITY', 'MAINTENANCE', 'CLEANING', 'SECURITY', 'TRANSPORT', 'OTHER'];

export default function Expenses() {
  const { canManage } = useAuth();
  const { toast } = useToast();
  const now = new Date();
  const [edit, setEdit] = useState<Expense | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [yearFilter, setYearFilter] = useState(String(now.getFullYear()));
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error } = useFetch(
    () => api.list<Expense>(`/api/expenses${qs({ page, limit: 20, q: q || undefined, category: categoryFilter || undefined, month: monthFilter || undefined, year: yearFilter || undefined })}`),
    [page, q, categoryFilter, monthFilter, yearFilter, refreshKey]
  );
  const { data: summary } = useFetch<Summary>(
    () => api.get<{ data: Summary }>(`/api/expenses/summary?year=${yearFilter}`).then((r) => r.data),
    [yearFilter, refreshKey]
  );

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Property costs by category — Total Money Collected − Total Expenses = Net Property Income"
        actions={canManage ? <Button onClick={() => { setEdit(null); setShowForm(true); }}><Plus size={16} strokeWidth={2} aria-hidden /> Add Expense</Button> : undefined}
      />

      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label={`Total expenses ${summary.reportingYear}`} value={money(summary.totalExpenses)} tone="warn" />
          <KpiCard label="This month" value={money(summary.byMonth.find((m) => m.month === now.getMonth() + 1)?.total ?? 0)} />
          <KpiCard label="Biggest category" value={summary.byCategory[0] ? categoryLabel(summary.byCategory[0].category) : '—'} sub={summary.byCategory[0] ? money(summary.byCategory[0].total) : undefined} />
          <KpiCard label="Categories used" value={summary.byCategory.length} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <TextInput placeholder="Search description or reference…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-44">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
        </Select>
        <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="w-40">
          <option value="">All months</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select>
        <Select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="w-24">
          {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>

      {loading && <SkeletonTable cols={8} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Description</th><th>Category</th><th>Amount</th>
                  <th>Method</th><th>Reference</th><th>Notes</th>{canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {data.data.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.expense_date)}</td>
                    <td className="font-medium text-gray-900">{e.description}</td>
                    <td>{categoryLabel(e.category)}</td>
                    <td className="font-semibold">{money(e.amount)}</td>
                    <td>{methodLabel(e.payment_method)}</td>
                    <td className="text-xs">{e.reference_number ?? '—'}</td>
                    <td className="max-w-[200px] truncate text-xs text-gray-500" title={e.notes ?? ''}>{e.notes ?? '—'}</td>
                    {canManage && (
                      <td>
                        <div className="flex gap-1">
                          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => { setEdit(e); setShowForm(true); }}>Edit</Button>
                          <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-600" onClick={async () => {
                            if (!window.confirm(`Delete expense "${e.description}" of ${money(e.amount)}?`)) return;
                            try { await api.del(`/api/expenses/${e.id}`); toast('success', 'Expense deleted.'); refresh(); }
                            catch (err) { toast('error', (err as Error).message); }
                          }}>Delete</Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && <div className="p-6"><EmptyState message="No expenses found — add your first property expense." /></div>}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      {summary && summary.byCategory.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Expenses by category ({summary.reportingYear})</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={summary.byCategory} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="category" width={90} tickFormatter={(c: string) => categoryLabel(c)} />
                <Tooltip formatter={(v: any) => money(v)} />
                <Bar dataKey="total" fill="#ef4444" name="Total" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Expenses by month ({summary.reportingYear})</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={summary.byMonth}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={(d: any) => d.monthName.slice(0, 3)} />
                <YAxis />
                <Tooltip formatter={(v: any) => money(v)} />
                <Bar dataKey="total" fill="#f59e0b" name="Total" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <ExpenseForm
        open={showForm}
        expense={edit}
        onClose={() => setShowForm(false)}
        onSaved={(msg) => { setShowForm(false); refresh(); toast('success', msg); }}
      />
    </div>
  );
}

function ExpenseForm({ open, expense, onClose, onSaved }: { open: boolean; expense: Expense | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const { toast } = useToast();
  const now = new Date();
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date?.slice(0, 10) ?? now.toISOString().slice(0, 10));
  const [description, setDescription] = useState(expense?.description ?? '');
  const [category, setCategory] = useState(expense?.category ?? 'REPAIRS');
  const [amount, setAmount] = useState(expense ? Number(expense.amount) : 0);
  const [paymentMethod, setPaymentMethod] = useState(expense?.payment_method ?? 'M_PESA');
  const [referenceNumber, setReferenceNumber] = useState(expense?.reference_number ?? '');
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (description.trim().length < 2) { toast('error', 'A short description is required.'); return; }
    if (amount <= 0) { toast('error', 'Amount must be greater than zero.'); return; }
    setBusy(true);
    try {
      const body = {
        expenseDate, description: description.trim(), category, amount,
        paymentMethod, referenceNumber: referenceNumber || undefined, notes: notes || undefined,
      };
      if (expense) await api.put(`/api/expenses/${expense.id}`, body);
      else await api.post('/api/expenses', body);
      onSaved(`Expense "${description.trim()}" of ${money(amount)} saved.`);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={expense ? 'Edit Expense' : 'Add Expense'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expense Date"><TextInput type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} /></Field>
          <Field label="Amount (KSh)"><TextInput type="number" min={0} step={0.5} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        </div>
        <Field label="Description"><TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Water pump repair" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
            </Select>
          </Field>
          <Field label="Payment Method">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="CASH">Cash</option><option value="M_PESA">M-Pesa</option>
              <option value="BANK">Bank</option><option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="Reference"><TextInput value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Receipt no. / M-Pesa code…" /></Field>
          <Field label="Notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Expense'}</Button>
        </div>
      </div>
    </Modal>
  );
}
