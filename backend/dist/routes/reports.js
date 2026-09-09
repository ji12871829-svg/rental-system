"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const asyncHandler_1 = require("../utils/asyncHandler");
const settingsService_1 = require("../services/settingsService");
const financeService_1 = require("../services/financeService");
const rentService_1 = require("../services/rentService");
const waterService_1 = require("../services/waterService");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const yearQuery = zod_1.z.object({ year: zod_1.z.coerce.number().int().min(2000).max(2100).optional() });
router.get('/dashboard', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = yearQuery.parse(req.query);
    const settings = await (0, settingsService_1.getSettings)();
    const data = await (0, financeService_1.dashboard)(q.year ?? settings.reporting_year);
    res.json({ data });
}));
router.get('/arrears', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = yearQuery.parse(req.query);
    const settings = await (0, settingsService_1.getSettings)();
    const data = await (0, financeService_1.arrears)(q.year ?? settings.reporting_year);
    res.json({ data });
}));
// Combined rent + water monthly summary (§27 + §24 together).
router.get('/monthly', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = yearQuery.parse(req.query);
    const settings = await (0, settingsService_1.getSettings)();
    const data = await (0, financeService_1.combinedMonthlySummary)(q.year ?? settings.reporting_year);
    res.json({ data });
}));
// Rent-only monthly summary.
router.get('/monthly/rent', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = yearQuery.parse(req.query);
    const settings = await (0, settingsService_1.getSettings)();
    const data = await (0, rentService_1.monthlyRentSummary)(q.year ?? settings.reporting_year);
    res.json({ data });
}));
// Water-only monthly summary.
router.get('/monthly/water', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = yearQuery.parse(req.query);
    const settings = await (0, settingsService_1.getSettings)();
    const data = await (0, waterService_1.monthlyWaterSummary)(q.year ?? settings.reporting_year);
    res.json({ data });
}));
// Water financial performance (§22 / §47).
router.get('/water', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = yearQuery.parse(req.query);
    const settings = await (0, settingsService_1.getSettings)();
    const data = await (0, waterService_1.waterSummary)(q.year ?? settings.reporting_year);
    res.json({ data });
}));
const paramsSchema = zod_1.z.object({ id: zod_1.z.coerce.number().int().positive() });
router.get('/tenant/:id', (0, validate_1.validateParams)(paramsSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = yearQuery.parse(req.query);
    const settings = await (0, settingsService_1.getSettings)();
    const data = await (0, financeService_1.tenantLedger)(Number(req.params.id), q.year ?? settings.reporting_year);
    res.json({ data });
}));
exports.default = router;
//# sourceMappingURL=reports.js.map