import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validateParams, validateQuery } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getSettings } from '../services/settingsService';
import { arrears, combinedMonthlySummary, dashboard, monthlyReportPdf, tenantLedger } from '../services/financeService';
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

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.get('/tenant/:id', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const q = yearQuery.parse(req.query);
  const settings = await getSettings();
  const data = await tenantLedger(Number(req.params.id), q.year ?? settings.reporting_year);
  res.json({ data });
}));

export default router;