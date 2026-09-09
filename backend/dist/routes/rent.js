"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const asyncHandler_1 = require("../utils/asyncHandler");
const rentService_1 = require("../services/rentService");
const settingsService_1 = require("../services/settingsService");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const listQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().positive().default(1),
    limit: zod_1.z.coerce.number().int().positive().max(100).default(20),
    month: zod_1.z.coerce.number().int().min(1).max(12).optional(),
    year: zod_1.z.coerce.number().int().min(2000).max(2100).optional(),
    unitId: zod_1.z.coerce.number().int().positive().optional(),
    tenantId: zod_1.z.coerce.number().int().positive().optional(),
    paymentMethod: zod_1.z.enum(['CASH', 'M_PESA', 'BANK', 'OTHER']).optional(),
    q: zod_1.z.string().optional(),
});
router.get('/payments', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const result = await (0, rentService_1.listRentPayments)({ ...q });
    res.json({ data: result.rows, pagination: result.pagination });
}));
// CSV export (spec §44).
router.get('/payments/export', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = listQuerySchema.partial().parse(req.query);
    const csv = await (0, rentService_1.rentPaymentsCsv)({ year: q.year, month: q.month });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rent-payments.csv"');
    res.send(csv);
}));
const createSchema = zod_1.z.object({
    tenantId: zod_1.z.number().int().positive(),
    paymentDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    billingMonth: zod_1.z.number().int().min(1).max(12),
    billingYear: zod_1.z.number().int().min(2000).max(2100),
    amount: zod_1.z.number().positive('Payment amount must be greater than zero.'),
    paymentMethod: zod_1.z.enum(['CASH', 'M_PESA', 'BANK', 'OTHER']),
    paymentReference: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
});
router.post('/payments', (0, validate_1.validateBody)(createSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await (0, rentService_1.createRentPayment)(req.body, req.user.userId);
    res.status(201).json({ data: result });
}));
const paramsSchema = zod_1.z.object({ id: zod_1.z.coerce.number().int().positive() });
router.delete('/payments/:id', auth_1.adminOnly, (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await (0, rentService_1.deleteRentPayment)(Number(req.params.id), req.user.userId);
    res.status(204).end();
}));
// Monthly rent summary for the reporting year (§27).
router.get('/summary', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const settings = await (0, settingsService_1.getSettings)();
    const q = zod_1.z.object({ year: zod_1.z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
    const rows = await (0, rentService_1.monthlyRentSummary)(q.year ?? settings.reporting_year);
    res.json({ data: rows, currency: settings.currency, reportingYear: q.year ?? settings.reporting_year });
}));
exports.default = router;
//# sourceMappingURL=rent.js.map