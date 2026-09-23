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
  // Property-owner communication (owner remittance templates). Strings are
  // trimmed; empty string clears the stored value.
  ownerName: z.string().trim().max(150).optional(),
  ownerEmail: z.string().trim().email().max(255).optional(),
  ownerPhone: z.string().trim().max(30).optional(),
  managementFeePercent: z.number().min(0).max(100).optional(),
});

router.put('/', managerOrAdmin, validateBody(updateSchema), asyncHandler(async (req, res) => {
  const body = req.body as {
    reportingYear?: number; currency?: string; waterRate?: number; retentionYears?: number;
    ownerName?: string; ownerEmail?: string; ownerPhone?: string; managementFeePercent?: number;
  };
  const settings = await updateSettings({
    reportingYear: body.reportingYear,
    currency: body.currency,
    waterRate: body.waterRate,
    retentionYears: body.retentionYears,
    // Empty string means "clear this field"; undefined means "leave it".
    ownerName: body.ownerName === undefined ? undefined : (body.ownerName || null),
    ownerEmail: body.ownerEmail === undefined ? undefined : (body.ownerEmail || null),
    ownerPhone: body.ownerPhone === undefined ? undefined : (body.ownerPhone || null),
    managementFeePercent: body.managementFeePercent,
  }, req.user!.userId);
  res.json({ data: settings });
}));

export default router;