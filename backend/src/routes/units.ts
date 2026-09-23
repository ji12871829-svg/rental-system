import { Router } from 'express';
import { z } from 'zod';
import { adminOnly, managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { createUnit, deleteUnit, getUnit, listUnits, unitFinancialHistory, updateUnit, type UnitInput } from '../services/unitService';

const router = Router();
router.use(requireAuth);

const listQuerySchema = baseListQuerySchema.extend({
  limit: z.coerce.number().int().positive().max(100).default(50),
  floorId: z.coerce.number().int().positive().optional(),
  occupancyStatus: z.enum(['OCCUPIED', 'VACANT']).optional(),
  waterEnabled: z.enum(['true', 'false']).optional(),
  q: z.string().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listUnits({
    page: q.page,
    limit: q.limit,
    floorId: q.floorId,
    occupancyStatus: q.occupancyStatus,
    waterEnabled: q.waterEnabled === undefined ? undefined : q.waterEnabled === 'true',
    q: q.q,
  });
  res.json({ data: result.rows, pagination: result.pagination });
}));

const createSchema = z.object({
  floorId: z.number().int().positive(),
  unitNumber: z.string().min(1).max(20),
  unitType: z.enum(['Room', 'Bedsitter', '1 Bedroom', '2 Bedroom']),
  monthlyRent: z.number().min(0),
  waterEnabled: z.boolean().default(false),
  occupancyStatus: z.enum(['OCCUPIED', 'VACANT']).optional(),
});

router.post('/', managerOrAdmin, validateBody(createSchema), asyncHandler(async (req, res) => {
  const row = await createUnit(req.body as UnitInput, req.user!.userId);
  res.status(201).json({ data: row });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.get('/:id/history', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const history = await unitFinancialHistory(Number(req.params.id));
  res.json({ data: history });
}));

router.get('/:id', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const row = await getUnit(Number(req.params.id));
  res.json({ data: row });
}));

const updateSchema = z.object({
  floorId: z.number().int().positive().optional(),
  unitNumber: z.string().min(1).max(20).optional(),
  unitType: z.enum(['Room', 'Bedsitter', '1 Bedroom', '2 Bedroom']).optional(),
  monthlyRent: z.number().min(0).optional(), // Room 12 rent is editable (§2)
  waterEnabled: z.boolean().optional(),
  occupancyStatus: z.enum(['OCCUPIED', 'VACANT']).optional(),
});

router.put('/:id', managerOrAdmin, validateParams(paramsSchema), validateBody(updateSchema), asyncHandler(async (req, res) => {
  const row = await updateUnit(Number(req.params.id), req.body as Partial<UnitInput>, req.user!.userId);
  res.json({ data: row });
}));

router.delete('/:id', adminOnly, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deleteUnit(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

export default router;