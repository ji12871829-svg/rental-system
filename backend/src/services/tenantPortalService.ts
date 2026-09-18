// Tenant portal backend: credential management (staff-issued), tenant login
// with a separate cookie + JWT audience, and the read-only self-service data
// surfaces (summary, payments, water readings, receipts, statement PDF) plus
// the one tenant-initiated action (M-Pesa STK Push for rent).
//
// Security shape:
//   * portal credentials live in tenant_portal_access, never in `users` —
//     a tenant login can never satisfy staff auth or carry a staff role;
//   * the portal JWT carries aud='tenant_portal', so staff tokens are not
//     valid in the portal and vice versa;
//   * every portal surface is scoped to the logged-in tenant's tenant_id —
//     there is no route parameter that could reach another tenant's data;
//   * DISABLED or moved-out tenants are refused at login and at every request
//     (requireTenant re-checks the row each time — the staff user cache
//     pattern is deliberately not reused, tenant disablement must be instant).
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { queryOne, query } from '../config/db';
import { env } from '../config/env';
import { getSettings } from './settingsService';
import { getPaybillInstructions } from './brandingService';
import { logAudit } from './auditService';
import { initiateTenantStkPush } from './mpesaService';
import { tenantStatementPdf } from './financeService';
import { conflict, forbidden, notFound, unauthorized } from '../utils/httpError';

// Generated when staff issue access without supplying a password. Formatted
// for reading aloud over the phone: groups, no visually ambiguous characters
// (no 0/O, 1/l/I). The plaintext is returned once to the issuing staff user —
// only the hash is stored.
export function generatePortalPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

export interface PortalAccessRow {
  id: number;
  tenant_id: number;
  email: string;
  status: 'ACTIVE' | 'DISABLED';
  last_login_at: Date | null;
  created_at: Date;
}

export async function issuePortalAccess(
  tenantId: number,
  userId: number,
  email?: string,
  password?: string
): Promise<PortalAccessRow & { tenantName: string; generatedPassword?: string }> {
  const tenant = await queryOne<
    { id: number; status: string; full_name: string; email: string | null }
  >(
    'SELECT id, status, full_name, email FROM tenants WHERE id = $1',
    [tenantId]
  );
  if (!tenant) throw notFound('Tenant not found.');
  if (tenant.status !== 'ACTIVE') {
    throw conflict('Portal access can only be issued for an active tenant.', 'TENANT_INACTIVE');
  }

  // Defaults: the tenant's own email (a portal login must belong to them) and
  // a generated password the staff user reads out / sends to the tenant.
  const finalEmail = (email ?? tenant.email ?? '').trim().toLowerCase();
  if (!finalEmail) {
    throw conflict(
      'This tenant has no email address on file. Add one first, or pass an email explicitly.',
      'TENANT_NO_EMAIL'
    );
  }
  const finalPassword = password ?? generatePortalPassword();

  const existing = await queryOne<PortalAccessRow>(
    'SELECT * FROM tenant_portal_access WHERE tenant_id = $1',
    [tenantId]
  );
  const passwordHash = await bcrypt.hash(finalPassword, env.bcryptSaltRounds);

  if (existing) {
    // Re-issue rotates the credentials and re-enables a previously disabled
    // account — one idempotent "give this tenant access" action for staff.
    const row = await queryOne<PortalAccessRow>(
      `UPDATE tenant_portal_access
       SET email = $2, password_hash = $3, status = 'ACTIVE'
       WHERE tenant_id = $1
       RETURNING id, tenant_id, email, status, last_login_at, created_at`,
      [tenantId, finalEmail, passwordHash]
    );
    await logAudit({ userId, action: 'TENANT_PORTAL_ISSUED', entity: 'tenant_portal_access', entityId: row!.id });
    return { ...row!, tenantName: tenant.full_name, generatedPassword: password ? undefined : finalPassword };
  }

  const row = await queryOne<PortalAccessRow>(
    `INSERT INTO tenant_portal_access (tenant_id, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, tenant_id, email, status, last_login_at, created_at`,
    [tenantId, finalEmail, passwordHash]
  );
  if (!row) throw new Error('Portal access creation failed.');
  await logAudit({ userId, action: 'TENANT_PORTAL_ISSUED', entity: 'tenant_portal_access', entityId: row.id });
  return { ...row, tenantName: tenant.full_name, generatedPassword: password ? undefined : finalPassword };
}

