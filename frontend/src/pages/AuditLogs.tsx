import { useState } from 'react';
import { Button, EmptyState, Modal, PageHeader, Pagination, Select, TextInput, useFetch } from '../components/ui';
import { api, qs } from '../lib/api';

interface AuditRow {
  id: number;
  user_id: number | null;
  action: string;
  entity: string;
  entity_id: number | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default function AuditLogs() {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  // Entity + action dropdowns derive their options from what's actually in the log.
  const { data, loading, error } = useFetch(
    () => api.list<AuditRow>(`/api/audit${qs({ page, limit: 20, entity: entity || undefined, action: action || undefined })}`),
    [page, entity, action]
  );
  const { data: allForOptions } = useFetch(
    () => api.list<AuditRow>('/api/audit?limit=100'),
    [page, entity, action]
  );

  const entities = Array.from(new Set((allForOptions?.data ?? []).map((r) => r.entity))).sort();
  const actions = Array.from(new Set((allForOptions?.data ?? []).map((r) => r.action))).sort();

  const filtered = q
    ? (data?.data ?? []).filter((r) =>
        r.action.toLowerCase().includes(q.toLowerCase()) ||
        r.entity.toLowerCase().includes(q.toLowerCase()) ||
        (r.user_name ?? '').toLowerCase().includes(q.toLowerCase()))
    : data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        subtitle="Every important change is recorded — who did what, to which record, and when"
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <TextInput placeholder="Search action, entity or user…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={entity} onChange={(e) => setEntity(e.target.value)} className="w-44">
          <option value="">All entities</option>
          {entities.map((e) => <option key={e} value={e}>{e}</option>)}
        </Select>
        <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-56">
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Record</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-xs text-gray-500">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="font-medium">{r.user_name ?? <span className="text-gray-400">system</span>}</td>
                    <td>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        r.action.endsWith('_DELETED') ? 'bg-red-100 text-red-800'
                        : r.action.endsWith('_CREATED') ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                      }`}>
                        {r.action}
                      </span>
                    </td>
                    <td className="text-xs">{r.entity}{r.entity_id !== null ? ` #${r.entity_id}` : ''}</td>
                    <td className="text-xs text-gray-500">{r.user_email ?? ''}</td>
                    <td>
                      <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setDetail(r)}>Details</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="p-6"><EmptyState message="No audit entries match this filter." /></div>}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      <Modal open={detail !== null} title={detail ? `${detail.action}` : ''} onClose={() => setDetail(null)} wide>
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-400">When</div>
                <div className="font-medium text-gray-800">{new Date(detail.created_at).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-400">User</div>
                <div className="font-medium text-gray-800">{detail.user_name ?? 'system'}{detail.user_email ? ` (${detail.user_email})` : ''}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-400">Entity</div>
                <div className="font-medium text-gray-800">{detail.entity}{detail.entity_id !== null ? ` #${detail.entity_id}` : ''}</div>
              </div>
            </div>
            <JsonBlock label="Old value" value={detail.old_value} />
            <JsonBlock label="New value" value={detail.new_value} />
          </div>
        )}
      </Modal>
    </div>
  );
}
