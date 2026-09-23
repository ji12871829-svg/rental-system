// Owner remittance — the PROPERTY OWNER communication templates (spec
// "Property Owner Communication Templates"): monthly remittance summary,
// expense notice and the full financial statement email, composed from the
// same month-scoped figures the Monthly Summary page shows. The owner is a
// person, not a login: messages go OUT (SMS queue / WhatsApp handoff /
// email queue); there is nothing for an owner to sign into.
//
// Figures source of truth: monthlyRentSummary + monthlyWaterSummary (the
// Monthly Summary page's exact rows) + expenses for the month. The
// management fee comes from settings.management_fee_percent (NULL = no fee
// arrangement, the fee lines disappear honestly).
import { query } from '../config/db';
import { MONTH_NAMES } from '../types';
import { gsm7EffectiveLength, SMS_TWO_SEGMENT_GSM7_LIMIT } from '../utils/businessRules';
import { notFound } from '../utils/httpError';
import { n, round2 } from '../utils/money';
import { getBusinessIdentity } from './brandingService';
import { monthlyRentSummary } from './rentService';
import { getSettings } from './settingsService';
import { monthlyWaterSummary } from './waterService';

export interface OwnerRemittanceFigures {
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  propertyName: string;
  monthName: string;
  year: number;
  currency: string;
  totalCollected: number;
  rentCollected: number;
  waterCollected: number;
  expectedRent: number;
  waterBilled: number;
  occupancyPercent: number;
  managementFeePercent: number | null;
  managementFee: number;
  expensesTotal: number;
  expensesTop: { category: string; amount: number }[];
  netPayable: number;
  businessName: string | null;
}

// Month-scoped owner figures. Occupancy is the month's occupied/vacant split
// straight from the rent summary (the same numbers the Monthly Summary page
// shows); expenses are the month's real expense rows grouped by category.
export async function ownerRemittanceFigures(year: number, month: number): Promise<OwnerRemittanceFigures> {
  if (month < 1 || month > 12) throw notFound('Month out of range.');
  const settings = await getSettings();
  if (year !== settings.reporting_year) {
    // Figures are move-in aware against the reporting year; other years are
    // computable but the templates are "this month's statement" — restrict
    // to the live reporting year to keep the wording honest.
    throw notFound(`Owner statements are available for the reporting year ${settings.reporting_year}.`);
  }

  const [rent, water, expenses, identity] = await Promise.all([
    monthlyRentSummary(year),
    monthlyWaterSummary(year),
    query<{ category: string; total: string }>(
      `SELECT category, COALESCE(SUM(amount), 0)::text AS total
       FROM expenses
       WHERE EXTRACT(YEAR FROM expense_date) = $1 AND EXTRACT(MONTH FROM expense_date) = $2
       GROUP BY category ORDER BY SUM(amount) DESC`,
      [year, month],
    ),
    getBusinessIdentity(),
  ]);

  const r = rent.find((row) => row.month === month);
  const w = water.find((row) => row.month === month);
  if (!r) throw notFound(`No rent summary for month ${month}.`);

  const rentCollected = round2(r.rentCollected);
  const waterCollected = round2(w?.waterCollected ?? 0);
  const totalCollected = round2(rentCollected + waterCollected);
  const feePercent = settings.management_fee_percent !== null ? n(settings.management_fee_percent) : null;
  const managementFee = feePercent !== null ? round2((totalCollected * feePercent) / 100) : 0;
  const expensesTotal = round2(expenses.reduce((sum, e) => sum + n(e.total), 0));
  // Net remittance: collections minus the operator's fee minus property
  // expenses the operator covered. Never below zero in the message (an
  // overdrawn month shows 0 and the email breakdown tells the story).
  const netPayable = Math.max(round2(totalCollected - managementFee - expensesTotal), 0);

  const occupied = r.occupiedUnits;
  const totalUnits = occupied + r.vacantUnits;
  const occupancyPercent = totalUnits > 0 ? round2((occupied / totalUnits) * 100) : 0;

  return {
    ownerName: settings.owner_name,
    ownerEmail: settings.owner_email,
    ownerPhone: settings.owner_phone,
    propertyName: identity.name ?? 'the property',
    monthName: MONTH_NAMES[month - 1],
    year,
    currency: settings.currency,
    totalCollected,
    rentCollected,
    waterCollected,
    expectedRent: round2(r.expectedRent),
    waterBilled: round2(w?.waterBilled ?? 0),
    occupancyPercent,
    managementFeePercent: feePercent,
    managementFee,
    expensesTotal,
    expensesTop: expenses.slice(0, 4).map((e) => ({ category: e.category, amount: n(e.total) })),
    netPayable,
    businessName: identity.name,
  };
}

// --- SMS (short financial update) --------------------------------------------

