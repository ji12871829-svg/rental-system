"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.managerOrAdmin = exports.adminOnly = void 0;
exports.requireAuth = requireAuth;
exports.requireRoles = requireRoles;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../config/db");
const env_1 = require("../config/env");
const httpError_1 = require("../utils/httpError");
async function requireAuth(req, _res, next) {
    try {
        const header = req.headers.authorization || '';
        const [scheme, token] = header.split(' ');
        if (scheme !== 'Bearer' || !token) {
            return next((0, httpError_1.unauthorized)('Missing or malformed session.'));
        }
        let payload;
        try {
            payload = jsonwebtoken_1.default.verify(token, env_1.env.jwtSecret);
        }
        catch {
            return next((0, httpError_1.unauthorized)('Invalid or expired session.'));
        }
        // Re-validate against the DB on every request: an INACTIVE user (or a
        // deleted one) loses access immediately.
        const user = await (0, db_1.queryOne)('SELECT id, name, email, role, status FROM users WHERE id = $1', [payload.sub]);
        if (!user || user.status !== 'ACTIVE') {
            return next((0, httpError_1.unauthorized)('Account is no longer active.'));
        }
        req.user = { userId: user.id, role: user.role, name: user.name, email: user.email };
        return next();
    }
    catch (err) {
        return next(err);
    }
}
// requireRoles('ADMIN') or requireRoles('ADMIN', 'PROPERTY_MANAGER')
function requireRoles(...roles) {
    return (req, _res, next) => {
        if (!req.user)
            return next((0, httpError_1.unauthorized)());
        if (!roles.includes(req.user.role)) {
            return next((0, httpError_1.forbidden)(`This action requires the ${roles.join(' or ')} role.`));
        }
        return next();
    };
}
exports.adminOnly = requireRoles('ADMIN');
exports.managerOrAdmin = requireRoles('ADMIN', 'PROPERTY_MANAGER');
//# sourceMappingURL=auth.js.map