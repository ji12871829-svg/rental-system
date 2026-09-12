import { useState } from 'react';
import { Button, EmptyState, Modal, PageHeader, Pagination, Select, SkeletonTable, TextInput, useFetch } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatDate } from '../lib/format';

// Register of data-subject requests (Kenya DPA 2019 / GDPR arts. 15–17):
// every personal-data export or erasure, who requested it and why. Entries
// are written by the export/erase endpoints themselves — this page is the
// read-only compliance view.

interface RegisterRow {
  id: number;
  tenant_id: number | null;
  request_type: 'EXPORT_JSON' | 'EXPORT_CSV' | 'ERASURE';
  requester: string;
  reason: string;
  outcome: 'COMPLETED' | 'FAILED' | 'REFUSED';
  outcome_note: string | null;
  created_at: string;
  tenant_name: string | null;
  performed_by_name: string | null;
}

const TYPE_LABELS: Record<RegisterRow['request_type'], string> = {
  EXPORT_JSON: 'Export (JSON)',
  EXPORT_CSV: 'Export (CSV)',
  ERASURE: 'Erasure',
};

const TYPE_STYLES: Record<RegisterRow['request_type'], string> = {
  EXPORT_JSON: 'bg-brand-100 text-brand-800',
  EXPORT_CSV: 'bg-sky-100 text-sky-800',
  ERASURE: 'bg-purple-100 text-purple-800',
};

const OUTCOME_STYLES: Record<RegisterRow['outcome'], string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  REFUSED: 'bg-amber-100 text-amber-800',
};

export default function PrivacyRegister() {
  const [type, setType] = useState('');
  const [outcome, setOutcome] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<RegisterRow | null>(null);

  const { data, loading, error } = useFetch(
    () => api.list<RegisterRow>(`/api/privacy-requests${qs({ page, limit: 20, type: type || undefined, outcome: outcome || undefined, q: q || undefined })}`),
    [page, type, outcome, q]
  );

  return (
    <div>
      <PageHeader
        title="Privacy Register"
        subtitle="Every data-subject request (export or erasure) with who requested it and why — Kenya DPA 2019 / GDPR accountability record."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <TextInput placeholder="Search requester, reason or tenant…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-xs" />
        <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="w-44" aria-label="Filter by request type">
          <option value="">All types</option>
          <option value="EXPORT_JSON">Export (JSON)</option>
          <option value="EXPORT_CSV">Export (CSV)</option>
          <option value="ERASURE">Erasure</option>
        </Select>
        <Select value={outcome} onChange={(e) => { setOutcome(e.target.value); setPage(1); }} className="w-40" aria-label="Filter by outcome">
          <option value="">All outcomes</option>
          <option value="COMPLETED">Completed</option>
          <option value="REFUSED">Refused</option>
          <option value="FAILED">Failed</option>
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
                  <th>Date</th><th>Type</th><th>Tenant</th><th>Requested by</th><th>Reason</th><th>Performed by</th><th>Outcome</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-xs text-gray-500">{formatDate(r.created_at)}</td>
                    <td>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_STYLES[r.request_type] ?? 'bg-gray-100 text-gray-700'}`}>
                        {TYPE_LABELS[r.request_type] ?? r.request_type}
                      </span>
                    </td>
                    <td className="font-medium">{r.tenant_name ?? (r.tenant_id ? `#${r.tenant_id}` : '—')}</td>
                    <td>{r.requester}</td>
                    <td className="max-w-[16rem] truncate text-xs text-gray-600" title={r.reason}>{r.reason}</td>
                    <td className="text-xs text-gray-600">{r.performed_by_name ?? '—'}</td>
                    <td>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${OUTCOME_STYLES[r.outcome] ?? 'bg-gray-100 text-gray-700'}`}>
                        {r.outcome}
                      </span>
                    </td>
                    <td>
                      <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setDetail(r)}>Details</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && (
              <div className="p-6">
                <EmptyState message="No privacy requests recorded yet. Exports and erasures performed on the Tenants page appear here automatically." />
              </div>
            )}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      <Modal open={detail !== null} title={detail ? `Request #${detail.id} — ${TYPE_LABELS[detail.request_type]}` : ''} onClose={() => setDetail(null)}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs uppercase tracking-wide text-gray-500">Tenant</div><div className="font-medium">{detail.tenant_name ?? (detail.tenant_id ? `#${detail.tenant_id}` : '—')}</div></div>
              <div><div className="text-xs uppercase tracking-wide text-gray-500">Date</div><div className="font-medium">{formatDate(detail.created_at)}</div></div>
              <div><div className="text-xs uppercase tracking-wide text-gray-500">Requested by</div><div className="font-medium">{detail.requester}</div></div>
              <div><div className="text-xs uppercase tracking-wide text-gray-500">Performed by</div><div className="font-medium">{detail.performed_by_name ?? '—'}</div></div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Reason</div>
              <p className="mt-1 rounded-lg bg-gray-50 p-3 text-gray-700">{detail.reason}</p>
            </div>
            {detail.outcome_note && (
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">Outcome note</div>
                <p className="mt-1 rounded-lg bg-gray-50 p-3 text-gray-700">{detail.outcome_note}</p>
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
