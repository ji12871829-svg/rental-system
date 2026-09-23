import { poolExec, query, queryOne, type SqlExec } from '../config/db';
import { paginate } from './paginate';
import { env, isTest } from '../config/env';
import { MONTH_NAMES, type Pagination } from '../types';
import { balanceDue, combinedReceiptMessage, monthlyBalanceDueMessage, overdueNoticeMessage, rentReceiptMessage, waterReceiptMessage, whatsappBalanceDueMessage, whatsappOverdueMessage } from '../utils/businessRules';
import { badRequest, notFound } from '../utils/httpError';
import { logAudit } from './auditService';
import { n, round2 } from '../utils/money';
import { getBusinessIdentity, getPaybillInstructions, type BusinessIdentity } from './brandingService';
import { getSettings } from './settingsService';
import { composeRentStatementEmail } from '../utils/emailTemplates';
import { queueReminderEmail } from './emailService';
import {
  africasTalkingBalance,
  evaluateBalance,
  getSmsConfig,
  normalizePhoneNumber,
  parseAtDeliveryOutcome,
  sendSms,
  type AtDeliveryReport,
  type BalanceStatus,
  type DeliveryOutcome,
} from './smsProvider';

// Structural superset of ReceiptRow (receiptService) — any created receipt
// satisfies it, so payment transactions can pass their receipt straight in.
export interface ReceiptLike {
  id: number;
  receipt_number: string;
  receipt_type: 'RENT' | 'WATER' | 'COMBINED';
  tenant_id: number;
  billing_month: number;
  billing_year: number;
  rent_amount: string;
  water_amount: string;
  total_amount: string;
  balance: string;
}

// Builds the SMS text for a receipt (spec §34 examples). When a business
// identity exists (DB business_branding with env fallbacks, or explicit
// identity passed by tests), a compact identity block is appended on one
// line: name + Reg. No. (kept — the legal identifier), a proof-of-payment
// phrase and a plain-text contact line. Contacts are the first thing dropped
// if a long name/receipt would push the message past two GSM-7 SMS segments;
// the legal identity never is. Contacts are plain text because SMS cannot
// carry markup — phones auto-linkify numbers/emails and the SMS history
// modal renders links.
/**
 * Exported for backend/tests/unit/buildMessage.test.ts, which must load this
 * module via a runtime require() (env vars must be set before env.ts reads
 * them at import time) — invisible to static import analysis (knip).
 * @public
 */
export function buildMessage(receipt: ReceiptLike, opts: {
  tenantName: string;
  unitNumber: string;
  currency: string;
  identity?: BusinessIdentity;
}): string {
  const id = opts.identity ?? {
    name: env.businessName.trim() || null,
    regNo: env.businessRegNo.trim() || null,
    phone: env.businessPhone.trim() || null,
    email: env.businessEmail.trim() || null,
  };
  const name = id.name?.trim() || '';
  const regNo = id.regNo?.trim() || '';
  const phone = id.phone?.trim() || '';
  const email = id.email?.trim() || '';
  const contact = [phone ? `Tel ${phone}` : undefined, email ? `Email ${email}` : undefined]
    .filter(Boolean)
    .join(' ');
  const identityVariants = [
    // Full: legal identity + contacts + proof.
    [name ? `${name}${regNo ? `, Reg No ${regNo}` : ''}` : undefined, contact || undefined, 'Proof of payment']
      .filter(Boolean)
      .join(' - '),
    // Degraded: drop contacts, keep the legal identity + proof.
    name ? `${name}${regNo ? `, Reg No ${regNo}` : ''} - Proof of payment` : undefined,
    // Minimal: legal identity only.
    name ? `${name}${regNo ? `, Reg No ${regNo}` : ''}` : undefined,
  ].filter((v): v is string => Boolean(v && v.trim()));
  const businessIdentity = identityVariants.length ? identityVariants : undefined;

  const monthName = MONTH_NAMES[receipt.billing_month - 1];
  const base = {
    tenantName: opts.tenantName,
    unitNumber: opts.unitNumber,
    monthName,
    year: receipt.billing_year,
    receiptNumber: receipt.receipt_number,
    balance: n(receipt.balance),
    currency: opts.currency,
    businessIdentity,
  };
  if (receipt.receipt_type === 'WATER') {
    return waterReceiptMessage({ ...base, waterPaid: n(receipt.water_amount) });
  }
  if (receipt.receipt_type === 'COMBINED') {
    return combinedReceiptMessage({
      ...base,
      rentPaid: n(receipt.rent_amount),
      waterPaid: n(receipt.water_amount),
      totalPaid: n(receipt.total_amount),
    });
  }
  return rentReceiptMessage({ ...base, rentPaid: n(receipt.rent_amount) });
}

