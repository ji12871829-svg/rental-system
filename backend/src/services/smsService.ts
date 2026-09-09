import { poolExec, query, queryOne, type SqlExec } from '../config/db';
import { env, isTest } from '../config/env';
import { MONTH_NAMES, type Pagination } from '../types';
import { combinedReceiptMessage, rentReceiptMessage, waterReceiptMessage } from '../utils/businessRules';
import { notFound } from '../utils/httpError';
import { n } from '../utils/money';
import { getBusinessIdentity, type BusinessIdentity } from './brandingService';
import {
  africasTalkingBalance,
  evaluateBalance,
  getSmsConfig,
  parseAtDeliveryOutcome,
  sendSms,
  type AtDeliveryReport,
  type BalanceStatus,
  type DeliveryOutcome,
} from './smsProvider';

interface ReceiptLike {
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

  // The count needs the same joins as the list query — the q filter can
  // reference t.full_name (and would 500 with a missing FROM-clause otherwise).
  const totalRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM sms_notifications s
     JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN units u ON u.id = t.unit_id
     ${whereSql}`,
    params
  );
  const total = Number(totalRow?.count ?? 0);
  const offset = (filters.page - 1) * filters.limit;
  const rows = await query(
    `SELECT s.*, t.full_name AS tenant_name, u.unit_number
     FROM sms_notifications s
     JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN units u ON u.id = t.unit_id
     ${whereSql}
     ORDER BY s.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset]
  );
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
    pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
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
