"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBody = validateBody;
exports.validateParams = validateParams;
const httpError_1 = require("../utils/httpError");
// Validates req.body (and optional params) against a zod schema. Never trust
// frontend validation — this is the authoritative gate.
function validateBody(schema) {
    return (req, _res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const details = result.error.issues.map((i) => ({
                path: i.path.join('.'),
                message: i.message,
            }));
            return next((0, httpError_1.badRequest)('Validation failed.', { issues: details }));
        }
        req.body = result.data;
        return next();
    };
}
function validateParams(schema) {
    return (req, _res, next) => {
        const result = schema.safeParse(req.params);
        if (!result.success) {
            return next((0, httpError_1.badRequest)('Invalid request parameters.'));
        }
        return next();
    };
}
//# sourceMappingURL=validate.js.map