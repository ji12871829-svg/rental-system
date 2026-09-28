// One page for the whole water cycle: METER (readings → bills) → PAYMENTS
// (tenant collections) → SUPPLY (bulk purchases & surplus/deficit).
//
// Consolidated from the three former pages (WaterMeter, WaterPayments,
// WaterSupply) so the operator manages water in a single place. Each former
// page survives verbatim as a section component below — same fetches, same
// forms, same filters — and the old URLs still work via redirects in App.tsx.
// The Dashboard's "Log Reading" quick action deep-links here with ?new=1,
// which lands on the Meter tab with its form open (same behavior the old
// WaterMeter page had).
import { useEffect, useMemo, useState } from 'react';
import { Download, Droplets, Gauge, Plus, ReceiptText, type LucideIcon } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '../components/charts';
import { Button, EmptyState, Field, KpiCard, Modal, PageHeader, Pagination, Select, SkeletonTable, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, authenticatedFetch, apiUrl, qs } from '../lib/api';
import { MONTHS, formatDate, methodLabel, money } from '../lib/format';
import { reportingYearOptions, useReportingYear } from '../lib/useReportingYear';
import { useQueryParam, useQueryToggle } from '../lib/useQueryParam';

type WaterTab = 'meter' | 'payments' | 'supply';

const TABS: { id: WaterTab; label: string; icon: LucideIcon }[] = [
  { id: 'meter', label: 'Meter Readings & Bills', icon: Gauge },
  { id: 'payments', label: 'Tenant Payments', icon: Droplets },
  { id: 'supply', label: 'Supply Costs', icon: ReceiptText },
];

export default function Water() {
  // The active tab is mirrored to the URL (?tab=payments) so redirects from
  // the old per-page URLs and section-specific bookmarks land on the right
  // place; an absent param means the default Meter tab.
  const [tabParam, setTabParam] = useQueryParam('tab');
  const tab: WaterTab = tabParam === 'payments' || tabParam === 'supply' ? tabParam : 'meter';
  const setTab = (next: WaterTab) => setTabParam(next === 'meter' ? '' : next);
  // Auto-open the reading form when deep-linked with ?new=1 (e.g. from the
  // Dashboard's quick actions); the URL toggle mirrors the form state, so
  // closing the modal cleans the param away.
  const [readingFormOpen, setReadingFormOpen] = useQueryToggle('new');

  return (
    <div>
      <PageHeader
        title="Water"
        subtitle="The full water cycle in one place — meter readings and bills, tenant payments, and bulk supply costs"
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Water sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
              tab === t.id
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <t.icon size={14} strokeWidth={1.75} aria-hidden /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'meter' && <MeterSection formOpen={readingFormOpen} setFormOpen={setReadingFormOpen} />}
      {tab === 'payments' && <PaymentsSection />}
      {tab === 'supply' && <SupplySection />}
    </div>
  );
}

// ===========================================================================
// METER — readings per water-enabled unit (former WaterMeter page)
// ===========================================================================

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
  last_reading_date: string | null;
}

function MeterSection({ formOpen, setFormOpen }: { formOpen: boolean; setFormOpen: (value: boolean) => void }) {
  const { toast } = useToast();
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

  // Quick-action preselection: the water unit longest without a reading —
  // any never-read unit first (the API lists them in unit-number order),
  // else the unit whose last reading is oldest.
  const unitLongestWithoutReading = useMemo(() => {
    const neverRead = waterUnits.filter((u) => !u.last_reading_date);
    if (neverRead.length > 0) return neverRead[0];
    const read = waterUnits
      .filter((u) => u.last_reading_date)
      .sort((a, b) => (a.last_reading_date! < b.last_reading_date! ? -1 : 1));
    return read[0] ?? null;
  }, [waterUnits]);
  const [prefillUnitId, setPrefillUnitId] = useState<number | null>(null);

  // When the form opens, capture the suggested unit (re-captures if the unit
  // list lands after the form opened).
  useEffect(() => {
    if (formOpen && unitLongestWithoutReading) setPrefillUnitId(unitLongestWithoutReading.id);
  }, [formOpen, unitLongestWithoutReading]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Units 14–24 only — readings shown for reporting year {reportingYear ?? '…'} (set in Settings); the previous reading is filled in automatically
        </p>
        <Button onClick={() => setFormOpen(true)}><Plus size={16} strokeWidth={2} aria-hidden /> Record Reading</Button>
      </div>

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

      {loading && <SkeletonTable cols={12} />}
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
                    {Number(r.previous_reading) === 0 && <span className="ml-1 rounded bg-violet/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet">FIRST READING</span>}
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
        open={formOpen}
        units={waterUnits}
        prefillUnitId={prefillUnitId}
        onClose={() => setFormOpen(false)}
        onSaved={(msg) => { setFormOpen(false); setRefreshKey((k) => k + 1); toast('success', msg); }}
      />
    </>
  );
}

