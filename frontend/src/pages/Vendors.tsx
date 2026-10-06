import { useState } from 'react';
import { Button, EmptyState, Field, Modal, PageHeader, Pagination, Select, SkeletonTable, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';

interface Vendor {
  id: number;
  name: string;
  service: string;
  phone: string | null;
  email: string | null;
  rating: number | null;
  notes: string | null;
  active: boolean;
}

const SERVICES = ['PLUMBING', 'ELECTRICAL', 'CLEANING', 'SECURITY', 'CARPENTRY', 'PAINTING', 'LANDSCAPING', 'PEST_CONTROL', 'GENERAL_REPAIRS', 'OTHER'];

const EMPTY_FORM = { name: '', service: 'PLUMBING', phone: '', email: '', rating: '', notes: '', active: true };

export default function Vendors() {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);

  const { data, loading, error } = useFetch(
    () => api.list<Vendor>(`/api/vendors${qs({ page, limit: 20, q: q || undefined, service: serviceFilter || undefined })}`),
    [page, q, serviceFilter, refreshKey]
  );

  const refresh = () => setRefreshKey((k) => k + 1);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setCreating(true);
  }

  function openEdit(v: Vendor) {
    setForm({
      name: v.name,
      service: v.service,
      phone: v.phone ?? '',
      email: v.email ?? '',
      rating: v.rating ? String(v.rating) : '',
      notes: v.notes ?? '',
      active: v.active,
    });
    setEditing(v);
  }

  async function save() {
    if (busy) return;
    if (form.name.trim().length < 2) {
      toast('error', 'Give the vendor a name (at least 2 characters).');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        service: form.service,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        rating: form.rating ? Number(form.rating) : undefined,
        notes: form.notes.trim() || undefined,
        active: form.active,
      };
      if (editing) await api.put(`/api/vendors/${editing.id}`, body);
      else await api.post('/api/vendors', body);
      toast('success', editing ? 'Vendor updated.' : 'Vendor added.');
      setEditing(null);
      setCreating(false);
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(v: Vendor) {
    if (!window.confirm(`Delete vendor "${v.name}"? Their past work orders keep their records.`)) return;
    try {
      await api.del(`/api/vendors/${v.id}`);
      toast('success', 'Vendor deleted.');
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  async function toggleActive(v: Vendor) {
    try {
      await api.put(`/api/vendors/${v.id}`, { active: !v.active });
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  const modalOpen = creating || editing !== null;

  return (
    <div>
      <PageHeader title="Vendors" subtitle="Traders and service companies your work orders go to" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TextInput placeholder="Search name, phone or email…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} className="w-48">
          <option value="">All trades</option>
          {SERVICES.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </Select>
        <div className="ml-auto">
          <Button onClick={openCreate}>Add Vendor</Button>
        </div>
      </div>

      {loading && <SkeletonTable cols={6} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Name</th><th>Trade</th><th>Phone</th><th>Email</th><th>Rating</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {data.data.map((v) => (
                  <tr key={v.id}>
                    <td className="font-medium">{v.name}</td>
                    <td className="text-xs">{v.service.replace(/_/g, ' ')}</td>
                    <td className="text-xs">{v.phone ?? '—'}</td>
                    <td className="text-xs">{v.email ?? '—'}</td>
                    <td className="text-xs" title={v.rating ? `${v.rating}/5` : 'Not rated yet'}>
                      {v.rating ? '★'.repeat(v.rating) : '—'}
                    </td>
                    <td>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${v.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {v.active ? 'Active' : 'Retired'}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => openEdit(v)}>Edit</Button>
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => toggleActive(v)}>{v.active ? 'Retire' : 'Reactivate'}</Button>
                        <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-600" onClick={() => remove(v)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && <div className="p-6"><EmptyState message="No vendors yet — add the plumbers, electricians and cleaners your buildings depend on." /></div>}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      <Modal open={modalOpen} title={editing ? 'Edit vendor' : 'Add vendor'} onClose={() => { setEditing(null); setCreating(false); }}>
        <div className="space-y-3">
          <Field label="Name">
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Jua Plumbing Ltd" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Trade">
              <Select value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })}>
                {SERVICES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </Select>
            </Field>
            <Field label="Rating (1–5)" hint="Your own quality score — shown on the list.">
              <Select value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>
                <option value="">Not rated</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{'★'.repeat(n)}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone">
              <TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+254…" />
            </Field>
            <Field label="Email">
              <TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
            </Field>
          </div>
          <Field label="Notes">
            <TextInput value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Rates, specialities, payment terms…" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active (offered when assigning work orders)
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setEditing(null); setCreating(false); }}>Cancel</Button>
            <Button loading={busy} onClick={save}>{editing ? 'Save changes' : 'Add vendor'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
