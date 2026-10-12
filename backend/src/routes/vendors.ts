import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { createVendor, deleteVendor, listVendors, updateVendor, type VendorInput } from '../services/vendorService';

const router = Router();
router.use(requireAuth);

const listQuerySchema = baseListQuerySchema.extend({
  q: z.string().optional(),
  service: z.string().optional(),
  active: z.enum(['true', 'false']).optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listVendors({
    ...q,
    active: q.active === undefined ? undefined : q.active === 'true',
  });
  res.json({ data: result.rows, pagination: result.pagination });
}));

const vendorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  service: z.enum(['PLUMBING', 'ELECTRICAL', 'CLEANING', 'SECURITY', 'CARPENTRY', 'PAINTING', 'LANDSCAPING', 'PEST_CONTROL', 'GENERAL_REPAIRS', 'OTHER']),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(255).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(2000).optional(),
  active: z.boolean().optional(),
});

router.post('/', managerOrAdmin, validateBody(vendorSchema), asyncHandler(async (req, res) => {
  const row = await createVendor(req.body as VendorInput, req.user!.userId);
  res.status(201).json({ data: row });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.put('/:id', managerOrAdmin, validateParams(paramsSchema), validateBody(vendorSchema.partial()), asyncHandler(async (req, res) => {
  const row = await updateVendor(Number(req.params.id), req.body as Partial<VendorInput>, req.user!.userId);
  res.json({ data: row });
}));

router.delete('/:id', managerOrAdmin, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deleteVendor(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

export default router;
