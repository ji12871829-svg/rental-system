import { useState } from 'react';
import { Button, EmptyState, Field, KpiCard, Modal, PageHeader, Pagination, Select, SkeletonTable, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatDate } from '../lib/format';

interface PenaltyRule {
  id: number;
  name: string;
  rule_type: 'FIXED' | 'PERCENTAGE';
  amount: string;
  percentage: string;
  grace_days: number;
  max_penalty: string | null;
  applies_to: string;
  active: boolean;
}

interface PenaltyPreviewRow {
  tenantId: number;
  tenantName: string;
  unitNumber: string | null;
  month: number;
  year: number;
  monthlyRent: number;
  paid: number;
  penalty: number;
  ruleName: string;
}

interface ApplyResult {
  applied: number;
  skippedAlreadyCharged: number;
  failures: { tenantId: number; error: string }[];
  totalCharged: number;
}

interface PenaltyLogRow {
  id: number;
  month: number;
  year: number;
  amount: string;
  tenant_name: string | null;
  unit_number: string | null;
  rule_name: string | null;
  applied_at: string;
  applied_by_name?: string | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EMPTY_RULE = { name: '', ruleType: 'FIXED', amount: '', percentage: '', graceDays: '1', maxPenalty: '', appliesTo: 'RENT', active: true };

export default function Penalties() {
  const { toast } = useToast();
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<PenaltyRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_RULE });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ rule: PenaltyRule; rows: PenaltyPreviewRow[] } | null>(null);
  const [logPage, setLogPage] = useState(1);

  const { data: rules } = useFetch(() => api.get<{ data: PenaltyRule[] }>('/api/penalties/rules'), [refreshKey]);
  const { data: log, loading: logLoading } = useFetch(
    () => api.list<PenaltyLogRow>(`/api/penalties/log${qs({ page: logPage, limit: 10 })}`),
    [logPage, refreshKey]
  );

  const refresh = () => setRefreshKey((k) => k + 1);
  const nowMonth = new Date().getMonth() + 1;

  function openCreate() {
    setForm({ ...EMPTY_RULE });
    setCreating(true);
  }

  function openEdit(r: PenaltyRule) {
    setForm({
      name: r.name,
      ruleType: r.rule_type,
      amount: r.rule_type === 'FIXED' ? String(r.amount) : '',
      percentage: r.rule_type === 'PERCENTAGE' ? String(r.percentage) : '',
      graceDays: String(r.grace_days),
      maxPenalty: r.max_penalty ?? '',
      appliesTo: r.applies_to,
      active: r.active,
    });
    setEditing(r);
  }

  async function save() {
    if (busy) return;
    if (form.name.trim().length < 2) {
      toast('error', 'Give the rule a name.');
      return;
    }
    if (form.ruleType === 'FIXED' && !(Number(form.amount) > 0)) {
      toast('error', 'A fixed rule needs a positive amount.');
      return;
    }
    if (form.ruleType === 'PERCENTAGE' && !(Number(form.percentage) > 0)) {
      toast('error', 'A percentage rule needs a positive percentage.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        ruleType: form.ruleType,
        amount: form.ruleType === 'FIXED' ? Number(form.amount) : undefined,
        percentage: form.ruleType === 'PERCENTAGE' ? Number(form.percentage) : undefined,
        graceDays: Number(form.graceDays || 0),
        maxPenalty: form.maxPenalty ? Number(form.maxPenalty) : null,
        appliesTo: form.appliesTo,
        active: form.active,
      };
      if (editing) await api.put(`/api/penalties/rules/${editing.id}`, body);
      else await api.post('/api/penalties/rules', body);
      toast('success', editing ? 'Rule updated.' : 'Rule created.');
      setEditing(null);
      setCreating(false);
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: PenaltyRule) {
    if (!window.confirm(`Delete the rule "${r.name}"? Applied penalties in the log are kept.`)) return;
    try {
      await api.del(`/api/penalties/rules/${r.id}`);
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  async function runPreview(r: PenaltyRule) {
    try {
      const res = await api.get<{ data: PenaltyPreviewRow[] }>(`/api/penalties/rules/${r.id}/preview?month=${nowMonth}`);
      setPreview({ rule: r, rows: res.data });
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  async function apply(r: PenaltyRule) {
    try {
      const res = await api.post<{ data: ApplyResult }>(`/api/penalties/rules/${r.id}/apply`, { month: nowMonth });
      const d = res.data;
      toast(
        d.failures.length ? 'error' : 'success',
        `Charged ${d.applied} tenan${d.applied === 1 ? 't' : 'ts'} (${d.totalCharged.toLocaleString()})`
        + (d.skippedAlreadyCharged ? ` · ${d.skippedAlreadyCharged} already charged` : '')
        + (d.failures.length ? ` · ${d.failures.length} failed` : '')
      );
      setPreview(null);
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader title="Late Fees" subtitle="Charge overdue rent automatically — rules, a dry-run preview, and an audit log" />

      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs text-gray-500">Applied fees are recorded as adjustments on the tenant's ledger for the overdue month.</div>
        <Button onClick={openCreate}>New Rule</Button>
      </div>

      {/* Rules */}
      <div className="mb-6 grid gap-3 md:grid-cols-2">
        {(rules?.data ?? []).map((r) => (
          <div key={r.id} className="rounded-xl border border-ash bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-gray-900">{r.name}</div>
                <div className="mt-1 text-xs text-gray-600">
                  {r.rule_type === 'FIXED'
                    ? `Flat fee`
                    : `${r.percentage}% of monthly rent`}
                  {' · '}{r.grace_days}-day grace
                  {r.max_penalty && ` · capped at ${Number(r.max_penalty).toLocaleString()}`}
                </div>
              </div>
              <StatusBadge status={r.active ? 'ACTIVE' : 'INACTIVE'} />
            </div>
            <div className="mt-3 flex gap-1">
              <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => runPreview(r)}>Preview…</Button>
              <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => openEdit(r)}>Edit</Button>
              <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-600" onClick={() => remove(r)}>Delete</Button>
            </div>
          </div>
        ))}
        {(rules?.data ?? []).length === 0 && (
          <div className="md:col-span-2"><EmptyState message="No late-fee rules yet — create one, preview who it would charge, then apply." /></div>
        )}
      </div>

      {/* Log */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver">Penalty log</div>
      {logLoading && <SkeletonTable cols={6} />}
      {!logLoading && log && (
        <>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Applied</th><th>Tenant</th><th>Unit</th><th>Rule</th><th>Period</th><th>Amount</th></tr></thead>
              <tbody>
                {log.data.map((l) => (
                  <tr key={l.id}>
                    <td className="text-xs text-gray-500">{formatDate(l.applied_at)}</td>
                    <td className="text-xs font-medium">{l.tenant_name ?? '—'}</td>
                    <td className="text-xs">{l.unit_number ? `Unit ${l.unit_number}` : '—'}</td>
                    <td className="text-xs">{l.rule_name ?? '—'}</td>
                    <td className="text-xs">{MONTHS[l.month - 1]?.slice(0, 3)} {l.year}</td>
                    <td className="text-xs tabular-nums">{Number(l.amount).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {log.data.length === 0 && <div className="p-6"><EmptyState message="No penalties applied yet." /></div>}
          </div>
          <Pagination page={log.pagination.page} totalPages={log.pagination.totalPages} onChange={setLogPage} />
        </>
      )}

      {/* Rule editor */}
      <Modal open={creating || editing !== null} title={editing ? 'Edit rule' : 'New late-fee rule'} onClose={() => { setCreating(false); setEditing(null); }}>
        <div className="space-y-3">
          <Field label="Rule name">
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 5% after 5 days" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select value={form.ruleType} onChange={(e) => setForm({ ...form, ruleType: e.target.value })}>
                <option value="FIXED">Flat fee</option>
                <option value="PERCENTAGE">Percentage of rent</option>
              </Select>
            </Field>
            {form.ruleType === 'FIXED' ? (
              <Field label="Fee amount">
                <TextInput type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="500" />
              </Field>
            ) : (
              <Field label="Percentage">
                <TextInput type="number" min="0" max="100" step="0.5" value={form.percentage} onChange={(e) => setForm({ ...form, percentage: e.target.value })} placeholder="5" />
              </Field>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Grace days" hint="Days past the 1st before the fee applies.">
              <TextInput type="number" min="0" max="365" value={form.graceDays} onChange={(e) => setForm({ ...form, graceDays: e.target.value })} />
            </Field>
            <Field label="Cap (optional)">
              <TextInput type="number" min="0" step="0.01" value={form.maxPenalty} onChange={(e) => setForm({ ...form, maxPenalty: e.target.value })} placeholder="No cap" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
            <Button loading={busy} onClick={save}>{editing ? 'Save changes' : 'Create rule'}</Button>
          </div>
        </div>
      </Modal>

      {/* Preview + confirm */}
      <Modal open={preview !== null} title={`Preview: ${preview?.rule.name ?? ''}`} onClose={() => setPreview(null)}>
        {preview && (
          <div className="space-y-3 text-sm">
            <div className="text-xs text-gray-500">
              Charging for {MONTHS[nowMonth - 1]} where rent is still unpaid after the grace window. Each tenant is charged once per month — re-running never double-charges.
            </div>
            {preview.rows.length === 0 ? (
              <EmptyState message="Nobody matches this rule right now — everyone within the grace window is clear." />
            ) : (
              <div className="max-h-[320px] overflow-y-auto rounded-lg border border-ash">
                <table>
                  <thead><tr><th>Tenant</th><th>Unit</th><th>Paid</th><th>Fee</th></tr></thead>
                  <tbody>
                    {preview.rows.map((p) => (
                      <tr key={p.tenantId}>
                        <td className="text-xs font-medium">{p.tenantName}</td>
                        <td className="text-xs">{p.unitNumber ? `Unit ${p.unitNumber}` : '—'}</td>
                        <td className="text-xs tabular-nums">{p.paid.toLocaleString()} / {p.monthlyRent.toLocaleString()}</td>
                        <td className="text-xs tabular-nums font-semibold text-red-600">{p.penalty.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between">
              <KpiCard
                label="Total to charge"
                value={preview.rows.reduce((s, r) => s + r.penalty, 0).toLocaleString()}
                tone={preview.rows.length ? 'warn' : 'default'}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
              <Button variant="danger" disabled={preview.rows.length === 0} onClick={() => apply(preview.rule)}>
                Apply to {preview.rows.length} tenant{preview.rows.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
