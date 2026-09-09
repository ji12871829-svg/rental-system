"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const db_1 = require("../config/db");
const env_1 = require("../config/env");
const auth_1 = require("../middleware/auth");
const rateLimiter_1 = require("../middleware/rateLimiter");
const validate_1 = require("../middleware/validate");
const httpError_1 = require("../utils/httpError");
const asyncHandler_1 = require("../utils/asyncHandler");
const auditService_1 = require("../services/auditService");
const router = (0, express_1.Router)();
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
});
router.post('/login', rateLimiter_1.loginLimiter, (0, validate_1.validateBody)(loginSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { email, password } = req.body;
    const user = await (0, db_1.queryOne)('SELECT id, name, email, phone, password_hash, role, status FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!user || !(await bcryptjs_1.default.compare(password, user.password_hash))) {
        throw (0, httpError_1.unauthorized)('Invalid email or password.');
    }
    if (user.status !== 'ACTIVE') {
        throw (0, httpError_1.unauthorized)('Account is inactive. Contact the administrator.');
    }
    const token = jsonwebtoken_1.default.sign({ sub: user.id, role: user.role, name: user.name, email: user.email }, env_1.env.jwtSecret, { expiresIn: env_1.env.jwtExpiresIn });
    await (0, auditService_1.logAudit)({
        userId: user.id,
        action: 'LOGIN',
        entity: 'users',
        entityId: user.id,
    });
    res.json({
        data: {
            token,
            user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
        },
    });
}));
router.post('/logout', auth_1.requireAuth, (_req, res) => {
    // Stateless JWT — logout is client-side token discard. Endpoint exists for
    // API symmetry and future token-denylist support.
    res.json({ data: { message: 'Logged out.' } });
});
router.get('/me', auth_1.requireAuth, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    res.json({ data: req.user });
}));
exports.default = router;
//# sourceMappingURL=auth.js.map