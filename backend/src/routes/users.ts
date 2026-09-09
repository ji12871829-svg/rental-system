import { Router } from 'express';
import { z } from 'zod';
import { adminOnly, requireAuth } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { createUser, deleteUser, listUsers, updateUser } from '../services/userService';

const router = Router();
router.use(requireAuth, adminOnly);

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  role: z.enum(['ADMIN', 'PROPERTY_MANAGER', 'STAFF']),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  role: z.enum(['ADMIN', 'PROPERTY_MANAGER', 'STAFF']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  password: z.string().min(8).optional(),
});

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.get('/', asyncHandler(async (_req, res) => {
  const rows = await listUsers();
  res.json({ data: rows });
}));

router.post('/', validateBody(createSchema), asyncHandler(async (req, res) => {
  const row = await createUser(req.body as any, req.user!.userId);
  res.status(201).json({ data: row });
}));

router.put('/:id', validateParams(paramsSchema), validateBody(updateSchema), asyncHandler(async (req, res) => {
  const row = await updateUser(Number(req.params.id), req.body as any, req.user!.userId);
  res.json({ data: row });
}));

router.delete('/:id', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deleteUser(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

export default router;