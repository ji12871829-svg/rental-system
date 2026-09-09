"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const asyncHandler_1 = require("../utils/asyncHandler");
const smsService_1 = require("../services/smsService");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const listQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().positive().default(1),
    limit: zod_1.z.coerce.number().int().positive().max(100).default(20),
    status: zod_1.z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
    tenantId: zod_1.z.coerce.number().int().positive().optional(),
    q: zod_1.z.string().optional(),
});
// History doubles as the list endpoint (spec §42: GET /api/sms/history).
router.get('/history', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const result = await (0, smsService_1.listSms)({ ...q });
    res.json({ data: result.rows, pagination: result.pagination });
}));
router.get('/', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const result = await (0, smsService_1.listSms)({ ...q });
    res.json({ data: result.rows, pagination: result.pagination });
}));
const paramsSchema = zod_1.z.object({ id: zod_1.z.coerce.number().int().positive() });
router.post('/:id/send', (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, smsService_1.sendSmsNotification)(Number(req.params.id));
    res.json({ data: row });
}));
exports.default = router;
//# sourceMappingURL=sms.js.map