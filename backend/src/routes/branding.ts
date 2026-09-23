import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  getBrandingView,
  getLogo,
  removeLogo,
  toView,
  updateBranding,
  uploadLogo,
  type BrandingInput,
} from '../services/brandingService';

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
  paybillNumber: z.string().regex(/^\d{5,10}$/, 'PayBill number must contain 5 to 10 digits.').nullable().optional().or(z.literal('')),
  paybillName: z.string().max(200).nullable().optional(),
  paybillEnabled: z.boolean().optional(),
  paybillInstructions: z.string().max(1000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.paybillEnabled && !value.paybillNumber) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paybillNumber'], message: 'PayBill number is required when PayBill is enabled.' });
  }
  if (value.paybillEnabled && !value.paybillName?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paybillName'], message: 'PayBill business name is required when PayBill is enabled.' });
  }
});

router.put('/', requireAuth, managerOrAdmin, validateBody(updateSchema), asyncHandler(async (req, res) => {
  const row = await updateBranding(req.body as BrandingInput, req.user!.userId);
  res.json({ data: toView(row) });
}));

// --- Business logo ---------------------------------------------------------

// Public read: like the identity itself, the logo is printed on tenant
// receipts — it is not secret. Long-lived immutable caching keyed by
// logo_updated_at, so a new upload (new timestamp) busts every cache.
router.get('/logo', asyncHandler(async (_req, res) => {
  const logo = await getLogo();
  if (!logo) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'No logo uploaded.', details: {} });
    return;
  }
  const etag = `"${new Date(logo.updatedAt).getTime()}"`;
  res.setHeader('Content-Type', logo.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.setHeader('ETag', etag);
  if (_req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.send(Buffer.from(logo.data, 'base64'));
}));

// Body: { logo: 'data:image/png;base64,…' } — one upload, one replace.
const logoSchema = z.object({
  logo: z.string().regex(/^data:image\//, 'Logo must be a base64 data URL (data:image/…;base64,…).'),
});

router.put('/logo', requireAuth, managerOrAdmin, validateBody(logoSchema), asyncHandler(async (req, res) => {
  const result = await uploadLogo((req.body as { logo: string }).logo, req.user!.userId);
  res.json({ data: result });
}));

router.delete('/logo', requireAuth, managerOrAdmin, asyncHandler(async (req, res) => {
  await removeLogo(req.user!.userId);
  res.status(204).end();
}));

export default router;
