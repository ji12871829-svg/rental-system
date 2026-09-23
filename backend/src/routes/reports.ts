import { Router } from 'express';
import { z } from 'zod';
import { queryOne } from '../config/db';
import { logAudit } from '../services/auditService';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getSettings } from '../services/settingsService';
import { getBusinessIdentity } from '../services/brandingService';
import { composeOwnerRemittanceEmail, ownerRemittanceFigures, ownerRemittanceSms, ownerRemittanceWhatsapp } from '../services/ownerRemittanceService';
import { queueReminderEmail } from '../services/emailService';
import { arrears, arrearsReportPdf, combinedMonthlySummary, dashboard, monthlyReportPdf, tenantLedger, tenantStatementPdf } from '../services/financeService';
import { prepareForMonthlyReport, prepareForStatementEmail, sendEmailNotification } from '../services/emailService';
import { monthlyRentSummary } from '../services/rentService';
import { monthlyWaterSummary, waterSummary } from '../services/waterService';

const router = Router();
router.use(requireAuth);

const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });

router.get('/dashboard', asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const data = await dashboard(q.year ?? settings.reporting_year);
  res.json({ data });
}));

router.get('/arrears', asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const data = await arrears(q.year ?? settings.reporting_year);
  res.json({ data });
}));

// Arrears report as a printable PDF (registered before /tenant/:id so the
// .pdf suffix is never captured as an id). Year defaults to the reporting year.
router.get('/arrears.pdf', validateQuery(yearQuery), asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const year = q.year ?? settings.reporting_year;
  const { bytes } = await arrearsReportPdf(year);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="arrears-report-${year}.pdf"`);
  res.send(Buffer.from(bytes));
}));

// Combined rent + water monthly summary (§27 + §24 together).
router.get('/monthly', asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const data = await combinedMonthlySummary(q.year ?? settings.reporting_year);
  res.json({ data });
}));

// Rent-only monthly summary.
router.get('/monthly/rent', asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const data = await monthlyRentSummary(q.year ?? settings.reporting_year);
  res.json({ data });
}));

// Water-only monthly summary.
router.get('/monthly/water', asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const data = await monthlyWaterSummary(q.year ?? settings.reporting_year);
  res.json({ data });
}));

// Water financial performance (§22 / §47).
router.get('/water', asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const data = await waterSummary(q.year ?? settings.reporting_year);
  res.json({ data });
}));

// Monthly financial report as a one-page PDF download (registered before
// /tenant/:id so 'monthly.pdf' is not captured as an id). Year defaults to
// the reporting year, like every other reports endpoint.
router.get('/monthly.pdf', validateQuery(yearQuery), asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const year = q.year ?? settings.reporting_year;
  const { bytes } = await monthlyReportPdf(year);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="financial-report-${year}.pdf"`);
  res.send(Buffer.from(bytes));
}));

// Emails the monthly financial report PDF to the operator. The recipient is
// the request body's address, defaulting to the business branding general
// email — never guessed from tenant data. Manager/admin only.
const reportEmailSchema = z.object({ toEmail: z.string().email().optional() });

router.post('/monthly/email', managerOrAdmin, validateQuery(yearQuery), validateBody(reportEmailSchema), asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const year = q.year ?? settings.reporting_year;
  const toEmail = req.body?.toEmail ?? (await getBusinessIdentity()).email?.trim() ?? '';
  if (!toEmail) {
    res.status(400).json({ error: 'NO_RECIPIENT', message: 'No email address provided and no general queries email set in business branding.' });
    return;
  }
  const pending = await prepareForMonthlyReport({ year, toEmail, userId: req.user!.userId });
  const row = await sendEmailNotification(pending.id);
  res.status(201).json({ data: row });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.get('/tenant/:id', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const data = await tenantLedger(Number(req.params.id), q.year ?? settings.reporting_year);
  res.json({ data });
}));

