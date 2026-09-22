// Shared receipt document builders (server-side). One source of truth for
// the emailed receipt HTML (sent as the message body AND stored as an
// attachment) and the plain-text fallback. All dynamic values are escaped —
// tenant names etc. come from user input. The business identity is passed in
// (DB branding with env fallbacks) rather than read from env directly, so
// Settings edits apply immediately.
import type { BusinessIdentity } from '../services/brandingService';
import { MONTH_NAMES } from '../types';
import { formatMoney, n } from './money';

export interface ReceiptDocument {
  receipt_number: string;
  receipt_type: 'RENT' | 'WATER' | 'COMBINED';
  tenant_name: string;
  unit_number: string;
  unit_type?: string | null;
  payment_date: string | Date;
  billing_month: number;
  billing_year: number;
  rent_amount: string | number;
  water_amount: string | number;
  total_amount: string | number;
  balance: string | number;
  generated_at?: string | Date | null;
  currency: string;
  property_name?: string | null;
  property_address?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function receiptTypeLabel(type: ReceiptDocument['receipt_type']): string {
  if (type === 'WATER') return 'WATER RECEIPT';
  if (type === 'COMBINED') return 'COMBINED RECEIPT (RENT + WATER)';
  return 'RENT RECEIPT';
}

export function receiptSubject(r: ReceiptDocument): string {
  return `Receipt ${r.receipt_number} — ${MONTH_NAMES[r.billing_month - 1]} ${r.billing_year}`;
}

export function fmtDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Plain-text version — the reliable fallback every mail client renders.
export function receiptText(r: ReceiptDocument, identity?: BusinessIdentity): string {
  const lines: string[] = [
    receiptTypeLabel(r.receipt_type),
    `Receipt: ${r.receipt_number}`,
    `Tenant: ${r.tenant_name} (Unit ${r.unit_number})`,
    `Billing period: ${MONTH_NAMES[r.billing_month - 1]} ${r.billing_year}`,
    `Payment date: ${fmtDate(r.payment_date)}`,
  ];
  if (n(r.rent_amount) > 0) lines.push(`Rent paid: ${formatMoney(n(r.rent_amount), r.currency)}`);
  if (n(r.water_amount) > 0) lines.push(`Water paid: ${formatMoney(n(r.water_amount), r.currency)}`);
  lines.push(
    `Total paid: ${formatMoney(n(r.total_amount), r.currency)}`,
    `Balance after payment: ${formatMoney(n(r.balance), r.currency)}`,
    '',
    'This receipt is proof of payment. Thank you.'
  );
  if (identity?.name) {
    lines.push(`${identity.name}${identity.regNo ? `, Reg. No. ${identity.regNo}` : ''}.`);
  }
  const contact = [identity?.phone, identity?.email].filter(Boolean).join(' | ');
  if (contact) lines.push(contact);
  return lines.join('\n');
}

// Identity footer from the DB-backed business identity (env fallbacks already
// applied by brandingService). Parts are omitted when not configured.
function identityFooterHtml(identity: BusinessIdentity): string {
  const name = identity.name?.trim() ?? '';
  const regNo = identity.regNo?.trim() ?? '';
  const phone = identity.phone?.trim() ?? '';
  const email = identity.email?.trim() ?? '';
  const identityLine = name
    ? `${escapeHtml(name)}${regNo ? ` · Reg. No. ${escapeHtml(regNo)}` : ''}`
    : '';
  const contact = [phone, email].filter(Boolean).map(escapeHtml).join(' · ');
  const parts = [identityLine, contact].filter(Boolean);
  if (parts.length === 0) return '';
  return `<p style="margin-top:10px;color:#6b7280;font-size:13px">${parts.join('<br>')}</p>`;
}

// HTML email — mirrors the printed receipt document used by the frontend
// preview/print (same structure, inline styles only for mail clients). When
// a business logo is configured it is inlined as a base64 data URI (most
// clients, incl. Gmail, render data-URI images; none require remote fetch
// authorization, so the logo survives strict privacy settings).
export function receiptEmailHtml(r: ReceiptDocument, identity: BusinessIdentity = { name: null, regNo: null, phone: null, email: null, logo: null }): string {
  const typeLabel = receiptTypeLabel(r.receipt_type);
  const logoSrc = identity.logo ? `data:${identity.logo.mimeType};base64,${identity.logo.bytes.toString('base64')}` : null;
  const logoHtml = logoSrc
    ? `<img src="${logoSrc}" alt="${escapeHtml(identity.name?.trim() || 'Business logo')}" height="48" style="height:48px;width:auto;max-width:180px;object-fit:contain;vertical-align:middle;margin-bottom:10px">`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:ui-sans-serif,system-ui,sans-serif;color:#111827">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px">
    ${logoHtml}<h1 style="font-size:20px;margin:0 0 4px">${escapeHtml(identity.name?.trim() || 'Property Management')}</h1>
    <div style="color:#6b7280;font-size:13px">${typeLabel}</div>
    <div style="font-size:26px;font-weight:800;margin:8px 0 16px">${escapeHtml(r.receipt_number)}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:16px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px">Tenant</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;font-weight:600">${escapeHtml(r.tenant_name)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px">Unit</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;font-weight:600">${escapeHtml(r.unit_number)}${r.unit_type ? ` (${escapeHtml(r.unit_type)})` : ''}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px">Billing period</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;font-weight:600">${MONTH_NAMES[r.billing_month - 1]} ${r.billing_year}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px">Payment date</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;font-weight:600">${fmtDate(r.payment_date)}</td></tr>
      ${n(r.rent_amount) > 0 ? `<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px">Rent paid</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;font-weight:600">${formatMoney(n(r.rent_amount), r.currency)}</td></tr>` : ''}
      ${n(r.water_amount) > 0 ? `<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px">Water paid</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;font-weight:600">${formatMoney(n(r.water_amount), r.currency)}</td></tr>` : ''}
      <tr><td style="padding:8px 0;font-size:16px;font-weight:800;border-top:2px solid #111827">Total paid</td><td style="padding:8px 0;font-size:16px;font-weight:800;border-top:2px solid #111827;text-align:right">${formatMoney(n(r.total_amount), r.currency)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px">Balance after payment</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;font-weight:600">${formatMoney(n(r.balance), r.currency)}</td></tr>
    </table>
    <p style="margin-top:24px;color:#6b7280;font-size:13px">Generated ${r.generated_at ? escapeHtml(fmtDate(r.generated_at)) : escapeHtml(fmtDate(new Date()))} — this receipt is proof of payment. Thank you.</p>
    ${identityFooterHtml(identity)}
  </div>
</body></html>`;
}
