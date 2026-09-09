"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const asyncHandler_1 = require("../utils/asyncHandler");
const settingsService_1 = require("../services/settingsService");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.get('/', (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const settings = await (0, settingsService_1.getSettings)();
    res.json({ data: settings });
}));
const updateSchema = zod_1.z.object({
    reportingYear: zod_1.z.number().int().min(2000).max(2100).optional(),
    currency: zod_1.z.string().min(1).max(10).optional(),
    waterRate: zod_1.z.number().min(0).optional(),
});
router.put('/', auth_1.managerOrAdmin, (0, validate_1.validateBody)(updateSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const settings = await (0, settingsService_1.updateSettings)(req.body, req.user.userId);
    res.json({ data: settings });
}));
exports.default = router;
//# sourceMappingURL=settings.js.map