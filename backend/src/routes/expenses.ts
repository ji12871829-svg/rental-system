import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getSettings } from '../services/settingsService';
import { createExpense, deleteExpense, expenseSummary, listExpenses, updateExpense, type ExpenseInput } from '../services/expenseService';

const router = Router();
router.use(requireAuth);

const listQuerySchema = baseListQuerySchema.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  category: z.string().optional(),
  q: z.string().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listExpenses({ ...q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

const createSchema = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(2),
  category: z.enum(['WATER', 'REPAIRS', 'ELECTRICITY', 'MAINTENANCE', 'CLEANING', 'SECURITY', 'TRANSPORT', 'OTHER']),
  amount: z.number().positive('Expense amount must be greater than zero.'),
  paymentMethod: z.enum(['CASH', 'M_PESA', 'BANK', 'OTHER']),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

router.post('/', managerOrAdmin, validateBody(createSchema), asyncHandler(async (req, res) => {
  const row = await createExpense(req.body as ExpenseInput, req.user!.userId);
  res.status(201).json({ data: row });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.put('/:id', managerOrAdmin, validateParams(paramsSchema), validateBody(createSchema.partial()), asyncHandler(async (req, res) => {
  const row = await updateExpense(Number(req.params.id), req.body as Partial<ExpenseInput>, req.user!.userId);
  res.json({ data: row });
}));

router.delete('/:id', managerOrAdmin, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deleteExpense(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
  const summary = await expenseSummary(q.year ?? settings.reporting_year);
  res.json({ data: summary });
}));

export default router;