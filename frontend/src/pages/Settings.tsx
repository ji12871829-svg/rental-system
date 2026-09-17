import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { Button, Field, PageHeader, Skeleton, TextInput, useFetch, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranding, type BrandingView } from '../lib/BrandingContext';
import { methodLabel } from '../lib/format';
import { branding } from '../lib/branding';

interface SettingsData {
  reporting_year: number;
  currency: string;
  water_rate: string;
  retention_years: number;
}

// The 12 editable identity fields, grouped the way they appear on the plate.
const IDENTITY_FIELDS: {
  key: keyof Pick<BrandingView,
    | 'legalName' | 'registrationNumber' | 'address' | 'contactEmail'
    | 'privacyEmail' | 'contactPhone' | 'retentionPeriod' | 'responseDays'
    | 'jurisdiction' | 'propertyScope' | 'paymentChannels' | 'refundWindowDays'>;
  label: string;
  placeholder: string;
  wide?: boolean;
}[] = [
  { key: 'legalName', label: 'Company legal name', placeholder: 'e.g. Olbano Property Management Ltd' },
  { key: 'registrationNumber', label: 'Registration number', placeholder: 'e.g. BN-2026-123456' },
  { key: 'address', label: 'Business address', placeholder: 'e.g. P.O. Box 123, Nairobi', wide: true },
  { key: 'contactPhone', label: 'Phone number', placeholder: 'e.g. +254 700 000 000' },
  { key: 'contactEmail', label: 'General queries email', placeholder: 'e.g. info@example.com' },
  { key: 'privacyEmail', label: 'Privacy email', placeholder: 'e.g. privacy@example.com — or the general one' },
  { key: 'retentionPeriod', label: 'Record retention period', placeholder: 'e.g. 7 years' },
  { key: 'responseDays', label: 'Privacy request response days', placeholder: 'e.g. 30' },
  { key: 'jurisdiction', label: 'Governing law jurisdiction', placeholder: 'e.g. Kenya' },
  { key: 'propertyScope', label: 'Property (refund policy)', placeholder: 'e.g. Olbano Apartments, 123 Riverside Drive, Nairobi', wide: true },
  { key: 'paymentChannels', label: 'Payment channels (refund policy)', placeholder: 'e.g. M-Pesa, cash or bank transfer', wide: true },
  { key: 'refundWindowDays', label: 'Refund processing window', placeholder: 'e.g. 7–14 days' },
];

type IdentityForm = Record<string, string>;