// Creates a PENDING sms_notifications row for a receipt (called inside the
// payment transaction via the injected `exec`). Returns the new row's id so
// the caller can auto-dispatch it after commit, or null when there is nothing
// to notify (no tenant phone).
export async function prepareForReceipt(
  receipt: ReceiptLike,
  exec: SqlExec = poolExec
): Promise<number | null> {
  const tenant = await exec.query(
    `SELECT t.full_name, t.phone_number, u.unit_number, s.currency
     FROM tenants t
     JOIN units u ON u.id = t.unit_id
     JOIN settings s ON s.id = 1
     WHERE t.id = $1`,
    [receipt.tenant_id]
  );
  const row = tenant.rows[0];
  if (!row || !row.phone_number) return null; // no phone → nothing to notify

  // Identity comes from business_branding (DB, env fallback) so Settings
  // edits apply to new SMS immediately.
  const message = buildMessage(receipt, {
    tenantName: row.full_name,
    unitNumber: row.unit_number,
    currency: row.currency,
    identity: await getBusinessIdentity(),
  });
  const inserted = await exec.query(
    `INSERT INTO sms_notifications (receipt_id, tenant_id, phone_number, message, status)
     VALUES ($1, $2, $3, $4, 'PENDING')
     RETURNING id`,
    [receipt.id, receipt.tenant_id, row.phone_number, message]
  );
  return inserted.rows[0]?.id ?? null;
}

// Auto-dispatch a freshly prepared notification AFTER its payment transaction
// commits. Fire-and-forget by design: a provider outage must never fail a
// recorded payment, and a slow provider must never hold the HTTP response.
// A failed auto-send leaves the row FAILED (reason recorded) for retry from
// the SMS history page. Disabled by SMS_AUTO_SEND=false; the test environment
// always opts out so integration tests exercise the manual send explicitly.
export function dispatchAutoSend(
  smsId: number | null | undefined,
  sender: (id: number) => Promise<unknown> = sendSmsNotification
): void {
  if (!smsId || isTest || !env.smsAutoSend) return;
  setTimeout(() => {
    sender(smsId).catch((err) => {
      console.error(`[sms] auto-send failed for notification ${smsId}: ${(err as Error).message}`);
    });
  }, 0);
}

// Whether a freshly prepared notification will actually be dispatched —
// lets payment responses tell the UI honestly what happened to the receipt
// SMS (queued-but-manual vs auto-sent vs not queued at all).
export function autoSendEnabled(): boolean {
  return env.smsAutoSend && !isTest;
}

// --- Staff reminder SMS (statement / overdue notice) -------------------------
// Composes the reminder templates (businessRules) from the tenant's LIVE
// ledger figures — the same move-in-aware expected-rent math the tenant
// detail view uses — and queues a PENDING sms_notifications row for the
// manual send from the SMS history page (or auto-send when enabled).
// Reminder templates reference a paybill/account line when branding has one.
// The shared figures every reminder channel composes from. previousRent
// (YTD expected minus THIS month's expected) drives the statement's
// "Previous Balance" line; currentRent is this month's rent.
interface ReminderFigures {
  tenantName: string;
  phoneNumber: string | null;
  email: string | null;
  unitNumber: string;
  monthName: string;
  year: number;
  currency: string;
  currentRent: number;
  previousRentBalance: number;
  waterBalance: number;
  rentBalance: number;
  combinedBalance: number;
  paymentMethod: string;
  accountNumber: string;
  identityName: string | null;
}