export async function disablePortalAccess(tenantId: number, userId: number): Promise<void> {
  const row = await queryOne<PortalAccessRow>(
    'SELECT * FROM tenant_portal_access WHERE tenant_id = $1',
    [tenantId]
  );
  if (!row) throw notFound('This tenant has no portal access to disable.');
  await query(
    "UPDATE tenant_portal_access SET status = 'DISABLED' WHERE tenant_id = $1",
    [tenantId]
  );
  await logAudit({ userId, action: 'TENANT_PORTAL_DISABLED', entity: 'tenant_portal_access', entityId: row.id });
}

export async function getPortalAccess(tenantId: number): Promise<PortalAccessRow | null> {
  return queryOne<PortalAccessRow>(
    'SELECT id, tenant_id, email, status, last_login_at, created_at FROM tenant_portal_access WHERE tenant_id = $1',
    [tenantId]
  );
}

export interface PortalLoginResult {
  tenantId: number;
  name: string;
  email: string;
}

export async function portalLogin(email: string, password: string): Promise<PortalLoginResult> {
  const row = await queryOne<{
    id: number; tenant_id: number; email: string; password_hash: string; status: string;
    full_name: string; tenant_status: string;
  }>(
    `SELECT a.id, a.tenant_id, a.email, a.password_hash, a.status,
            t.full_name, t.status AS tenant_status
     FROM tenant_portal_access a
     JOIN tenants t ON t.id = a.tenant_id
     WHERE a.email = $1`,
    [email.toLowerCase()]
  );
  // Same message for unknown email / wrong password / disabled — do not hint
  // at which accounts exist.
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw unauthorized('Invalid email or password.');
  }
  if (row.status !== 'ACTIVE') throw unauthorized('This portal account has been disabled. Contact your property manager.');
  if (row.tenant_status !== 'ACTIVE') throw unauthorized('This tenancy has ended. Contact your property manager.');

  await query('UPDATE tenant_portal_access SET last_login_at = NOW() WHERE id = $1', [row.id]);
  return { tenantId: row.tenant_id, name: row.full_name, email: row.email };
}

// --- Authenticated portal data (all scoped by the verified tenant_id) --------

export interface PortalIdentity {
  tenantId: number;
  name: string;
  unitNumber: string | null;
  unitType: string | null;
  monthlyRent: number;
  moveInDate: string | null;
  waterEnabled: boolean;
}

export async function getPortalIdentity(tenantId: number): Promise<PortalIdentity> {
  const row = await queryOne<{
    id: number; full_name: string; unit_number: string | null; unit_type: string | null;
    monthly_rent: string; move_in_date: string | null; water_enabled: boolean;
  }>(
    `SELECT t.id, t.full_name, u.unit_number, u.unit_type, u.monthly_rent,
            t.move_in_date, u.water_enabled
     FROM tenants t LEFT JOIN units u ON u.id = t.unit_id
     WHERE t.id = $1 AND t.status = 'ACTIVE'`,
    [tenantId]
  );
  if (!row) throw forbidden('This tenancy has ended. Contact your property manager.');
  return {
    tenantId: row.id,
    name: row.full_name,
    unitNumber: row.unit_number,
    unitType: row.unit_type,
    monthlyRent: Number(row.monthly_rent),
    moveInDate: row.move_in_date,
    waterEnabled: row.water_enabled,
  };
}

export interface PortalSummary {
  identity: PortalIdentity;
  currency: string;
  reportingYear: number;
  rentThisMonth: { billed: number; paid: number; balance: number; status: string };
  waterThisMonth: { billed: number; paid: number; balance: number; consumption: string | null };
  ytd: { rentPaid: number; waterPaid: number; rentBalance: number; waterBalance: number };
  deposit: number;
}

