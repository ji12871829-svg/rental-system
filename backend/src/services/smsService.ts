import { poolExec, query, queryOne, type SqlExec } from '../config/db';
import { paginate } from './paginate';
import { env } from '../config/env';
import { MONTH_NAMES, type Pagination } from '../types';
import { combinedReceiptMessage, landlordAlertMessage, rentReceiptMessage, waterReceiptMessage, gsm7EffectiveLength, SMS_TWO_SEGMENT_GSM7_LIMIT } from '../utils/businessRules';
import { badRequest, notFound } from '../utils/httpError';
import { logAudit } from './auditService';
import { toNumber } from '../utils/money';
import { getBusinessIdentity, type BusinessIdentity } from './brandingService';
import { getCustomTemplate } from './templateService';
import { renderMergeFields } from '../utils/mergeFields';
import { autoSendEnabled as channelAutoSendEnabled, dispatchAfterCommit } from './outboundMessage';
import {
  africasTalkingBalance,
  evaluateBalance,
  getSmsConfig,
  normalizePhoneNumber,
  parseAtDeliveryOutcome,
  parseTextbeeDeliveryOutcome,
  sendSms,
  type AtDeliveryReport,
  type BalanceStatus,
  type DeliveryOutcome,
  type TextbeeWebhookEvent,
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
  // Payment date (receipts.payment_date) — present on live rows, fetched by
  // prepareForReceipt for the "received on" line. Optional so older callers
  // and test fixtures without it keep the previous wording.
  payment_date?: string | Date;
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
  template?: string | null;
}): string {
  // A user-customized Message Templates body (already rendered by the caller
  // with the receipt's merge vars) wins outright; everything below is the
  // hardcoded fallback so untouched installs behave exactly as before.
  if (opts.template) return opts.template;
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
    balance: toNumber(receipt.balance),
    currency: opts.currency,
    businessIdentity,
  };
  if (receipt.receipt_type === 'WATER') {
    return waterReceiptMessage({ ...base, waterPaid: toNumber(receipt.water_amount) });
  }
  if (receipt.receipt_type === 'COMBINED') {
    return combinedReceiptMessage({
      ...base,
      rentPaid: toNumber(receipt.rent_amount),
      waterPaid: toNumber(receipt.water_amount),
      totalPaid: toNumber(receipt.total_amount),
    });
  }
  return rentReceiptMessage({ ...base, rentPaid: toNumber(receipt.rent_amount) });
}

// Resolves the user-editable receipt template (Message Templates page),
// rendered with the receipt's merge vars — or null when no customized row
// exists, in which case buildMessage's hardcoded spec wording is unchanged.
// The lookup runs on a normal pooled connection (read-only) while the caller's
// payment transaction keeps using `exec`.
async function resolveReceiptTemplate(
  receipt: ReceiptLike,
  vars: { name: string; unit: string; currency: string; business: string },
): Promise<string | null> {
  const kind =
    receipt.receipt_type === 'RENT' ? 'SMS_RENT_RECEIPT'
    : receipt.receipt_type === 'WATER' ? 'SMS_WATER_RECEIPT'
    : 'SMS_COMBINED_RECEIPT';
  const custom = await getCustomTemplate(kind);
  if (!custom) return null;
  const common = {
    ...vars,
    month: MONTH_NAMES[receipt.billing_month - 1],
    year: receipt.billing_year,
    receipt: receipt.receipt_number,
    date: receipt.payment_date !== undefined ? calendarDate(receipt.payment_date) : '',
  };
  const fullVars: Record<string, string | number> =
    receipt.receipt_type === 'RENT'
      ? { ...common, amount: toNumber(receipt.rent_amount), balance: toNumber(receipt.balance) }
      : receipt.receipt_type === 'WATER'
        ? { ...common, amount: toNumber(receipt.water_amount), balance: toNumber(receipt.balance) }
        : {
            ...common,
            rent: toNumber(receipt.rent_amount),
            water: toNumber(receipt.water_amount),
            total: toNumber(receipt.total_amount),
            balance: toNumber(receipt.balance),
          };
  return renderMergeFields(custom.body, fullVars);
}