async function gatherReminderFigures(tenantId: number): Promise<ReminderFigures> {
  const tenant = await queryOne<{
    full_name: string;
    phone_number: string | null;
    email: string | null;
    unit_number: string | null;
    move_in_date: string;
    move_out_date: string | null;
  }>(
    `SELECT t.full_name, t.phone_number, t.email, u.unit_number, t.move_in_date, t.move_out_date
     FROM tenants t
     LEFT JOIN units u ON u.id = t.unit_id
     WHERE t.id = $1`,
    [tenantId],
  );
  if (!tenant) throw notFound('Tenant not found.');

  const settings = await getSettings();
  const year = settings.reporting_year;
  const month = new Date().getUTCMonth() + 1;
  const monthName = MONTH_NAMES[month - 1];

  // Move-in-aware expected rent YTD — mirrors tenantService.getTenant (spec §46).
  const rentExpectedYtd = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(u.monthly_rent * occ.months), 0)::text AS v
     FROM tenants t
     JOIN units u ON u.id = t.unit_id
     JOIN LATERAL (
       SELECT COUNT(*)::int AS months
       FROM generate_series(1, $3::int) AS mm
       WHERE t.move_in_date <= (DATE ($2::text || '-01-01') + mm * INTERVAL '1 month' - INTERVAL '1 day')
         AND (t.move_out_date IS NULL OR t.move_out_date >= (DATE ($2::text || '-01-01') + (mm - 1) * INTERVAL '1 month'))
     ) occ ON TRUE
     WHERE t.id = $1`,
    [tenantId, year, month],
  ))?.v);
  // This month's expected rent alone (for the statement's Current Rent line).
  const currentRent = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(u.monthly_rent, 0)::text AS v
     FROM tenants t LEFT JOIN units u ON u.id = t.unit_id WHERE t.id = $1`,
    [tenantId],
  ))?.v);
  const rentPaid = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS v FROM rent_payments WHERE tenant_id = $1 AND billing_year = $2`,
    [tenantId, year],
  ))?.v);
  const waterBilled = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(wmr.water_bill), 0)::text AS v
     FROM water_meter_readings wmr JOIN tenants t ON t.unit_id = wmr.unit_id
     WHERE t.id = $1 AND wmr.billing_year = $2`,
    [tenantId, year],
  ))?.v);
  const waterPaid = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS v FROM water_payments WHERE tenant_id = $1 AND billing_year = $2`,
    [tenantId, year],
  ))?.v);

  const rentBalance = balanceDue(rentExpectedYtd, rentPaid);
  const waterBalance = balanceDue(waterBilled, waterPaid);
  const combinedBalance = round2(rentBalance + waterBalance);
  // Previous balance = everything before this month: YTD expected minus this
  // month's rent, minus payments (floored at 0 — an overpaid tenant has no
  // "previous balance" to show).
  const previousRentBalance = Math.max(round2(rentBalance - Math.min(currentRent, rentBalance)), 0);

  const identity = await getBusinessIdentity();
  // Payment channel line: the reconciled paybill number when branding has
  // one, otherwise a generic instruction.
  const paybill = await getPaybillInstructions();
  const paymentMethod = paybill.enabled && paybill.number
    ? `M-Pesa PayBill ${paybill.number}`
    : 'M-Pesa or at the office';
  const accountNumber = `Unit ${tenant.unit_number ?? tenantId}`;

  return {
    tenantName: tenant.full_name,
    phoneNumber: tenant.phone_number,
    email: tenant.email,
    unitNumber: tenant.unit_number ?? String(tenantId),
    monthName,
    year,
    currency: settings.currency,
    currentRent,
    previousRentBalance,
    waterBalance,
    rentBalance,
    combinedBalance,
    paymentMethod,
    accountNumber,
    identityName: identity.name,
  };
}

export type ReminderKind = 'BALANCE_DUE' | 'OVERDUE';
export type ReminderChannel = 'SMS' | 'WHATSAPP' | 'EMAIL';
export interface ReminderResult {
  message: string;
  smsId: number | null;
  emailId: number | null;
  /** WhatsApp click-to-chat URL (wa.me) the operator opens — not queued. */
  whatsappUrl: string | null;
}

// Queue/compose a tenant reminder on the chosen channel.
//  * SMS — PENDING sms_notifications row (manual send or auto-send).
//  * WHATSAPP — nothing is queued or sent: returns a wa.me click-to-chat URL
//    with the text pre-filled. The operator reviews it in WhatsApp before
//    pressing send; there is no provider cost and no unreviewed outbound.
//  * EMAIL — PENDING email_notifications row (formal statement breakdown).
// Returns null (SMS/EMAIL) when the tenant lacks the channel's contact point.
export async function prepareReminder(
  tenantId: number,
  kind: ReminderKind,
  channel: ReminderChannel,
  opts: { userId?: number | null } = {},
): Promise<ReminderResult | null> {
  const f = await gatherReminderFigures(tenantId);
  const identity = { name: f.identityName, regNo: null };

  if (channel === 'WHATSAPP') {
    const text = kind === 'BALANCE_DUE'
      ? whatsappBalanceDueMessage({
          tenantName: f.tenantName,
          unitNumber: f.unitNumber,
          monthName: f.monthName,
          year: f.year,
          currentRent: f.currentRent,
          previousBalance: f.previousRentBalance,
          totalDue: Math.max(f.combinedBalance, 0),
          accountNumber: f.accountNumber,
          paymentMethod: f.paymentMethod,
          currency: f.currency,
        })
      : whatsappOverdueMessage({
          tenantName: f.tenantName,
          unitNumber: f.unitNumber,
          amountDue: Math.max(f.rentBalance, 0),
          supportPhone: (await getBusinessIdentity()).phone,
          currency: f.currency,
        });
    if (!f.phoneNumber) return null;
    const digits = f.phoneNumber.replace(/\D/g, '');
    // Kenya numbers stored as 07… normalize to 2547… for wa.me.
    const intl = digits.startsWith('0') ? `254${digits.slice(1)}` : digits;
    await logAudit({
      userId: opts.userId ?? null,
      action: 'REMINDER_WHATSAPP_COMPOSED',
      entity: 'tenant',
      entityId: tenantId,
      newValue: { kind },
    });
    return { message: text, smsId: null, emailId: null, whatsappUrl: `https://wa.me/${intl}?text=${encodeURIComponent(text)}` };
  }

  if (channel === 'EMAIL') {
    if (!f.email) return null;
    const composed = composeRentStatementEmail({
      tenantName: f.tenantName,
      unitNumber: f.unitNumber,
      monthName: f.monthName,
      year: f.year,
      previousBalance: f.previousRentBalance,
      currentRent: f.currentRent,
      utilitiesAmount: Math.max(f.waterBalance, 0),
      totalDue: Math.max(f.combinedBalance, 0),
      currency: f.currency,
      accountNumber: f.accountNumber,
      paymentMethod: f.paymentMethod,
      identity,
    });
    const emailRow = await queueReminderEmail({
      to: f.email,
      subject: composed.subject,
      html: composed.html,
      text: composed.text,
      tenantId,
    });
    await logAudit({
      userId: opts.userId ?? null,
      action: 'REMINDER_EMAIL_QUEUED',
      entity: 'tenant',
      entityId: tenantId,
      newValue: { kind, emailId: emailRow.id },
    });
    return { message: composed.text, smsId: null, emailId: emailRow.id, whatsappUrl: null };
  }

  // SMS (default)
  if (!f.phoneNumber) return null;
  const message = kind === 'BALANCE_DUE'
    ? monthlyBalanceDueMessage({
        tenantName: f.tenantName,
        unitNumber: f.unitNumber,
        monthName: f.monthName,
        year: f.year,
        totalDue: Math.max(f.combinedBalance, 0),
        accountNumber: f.accountNumber,
        paymentMethod: f.paymentMethod,
        currency: f.currency,
        businessIdentity: f.identityName ?? undefined,
      })
    : overdueNoticeMessage({
        tenantName: f.tenantName,
        unitNumber: f.unitNumber,
        amountDue: Math.max(f.rentBalance, 0),
        totalBalance: Math.max(f.combinedBalance, 0),
        currency: f.currency,
        businessIdentity: f.identityName ?? undefined,
      });
  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO sms_notifications (tenant_id, phone_number, message, status)
     VALUES ($1, $2, $3, 'PENDING')
     RETURNING id`,
    [tenantId, f.phoneNumber, message],
  );
  await logAudit({
    userId: opts.userId ?? null,
    action: 'SMS_REMINDER_QUEUED',
    entity: 'tenant',
    entityId: tenantId,
    newValue: { kind, smsId: inserted?.id ?? null },
  });
  return { message, smsId: inserted?.id ?? null, emailId: null, whatsappUrl: null };
}

export interface SmsFilters {
  page: number;
  limit: number;
  status?: string;
  tenantId?: number;
  q?: string;
}

export async function listSms(filters: SmsFilters): Promise<{
  rows: unknown[];
  pagination: Pagination;
  spendByCurrency: { currency: string; total: number }[];
}> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    params.push(filters.status);
    where.push(`s.status = $${params.length}`);
  }
  if (filters.tenantId) {
    params.push(filters.tenantId);
    where.push(`s.tenant_id = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(s.message ILIKE $${params.length} OR t.full_name ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows, pagination } = await paginate<Record<string, unknown>>({
    // The q filter can reference t.full_name, so the count window shares the
    // same JOINs as the list query.
    selectSql: `s.*, t.full_name AS tenant_name, u.unit_number`,
    tableSql: `FROM sms_notifications s
     JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN units u ON u.id = t.unit_id`,
    whereSql,
    params,
    orderBy: `ORDER BY s.created_at DESC`,
    page: filters.page,
    limit: filters.limit,
  });
  // Total provider-reported spend across the WHOLE filtered set (not just the
  // visible page), grouped by currency. Only SENT rows carry a cost —
  // simulated sends cost nothing and FAILED deliveries were never charged.
  const spendRows = await query<{ currency: string; total_cost: string }>(
    `SELECT s.provider_currency AS currency, SUM(s.provider_cost)::text AS total_cost
     FROM sms_notifications s
     JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN units u ON u.id = t.unit_id
     ${whereSql ? `${whereSql} AND` : 'WHERE'} s.status = 'SENT' AND s.provider_cost IS NOT NULL
     GROUP BY s.provider_currency
     ORDER BY s.provider_currency`,
    params
  );
  return {
    rows,
    pagination,
    spendByCurrency: spendRows.map((r) => ({ currency: r.currency, total: Number(r.total_cost) })),
  };
}

