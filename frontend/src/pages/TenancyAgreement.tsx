// Tenancy Agreement Generator — Bomahut-inspired free tool, wired to live RPMS data.
//
// Frontend-only: pulls tenants/units from the existing list endpoints, prefills
// the form, renders a live Kenya-style periodic-tenancy preview, and reuses the
// existing Document Vault upload endpoint to file the result. No backend or
// schema changes — printing uses the browser's print-to-PDF dialog.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Field, PageHeader, Select, TextInput, useFetch, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useBranding } from '../lib/BrandingContext';

export interface AgreementForm {
  landlordName: string;
  landlordIdNumber: string;
  landlordPhone: string;
  tenantName: string;
  tenantIdNumber: string;
  tenantPhone: string;
  propertyName: string;
  unitNumber: string;
  monthlyRent: string;
  deposit: string;
  startDate: string;
  paybill: string;
  noticeMonths: string;
}

interface TenantOption {
  id: number;
  full_name: string;
  phone_number: string | null;
  email: string | null;
  unit_number?: string | null;
  monthly_rent?: string | null;
  security_deposit?: string | null;
  unit_id?: number | null;
}

interface UnitOption {
  id: number;
  unit_number: string;
  property_name?: string | null;
  monthly_rent?: string | null;
}

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const blank = (v: string, fallback = '________________'): string => (v.trim() ? esc(v.trim()) : fallback);