function ReadingForm({ open, units, prefillUnitId, onClose, onSaved }: { open: boolean; units: UnitOption[]; prefillUnitId: number | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const { toast } = useToast();
  const now = new Date();
  const [unitId, setUnitId] = useState<number | ''>(prefillUnitId ?? '');
  const [readingDate, setReadingDate] = useState(now.toISOString().slice(0, 10));
  const [billingMonth, setBillingMonth] = useState(now.getMonth() + 1);
  const [billingYear, setBillingYear] = useState(now.getFullYear());
  const [currentReading, setCurrentReading] = useState('');
  const [previousReading, setPreviousReading] = useState('');
  const [busy, setBusy] = useState(false);
  const [shakeN, setShakeN] = useState(0);
  const bumpShake = () => setShakeN((n) => n + 1);

  // Apply the suggested unit whenever the form opens with nothing selected —
  // covers deep-link opens (selection empty) and late-arriving unit data,
  // without clobbering a choice the user already made.
  useEffect(() => {
    if (open && unitId === '' && prefillUnitId !== null) setUnitId(prefillUnitId);
  }, [open, prefillUnitId, unitId]);

  async function save() {
    if (unitId === '' || currentReading === '' || Number(currentReading) < 0) {
      toast('error', 'Select a water-enabled unit and enter the current reading.');
      bumpShake();
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
      bumpShake();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Record Meter Reading" onClose={onClose} shakeSignal={shakeN}>
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
        <p className="rounded-lg bg-fog px-3 py-2 text-xs text-graphite">
          The bill is calculated as (Current − Previous) × the current water rate from Settings. A current reading below the previous reading is rejected.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy} loading={busy}>{busy ? 'Saving…' : 'Save Reading'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ===========================================================================
// PAYMENTS — tenant water collections (former WaterPayments page)
// ===========================================================================

interface TenantOption {
  id: number;
  full_name: string;
  unit_number: string | null;
}

interface WPayment {
  id: number;
  payment_date: string;
  billing_month: number;
  billing_year: number;
  amount: string;
  payment_method: string;
  receipt_number: string | null;
  tenant_name: string;
  unit_number: string;
  waterBill: number;
  totalWaterPaid: number;
  waterBalance: number;
  status: string;
}

function PaymentsSection() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [monthFilter, setMonthFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const reportingYear = useReportingYear();

  const { data: tenants } = useFetch(() => api.list<TenantOption>('/api/tenants?status=ACTIVE&limit=100'));
  const { data, loading, error } = useFetch(
    () => api.list<WPayment>(`/api/water/payments${qs({ limit: 50, month: monthFilter || undefined, year: yearFilter || undefined })}`),
    [monthFilter, yearFilter, refreshKey]
  );

  const waterTenants = useMemo(() => (tenants?.data ?? []).filter((t) => t.unit_number && Number(t.unit_number) >= 14 && Number(t.unit_number) <= 24), [tenants]);

  // CSV export mirrors the rent page: respects the month/year filters.
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    const exportYear = yearFilter || reportingYear;
    if (exportYear !== null && exportYear !== '') params.set('year', String(exportYear));
    if (monthFilter) params.set('month', monthFilter);
    const query = params.toString();
    return `${apiUrl('/api/water/payments/export')}${query ? `?${query}` : ''}`;
  }, [yearFilter, monthFilter, reportingYear]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="w-40">
          <option value="">All months</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select>
        <Select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="w-24">
          <option value="">Year</option>
          {reportingYearOptions(reportingYear).map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <a
          href={exportUrl}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 transition-colors duration-150 hover:text-brand-700 hover:underline"
          onClick={(e) => {
            e.preventDefault();
            authenticatedFetch(exportUrl)
              .then((r) => {
                if (!r.ok) throw new Error(`Export failed (${r.status})`);
                return r.text();
              })
              .then((csv) => {
                const blob = new Blob([csv], { type: 'text/csv' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'water-payments.csv';
                a.click();
                URL.revokeObjectURL(a.href);
              })
              .catch((err) => toast('error', (err as Error).message));
          }}
        >
          <Download size={15} strokeWidth={1.75} aria-hidden /> Download CSV
        </a>
        <Button className="ml-auto" onClick={() => setShowForm(true)}><Plus size={16} strokeWidth={2} aria-hidden /> Record Water Payment</Button>
      </div>

      {loading && <SkeletonTable cols={11} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Tenant</th><th>Unit</th><th>Month</th><th>Amount</th>
                <th>Method</th><th>Bill</th><th>Total Paid</th><th>Balance</th><th>Status</th><th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.payment_date)}</td>
                  <td className="font-medium">{p.tenant_name}</td>
                  <td>Unit {p.unit_number}</td>
                  <td>{MONTHS[p.billing_month - 1].slice(0, 3)} {p.billing_year}</td>
                  <td className="font-medium">{money(p.amount)}</td>
                  <td>{methodLabel(p.payment_method)}</td>
                  <td>{money(p.waterBill)}</td>
                  <td>{money(p.totalWaterPaid)}</td>
                  <td className={Number(p.waterBalance) > 0 ? 'font-medium text-red-600' : 'text-gray-700'}>{money(p.waterBalance)}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="text-xs">{p.receipt_number ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.data.length === 0 && <div className="p-6"><EmptyState message="No water payments recorded." /></div>}
        </div>
      )}

      <WaterPaymentForm
        open={showForm}
        tenants={waterTenants}
        onClose={() => setShowForm(false)}
        onSaved={(msg, action) => { setShowForm(false); setRefreshKey((k) => k + 1); toast('success', msg, action); }}
      />
    </>
  );
}

function WaterPaymentForm({ open, tenants, onClose, onSaved }: { open: boolean; tenants: TenantOption[]; onClose: () => void; onSaved: (msg: string, action?: { label: string; to: string }) => void }) {
  const { toast } = useToast();
  const now = new Date();
  const [tenantId, setTenantId] = useState<number | ''>('');
  const [paymentDate, setPaymentDate] = useState(now.toISOString().slice(0, 10));
  const [billingMonth, setBillingMonth] = useState(now.getMonth() + 1);
  const [billingYear, setBillingYear] = useState(now.getFullYear());
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('M_PESA');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [shakeN, setShakeN] = useState(0);
  const bumpShake = () => setShakeN((n) => n + 1);

  async function save() {
    if (tenantId === '' || !amount || Number(amount) <= 0) {
      toast('error', 'Select a tenant and enter an amount greater than zero.');
      bumpShake();
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ data: { status: string; waterBalance: number; receipt: string; waterBill: number; sms?: { queued: boolean; autoSend: boolean } } }>('/api/water/payments', {
        tenantId, paymentDate, billingMonth, billingYear, amount: Number(amount), paymentMethod, notes: notes || undefined,
      });
      // SMS line: honest about what happened — auto-sent, queued for manual
      // sending, or nothing queued (no phone on file / disabled). Links to
      // the message's place in the SMS history.
      const smsNote = !res.data.sms?.queued
        ? ' No SMS — no phone on file.'
        : res.data.sms.autoSend
          ? ' Receipt SMS sent automatically.'
          : ' Receipt SMS queued for sending.';
      onSaved(
        `Water payment recorded (${res.data.status}) — bill ${money(res.data.waterBill)}, balance ${money(res.data.waterBalance)}. Receipt ${res.data.receipt}.${smsNote}`,
        { label: 'View in SMS history →', to: '/sms' }
      );
      setAmount('');
      setNotes('');
    } catch (err) {
      toast('error', (err as Error).message);
      bumpShake();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Record Water Payment" onClose={onClose} shakeSignal={shakeN}>
      <div className="space-y-4">
        <Field label="Tenant (water units 14–24)">
          <Select value={tenantId} onChange={(e) => setTenantId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">— Select tenant —</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.full_name} — Unit {t.unit_number}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Payment Date"><TextInput type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></Field>
          <Field label="Amount (KSh)"><TextInput type="number" min={0} step={0.5} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Billing Month">
            <Select value={billingMonth} onChange={(e) => setBillingMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Year"><TextInput type="number" value={billingYear} onChange={(e) => setBillingYear(Number(e.target.value))} /></Field>
          <Field label="Payment Method">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="CASH">Cash</option><option value="M_PESA">M-Pesa</option>
              <option value="BANK">Bank</option><option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="Notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <p className="rounded-lg bg-fog px-3 py-2 text-xs text-graphite">
          A water payment can be recorded only for a unit with water billing enabled. Multiple payments per month are supported (e.g. 500 + 500 + 1,000 = PAID on a 2,000 bill).
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy} loading={busy}>{busy ? 'Saving…' : 'Save Payment'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ===========================================================================
// SUPPLY — bulk water purchases & surplus/deficit (former WaterSupply page)
// ===========================================================================

interface Purchase {
  id: number;
  purchase_date: string;
  supplier: string;
  quantity: string;
  measurement_unit: string;
  cost_per_unit: string;
  total_cost: string;
  payment_method: string;
  reference_number: string | null;
  notes: string | null;
}

interface Summary {
  waterBilled: number;
  waterCollected: number;
  waterOutstanding: number;
  waterPurchased: number;
  waterSupplyCost: number;
  averagePurchaseCost: number;
  collectionRate: number;
  surplusDeficit: number;
  surplus: boolean;
  currency: string;
}

interface MonthlyRow {
  month: number;
  monthName: string;
  waterBilled: number;
  waterCollected: number;
  waterOutstanding: number;
  waterPurchased: number;
  waterSupplyCost: number;
  surplusDeficit: number;
  collectionRate: number;
  currency: string;
}

const SUPPLIERS_HINT = 'e.g. Nairobi Water, borehole operator, water vendor';

function SupplySection() {
  const { toast } = useToast();
  const now = new Date();
  const [edit, setEdit] = useState<Purchase | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error } = useFetch(
    () => api.list<Purchase>(`/api/water/purchases${qs({ page, limit: 20 })}`),
    [page, refreshKey]
  );
  const { data: summary } = useFetch<Summary>(
    () => api.get<{ data: Summary }>(`/api/water/summary${qs({ year: now.getFullYear() })}`).then((r) => r.data),
    [refreshKey]
  );
  const { data: monthly } = useFetch<MonthlyRow[]>(
    () => api.get<{ data: MonthlyRow[] }>(`/api/water/monthly?year=${now.getFullYear()}`).then((r) => r.data),
    [refreshKey]
  );

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <Button onClick={() => { setEdit(null); setShowForm(true); }}><Plus size={16} strokeWidth={2} aria-hidden /> Record Water Purchase</Button>
      </div>

      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Water purchased" value={`${summary.waterPurchased} units`} sub={`avg ${money(summary.averagePurchaseCost, summary.currency)}/unit`} />
          <KpiCard label="Total supply cost" value={money(summary.waterSupplyCost, summary.currency)} tone="warn" />
          <KpiCard label="Water collected" value={money(summary.waterCollected, summary.currency)} sub={`${summary.collectionRate}% of billed`} tone="good" />
          <KpiCard
            label={summary.surplus ? 'Water surplus' : 'Water deficit'}
            value={money(Math.abs(summary.surplusDeficit), summary.currency)}
            tone={summary.surplus ? 'good' : 'bad'}
          />
        </div>
      )}

      {loading && <SkeletonTable cols={9} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Supplier</th><th>Quantity</th><th>Cost / Unit</th>
                  <th>Total Cost</th><th>Method</th><th>Reference</th><th>Notes</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.purchase_date)}</td>
                    <td className="font-semibold text-gray-900">{p.supplier}</td>
                    <td>{Number(p.quantity)} {p.measurement_unit}</td>
                    <td>{money(p.cost_per_unit)}</td>
                    <td className="font-medium">{money(p.total_cost)}</td>
                    <td>{methodLabel(p.payment_method)}</td>
                    <td className="text-xs">{p.reference_number ?? '—'}</td>
                    <td className="text-xs text-gray-500">{p.notes ?? '—'}</td>
                    <td>
                      <div className="flex gap-1">
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => { setEdit(p); setShowForm(true); }}>Edit</Button>
                        <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-600" onClick={async () => {
                          if (!window.confirm(`Delete purchase from ${p.supplier} of ${money(p.total_cost)}?`)) return;
                          try { await api.del(`/api/water/purchases/${p.id}`); toast('success', 'Purchase deleted.'); refresh(); }
                          catch (err) { toast('error', (err as Error).message); }
                        }}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && <div className="p-6"><EmptyState message="No water purchases recorded yet — add your first supply cost." /></div>}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      {monthly && (
        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Monthly supply cost vs water collected ({now.getFullYear()})</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthly.map((r) => ({ month: r.monthName.slice(0, 3), 'Supply cost': r.waterSupplyCost, Collected: r.waterCollected }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(v: any) => money(v)} />
              <Bar dataKey="Supply cost" fill="#f59e0b" />
              <Bar dataKey="Collected" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <PurchaseForm
        open={showForm}
        purchase={edit}
        onClose={() => setShowForm(false)}
        onSaved={(msg) => { setShowForm(false); refresh(); toast('success', msg); }}
      />
    </>
  );
}

function PurchaseForm({ open, purchase, onClose, onSaved }: { open: boolean; purchase: Purchase | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const { toast } = useToast();
  const now = new Date();
  const [purchaseDate, setPurchaseDate] = useState(purchase?.purchase_date?.slice(0, 10) ?? now.toISOString().slice(0, 10));
  const [supplier, setSupplier] = useState(purchase?.supplier ?? '');
  const [quantity, setQuantity] = useState(purchase ? Number(purchase.quantity) : 0);
  const [measurementUnit, setMeasurementUnit] = useState(purchase?.measurement_unit ?? 'units');
  const [costPerUnit, setCostPerUnit] = useState(purchase ? Number(purchase.cost_per_unit) : 0);
  const [paymentMethod, setPaymentMethod] = useState(purchase?.payment_method ?? 'M_PESA');
  const [referenceNumber, setReferenceNumber] = useState(purchase?.reference_number ?? '');
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [shakeN, setShakeN] = useState(0);
  const bumpShake = () => setShakeN((n) => n + 1);

  const totalCost = Math.round(quantity * costPerUnit * 100) / 100;

  async function save() {
    if (!supplier.trim()) { toast('error', 'Supplier is required.'); bumpShake(); return; }
    if (quantity <= 0) { toast('error', 'Quantity must be greater than zero.'); bumpShake(); return; }
    setBusy(true);
    try {
      const body = {
        purchaseDate, supplier: supplier.trim(), quantity, measurementUnit,
        costPerUnit, paymentMethod, referenceNumber: referenceNumber || undefined, notes: notes || undefined,
      };
      if (purchase) await api.put(`/api/water/purchases/${purchase.id}`, body);
      else await api.post('/api/water/purchases', body);
      onSaved(`Water purchase of ${money(totalCost)} from ${supplier.trim()} saved.`);
    } catch (err) {
      toast('error', (err as Error).message);
      bumpShake();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={purchase ? 'Edit Water Purchase' : 'Record Water Purchase'} onClose={onClose} shakeSignal={shakeN}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase Date"><TextInput type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field>
          <Field label="Supplier" hint={SUPPLIERS_HINT}><TextInput value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
          <Field label="Quantity"><TextInput type="number" min={0} step={0.5} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></Field>
          <Field label="Measurement Unit"><TextInput value={measurementUnit} onChange={(e) => setMeasurementUnit(e.target.value)} /></Field>
          <Field label="Cost per Unit (KSh)"><TextInput type="number" min={0} step={0.5} value={costPerUnit} onChange={(e) => setCostPerUnit(Number(e.target.value))} /></Field>
          <Field label="Payment Method">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="CASH">Cash</option><option value="M_PESA">M-Pesa</option>
              <option value="BANK">Bank</option><option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="Reference"><TextInput value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} /></Field>
          <Field label="Notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="rounded-lg bg-fog px-3 py-2 text-sm text-graphite">
          Total cost: <b>{money(totalCost)}</b> (quantity × cost per unit — calculated automatically).
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy} loading={busy}>{busy ? 'Saving…' : 'Save Purchase'}</Button>
        </div>
      </div>
    </Modal>
  );
}
