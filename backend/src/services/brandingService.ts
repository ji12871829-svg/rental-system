// Business branding — the operator's real identity, stored in the DB
// (business_branding singleton) and editable from the Settings page by an
// admin. This is the single source of truth for every surface: legal pages,
// printed receipts, SMS/email receipts, PDFs, footers, favicon and tab
// titles. backend/.env business vars (BUSINESS_NAME, BUSINESS_REG_NO,
// BUSINESS_PHONE, BUSINESS_EMAIL) act as fallbacks until a value is stored
// here. Missing values are returned as null — consumers hide them instead of
// rendering placeholders.
import { pool, queryOne } from '../config/db';
import { env } from '../config/env';
import { logAudit } from './auditService';

export interface BrandingRow {
  legal_name: string | null;
  registration_number: string | null;
  address: string | null;
  contact_email: string | null;
  privacy_email: string | null;
  contact_phone: string | null;
  retention_period: string | null;
  response_days: string | null;
  jurisdiction: string | null;
  property_scope: string | null;
  payment_channels: string | null;
  refund_window_days: string | null;
  paybill_number: string | null;
  paybill_name: string | null;
  paybill_enabled: boolean;
  paybill_instructions: string | null;
  updated_at: string;
}

const TABLE = 'business_branding';

// DB row with env fallbacks applied. The env vars only fill gaps — a stored
// value always wins. Returns nulls (not placeholders) for unfilled fields.
async function getBranding(): Promise<BrandingRow> {
  await ensureRow();
  const row = await queryOne<BrandingRow>(`SELECT * FROM ${TABLE} WHERE id = 1`);
  return {
    legal_name: row?.legal_name ?? (env.businessName || null),
    registration_number: row?.registration_number ?? (env.businessRegNo || null),
    address: row?.address ?? null,
    contact_email: row?.contact_email ?? (env.businessEmail || null),
    privacy_email: row?.privacy_email ?? null,
    contact_phone: row?.contact_phone ?? (env.businessPhone || null),
    retention_period: row?.retention_period ?? null,
    response_days: row?.response_days ?? null,
    jurisdiction: row?.jurisdiction ?? null,
    property_scope: row?.property_scope ?? null,
    payment_channels: row?.payment_channels ?? null,
    refund_window_days: row?.refund_window_days ?? null,
    paybill_number: row?.paybill_number ?? null,
    paybill_name: row?.paybill_name ?? null,
    paybill_enabled: row?.paybill_enabled ?? false,
    paybill_instructions: row?.paybill_instructions ?? null,
    updated_at: row?.updated_at ?? new Date().toISOString(),
  };
}

