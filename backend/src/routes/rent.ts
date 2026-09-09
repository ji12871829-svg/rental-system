import { Router } from 'express';
import { z } from 'zod';
import { adminOnly, requireAuth } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { createRentPayment, deleteRentPayment, listRentPayments, monthlyRentSummary, rentPaymentsCsv } from '../services/rentService';
import { getSettings } from '../services/settingsService';

const router = Router();
router.use(requireAuth);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  unitId: z.coerce.number().int().positive().optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  paymentMethod: z.enum(['CASH', 'M_PESA', 'BANK', 'OTHER']).optional(),
  q: z.string().optional(),
});

router.get('/payments', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listRentPayments({ ...q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

// CSV export (spec §44).
router.get('/payments/export', asyncHandler(async (req, res) => {
  const q = listQuerySchema.partial().parse(req.query);
  const csv = await rentPaymentsCsv({ year: q.year, month: q.month });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rent-payments.csv"');
  res.send(csv);
}));

const createSchema = z.object({
  tenantId: z.number().int().positive(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billingMonth: z.number().int().min(1).max(12),
  billingYear: z.number().int().min(2000).max(2100),
  amount: z.number().positive('Payment amount must be greater than zero.'),
  paymentMethod: z.enum(['CASH', 'M_PESA', 'BANK', 'OTHER']),
  paymentReference: z.string().optional(),
  notes: z.string().optional(),
});

router.post('/payments', validateBody(createSchema), asyncHandler(async (req, res) => {
  const result = await createRentPayment(req.body as any, req.user!.userId);
  res.status(201).json({ data: result });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.delete('/payments/:id', adminOnly, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deleteRentPayment(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

// Monthly rent summary for the reporting year (§27).
router.get('/summary', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
  const rows = await monthlyRentSummary(q.year ?? settings.reporting_year);
  res.json({ data: rows, currency: settings.currency, reportingYear: q.year ?? settings.reporting_year });
}));

export default router;