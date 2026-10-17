// Outbound WhatsApp module — the direct-delivery lifecycle for the WHATSAPP
// channel (sibling of smsService / emailService).
//
// Shape:
//   * queueWhatsapp — the ONE persist point: normalizes the recipient to a
//     Meta WhatsApp ID (digits, country code), INSERTs a PENDING row, audits
//     the queue. Every direct send funnels through it.
//   * sendWhatsappNotification — the send transition, mirroring
//     sendEmailNotification: refuses a SENT row ("already sent"), persists an
//     optional corrected recipient before the attempt so the history row
//     records exactly the number the send went to, then classifies the
//     provider outcome:
//       SENT       Meta accepted the message (wamid stored).
//       FAILED     transient (network, rate limit, 24-hour window, token
//                  expiry) — attempt_count increments and next_retry_at gets
//                  an exponential-backoff deadline so whatsappRetryJob
//                  replays it until success or the SMS_MAX_SEND_ATTEMPTS
//                  budget runs out.
//       ERRONEOUS  terminal — the number is not on WhatsApp (Meta code
//                  131026) or the message type is rejected; no deadline is
//                  scheduled, but the row stays manually sendable once the
//                  operator corrects the number.
//   * listWhatsapp — the history listing the WhatsApp page reads.
//
// The composed TEXT lives in reminderService (same wording either channel) —
// this module only carries it. The click-to-chat half (wa.me URLs) also
// lives in reminderService; here we deal exclusively with Cloud API rows.
import { pool, query, queryOne } from '../config/db';
import { env } from '../config/env';
import { logAudit } from './auditService';
import { badRequest, notFound } from '../utils/httpError';
import { paginate } from './paginate';
import type { Pagination } from '../types';
import {
  getWhatsappTemplates,
  normalizeWhatsAppNumber,
  sendCloudWhatsapp,
  WhatsAppDeliveryError,
} from './whatsappProvider';

export interface WhatsappRow {
  id: number;
  tenant_id: number | null;
  phone_number: string;
  message: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'ERRONEOUS';
  provider_message_id: string | null;
  /** For template rows: the registered WhatsApp template NAME. Null on free-form rows. */
  template_kind: string | null;
  /** For template rows: body parameters in the canonical {{1}}..{{6}} order. */
  template_params: string[] | null;
  attempt_count: number;
  next_retry_at: string | null;
  failure_reason: string | null;
  created_at: string;
  sent_at: string | null;
  // History-listing join columns (absent on lifecycle reads).
  tenant_name?: string | null;
  unit_number?: string | null;
}

// --- Queue transition ------------------------------------------------------------

interface QueueWhatsappInput {
  tenantId: number | null;
  /** Stored as recorded; normalized to Meta (254…) digits before use. */
  phoneNumber: string;
  message: string;
  /** Template rows: the registered template name (stored in template_kind). */
  templateKind?: string | null;
  /** Template rows: body parameters, persisted so retries replay the approved figures. */
  templateParams?: string[] | null;
  userId?: number | null;
}

// The queue transition is deliberately module-private: the ONE inbound seam
// is queuePreparedWhatsapp below (the reminder flow is the only producer).
async function queueWhatsapp(input: QueueWhatsappInput): Promise<WhatsappRow> {
  const intl = normalizeWhatsAppNumber(input.phoneNumber);
  if (!intl) {
    throw badRequest("The tenant's phone number is not a valid WhatsApp number.");
  }
  const { rows } = await pool.query<WhatsappRow>(
    `INSERT INTO whatsapp_notifications (tenant_id, phone_number, message, status, template_kind, template_params)
     VALUES ($1, $2, $3, 'PENDING', $4, $5::jsonb) RETURNING *`,
    [
      input.tenantId,
      intl,
      input.message,
      input.templateKind ?? null,
      input.templateParams ? JSON.stringify(input.templateParams) : null,
    ]
  );
  const row = rows[0];
  await logAudit({
    userId: input.userId ?? null,
    action: 'WHATSAPP_MESSAGE_QUEUED',
    entity: 'tenant',
    entityId: input.tenantId,
    newValue: { whatsappId: row.id, templateKind: row.template_kind },
  });
  return row;
}

// The reminder module's seam — the exported name for the queue transition
// (the reminder flow is its only producer): queue a PENDING row and hand it
// back, so the caller immediately invokes the send transition when direct
// delivery is wanted. The button press IS the send, its outcome lands in the
// same HTTP response, and a crash between queue and send leaves a recoverable
// PENDING row rather than a silently missing one.
export const queuePreparedWhatsapp = queueWhatsapp;

