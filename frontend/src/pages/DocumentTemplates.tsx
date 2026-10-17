// Document templates — free public library of the five letters a Kenyan
// landlord reaches for most: rent increase, payment receipt, demand notice,
// invoice and eviction notice. Fill blanks, print or save as PDF, share on
// WhatsApp. Pure template builders are unit-tested; the page holds the form.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Field, PageHeader, TextInput } from '../components/ui';
import { useBranding } from '../lib/BrandingContext';

export type TemplateKind = 'RENT_INCREASE' | 'RECEIPT' | 'DEMAND' | 'INVOICE' | 'EVICTION';

export interface TemplateFields {
  landlord: string;
  tenant: string;
  unit: string;
  property: string;
  amount: string;
  date: string;
  extra: string;
}

const esc = (v: string): string =>
  v.trim()
    ? v.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : '________________';

export const TEMPLATE_META: { kind: TemplateKind; title: string; blurb: string }[] = [
  { kind: 'RENT_INCREASE', title: 'Notice of rent increase', blurb: 'One calendar month notice with the new amount and effective date.' },
  { kind: 'RECEIPT', title: 'Rent receipt', blurb: 'Hand-written-style receipt for cash or bank payments.' },
  { kind: 'DEMAND', title: 'Demand / overdue notice', blurb: 'Firm reminder stating what is owed and by when.' },
  { kind: 'INVOICE', title: 'Tenant invoice', blurb: 'Bill rent, water or arrears with a payment deadline.' },
  { kind: 'EVICTION', title: 'Notice to vacate', blurb: 'Termination notice with the vacate date and handover notes.' },
];

export function buildTemplate(kind: TemplateKind, f: TemplateFields): { title: string; body: string } {
  const head = (t: string) => `<h1 style="font-size:18px;text-align:center">${t}</h1>`;
  const sig = `<p style="margin-top:32px">Yours faithfully,<br><br>________________<br>${esc(f.landlord)}<br>Date: ${esc(f.date)}</p>`;
  const open = `<p>Dear ${esc(f.tenant)},<br>Re: Unit ${esc(f.unit)}, ${esc(f.property)}</p>`;
  switch (kind) {
    case 'RENT_INCREASE':
      return { title: 'Notice of rent increase', body: `${head('NOTICE OF RENT INCREASE')}${open}<p>Please note that the monthly rent for the above unit will increase from KES ${esc(f.amount)} as stated below, effective ${esc(f.extra) || 'one calendar month from the date of this notice'}.</p><p>All other tenancy terms remain unchanged. Contact us with any questions.</p>${sig}` };
    case 'RECEIPT':
      return { title: 'Rent receipt', body: `${head('RENT RECEIPT')}<p>Received from <strong>${esc(f.tenant)}</strong> (Unit ${esc(f.unit)}, ${esc(f.property)}) the sum of <strong>KES ${esc(f.amount)}</strong>${f.extra.trim() ? `, being ${esc(f.extra)}` : ''}, on ${esc(f.date)}.</p><p>Received by: ________________ &nbsp; Signature: __________</p>${sig}` };
    case 'DEMAND':
      return { title: 'Demand notice', body: `${head('DEMAND NOTICE — OVERDUE RENT')}${open}<p>Our records show an outstanding balance of <strong>KES ${esc(f.amount)}</strong>${f.extra.trim() ? ` (${esc(f.extra)})` : ''} as at ${esc(f.date)}.</p><p>Kindly clear the balance within seven (7) days of this notice to avoid further action. If you have already paid, please share proof of payment.</p>${sig}` };
    case 'INVOICE':
      return { title: 'Tenant invoice', body: `${head('TENANT INVOICE')}${open}<p>You are hereby billed <strong>KES ${esc(f.amount)}</strong>${f.extra.trim() ? ` for ${esc(f.extra)}` : ''}, payable on or before ${esc(f.date)}.</p><p>Pay via M-Pesa or bank and keep your receipt for reconciliation.</p>${sig}` };
    case 'EVICTION':
      return { title: 'Notice to vacate', body: `${head('NOTICE TO VACATE')}${open}<p>Take notice that your tenancy of the above unit is terminated, and you are required to vacate and hand over vacant possession on or before <strong>${esc(f.extra) || esc(f.date)}</strong>.</p><p>Please clear any outstanding balance and return all keys on handover. Deposit refund, if any, follows inspection within 30 days.</p>${sig}` };
  }
}

export default function DocumentTemplates() {
  const { legalNameDisplay } = useBranding();
  const [kind, setKind] = useState<TemplateKind>('RENT_INCREASE');
  const [form, setForm] = useState<TemplateFields>({ landlord: '', tenant: '', unit: '', property: 'Olbano Plaza', amount: '', date: new Date().toISOString().slice(0, 10), extra: '' });

  const doc = useMemo(() => buildTemplate(kind, form), [kind, form]);
  const set = (k: keyof TemplateFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/landing" className="text-sm font-bold text-gray-900">Olbano Plaza</Link>
          <Link to="/login" className="text-sm font-medium text-brand-600 hover:text-brand-700">Sign in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader title="Free Landlord Letter Templates" subtitle="Fill the blanks, print or save as PDF — no signup" />
        <div className="mb-4 flex flex-wrap gap-2">
          {TEMPLATE_META.map((t) => (
            <button
              key={t.kind}
              type="button"
              onClick={() => setKind(t.kind)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${kind === t.kind ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {t.title}
            </button>
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Landlord (defaults to business)">
                <TextInput value={form.landlord} onChange={set('landlord')} placeholder={legalNameDisplay ?? 'Landlord name'} />
              </Field>
              <Field label="Tenant">
                <TextInput value={form.tenant} onChange={set('tenant')} placeholder="Tenant name" />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Unit">
                <TextInput value={form.unit} onChange={set('unit')} placeholder="12" />
              </Field>
              <Field label="Property">
                <TextInput value={form.property} onChange={set('property')} placeholder="Olbano Plaza" />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount (KES)">
                <TextInput type="number" min="0" value={form.amount} onChange={set('amount')} placeholder="15000" />
              </Field>
              <Field label="Date">
                <TextInput type="date" value={form.date} onChange={set('date')} />
              </Field>
            </div>
            <Field label="Details (effective date, period, purpose)" hint="Used by increase (effective date), demand/invoice (period), eviction (vacate date).">
              <TextInput value={form.extra} onChange={set('extra')} placeholder="e.g. January 2027" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => window.print()}>Print / Save PDF</Button>
              <Link to="/estimator" className="text-xs font-medium text-brand-600 hover:text-brand-700 self-center">Cost estimator →</Link>
            </div>
            <p className="text-[11px] text-gray-500">General templates only — not legal advice. Have an advocate review eviction and increase notices before serving.</p>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{doc.title}</div>
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 14, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: doc.body }} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