async function ensureRow(): Promise<void> {
  await pool.query(`INSERT INTO ${TABLE} (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
}

export interface BrandingInput {
  legalName?: string | null;
  registrationNumber?: string | null;
  address?: string | null;
  contactEmail?: string | null;
  privacyEmail?: string | null;
  contactPhone?: string | null;
  retentionPeriod?: string | null;
  responseDays?: string | null;
  jurisdiction?: string | null;
  propertyScope?: string | null;
  paymentChannels?: string | null;
  refundWindowDays?: string | null;
  paybillNumber?: string | null;
  paybillName?: string | null;
  paybillEnabled?: boolean;
  paybillInstructions?: string | null;
}

const COLUMNS: Record<keyof BrandingInput, string> = {
  legalName: 'legal_name',
  registrationNumber: 'registration_number',
  address: 'address',
  contactEmail: 'contact_email',
  privacyEmail: 'privacy_email',
  contactPhone: 'contact_phone',
  retentionPeriod: 'retention_period',
  responseDays: 'response_days',
  jurisdiction: 'jurisdiction',
  propertyScope: 'property_scope',
  paymentChannels: 'payment_channels',
  refundWindowDays: 'refund_window_days',
  paybillNumber: 'paybill_number',
  paybillName: 'paybill_name',
  paybillEnabled: 'paybill_enabled',
  paybillInstructions: 'paybill_instructions',
};

// Blank string means "clear this field"; null/undefined leaves it unchanged.
export async function updateBranding(input: BrandingInput, userId: number): Promise<BrandingRow> {
  const before = await getBranding();

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(COLUMNS) as [keyof BrandingInput, string][]) {
    const value = input[key];
    if (value === undefined) continue;
    params.push(value === '' ? null : value);
    sets.push(`${column} = $${params.length}`);
  }

  if (sets.length > 0) {
    await pool.query(
      `UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = 1`,
      params
    );
  }

  const after = await getBranding();

  await logAudit({
    userId,
    action: 'BRANDING_UPDATED',
    entity: TABLE,
    entityId: 1,
    oldValue: before,
    newValue: after,
  });

  return after;
}

// --- Derived view shared with the frontend -----------------------------------

const NAME_STOP_WORDS = new Set([
  'ltd', 'limited', 'llc', 'inc', 'co', 'company', 'group', 'holdings',
  'the', 'of', 'and', '&',
]);

// First letter of the first two significant words ("Olbano Property
// Management Ltd" → "OP"). Null while no legal name exists.
function deriveInitials(legalName: string | null): string | null {
  if (!legalName) return null;
  const words = legalName
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}&]/gu, ''))
    .filter((w) => w && !NAME_STOP_WORDS.has(w.toLowerCase()));
  const initials = words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return initials || null;
}

export interface BrandingView extends BrandingRow {
  // camelCase mirrors for frontend convenience.
  legalName: string | null;
  registrationNumber: string | null;
  contactEmail: string | null;
  privacyEmail: string | null;
  contactPhone: string | null;
  retentionPeriod: string | null;
  responseDays: string | null;
  propertyScope: string | null;
  paymentChannels: string | null;
  refundWindowDays: string | null;
  paybillNumber: string | null;
  paybillName: string | null;
  paybillEnabled: boolean;
  paybillInstructions: string | null;
  // Derived.
  brandInitials: string | null;
  // Printed-receipt identity footer, placeholder-smart. Values are HTML-
  // escaped; phone/email become tel:/mailto: links for PDF-saved receipts.
  receiptFooterLines: string[];
  // The 12 identity fields with filled/missing status for the Settings plate.
  fieldStatus: { label: string; value: string; filled: boolean }[];
  missingCount: number;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toView(row: BrandingRow): BrandingView {
  const text = (v: string | null): string | null => (v ? escapeHtml(v) : null);
  const linkPhone = (v: string | null): string | null =>
    v ? `<a href="tel:${v.replace(/[^\d+]/g, '')}">${escapeHtml(v)}</a>` : null;
  const linkEmail = (v: string | null): string | null =>
    v ? `<a href="mailto:${v.replace(/[\s"'<>]/g, '')}">${escapeHtml(v)}</a>` : null;

  const identityLine = [
    text(row.legal_name),
    row.registration_number ? `Reg. No. ${escapeHtml(row.registration_number)}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join(' · ');

  const contactLine = [text(row.address), linkPhone(row.contact_phone), linkEmail(row.contact_email)]
    .filter((s): s is string => s !== null)
    .join(' · ');

  const fieldStatus = [
    { label: 'company legal name', value: row.legal_name },
    { label: 'registration number', value: row.registration_number },
    { label: 'address', value: row.address },
    { label: 'general queries email', value: row.contact_email },
    { label: 'privacy email', value: row.privacy_email },
    { label: 'phone number', value: row.contact_phone },
    { label: 'record retention period', value: row.retention_period },
    { label: 'privacy request response days', value: row.response_days },
    { label: 'governing law jurisdiction', value: row.jurisdiction },
    { label: 'property name/address (refund policy)', value: row.property_scope },
    { label: 'payment channels (refund policy)', value: row.payment_channels },
    { label: 'refund processing window', value: row.refund_window_days },
  ].map(({ label, value }) => ({
    label,
    value: value ?? '',
    filled: Boolean(value && value.trim() !== ''),
  }));

  return {
    ...row,
    legalName: row.legal_name,
    registrationNumber: row.registration_number,
    contactEmail: row.contact_email,
    privacyEmail: row.privacy_email,
    contactPhone: row.contact_phone,
    retentionPeriod: row.retention_period,
    responseDays: row.response_days,
    propertyScope: row.property_scope,
    paymentChannels: row.payment_channels,
    refundWindowDays: row.refund_window_days,
    paybillNumber: row.paybill_number,
    paybillName: row.paybill_name,
    paybillEnabled: row.paybill_enabled,
    paybillInstructions: row.paybill_instructions,
    brandInitials: deriveInitials(row.legal_name),
    receiptFooterLines: [identityLine, contactLine].filter((l) => l !== ''),
    fieldStatus,
    missingCount: fieldStatus.filter((f) => !f.filled).length,
  };
}

export async function getBrandingView(): Promise<BrandingView> {
  return toView(await getBranding());
}

export interface PaybillInstructions {
  enabled: boolean;
  number: string | null;
  name: string | null;
  instructions: string | null;
}

export async function getPaybillInstructions(): Promise<PaybillInstructions> {
  const row = await getBranding();
  return {
    enabled: row.paybill_enabled && Boolean(row.paybill_number),
    number: row.paybill_enabled ? row.paybill_number : null,
    name: row.paybill_enabled ? row.paybill_name : null,
    instructions: row.paybill_enabled ? row.paybill_instructions : null,
  };
}

// The identity block used by SMS receipts, email receipts and PDF footers —
// one shape, DB values with env fallbacks already applied by getBranding().
export interface BusinessIdentity {
  name: string | null;
  regNo: string | null;
  phone: string | null;
  email: string | null;
}

function identityOf(row: BrandingRow): BusinessIdentity {
  return {
    name: row.legal_name,
    regNo: row.registration_number,
    phone: row.contact_phone,
    email: row.contact_email,
  };
}

export async function getBusinessIdentity(): Promise<BusinessIdentity> {
  return identityOf(await getBranding());
}