// --- Send transition -------------------------------------------------------------

export async function sendWhatsappNotification(id: number, opts: { phone?: string } = {}): Promise<WhatsappRow> {
  const row = await queryOne<WhatsappRow>('SELECT * FROM whatsapp_notifications WHERE id = $1', [id]);
  if (!row) {
    throw notFound('WhatsApp message not found.');
  }
  // A FAILED/ERRONEOUS row is re-sendable — that is the whole point of the
  // retry sweep and the manual "send again" action. Only a row that has
  // already gone out is final, so only SENT is refused here.
  if (row.status === 'SENT') {
    throw badRequest('This WhatsApp message was already sent — only pending or failed messages can be sent.');
  }

  // An operator-supplied corrected recipient (a number Meta refused) is
  // persisted before the attempt, so the history row records exactly the
  // number the send went to — and a second rejection is attributed to the
  // corrected number, not the old one.
  const sendTo = opts.phone ? (normalizeWhatsAppNumber(opts.phone) as string) : row.phone_number;
  if (!sendTo) {
    throw badRequest('That phone number is not a valid WhatsApp number.');
  }
  if (opts.phone && sendTo !== row.phone_number) {
    await query('UPDATE whatsapp_notifications SET phone_number = $2 WHERE id = $1', [id, sendTo]);
  }

  try {
    // A template row (template_kind holds the registered template name) is
    // sent as the approved template — no 24-hour window, header/footer
    // included — with the parameters persisted at queue time. The language
    // is read at send time so the operator can change it without re-queueing.
    const template =
      row.template_kind && Array.isArray(row.template_params) && row.template_params.length > 0
        ? { name: row.template_kind, language: getWhatsappTemplates().language, params: row.template_params }
        : undefined;
    const result = await sendCloudWhatsapp(sendTo, row.message, { template });
    await query(
      `UPDATE whatsapp_notifications
       SET status = 'SENT', provider_message_id = $2, sent_at = NOW(), failure_reason = NULL,
           attempt_count = attempt_count + 1, next_retry_at = NULL
       WHERE id = $1`,
      [id, result.wamid]
    );
  } catch (err) {
    const derr = err as WhatsAppDeliveryError;
    const reason = derr.message || 'Unknown WhatsApp provider error';
    const terminal = derr.terminal === true;
    const attempts = await queryOne<{ n: string }>(
      'SELECT attempt_count::text AS n FROM whatsapp_notifications WHERE id = $1',
      [id]
    );
    const attemptCount = Number(attempts?.n ?? 0) + 1;
    // Reuse the SMS channel's retry budget so operators tune one set of knobs
    // for all channels; the sweeps share the same backoff curve.
    const giveUp = attemptCount >= env.smsMaxSendAttempts;
    const delayMs = env.smsRetryEnabled && !terminal && !giveUp
      ? env.smsRetryBaseDelayMs * Math.pow(5, attemptCount - 1)
      : null;
    await query(
      `UPDATE whatsapp_notifications
       SET status = $2, failure_reason = $3, attempt_count = $4, next_retry_at = $5
       WHERE id = $1`,
      [id, terminal ? 'ERRONEOUS' : 'FAILED', reason, attemptCount, delayMs === null ? null : new Date(Date.now() + delayMs)]
    );
  }
  return (await queryOne<WhatsappRow>('SELECT * FROM whatsapp_notifications WHERE id = $1', [id])) as WhatsappRow;
}

// --- History listing -------------------------------------------------------------

export interface WhatsappFilters {
  page: number;
  limit: number;
  status?: 'PENDING' | 'SENT' | 'FAILED' | 'ERRONEOUS';
  tenantId?: number;
  q?: string;
}

export async function listWhatsapp(filters: WhatsappFilters): Promise<{ rows: WhatsappRow[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    params.push(filters.status);
    where.push(`w.status = $${params.length}`);
  }
  if (filters.tenantId) {
    params.push(filters.tenantId);
    where.push(`w.tenant_id = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(w.message ILIKE $${params.length} OR w.phone_number ILIKE $${params.length} OR t.full_name ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return paginate<WhatsappRow>({
    selectSql: `w.*, t.full_name AS tenant_name, u.unit_number`,
    tableSql: `FROM whatsapp_notifications w
     LEFT JOIN tenants t ON t.id = w.tenant_id
     LEFT JOIN units u ON u.id = t.unit_id`,
    whereSql,
    params,
    orderBy: `ORDER BY w.created_at DESC`,
    page: filters.page,
    limit: filters.limit,
  });
}
