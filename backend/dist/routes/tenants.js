"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const asyncHandler_1 = require("../utils/asyncHandler");
const settingsService_1 = require("../services/settingsService");
const tenantService_1 = require("../services/tenantService");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const listQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().positive().default(1),
    limit: zod_1.z.coerce.number().int().positive().max(100).default(50),
    status: zod_1.z.enum(['ACTIVE', 'MOVED_OUT']).optional(),
    unitId: zod_1.z.coerce.number().int().positive().optional(),
    q: zod_1.z.string().optional(),
});
router.get('/', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const result = await (0, tenantService_1.listTenants)({ page: q.page, limit: q.limit, status: q.status, unitId: q.unitId, q: q.q });
    res.json({ data: result.rows, pagination: result.pagination });
}));
const createSchema = zod_1.z.object({
    unitId: zod_1.z.number().int().positive().nullable().optional(),
    fullName: zod_1.z.string().min(2),
    phoneNumber: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal('')),
    moveInDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    securityDeposit: zod_1.z.number().min(0).optional(),
    notes: zod_1.z.string().optional(),
});
router.post('/', auth_1.managerOrAdmin, (0, validate_1.validateBody)(createSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, tenantService_1.createTenant)(req.body, req.user.userId);
    res.status(201).json({ data: row });
}));
const paramsSchema = zod_1.z.object({ id: zod_1.z.coerce.number().int().positive() });
router.get('/:id', (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const settings = await (0, settingsService_1.getSettings)();
    const row = await (0, tenantService_1.getTenant)(Number(req.params.id), settings.reporting_year);
    res.json({ data: row });
}));
const updateSchema = zod_1.z.object({
    unitId: zod_1.z.number().int().positive().nullable().optional(),
    fullName: zod_1.z.string().min(2).optional(),
    phoneNumber: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal('')),
    moveInDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    securityDeposit: zod_1.z.number().min(0).optional(),
    notes: zod_1.z.string().optional(),
});
router.put('/:id', auth_1.managerOrAdmin, (0, validate_1.validateParams)(paramsSchema), (0, validate_1.validateBody)(updateSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, tenantService_1.updateTenant)(Number(req.params.id), req.body, req.user.userId);
    res.json({ data: row });
}));
const transferSchema = zod_1.z.object({ newUnitId: zod_1.z.number().int().positive() });
router.post('/:id/transfer', auth_1.managerOrAdmin, (0, validate_1.validateParams)(paramsSchema), (0, validate_1.validateBody)(transferSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, tenantService_1.transferTenant)(Number(req.params.id), req.body.newUnitId, req.user.userId);
    res.json({ data: row });
}));
const moveOutSchema = zod_1.z.object({ moveOutDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
router.post('/:id/move-out', auth_1.managerOrAdmin, (0, validate_1.validateParams)(paramsSchema), (0, validate_1.validateBody)(moveOutSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, tenantService_1.moveOutTenant)(Number(req.params.id), req.body.moveOutDate, req.user.userId);
    res.json({ data: row });
}));
router.delete('/:id', auth_1.adminOnly, (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await (0, tenantService_1.deleteTenant)(Number(req.params.id), req.user.userId);
    res.status(204).end();
}));
exports.default = router;
//# sourceMappingURL=tenants.js.map