export async function getPortalSummary(tenantId: number): Promise<PortalSummary> {
  const settings = await getSettings();
  const year = settings.reporting_year;
  const month = new Date().getMonth() + 1;
  const identity = await getPortalIdentity(tenantId);

  // The tenant ledger already computes exactly the per-month + YTD figures
  // the portal needs — reuse it so the portal can never drift from what the
  // office sees on the Tenant Ledger page.
  const { tenantLedger } = await import('./financeService');
  const ledger = (await tenantLedger(tenantId, year)) as {
    months: Array<{
      month: number; expectedRent: string | number; rentPaid: string | number;
      waterBill: string | number; waterPaid: string | number;
      rentBalance: string | number; waterBalance: string | number;
      consumption: string | null;
    }>;
    totals: { rentPaid: number; waterPaid: number; rentBalance: number; waterBalance: number };
  };

  const m = ledger.months.find((x) => x.month === month);
  const rentBilled = Number(m?.expectedRent ?? identity.monthlyRent);
  const rentPaid = Number(m?.rentPaid ?? 0);
  const waterBilled = Number(m?.waterBill ?? 0);
  const waterPaid = Number(m?.waterPaid ?? 0);

  // Current-month rent status mirrors the Tenants page badge semantics.
  const status = rentPaid >= rentBilled && rentBilled > 0
    ? 'PAID'
    : rentPaid > 0
      ? 'PARTIAL'
      : 'UNPAID';

  return {
    identity,
    currency: settings.currency,
    reportingYear: year,
    rentThisMonth: { billed: rentBilled, paid: rentPaid, balance: Math.max(0, rentBilled - rentPaid), status },
    waterThisMonth: {
      billed: waterBilled,
      paid: waterPaid,
      balance: Math.max(0, waterBilled - waterPaid),
      consumption: m?.consumption ?? null,
    },
    ytd: ledger.totals,
    deposit: await getDeposit(tenantId),
  };
}

async function getDeposit(tenantId: number): Promise<number> {
  const row = await queryOne<{ security_deposit: string }>(
    'SELECT security_deposit FROM tenants WHERE id = $1',
    [tenantId]
  );
  return Number(row?.security_deposit ?? 0);
}

export async function getPortalPayments(tenantId: number, limit = 24): Promise<unknown[]> {
  const rent = await query(
    `SELECT 'RENT' AS kind, payment_date, billing_month, billing_year, amount, payment_method, receipt_number
     FROM rent_payments WHERE tenant_id = $1
     ORDER BY payment_date DESC, id DESC LIMIT $2`,
    [tenantId, Math.min(limit, 100)]
  );
  const water = await query(
    `SELECT 'WATER' AS kind, payment_date, billing_month, billing_year, amount, payment_method, receipt_number
     FROM water_payments WHERE tenant_id = $1
     ORDER BY payment_date DESC, id DESC LIMIT $2`,
    [tenantId, Math.min(limit, 100)]
  );
  return [...rent, ...water]
    .sort((a, b) => (a.payment_date < b.payment_date ? 1 : -1))
    .slice(0, limit);
}

export async function getPortalWaterReadings(tenantId: number, limit = 12): Promise<unknown[]> {
  return query(
    `SELECT r.reading_date, r.billing_month, r.billing_year,
            r.previous_reading, r.current_reading, r.consumption,
            r.water_rate, r.water_bill
     FROM water_meter_readings r
     WHERE r.tenant_id = $1
     ORDER BY r.billing_year DESC, r.billing_month DESC
     LIMIT $2`,
    [tenantId, Math.min(limit, 24)]
  );
}

export async function getPortalReceipts(tenantId: number, limit = 12): Promise<unknown[]> {
  return query(
    `SELECT id, receipt_number, receipt_type, payment_date, billing_month, billing_year,
            rent_amount, water_amount, total_amount, balance
     FROM receipts WHERE tenant_id = $1
     ORDER BY generated_at DESC LIMIT $2`,
    [tenantId, Math.min(limit, 24)]
  );
}

export async function portalPayRent(tenantId: number, amount: number): Promise<{
  checkoutRequestId: string;
  accountReference: string;
  provider: string;
}> {
  const result = await initiateTenantStkPush(tenantId, amount);
  return {
    checkoutRequestId: result.checkoutRequestId,
    accountReference: result.accountReference,
    provider: env.mpesaProvider,
  };
}

export async function getPortalPaymentInstructions(tenantId: number): Promise<{
  enabled: boolean;
  number: string | null;
  name: string | null;
  instructions: string | null;
  rentReference: string | null;
  waterReference: string | null;
}> {
  const [paybill, identity] = await Promise.all([
    getPaybillInstructions(),
    getPortalIdentity(tenantId),
  ]);
  const unit = identity.unitNumber?.trim() || null;
  return {
    ...paybill,
    rentReference: paybill.enabled ? unit : null,
    waterReference: paybill.enabled && identity.waterEnabled && unit ? `${unit}-WATER` : null,
  };
}

export async function portalStatementPdf(
  tenantId: number
): Promise<{ bytes: Uint8Array; tenantName: string; year: number }> {
  const settings = await getSettings();
  const { bytes, tenantName, year } = await tenantStatementPdf(tenantId, settings.reporting_year);
  return { bytes, tenantName, year };
}