// Sends a PENDING or retry-due FAILED message via the configured provider
// (env SMS_PROVIDER — mock by default, Africa's Talking when configured) and
// records the outcome: SENT + provider_message_id + sent_at + provider cost,
// or FAILED + failure_reason. Every attempt increments attempt_count; a
// failure with attempts left schedules next_retry_at (exponential backoff —
// see smsRetryJob) unless retries are disabled (manual sends honor that too:
// the job, not the route, decides when automation touches a row).
export async function sendSmsNotification(id: number): Promise<unknown> {
  const row = await queryOne<{ id: number; phone_number: string; message: string; status: string }>(
    'SELECT id, phone_number, message, status FROM sms_notifications WHERE id = $1',
    [id]
  );
  if (!row) throw notFound('SMS notification not found.');

  const result = await sendSms({
    phoneNumber: row.phone_number,
    message: row.message,
  });

  if (result.ok) {
    await query(
      `UPDATE sms_notifications
       SET status = 'SENT',
           provider_message_id = $2,
           sent_at = NOW(),
           provider_cost = $3,
           provider_currency = $4,
           attempt_count = attempt_count + 1,
           next_retry_at = NULL
       WHERE id = $1`,
      [id, result.providerMessageId ?? null, result.cost?.amount ?? null, result.cost?.currency ?? null]
    );
  } else {
    const attempts = await queryOne<{ n: string }>(
      'SELECT attempt_count::text AS n FROM sms_notifications WHERE id = $1',
      [id]
    );
    const attemptCount = Number(attempts?.n ?? 0) + 1;
    const giveUp = attemptCount >= env.smsMaxSendAttempts;
    const delayMs = env.smsRetryEnabled && !giveUp ? env.smsRetryBaseDelayMs * Math.pow(5, attemptCount - 1) : null;
    await query(
      `UPDATE sms_notifications
       SET status = 'FAILED',
           failure_reason = $2,
           attempt_count = $3,
           next_retry_at = $4
       WHERE id = $1`,
      [id, result.failureReason ?? 'Unknown provider error', attemptCount, delayMs === null ? null : new Date(Date.now() + delayMs)]
    );
  }
  return queryOne('SELECT * FROM sms_notifications WHERE id = $1', [id]);
}

