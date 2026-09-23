import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getEmailConfig } from '../services/emailProvider';
import { listEmails, sendEmailNotification, sendTestEmail, sendTenantCampaign } from '../services/emailService';

const router = Router();
router.use(requireAuth);

const listQuerySchema = baseListQuerySchema.extend({
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
});

// Current email mode so the UI can label sends honestly (no secrets returned).
router.get('/config', asyncHandler(async (_req, res) => {
  res.json({ data: getEmailConfig() });
}));

// Delivery history.
router.get('/history', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listEmails({ ...q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listEmails({ ...q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

const campaignSchema = z.object({
  tenantIds: z.array(z.number().int().positive()).max(1000).optional(),
  subject: z.string().trim().min(3).max(180),
  message: z.string().trim().min(3).max(5000),
});

router.post('/campaign', managerOrAdmin, validateBody(campaignSchema), asyncHandler(async (req, res) => {
  const result = await sendTenantCampaign({ ...req.body, userId: req.user!.userId });
  res.status(201).json({ data: result });
}));

// Provider config verification: sends a real test email through the
// configured provider and returns its verdict (message id / failure reason
// + latency). Not written to the delivery history — this is a diagnostic,
// not correspondence.
const testEmailSchema = z.object({
  to: z.string().email().max(255).optional(),
});

router.post('/test', managerOrAdmin, validateBody(testEmailSchema), asyncHandler(async (req, res) => {
  const result = await sendTestEmail({ to: req.body?.to, userId: req.user!.userId });
  res.json({ data: result });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.post('/:id/send', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const row = await sendEmailNotification(Number(req.params.id));
  res.json({ data: row });
}));

export default router;