// Calendar date for SMS text: pg DATE columns arrive as Date objects
// (midnight UTC) or ISO strings — either way the YYYY-MM-DD prefix is the
// wall date the operator and tenant both recognize. No time, no timezone
// math, and ASCII-only for the GSM-7 budget.
function calendarDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// The ONE persist point for SMS: creates a PENDING sms_notifications row and
// returns its id. Every caller that queues an SMS — receipt notifications,
// the Tenant reminder module — funnels through here. Pass the enclosing
// transaction's `exec` to queue inside a payment transaction.
export interface QueueSmsInput {
  /** NULL for owner-facing rows (landlord alerts) — never tenant-scoped. */
  tenantId: number | null;
  phoneNumber: string;
  message: string;
  receiptId?: number | null;
  templateKind?: string | null;
}

export async function queueSms(input: QueueSmsInput, exec: SqlExec = poolExec): Promise<number | null> {
  const inserted = await exec.query(
    `INSERT INTO sms_notifications (receipt_id, tenant_id, phone_number, message, status, template_kind)
     VALUES ($1, $2, $3, $4, 'PENDING', $5)
     RETURNING id`,
    [input.receiptId ?? null, input.tenantId, input.phoneNumber, input.message, input.templateKind ?? null]
  );
  return inserted.rows[0]?.id ?? null;
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

  // Received-on date for the receipt wording. Read in-transaction (same exec)
  // so a receipt created moments ago in the caller's uncommitted transaction
  // is visible; absent on older in-memory shapes, which keep prior wording.
  const paidOn = await exec.query(
    'SELECT payment_date FROM receipts WHERE id = $1',
    [receipt.id],
  );
  const paidDate = paidOn.rows[0]?.payment_date as string | Date | undefined;
  if (paidDate !== undefined) receipt.payment_date = paidDate;

  // Identity comes from business_branding (DB, env fallback) so Settings
  // edits apply to new SMS immediately.
  const identity = await getBusinessIdentity();
  const template = await resolveReceiptTemplate(receipt, {
    name: row.full_name,
    unit: row.unit_number ?? '',
    currency: row.currency,
    business: identity.name ?? '',
  });
  const message = buildMessage(receipt, {
    tenantName: row.full_name,
    unitNumber: row.unit_number,
    currency: row.currency,
    identity,
    template,
  });
  return queueSms(
    { tenantId: receipt.tenant_id, phoneNumber: row.phone_number, message, receiptId: receipt.id },
    exec
  );
}

// The landlord (owner) payment alert: a PENDING sms row on the operator's own
// business contact phone, prepared on the caller's payment transaction
// exactly like the tenant's receipt SMS. Gated by
// settings.notify_landlord_on_payment and by a contact phone being on file
// in Business Identity. tenant_id stays NULL — the alert is not the tenant's
// message, so tenant-scoped history views can never match it. Returns the new
// row's id (for post-commit auto-dispatch) or null when nothing should queue.
// RENT/COMBINED gating is the seam's job (postPaymentDispatch) — money into
// the rent book, not a water top-up.
export async function prepareLandlordAlert(
  receipt: ReceiptLike,
  exec: SqlExec = poolExec
): Promise<number | null> {
  const row = (
    await exec.query(
      `SELECT t.full_name, u.unit_number, s.currency, s.notify_landlord_on_payment
       FROM tenants t
       JOIN units u ON u.id = t.unit_id
       JOIN settings s ON s.id = 1
       WHERE t.id = $1`,
      [receipt.tenant_id]
    )
  ).rows[0];
  if (!row || !row.notify_landlord_on_payment) return null;

  const identity = await getBusinessIdentity();
  const phone = identity.phone?.trim();
  if (!phone) return null; // no contact phone on file → nothing to alert

  const amount = toNumber(receipt.total_amount);
  const monthName = MONTH_NAMES[receipt.billing_month - 1];
  const custom = await getCustomTemplate('SMS_LANDLORD_ALERT');
  const message = custom
    ? renderMergeFields(custom.body, {
        name: row.full_name,
        unit: row.unit_number ?? '',
        month: monthName,
        year: receipt.billing_year,
        amount,
        balance: toNumber(receipt.balance),
        receipt: receipt.receipt_number,
        currency: row.currency,
        business: identity.name ?? '',
      })
    : landlordAlertMessage({
        tenantName: row.full_name,
        unitNumber: row.unit_number ?? '',
        monthName,
        year: receipt.billing_year,
        amountPaid: amount,
        receiptNumber: receipt.receipt_number,
        balance: toNumber(receipt.balance),
        currency: row.currency,
        businessIdentity: identity.name ?? undefined,
      });
  return queueSms(
    { tenantId: null, phoneNumber: phone, message, receiptId: receipt.id, templateKind: 'LANDLORD_ALERT' },
    exec
  );
}

