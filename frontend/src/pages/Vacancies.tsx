import { useRef, useState } from 'react';
import { Button, EmptyState, Field, Modal, PageHeader, Pagination, Select, SkeletonTable, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';

interface VacancyListing {
  id: number;
  unit_id: number;
  title: string;
  description: string | null;
  rent_amount: string;
  deposit: string | null;
  photos: string[];
  amenities: string[];
  is_published: boolean;
  published_at: string | null;
  views: number;
  inquiries: number;
  unit_number: string;
  unit_type: string;
  property_name: string;
}

interface UnitOption { id: number; unit_number: string; property_name: string; monthly_rent: string; unit_type: string }

const AMENITY_CHOICES = ['Water included', 'Private bathroom', 'Balcony', 'Parking', 'Borehole', 'CCTV', 'Prepaid meter', 'Backup tank'];

export default function Vacancies() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ unitId: '', title: '', description: '', rentAmount: '', deposit: '', amenities: [] as string[] });
  const [photoTarget, setPhotoTarget] = useState<VacancyListing | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const { data, loading, error } = useFetch(
    () => api.list<VacancyListing>(`/api/vacancies${qs({ page, limit: 20 })}`),
    [page, refreshKey]
  );
  const { data: unitsResponse } = useFetch(() => api.list<UnitOption>('/api/units?limit=200'), []);

  const refresh = () => setRefreshKey((k) => k + 1);

  async function create() {
    if (busy) return;
    if (!form.unitId || form.title.trim().length < 3 || !(Number(form.rentAmount) > 0)) {
      toast('error', 'Pick a unit, write a title, and set the rent.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/vacancies', {
        unitId: Number(form.unitId),
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        rentAmount: Number(form.rentAmount),
        deposit: form.deposit ? Number(form.deposit) : undefined,
        amenities: form.amenities,
        isPublished: true,
      });
      toast('success', 'Listing created and published to the public board.');
      setCreating(false);
      setForm({ unitId: '', title: '', description: '', rentAmount: '', deposit: '', amenities: [] });
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish(l: VacancyListing) {
    try {
      await api.put(`/api/vacancies/${l.id}`, { isPublished: !l.is_published });
      toast('success', l.is_published ? 'Listing unpublished.' : 'Listing published.');
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  async function remove(l: VacancyListing) {
    if (!window.confirm(`Delete the listing "${l.title}"?`)) return;
    try {
      await api.del(`/api/vacancies/${l.id}`);
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  async function addPhoto(l: VacancyListing, f: File | null) {
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) {
      toast('error', 'Photos are capped at 8 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result);
        const photos = [...l.photos, dataUrl].slice(0, 10);
        await api.put(`/api/vacancies/${l.id}`, { photoUris: photos });
        toast('success', 'Photo added.');
        setPhotoTarget(null);
        refresh();
      } catch (err) {
        toast('error', (err as Error).message);
      }
    };
    reader.readAsDataURL(f);
  }

  return (
    <div>
      <PageHeader title="Vacancy Listings" subtitle="Publish vacant units to the public board — inquiries land in your audit trail" />

      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs text-gray-500">The public board shows published listings at <code>/public-vacancies</code>.</div>
        <Button onClick={() => setCreating(true)}>New Listing</Button>
      </div>

      {loading && <SkeletonTable cols={7} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Unit</th><th>Title</th><th>Rent</th><th>Status</th><th>Views</th><th>Inquiries</th><th>Actions</th></tr></thead>
              <tbody>
                {data.data.map((l) => (
                  <tr key={l.id}>
                    <td className="text-xs">{l.property_name} — Unit {l.unit_number}</td>
                    <td className="max-w-[220px]"><div className="truncate text-xs font-medium">{l.title}</div></td>
                    <td className="text-xs tabular-nums">{Number(l.rent_amount).toLocaleString()}</td>
                    <td><StatusBadge status={l.is_published ? 'PUBLISHED' : 'DRAFT'} /></td>
                    <td className="text-xs tabular-nums">{l.views}</td>
                    <td className="text-xs tabular-nums">{l.inquiries}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setPhotoTarget(l)}>Photos ({l.photos.length})</Button>
                        <Button variant="ghost" className="!px-2 !py-1 text-xs text-emerald-700" onClick={() => togglePublish(l)}>
                          {l.is_published ? 'Unpublish' : 'Publish'}
                        </Button>
                        <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-600" onClick={() => remove(l)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && <div className="p-6"><EmptyState message="No listings yet — advertise your first vacant unit." /></div>}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      {/* Create */}
      <Modal open={creating} title="New vacancy listing" onClose={() => setCreating(false)}>
        <div className="space-y-3">
          <Field label="Unit">
            <Select value={form.unitId} onChange={(e) => {
              const u = (unitsResponse?.data ?? []).find((x) => String(x.id) === e.target.value);
              setForm({ ...form, unitId: e.target.value, rentAmount: u ? String(Number(u.monthly_rent)) : form.rentAmount, title: form.title || (u ? `${u.unit_type} — ${u.property_name}` : form.title) });
            }}>
              <option value="">Choose a unit…</option>
              {(unitsResponse?.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.property_name} — Unit {u.unit_number} ({u.unit_type})</option>
              ))}
            </Select>
          </Field>
          <Field label="Listing title">
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Bright bedsitter near the main road" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rent (per month)">
              <TextInput type="number" min="0" step="0.01" value={form.rentAmount} onChange={(e) => setForm({ ...form, rentAmount: e.target.value })} />
            </Field>
            <Field label="Deposit (optional)">
              <TextInput type="number" min="0" step="0.01" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} />
            </Field>
          </div>
          <Field label="Description">
            <TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What makes this unit worth viewing…" />
          </Field>
          <Field label="Amenities">
            <div className="flex flex-wrap gap-2">
              {AMENITY_CHOICES.map((a) => (
                <label key={a} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${form.amenities.includes(a) ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-ash text-gray-600'}`}>
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={form.amenities.includes(a)}
                    onChange={() => setForm({ ...form, amenities: form.amenities.includes(a) ? form.amenities.filter((x) => x !== a) : [...form.amenities, a] })}
                  />
                  {a}
                </label>
              ))}
            </div>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button loading={busy} onClick={create}>Create & publish</Button>
          </div>
        </div>
      </Modal>

      {/* Photos */}
      <Modal open={photoTarget !== null} title={`Photos — ${photoTarget?.title ?? ''}`} onClose={() => setPhotoTarget(null)}>
        {photoTarget && (
          <div className="space-y-3">
            {photoTarget.photos.length === 0 && <div className="text-xs text-gray-500">No photos yet — the listing shows without images on the board.</div>}
            <div className="grid grid-cols-3 gap-2">
              {photoTarget.photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p} alt={photoTarget.title} className="h-24 w-full rounded-lg object-cover" />
                </div>
              ))}
            </div>
            <Field label="Add a photo" hint="Up to 10 photos, 8 MB each.">
              <input ref={photoInput} type="file" accept="image/*" onChange={(e) => void addPhoto(photoTarget, e.target.files?.[0] ?? null)} className="w-full rounded-lg border border-ash bg-white px-3 py-2 text-sm" />
            </Field>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setPhotoTarget(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
