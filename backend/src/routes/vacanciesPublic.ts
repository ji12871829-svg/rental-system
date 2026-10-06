// Public (unauthenticated) vacancy board — the marketing surface tenants see.
// Same posture as /api/public: mounted before the auth wall, GET is read-only,
// the inquiry POST is rate-limited harder than login (abuse is pure noise)
// and audited so operators see inquiries in the activity trail.
import { Router } from 'express';
import { z } from 'zod';
import { requestLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getSettings } from '../services/settingsService';
import { listPublicListings, recordListingInquiry, recordListingView, type InquiryInput } from '../services/vacancyService';

const router = Router();

router.get('/vacancies', asyncHandler(async (_req, res) => {
  const listings = await listPublicListings();
  const { currency } = await getSettings();
  res.json({ data: { currency, listings } });
}));

router.post('/vacancies/:id/view', asyncHandler(async (req, res) => {
  await recordListingView(Number(req.params.id));
  res.json({ data: { ok: true } });
}));

const inquirySchema = z.object({
  name: z.string().trim().min(2).max(120),
  contact: z.string().trim().min(5).max(160),
  message: z.string().trim().max(2000).optional(),
});

router.post('/vacancies/:id/inquiries', requestLimiter, validateBody(inquirySchema), asyncHandler(async (req, res) => {
  const inquiry = await recordListingInquiry(Number(req.params.id), req.body as InquiryInput);
  res.status(201).json({ data: inquiry });
}));

export default router;
