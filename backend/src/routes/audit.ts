import { Router } from 'express';
import { z } from 'zod';
import { adminOnly, requireAuth } from '../middleware/auth';
import { listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { listAuditLogs } from '../services/auditService';

const router = Router();
router.use(requireAuth, adminOnly);

const querySchema = baseListQuerySchema.extend({
  entity: z.string().optional(),
  action: z.string().optional(),
  userId: z.coerce.number().int().positive().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const q = querySchema.parse(req.query);
  const result = await listAuditLogs({ page: q.page, limit: q.limit, entity: q.entity, action: q.action, userId: q.userId });
  res.json({ data: result.rows, pagination: result.pagination });
}));

export default router;