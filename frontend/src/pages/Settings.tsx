import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleDashed, ImageUp, Trash2 } from 'lucide-react';
import { Button, Field, PageHeader, Skeleton, TextInput, useFetch, useShake, useToast } from '../components/ui';
import { BrandLogo } from '../components/BrandLogo';
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

// Email provider mode (from GET /api/emails/config) and the test-send verdict.
interface EmailConfigView {
  provider: string;
  live: boolean;
  from: string | null;
  autoSend: boolean;
}

interface TestEmailResultView {
  ok: boolean;
  provider: string;
  live: boolean;
  from: string | null;
  to: string;
  providerMessageId?: string;
  failureReason?: string;
  latencyMs: number;
}

interface SmsConfigView {
  provider: string;
  live: boolean;
  senderId?: string;
  autoSend: boolean;
}

interface SmsBalanceView {
  state: 'unknown' | 'unavailable' | 'ok' | 'low' | 'empty';
  reason?: string;
  balance?: { amount: number; currency: string };
  threshold?: number | null;
}

interface TestSmsResultView {
  ok: boolean;
  provider: string;
  live: boolean;
  to: string;
  senderId?: string;
  providerMessageId?: string;
  failureReason?: string;
  cost?: { amount: number; currency: string };
  latencyMs: number;
}

// The 12 editable identity fields, grouped the way they appear on the plate.
// maxLength mirrors the backend's column limits (branding route zod schema)
// so over-typing is prevented client-side; type 'email' opts into format
// validation. Every field is optional — clearing hides it everywhere.
const IDENTITY_FIELDS: {
  key: keyof Pick<BrandingView,
    | 'legalName' | 'registrationNumber' | 'address' | 'contactEmail'
    | 'privacyEmail' | 'contactPhone' | 'retentionPeriod' | 'responseDays'
    | 'jurisdiction' | 'propertyScope' | 'paymentChannels' | 'refundWindowDays'>;
  label: string;
  placeholder: string;
  hint: string;
  maxLength: number;
  type?: 'email';
  wide?: boolean;
}[] = [
  { key: 'legalName', label: 'Company legal name', placeholder: 'e.g. Olbano Property Management Ltd', maxLength: 200, hint: 'Shown on receipts, legal pages and footers — also drives the monogram initials.' },
  { key: 'registrationNumber', label: 'Registration number', placeholder: 'e.g. BN-2026-123456', maxLength: 100, hint: 'Printed with the legal name on receipts and legal pages.' },
  { key: 'address', label: 'Business address', placeholder: 'e.g. P.O. Box 123, Nairobi', maxLength: 500, hint: 'Physical or postal address for the receipt footer and legal pages.', wide: true },
  { key: 'contactPhone', label: 'Phone number', placeholder: 'e.g. +254 700 000 000', maxLength: 60, hint: 'Include the country code — it becomes a tap-to-call link on PDF receipts.' },
  { key: 'contactEmail', label: 'General queries email', placeholder: 'e.g. info@example.com', maxLength: 255, type: 'email', hint: 'Tenant questions go here; also the fallback sender for receipt emails.' },
  { key: 'privacyEmail', label: 'Privacy email', placeholder: 'e.g. privacy@example.com — or the general one', maxLength: 255, type: 'email', hint: 'Data-protection requests go here. Left empty, the general email is used.' },
  { key: 'retentionPeriod', label: 'Record retention period', placeholder: 'e.g. 7 years', maxLength: 100, hint: 'How long records are kept after move-out, as it should read on legal pages.' },
  { key: 'responseDays', label: 'Privacy request response days', placeholder: 'e.g. 30', maxLength: 20, hint: 'Number of days allowed to answer a data request.' },
  { key: 'jurisdiction', label: 'Governing law jurisdiction', placeholder: 'e.g. Kenya', maxLength: 100, hint: 'Named as the governing law in the Terms & Conditions.' },
  { key: 'propertyScope', label: 'Property (refund policy)', placeholder: 'e.g. Olbano Apartments, 123 Riverside Drive, Nairobi', maxLength: 500, hint: 'Property name and address covered by the refund policy.', wide: true },
  { key: 'paymentChannels', label: 'Payment channels (refund policy)', placeholder: 'e.g. M-Pesa, cash or bank transfer', maxLength: 200, hint: 'Channels the refund policy names as refundable.', wide: true },
  { key: 'refundWindowDays', label: 'Refund processing window', placeholder: 'e.g. 7–14 days', maxLength: 40, hint: 'How long a refund takes, as it should read on the refund policy page.' },
];

