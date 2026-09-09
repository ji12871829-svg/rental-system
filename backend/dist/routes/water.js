"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const asyncHandler_1 = require("../utils/asyncHandler");
const settingsService_1 = require("../services/settingsService");
const waterService_1 = require("../services/waterService");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const paginationQuery = zod_1.z.object({
    page: zod_1.z.coerce.number().int().positive().default(1),
    limit: zod_1.z.coerce.number().int().positive().max(100).default(20),
});
const monthYearQuery = zod_1.z.object({
    month: zod_1.z.coerce.number().int().min(1).max(12).optional(),
    year: zod_1.z.coerce.number().int().min(2000).max(2100).optional(),
});
// --- Readings ---------------------------------------------------------------
router.get('/readings', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = { ...paginationQuery.parse(req.query), ...monthYearQuery.parse(req.query) };
    const q2 = zod_1.z.object({ unitId: zod_1.z.coerce.number().int().positive().optional(), q: zod_1.z.string().optional() }).parse(req.query);
    const result = await (0, waterService_1.listReadings)({ page: q.page, limit: q.limit, month: q.month, year: q.year, unitId: q2.unitId, q: q2.q });
    res.json({ data: result.rows, pagination: result.pagination });
}));
const readingSchema = zod_1.z.object({
    unitId: zod_1.z.number().int().positive(),
    readingDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    billingMonth: zod_1.z.number().int().min(1).max(12),
    billingYear: zod_1.z.number().int().min(2000).max(2100),
    currentReading: zod_1.z.number().min(0),
    previousReading: zod_1.z.number().min(0).optional(), // first-reading establishment
    notes: zod_1.z.string().optional(),
});
router.post('/readings', (0, validate_1.validateBody)(readingSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await (0, waterService_1.createReading)(req.body, req.user.userId);
    res.status(201).json({ data: result });
}));
const paramsSchema = zod_1.z.object({ id: zod_1.z.coerce.number().int().positive() });
const readingUpdateSchema = zod_1.z.object({
    readingDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    currentReading: zod_1.z.number().min(0).optional(),
    notes: zod_1.z.string().optional(),
});
router.put('/readings/:id', (0, validate_1.validateParams)(paramsSchema), (0, validate_1.validateBody)(readingUpdateSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, waterService_1.updateReading)(Number(req.params.id), req.body, req.user.userId);
    res.json({ data: row });
}));
router.delete('/readings/:id', auth_1.adminOnly, (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await (0, waterService_1.deleteReading)(Number(req.params.id), req.user.userId);
    res.status(204).end();
}));
// --- Water payments ---------------------------------------------------------
router.get('/payments', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = { ...paginationQuery.parse(req.query), ...monthYearQuery.parse(req.query) };
    const q2 = zod_1.z.object({ unitId: zod_1.z.coerce.number().int().positive().optional(), tenantId: zod_1.z.coerce.number().int().positive().optional(), q: zod_1.z.string().optional() }).parse(req.query);
    const result = await (0, waterService_1.listWaterPayments)({ page: q.page, limit: q.limit, month: q.month, year: q.year, unitId: q2.unitId, tenantId: q2.tenantId, q: q2.q });
    res.json({ data: result.rows, pagination: result.pagination });
}));
const waterPaymentSchema = zod_1.z.object({
    tenantId: zod_1.z.number().int().positive(),
    paymentDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    billingMonth: zod_1.z.number().int().min(1).max(12),
    billingYear: zod_1.z.number().int().min(2000).max(2100),
    amount: zod_1.z.number().positive('Payment amount must be greater than zero.'),
    paymentMethod: zod_1.z.enum(['CASH', 'M_PESA', 'BANK', 'OTHER']),
    notes: zod_1.z.string().optional(),
});
router.post('/payments', (0, validate_1.validateBody)(waterPaymentSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await (0, waterService_1.createWaterPayment)(req.body, req.user.userId);
    res.status(201).json({ data: result });
}));
router.delete('/payments/:id', auth_1.adminOnly, (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await (0, waterService_1.deleteWaterPayment)(Number(req.params.id), req.user.userId);
    res.status(204).end();
}));
// --- Water purchases --------------------------------------------------------
router.get('/purchases', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = { ...paginationQuery.parse(req.query), ...monthYearQuery.parse(req.query) };
    const result = await (0, waterService_1.listPurchases)({ page: q.page, limit: q.limit, year: q.year, month: q.month });
    res.json({ data: result.rows, pagination: result.pagination });
}));
const purchaseSchema = zod_1.z.object({
    purchaseDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    supplier: zod_1.z.string().min(1),
    quantity: zod_1.z.number().min(0),
    measurementUnit: zod_1.z.string().optional(),
    costPerUnit: zod_1.z.number().min(0),
    paymentMethod: zod_1.z.enum(['CASH', 'M_PESA', 'BANK', 'OTHER']),
    referenceNumber: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
});
router.post('/purchases', (0, validate_1.validateBody)(purchaseSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, waterService_1.createPurchase)(req.body, req.user.userId);
    res.status(201).json({ data: row });
}));
router.put('/purchases/:id', (0, validate_1.validateParams)(paramsSchema), (0, validate_1.validateBody)(purchaseSchema.partial()), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const row = await (0, waterService_1.updatePurchase)(Number(req.params.id), req.body, req.user.userId);
    res.json({ data: row });
}));
router.delete('/purchases/:id', auth_1.adminOnly, (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await (0, waterService_1.deletePurchase)(Number(req.params.id), req.user.userId);
    res.status(204).end();
}));
// --- Summaries --------------------------------------------------------------
router.get('/summary', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const settings = await (0, settingsService_1.getSettings)();
    const q = zod_1.z.object({ year: zod_1.z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
    const summary = await (0, waterService_1.waterSummary)(q.year ?? settings.reporting_year);
    res.json({ data: summary });
}));
router.get('/monthly', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const settings = await (0, settingsService_1.getSettings)();
    const q = zod_1.z.object({ year: zod_1.z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
    const rows = await (0, waterService_1.monthlyWaterSummary)(q.year ?? settings.reporting_year);
    res.json({ data: rows });
}));
router.get('/outstanding-by-unit', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const settings = await (0, settingsService_1.getSettings)();
    const q = zod_1.z.object({ year: zod_1.z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
    const rows = await (0, waterService_1.outstandingWaterByUnit)(q.year ?? settings.reporting_year);
    res.json({ data: rows });
}));
exports.default = router;
//# sourceMappingURL=water.js.map