// The SMS channel's entry point into the Outbound Message module's seam (one
// implementation shared with email): auto-dispatch a freshly prepared
// notification AFTER its payment transaction commits. A failed auto-send
// leaves the row FAILED (reason recorded) for retry from the SMS history page.
// Disabled by SMS_AUTO_SEND=false; the test environment always opts out so
// integration tests exercise the manual send explicitly.
export function dispatchAutoSend(
  smsId: number | null | undefined,
  sender: (id: number) => Promise<unknown> = sendSmsNotification
): void {
  if (!smsId) return; // no phone → nothing was prepared
  dispatchAfterCommit({ channel: 'SMS', what: `notification ${smsId}`, run: () => sender(smsId) });
}

// Whether a freshly prepared notification will actually be dispatched —
// lets payment responses tell the UI honestly what happened to the receipt
// SMS (queued-but-manual vs auto-sent vs not queued at all). The channel gate
// itself lives in the Outbound Message module.
export function autoSendEnabled(): boolean {
  return channelAutoSendEnabled('SMS');
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
export async function sendSmsNotification(id: number, opts: { templateKind?: string | null } = {}): Promise<unknown> {
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
    // A network-level block (e.g. recipient DND) is never going to clear
    // with a retry — the retry job would just re-spend $0 on a fixed delay.
    // Keep FAILED but remove the next_retry_at deadline so the sweep stops
    // touching this row (it can still be sent manually).
    const isDnd = (result.failureReason ?? '').toLowerCase().includes('dnd');
    const attempts = await queryOne<{ n: string }>(
      'SELECT attempt_count::text AS n FROM sms_notifications WHERE id = $1',
      [id]
    );
    const attemptCount = Number(attempts?.n ?? 0) + 1;
    const giveUp = attemptCount >= env.smsMaxSendAttempts;
    const delayMs = env.smsRetryEnabled && !isDnd && !giveUp ? env.smsRetryBaseDelayMs * Math.pow(5, attemptCount - 1) : null;
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
  await query(
    `UPDATE sms_notifications SET template_kind = $2 WHERE id = $1 AND template_kind IS NULL`,
    [id, opts.templateKind ?? null],
  );
  return queryOne('SELECT * FROM sms_notifications WHERE id = $1', [id]);
}

// --- Tenant SMS campaign (one composition, many recipients) -------------------
// Mirrors the tenant email campaign: one operator-typed message carrying
// {{name}} / {{unit}} tokens, personalised and queued per ACTIVE tenant.
// Every row goes through queueSms + dispatchAutoSend, so a campaign row
// behaves exactly like a hand-queued reminder: auto-sent when the pipeline
// is on, otherwise PENDING for manual send from the SMS page. Sends complete
// after the response (fire-and-forget by design — a slow provider must never
// hold the HTTP response), so the result counts queueing, not delivery:
// per-recipient SENT/FAILED lands in the SMS history.
//
// Cost guard: each rendered message must fit the two-segment GSM-7 budget.
// Over-long renders are counted as tooLong and never queued — a multi-part
// blast to dozens of tenants must be a conscious edit, not an accident.
export async function sendTenantSmsCampaign(opts: {
  tenantIds?: number[];
  message: string;
  userId?: number | null;
}): Promise<{ total: number; queued: number; skipped: number; tooLong: number }> {
  const params: unknown[] = [];
  const where = opts.tenantIds?.length ? `AND t.id = ANY($1::int[])` : '';
  if (opts.tenantIds?.length) params.push(opts.tenantIds);
  const tenants = await query<{ id: number; full_name: string; phone_number: string | null; unit_number: string | null }>(
    `SELECT t.id, t.full_name, t.phone_number, u.unit_number
     FROM tenants t LEFT JOIN units u ON u.id = t.unit_id
     WHERE t.status = 'ACTIVE' ${where}
     ORDER BY t.id`,
    params
  );
  let queued = 0;
  let skipped = 0;
  let tooLong = 0;
  for (const tenant of tenants) {
    if (!tenant.phone_number?.trim()) {
      skipped += 1;
      continue;
    }
    const rendered = renderMergeFields(opts.message, {
      name: tenant.full_name,
      unit: tenant.unit_number ?? '',
    });
    if (gsm7EffectiveLength(rendered) > SMS_TWO_SEGMENT_GSM7_LIMIT) {
      tooLong += 1;
      continue;
    }
    const smsId = await queueSms({ tenantId: tenant.id, phoneNumber: tenant.phone_number, message: rendered });
    if (smsId === null) {
      skipped += 1;
      continue;
    }
    queued += 1;
    dispatchAutoSend(smsId);
  }
  await logAudit({
    userId: opts.userId ?? null,
    action: 'TENANT_SMS_CAMPAIGN',
    entity: 'tenants',
    newValue: { total: tenants.length, queued, skipped, tooLong, message: opts.message.slice(0, 160) },
  });
  return { total: tenants.length, queued, skipped, tooLong };
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

// --- textbee webhook ---------------------------------------------------------
// Delivery events reuse applyDeliveryReport unchanged: the textbee outcome
// maps onto the same vocabulary, and the batch id our send stored as
// provider_message_id is the join key. The recipient is matched too — our
// sends are one recipient per batch, but a shared batch id must never flip a
// sibling row, and stored numbers are operator-typed (0714…) while textbee
// reports E.164 (+254…), so both sides normalize before comparing.

export async function applyTextbeeDeliveryReport(event: TextbeeWebhookEvent): Promise<DeliveryReportUpdate> {
  const outcome = parseTextbeeDeliveryOutcome(event);
  if (!outcome || !event.smsBatchId) {
    return { matched: false, outcome, alreadySet: false };
  }
  if (event.recipient) {
    const reported = normalizePhoneNumber(event.recipient);
    const stored = await queryOne<{ phone_number: string }>(
      `SELECT phone_number FROM sms_notifications WHERE provider_message_id = $1 ORDER BY id DESC LIMIT 1`,
      [event.smsBatchId]
    );
    const ours = stored ? normalizePhoneNumber(stored.phone_number) : null;
    if (!reported || !ours || reported !== ours) {
      return { matched: false, outcome, alreadySet: false };
    }
  }
  return applyDeliveryReport({
    messageId: event.smsBatchId,
    status: outcome === 'DELIVERED' ? 'Success' : (event.errorMessage || 'Failed'),
  });
}

export interface ReceivedSms {
  id: number;
  sender: string;
  message: string;
  device_id: string | null;
  received_at: string | null;
  read_at: string | null;
  created_at: string;
  tenant_id: number | null;
  tenant_name: string | null;
  unit_number: string | null;
}

// Inbound tenant reply (MESSAGE_RECEIVED): no receipt/reminder row to attach
// to, so it lands in sms_inbox. Dedupe on the webhook idempotency key —
// textbee retries a delivery up to 10 times with the same key.
export async function recordReceivedSms(input: {
  sender: string;
  message?: string;
  deviceId?: string;
  textbeeSmsId?: string;
  idempotencyKey?: string;
  receivedAt?: string;
}): Promise<{ id: number; duplicate: boolean }> {
  if (input.idempotencyKey) {
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM sms_inbox WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );
    if (existing) return { id: existing.id, duplicate: true };
  }
  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO sms_inbox (sender, message, device_id, textbee_sms_id, idempotency_key, received_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.sender,
      input.message ?? '',
      input.deviceId ?? null,
      input.textbeeSmsId ?? null,
      input.idempotencyKey ?? null,
      input.receivedAt ?? null,
    ]
  );
  return { id: inserted!.id, duplicate: false };
}

