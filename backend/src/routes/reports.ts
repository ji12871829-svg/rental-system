import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getSettings } from '../services/settingsService';
import { getBusinessIdentity } from '../services/brandingService';
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

export default router;