import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getBrandingView, toView, updateBranding } from '../services/brandingService';

const router = Router();

// Public read: the identity drives the login page, legal pages and receipt
// chrome — none of it is secret (it's printed on paper handed to tenants).
router.get('/', asyncHandler(async (_req, res) => {
  res.json({ data: await getBrandingView() });
}));

// Every field optional; '' clears a value, omitted keys leave it unchanged.
const updateSchema = z.object({
  legalName: z.string().max(200).nullable().optional(),
  registrationNumber: z.string().max(100).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  contactEmail: z.string().email().max(255).nullable().optional().or(z.literal('')),
  privacyEmail: z.string().email().max(255).nullable().optional().or(z.literal('')),
  contactPhone: z.string().max(60).nullable().optional(),
  retentionPeriod: z.string().max(100).nullable().optional(),
  responseDays: z.string().max(20).nullable().optional(),
  jurisdiction: z.string().max(100).nullable().optional(),
  propertyScope: z.string().max(500).nullable().optional(),
  paymentChannels: z.string().max(200).nullable().optional(),
  refundWindowDays: z.string().max(40).nullable().optional(),
});

router.put('/', requireAuth, managerOrAdmin, validateBody(updateSchema), asyncHandler(async (req, res) => {
  const row = await updateBranding(req.body as any, req.user!.userId);
  res.json({ data: toView(row) });
}));

export default router;
