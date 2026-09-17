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
})), asyncHandler(async (req, res) => {
  const result = await resolveMpesaReviewTransaction(Number(req.params.id), req.body.tenantId, req.body.kind, req.user!.userId);
  res.json({ data: result });
}));

export default router;