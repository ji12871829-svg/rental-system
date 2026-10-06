import { useState } from 'react';
import { Button, EmptyState, Field, Modal, PageHeader, Pagination, Select, SkeletonTable, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatDate } from '../lib/format';

interface WorkOrder {
  id: number;
  vendor_id: number | null;
  vendor_name: string | null;
  assigned_to: string | null;
  cost: string;
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  scheduled_for: string | null;
  completed_at: string | null;
  notes: string | null;
}

interface MaintenanceRequest {
  id: number;
  unit_id: number | null;
  tenant_id: number | null;
  title: string;
  description: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED';
  reported_at: string;
  resolved_at: string | null;
  unit_number: string | null;
  property_name: string | null;
  tenant_name: string | null;
  work_order_count: number;
  open_work_order_count: number;
  work_orders?: WorkOrder[];
}

interface UnitOption { id: number; unit_number: string; property_name: string }
interface VendorOption { id: number; name: string; active: boolean }

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'];

export default function Maintenance() {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [viewId, setViewId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Create form
  const [form, setForm] = useState({ title: '', description: '', unitId: '', priority: 'MEDIUM' });

  // Work order form (inside the detail modal)
  const [woForm, setWoForm] = useState({ vendorId: '', assignedTo: '', cost: '', scheduledFor: '', notes: '' });

  const { data, loading, error } = useFetch(
    () => api.list<MaintenanceRequest>(`/api/maintenance${qs({ page, limit: 20, q: q || undefined, status: statusFilter || undefined, priority: priorityFilter || undefined })}`),
    [page, q, statusFilter, priorityFilter, refreshKey]
  );

  const { data: unitsResponse } = useFetch(() => api.list<UnitOption>('/api/units?limit=100'), [refreshKey]);
  const { data: detail, loading: detailLoading } = useFetch(
    () => (viewId ? api.get<{ data: MaintenanceRequest }>(`/api/maintenance/${viewId}`) : Promise.resolve(null)),
    [viewId, refreshKey]
  );
  const { data: vendorsResponse } = useFetch(() => api.list<VendorOption>('/api/vendors?active=true&limit=100'), []);

  const refresh = () => setRefreshKey((k) => k + 1);
  const detailRequest = detail?.data ?? null;
  const liveModeVendors = vendorsResponse?.data ?? [];

  async function createRequest() {
    if (busy) return;
    if (form.title.trim().length < 3) {
      toast('error', 'Describe the problem in the title (at least 3 characters).');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/maintenance', {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        unitId: form.unitId ? Number(form.unitId) : undefined,
        priority: form.priority,
      });
      toast('success', 'Maintenance request logged.');
      setCreating(false);
      setForm({ title: '', description: '', unitId: '', priority: 'MEDIUM' });
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setRequestStatus(r: MaintenanceRequest, status: string) {
    try {
      await api.put(`/api/maintenance/${r.id}`, { status });
      toast('success', status === 'RESOLVED' ? 'Marked resolved.' : `Status set to ${status.replace(/_/g, ' ').toLowerCase()}.`);
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  async function deleteRequest(r: MaintenanceRequest) {
    if (!window.confirm(`Delete the request "${r.title}" and its work orders? This cannot be undone.`)) return;
    try {
      await api.del(`/api/maintenance/${r.id}`);
      toast('success', 'Request deleted.');
      setViewId(null);
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  async function addWorkOrder() {
    if (!detailRequest || busy) return;
    if (!woForm.vendorId && !woForm.assignedTo.trim()) {
      toast('error', 'Pick a vendor or type who is handling it.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/maintenance/${detailRequest.id}/work-orders`, {
        vendorId: woForm.vendorId ? Number(woForm.vendorId) : undefined,
        assignedTo: woForm.assignedTo.trim() || undefined,
        cost: woForm.cost ? Number(woForm.cost) : undefined,
        scheduledFor: woForm.scheduledFor || undefined,
        notes: woForm.notes.trim() || undefined,
      });
      toast('success', 'Work order created — the request is now in progress.');
      setWoForm({ vendorId: '', assignedTo: '', cost: '', scheduledFor: '', notes: '' });
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setWorkOrderStatus(wo: WorkOrder, status: string) {
    try {
      await api.put(`/api/maintenance/work-orders/${wo.id}`, { status });
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader title="Maintenance" subtitle="Repair requests from tenants and staff, tracked through to the fix" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TextInput placeholder="Search title, unit or tenant…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
        <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="w-40">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Select>
        <div className="ml-auto">
          <Button onClick={() => setCreating(true)}>Log Request</Button>
        </div>
      </div>

      {loading && <SkeletonTable cols={6} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Reported</th><th>Unit</th><th>Title</th><th>Priority</th><th>Status</th><th>Work orders</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {data.data.map((r) => (
                  <tr key={r.id}>
                    <td className="text-xs text-gray-500">{formatDate(r.reported_at)}</td>
                    <td className="text-xs">{r.unit_number ? `Unit ${r.unit_number}` : <span className="text-gray-400">—</span>}</td>
                    <td className="max-w-[280px]">
                      <button className="truncate text-left text-xs text-gray-700 hover:text-brand-600" title="View request" onClick={() => setViewId(r.id)}>
                        {r.title.length > 60 ? `${r.title.slice(0, 60)}…` : r.title}
                      </button>
                      {r.tenant_name && <div className="text-[10px] text-gray-400">{r.tenant_name}</div>}
                    </td>
                    <td><StatusBadge status={r.priority} /></td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="text-xs tabular-nums" title={r.open_work_order_count > 0 ? `${r.open_work_order_count} open` : 'none open'}>
                      {r.work_order_count}
                      {r.open_work_order_count > 0 && <div className="text-[10px] text-amber-600">{r.open_work_order_count} open</div>}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setViewId(r.id)}>View</Button>
                        {(r.status === 'OPEN' || r.status === 'IN_PROGRESS') && (
                          <Button variant="ghost" className="!px-2 !py-1 text-xs text-emerald-700" onClick={() => setRequestStatus(r, 'RESOLVED')}>Resolve</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && <div className="p-6"><EmptyState message="No maintenance requests — log the first leak, fault or complaint." /></div>}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      {/* Create request */}
      <Modal open={creating} title="Log maintenance request" onClose={() => setCreating(false)}>
        <div className="space-y-3">
          <Field label="What is the problem?">
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Kitchen tap leaking" />
          </Field>
          <Field label="Unit (optional)">
            <Select value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
              <option value="">Not tied to a unit</option>
              {(unitsResponse?.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.property_name} — Unit {u.unit_number}</option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Field label="Details (optional)">
            <TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Anything the fixer should know…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button loading={busy} onClick={createRequest}>Log request</Button>
          </div>
        </div>
      </Modal>

      {/* Detail + work orders */}
      <Modal open={viewId !== null} title={detailRequest?.title ?? 'Request'} onClose={() => setViewId(null)} wide>
        {detailLoading && <div className="py-6 text-sm text-gray-500">Loading…</div>}
        {detailRequest && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-3 text-xs text-gray-500">
              <span>Reported: {formatDate(detailRequest.reported_at)}</span>
              {detailRequest.unit_number && <span>Unit: {detailRequest.unit_number} ({detailRequest.property_name})</span>}
              {detailRequest.tenant_name && <span>Tenant: {detailRequest.tenant_name}</span>}
              <span>Priority: {detailRequest.priority}</span>
              <span>Status: {detailRequest.status.replace(/_/g, ' ').toLowerCase()}</span>
            </div>
            {detailRequest.description && (
              <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{detailRequest.description}</div>
            )}

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver">Work orders</div>
              {(detailRequest.work_orders ?? []).length === 0 && (
                <div className="rounded-lg border border-dashed border-ash p-3 text-xs text-gray-500">
                  Nothing assigned yet — add a work order below to get this fixed.
                </div>
              )}
              <div className="space-y-2">
                {(detailRequest.work_orders ?? []).map((wo) => (
                  <div key={wo.id} className="rounded-lg border border-ash p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs">
                        <span className="font-medium">{wo.vendor_name ?? wo.assigned_to ?? 'Unassigned'}</span>
                        {wo.vendor_name && wo.assigned_to && <span className="text-gray-400"> · {wo.assigned_to}</span>}
                        {wo.scheduled_for && <span className="text-gray-400"> · scheduled {formatDate(wo.scheduled_for)}</span>}
                        {Number(wo.cost) > 0 && <span className="text-gray-500"> · cost {Number(wo.cost).toLocaleString()}</span>}
                        {wo.completed_at && <span className="text-emerald-600"> · done {formatDate(wo.completed_at)}</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <StatusBadge status={wo.status} />
                        {wo.status !== 'DONE' && wo.status !== 'CANCELLED' && (
                          <Button variant="ghost" className="!px-2 !py-1 text-xs text-emerald-700" onClick={() => setWorkOrderStatus(wo, 'DONE')}>Mark done</Button>
                        )}
                        {wo.status === 'ASSIGNED' && (
                          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setWorkOrderStatus(wo, 'IN_PROGRESS')}>Start</Button>
                        )}
                      </div>
                    </div>
                    {wo.notes && <div className="mt-1 text-[11px] text-gray-500">{wo.notes}</div>}
                  </div>
                ))}
              </div>
            </div>

            {detailRequest.status !== 'RESOLVED' && detailRequest.status !== 'CANCELLED' && (
              <div className="rounded-lg border border-ash bg-gray-50/50 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver">Add work order</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Vendor">
                    <Select value={woForm.vendorId} onChange={(e) => setWoForm({ ...woForm, vendorId: e.target.value })}>
                      <option value="">No vendor (in-house)</option>
                      {liveModeVendors.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Or assign to (name)">
                    <TextInput value={woForm.assignedTo} onChange={(e) => setWoForm({ ...woForm, assignedTo: e.target.value })} placeholder="e.g. caretaker John" />
                  </Field>
                  <Field label="Cost (optional)">
                    <TextInput type="number" min="0" step="0.01" value={woForm.cost} onChange={(e) => setWoForm({ ...woForm, cost: e.target.value })} placeholder="0.00" />
                  </Field>
                  <Field label="Scheduled for (optional)">
                    <TextInput type="date" value={woForm.scheduledFor} onChange={(e) => setWoForm({ ...woForm, scheduledFor: e.target.value })} />
                  </Field>
                </div>
                <Field label="Notes (optional)">
                  <TextInput value={woForm.notes} onChange={(e) => setWoForm({ ...woForm, notes: e.target.value })} placeholder="Access arrangements, parts needed…" />
                </Field>
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setRequestStatus(detailRequest, 'RESOLVED')}>Resolve request</Button>
                  <Button loading={busy} onClick={addWorkOrder}>Create work order</Button>
                </div>
              </div>
            )}

            <div className="flex justify-between">
              {detailRequest.status !== 'CANCELLED' && detailRequest.status !== 'RESOLVED' ? (
                <Button variant="ghost" className="text-red-600" onClick={() => deleteRequest(detailRequest)}>Delete request</Button>
              ) : <span />}
              <Button variant="ghost" onClick={() => setViewId(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
