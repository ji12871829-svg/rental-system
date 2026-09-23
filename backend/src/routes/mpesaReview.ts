import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { ignoreMpesaReviewTransaction, listMpesaReviewTransactions, resolveMpesaReviewTransaction } from '../services/mpesaReviewService';

const router = Router();
router.use(requireAuth, managerOrAdmin);
const params = z.object({ id: z.coerce.number().int().positive() });

router.get('/', asyncHandler(async (_req, res) => {
  res.json({ data: await listMpesaReviewTransactions() });
}));

router.post('/:id/ignore', validateParams(params), asyncHandler(async (req, res) => {
  await ignoreMpesaReviewTransaction(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

router.post('/:id/resolve', validateParams(params), validateBody(z.object({
  tenantId: z.number().int().positive(),
  kind: z.enum(['RENT', 'WATER']),
  // Rent defaults to oldest-arrears allocation (same engine as the automatic
  // path). Set false to force the whole amount onto the transaction's month
  // (e.g. a deliberate correction).
  allocate: z.boolean().optional(),
})), asyncHandler(async (req, res) => {
  const result = await resolveMpesaReviewTransaction(
    Number(req.params.id), req.body.tenantId, req.body.kind, req.user!.userId, req.body.allocate !== false
  );
  res.json({ data: result });
}));

export default router;