// Backfill for seeded receipts: creates PENDING SMS rows for any receipt
// that has none yet.
export async function backfillSms(): Promise<number> {
  const receipts = await query<ReceiptLike>(
    `SELECT r.* FROM receipts r
     WHERE NOT EXISTS (SELECT 1 FROM sms_notifications s WHERE s.receipt_id = r.id)`
  );
  let created = 0;
  for (const receipt of receipts) {
    await prepareForReceipt(receipt);
    created += 1;
  }
  return created;
}
// --- Delivery reports (provider callbacks) -----------------------------------

export interface DeliveryReportUpdate {
  matched: boolean;
  outcome: DeliveryOutcome | null;
  alreadySet: boolean;
}

/**
 * Apply one delivery report: find the SMS by the gateway's message id and
 * record the outcome. Delivery reports never mutate the send-lifecycle
 * status (SENT stays SENT) — a network failure must not arm the retry job
 * for a re-send that would bill the wallet twice. Idempotent: re-applying
 * an identical report is a no-op, and a decided outcome is never changed
 * (the gateway does not un-deliver a message).
 */
export async function applyDeliveryReport(report: AtDeliveryReport): Promise<DeliveryReportUpdate> {
  const outcome = parseAtDeliveryOutcome(report);
  if (!outcome || !report.messageId) {
    return { matched: false, outcome, alreadySet: false };
  }

  const row = await queryOne<{ id: number; delivery_status: string | null }>(
    `SELECT id, delivery_status FROM sms_notifications WHERE provider_message_id = $1 ORDER BY id DESC LIMIT 1`,
    [report.messageId]
  );
  if (!row) {
    return { matched: false, outcome, alreadySet: false };
  }
  if (row.delivery_status === outcome) {
    return { matched: true, outcome, alreadySet: true };
  }
  if (row.delivery_status) {
    // A different outcome was already recorded — keep the first decision.
    return { matched: true, outcome, alreadySet: true };
  }

  await query(
    `UPDATE sms_notifications
     SET delivery_status = $2, delivery_network = $3, delivery_updated_at = NOW()
     WHERE id = $1`,
    [row.id, outcome, report.networkCode?.slice(0, 10) ?? null]
  );
  return { matched: true, outcome, alreadySet: false };
}

