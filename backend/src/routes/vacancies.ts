import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createVacancyListing,
  deleteVacancyListing,
  listVacancyListings,
  updateVacancyListing,
  type VacancyInput,
} from '../services/vacancyService';

// Staff-managed surface. The public board lives on its own sub-router
// (mounted by app.ts BEFORE requireAuth, mirroring how /api/public works).
const router = Router();
router.use(requireAuth);

const listQuerySchema = baseListQuerySchema.extend({
  published: z.enum(['true', 'false']).optional(),
  q: z.string().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listVacancyListings({
    ...q,
    published: q.published === undefined ? undefined : q.published === 'true',
  });
  res.json({ data: result.rows, pagination: result.pagination });
}));

const listingSchema = z.object({
  unitId: z.number().int().positive(),
  title: z.string().trim().min(3).max(160),
  description: z.string().max(5000).optional(),
  rentAmount: z.number().positive('Rent must be greater than zero.'),
  deposit: z.number().min(0).optional(),
  amenities: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  isPublished: z.boolean().optional(),
});

router.post('/', managerOrAdmin, validateBody(listingSchema), asyncHandler(async (req, res) => {
  const row = await createVacancyListing(req.body as VacancyInput, req.user!.userId);
  res.status(201).json({ data: row });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

// photoUris are data-URLs or /api paths produced by the document vault —
// strings only, size-capped by JSON body limits (photos live as URIs here,
// unlike vault files which are bytea).
const updateSchema = listingSchema.partial().omit({ unitId: true }).extend({
  photoUris: z.array(z.string().min(1).max(500_000)).max(10).optional(),
});

router.put('/:id', managerOrAdmin, validateParams(paramsSchema), validateBody(updateSchema), asyncHandler(async (req, res) => {
  const row = await updateVacancyListing(Number(req.params.id), req.body as Partial<VacancyInput> & { photoUris?: string[] }, req.user!.userId);
  res.json({ data: row });
}));

router.delete('/:id', managerOrAdmin, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deleteVacancyListing(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

export default router;
