import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, EmptyState, Field, Modal, PageHeader, Select, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';

interface Unit {
  id: number;
  unit_number: string;
  unit_type: string;
  monthly_rent: string;
  water_enabled: boolean;
  occupancy_status: 'OCCUPIED' | 'VACANT';
  floor_number: number;
  floor_name: string;
  tenant_name: string | null;
  tenant_id: number | null;
  phone_number: string | null;
}

export default function Units() {
  const { canManage } = useAuth();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [floor, setFloor] = useState('');
  const [occupancy, setOccupancy] = useState('');
  const [edit, setEdit] = useState<Unit | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [history, setHistory] = useState<unknown[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error } = useFetch(
    () => api.list<Unit>(`/api/units${qs({ q, floorId: floor || undefined, occupancyStatus: occupancy || undefined, limit: 100 })}`),
    [q, floor, occupancy, refreshKey]
  );

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div>
      <PageHeader
        title="Units"
        subtitle="All 24 units — rents come from the database and stay editable (including Room 12)"
        actions={canManage ? <Button onClick={() => { setEdit(null); setShowForm(true); }}><Plus size={16} strokeWidth={2} aria-hidden /> Add Unit</Button> : undefined}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <TextInput placeholder="Search unit, type or tenant…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={floor} onChange={(e) => setFloor(e.target.value)} className="w-40">
          <option value="">All floors</option>
          {[1, 2, 3, 4].map((f) => <option key={f} value={f}>{['', 'First Floor', 'Second Floor', 'Third Floor', 'Fourth Floor'][f]}</option>)}
        </Select>
        <Select value={occupancy} onChange={(e) => setOccupancy(e.target.value)} className="w-40">
          <option value="">All statuses</option>
          <option value="OCCUPIED">Occupied</option>
          <option value="VACANT">Vacant</option>
        </Select>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Unit</th><th>Floor</th><th>Type</th><th>Monthly Rent</th>
                <th>Tenant</th><th>Phone</th><th>Status</th><th>Water</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((u) => (
                <tr key={u.id}>
                  <td className="font-semibold text-gray-900">{u.unit_number}</td>
                  <td>{u.floor_name}</td>
                  <td>{u.unit_type}</td>
                  <td className="font-medium">{money(u.monthly_rent)}</td>
                  <td>{u.tenant_name ?? <span className="text-gray-400">—</span>}</td>
                  <td>{u.phone_number ?? '—'}</td>
                  <td><StatusBadge status={u.occupancy_status} /></td>
                  <td>{u.water_enabled ? <span className="font-medium text-emerald-700">Enabled</span> : <span className="text-gray-400">No</span>}</td>
                  <td>
                    <div className="flex gap-1">
                      {canManage && (
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => { setEdit(u); setShowForm(true); }}>Edit</Button>
                      )}
                      <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={async () => {
                        const h = await api.get<{ data: unknown }>(`/api/units/${u.id}/history`);
                        setHistory([{ ...(h.data as object), unitNumber: u.unit_number }]);
                      }}>History</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.data.length === 0 && <div className="p-6"><EmptyState message="No units found." /></div>}
        </div>
      )}

      <UnitForm
        open={showForm}
        unit={edit}
        onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); refresh(); toast('success', edit ? 'Unit updated.' : 'Unit added.'); }}
      />

      <Modal open={history !== null} title="Unit Financial History" onClose={() => setHistory(null)} wide>
        {history && (
          <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
            {JSON.stringify(history, null, 2)}
          </pre>
        )}
      </Modal>
    </div>
  );
}

function UnitForm({ open, unit, onClose, onSaved }: { open: boolean; unit: Unit | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [unitNumber, setUnitNumber] = useState(unit?.unit_number ?? '');
  const [floorId, setFloorId] = useState(unit?.floor_number ?? 1);
  const [unitType, setUnitType] = useState(unit?.unit_type ?? 'Room');
  const [monthlyRent, setMonthlyRent] = useState(unit ? Number(unit.monthly_rent) : 3000);
  const [waterEnabled, setWaterEnabled] = useState(unit?.water_enabled ?? false);
  const [occupancyStatus, setOccupancyStatus] = useState<'OCCUPIED' | 'VACANT'>(unit?.occupancy_status ?? 'VACANT');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!unitNumber.trim() || monthlyRent < 0) {
      toast('error', 'Unit number and a non-negative rent are required.');
      return;
    }
    setBusy(true);
    try {
      const body = { unitNumber: unitNumber.trim(), floorId, unitType, monthlyRent, waterEnabled, occupancyStatus };
      if (unit) await api.put(`/api/units/${unit.id}`, body);
      else await api.post('/api/units', body);
      onSaved();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={unit ? `Edit Unit ${unit.unit_number}` : 'Add Unit'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit Number"><TextInput value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} /></Field>
          <Field label="Floor">
            <Select value={floorId} onChange={(e) => setFloorId(Number(e.target.value))}>
              {[1, 2, 3, 4].map((f) => <option key={f} value={f}>{['', 'First Floor', 'Second Floor', 'Third Floor', 'Fourth Floor'][f]}</option>)}
            </Select>
          </Field>
          <Field label="Unit Type">
            <Select value={unitType} onChange={(e) => setUnitType(e.target.value)}>
              {['Room', 'Bedsitter', '1 Bedroom', '2 Bedroom'].map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Monthly Rent (KSh)" hint={unit?.unit_number === '12' ? 'Room 12: may be 4,000 or 3,500 — editable here.' : undefined}>
            <TextInput type="number" min={0} value={monthlyRent} onChange={(e) => setMonthlyRent(Number(e.target.value))} />
          </Field>
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={waterEnabled} onChange={(e) => setWaterEnabled(e.target.checked)} className="h-4 w-4" />
            Water billing enabled
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={occupancyStatus === 'OCCUPIED'} onChange={(e) => setOccupancyStatus(e.target.checked ? 'OCCUPIED' : 'VACANT')} className="h-4 w-4" />
            Occupied
          </label>
        </div>
        {waterEnabled && (parseInt(unitNumber, 10) < 12 || parseInt(unitNumber, 10) > 23 || Number.isNaN(parseInt(unitNumber, 10))) && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Note: the business rule allows water billing for units 12–23 only. The database will reject water transactions for other units.
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}