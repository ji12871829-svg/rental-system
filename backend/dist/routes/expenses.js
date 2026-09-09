"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const asyncHandler_1 = require("../utils/asyncHandler");
const settingsService_1 = require("../services/settingsService");
const expenseService_1 = require("../services/expenseService");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const listQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().positive().default(1),
    limit: zod_1.z.coerce.number().int().positive().max(100).default(20),
    year: zod_1.z.coerce.number().int().min(2000).max(2100).optional(),
    month: zod_1.z.coerce.number().int().min(1).max(12).optional(),
    category: zod_1.z.string().optional(),
    q: zod_1.z.string().optional(),
});
router.get('/', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const result = await (0, expenseService_1.listExpenses)({ ...q });
    res.json({ data: result.rows, pagination: result.pagination });
}));
const createSchema = zod_1.z.object({
    expenseDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: zod_1.z.string().min(2),
    category: zod_1.z.enum(['WATER', 'REPAIRS', 'ELECTRICITY', 'MAINTENANCE', 'CLEANING', 'SECURITY', 'TRANSPORT', 'OTHER']),
    amount: zod_1.z.number().positive('Expense amount must be greater than zero.'),
    paymentMethod: zod_1.z.enum(['CASH', 'M_PESA', 'BANK', 'OTHER']),
    referenceNumber: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
});
router.post('/', auth_1.managerOrAdmin, (0, validate_1.validateBody)(createSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, expenseService_1.createExpense)(req.body, req.user.userId);
    res.status(201).json({ data: row });
}));
const paramsSchema = zod_1.z.object({ id: zod_1.z.coerce.number().int().positive() });
router.put('/:id', auth_1.managerOrAdmin, (0, validate_1.validateParams)(paramsSchema), (0, validate_1.validateBody)(createSchema.partial()), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, expenseService_1.updateExpense)(Number(req.params.id), req.body, req.user.userId);
    res.json({ data: row });
}));
router.delete('/:id', auth_1.managerOrAdmin, (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await (0, expenseService_1.deleteExpense)(Number(req.params.id), req.user.userId);
    res.status(204).end();
}));
router.get('/summary', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const settings = await (0, settingsService_1.getSettings)();
    const q = zod_1.z.object({ year: zod_1.z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
    const summary = await (0, expenseService_1.expenseSummary)(q.year ?? settings.reporting_year);
    res.json({ data: summary });
}));
exports.default = router;
//# sourceMappingURL=expenses.js.map