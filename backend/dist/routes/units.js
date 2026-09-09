"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const asyncHandler_1 = require("../utils/asyncHandler");
const unitService_1 = require("../services/unitService");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const listQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().positive().default(1),
    limit: zod_1.z.coerce.number().int().positive().max(100).default(50),
    floorId: zod_1.z.coerce.number().int().positive().optional(),
    occupancyStatus: zod_1.z.enum(['OCCUPIED', 'VACANT']).optional(),
    waterEnabled: zod_1.z.enum(['true', 'false']).optional(),
    q: zod_1.z.string().optional(),
});
router.get('/', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const result = await (0, unitService_1.listUnits)({
        page: q.page,
        limit: q.limit,
        floorId: q.floorId,
        occupancyStatus: q.occupancyStatus,
        waterEnabled: q.waterEnabled === undefined ? undefined : q.waterEnabled === 'true',
        q: q.q,
    });
    res.json({ data: result.rows, pagination: result.pagination });
}));
const createSchema = zod_1.z.object({
    floorId: zod_1.z.number().int().positive(),
    unitNumber: zod_1.z.string().min(1).max(20),
    unitType: zod_1.z.enum(['Room', 'Bedsitter', '1 Bedroom', '2 Bedroom']),
    monthlyRent: zod_1.z.number().min(0),
    waterEnabled: zod_1.z.boolean().default(false),
    occupancyStatus: zod_1.z.enum(['OCCUPIED', 'VACANT']).optional(),
});
router.post('/', auth_1.managerOrAdmin, (0, validate_1.validateBody)(createSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, unitService_1.createUnit)(req.body, req.user.userId);
    res.status(201).json({ data: row });
}));
const paramsSchema = zod_1.z.object({ id: zod_1.z.coerce.number().int().positive() });
router.get('/:id/history', (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const history = await (0, unitService_1.unitFinancialHistory)(Number(req.params.id));
    res.json({ data: history });
}));
router.get('/:id', (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, unitService_1.getUnit)(Number(req.params.id));
    res.json({ data: row });
}));
const updateSchema = zod_1.z.object({
    floorId: zod_1.z.number().int().positive().optional(),
    unitNumber: zod_1.z.string().min(1).max(20).optional(),
    unitType: zod_1.z.enum(['Room', 'Bedsitter', '1 Bedroom', '2 Bedroom']).optional(),
    monthlyRent: zod_1.z.number().min(0).optional(), // Room 12 rent is editable (§2)
    waterEnabled: zod_1.z.boolean().optional(),
    occupancyStatus: zod_1.z.enum(['OCCUPIED', 'VACANT']).optional(),
});
router.put('/:id', auth_1.managerOrAdmin, (0, validate_1.validateParams)(paramsSchema), (0, validate_1.validateBody)(updateSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, unitService_1.updateUnit)(Number(req.params.id), req.body, req.user.userId);
    res.json({ data: row });
}));
router.delete('/:id', auth_1.adminOnly, (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await (0, unitService_1.deleteUnit)(Number(req.params.id), req.user.userId);
    res.status(204).end();
}));
exports.default = router;
//# sourceMappingURL=units.js.map