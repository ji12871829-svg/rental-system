// Server-side rendering of the data-request response letter as EMAIL HTML
// (inline styles — email clients strip <style> blocks). The same letter the
// frontend previews/prints, formatted for an email body; the machine-readable
// data file rides along as the attachment.
import type { DataRequestLetter } from '../services/privacyService';

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (value: number): string =>
  `KSh ${value.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** The JSON enclosure filename — shared by the route, the email and the UI. */
export function dataEnclosureName(tenantId: number): string {
  return `tenant-${tenantId}-personal-data.json`;
}

export interface DataLetterEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderDataLetterEmail(letter: DataRequestLetter): DataLetterEmail {
  const { branding, bundle, summary, registerRef, generatedAt, responseDays } = letter;
  const subject = bundle.subject as Record<string, unknown>;
  const name = String(subject.full_name ?? 'the data subject');
  const privacyContact = branding.privacy_email ?? branding.contact_email ?? null;
  const deadline = responseDays ?? '30';

  const summaryRows: [string, number, string | null][] = [
    ['Rent payments', summary.rentPayments.count, money(summary.rentPayments.total)],
    ['Water payments', summary.waterPayments.count, money(summary.waterPayments.total)],
    ['Water meter readings', summary.waterReadings.count, money(summary.waterReadings.total)],
    ['Receipts issued', summary.receipts.count, money(summary.receipts.total)],
    ['SMS messages sent', summary.smsNotifications.count, null],
    ['Audit trail entries', summary.auditTrail.count, null],
  ];

  const td = 'padding:6px 10px;border:1px solid #e5e7eb;font-size:13px;vertical-align:top;';
  const th = `${td}background:#f3f4f6;text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:0.03em;`;

  const html = `
<div style="max-width:640px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;color:#111827;font-size:14px;line-height:1.55;">
  <div style="border-bottom:2px solid #111827;padding-bottom:10px;margin-bottom:20px;font-family:Arial,Helvetica,sans-serif;">
    <div style="font-size:16px;font-weight:700;">${esc(branding.legal_name ?? 'the operator')}</div>
    <div style="color:#6b7280;font-size:12px;margin-top:3px;">
      ${[branding.address, branding.contact_phone, branding.contact_email].filter(Boolean).map(esc).join(' &middot; ')}
      ${branding.privacy_email ? `<div>Privacy contact: ${esc(branding.privacy_email)}</div>` : ''}
    </div>
  </div>

  <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;"><strong>Response to your personal-data request</strong></p>
  <p style="margin:0 0 16px;color:#6b7280;font-size:12.5px;font-family:Arial,Helvetica,sans-serif;">Our ref: ${esc(registerRef)} &middot; Dated ${esc(fmtDate(generatedAt))}</p>

  <p>Dear ${esc(name)},</p>

  <p>We refer to your request for access to the personal data we hold about you. This email contains our
  formal response together with a machine-readable copy of the data (<strong>${esc(dataEnclosureName(Number(subject.id ?? 0)))}</strong>)
  attached. A printable copy of this letter is available on request.</p>

  <p>This response is provided under the Data Protection Act, 2019 (Kenya) and, where applicable, the General
  Data Protection Regulation (EU) 2016/679. Data-subject requests are answered within ${esc(deadline)} days of
  receipt, as stated in our Privacy Policy.</p>

  <p style="margin:16px 0 6px;font-family:Arial,Helvetica,sans-serif;font-weight:700;">Summary of the data provided</p>
  <table style="border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif;">
    <thead><tr><th style="${th}">Category</th><th style="${th}">Records</th><th style="${th}">Total</th></tr></thead>
    <tbody>
      ${summaryRows
        .map(
          ([label, count, total]) =>
            `<tr><td style="${td}">${esc(label)}</td><td style="${td}">${count}</td><td style="${td}">${total ?? '—'}</td></tr>`
        )
        .join('')}
    </tbody>
  </table>

  <p style="margin-top:14px;color:#6b7280;font-size:12.5px;">${esc(String(bundle.retentionNote))}</p>

  <p>If you believe any data is inaccurate, or you wish to exercise any other data-subject right, please contact
  ${privacyContact ? `<a href="mailto:${esc(privacyContact)}" style="color:#2563eb;">${esc(privacyContact)}</a>` : 'the property office'}.</p>

  <p style="margin-top:26px;">Yours faithfully,<br><span style="color:#6b7280;font-size:12.5px;">For and on behalf of ${esc(branding.legal_name ?? 'the operator')}</span></p>
</div>`;

  const text = [
    `Dear ${name},`,
    '',
    'We refer to your request for access to the personal data we hold about you.',
    'The complete machine-readable copy of the data is attached to this email',
    `(${dataEnclosureName(Number(subject.id ?? 0))}).`,
    '',
    `Our reference: ${registerRef}`,
    `Summary: rent payments ${summary.rentPayments.count}, water payments ${summary.waterPayments.count},`,
    `receipts ${summary.receipts.count}, SMS messages ${summary.smsNotifications.count}.`,
    '',
    'This response is provided under the Data Protection Act, 2019 (Kenya) and, where',
    'applicable, the General Data Protection Regulation (EU) 2016/679.',
    privacyContact ? `Contact: ${privacyContact}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject: `Response to your personal-data request — ref ${registerRef}`, html, text };
}
