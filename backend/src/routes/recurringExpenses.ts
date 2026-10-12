import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createRecurringExpense,
  deleteRecurringExpense,
  generateDueRecurringExpenses,
  generateRecurringExpense,
  listRecurringExpenses,
  updateRecurringExpense,
  type RecurringExpenseInput,
} from '../services/recurringExpenseService';

const router = Router();
router.use(requireAuth);

const listQuerySchema = baseListQuerySchema.extend({
  active: z.enum(['true', 'false']).optional(),
  q: z.string().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listRecurringExpenses({
    ...q,
    active: q.active === undefined ? undefined : q.active === 'true',
  });
  res.json({ data: result.rows, pagination: result.pagination });
}));

const recurringSchema = z.object({
  description: z.string().trim().min(2),
  category: z.enum(['WATER', 'REPAIRS', 'ELECTRICITY', 'MAINTENANCE', 'CLEANING', 'SECURITY', 'TRANSPORT', 'OTHER']),
  amount: z.number().positive('Amount must be greater than zero.'),
  paymentMethod: z.enum(['CASH', 'M_PESA', 'BANK', 'OTHER']),
  frequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  active: z.boolean().optional(),
});

router.post('/', managerOrAdmin, validateBody(recurringSchema), asyncHandler(async (req, res) => {
  const row = await createRecurringExpense(req.body as RecurringExpenseInput, req.user!.userId);
  res.status(201).json({ data: row });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.put('/:id', managerOrAdmin, validateParams(paramsSchema), validateBody(recurringSchema.partial()), asyncHandler(async (req, res) => {
  const row = await updateRecurringExpense(Number(req.params.id), req.body as Partial<RecurringExpenseInput>, req.user!.userId);
  res.json({ data: row });
}));

router.delete('/:id', managerOrAdmin, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deleteRecurringExpense(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

// Record the due period now (the nightly sweep does this automatically; this
// is the operator's "run it today" button).
router.post('/:id/generate', managerOrAdmin, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const row = await generateRecurringExpense(Number(req.params.id), req.user!.userId);
  res.json({ data: row });
}));

// Generate everything currently due (end-of-month catch-up button).
router.post('/generate-due', managerOrAdmin, asyncHandler(async (req, res) => {
  const result = await generateDueRecurringExpenses(req.user!.userId);
  res.json({ data: result });
}));

export default router;
