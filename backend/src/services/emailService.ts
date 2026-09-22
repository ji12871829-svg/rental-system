// Outbound Email module — the deep interface for every email the system sends.
//
// Shape:
//   * queueEmail — the ONE persist point: validates the recipient, folds the
//     attachments into the row's two attachment slots, INSERTs PENDING.
//     Every kind funnels through it, so validation and persistence have
//     exactly one implementation.
//   * prepareFor* — thin kind adapters: resolve data, compose the body via
//     the pure templates in utils/emailTemplates.ts (receipts via
//     utils/receiptDocument.ts), then call queueEmail. Adding a kind touches
//     one small adapter, never the lifecycle.
//   * sendEmailNotification — the send transition: PENDING → provider →
//     SENT (message id) / FAILED (reason). Test-mode rows resolve instantly
//     so flows stay exercisable in tests.
//
// The email_notification record is a faithful copy of what was sent
// (accountability principle) — see CONTEXT.md, "Outbound Email module" and
// "Email notification record". SMS mirrors this lifecycle in smsService.ts.
import { pool, query, queryOne } from '../config/db';
import { paginate } from './paginate';
import type { Pagination } from '../types';
import { getBusinessIdentity } from './brandingService';
import { env, isTest } from '../config/env';
import { getEmailConfig, isValidEmail, sendEmail, type EmailPayload } from './emailProvider';
import { logAudit } from './auditService';
import { monthlyReportPdf, tenantStatementPdf } from './financeService';
import { badRequest, notFound } from '../utils/httpError';
import {
  receiptEmailHtml,
  receiptSubject,
  receiptText,
  type ReceiptDocument,
} from '../utils/receiptDocument';
import {
  composeCampaignEmail,
  composeDataLetterEmail,
  composeMonthlyReportEmail,
  composePortalCredentialsEmail,
  composeStaffRequestEmail,
  composeStatementEmail,
  composeTestEmail,
} from '../utils/emailTemplates';
import { receiptPdfBytes } from '../utils/receiptPdf';

export interface EmailRow {
  id: number;
  receipt_id: number | null;
  tenant_id: number;
  email_address: string;
  subject: string;
  body_html: string;
  body_text: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  provider_message_id: string | null;
  sent_at: string | null;
  failure_reason: string | null;
  attachment_name?: string | null;
  attachment_content?: string | null;
  attachment_content_type?: string | null;
  created_at: string;
}

interface ReceiptWithEmail extends ReceiptDocument {
  id: number;
  tenant_id: number;
  tenant_email: string | null;
}

// Fetches the full receipt (with tenant contact + currency) needed to
// compose the email.
async function getReceiptForEmail(receiptId: number): Promise<ReceiptWithEmail> {
  const row = await queryOne<ReceiptWithEmail>(
    `SELECT r.id, r.receipt_number, r.receipt_type, r.payment_date, r.billing_month, r.billing_year,
            r.rent_amount, r.water_amount, r.total_amount, r.balance, r.generated_at,
            t.id AS tenant_id, t.full_name AS tenant_name, t.email AS tenant_email,
            u.unit_number, u.unit_type,
            p.name AS property_name, p.address AS property_address, s.currency
     FROM receipts r
     JOIN tenants t ON t.id = r.tenant_id
     JOIN units u ON u.id = r.unit_id
     JOIN properties p ON p.id = u.property_id
     JOIN settings s ON s.id = 1
     WHERE r.id = $1`,
    [receiptId]
  );
  if (!row) throw notFound('Receipt not found.');
  return row;
}

// --- Queue core ---------------------------------------------------------------
//
// One file attachment in the row's storage shape. Content is base64 already
// (the row stores a faithful copy of the bytes that go out).
// Module-internal shape (un-exported: knip flags exports nothing outside
// this file consumes; extend here, not via import).
interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

interface QueueEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  tenantId?: number | null;
  receiptId?: number | null;
  attachments?: EmailAttachment[];
}

// The schema stores two attachment slots per row; callers hand us 0..2
// attachments and this folds them into (attachment, attachment2).
function normalizeAttachments(attachments: EmailAttachment[] | undefined): [EmailAttachment | null, EmailAttachment | null] {
  return [attachments?.[0] ?? null, attachments?.[1] ?? null];
}

