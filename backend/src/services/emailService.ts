// Receipt email service — mirrors smsService.ts: rows are prepared when a
// send is requested, sending flips the row to SENT/FAILED, history is
// listable. The rendered HTML is stored with the row so the record is a
// faithful copy of what was sent.
import { pool, query, queryOne } from '../config/db';
import type { Pagination } from '../types';
import { getBusinessIdentity } from './brandingService';
import { isValidEmail, sendEmail } from './emailProvider';
import { badRequest, notFound } from '../utils/httpError';
import {
  receiptEmailHtml,
  receiptSubject,
  receiptText,
  type ReceiptDocument,
} from '../utils/receiptDocument';
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
export async function getReceiptForEmail(receiptId: number): Promise<ReceiptWithEmail> {
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

// Creates a PENDING email_notifications row for a receipt. The recipient is
// the tenant's stored email unless an explicit address is passed (either way
// it must be a valid address — never guessed).
export async function prepareForReceipt(
  receiptId: number,
  opts: { toEmail?: string; userId?: number | null } = {}
): Promise<EmailRow> {
  const receipt = await getReceiptForEmail(receiptId);
  const toEmail = (opts.toEmail ?? receipt.tenant_email ?? '').trim();
  if (!toEmail) {
    throw badRequest('This tenant has no email address on file. Provide one with the request.');
  }
  if (!isValidEmail(toEmail)) {
    throw badRequest(`"${toEmail}" is not a valid email address.`);
  }

  const subject = receiptSubject(receipt);
  // Identity from business_branding (DB with env fallbacks) so Settings
  // edits apply to newly prepared emails immediately.
  const identity = await getBusinessIdentity();
  const html = receiptEmailHtml(receipt, identity);
  const text = receiptText(receipt, identity);

  // The real, printable receipt PDF — the same renderer as the in-app
  // download — stored (base64) as the email's attachment, so the tenant
  // receives the actual document rather than an HTML copy.
  const pdf = await receiptPdfBytes(receipt, identity);
  const attachmentContent = Buffer.from(pdf).toString('base64');

  const { rows } = await pool.query<EmailRow>(
    `INSERT INTO email_notifications
       (receipt_id, tenant_id, email_address, subject, body_html, body_text, status,
        attachment_name, attachment_content, attachment_content_type)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, 'application/pdf')
     RETURNING *`,
    [receipt.id, receipt.tenant_id, toEmail, subject, html, text, `${receipt.receipt_number}.pdf`, attachmentContent]
  );
  return rows[0];
}

// Sends a PENDING email via the configured provider (env EMAIL_PROVIDER —
// mock by default, SMTP when configured) and records the outcome:
// SENT + provider_message_id + sent_at, or FAILED + failure_reason.
// The receipt rides along as its real PDF attachment (rendered at prepare
// time); data-request letters carry their JSON data file.
export async function sendEmailNotification(id: number): Promise<EmailRow> {
  const row = await queryOne<EmailRow & { receipt_number: string | null; attachment_name: string | null; attachment_content: string | null; attachment_content_type: string | null }>(
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

  // Attachment: the row's stored file — the receipt PDF for receipt emails
  // (base64-decoded via its content type), the JSON data file for data-request
  // letters (utf8). Rows predating attachments fall back to the .html copy.
  const attachment = row.attachment_name && row.attachment_content
    ? row.attachment_content_type === 'application/pdf'
      ? { filename: row.attachment_name, content: row.attachment_content, contentType: 'application/pdf' }
      : { filename: row.attachment_name, content: row.attachment_content, contentType: 'application/json' }
    : row.receipt_number
      ? { filename: `${row.receipt_number}.html`, content: row.body_html, contentType: 'text/html' }
      : null;

  const result = await sendEmail({
    to: row.email_address,
    subject: row.subject,
    text: row.body_text,
    html: row.body_html,
    attachment,
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

// --- Data-request response letter (with the data file attached) --------------

export interface PreparedDataLetterEmail {
  id: number;
  email_address: string;
  subject: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
}

// Creates a PENDING email carrying the formal data-request response letter
// (server-rendered) with the tenant's complete JSON data export attached as
// the data file. The stored body + attachment are a faithful copy of what
// the tenant received, satisfying the accountability principle.
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
}): Promise<PreparedDataLetterEmail> {
  const toEmail = opts.tenantEmail.trim();
  if (!isValidEmail(toEmail)) {
    throw badRequest(`"${toEmail}" is not a valid email address.`);
  }
  const subject = `Response to your personal-data request — ref ${opts.registerRef}`;
  const text = [
    `Dear ${opts.tenantName},`,
    '',
    'We refer to your request for access to the personal data we hold about you.',
    'Our formal response letter is attached to this email as a printable document,',
    'together with a machine-readable (JSON) copy of the data we hold.',
    '',
    `Our reference: ${opts.registerRef}`,`Response deadline: ${opts.responseDays ?? '30'} days`,
    '',
    'This response is provided under the Data Protection Act, 2019 (Kenya) and,',
    'where applicable, the General Data Protection Regulation (EU) 2016/679.',
  ].join('\n');

  const { rows } = await pool.query(
    `INSERT INTO email_notifications
       (tenant_id, email_address, subject, body_html, body_text, status,
        attachment_name, attachment_content)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7)
     RETURNING id, email_address, subject, status`,
    [opts.tenantId, toEmail, subject, opts.letterHtml, text, opts.enclosureName, opts.enclosureJson]
  );
  return rows[0];
}

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
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM email_notifications e
     JOIN tenants t ON t.id = e.tenant_id
     ${whereSql}`,
    params
  );
  const total = Number(totalRow?.count ?? 0);
  const offset = (filters.page - 1) * filters.limit;
  const rows = await query<EmailRow>(
    `SELECT e.*, t.full_name AS tenant_name, u.unit_number
     FROM email_notifications e
     JOIN tenants t ON t.id = e.tenant_id
     LEFT JOIN units u ON u.id = t.unit_id
     ${whereSql}
     ORDER BY e.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset]
  );
  return {
    rows,
    pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
  };
}

// Backfill for seeded receipts: creates PENDING email rows for any receipt
// whose tenant has an email address but no email row yet (used by db:setup).
export async function backfillEmails(): Promise<number> {
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
