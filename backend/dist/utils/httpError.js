"use strict";
// Consistent error responses: { error: CODE, message, details }.
Object.defineProperty(exports, "__esModule", { value: true });
exports.unprocessable = exports.conflict = exports.notFound = exports.forbidden = exports.unauthorized = exports.badRequest = exports.HttpError = void 0;
class HttpError extends Error {
    status;
    code;
    details;
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
exports.HttpError = HttpError;
const badRequest = (message, details) => new HttpError(400, 'BAD_REQUEST', message, details);
exports.badRequest = badRequest;
const unauthorized = (message = 'Authentication required.') => new HttpError(401, 'UNAUTHORIZED', message);
exports.unauthorized = unauthorized;
const forbidden = (message = 'You do not have permission to perform this action.') => new HttpError(403, 'FORBIDDEN', message);
exports.forbidden = forbidden;
const notFound = (message = 'Resource not found.') => new HttpError(404, 'NOT_FOUND', message);
exports.notFound = notFound;
const conflict = (message, code = 'CONFLICT') => new HttpError(409, code, message);
exports.conflict = conflict;
const unprocessable = (message, details) => new HttpError(422, 'UNPROCESSABLE_ENTITY', message, details);
exports.unprocessable = unprocessable;
//# sourceMappingURL=httpError.js.map