function formFromIdentity(identity: BrandingView): IdentityForm {
  const form: IdentityForm = {};
  for (const { key } of IDENTITY_FIELDS) form[key] = identity[key] ?? '';
  return form;
}

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { identity, refreshBranding, lastUpdatedDisplay } = useBranding();
  const { data, refresh } = useFetch<SettingsData>(() => api.get<{ data: SettingsData }>('/api/settings').then((r) => r.data));
  const [reportingYear, setReportingYear] = useState(2026);
  const [currency, setCurrency] = useState('KSh');
  const [waterRate, setWaterRate] = useState(200);
  const [retentionYears, setRetentionYears] = useState(7);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setReportingYear(data.reporting_year);
      setCurrency(data.currency);
      setWaterRate(Number(data.water_rate));
      setRetentionYears(Number(data.retention_years ?? 7));
    }
  }, [data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put('/api/settings', {
        reportingYear: Number(reportingYear),
        currency,
        waterRate: Number(waterRate),
        retentionYears: Number(retentionYears),
      });
      toast('success', 'Settings saved. All reports now use the new values.');
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // --- Business identity (DB-backed, editable here) --------------------------
  const [identityForm, setIdentityForm] = useState<IdentityForm | null>(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [paybillNumber, setPaybillNumber] = useState('');
  const [paybillName, setPaybillName] = useState('');
  const [paybillInstructions, setPaybillInstructions] = useState('');
  const [paybillEnabled, setPaybillEnabled] = useState(false);
  const [paybillBusy, setPaybillBusy] = useState(false);

  // Fill the form the first time identity arrives; after a save the form is
  // re-synced explicitly, so live updates never clobber in-progress edits.
  useEffect(() => {
    if (identity && identityForm === null) setIdentityForm(formFromIdentity(identity));
    if (identity) {
      setPaybillNumber(identity.paybill_number ?? '');
      setPaybillName(identity.paybill_name ?? '');
      setPaybillInstructions(identity.paybill_instructions ?? '');
      setPaybillEnabled(identity.paybill_enabled);
    }
  }, [identity, identityForm]);

  const identityDirty =
    identityForm !== null && identity !== null &&
    IDENTITY_FIELDS.some(({ key }) => (identityForm[key] ?? '') !== (identity[key] ?? ''));

  async function saveIdentity(e: FormEvent) {
    e.preventDefault();
    if (!identityForm) return;
    setIdentityBusy(true);
    try {
      // Empty string clears a field; every key is always sent.
      const body = Object.fromEntries(IDENTITY_FIELDS.map(({ key }) => [key, identityForm[key] ?? '']));
      await api.put('/api/branding', body);
      await refreshBranding();
      setIdentityForm(null); // re-sync from the fresh identity
      toast('success', 'Business identity saved. Receipts, legal pages, footers and SMS now use it.');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setIdentityBusy(false);
    }
  }

  async function savePaybill(e: FormEvent) {
    e.preventDefault();
    setPaybillBusy(true);
    try {
      await api.put('/api/branding', {
        paybillNumber: paybillNumber.trim(),
        paybillName: paybillName.trim(),
        paybillInstructions: paybillInstructions.trim(),
        paybillEnabled,
      });
      await refreshBranding();
      toast('success', 'PayBill instructions saved.');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setPaybillBusy(false);
    }
  }

  const canEdit = user?.role === 'ADMIN' || user?.role === 'PROPERTY_MANAGER';
  const canEditIdentity = user?.role === 'ADMIN' || user?.role === 'PROPERTY_MANAGER';
  const plateStatus = identity?.fieldStatus ?? [];

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Settings"
        subtitle="Central configuration — the reporting year drives every report, and the water rate drives every water bill"
      />
      {!canEdit && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your role (STAFF) can view settings but not change them.
        </div>
      )}
      <form onSubmit={save} className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <Field label="Reporting Year" hint="Dashboard, monthly reports, arrears and charts all follow this year.">
          <TextInput type="number" min={2000} max={2100} value={reportingYear} onChange={(e) => setReportingYear(Number(e.target.value))} disabled={!canEdit} />
        </Field>
        <Field label="Currency">
          <TextInput value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Water Rate (per water unit)" hint="Every water bill is Consumption × this rate. Changing it affects all new bills.">
          <TextInput type="number" min={0} step={0.5} value={waterRate} onChange={(e) => setWaterRate(Number(e.target.value))} disabled={!canEdit} />
        </Field>
        <Field
          label="Data Retention (years after move-out)"
          hint="Moved-out tenants are automatically anonymised this many years after their last payment (or their move-out date if none). Set 0 to disable the sweep. Every anonymisation is logged in the privacy register."
        >
          <TextInput type="number" min={0} max={30} value={retentionYears} onChange={(e) => setRetentionYears(Number(e.target.value))} disabled={!canEdit} />
        </Field>
        {canEdit && (
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Settings'}</Button>
        )}
      </form>

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-300 bg-gradient-to-b from-amber-50/80 to-white shadow-sm">
        {/* Building-plate header: brushed-brass nameplate with the monogram. */}
        <div className="flex items-center gap-3 border-b border-amber-200/70 bg-gradient-to-r from-amber-100/60 via-amber-50/40 to-transparent px-5 py-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-300/80 bg-white font-bold text-brand-700 shadow-inner">
            {identity?.brandInitials ?? branding.appName.slice(0, 2)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold tracking-wide text-gray-900">
              {identity?.legalName ?? branding.appName}
            </div>
            <div className="text-[11px] text-gray-500">
              Business identity plate — {identity?.missingCount === 0 ? 'complete' : `${identity?.missingCount ?? '…'} field${identity?.missingCount === 1 ? '' : 's'} still missing`}
              {' · '}
              <span title="When the business identity and policy details were last updated">Last updated: {lastUpdatedDisplay}</span>
            </div>
          </div>
        </div>
        <ul className="divide-y divide-gray-100 px-5 py-1">
          {plateStatus.map(({ label, value, filled }) => (
            <li key={label} className="flex items-baseline gap-3 py-2 text-sm">
              {filled ? (
                <CheckCircle2 size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 self-center text-emerald-600" aria-hidden />
              ) : (
                <CircleDashed size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 self-center text-gray-400" aria-hidden />
              )}
              <span className="w-52 shrink-0 text-gray-600" title={label}>{label}</span>
              {filled ? (
                <span className="min-w-0 truncate font-medium text-gray-900" title={value}>{value}</span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">still missing</span>
              )}
            </li>
          ))}
          {plateStatus.length === 0 && (
            <li className="py-3"><Skeleton className="h-4 w-48" /></li>
          )}
        </ul>
      </div>

      {canEditIdentity && (
        <form onSubmit={saveIdentity} className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Edit business identity</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">
            These details appear on legal pages, printed and PDF receipts, SMS/email receipts, footers and the favicon.
            Clear a field to hide it everywhere until it is filled again.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {IDENTITY_FIELDS.map(({ key, label, placeholder, wide }) => (
              <div key={key} className={wide ? 'sm:col-span-2' : undefined}>
                <Field label={label}>
                  <TextInput
                    value={identityForm?.[key] ?? ''}
                    placeholder={placeholder}
                    onChange={(e) => setIdentityForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
                    disabled={identityBusy}
                  />
                </Field>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" disabled={identityBusy || !identityDirty}>
              {identityBusy ? 'Saving…' : 'Save Identity'}
            </Button>
            {identityDirty && (
              <Button
                type="button"
                variant="secondary"
                disabled={identityBusy}
                onClick={() => identity && setIdentityForm(formFromIdentity(identity))}
              >
                Reset
              </Button>
            )}
            <span className="text-xs text-gray-400" aria-live="polite">
              {identityDirty ? 'Unsaved changes' : identity ? 'All changes saved' : ''}
            </span>
          </div>
        </form>
      )}

      {canEditIdentity && (
        <form onSubmit={savePaybill} className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Tenant PayBill</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">One landlord PayBill for all tenants. Rent uses the unit number; water uses the unit number followed by <b>-WATER</b>.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="PayBill number" hint="Digits only, 5 to 10 digits.">
              <TextInput value={paybillNumber} inputMode="numeric" pattern="[0-9]{5,10}" onChange={(e) => setPaybillNumber(e.target.value)} disabled={paybillBusy} />
            </Field>
            <Field label="PayBill business name">
              <TextInput value={paybillName} onChange={(e) => setPaybillName(e.target.value)} disabled={paybillBusy} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Tenant-facing instructions">
                <TextInput value={paybillInstructions} onChange={(e) => setPaybillInstructions(e.target.value)} disabled={paybillBusy} placeholder="e.g. Use A-204 for rent or A-204-WATER for water." />
              </Field>
            </div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={paybillEnabled} onChange={(e) => setPaybillEnabled(e.target.checked)} disabled={paybillBusy} />
            Show PayBill instructions in the tenant portal
          </label>
          <div className="mt-4"><Button type="submit" disabled={paybillBusy}>{paybillBusy ? 'Saving…' : 'Save PayBill'}</Button></div>
        </form>
      )}

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-900">Reference values</h2>
        <div className="grid grid-cols-1 gap-4 text-sm text-gray-600 sm:grid-cols-3">
          <div>
            <div className="mb-1 font-medium text-gray-800">Payment Methods</div>
            <ul className="list-inside list-disc">
              {['CASH', 'M_PESA', 'BANK', 'OTHER'].map((m) => <li key={m}>{methodLabel(m)}</li>)}
            </ul>
          </div>
          <div>
            <div className="mb-1 font-medium text-gray-800">Occupancy Status</div>
            <ul className="list-inside list-disc">
              <li>OCCUPIED</li>
              <li>VACANT</li>
            </ul>
          </div>
          <div>
            <div className="mb-1 font-medium text-gray-800">Payment Status (automatic)</div>
            <ul className="list-inside list-disc">
              <li>PAID — paid = expected</li>
              <li>PARTIAL — 0 &lt; paid &lt; expected</li>
              <li>UNPAID — paid = 0</li>
              <li>OVERPAID — paid &gt; expected</li>
            </ul>
          </div>
        </div>
        <p className="mt-4 text-xs text-gray-400">
          Statuses are always calculated from transaction data — they are never entered manually.
        </p>
      </div>
    </div>
  );
}
