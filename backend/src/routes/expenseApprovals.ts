import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  approveExpenseApproval,
  createExpenseApproval,
  listExpenseApprovals,
  rejectExpenseApproval,
  type ExpenseApprovalInput,
} from '../services/expenseApprovalService';

const router = Router();
router.use(requireAuth);

const listQuerySchema = baseListQuerySchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listExpenseApprovals({ ...q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

// Same shape as a real expense — an approval IS a prospective expense.
const approvalSchema = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(2),
  category: z.enum(['WATER', 'REPAIRS', 'ELECTRICITY', 'MAINTENANCE', 'CLEANING', 'SECURITY', 'TRANSPORT', 'OTHER']),
  amount: z.number().positive('Amount must be greater than zero.'),
  paymentMethod: z.enum(['CASH', 'M_PESA', 'BANK', 'OTHER']),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

router.post('/', validateBody(approvalSchema), asyncHandler(async (req, res) => {
  const row = await createExpenseApproval(req.body as ExpenseApprovalInput, req.user!.userId);
  res.status(201).json({ data: row });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

const decisionSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

router.post('/:id/approve', managerOrAdmin, validateParams(paramsSchema), validateBody(decisionSchema.optional()), asyncHandler(async (req, res) => {
  const { note } = (req.body ?? {}) as { note?: string };
  const row = await approveExpenseApproval(Number(req.params.id), req.user!.userId, note);
  res.json({ data: row });
}));

router.post('/:id/reject', managerOrAdmin, validateParams(paramsSchema), validateBody(decisionSchema.optional()), asyncHandler(async (req, res) => {
  const { note } = (req.body ?? {}) as { note?: string };
  const row = await rejectExpenseApproval(Number(req.params.id), req.user!.userId, note);
  res.json({ data: row });
}));

export default router;
