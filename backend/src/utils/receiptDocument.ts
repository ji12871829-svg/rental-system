// Shared receipt document builders (server-side). One source of truth for
// the emailed receipt HTML (sent as the message body AND stored as an
// attachment) and the plain-text fallback. All dynamic values are escaped —
// tenant names etc. come from user input. The business identity is passed in
// (DB branding with env fallbacks) rather than read from env directly, so
// Settings edits apply immediately.
//
// The HTML follows a formal letterhead layout: a dark masthead carrying the
// business identity, the receipt itself as a clean itemised card with the
// total as the hero figure, and a footer stating the electronic-issuance
// terms. Inline styles only — every mail client renders it identically.
import type { BusinessIdentity } from '../services/brandingService';
import { MONTH_NAMES } from '../types';
import { escapeHtml } from './html';
import { formatMoney, toNumber } from './money';

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
// Formal but warm: the same facts as the HTML, ending with the electronic
// issuance note and the business identity + contacts.
export function receiptText(r: ReceiptDocument, identity?: BusinessIdentity): string {
  const lines: string[] = [
    receiptTypeLabel(r.receipt_type),
    `Receipt: ${r.receipt_number}`,
    `Tenant: ${r.tenant_name} (Unit ${r.unit_number})`,
    `Billing period: ${MONTH_NAMES[r.billing_month - 1]} ${r.billing_year}`,
    `Payment date: ${fmtDate(r.payment_date)}`,
  ];
  if (toNumber(r.rent_amount) > 0) lines.push(`Rent paid: ${formatMoney(toNumber(r.rent_amount), r.currency)}`);
  if (toNumber(r.water_amount) > 0) lines.push(`Water paid: ${formatMoney(toNumber(r.water_amount), r.currency)}`);
  lines.push(
    `Total paid: ${formatMoney(toNumber(r.total_amount), r.currency)}`,
    `Balance after payment: ${formatMoney(toNumber(r.balance), r.currency)}`,
    '',
    'This receipt is proof of payment. Thank you.',
    'Issued electronically - valid without a signature.'
  );
  if (identity?.name) {
    lines.push(`${identity.name}${identity.regNo ? `, Reg. No. ${identity.regNo}` : ''}.`);
  }
  const contact = [identity?.phone, identity?.email].filter(Boolean).join(' | ');
  if (contact) lines.push(contact);
  return lines.join('\n');
}

// The letterhead: an optional white logo strip above the dark masthead
// carrying the business name + Reg. No. (the legal identifier) and the
// configured contacts. The fallback title is applied by the caller's naming
// of the business; here an unnamed identity still renders the neutral title.
function letterheadHtml(identity: BusinessIdentity, logoHtml: string): string {
  const name = identity.name?.trim() ?? '';
  const regNo = identity.regNo?.trim() ?? '';
  const phone = identity.phone?.trim() ?? '';
  const email = identity.email?.trim() ?? '';
  const contact = [phone, email].filter(Boolean).map(escapeHtml).join(' &nbsp;·&nbsp; ');
  const logoStrip = logoHtml
    ? `<div style="background:#ffffff;border-bottom:1px solid #e5e7eb;padding:16px 28px">${logoHtml}</div>`
    : '';
  return `${logoStrip}<div style="background:#111827;color:#ffffff;padding:20px 28px">
      <div style="font-size:18px;font-weight:700">${escapeHtml(name || 'Property Management')}${regNo ? `<span style="font-size:12px;font-weight:400;color:#d1d5db"> &nbsp;·&nbsp; Reg. No. ${escapeHtml(regNo)}</span>` : ''}</div>
      ${contact ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px">${contact}</div>` : ''}
    </div>`;
}

// The footer bar under the itemised table: the electronic-issuance terms.
function termsFooterHtml(): string {
  return `<div style="border-top:1px solid #e5e7eb;background:#f9fafb;padding:14px 28px;color:#6b7280;font-size:12px">
      This receipt was issued electronically and is valid without a signature. Please keep it as your proof of payment.
    </div>`;
}

// HTML email — formal letterhead receipt: dark masthead, PAID badge, the
// total as the hero figure, then the itemised breakdown. When a business
// logo is configured it is inlined as a base64 data URI (most clients,
// incl. Gmail, render data-URI images; none require remote fetch
// authorization, so the logo survives strict privacy settings).
export function receiptEmailHtml(r: ReceiptDocument, identity: BusinessIdentity = { name: null, regNo: null, phone: null, sendMoneyPhone: null, email: null, logo: null }): string {
  const typeLabel = receiptTypeLabel(r.receipt_type);
  const logoSrc = identity.logo ? `data:${identity.logo.mimeType};base64,${identity.logo.bytes.toString('base64')}` : null;
  const logoHtml = logoSrc
    ? `<img src="${logoSrc}" alt="${escapeHtml(identity.name?.trim() || 'Business logo')}" height="40" style="height:40px;width:auto;max-width:180px;object-fit:contain;display:block;margin-bottom:8px">`
    : '';
  const row = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:9px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:${strong ? '#111827' : '#374151'}${strong ? ';font-weight:700' : ''}">${label}</td><td style="padding:9px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;${strong ? 'font-weight:800' : 'font-weight:600'}">${value}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:ui-sans-serif,system-ui,sans-serif;color:#111827">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
    ${letterheadHtml(identity, logoHtml)}
    <div style="padding:28px">
      <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280">${typeLabel}</div>
      <div style="font-size:26px;font-weight:800;margin:4px 0 10px">${escapeHtml(r.receipt_number)}</div>
      <div style="display:inline-block;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;border-radius:999px;padding:2px 12px;font-size:12px;font-weight:700">PAID</div>
      <div style="margin:18px 0 4px;font-size:30px;font-weight:800">${formatMoney(toNumber(r.total_amount), r.currency)}</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:14px">Total received on ${escapeHtml(fmtDate(r.payment_date))}</div>
      <table style="width:100%;border-collapse:collapse">
        ${row('Tenant', escapeHtml(r.tenant_name))}
        ${row('Unit', `${escapeHtml(r.unit_number)}${r.unit_type ? ` (${escapeHtml(r.unit_type)})` : ''}`)}
        ${row('Billing period', `${MONTH_NAMES[r.billing_month - 1]} ${r.billing_year}`)}
        ${toNumber(r.rent_amount) > 0 ? row('Rent paid', formatMoney(toNumber(r.rent_amount), r.currency)) : ''}
        ${toNumber(r.water_amount) > 0 ? row('Water paid', formatMoney(toNumber(r.water_amount), r.currency)) : ''}
        ${row('Total paid', formatMoney(toNumber(r.total_amount), r.currency), true)}
        ${row('Balance after payment', formatMoney(toNumber(r.balance), r.currency))}
      </table>
      <p style="margin-top:20px;color:#6b7280;font-size:13px">Generated ${escapeHtml(fmtDate(r.generated_at ?? new Date()))}. Thank you for your payment.</p>
    </div>
    ${termsFooterHtml()}
  </div>
</body></html>`;
}
