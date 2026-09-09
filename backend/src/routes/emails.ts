import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validateParams } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getEmailConfig } from '../services/emailProvider';
import { listEmails, sendEmailNotification } from '../services/emailService';

const router = Router();
router.use(requireAuth);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
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

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.post('/:id/send', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const row = await sendEmailNotification(Number(req.params.id));
  res.json({ data: row });
}));

export default router;