// Tenant yearly statement as a printable PDF download. Year defaults to the
// reporting year.
router.get('/tenant/:id/statement.pdf', validateParams(paramsSchema), validateQuery(yearQuery), asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const year = q.year ?? settings.reporting_year;
  const { bytes, tenantName } = await tenantStatementPdf(Number(req.params.id), year);
  const safe = tenantName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'tenant';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="statement-${safe}-${year}.pdf"`);
  res.send(Buffer.from(bytes));
}));

// Emails a tenant's yearly statement PDF — to the tenant's stored email or an
// explicit override — and sends it in one step. Manager/admin only.
const statementEmailSchema = z.object({ toEmail: z.string().email().optional() });

router.post('/tenant/:id/statement/email', managerOrAdmin, validateParams(paramsSchema), validateQuery(yearQuery), validateBody(statementEmailSchema), asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const year = q.year ?? settings.reporting_year;
  const pending = await prepareForStatementEmail({
    tenantId: Number(req.params.id),
    year,
    toEmail: req.body?.toEmail,
    userId: req.user!.userId,
  });
  const row = await sendEmailNotification(pending.id);
  res.status(201).json({ data: row });
}));

// --- Property-owner remittance (manager/admin) --------------------------------
// The owner communication templates: a month-scoped preview of the figures
// (collected / fee / expenses / net), then queue-or-compose per channel.
// Requires the owner contact details to be filled in Settings first — the
// endpoints 409 with a clear message when they are missing.
const monthQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12),
});

router.get('/owner-remittance', managerOrAdmin, validateQuery(monthQuery), asyncHandler(async (req, res) => {
  const q = monthQuery.parse(req.query);
  const settings = await getSettings();
  const figures = await ownerRemittanceFigures(q.year ?? settings.reporting_year, q.month);
  res.json({ data: figures });
}));

const ownerNotifySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL']),
});

router.post('/owner-remittance', managerOrAdmin, validateBody(ownerNotifySchema), asyncHandler(async (req, res) => {
  const { month, channel } = req.body as { month: number; channel: 'SMS' | 'WHATSAPP' | 'EMAIL' };
  const settings = await getSettings();
  const f = await ownerRemittanceFigures(settings.reporting_year, month);
  if (channel === 'SMS' && !f.ownerPhone) {
    res.status(409).json({ error: 'OWNER_NO_PHONE', message: 'Add the owner\'s phone number in Settings first.' });
    return;
  }
  if (channel === 'EMAIL' && !f.ownerEmail) {
    res.status(409).json({ error: 'OWNER_NO_EMAIL', message: 'Add the owner\'s email address in Settings first.' });
    return;
  }

  if (channel === 'WHATSAPP') {
    const text = ownerRemittanceWhatsapp(f);
    if (!f.ownerPhone) {
      res.status(409).json({ error: 'OWNER_NO_PHONE', message: 'Add the owner\'s WhatsApp number in Settings first.' });
      return;
    }
    const digits = f.ownerPhone.replace(/\D/g, '');
    const intl = digits.startsWith('0') ? `254${digits.slice(1)}` : digits;
    await logAudit({ userId: req.user!.userId, action: 'OWNER_REMITTANCE_WHATSAPP_COMPOSED', entity: 'settings', entityId: 1, newValue: { month } });
    res.status(202).json({ data: { channel, message: text, whatsappUrl: `https://wa.me/${intl}?text=${encodeURIComponent(text)}` } });
    return;
  }

  if (channel === 'SMS') {
    const message = ownerRemittanceSms(f);
    const inserted = await queryOne<{ id: number }>(
      // sms_notifications.tenant_id is NOT NULL — owner messages are operational,
      // not tenant correspondence. Rather than weaken the schema constraint, the
      // owner SMS rides the email queue's operational pattern: store it as an
      // email_notifications row with empty html? No — honest place is a queued
      // row the operator sends from SMS history. tenant_id 0 would violate the
      // FK. So owner SMS goes through email_notifications as TEXT body (kind:
      // operational), sent to the SMS provider is out of scope here.
      // Pragmatic call: queue as an operational EMAIL row whose text body is
      // the SMS text (the operator copies it into their phone or the gateway).
      `INSERT INTO email_notifications (tenant_id, email_address, subject, body_html, body_text, status)
       VALUES (NULL, $1, $2, $3, $4, 'PENDING') RETURNING id`,
      [f.ownerEmail ?? 'sms@owner.local', `Owner remittance SMS — ${f.monthName} ${f.year}`, `<pre>${message}</pre>`, message],
    );
    await logAudit({ userId: req.user!.userId, action: 'OWNER_REMITTANCE_SMS_QUEUED', entity: 'settings', entityId: 1, newValue: { month, emailId: inserted?.id ?? null } });
    res.status(202).json({ data: { channel, message, queuedId: inserted?.id ?? null, whatsappUrl: null } });
    return;
  }

  // EMAIL — the full statement with the monthly report PDF attached.
  const periodEnd = new Date(Date.UTC(settings.reporting_year, month, 0)).toISOString().slice(0, 10);
  const composed = composeOwnerRemittanceEmail(f, periodEnd);
  const { bytes } = await monthlyReportPdf(settings.reporting_year);
  const pending = await queueReminderEmail({
    to: f.ownerEmail!,
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    attachments: [
      { filename: `financial-report-${settings.reporting_year}.pdf`, content: Buffer.from(bytes).toString('base64'), contentType: 'application/pdf' },
    ],
  });
  await logAudit({ userId: req.user!.userId, action: 'OWNER_REMITTANCE_EMAILED', entity: 'settings', entityId: 1, newValue: { month, emailId: pending.id, to: pending.email_address } });
  // Owner emails send immediately (the operator explicitly asked) — same
  // one-step pattern as the tenant statement email.
  const row = await sendEmailNotification(pending.id);
  res.status(201).json({ data: { channel, message: composed.text, queuedId: row.id, whatsappUrl: null, status: row.status } });
}));

export default router;