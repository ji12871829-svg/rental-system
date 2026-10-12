import { Router } from 'express';
import { z } from 'zod';
import { managerOrAdmin, requireAuth } from '../middleware/auth';
import { validateBody, validateParams, listQuerySchema as baseListQuerySchema } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createMaintenanceRequest,
  createWorkOrder,
  deleteMaintenanceRequest,
  getMaintenanceRequest,
  listMaintenanceRequests,
  updateMaintenanceRequest,
  updateWorkOrder,
  type MaintenanceRequestInput,
  type MaintenanceUpdateInput,
  type WorkOrderInput,
  type WorkOrderUpdateInput,
} from '../services/maintenanceService';

const router = Router();
router.use(requireAuth);

// Any staff member can log a problem report; managing it (priority, status,
// work orders) is a manager/admin action — mirrors the expense split.
const listQuerySchema = baseListQuerySchema.extend({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY']).optional(),
  unitId: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const result = await listMaintenanceRequests({ ...q });
  res.json({ data: result.rows, pagination: result.pagination });
}));

const requestSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().max(5000).optional(),
  unitId: z.number().int().positive().optional(),
  tenantId: z.number().int().positive().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY']).optional(),
});

router.post('/', validateBody(requestSchema), asyncHandler(async (req, res) => {
  const row = await createMaintenanceRequest(req.body as MaintenanceRequestInput, req.user!.userId);
  res.status(201).json({ data: row });
}));

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

router.get('/:id', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const { request, workOrders } = await getMaintenanceRequest(Number(req.params.id));
  res.json({ data: { ...request, work_orders: workOrders } });
}));

const updateSchema = requestSchema.partial().extend({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED']).optional(),
});

router.put('/:id', managerOrAdmin, validateParams(paramsSchema), validateBody(updateSchema), asyncHandler(async (req, res) => {
  const row = await updateMaintenanceRequest(Number(req.params.id), req.body as MaintenanceUpdateInput, req.user!.userId);
  res.json({ data: row });
}));

router.delete('/:id', managerOrAdmin, validateParams(paramsSchema), asyncHandler(async (req, res) => {
  await deleteMaintenanceRequest(Number(req.params.id), req.user!.userId);
  res.status(204).end();
}));

const workOrderSchema = z.object({
  vendorId: z.number().int().positive().optional(),
  assignedTo: z.string().trim().max(120).optional(),
  cost: z.number().min(0).optional(),
  scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(2000).optional(),
});

router.post('/:id/work-orders', managerOrAdmin, validateParams(paramsSchema), validateBody(workOrderSchema), asyncHandler(async (req, res) => {
  const row = await createWorkOrder(Number(req.params.id), req.body as WorkOrderInput, req.user!.userId);
  res.status(201).json({ data: row });
}));

const workOrderUpdateSchema = workOrderSchema.partial().extend({
  status: z.enum(['ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(),
});

router.put('/work-orders/:id', managerOrAdmin, validateParams(z.object({ id: z.coerce.number().int().positive() })), validateBody(workOrderUpdateSchema), asyncHandler(async (req, res) => {
  const row = await updateWorkOrder(Number(req.params.id), req.body as WorkOrderUpdateInput, req.user!.userId);
  res.json({ data: row });
}));

export default router;