// Inbox list, newest-first, with each sender resolved to an ACTIVE tenant
// where the number matches (E.164 both sides — stored numbers are
// operator-typed). One tenant query per page, matched in JS: phone
// normalization lives in code, not SQL.
export async function listInbox(filters: { page: number; limit: number; unreadOnly?: boolean }): Promise<{ rows: ReceivedSms[]; pagination: Pagination }> {
  const where = filters.unreadOnly ? `WHERE read_at IS NULL` : '';
  const { rows, pagination } = await paginate<Record<string, unknown>>({
    selectSql: `id, sender, message, device_id, received_at, read_at, created_at`,
    tableSql: `FROM sms_inbox`,
    whereSql: where,
    params: [],
    orderBy: `ORDER BY created_at DESC`,
    page: filters.page,
    limit: filters.limit,
  });
  const senders = [...new Set(rows.map((r) => String(r.sender)))];
  const tenants = senders.length
    ? await query<{ id: number; full_name: string; phone_number: string | null; unit_number: string | null }>(
        `SELECT t.id, t.full_name, t.phone_number, u.unit_number
         FROM tenants t LEFT JOIN units u ON u.id = t.unit_id
         WHERE t.status = 'ACTIVE'`
      )
    : [];
  const byPhone = new Map<string, { id: number; full_name: string; unit_number: string | null }>();
  for (const t of tenants) {
    const normalized = t.phone_number ? normalizePhoneNumber(t.phone_number) : null;
    if (normalized && !byPhone.has(normalized)) byPhone.set(normalized, { id: t.id, full_name: t.full_name, unit_number: t.unit_number });
  }
  return {
    rows: rows.map((r) => {
      const match = byPhone.get(normalizePhoneNumber(String(r.sender)) ?? '') ?? null;
      return {
        id: Number(r.id),
        sender: String(r.sender),
        message: String(r.message ?? ''),
        device_id: r.device_id === null ? null : String(r.device_id),
        received_at: r.received_at === null ? null : String(r.received_at),
        read_at: r.read_at === null ? null : String(r.read_at),
        created_at: String(r.created_at),
        tenant_id: match?.id ?? null,
        tenant_name: match?.full_name ?? null,
        unit_number: match?.unit_number ?? null,
      };
    }),
    pagination,
  };
}

export async function markInboxRead(id: number): Promise<unknown> {
  const row = await queryOne(
    `UPDATE sms_inbox SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 RETURNING *`,
    [id]
  );
  if (!row) throw notFound('Inbox message not found.');
  return row;
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
  const cfg = await getSmsConfig();
  if (cfg.provider === 'textbee') {
    // There is no pre-paid wallet to check: the send is relayed by a phone's
    // own SIM, so the cost is whatever the carrier bundle covers. Saying
    // "balance unknown" here would imply a missing credential — it isn't.
    return {
      state: 'unknown',
      reason: 'No wallet balance: SMS_PROVIDER=textbee sends from the phone\'s own SIM, so cost is your carrier bundle. Watch the free-tier quota (50/day, 300/month) on the textbee dashboard instead.',
    };
  }
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
  const cfg = await getSmsConfig();

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
