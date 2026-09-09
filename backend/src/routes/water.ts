import { Router } from 'express';
import { z } from 'zod';
import { adminOnly, requireAuth } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getSettings } from '../services/settingsService';
import {
  createPurchase, createReading, createWaterPayment, deletePurchase, deleteReading,
  deleteWaterPayment, listPurchases, listReadings, listWaterPayments,
  monthlyWaterSummary, outstandingWaterByUnit, updatePurchase, updateReading, waterPaymentsCsv, waterSummary,
} from '../services/waterService';

const router = Router();
router.use(requireAuth);

const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const monthYearQuery = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// --- Readings ---------------------------------------------------------------
router.get('/readings', asyncHandler(async (req, res) => {
  const q = { ...paginationQuery.parse(req.query), ...monthYearQuery.parse(req.query) } as any;
  const q2 = z.object({ unitId: z.coerce.number().int().positive().optional(), q: z.string().optional() }).parse(req.query);
  const result = await listReadings({ page: q.page, limit: q.limit, month: q.month, year: q.year, unitId: q2.unitId, q: q2.q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

const readingSchema = z.object({
  unitId: z.number().int().positive(),
  readingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billingMonth: z.number().int().min(1).max(12),
  billingYear: z.number().int().min(2000).max(2100),
  currentReading: z.number().min(0),
  previousReading: z.number().min(0).optional(), // first-reading establishment
  notes: z.string().optional(),
});

router.post('/readings', validateBody(readingSchema), asyncHandler(async (req, res) => {
  const result = await createReading(req.body as any, req.user!.userId);
  res.status(201).json({ data: result });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

const readingUpdateSchema = z.object({
  readingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currentReading: z.number().min(0).optional(),
  notes: z.string().optional(),
});

router.put('/readings/:id', validateParams(paramsSchema), validateBody(readingUpdateSchema), asyncHandler(async (req, res) => {
  const row = await updateReading(Number(req.params.id), req.body as any, req.user!.userId);
  res.json({ data: row });
}));

router.delete('/readings/:id', adminOnly, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deleteReading(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

// --- Water payments ---------------------------------------------------------
router.get('/payments', asyncHandler(async (req, res) => {
  const q = { ...paginationQuery.parse(req.query), ...monthYearQuery.parse(req.query) } as any;
  const q2 = z.object({ unitId: z.coerce.number().int().positive().optional(), tenantId: z.coerce.number().int().positive().optional(), q: z.string().optional() }).parse(req.query);
  const result = await listWaterPayments({ page: q.page, limit: q.limit, month: q.month, year: q.year, unitId: q2.unitId, tenantId: q2.tenantId, q: q2.q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

// CSV export — mirrors /api/rent/payments/export (same year/month filters).
router.get('/payments/export', asyncHandler(async (req, res) => {
  const q = monthYearQuery.parse(req.query);
  const csv = await waterPaymentsCsv({ year: q.year, month: q.month });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="water-payments.csv"');
  res.send(csv);
}));

const waterPaymentSchema = z.object({
  tenantId: z.number().int().positive(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billingMonth: z.number().int().min(1).max(12),
  billingYear: z.number().int().min(2000).max(2100),
  amount: z.number().positive('Payment amount must be greater than zero.'),
  paymentMethod: z.enum(['CASH', 'M_PESA', 'BANK', 'OTHER']),
  notes: z.string().optional(),
});

router.post('/payments', validateBody(waterPaymentSchema), asyncHandler(async (req, res) => {
  const result = await createWaterPayment(req.body as any, req.user!.userId);
  res.status(201).json({ data: result });
}));

router.delete('/payments/:id', adminOnly, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deleteWaterPayment(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

// --- Water purchases --------------------------------------------------------
router.get('/purchases', asyncHandler(async (req, res) => {
  const q = { ...paginationQuery.parse(req.query), ...monthYearQuery.parse(req.query) } as any;
  const result = await listPurchases({ page: q.page, limit: q.limit, year: q.year, month: q.month });
  res.json({ data: result.rows, pagination: result.pagination });
}));

const purchaseSchema = z.object({
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplier: z.string().min(1),
  quantity: z.number().min(0),
  measurementUnit: z.string().optional(),
  costPerUnit: z.number().min(0),
  paymentMethod: z.enum(['CASH', 'M_PESA', 'BANK', 'OTHER']),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

router.post('/purchases', validateBody(purchaseSchema), asyncHandler(async (req, res) => {
  const row = await createPurchase(req.body as any, req.user!.userId);
  res.status(201).json({ data: row });
}));

router.put('/purchases/:id', validateParams(paramsSchema), validateBody(purchaseSchema.partial()), asyncHandler(async (req, res) => {
  const row = await updatePurchase(Number(req.params.id), req.body as any, req.user!.userId);
  res.json({ data: row });
}));

router.delete('/purchases/:id', adminOnly, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deletePurchase(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

// --- Summaries --------------------------------------------------------------
router.get('/summary', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
  const summary = await waterSummary(q.year ?? settings.reporting_year);
  res.json({ data: summary });
}));

router.get('/monthly', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
  const rows = await monthlyWaterSummary(q.year ?? settings.reporting_year);
  res.json({ data: rows });
}));

router.get('/outstanding-by-unit', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
  const rows = await outstandingWaterByUnit(q.year ?? settings.reporting_year);
  res.json({ data: rows });
}));

export default router;