// Validates the recipient and creates the PENDING row. The single place where
// an email enters the queue — kind adapters never write email_notifications
// themselves.
async function queueEmail(input: QueueEmailInput): Promise<EmailRow> {
  const to = input.to.trim();
  if (!to) {
    throw badRequest('This tenant has no email address on file. Provide one with the request.');
  }
  if (!isValidEmail(to)) {
    throw badRequest(`"${to}" is not a valid email address.`);
  }

  const [a1, a2] = normalizeAttachments(input.attachments);
  const { rows } = await pool.query<EmailRow>(
    `INSERT INTO email_notifications
       (receipt_id, tenant_id, email_address, subject, body_html, body_text, status,
        attachment_name, attachment_content, attachment_content_type,
        attachment2_name, attachment2_content, attachment2_content_type)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.receiptId ?? null,
      input.tenantId ?? null,
      to,
      input.subject,
      input.html,
      input.text,
      a1?.filename ?? null,
      a1?.content ?? null,
      a1?.contentType ?? null,
      a2?.filename ?? null,
      a2?.content ?? null,
      a2?.contentType ?? null,
    ]
  );
  return rows[0];
}

// --- Send transition ------------------------------------------------------------
//
// Sends a PENDING email via the configured provider (env EMAIL_PROVIDER —
// mock by default, SMTP when configured) and records the outcome:
// SENT + provider_message_id + sent_at, or FAILED + failure_reason.
// Attachments decode from the row's stored slots; rows predating attachments
// fall back to the .html copy.
export async function sendEmailNotification(id: number): Promise<EmailRow> {
  const row = await queryOne<EmailRow & {
    receipt_number: string | null;
    attachment_name: string | null;
    attachment_content: string | null;
    attachment_content_type: string | null;
    attachment2_name: string | null;
    attachment2_content: string | null;
    attachment2_content_type: string | null;
  }>(
    `SELECT e.*, r.receipt_number
     FROM email_notifications e
     LEFT JOIN receipts r ON r.id = e.receipt_id
     WHERE e.id = $1`,
    [id]
  );
  if (!row) throw notFound('Email notification not found.');
  if (row.status !== 'PENDING') {
    throw badRequest(`This email was already ${row.status.toLowerCase()} — only pending emails can be sent.`);
  }

  const attachments: { filename: string; content: string; contentType: string }[] = [];
  if (row.attachment_name && row.attachment_content) {
    attachments.push({
      filename: row.attachment_name,
      content: row.attachment_content,
      contentType: row.attachment_content_type ?? 'application/json',
    });
  }
  if (row.attachment2_name && row.attachment2_content) {
    attachments.push({
      filename: row.attachment2_name,
      content: row.attachment2_content,
      contentType: row.attachment2_content_type ?? 'application/json',
    });
  }
  if (attachments.length === 0 && row.receipt_number) {
    attachments.push({ filename: `${row.receipt_number}.html`, content: row.body_html, contentType: 'text/html' });
  }

  const result = await sendEmail({
    to: row.email_address,
    subject: row.subject,
    text: row.body_text,
    html: row.body_html,
    attachments,
  });

  if (result.ok) {
    await query(
      `UPDATE email_notifications
       SET status = 'SENT', provider_message_id = $2, sent_at = NOW()
       WHERE id = $1`,
      [id, result.providerMessageId ?? null]
    );
  } else {
    await query(
      `UPDATE email_notifications
       SET status = 'FAILED', failure_reason = $2
       WHERE id = $1`,
      [id, result.failureReason ?? 'Unknown provider error']
    );
  }
  return queryOne<EmailRow>('SELECT * FROM email_notifications WHERE id = $1', [id]) as Promise<EmailRow>;
}

// Queue and send a receipt email only after the payment transaction commits.
// A missing tenant email or provider outage must never undo a recorded payment.
export function dispatchAutoEmail(receiptId: number | null | undefined): void {
  if (!receiptId || isTest || !env.emailAutoSend) return;
  setTimeout(() => {
    prepareForReceipt(receiptId)
      .then((pending) => sendEmailNotification(pending.id))
      .catch((err) => console.error(`[email] auto-send failed for receipt ${receiptId}: ${(err as Error).message}`));
  }, 0);
}

// --- Kind adapters ---------------------------------------------------------------
//
// Each resolves its own data, composes via the pure templates, and delegates
// persistence + validation to queueEmail.

// Creates a PENDING email for a receipt, carrying the real printable PDF (the
// same renderer as the in-app download) as the attachment. The recipient is
// the tenant's stored email unless an explicit address is passed (either way
// it must be a valid address — never guessed).
export async function prepareForReceipt(
  receiptId: number,
  opts: { toEmail?: string; userId?: number | null } = {}
): Promise<EmailRow> {
  const receipt = await getReceiptForEmail(receiptId);
  const identity = await getBusinessIdentity();
  const pdf = await receiptPdfBytes(receipt, identity);

  return queueEmail({
    to: (opts.toEmail ?? receipt.tenant_email ?? '').trim(),
    subject: receiptSubject(receipt),
    html: receiptEmailHtml(receipt, identity),
    text: receiptText(receipt, identity),
    tenantId: receipt.tenant_id,
    receiptId: receipt.id,
    attachments: [
      { filename: `${receipt.receipt_number}.pdf`, content: Buffer.from(pdf).toString('base64'), contentType: 'application/pdf' },
    ],
  });
}

export interface PreparedPortalCredentialsEmail {
  id: number;
  email_address: string;
  status: EmailRow['status'];
}

// Creates a PENDING email carrying a tenant's portal login credentials (the
// one-time password generated by the issue/rotate action). The recipient is
// the portal login email itself — where the credentials actually work — not
// the tenant's general contact address. The stored body is a faithful copy
// of what was sent, so the password exists in the email record; rotation is
// the remedy if it ever needs to die.
export async function prepareForPortalCredentials(opts: {
  tenantId: number;
  tenantName: string;
  loginEmail: string;
  password: string;
}): Promise<PreparedPortalCredentialsEmail> {
  const identity = await getBusinessIdentity();
  const composed = composePortalCredentialsEmail({
    tenantName: opts.tenantName,
    loginEmail: opts.loginEmail.trim(),
    password: opts.password,
    portalUrl: env.portalUrl,
    identity,
  });
  const row = await queueEmail({
    to: opts.loginEmail,
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    tenantId: opts.tenantId,
  });
  return { id: row.id, email_address: row.email_address, status: row.status };
}

export interface PreparedDataLetterEmail {
  id: number;
  email_address: string;
  subject: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
}

// Creates a PENDING email carrying the formal data-request response letter
// with TWO attachments: the letter as a printable PDF and the tenant's
// complete JSON data export. The stored body + attachments are a faithful
// copy of what the tenant received, satisfying the accountability principle.
export async function prepareForDataRequestLetter(opts: {
  tenantId: number;
  tenantName: string;
  tenantEmail: string;
  registerRef: string;
  generatedAt: string;
  responseDays: string | null;
  letterHtml: string;
  enclosureName: string;
  enclosureJson: string;
  letterPdf: { name: string; base64: string };
}): Promise<PreparedDataLetterEmail> {
  const composed = composeDataLetterEmail({
    tenantName: opts.tenantName,
    registerRef: opts.registerRef,
    responseDays: opts.responseDays,
    letterHtml: opts.letterHtml,
  });
  const row = await queueEmail({
    to: opts.tenantEmail,
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    tenantId: opts.tenantId,
    attachments: [
      { filename: opts.letterPdf.name, content: opts.letterPdf.base64, contentType: 'application/pdf' },
      { filename: opts.enclosureName, content: opts.enclosureJson, contentType: 'application/json' },
    ],
  });
  return { id: row.id, email_address: row.email_address, subject: row.subject, status: row.status };
}

export interface PreparedReportEmail {
  id: number;
  email_address: string;
  subject: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
}

// Creates a PENDING email carrying the one-page monthly financial report PDF
// to the operator. Recipient must be explicit — the business branding general
// email or an override; never guessed from tenant data. No tenant_id: the
// row is operational, not tenant correspondence.
export async function prepareForMonthlyReport(opts: {
  year: number;
  toEmail: string;
  userId?: number | null;
}): Promise<PreparedReportEmail> {
  const identity = await getBusinessIdentity();
  const { bytes } = await monthlyReportPdf(opts.year);
  const composed = composeMonthlyReportEmail({ year: opts.year, identity });

  const row = await queueEmail({
    to: opts.toEmail,
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    attachments: [
      { filename: `financial-report-${opts.year}.pdf`, content: Buffer.from(bytes).toString('base64'), contentType: 'application/pdf' },
    ],
  });

  await logAudit({
    userId: opts.userId ?? null,
    action: 'MONTHLY_REPORT_EMAILED',
    entity: 'report',
    entityId: null,
    newValue: { year: opts.year, to: row.email_address },
  });

  return { id: row.id, email_address: row.email_address, subject: row.subject, status: row.status };
}

export interface PreparedStaffRequestEmail {
  id: number;
  email_address: string;
  subject: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
}

// Creates a PENDING email notifying the operator that a public landlord/agent
// sign-up (POST /api/auth/register) created an inactive staff account. The
// recipient is the business branding general email — the same operator
// address the monthly report uses; when it is unset the queue is skipped and
// the caller learns about the request through the Users page as before.
// No tenant_id: operational mail to the operator, not tenant correspondence.
export async function prepareForStaffRequest(opts: {
  name: string;
  email: string;
  phone: string | null;
}): Promise<PreparedStaffRequestEmail | null> {
  const identity = await getBusinessIdentity();
  const to = identity.email?.trim() ?? '';
  if (!to || !isValidEmail(to)) return null;

  const composed = composeStaffRequestEmail({ name: opts.name, email: opts.email, phone: opts.phone, identity });
  const row = await queueEmail({
    to,
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
  });
  return { id: row.id, email_address: row.email_address, subject: row.subject, status: row.status };
}

// Creates a PENDING email carrying a tenant's yearly statement PDF. The
// recipient is the tenant's stored email unless an explicit address is passed
// (either way it must be valid — never guessed). Queued with the statement's
// tenant_id so it shows in their email history.
export async function prepareForStatementEmail(opts: {
  tenantId: number;
  year: number;
  toEmail?: string;
  userId?: number | null;
}): Promise<PreparedReportEmail> {
  const { bytes, tenantName, tenantEmail } = await tenantStatementPdf(opts.tenantId, opts.year);
  const identity = await getBusinessIdentity();
  const composed = composeStatementEmail({ tenantName, year: opts.year, identity });

  const row = await queueEmail({
    to: (opts.toEmail ?? tenantEmail ?? '').trim(),
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    tenantId: opts.tenantId,
    attachments: [
      { filename: `tenant-statement-${opts.tenantId}-${opts.year}.pdf`, content: Buffer.from(bytes).toString('base64'), contentType: 'application/pdf' },
    ],
  });    await logAudit({
      userId: opts.userId ?? null,
      action: 'STATEMENT_EMAILED',
      entity: 'tenant',
      entityId: opts.tenantId,
      newValue: { year: opts.year, to: row.email_address },
    });

  return { id: row.id, email_address: row.email_address, subject: row.subject, status: row.status };
}

// --- Tenant campaign (one composition, many recipients) --------------------------

export async function sendTenantCampaign(opts: {
  tenantIds?: number[];
  subject: string;
  message: string;
  userId?: number | null;
}): Promise<{ total: number; queued: number; sent: number; failed: number; skipped: number }> {
  const params: unknown[] = [];
  const where = opts.tenantIds?.length
    ? `AND t.id = ANY($1::int[])`
    : '';
  if (opts.tenantIds?.length) params.push(opts.tenantIds);
  const tenants = await query<{ id: number; full_name: string; email: string | null; unit_number: string | null }>(
    `SELECT t.id, t.full_name, t.email, u.unit_number
     FROM tenants t LEFT JOIN units u ON u.id = t.unit_id
     WHERE t.status = 'ACTIVE' ${where}
     ORDER BY t.id`,
    params
  );
  let queued = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const tenant of tenants) {
    if (!tenant.email || !isValidEmail(tenant.email)) {
      skipped += 1;
      continue;
    }
    const composed = composeCampaignEmail({
      tenantName: tenant.full_name,
      unitNumber: tenant.unit_number,
      subject: opts.subject,
      message: opts.message,
    });
    const inserted = await queueEmail({
      to: tenant.email,
      subject: composed.subject,
      html: composed.html,
      text: composed.text,
      tenantId: tenant.id,
    });
    queued += 1;
    const result = await sendEmailNotification(inserted.id);
    if (result.status === 'SENT') sent += 1;
    else failed += 1;
  }
  await logAudit({
    userId: opts.userId ?? null,
    action: 'TENANT_EMAIL_CAMPAIGN',
    entity: 'tenants',
    newValue: { total: tenants.length, queued, sent, failed, skipped, subject: opts.subject },
  });
  return { total: tenants.length, queued, sent, failed, skipped };
}

// --- Provider self-test (never touches history) ----------------------------------

export interface TestEmailResult {
  ok: boolean;
  provider: string;
  live: boolean;
  from: string;
  to: string;
  providerMessageId?: string;
  failureReason?: string;
  latencyMs: number;
}

export async function sendTestEmail(opts: { to?: string; userId: number }): Promise<TestEmailResult> {
  const cfg = getEmailConfig();

  // Recipient: explicit address, or the requesting staff user's own email —
  // "verify it lands in MY inbox" is the natural test.
  let to = opts.to?.trim() ?? '';
  if (!to) {
    const row = await queryOne<{ email: string | null }>('SELECT email FROM users WHERE id = $1', [opts.userId]);
    to = row?.email?.trim() ?? '';
  }
  if (!to) {
    throw badRequest('Enter a recipient address — your user account has no email on file.');
  }
  if (!isValidEmail(to)) {
    throw badRequest(`"${to}" is not a valid email address.`);
  }

  const identity = await getBusinessIdentity();
  const composed = composeTestEmail({ provider: cfg.provider, live: cfg.live, identity });
  const payload: EmailPayload = {
    to,
    subject: composed.subject,
    text: composed.text,
    html: composed.html,
    attachments: [],
  };

  const started = Date.now();
  const result = await sendEmail(payload);
  const latencyMs = Date.now() - started;

  await logAudit({
    userId: opts.userId,
    action: 'EMAIL_TEST',
    entity: 'email',
    entityId: null,
    newValue: { to, ok: result.ok, provider: cfg.provider, latencyMs },
  });

  return {
    ok: result.ok,
    provider: cfg.provider,
    live: cfg.live,
    from: cfg.from ?? '',
    to,
    providerMessageId: result.providerMessageId,
    failureReason: result.failureReason,
    latencyMs,
  };
}

// --- History -----------------------------------------------------------------------

export interface EmailFilters {
  page: number;
  limit: number;
  status?: string;
  tenantId?: number;
  q?: string;
}

export async function listEmails(filters: EmailFilters): Promise<{ rows: EmailRow[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    params.push(filters.status);
    where.push(`e.status = $${params.length}`);
  }
  if (filters.tenantId) {
    params.push(filters.tenantId);
    where.push(`e.tenant_id = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`(e.subject ILIKE $${params.length} OR e.email_address ILIKE $${params.length} OR t.full_name ILIKE $${params.length})`);
  }
  // Operational emails (monthly report to the landlord) have no tenant row.
  // LEFT JOIN keeps them visible in history; the search clause must tolerate
  // a missing tenant name.
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return paginate<EmailRow>({
    selectSql: `e.*, t.full_name AS tenant_name, u.unit_number`,
    tableSql: `FROM email_notifications e
     LEFT JOIN tenants t ON t.id = e.tenant_id
     LEFT JOIN units u ON u.id = t.unit_id`,
    whereSql,
    params,
    orderBy: `ORDER BY e.created_at DESC`,
    page: filters.page,
    limit: filters.limit,
  });
}

// Backfill for seeded receipts: creates PENDING email rows for any receipt
// whose tenant has an email address but no email row yet. Currently unused —
// the db:setup backfill path imports backfillReceipts/backfillSms only. Kept
// module-private as ready-made parity with the SMS backfill.
async function backfillEmails(): Promise<number> {
  const receipts = await query<ReceiptWithEmail>(
    `SELECT r.*, t.email AS tenant_email
     FROM receipts r
     JOIN tenants t ON t.id = r.tenant_id
     WHERE t.email IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM email_notifications e WHERE e.receipt_id = r.id)`
  );
  let created = 0;
  for (const receipt of receipts) {
    await prepareForReceipt(receipt.id);
    created += 1;
  }
  return created;
}
