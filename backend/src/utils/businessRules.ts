// Pure business rules — no I/O, unit-testable.
// Rents, water rates and currency are passed IN (they come from the DB);
// nothing is hard-coded here.

import type { PaymentStatus } from '../types';
import { round2 } from './money';

// --- Rent / water payment status -------------------------------------------
// expected = amount billed (monthly rent or water bill) for the period
// paid     = SUM of payments against that period
export function paymentStatus(expected: number, paid: number): PaymentStatus {
  if (paid <= 0) return 'UNPAID';
  if (paid < expected) return 'PARTIAL';
  if (paid === expected) return 'PAID';
  return 'OVERPAID';
}

export function balanceDue(expected: number, paid: number): number {
  return round2(expected - paid);
}

// --- Water meter math -------------------------------------------------------
// FIRST READING: no previous reading exists. The user establishes the initial
// reading; consumption is measured from zero unless they supply the meter's
// starting value explicitly.
export interface WaterBillResult {
  ok: true;
  previousReading: number;
  currentReading: number;
  consumption: number;
  waterRate: number;
  waterBill: number;
  firstReading: boolean;
}

export interface WaterBillError {
  ok: false;
  error: string;
}

export function computeWaterBill(
  previousReading: number | null | undefined,
  currentReading: number,
  waterRate: number
): WaterBillResult | WaterBillError {
  if (!Number.isFinite(currentReading) || currentReading < 0) {
    return { ok: false, error: 'Current meter reading must be a non-negative number.' };
  }
  if (waterRate < 0) {
    return { ok: false, error: 'Water rate cannot be negative.' };
  }
  const firstReading = previousReading === null || previousReading === undefined;
  const prev = firstReading ? 0 : previousReading;
  if (currentReading < prev) {
    return {
      ok: false,
      error: 'Current meter reading cannot be lower than previous reading.',
    };
  }
  const consumption = round2(currentReading - prev);
  return {
    ok: true,
    previousReading: round2(prev),
    currentReading: round2(currentReading),
    consumption,
    waterRate: round2(waterRate),
    waterBill: round2(consumption * waterRate),
    firstReading,
  };
}

// --- Water financial performance -------------------------------------------
export function waterCollectionRate(collected: number, billed: number): number {
  if (billed <= 0) return 0;
  return round2((collected / billed) * 100);
}

// Positive → SURPLUS, negative → DEFICIT
export function waterSurplusDeficit(collected: number, supplyCost: number): number {
  return round2(collected - supplyCost);
}

export function rentCollectionRate(collected: number, expected: number): number {
  if (expected <= 0) return 0;
  return round2((collected / expected) * 100);
}

// --- Receipt numbers --------------------------------------------------------
// RC-2026-0001 (rent), WC-2026-0001 (water), RWC-2026-0001 (combined)
export type ReceiptPrefix = 'RC' | 'WC' | 'RWC';

export function receiptPrefixFor(type: 'RENT' | 'WATER' | 'COMBINED'): ReceiptPrefix {
  if (type === 'WATER') return 'WC';
  if (type === 'COMBINED') return 'RWC';
  return 'RC';
}