// --- Account balance & low-balance warning -----------------------------------

// Balance check for the SMS page's warning banner. Only the Africa's Talking
// provider exposes a wallet-balance endpoint (GET /version1/user), so:
//   - the check runs only when SMS_PROVIDER=africastalking with credentials
//   - other providers report state 'unknown' (nothing to query, not an error)
//   - threshold comes from SMS_LOW_BALANCE_THRESHOLD (0/unset disables it)
// The endpoint never throws — failures degrade to 'unavailable' with the
// provider's reason, and the UI shows the mode banner instead of a warning.
export async function getSmsBalance(): Promise<BalanceStatus> {
  const cfg = getSmsConfig();
  if (cfg.provider !== 'africastalking' || !cfg.live) {
    return { state: 'unknown', reason: 'Balance is only available in live Africa\'s Talking mode.' };
  }
  const threshold = env.smsLowBalanceThreshold > 0 ? env.smsLowBalanceThreshold : null;
  try {
    const balance = await africasTalkingBalance();
    return evaluateBalance(balance, threshold);
  } catch (err) {
    return { state: 'unavailable', reason: (err as Error).message };
  }
}

// --- Test SMS (provider config verification) ----------------------------------

export interface TestSmsResult {
  ok: boolean;
  provider: string;
  live: boolean;
  to: string;
  senderId?: string;
  providerMessageId?: string;
  failureReason?: string;
  /** Provider-reported cost of the test send, when returned. */
  cost?: { amount: number; currency: string };
  latencyMs: number;
}

// Sends a one-off test SMS through the REAL configured provider and returns
// the provider's own verdict (message id / failure reason, reported cost,
// latency), so the Settings page can prove the config end-to-end. The
// recipient defaults to the requesting staff user's own phone — "verify it
// lands in MY pocket" is the natural test. Deliberately NOT recorded in
// sms_notifications — that history is tenant correspondence; the attempt is
// audit-logged instead. Mock mode still 'sends' so the wiring itself (route,
// normalisation, UI) can be verified without spending money.
export async function sendTestSms(opts: { to?: string; userId: number }): Promise<TestSmsResult> {
  const cfg = getSmsConfig();

  let to = opts.to?.trim() ?? '';
  if (!to) {
    const row = await queryOne<{ phone: string | null }>('SELECT phone FROM users WHERE id = $1', [opts.userId]);
    to = row?.phone?.trim() ?? '';
  }
  if (!to) {
    throw badRequest('Enter a recipient phone number — your user account has no phone on file.');
  }
  const normalized = normalizePhoneNumber(to);
  if (!normalized) {
    throw badRequest(`"${to}" is not a valid phone number.`);
  }

  const identity = await getBusinessIdentity();
  const name = identity.name?.trim() || 'Property Management';
  const message = `Test SMS from ${name}. If you received this, SMS sending is configured correctly. You can ignore this message.`;

  const started = Date.now();
  const result = await sendSms({ phoneNumber: normalized, message });
  const latencyMs = Date.now() - started;

  await logAudit({
    userId: opts.userId,
    action: 'SMS_TEST',
    entity: 'sms',
    entityId: null,
    newValue: { to: normalized, ok: result.ok, provider: cfg.provider, latencyMs },
  });

  return {
    ok: result.ok,
    provider: cfg.provider,
    live: cfg.live,
    to: normalized,
    senderId: cfg.senderId,
    providerMessageId: result.providerMessageId,
    failureReason: result.failureReason,
    cost: result.cost,
    latencyMs,
  };
}
