"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const asyncHandler_1 = require("../utils/asyncHandler");
const receiptService_1 = require("../services/receiptService");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const listQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().positive().default(1),
    limit: zod_1.z.coerce.number().int().positive().max(100).default(20),
    receiptType: zod_1.z.enum(['RENT', 'WATER', 'COMBINED']).optional(),
    tenantId: zod_1.z.coerce.number().int().positive().optional(),
    unitId: zod_1.z.coerce.number().int().positive().optional(),
    month: zod_1.z.coerce.number().int().min(1).max(12).optional(),
    year: zod_1.z.coerce.number().int().min(2000).max(2100).optional(),
    q: zod_1.z.string().optional(),
});
router.get('/', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const result = await (0, receiptService_1.listReceipts)({ ...q });
    res.json({ data: result.rows, pagination: result.pagination });
}));
const paramsSchema = zod_1.z.object({ id: zod_1.z.coerce.number().int().positive() });
router.get('/:id', (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, receiptService_1.getReceiptById)(Number(req.params.id));
    res.json({ data: row });
}));
// Combined RWC receipt for a tenant's billing month (spec §33).
const generateSchema = zod_1.z.object({
    tenantId: zod_1.z.number().int().positive(),
    billingMonth: zod_1.z.number().int().min(1).max(12),
    billingYear: zod_1.z.number().int().min(2000).max(2100),
});
router.post('/generate', (0, validate_1.validateBody)(generateSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, receiptService_1.generateCombinedReceipt)(req.body);
    res.status(201).json({ data: row });
}));
exports.default = router;
//# sourceMappingURL=receipts.js.map