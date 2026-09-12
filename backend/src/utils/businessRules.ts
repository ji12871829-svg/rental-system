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