export function formatReceiptNumber(prefix: ReceiptPrefix, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

// --- SMS segment budget ----------------------------------------------------
// A multi-part GSM-7 SMS carries 153 chars per segment (160 for a single).
// Two segments therefore allow 306 characters, and every GSM-7 "extension"
// character (| ^ { } [ ] ~ \ €) counts as two. Keeping receipt SMS within two
// segments halves the per-receipt messaging cost.
export const SMS_TWO_SEGMENT_GSM7_LIMIT = 2 * 153;

const GSM7_EXTENSION_CHARS = new Set(['^', '{', '}', '[', ']', '~', '\\', '|', '€']);

export function gsm7EffectiveLength(text: string): number {
  let length = 0;
  for (const ch of text) length += GSM7_EXTENSION_CHARS.has(ch) ? 2 : 1;
  return length;
}

// Appends the business identity on its own line, choosing the first (most
// informative) variant that keeps the whole message within the 2-segment
// budget. If nothing fits, the receipt body stands alone.
// Module-private: smsService composes the same budgeting inline (buildMessage).
function withIdentity(message: string, businessIdentity?: string | string[]): string {
  if (!businessIdentity || (Array.isArray(businessIdentity) && businessIdentity.length === 0)) {
    return message;
  }
  const variants = Array.isArray(businessIdentity) ? businessIdentity : [businessIdentity];
  const budget = SMS_TWO_SEGMENT_GSM7_LIMIT - gsm7EffectiveLength(message) - 1; // 1 = joining newline
  const best = variants.find((v) => gsm7EffectiveLength(v) <= budget);
  return best ? `${message}\n${best}` : message;
}

// --- SMS message templates (spec §34) --------------------------------------
// Business identity (optional) is appended on its own line within the
// 2-segment budget. Keep it plain ASCII: an em dash or curly quotes fall
// outside GSM-7 and force UCS-2 encoding (70 chars/segment — double the SMS
// cost).

export function rentReceiptMessage(opts: {
  tenantName: string;
  unitNumber: string;
  monthName: string;
  year: number;
  rentPaid: number;
  balance: number;
  receiptNumber: string;
  currency: string;
  businessIdentity?: string | string[];
}): string {
  const { tenantName, unitNumber, monthName, year, rentPaid, balance, receiptNumber, currency } = opts;
  if (balance > 0) {
    return withIdentity(`RENT RECEIPT: Dear ${tenantName}, ${currency} ${rentPaid} received for Unit ${unitNumber}, ${monthName} ${year} rent. Outstanding balance: ${currency} ${balance}. Receipt: ${receiptNumber}. Thank you.`, opts.businessIdentity);
  }
  return withIdentity(`RENT RECEIPT: Dear ${tenantName}, ${currency} ${rentPaid} received for Unit ${unitNumber}, ${monthName} ${year} rent. Balance: ${currency} 0. Receipt: ${receiptNumber}. Thank you.`, opts.businessIdentity);
}

export function waterReceiptMessage(opts: {
  tenantName: string;
  unitNumber: string;
  monthName: string;
  year: number;
  waterPaid: number;
  balance: number;
  receiptNumber: string;
  currency: string;
  businessIdentity?: string | string[];
}): string {
  const { tenantName, unitNumber, monthName, year, waterPaid, balance, receiptNumber, currency } = opts;
  return withIdentity(`WATER RECEIPT: Dear ${tenantName}, ${currency} ${waterPaid} received for Unit ${unitNumber} water, ${monthName} ${year}. Outstanding balance: ${currency} ${balance}. Receipt: ${receiptNumber}. Thank you.`, opts.businessIdentity);
}

export function combinedReceiptMessage(opts: {
  tenantName: string;
  unitNumber: string;
  monthName: string;
  year: number;
  rentPaid: number;
  waterPaid: number;
  totalPaid: number;
  balance: number;
  receiptNumber: string;
  currency: string;
  businessIdentity?: string | string[];
}): string {
  const { tenantName, unitNumber, monthName, year, rentPaid, waterPaid, totalPaid, balance, receiptNumber, currency } = opts;
  if (waterPaid > 0) {
    return withIdentity(`PAYMENT RECEIPT: Dear ${tenantName}, ${currency} ${totalPaid} received for Unit ${unitNumber} for ${monthName} ${year} (Rent ${currency} ${rentPaid} + Water ${currency} ${waterPaid}). Outstanding balance: ${currency} ${balance}. Receipt: ${receiptNumber}. Thank you.`, opts.businessIdentity);
  }
  return withIdentity(`PAYMENT RECEIPT: Dear ${tenantName}, ${currency} ${totalPaid} received for Unit ${unitNumber} for ${monthName} ${year} rent. Outstanding balance: ${currency} ${balance}. Receipt: ${receiptNumber}. Thank you.`, opts.businessIdentity);
}

// --- Tenant reminder templates ----------------------------------------------
// Staff-initiated statements/overdue notices (SMS page + Tenants page actions).
// Same 2-segment GSM-7 budget and identity-line budgeting as the receipts.

// "Monthly Rent & Balance Due": a month's statement. Sent any time; when the
// month is still current the wording stays neutral ("is ready"), and the
// balance is the figure the ledger shows for that month.
export function monthlyBalanceDueMessage(opts: {
  tenantName: string;
  unitNumber: string;
  monthName: string;
  year: number;
  totalDue: number;
  accountNumber: string;
  paymentMethod: string;
  currency: string;
  businessIdentity?: string | string[];
}): string {
  const { tenantName, unitNumber, monthName, year, totalDue, accountNumber, paymentMethod, currency } = opts;
  return withIdentity(
    `Dear ${tenantName}, your statement for ${monthName} ${year} for Unit ${unitNumber} is ready. Total Due: ${currency} ${totalDue}. Account: ${accountNumber}. Pay via ${paymentMethod}.`,
    opts.businessIdentity,
  );
}

// "Overdue Notice": firmer tone for a past-due balance. Amount_Due is what is
// owed NOW; Total_Balance is the full-year position so the tenant sees both.
export function overdueNoticeMessage(opts: {
  tenantName: string;
  unitNumber: string;
  amountDue: number;
  totalBalance: number;
  currency: string;
  businessIdentity?: string | string[];
}): string {
  const { tenantName, unitNumber, amountDue, totalBalance, currency } = opts;
  return withIdentity(
    `Hi ${tenantName}, Unit ${unitNumber} has an overdue balance of ${currency} ${amountDue}. Please clear this immediately to avoid late fees. Total Balance: ${currency} ${totalBalance}.`,
    opts.businessIdentity,
  );
}

// --- WhatsApp templates (informal & action-oriented) -------------------------
// The same three messages as the SMS reminders but in a friendlier voice with
// emoji. These are NOT sent through an API — the operator opens a WhatsApp
// click-to-chat (wa.me) link with the composed text pre-filled, so the text
// never leaves the system unencrypted and there is no provider cost.

// WhatsApp statement: current rent, previous balance and the total due, with
// an "ignore if already paid" line to cut back-and-forth.
export function whatsappBalanceDueMessage(opts: {
  tenantName: string;
  unitNumber: string;
  monthName: string;
  year: number;
  currentRent: number;
  previousBalance: number;
  totalDue: number;
  accountNumber: string;
  paymentMethod: string;
  currency: string;
}): string {
  const { tenantName, unitNumber, monthName, year, currentRent, previousBalance, totalDue, accountNumber, paymentMethod, currency } = opts;
  return `Hello ${tenantName}, 🌟 Your rent statement for ${monthName} ${year} is ready for Unit ${unitNumber}. 💰 Current Rent: ${currency} ${currentRent} ➕ Previous Balance: ${currency} ${previousBalance} 🧾 Total Due: ${currency} ${totalDue}. Please make payment to Account ${accountNumber} via ${paymentMethod}. If you have already paid, please ignore this message. Thank you!`;
}

// WhatsApp overdue notice: softer than SMS but still firm, with a chat link.
export function whatsappOverdueMessage(opts: {
  tenantName: string;
  unitNumber: string;
  amountDue: number;
  supportPhone: string | null;
  currency: string;
}): string {
  const { tenantName, unitNumber, amountDue, supportPhone, currency } = opts;
  const chat = supportPhone
    ? ` Click here to chat with support if you have any questions: https://wa.me/${supportPhone.replace(/\D/g, '')}.`
    : '';
  return `Dear ${tenantName}, this is a reminder that your account for Unit ${unitNumber} has an outstanding balance of ${currency} ${amountDue}. Please settle this today to maintain a clear ledger.${chat}`;
}

// WhatsApp payment confirmation: warm thank-you with the updated balance.
export function whatsappPaymentConfirmationMessage(opts: {
  tenantName: string;
  amountPaid: number;
  paymentDate: string;
  unitNumber: string;
  newBalance: number;
  currency: string;
}): string {
  const { tenantName, amountPaid, paymentDate, unitNumber, newBalance, currency } = opts;
  return `Thank you, ${tenantName}! 🎉 We received your payment of ${currency} ${amountPaid} on ${paymentDate} for Unit ${unitNumber}. Your updated account balance is ${currency} ${newBalance}. Have a great day!`;
}