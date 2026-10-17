import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validateBody, validateParams, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getWhatsappConfig, getWhatsappTemplates } from '../services/whatsappProvider';
import { listWhatsapp, sendWhatsappNotification } from '../services/whatsappService';

const router = Router();
router.use(requireAuth);

const listQuerySchema = baseListQuerySchema.extend({
  // ERRONEOUS = terminal rejection — the number itself was refused (e.g. not
  // registered on WhatsApp); FAILED = transient with a retry deadline. See
  // sendWhatsappNotification and the whatsappRetryJob sweep.
  status: z.enum(['PENDING', 'SENT', 'FAILED', 'ERRONEOUS']).optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
});

// Current delivery mode so the UI can label sends honestly: 'cloud' means
// direct Graph API sending, 'none' means click-to-chat fallback only. No
// secrets returned (token/number id stay in .env). Template mode rides along:
// which registered template each kind uses, or null for free-form.
router.get('/config', asyncHandler(async (_req, res) => {
  res.json({ data: { ...getWhatsappConfig(), templates: getWhatsappTemplates() } });
}));

// Delivery history.
router.get('/history', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listWhatsapp({ ...q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listWhatsapp({ ...q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

// An optional corrected recipient number: an ERRONEOUS row is stuck because
// the number itself was refused, so the operator fixes the digits in place
// and the re-send goes to the corrected number. Omitted body = re-send to
// the stored number (the normal retry path — e.g. the 24-hour window opened
// since the failure, or the retry deadline passed and the sweep is not due
// yet).
const sendAgainSchema = z.object({
  phone: z.string().trim().min(7).max(24).optional(),
});

router.post('/:id/send', validateParams(paramsSchema), validateBody(sendAgainSchema.optional()), asyncHandler(async (req, res) => {
  const { phone } = (req.body ?? {}) as { phone?: string };
  const row = await sendWhatsappNotification(Number(req.params.id), { phone });
  res.json({ data: row });
}));

// Manual purge is deliberately not offered: a WhatsApp history row is the
// correspondence record of a formal demand (possibly a Final Notice), and
// rows drop out when the tenant themselves is deleted.

export default router;
