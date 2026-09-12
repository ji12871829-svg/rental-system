// Receipt email service — mirrors smsService.ts: rows are prepared when a
// send is requested, sending flips the row to SENT/FAILED, history is
// listable. The rendered HTML is stored with the row so the record is a
// faithful copy of what was sent.
import { pool, query, queryOne } from '../config/db';
import { paginate } from './paginate';
import type { Pagination } from '../types';
import { getBusinessIdentity } from './brandingService';
import { env, isTest } from '../config/env';
import { isValidEmail, sendEmail } from './emailProvider';
import { logAudit } from './auditService';
import { monthlyReportPdf, tenantStatementPdf } from './financeService';
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

  // Attachments in order: the row's primary stored file (the receipt PDF,
  // base64-decoded via its content type; the letter PDF on data-request
  // emails) then the second attachment (the JSON data file). Rows predating
  // attachments fall back to the .html copy.
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

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
    const messageText = opts.message
      .replaceAll('{{name}}', tenant.full_name)
      .replaceAll('{{unit}}', tenant.unit_number ?? 'unassigned');
    const subject = opts.subject.replaceAll('{{name}}', tenant.full_name).replaceAll('{{unit}}', tenant.unit_number ?? 'unassigned');
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5"><p>Dear ${escapeHtml(tenant.full_name)},</p><p>${escapeHtml(messageText).replaceAll('\n', '<br>')}</p><p style="color:#6b7280;font-size:13px">Olbano Plaza</p></div>`;
    const inserted = await query<EmailRow>(
      `INSERT INTO email_notifications (tenant_id, email_address, subject, body_html, body_text, status)
       VALUES ($1, $2, $3, $4, $5, 'PENDING') RETURNING *`,
      [tenant.id, tenant.email, subject, html, messageText]
    );
    queued += 1;
    const result = await sendEmailNotification(inserted[0].id);
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

// --- Data-request response letter (with the data file attached) --------------

export interface PreparedDataLetterEmail {
  id: number;
  email_address: string;
  subject: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
}

// Creates a PENDING email carrying the formal data-request response letter
// (server-rendered) with TWO attachments: the letter as a professional,
// printable PDF and the tenant's complete JSON data export as the data file.
// The stored body + attachments are a faithful copy of what the tenant
// received, satisfying the accountability principle.
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
  const toEmail = opts.tenantEmail.trim();
  if (!isValidEmail(toEmail)) {
    throw badRequest(`"${toEmail}" is not a valid email address.`);
  }
  const subject = `Response to your personal-data request — ref ${opts.registerRef}`;
  const text = [
    `Dear ${opts.tenantName},`,
    '',
    'We refer to your request for access to the personal data we hold about you.',
    'Our formal response letter is attached to this email as a printable PDF,',
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
        attachment_name, attachment_content, attachment_content_type,
        attachment2_name, attachment2_content, attachment2_content_type)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, 'application/pdf', $8, $9, 'application/json')
     RETURNING id, email_address, subject, status`,
    [opts.tenantId, toEmail, subject, opts.letterHtml, text, opts.letterPdf.name, opts.letterPdf.base64, opts.enclosureName, opts.enclosureJson]
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

// --- Operational report emails (no tenant counterpart) ---------------------

export interface PreparedReportEmail {
  id: number;
  email_address: string;
  subject: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
}

// Subject line for the monthly financial report email.
function monthlyReportEmailSubject(year: number): string {
  return `Monthly Financial Report ${year}`;
}

// Creates a PENDING email carrying the one-page monthly financial report PDF
// to the operator. Recipient must be explicit — the business branding general
// email or an override; never guessed from tenant data.
export async function prepareForMonthlyReport(opts: {
  year: number;
  toEmail: string;
  userId?: number | null;
}): Promise<PreparedReportEmail> {
  const toEmail = opts.toEmail.trim();
  if (!isValidEmail(toEmail)) {
    throw badRequest(`"${toEmail}" is not a valid email address.`);
  }

  const identity = await getBusinessIdentity();
  const { bytes } = await monthlyReportPdf(opts.year);
  const subject = monthlyReportEmailSubject(opts.year);
  const name = identity.name?.trim() || 'your property manager';
  const text = [
    `Dear ${name},`,
    '',
    `The Monthly Financial Report for ${opts.year} is attached as a printable PDF.`,
    'It shows expected rent, water billing, collections and outstanding balances',
    'for every month of the year, with year totals.',
    '',
    'Generated by RPMS — Rental Property Management System.',
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5">
<p>Dear ${name},</p>
<p>The <strong>Monthly Financial Report for ${opts.year}</strong> is attached as a printable PDF.
It shows expected rent, water billing, collections and outstanding balances for every
month of the year, with year totals.</p>
<p style="color:#6b7280;font-size:13px">Generated by RPMS — Rental Property Management System.</p>
</body></html>`;

  const { rows } = await pool.query(
    `INSERT INTO email_notifications
       (tenant_id, email_address, subject, body_html, body_text, status,
        attachment_name, attachment_content, attachment_content_type)
     VALUES (NULL, $1, $2, $3, $4, 'PENDING', $5, $6, 'application/pdf')
     RETURNING id, email_address, subject, status`,
    [toEmail, subject, html, text, `financial-report-${opts.year}.pdf`, Buffer.from(bytes).toString('base64')]
  );

  await logAudit({
    userId: opts.userId ?? null,
    action: 'MONTHLY_REPORT_EMAILED',
    entity: 'report',
    entityId: null,
    newValue: { year: opts.year, to: toEmail },
  });

  return rows[0] as PreparedReportEmail;
}