// Pure builder — unit-tested without rendering. Produces a standalone printable
// HTML document (general template, not legal advice — same disclaimer as the
// reference tool).
export function buildAgreementHtml(f: AgreementForm, businessName: string | null): string {
  const operator = f.landlordName.trim() ? esc(f.landlordName.trim()) : esc(businessName ?? 'The Landlord');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Residential Tenancy Agreement</title>` +
    `<style>body{font-family:Georgia,serif;max-width:720px;margin:32px auto;padding:0 20px;color:#111;line-height:1.6}` +
    `h1{font-size:20px;text-align:center}h2{font-size:14px;margin-top:24px}.sig{margin-top:32px;display:flex;gap:40px}` +
    `.sig div{flex:1;border-top:1px solid #333;padding-top:8px;font-size:12px}.note{font-size:11px;color:#555;margin-top:24px;border-top:1px solid #ccc;padding-top:12px}</style></head><body>` +
    `<h1>RESIDENTIAL TENANCY AGREEMENT</h1>` +
    `<p>This agreement is made on ${blank(f.startDate)} between ${operator}` +
    `${f.landlordIdNumber.trim() ? `, ID/Passport ${esc(f.landlordIdNumber.trim())}` : ''}` +
    `${f.landlordPhone.trim() ? `, tel ${esc(f.landlordPhone.trim())}` : ''} (the "Landlord") ` +
    `and ${blank(f.tenantName)}` +
    `${f.tenantIdNumber.trim() ? `, ID/Passport ${esc(f.tenantIdNumber.trim())}` : ''}` +
    `${f.tenantPhone.trim() ? `, tel ${esc(f.tenantPhone.trim())}` : ''} (the "Tenant").</p>` +
    `<h2>1. Premises</h2><p>The Landlord lets unit ${blank(f.unitNumber)} at ${blank(f.propertyName)} for use as a private residence only.</p>` +
    `<h2>2. Term</h2><p>A periodic monthly tenancy commencing ${blank(f.startDate)}, continuing month to month until terminated on not less than ` +
    `${blank(f.noticeMonths, 'one (1) calendar month')} written notice expiring at the end of a rent period.</p>` +
    `<h2>3. Rent</h2><p>KES ${blank(f.monthlyRent)} per month, payable in advance` +
    `${f.paybill.trim() ? ` via M-Pesa Paybill ${esc(f.paybill.trim())}` : ''}. Late payment may attract the late fee published in the building.</p>` +
    `<h2>4. Deposit</h2><p>Refundable security deposit of KES ${blank(f.deposit)}. Held against unpaid rent, damage beyond fair wear and tear, and ` +
    `outstanding utilities. Refunded within 30 days of vacating, less lawful deductions itemised in writing.</p>` +
    `<h2>5. Utilities</h2><p>The Tenant pays electricity, water, internet and any service charge promptly as they fall due.</p>` +
    `<h2>6. Obligations</h2><p>Landlord: quiet enjoyment, structural repair, 48-hour inspection notice except emergencies. ` +
    `Tenant: pay on time, keep the interior tenantable, no alterations or subletting without written consent, report defects promptly.</p>` +
    `<h2>7. Governing law</h2><p>The laws of the Republic of Kenya. Disputes first negotiated in good faith, then mediation or a competent court/Tribunal.</p>` +
    `<div class="sig"><div>Signed by the Landlord<br>Name: ${operator}<br><br>Signature: __________ Date: __________</div>` +
    `<div>Signed by the Tenant<br>Name: ${blank(f.tenantName)}<br><br>Signature: __________ Date: __________</div></div>` +
    `<p class="note">General template only — not legal advice. Have an advocate review before signing, especially for high-value lettings.</p>` +
    `</body></html>`;
}

export function toBase64Utf8(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

export default function TenancyAgreement() {
  const { toast } = useToast();
  const { legalNameDisplay, identity } = useBranding();
  const [tenantSelect, setTenantSelect] = useState('');
  const [unitSelect, setUnitSelect] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AgreementForm>({
    landlordName: '',
    landlordIdNumber: '',
    landlordPhone: '',
    tenantName: '',
    tenantIdNumber: '',
    tenantPhone: '',
    propertyName: '',
    unitNumber: '',
    monthlyRent: '',
    deposit: '',
    startDate: todayIso(),
    paybill: '',
    noticeMonths: 'one (1) calendar month',
  });

  const { data: tenantsResponse } = useFetch(() => api.list<TenantOption>('/api/tenants?limit=200'), []);
  const { data: unitsResponse } = useFetch(() => api.list<UnitOption>('/api/units?limit=200'), []);
  const tenants = useMemo(() => tenantsResponse?.data ?? [], [tenantsResponse]);
  const units = useMemo(() => unitsResponse?.data ?? [], [unitsResponse]);

  const set = (k: keyof AgreementForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function pickTenant(id: string) {
    setTenantSelect(id);
    const t = tenants.find((x) => String(x.id) === id);
    if (!t) return;
    setForm((f) => ({
      ...f,
      tenantName: t.full_name,
      tenantPhone: t.phone_number ?? f.tenantPhone,
      unitNumber: (t.unit_number as string | null) ?? f.unitNumber,
      monthlyRent: (t.monthly_rent as string | null) ?? f.monthlyRent,
      deposit: (t.security_deposit as string | null) ?? f.deposit,
    }));
    if (t.unit_id != null) setUnitSelect(String(t.unit_id));
  }

  function pickUnit(id: string) {
    setUnitSelect(id);
    const u = units.find((x) => String(x.id) === id);
    if (!u) return;
    setForm((f) => ({
      ...f,
      unitNumber: u.unit_number,
      propertyName: (u.property_name as string | null) ?? f.propertyName,
      monthlyRent: (u.monthly_rent as string | null) ?? f.monthlyRent,
    }));
  }

  const html = useMemo(
    () => buildAgreementHtml(form, legalNameDisplay ?? identity?.legal_name ?? null),
    [form, legalNameDisplay, identity]
  );

  function print() {
    window.print();
  }

  function download() {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tenancy-agreement-${form.unitNumber.trim() || 'unit'}-${form.startDate}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveToVault() {
    if (busy) return;
    if (!tenantSelect && !unitSelect) {
      toast('error', 'Pick a tenant or unit first — the vault files every document against one.');
      return;
    }
    if (form.tenantName.trim().length < 2) {
      toast('error', 'Add the tenant name before filing.');
      return;
    }
    setBusy(true);
    try {
      const name = `Tenancy agreement — ${form.tenantName.trim()}${form.unitNumber.trim() ? `, Unit ${form.unitNumber.trim()}` : ''}`;
      await api.post('/api/documents', {
        title: name,
        docType: 'LEASE_AGREEMENT',
        tenantId: tenantSelect ? Number(tenantSelect) : undefined,
        unitId: !tenantSelect && unitSelect ? Number(unitSelect) : undefined,
        fileName: `tenancy-agreement-${Date.now()}.html`,
        mimeType: 'text/html',
        contentBase64: toBase64Utf8(html),
      });
      toast('success', 'Filed in the Document Vault as a lease agreement.');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const waText = encodeURIComponent('Create a tenancy agreement with our free generator: ');
  const waUrl = typeof window !== 'undefined' ? encodeURIComponent(window.location.href) : '';

  return (
    <div>
      <PageHeader
        title="Tenancy Agreement Generator"
        subtitle="Prefill from tenants & units, preview live, print to PDF or file in the vault"
        actions={<Link to="/documents" className="text-xs text-brand-600 hover:text-brand-700">Back to Document Vault</Link>}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3 print:hidden">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tenant (prefills name, phone, rent)">
              <Select value={tenantSelect} onChange={(e) => pickTenant(e.target.value)}>
                <option value="">— pick tenant —</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.full_name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Unit (prefills rent, property)">
              <Select value={unitSelect} onChange={(e) => pickUnit(e.target.value)}>
                <option value="">— pick unit —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>Unit {u.unit_number}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Landlord name (defaults to business identity)">
              <TextInput value={form.landlordName} onChange={set('landlordName')} placeholder={legalNameDisplay ?? 'e.g. Jane Wanjiru'} />
            </Field>
            <Field label="Landlord ID / passport">
              <TextInput value={form.landlordIdNumber} onChange={set('landlordIdNumber')} placeholder="e.g. 12345678" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Landlord phone">
              <TextInput value={form.landlordPhone} onChange={set('landlordPhone')} placeholder="+254…" />
            </Field>
            <Field label="Tenant name">
              <TextInput value={form.tenantName} onChange={set('tenantName')} placeholder="e.g. John Mwangi" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tenant ID / passport">
              <TextInput value={form.tenantIdNumber} onChange={set('tenantIdNumber')} placeholder="e.g. 87654321" />
            </Field>
            <Field label="Tenant phone">
              <TextInput value={form.tenantPhone} onChange={set('tenantPhone')} placeholder="+254…" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Property">
              <TextInput value={form.propertyName} onChange={set('propertyName')} placeholder="e.g. Olbano Plaza" />
            </Field>
            <Field label="Unit">
              <TextInput value={form.unitNumber} onChange={set('unitNumber')} placeholder="e.g. 12" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Monthly rent (KES)">
              <TextInput type="number" min="0" value={form.monthlyRent} onChange={set('monthlyRent')} placeholder="15000" />
            </Field>
            <Field label="Deposit (KES)">
              <TextInput type="number" min="0" value={form.deposit} onChange={set('deposit')} placeholder="15000" />
            </Field>
            <Field label="Start date">
              <TextInput type="date" value={form.startDate} onChange={set('startDate')} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="M-Pesa Paybill (optional)">
              <TextInput value={form.paybill} onChange={set('paybill')} placeholder="e.g. 522522" />
            </Field>
            <Field label="Notice period">
              <TextInput value={form.noticeMonths} onChange={set('noticeMonths')} placeholder="one (1) calendar month" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={print}>Print / Save PDF</Button>
            <Button variant="ghost" onClick={download}>Download HTML</Button>
            <Button variant="ghost" loading={busy} onClick={saveToVault}>File in Vault</Button>
            <a
              className="inline-flex items-center rounded-xl px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
              href={`https://wa.me/?text=${waText}${waUrl}`}
              target="_blank"
              rel="noreferrer"
            >
              Share on WhatsApp
            </a>
          </div>
          <p className="text-[11px] text-gray-500">General template only — not legal advice. Have an advocate review before signing.</p>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 print:hidden">Live preview</div>
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div dangerouslySetInnerHTML={{ __html: html.replace(/^<!doctype html><html><head>.*<\/head><body>/s, '').replace(/<\/body><\/html>$/, '') }} />
          </div>
        </div>
      </div>
    </div>
  );
}
