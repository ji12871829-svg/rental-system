import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getSettings, updateSettings } from '../services/settingsService';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  res.json({ data: settings });
}));

const updateSchema = z.object({
  reportingYear: z.number().int().min(2000).max(2100).optional(),
  currency: z.string().min(1).max(10).optional(),
  waterRate: z.number().min(0).optional(),
  retentionYears: z.number().int().min(0).max(30).optional(),
});

router.put('/', managerOrAdmin, validateBody(updateSchema), asyncHandler(async (req, res) => {
  const settings = await updateSettings(req.body as any, req.user!.userId);
  res.json({ data: settings });
}));

export default router;