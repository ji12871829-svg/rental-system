import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  applyPenalties,
  createPenaltyRule,
  deletePenaltyRule,
  listPenaltyLog,
  listPenaltyRules,
  previewPenalties,
  updatePenaltyRule,
  type PenaltyRuleInput,
} from '../services/penaltyService';

const router = Router();
router.use(requireAuth);

const monthYear = {
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
};

router.get('/rules', asyncHandler(async (_req, res) => {
  res.json({ data: await listPenaltyRules() });
}));

const ruleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  ruleType: z.enum(['FIXED', 'PERCENTAGE']),
  amount: z.number().min(0).optional(),
  percentage: z.number().min(0).max(100).optional(),
  graceDays: z.number().int().min(0).max(365).optional(),
  maxPenalty: z.number().positive().nullable().optional(),
  appliesTo: z.enum(['RENT', 'WATER']).optional(),
  active: z.boolean().optional(),
});

router.post('/rules', managerOrAdmin, validateBody(ruleSchema), asyncHandler(async (req, res) => {
  const row = await createPenaltyRule(req.body as PenaltyRuleInput, req.user!.userId);
  res.status(201).json({ data: row });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.put('/rules/:id', managerOrAdmin, validateParams(paramsSchema), validateBody(ruleSchema.partial()), asyncHandler(async (req, res) => {
  const row = await updatePenaltyRule(Number(req.params.id), req.body as Partial<PenaltyRuleInput>, req.user!.userId);
  res.json({ data: row });
}));

router.delete('/rules/:id', managerOrAdmin, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deletePenaltyRule(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

// Dry-run: exactly what apply would charge right now, for the confirm dialog.
router.get('/rules/:id/preview', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const q = z.object(monthYear).parse(req.query);
  const rows = await previewPenalties(Number(req.params.id), q.month, q.year);
  res.json({ data: rows });
}));

router.post('/rules/:id/apply', managerOrAdmin, validateParams(paramsSchema), validateBody(z.object(monthYear).optional()), asyncHandler(async (req, res) => {
  const { month, year } = (req.body ?? {}) as { month?: number; year?: number };
  const result = await applyPenalties(Number(req.params.id), req.user!.userId, month, year);
  res.json({ data: result });
}));

router.get('/log', asyncHandler(async (req, res) => {
  const q = baseListQuerySchema.extend({
    tenantId: z.coerce.number().int().positive().optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  }).parse(req.query);
  const result = await listPenaltyLog(q);
  res.json({ data: result.rows, pagination: result.pagination });
}));

export default router;