// Creates a PENDING email carrying a tenant's yearly statement PDF. The
// recipient is the tenant's stored email unless an explicit address is passed
// (either way it must be valid — never guessed). Sent as tenant_id = the
// statement's tenant so it shows in their email history.
export async function prepareForStatementEmail(opts: {
  tenantId: number;
  year: number;
  toEmail?: string;
  userId?: number | null;
}): Promise<PreparedReportEmail> {
  const { bytes, tenantName, tenantEmail } = await tenantStatementPdf(opts.tenantId, opts.year);
  const toEmail = (opts.toEmail ?? tenantEmail ?? '').trim();
  if (!toEmail) {
    throw badRequest('This tenant has no email address on file. Provide one with the request.');
  }
  if (!isValidEmail(toEmail)) {
    throw badRequest(`"${toEmail}" is not a valid email address.`);
  }

  const identity = await getBusinessIdentity();
  const name = identity.name?.trim() || 'Property Management';
  const subject = `Tenant Statement ${opts.year} — ${tenantName}`;
  const text = [
    `Dear ${tenantName},`,
    '',
    `Your rental statement for ${opts.year} is attached as a printable PDF.`,
    'It lists every billing month with expected rent, water charges, payments',
    'and balances, and closes with your year balance.',
    '',
    `${name}${identity.regNo?.trim() ? ` · Reg. No. ${identity.regNo.trim()}` : ''}`,
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5">
<p>Dear ${tenantName},</p>
<p>Your <strong>rental statement for ${opts.year}</strong> is attached as a printable PDF.
It lists every billing month with expected rent, water charges, payments and balances,
and closes with your year balance.</p>
<p style="color:#6b7280;font-size:13px">${name}${identity.regNo?.trim() ? ` · Reg. No. ${identity.regNo.trim()}` : ''}</p>
</body></html>`;

  const { rows } = await pool.query(
    `INSERT INTO email_notifications
       (tenant_id, email_address, subject, body_html, body_text, status,
        attachment_name, attachment_content, attachment_content_type)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, 'application/pdf')
     RETURNING id, email_address, subject, status`,
    [opts.tenantId, toEmail, subject, html, text, `tenant-statement-${opts.tenantId}-${opts.year}.pdf`, Buffer.from(bytes).toString('base64')]
  );

  await logAudit({
    userId: opts.userId ?? null,
    action: 'STATEMENT_EMAILED',
    entity: 'tenant',
    entityId: opts.tenantId,
    newValue: { year: opts.year, to: toEmail },
  });
  return rows[0] as PreparedReportEmail;
}
