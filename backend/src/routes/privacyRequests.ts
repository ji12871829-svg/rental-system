import { Router } from 'express';
import { z } from 'zod';
import { adminOnly, requireAuth } from '../middleware/auth';
import { listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { listPrivacyRequests } from '../services/privacyService';

const router = Router();
router.use(requireAuth);

const listQuerySchema = baseListQuerySchema.extend({
  type: z.enum(['EXPORT_JSON', 'EXPORT_CSV', 'ERASURE']).optional(),
  outcome: z.enum(['COMPLETED', 'FAILED', 'REFUSED']).optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
});

// The register of data-subject requests (Kenya DPA 2019 / GDPR) — admin only,
// read-only. Entries are written exclusively by the export/erase endpoints.
router.get('/', adminOnly, asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listPrivacyRequests({ ...q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

export default router;