// Client-side mirror of the backend's validation: email format for the two
// email fields, numeric days for the privacy response window. Empty passes —
// every field is optional (clearing a field hides it, per the form copy).
function identityErrors(form: IdentityForm): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {};
  for (const { key, type, label } of IDENTITY_FIELDS) {
    const value = (form[key] ?? '').trim();
    if (!value) continue;
    if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[key] = `${label}: enter a valid email address, e.g. name@example.com.`;
    }
    if (key === 'responseDays' && !/^\d+$/.test(value)) {
      errors[key] = 'Privacy request response days: enter a number of days, e.g. 30.';
    }
  }
  return errors;
}

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
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [shakeFormRef, shakeForm] = useShake<HTMLFormElement>();

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
      // Inline form stays mounted: show the drawn checkmark for a beat.
      setSettingsSaved(true);
      window.setTimeout(() => setSettingsSaved(false), 1200);
    } catch (err) {
      toast('error', (err as Error).message);
      shakeForm();
    } finally {
      setBusy(false);
    }
  }

  // --- Business identity (DB-backed, editable here) --------------------------
  const [identityForm, setIdentityForm] = useState<IdentityForm | null>(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identitySaved, setIdentitySaved] = useState(false);
  const [shakeIdentityRef, shakeIdentity] = useShake<HTMLFormElement>();
  // --- Logo upload -----------------------------------------------------------
  const [logoBusy, setLogoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  // --- Email provider self-test ----------------------------------------------
  const { data: emailCfg, refresh: refreshEmailCfg } = useFetch<EmailConfigView>(() => api.get<{ data: EmailConfigView }>('/api/emails/config').then((r) => r.data));
  const [testTo, setTestTo] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<TestEmailResultView | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  // --- SMS provider self-test -------------------------------------------------
  const { data: smsCfg, refresh: refreshSmsCfg } = useFetch<SmsConfigView>(() => api.get<{ data: SmsConfigView }>('/api/sms/config').then((r) => r.data));
  const { data: smsBalance, refresh: refreshSmsBalance } = useFetch<SmsBalanceView>(() => api.get<{ data: SmsBalanceView }>('/api/sms/balance').then((r) => r.data));
  const [smsTo, setSmsTo] = useState('');
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsResult, setSmsResult] = useState<TestSmsResultView | null>(null);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [paybillNumber, setPaybillNumber] = useState('');
  const [paybillName, setPaybillName] = useState('');
  const [paybillInstructions, setPaybillInstructions] = useState('');
  const [paybillEnabled, setPaybillEnabled] = useState(false);
  const [paybillBusy, setPaybillBusy] = useState(false);
  const [paybillSaved, setPaybillSaved] = useState(false);
  const [shakePaybillRef, shakePaybill] = useShake<HTMLFormElement>();

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
  const fieldErrors = identityForm ? identityErrors(identityForm) : {};
  const errorCount = Object.keys(fieldErrors).length;
  // Block saving invalid values — the server would reject them anyway; this
  // surfaces why next to the field instead of as a toast.
  const identityValid = errorCount === 0;

  async function saveIdentity(e: FormEvent) {
    e.preventDefault();
    if (!identityForm || !identityValid) return;
    setIdentityBusy(true);
    try {
      // Empty string clears a field; every key is always sent.
      const body = Object.fromEntries(IDENTITY_FIELDS.map(({ key }) => [key, identityForm[key] ?? '']));
      await api.put('/api/branding', body);
      await refreshBranding();
      setIdentityForm(null); // re-sync from the fresh identity
      toast('success', 'Business identity saved. Receipts, legal pages, footers and SMS now use it.');
      setIdentitySaved(true);
      window.setTimeout(() => setIdentitySaved(false), 1200);
    } catch (err) {
      toast('error', (err as Error).message);
      shakeIdentity();
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
      setPaybillSaved(true);
      window.setTimeout(() => setPaybillSaved(false), 1200);
    } catch (err) {
      toast('error', (err as Error).message);
      shakePaybill();
    } finally {
      setPaybillBusy(false);
    }
  }

  // --- Logo upload -----------------------------------------------------------
  const LOGO_MAX_BYTES = 512 * 1024;
  const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

  function toDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    });
  }

  async function handleLogoFile(file: File) {
    setLogoError(null);
    if (!LOGO_TYPES.has(file.type)) {
      setLogoError('Please choose a PNG, JPEG, GIF, WebP or SVG image.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError(`Logo is too large (${Math.round(file.size / 1024)} KB). Maximum is 512 KB.`);
      return;
    }
    setLogoBusy(true);
    try {
      const dataUrl = await toDataUrl(file);
      await api.put('/api/branding/logo', { logo: dataUrl });
      await refreshBranding();
      toast('success', 'Logo uploaded — the app header, portal and receipts now use it.');
    } catch (err) {
      setLogoError((err as Error).message);
    } finally {
      setLogoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    try {
      await api.del('/api/branding/logo');
      await refreshBranding();
      toast('success', 'Logo removed — the monogram tile is back.');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }

  // --- Email provider self-test ----------------------------------------------
  async function sendTestEmail() {
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);
    try {
      // Empty recipient = the server sends to the requesting user's own email.
      const res = await api.post<{ data: TestEmailResultView }>('/api/emails/test', testTo.trim() ? { to: testTo.trim() } : {});
      setTestResult(res.data);
      refreshEmailCfg();
    } catch (err) {
      setTestError((err as Error).message);
    } finally {
      setTestBusy(false);
    }
  }

  // --- SMS provider self-test -------------------------------------------------
  async function sendTestSms() {
    setSmsBusy(true);
    setSmsError(null);
    setSmsResult(null);
    try {
      // Empty recipient = the server sends to the requesting user's own phone.
      const res = await api.post<{ data: TestSmsResultView }>('/api/sms/test', smsTo.trim() ? { to: smsTo.trim() } : {});
      setSmsResult(res.data);
      refreshSmsCfg();
      refreshSmsBalance(); // a live send changes the wallet balance
    } catch (err) {
      setSmsError((err as Error).message);
    } finally {
      setSmsBusy(false);
    }
  }

  // Flattens the balance union once — TS loses both the state narrowing and
  // `balance` presence across the JSX ternary chain otherwise. In the ok/low/
  // empty states the backend always carries `balance` (getSmsBalance).
  const balanceInfo = (() => {
    if (!smsBalance) return null;
    if (smsBalance.state === 'ok' || smsBalance.state === 'low' || smsBalance.state === 'empty') {
      return {
        state: smsBalance.state,
        amount: smsBalance.balance!.amount,
        currency: smsBalance.balance!.currency,
      };
    }
    return null;
  })();

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
      <form ref={shakeFormRef} onSubmit={save} className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
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
          <Button type="submit" disabled={busy} loading={busy} success={settingsSaved}>{settingsSaved ? 'Saved' : 'Save Settings'}</Button>
        )}
      </form>

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-300 bg-gradient-to-b from-amber-50/80 to-white shadow-sm">
        {/* Building-plate header: brushed-brass nameplate with the monogram. */}
        <div className="flex items-center gap-3 border-b border-amber-200/70 bg-gradient-to-r from-amber-100/60 via-amber-50/40 to-transparent px-5 py-3.5">
          <BrandLogo className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-300/80 bg-white font-bold text-brand-700 shadow-inner" iconSize={16} />
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
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Business logo</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">
            Shown in the app header, the tenant portal and on every printed or emailed receipt and report.
            PNG, JPEG, GIF, WebP or SVG — up to 512 KB. A transparent PNG or SVG looks best on receipts.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <BrandLogo
              className="flex h-16 w-16 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-400"
              iconSize={24}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleLogoFile(f);
                }}
              />
              <Button type="button" variant="secondary" disabled={logoBusy} onClick={() => fileInputRef.current?.click()}>
                <span className="flex items-center gap-2">
                  <ImageUp size={16} strokeWidth={1.75} aria-hidden />
                  {identity?.logo_mime_type ? 'Replace logo' : 'Upload logo'}
                </span>
              </Button>
              {identity?.logo_mime_type && (
                <Button type="button" variant="secondary" disabled={logoBusy} loading={logoBusy} onClick={() => void removeLogo()}>
                  <span className="flex items-center gap-2">
                    <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                    Remove
                  </span>
                </Button>
              )}
              {logoBusy && <span className="text-sm text-gray-500">Working…</span>}
            </div>
          </div>
          {logoError && <p className="mt-3 text-sm text-red-700">{logoError}</p>}
        </div>
      )}

      {canEditIdentity && (
        <form noValidate ref={shakeIdentityRef} onSubmit={saveIdentity} className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Edit business identity</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">
            These details appear on legal pages, printed and PDF receipts, SMS/email receipts, footers and the favicon.
            Clear a field to hide it everywhere until it is filled again.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {IDENTITY_FIELDS.map(({ key, label, placeholder, hint, maxLength, type, wide }) => (
              <div key={key} className={wide ? 'sm:col-span-2' : undefined}>
                <Field label={label} hint={hint} error={fieldErrors[key]}>
                  <TextInput
                    type={type}
                    value={identityForm?.[key] ?? ''}
                    placeholder={placeholder}
                    maxLength={maxLength}
                    aria-invalid={fieldErrors[key] ? true : undefined}
                    onChange={(e) => setIdentityForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
                    disabled={identityBusy}
                  />
                </Field>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" disabled={identityBusy || !identityDirty || !identityValid} loading={identityBusy} success={identitySaved}>
              {identityBusy ? 'Saving…' : identitySaved ? 'Saved' : 'Save Identity'}
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
              {identityDirty && !identityValid
                ? `${errorCount} field${errorCount === 1 ? '' : 's'} need${errorCount === 1 ? 's' : ''} fixing`
                : identityDirty
                  ? 'Unsaved changes'
                  : identity
                    ? 'All changes saved'
                    : ''}
            </span>
          </div>
        </form>
      )}

      {canEditIdentity && (
        <form ref={shakePaybillRef} onSubmit={savePaybill} className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
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
          <div className="mt-4"><Button type="submit" disabled={paybillBusy} loading={paybillBusy} success={paybillSaved}>{paybillSaved ? 'Saved' : paybillBusy ? 'Saving…' : 'Save PayBill'}</Button></div>
        </form>
      )}

      {canEditIdentity && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Email provider</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">
            Receipts, statements and portal credentials are sent through this provider. Send a test email to
            verify the configuration end-to-end — the provider's own response is shown below.
          </p>
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
            <span>Provider: <b className="text-gray-900">{emailCfg ? emailCfg.provider : '…'}</b>{emailCfg && <span className={emailCfg.live ? 'text-emerald-700' : 'text-amber-700'}> ({emailCfg.live ? 'live' : 'simulated'})</span>}</span>
            {emailCfg?.from && <span>From: <b className="text-gray-900">{emailCfg.from}</b></span>}
            {emailCfg && <span>Auto-send: <b className="text-gray-900">{emailCfg.autoSend ? 'on' : 'off'}</b></span>}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64">
              <Field label="Send test email to" hint="Leave empty to send to your own user email.">
                <TextInput
                  type="email"
                  value={testTo}
                  placeholder="you@example.com"
                  onChange={(e) => setTestTo(e.target.value)}
                  disabled={testBusy}
                />
              </Field>
            </div>
            <Button type="button" variant="secondary" disabled={testBusy} loading={testBusy} onClick={() => void sendTestEmail()}>
              {testBusy ? 'Sending…' : 'Send test email'}
            </Button>
          </div>
          {testError && <p className="mt-3 text-sm text-red-700">{testError}</p>}
          {testResult && (
            <div
              className={`mt-4 rounded-lg border p-3 text-sm ${
                testResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'
              }`}
              role="status"
            >
              <div className="font-medium">
                {testResult.ok ? '✓ Provider accepted the message' : '✗ Provider rejected the send'}
                <span className="ml-2 font-normal opacity-70">{testResult.latencyMs} ms</span>
              </div>
              <div className="mt-1 font-mono text-xs break-all">
                to: {testResult.to}
                {testResult.from && <> · from: {testResult.from}</>}
              </div>
              {testResult.providerMessageId && (
                <div className="mt-0.5 font-mono text-xs break-all">message id: {testResult.providerMessageId}</div>
              )}
              {testResult.failureReason && (
                <div className="mt-0.5 font-mono text-xs break-all">response: {testResult.failureReason}</div>
              )}
            </div>
          )}
        </div>
      )}

      {canEditIdentity && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">SMS provider</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">
            Receipt SMS and notifications are sent through this provider. Send a test SMS to verify the
            configuration end-to-end — the provider's own response is shown below.
          </p>
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
            <span>Provider: <b className="text-gray-900">{smsCfg ? smsCfg.provider : '…'}</b>{smsCfg && <span className={smsCfg.live ? 'text-emerald-700' : 'text-amber-700'}> ({smsCfg.live ? 'live' : 'simulated'})</span>}</span>
            {smsCfg?.senderId && <span>Sender: <b className="text-gray-900">{smsCfg.senderId}</b></span>}
            {smsCfg && <span>Auto-send: <b className="text-gray-900">{smsCfg.autoSend ? 'on' : 'off'}</b></span>}
            {balanceInfo ? (
              <span>
                Balance: <b className={`text-gray-900 ${balanceInfo.state === 'ok' ? '' : balanceInfo.state === 'low' ? 'text-amber-700' : 'text-red-700'}`}>{balanceInfo.currency} {balanceInfo.amount.toLocaleString()}</b>
                {balanceInfo.state === 'low' && <span className="text-amber-700"> — below the low-balance threshold</span>}
                {balanceInfo.state === 'empty' && <span className="text-red-700"> — empty</span>}
              </span>
            ) : smsBalance?.state === 'unavailable' ? (
              <span className="text-amber-700" title={smsBalance.reason}>Balance: unavailable</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64">
              <Field label="Send test SMS to" hint="Leave empty to send to your own user phone.">
                <TextInput
                  type="tel"
                  value={smsTo}
                  placeholder="e.g. +254 700 000 000"
                  onChange={(e) => setSmsTo(e.target.value)}
                  disabled={smsBusy}
                />
              </Field>
            </div>
            <Button type="button" variant="secondary" disabled={smsBusy} loading={smsBusy} onClick={() => void sendTestSms()}>
              {smsBusy ? 'Sending…' : 'Send test SMS'}
            </Button>
          </div>
          {smsError && <p className="mt-3 text-sm text-red-700">{smsError}</p>}
          {smsResult && (
            <div
              className={`mt-4 rounded-lg border p-3 text-sm ${
                smsResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'
              }`}
              role="status"
            >
              <div className="font-medium">
                {smsResult.ok ? '✓ Provider accepted the message' : '✗ Provider rejected the send'}
                <span className="ml-2 font-normal opacity-70">{smsResult.latencyMs} ms</span>
              </div>
              <div className="mt-1 font-mono text-xs break-all">
                to: {smsResult.to}
                {smsResult.senderId && <> · sender: {smsResult.senderId}</>}
              </div>
              {smsResult.providerMessageId && (
                <div className="mt-0.5 font-mono text-xs break-all">message id: {smsResult.providerMessageId}</div>
              )}
              {smsResult.cost && (
                <div className="mt-0.5 font-mono text-xs">cost: {smsResult.cost.currency} {smsResult.cost.amount}</div>
              )}
              {smsResult.failureReason && (
                <div className="mt-0.5 font-mono text-xs break-all">response: {smsResult.failureReason}</div>
              )}
            </div>
          )}
        </div>
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
