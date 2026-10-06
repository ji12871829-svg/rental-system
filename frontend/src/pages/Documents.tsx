import { useRef, useState } from 'react';
import { Button, EmptyState, Field, Modal, PageHeader, Pagination, Select, SkeletonTable, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatDate } from '../lib/format';

interface DocumentRow {
  id: number;
  title: string;
  doc_type: string;
  tenant_id: number | null;
  unit_id: number | null;
  file_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  tenant_name: string | null;
  unit_number: string | null;
}

interface TenantOption { id: number; full_name: string }
interface UnitOption { id: number; unit_number: string; property_name: string }

const DOC_TYPES = ['LEASE_AGREEMENT', 'INVOICE', 'RECEIPT', 'ID_DOCUMENT', 'INSPECTION_REPORT', 'PHOTO', 'INSURANCE', 'OTHER'];
const MAX_BYTES = 15 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1)); // strip the data: prefix
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

export default function Documents() {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', docType: 'LEASE_AGREEMENT', tenantId: '', unitId: '' });
  const [file, setFile] = useState<{ name: string; size: number; mime: string; base64: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data, loading, error } = useFetch(
    () => api.list<DocumentRow>(`/api/documents${qs({ page, limit: 20, q: q || undefined, docType: typeFilter || undefined })}`),
    [page, q, typeFilter, refreshKey]
  );
  const { data: tenantsResponse } = useFetch(() => api.list<TenantOption>('/api/tenants?limit=200'), []);
  const { data: unitsResponse } = useFetch(() => api.list<UnitOption>('/api/units?limit=200'), []);

  const refresh = () => setRefreshKey((k) => k + 1);

  async function pickFile(f: File | null) {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast('error', 'Files are capped at 15 MB.');
      return;
    }
    const base64 = await fileToBase64(f);
    setFile({ name: f.name, size: f.size, mime: f.type || 'application/octet-stream', base64 });
  }

  async function upload() {
    if (busy) return;
    if (!form.title.trim() || !file) {
      toast('error', 'Give the document a title and pick a file.');
      return;
    }
    if (!form.tenantId && !form.unitId) {
      toast('error', 'Link the document to a tenant or a unit.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/documents', {
        title: form.title.trim(),
        docType: form.docType,
        tenantId: form.tenantId ? Number(form.tenantId) : undefined,
        unitId: form.unitId ? Number(form.unitId) : undefined,
        fileName: file.name,
        mimeType: file.mime,
        contentBase64: file.base64,
      });
      toast('success', 'Document filed.');
      setUploading(false);
      setForm({ title: '', docType: 'LEASE_AGREEMENT', tenantId: '', unitId: '' });
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: DocumentRow) {
    if (!window.confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
    try {
      await api.del(`/api/documents/${d.id}`);
      toast('success', 'Document deleted.');
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader title="Document Vault" subtitle="Leases, IDs, receipts and reports — filed against tenants and units" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TextInput placeholder="Search title or file name…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-48">
          <option value="">All types</option>
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </Select>
        <div className="ml-auto">
          <Button onClick={() => setUploading(true)}>Upload Document</Button>
        </div>
      </div>

      {loading && <SkeletonTable cols={6} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Filed</th><th>Title</th><th>Type</th><th>Tenant</th><th>Unit</th><th>Size</th><th>Actions</th></tr></thead>
              <tbody>
                {data.data.map((d) => (
                  <tr key={d.id}>
                    <td className="text-xs text-gray-500">{formatDate(d.created_at)}</td>
                    <td className="max-w-[240px]">
                      <div className="truncate text-xs font-medium text-gray-800" title={d.file_name}>{d.title}</div>
                    </td>
                    <td className="text-xs">{d.doc_type.replace(/_/g, ' ')}</td>
                    <td className="text-xs">{d.tenant_name ?? '—'}</td>
                    <td className="text-xs">{d.unit_number ? `Unit ${d.unit_number}` : '—'}</td>
                    <td className="text-xs tabular-nums">{(d.file_size / 1024).toFixed(0)} KB</td>
                    <td>
                      <div className="flex gap-1">
                        <a href={`/api/documents/${d.id}/download`} className="inline-flex items-center rounded-xl px-2 py-1 text-xs text-brand-600 hover:bg-brand-50">
                          Download
                        </a>
                        <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-600" onClick={() => remove(d)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && <div className="p-6"><EmptyState message="Vault is empty — upload the signed lease, ID copy or inspection photos." /></div>}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      <Modal open={uploading} title="Upload document" onClose={() => setUploading(false)}>
        <div className="space-y-3">
          <Field label="Title">
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Signed lease — Unit 4, 2026" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </Select>
            </Field>
            <Field label="File" hint="Up to 15 MB, any common format.">
              <input
                ref={fileInput}
                type="file"
                onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-ash bg-white px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tenant (or pick a unit)">
              <Select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value, unitId: '' })}>
                <option value="">—</option>
                {(tenantsResponse?.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.full_name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Unit (or pick a tenant)">
              <Select value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value, tenantId: '' })}>
                <option value="">—</option>
                {(unitsResponse?.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>{u.property_name} — Unit {u.unit_number}</option>
                ))}
              </Select>
            </Field>
          </div>
          {file && (
            <div className="text-xs text-gray-500">
              {file.name} · {(file.size / 1024).toFixed(0)} KB · ready to upload
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setUploading(false)}>Cancel</Button>
            <Button loading={busy} onClick={upload}>Upload</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
