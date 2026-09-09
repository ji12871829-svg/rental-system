"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listUsers = listUsers;
exports.createUser = createUser;
exports.updateUser = updateUser;
exports.deleteUser = deleteUser;
exports.userPagination = userPagination;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../config/db");
const env_1 = require("../config/env");
const httpError_1 = require("../utils/httpError");
const auditService_1 = require("./auditService");
async function listUsers() {
    return (0, db_1.query)(`SELECT id, name, email, phone, role, status, created_at, updated_at
     FROM users ORDER BY id`);
}
async function createUser(input, userId) {
    const existing = await (0, db_1.queryOne)('SELECT id FROM users WHERE email = $1', [input.email]);
    if (existing)
        throw (0, httpError_1.conflict)('A user with this email already exists.', 'DUPLICATE_EMAIL');
    const hash = await bcryptjs_1.default.hash(input.password, env_1.env.bcryptSaltRounds);
    const inserted = await (0, db_1.query)(`INSERT INTO users (name, email, phone, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
     RETURNING id, name, email, phone, role, status, created_at`, [input.name, input.email, input.phone ?? null, hash, input.role]);
    await (0, auditService_1.logAudit)({ userId, action: 'USER_CREATED', entity: 'users', entityId: inserted[0].id, newValue: { email: input.email, role: input.role } });
    return inserted[0];
}
async function updateUser(id, input, userId) {
    const existing = await (0, db_1.queryOne)('SELECT id, role, email FROM users WHERE id = $1', [id]);
    if (!existing)
        throw (0, httpError_1.notFound)('User not found.');
    const passwordHash = input.password ? await bcryptjs_1.default.hash(input.password, env_1.env.bcryptSaltRounds) : null;
    const updated = await (0, db_1.query)(`UPDATE users
     SET name = COALESCE($2, name),
         phone = COALESCE($3, phone),
         role = COALESCE($4, role),
         status = COALESCE($5, status),
         password_hash = COALESCE($6, password_hash)
     WHERE id = $1
     RETURNING id, name, email, phone, role, status, created_at`, [id, input.name ?? null, input.phone ?? null, input.role ?? null, input.status ?? null, passwordHash]);
    await (0, auditService_1.logAudit)({
        userId,
        action: 'USER_UPDATED',
        entity: 'users',
        entityId: id,
        oldValue: { role: existing.role },
        newValue: { role: input.role, status: input.status },
    });
    return updated[0];
}
async function deleteUser(id, userId) {
    if (id === userId)
        throw (0, httpError_1.unprocessable)('You cannot delete your own account.');
    const existing = await (0, db_1.queryOne)('SELECT id FROM users WHERE id = $1', [id]);
    if (!existing)
        throw (0, httpError_1.notFound)('User not found.');
    await (0, db_1.query)('DELETE FROM users WHERE id = $1', [id]);
    await (0, auditService_1.logAudit)({ userId, action: 'USER_DELETED', entity: 'users', entityId: id });
}
function userPagination() {
    return { page: 1, limit: 100, total: 0, totalPages: 0 };
}
//# sourceMappingURL=userService.js.map