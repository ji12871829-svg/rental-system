"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const asyncHandler_1 = require("../utils/asyncHandler");
const userService_1 = require("../services/userService");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, auth_1.adminOnly);
const createSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    email: zod_1.z.string().email(),
    phone: zod_1.z.string().optional(),
    password: zod_1.z.string().min(8, 'Password must be at least 8 characters.'),
    role: zod_1.z.enum(['ADMIN', 'PROPERTY_MANAGER', 'STAFF']),
});
const updateSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).optional(),
    phone: zod_1.z.string().optional(),
    role: zod_1.z.enum(['ADMIN', 'PROPERTY_MANAGER', 'STAFF']).optional(),
    status: zod_1.z.enum(['ACTIVE', 'INACTIVE']).optional(),
    password: zod_1.z.string().min(8).optional(),
});
const paramsSchema = zod_1.z.object({ id: zod_1.z.coerce.number().int().positive() });
router.get('/', (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const rows = await (0, userService_1.listUsers)();
    res.json({ data: rows });
}));
router.post('/', (0, validate_1.validateBody)(createSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, userService_1.createUser)(req.body, req.user.userId);
    res.status(201).json({ data: row });
}));
router.put('/:id', (0, validate_1.validateParams)(paramsSchema), (0, validate_1.validateBody)(updateSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, userService_1.updateUser)(Number(req.params.id), req.body, req.user.userId);
    res.json({ data: row });
}));
router.delete('/:id', (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await (0, userService_1.deleteUser)(Number(req.params.id), req.user.userId);
    res.status(204).end();
}));
exports.default = router;
//# sourceMappingURL=users.js.map