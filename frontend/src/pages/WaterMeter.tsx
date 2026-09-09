import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, EmptyState, Field, Modal, PageHeader, Select, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { MONTHS, formatDate, money } from '../lib/format';
import { useReportingYear } from '../lib/useReportingYear';

interface Reading {
  id: number;
  reading_date: string;
  unit_number: string;
  tenant_name: string | null;
  billing_month: number;
  billing_year: number;
  previous_reading: string;
  current_reading: string;
  consumption: string;
  water_rate: string;
  water_bill: string;
  totalWaterPaid: number;
  waterBalance: number;
  status: string;
}

interface UnitOption {
  id: number;
  unit_number: string;
  unit_type: string;
  tenant_name: string | null;
}

export default function WaterMeter() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [unitFilter, setUnitFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const reportingYear = useReportingYear();

  const { data: units } = useFetch(() => api.list<UnitOption>('/api/units?waterEnabled=true&limit=100'));
  const { data, loading, error } = useFetch(
    () => api.list<Reading>(`/api/water/readings${qs({ limit: 50, unitId: unitFilter || undefined, month: monthFilter || undefined, year: reportingYear ?? undefined })}`),
    [unitFilter, monthFilter, reportingYear, refreshKey],
    { enabled: reportingYear !== null }
  );

  const waterUnits = useMemo(() => units?.data ?? [], [units]);

  return (
    <div>
      <PageHeader
        title="Water Meter"
        subtitle={`Units 12–23 only — readings shown for reporting year ${reportingYear ?? '…'} (set in Settings); the previous reading is filled in automatically`}
        actions={<Button onClick={() => setShowForm(true)}><Plus size={16} strokeWidth={2} aria-hidden /> Record Reading</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="w-44">
          <option value="">All water units</option>
          {waterUnits.map((u) => <option key={u.id} value={u.id}>Unit {u.unit_number}</option>)}
        </Select>
        <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="w-40">
          <option value="">All months</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Unit</th><th>Tenant</th><th>Month</th>
                <th>Previous</th><th>Current</th><th>Consumed</th><th>Rate</th><th>Bill</th>
                <th>Paid</th><th>Balance</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.reading_date)}</td>
                  <td className="font-semibold text-gray-900">Unit {r.unit_number}</td>
                  <td>{r.tenant_name ?? '—'}</td>
                  <td>{MONTHS[r.billing_month - 1].slice(0, 3)} {r.billing_year}</td>
                  <td>{Number(r.previous_reading)}
                    {Number(r.previous_reading) === 0 && <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">FIRST READING</span>}
                  </td>
                  <td>{Number(r.current_reading)}</td>
                  <td className="font-medium">{Number(r.consumption)}</td>
                  <td>{money(r.water_rate)}</td>
                  <td className="font-medium">{money(r.water_bill)}</td>
                  <td>{money(r.totalWaterPaid)}</td>
                  <td className={Number(r.waterBalance) > 0 ? 'font-medium text-red-600' : 'text-gray-700'}>{money(r.waterBalance)}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.data.length === 0 && <div className="p-6"><EmptyState message="No water readings available." /></div>}
        </div>
      )}

      <ReadingForm
        open={showForm}
        units={waterUnits}
        onClose={() => setShowForm(false)}
        onSaved={(msg) => { setShowForm(false); setRefreshKey((k) => k + 1); toast('success', msg); }}
      />
    </div>
  );
}

function ReadingForm({ open, units, onClose, onSaved }: { open: boolean; units: UnitOption[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const { toast } = useToast();
  const now = new Date();
  const [unitId, setUnitId] = useState<number | ''>('');
  const [readingDate, setReadingDate] = useState(now.toISOString().slice(0, 10));
  const [billingMonth, setBillingMonth] = useState(now.getMonth() + 1);
  const [billingYear, setBillingYear] = useState(now.getFullYear());
  const [currentReading, setCurrentReading] = useState('');
  const [previousReading, setPreviousReading] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (unitId === '' || currentReading === '' || Number(currentReading) < 0) {
      toast('error', 'Select a water-enabled unit and enter the current reading.');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        unitId,
        readingDate,
        billingMonth,
        billingYear,
        currentReading: Number(currentReading),
      };
      if (previousReading !== '') body.previousReading = Number(previousReading);
      const res = await api.post<{ data: { firstReading: boolean; reading: { water_bill: string }; waterBill: number; unitNumber: string } }>('/api/water/readings', body);
      const label = res.data.firstReading ? 'FIRST READING recorded' : 'Reading recorded';
      onSaved(`${label} for Unit ${res.data.unitNumber} — water bill ${money(res.data.waterBill)}.`);
      setCurrentReading('');
      setPreviousReading('');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Record Meter Reading" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Unit (water-enabled only)">
          <Select value={unitId} onChange={(e) => setUnitId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">— Select unit —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>Unit {u.unit_number} ({u.unit_type}){u.tenant_name ? ` — ${u.tenant_name}` : ''}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reading Date"><TextInput type="date" value={readingDate} onChange={(e) => setReadingDate(e.target.value)} /></Field>
          <Field label="Billing Month">
            <Select value={billingMonth} onChange={(e) => setBillingMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Current Reading">
            <TextInput type="number" min={0} step={0.001} value={currentReading} onChange={(e) => setCurrentReading(e.target.value)} placeholder="e.g. 128" />
          </Field>
          <Field label="Year"><TextInput type="number" value={billingYear} onChange={(e) => setBillingYear(Number(e.target.value))} /></Field>
        </div>
        <Field label="Previous Reading (optional)" hint="Leave empty to use the latest reading automatically. For a FIRST READING you can establish the meter's starting value here.">
          <TextInput type="number" min={0} step={0.001} value={previousReading} onChange={(e) => setPreviousReading(e.target.value)} placeholder="Auto-filled if left empty" />
        </Field>
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          The bill is calculated as (Current − Previous) × the current water rate from Settings. A current reading below the previous reading is rejected.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Reading'}</Button>
        </div>
      </div>
    </Modal>
  );
}