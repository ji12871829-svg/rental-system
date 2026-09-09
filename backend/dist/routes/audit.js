"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const asyncHandler_1 = require("../utils/asyncHandler");
const auditService_1 = require("../services/auditService");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, auth_1.adminOnly);
const querySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().positive().default(1),
    limit: zod_1.z.coerce.number().int().positive().max(100).default(20),
    entity: zod_1.z.string().optional(),
    action: zod_1.z.string().optional(),
    userId: zod_1.z.coerce.number().int().positive().optional(),
});
router.get('/', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const q = querySchema.parse(req.query);
    const result = await (0, auditService_1.listAuditLogs)({ page: q.page, limit: q.limit, entity: q.entity, action: q.action, userId: q.userId });
    res.json({ data: result.rows, pagination: result.pagination });
}));
exports.default = router;
//# sourceMappingURL=audit.js.map