export function ownerRemittanceSms(f: OwnerRemittanceFigures): string {
  const feePart = f.managementFeePercent !== null
    ? ` Management Fee: ${f.currency} ${f.managementFee}.`
    : '';
  // Same 2-segment discipline as tenant SMS. The figures never get trimmed —
  // if an extreme property name overruns the budget the tail is cut, which
  // is acceptable for an advisory text (the email carries the full detail).
  const msg = `Dear ${f.ownerName ?? 'Owner'}, your ${f.monthName} ${f.year} remittance statement for ${f.propertyName} is ready. Total Collected: ${f.currency} ${f.totalCollected}.${feePart} Net Disbursed to Bank: ${f.currency} ${f.netPayable}.`;
  return gsm7EffectiveLength(msg) <= SMS_TWO_SEGMENT_GSM7_LIMIT ? msg : msg.slice(0, SMS_TWO_SEGMENT_GSM7_LIMIT);
}

export function ownerExpenseNoticeSms(f: OwnerRemittanceFigures, expenseType: string, amount: number): string {
  return `Hi ${f.ownerName ?? 'Owner'}, emergency maintenance (${expenseType}) cost ${f.currency} ${amount} was deducted from ${f.propertyName} collections this month. Statement sent to email.`;
}

// --- WhatsApp (professional & visual) -----------------------------------------

export function ownerRemittanceWhatsapp(f: OwnerRemittanceFigures): string {
  const lines: string[] = [];
  lines.push(`Hello ${f.ownerName ?? 'Owner'} 👋`);
  lines.push(`Your monthly property performance report for ${f.propertyName} is ready for ${f.monthName} ${f.year}.`);
  lines.push(`💰 Total Rent Collected: ${f.currency} ${f.totalCollected}`);
  if (f.managementFeePercent !== null) lines.push(`🏷️ Management Fee (${f.managementFeePercent}%): ${f.currency} ${f.managementFee}`);
  if (f.expensesTotal > 0) lines.push(`🧰 Expenses/Maintenance: ${f.currency} ${f.expensesTotal}`);
  lines.push(`💸 Net Payout: ${f.currency} ${f.netPayable} — funds have been transferred to your registered bank account. A PDF statement has been sent to your email.`);
  lines.push('Thank you for partnering with us! 🏠');
  return lines.join('\n');
}

// --- Email (full landlord ledger & breakdown) ----------------------------------

export function composeOwnerRemittanceEmail(f: OwnerRemittanceFigures, periodEnd: string): { subject: string; html: string; text: string } {
  const subject = `Monthly Financial Statement & Remittance Report - ${f.monthName} - ${f.propertyName}`;
  const feeLine = f.managementFeePercent !== null
    ? `Management Fee Deduction (${f.managementFeePercent}%): ${f.currency} ${f.managementFee}`
    : null;
  const expenseLines = f.expensesTop.map((e) => `${e.category}: ${f.currency} ${e.amount}`);

  const summaryRows: [string, string][] = [
    ['Gross Rent Collected', `${f.currency} ${f.totalCollected} (Occupancy: ${f.occupancyPercent}%)`],
    ...(feeLine ? [['Management Fee Deduction', `${f.currency} ${f.managementFee} (${f.managementFeePercent}%)`] as [string, string]] : []),
    ['Approved Repairs &amp; Maintenance', `${f.currency} ${f.expensesTotal}`],
    ['Net Remittance Disbursed', `${f.currency} ${f.netPayable}`],
  ];
  const rows = summaryRows
    .map(([label, value]) => `<tr><td style="padding:6px 0;color:#374151">${label}:</td><td style="padding:6px 0;text-align:right;font-weight:bold">${value}</td></tr>`)
    .join('');

  const bodyHtml = `
<p>Dear ${f.ownerName ?? 'Owner'},</p>
<p>We have finished the monthly accounts for <strong>${f.propertyName}</strong> for the period ending <strong>${periodEnd}</strong>. Please find the summary below and the detailed itemized PDF attached.</p>
<table style="margin:12px 0;border-collapse:collapse;width:100%">${rows}</table>
<p style="color:#6b7280;font-size:13px">Breakdown of expenses this month: ${expenseLines.length ? expenseLines.map(escape).join(' · ') : 'none recorded'}.</p>
<p>Yours faithfully,<br/>${f.businessName ?? 'Property Management'}</p>`;

  const text = [
    `Dear ${f.ownerName ?? 'Owner'},`,
    '',
    `We have finished the monthly accounts for ${f.propertyName} for the period ending ${periodEnd}.`,
    'Please find the summary below and the detailed itemized PDF attached.',
    '',
    ...summaryRows.map(([l, v]) => `${l}: ${v}`),
    '',
    `Breakdown of expenses this month: ${expenseLines.length ? expenseLines.join(' · ') : 'none recorded'}.`,
    '',
    'Yours faithfully,',
    f.businessName ?? 'Property Management',
  ].join('\n');

  return { subject, html: emailFrame(bodyHtml, f.businessName), text };
}

// Escape helper for the few interpolated strings in the html body (identical
// rules to emailTemplates.escapeHtml, kept local to avoid widening exports).
function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

function emailFrame(bodyHtml: string, businessName: string | null): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
${bodyHtml}
<p style="margin:16px 0 0;color:#6b7280;font-size:13px">${businessName ?? 'Property Management'}</p>
</div>
</body></html>`;
}
