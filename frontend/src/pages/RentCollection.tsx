import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, EmptyState, Field, PageHeader, Select, SkeletonTable, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, authenticatedFetch, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { MONTHS, formatDate, methodLabel, money } from '../lib/format';
import { reportingYearOptions, useReportingYear } from '../lib/useReportingYear';

interface ArrearsRow {
  tenantId: number;
  unitNumber: string;
  tenantName: string;
  totalOutstanding: number;
}

interface TenantOption {
  id: number;
  full_name: string;
  unit_number: string | null;
  monthly_rent: string | null;
  water_enabled: boolean;
}

interface Payment {
  id: number;
  payment_date: string;
  billing_month: number;
  billing_year: number;
  amount: string;
  payment_method: string;
  payment_reference: string | null;
  receipt_number: string | null;
  tenant_name: string;
  unit_number: string;
  expectedRent: number;
  totalPaidForMonth: number;
  balance: number;
  status: string;
}

export default function RentCollection() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const now = new Date();
  const [tenantId, setTenantId] = useState<number | ''>('');
  const [paymentDate, setPaymentDate] = useState(now.toISOString().slice(0, 10));
  const [billingMonth, setBillingMonth] = useState(now.getMonth() + 1);
  const [billingYear, setBillingYear] = useState(now.getFullYear());
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('M_PESA');
  const [paymentReference, setPaymentReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [stkBusy, setStkBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [monthFilter, setMonthFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const reportingYear = useReportingYear();
  // Reads the deep link (?new=1 from the Dashboard quick action) but does not
  // own it — the focus effect below is the whole response, so plain
  // useSearchParams (read-only) rather than the shared sync hooks.
  const [params] = useSearchParams();

  // Deep link ?new=1 (Dashboard quick action): focus the form's first field so
  // recording a payment starts immediately. The form is inline, not a modal.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    document.getElementById('new-payment-tenant')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quick-action smart default: preselect the tenant with the largest
  // outstanding balance so the day's most urgent payment starts one click
  // sooner. Plain visits (no ?new=1) are left untouched.
  const { data: arrearsRows } = useFetch<ArrearsRow[]>(
    () => api.get<{ data: ArrearsRow[] }>('/api/reports/arrears').then((r) => r.data),
    []
  );
  const mostInArrears = useMemo(() => {
    const list = arrearsRows ?? [];
    return [...list].sort((a, b) => b.totalOutstanding - a.totalOutstanding)[0] ?? null;
  }, [arrearsRows]);
  const [prefilledTenant, setPrefilledTenant] = useState(false);
  useEffect(() => {
    if (prefilledTenant) return;
    if (params.get('new') === '1' && tenantId === '' && mostInArrears) {
      setTenantId(mostInArrears.tenantId);
      setPrefilledTenant(true);
    }
  }, [params, tenantId, mostInArrears, prefilledTenant]);

  const { data: tenants } = useFetch(() => api.list<TenantOption>('/api/tenants?status=ACTIVE&limit=100'));
  const { data: payments } = useFetch(
    () => api.list<Payment>(`/api/rent/payments${qs({ limit: 20, month: monthFilter || undefined, year: yearFilter || undefined })}`),
    [monthFilter, yearFilter, refreshKey]
  );

  const selectedTenant = useMemo(
    () => (tenantId === '' ? null : tenants?.data.find((t) => t.id === tenantId) ?? null),
    [tenantId, tenants]
  );

  // Export follows the active filters; with no year filter chosen it exports
  // the reporting year from Settings (never a hardcoded year).
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    const exportYear = yearFilter || reportingYear;
    if (exportYear !== null && exportYear !== '') params.set('year', String(exportYear));
    if (monthFilter) params.set('month', monthFilter);
    const query = params.toString();
    return `${import.meta.env.VITE_API_URL ?? ''}/api/rent/payments/export${query ? `?${query}` : ''}`;
  }, [yearFilter, monthFilter, reportingYear]);

  useEffect(() => {
    // When the tenant changes, prefill the billing month/year from today.
    setBillingMonth(now.getMonth() + 1);
    setBillingYear(now.getFullYear());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function recordPayment() {
    if (tenantId === '' || !amount || Number(amount) <= 0) {
      toast('error', 'Choose a tenant and enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ data: { status: string; balance: number; receipt: string; totalPaidForMonth: number; sms?: { queued: boolean; autoSend: boolean } } }>('/api/rent/payments', {
        tenantId,
        paymentDate,
        billingMonth,
        billingYear,
        amount: Number(amount),
        paymentMethod,
        paymentReference: paymentReference || undefined,
        notes: notes || undefined,
      });
      // SMS line: honest about what happened — auto-sent, queued for manual
      // sending, or nothing queued (no phone on file / disabled). Links to
      // the message's place in the SMS history.
      const smsNote = !res.data.sms?.queued
        ? ' No SMS — no phone on file.'
        : res.data.sms.autoSend
          ? ' Receipt SMS sent automatically.'
          : ' Receipt SMS queued for sending.';
      toast(
        'success',
        `Payment recorded (${res.data.status}) — balance ${money(res.data.balance)}. Receipt ${res.data.receipt}.${smsNote}`,
        { label: 'View in SMS history →', to: '/sms' }
      );
      setAmount('');
      setPaymentReference('');
      setNotes('');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function requestStkPush() {
    if (tenantId === '' || !amount || Number(amount) <= 0) {
      toast('error', 'Choose a tenant and enter an amount greater than zero.');
      return;
    }
    setStkBusy(true);
    try {
      const res = await api.post<{ data: { accountReference: string } }>('/api/rent/stk-push', {
        tenantId,
        amount: Number(amount),
      });
      toast('success', `M-Pesa payment prompt sent to ${selectedTenant?.full_name ?? 'the tenant'} for unit ${res.data.accountReference}. The rent will post automatically after confirmation.`);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setStkBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Rent Collection" subtitle="Expected rent and tenant details are retrieved automatically — status is calculated from totals" />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Form */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Record Rent Payment</h2>
          <div className="space-y-3">
            <Field label="Tenant / Unit">
              <Select id="new-payment-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">— Select tenant —</option>
                {tenants?.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name} — Unit {t.unit_number ?? '?'} (rent {money(t.monthly_rent)})
                  </option>
                ))}
              </Select>
            </Field>
            {selectedTenant && (
              <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm">
                <div className="font-semibold text-blue-900">{selectedTenant.full_name}</div>
                <div className="text-blue-800">Unit {selectedTenant.unit_number} · Expected rent: <b>{money(selectedTenant.monthly_rent)}</b></div>
                {mostInArrears?.tenantId === selectedTenant.id && mostInArrears.totalOutstanding > 0 && (
                  <div className="mt-0.5 text-xs text-blue-700">Largest outstanding balance — {money(mostInArrears.totalOutstanding)}</div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment Date"><TextInput type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></Field>
              <Field label="Amount Paid (KSh)"><TextInput type="number" min={0} step={0.5} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 4000" /></Field>
              <Field label="Billing Month">
                <Select value={billingMonth} onChange={(e) => setBillingMonth(Number(e.target.value))}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </Select>
              </Field>
              <Field label="Year"><TextInput type="number" value={billingYear} onChange={(e) => setBillingYear(Number(e.target.value))} /></Field>
              <Field label="Payment Method">
                <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="CASH">Cash</option>
                  <option value="M_PESA">M-Pesa</option>
                  <option value="BANK">Bank</option>
                  <option value="OTHER">Other</option>
                </Select>
              </Field>
              <Field label="Reference"><TextInput value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="M-Pesa code…" /></Field>
            </div>
            <Field label="Notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button onClick={recordPayment} disabled={busy || stkBusy}>
                {busy ? 'Recording…' : 'Record Rent Payment'}
              </Button>
              <Button variant="secondary" onClick={requestStkPush} disabled={busy || stkBusy}>
                {stkBusy ? 'Sending prompt…' : 'Send M-Pesa Prompt'}
              </Button>
            </div>
            <p className="text-xs text-gray-400">
              M-Pesa prompts use the tenant&apos;s unit number as the account reference. Confirmed payments post automatically; manual entries also support multiple payments per month.
            </p>
          </div>
        </div>

        {/* Recent payments */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Recent Rent Payments</h2>
            <div className="flex gap-2">
              <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="!w-32">
                <option value="">All months</option>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m.slice(0, 3)}</option>)}
              </Select>
              <Select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="!w-24">
                <option value="">Year</option>
                {reportingYearOptions(reportingYear).map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
            </div>
          </div>
          <div className="table-scroll">
            {!payments ? (
              <SkeletonTable cols={8} rows={6} />
            ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Tenant</th><th>Unit</th><th>Month</th><th>Amount</th>
                  <th>Method</th><th>Status</th><th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {payments?.data.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.payment_date)}</td>
                    <td className="font-medium">{p.tenant_name}</td>
                    <td>{p.unit_number}</td>
                    <td>{MONTHS[p.billing_month - 1].slice(0, 3)} {p.billing_year}</td>
                    <td className="font-medium">{money(p.amount)}</td>
                    <td>{methodLabel(p.payment_method)}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="text-xs">{p.receipt_number ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
            {payments && payments.data.length === 0 && <div className="p-6"><EmptyState message="No payments recorded for this filter." /></div>}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>Export:</span>
            <a
              href={exportUrl}
              className="font-medium text-brand-600 hover:underline"
              onClick={(e) => {
                e.preventDefault();
                authenticatedFetch(exportUrl)
                  .then((r) => r.text())
                  .then((csv) => {
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'rent-payments.csv';
                    a.click();
                  });
              }}
            >
              Download CSV
            </a>
            {isAdmin && payments && payments.data.length > 0 && (
              <button
                className="font-medium text-red-600 hover:underline"
                onClick={async () => {
                  const first = payments.data[0];
                  if (!window.confirm(`Delete rent payment of ${money(first.amount)} by ${first.tenant_name}? The receipt stays for history.`)) return;
                  try { await api.del(`/api/rent/payments/${first.id}`); toast('success', 'Payment deleted.'); setRefreshKey((k) => k + 1); }
                  catch (err) { toast('error', (err as Error).message); }
                }}
              >
                Delete latest payment
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}