import { useMemo, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { Button, EmptyState, Field, Modal, PageHeader, Select, SkeletonTable, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { MONTHS, formatDate, methodLabel, money } from '../lib/format';
import { reportingYearOptions, useReportingYear } from '../lib/useReportingYear';

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

export default function WaterPayments() {
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
    return `${import.meta.env.VITE_API_URL ?? ''}/api/water/payments/export${query ? `?${query}` : ''}`;
  }, [yearFilter, monthFilter, reportingYear]);

  return (
    <div>
      <PageHeader
        title="Water Payments"
        subtitle="Money actually collected from tenants for water — separate from water billed"
        actions={<Button onClick={() => setShowForm(true)}><Plus size={16} strokeWidth={2} aria-hidden /> Record Water Payment</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
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
            const token = localStorage.getItem('rpms_token');
            if (!token) return;
            e.preventDefault();
            fetch(exportUrl, {
              headers: { Authorization: `Bearer ${token}` },
            })
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
    </div>
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

  async function save() {
    if (tenantId === '' || !amount || Number(amount) <= 0) {
      toast('error', 'Select a tenant and enter an amount greater than zero.');
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Record Water Payment" onClose={onClose}>
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
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          A water payment can be recorded only for a unit with water billing enabled. Multiple payments per month are supported (e.g. 500 + 500 + 1,000 = PAID on a 2,000 bill).
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Payment'}</Button>
        </div>
      </div>
    </Modal>
  );
}