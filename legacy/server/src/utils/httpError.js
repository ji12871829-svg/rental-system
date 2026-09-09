// httpError.js — small error class for controller-level failures.
// Controllers throw these; the central error handler maps them to the
// standard response shape { error, message, details } with the right status.
class HttpError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Factory helpers keep throw sites terse and status codes consistent.
module.exports = {
  HttpError,
  badRequest: (msg, details) => new HttpError(400, 'BAD_REQUEST', msg, details),
  unauthorized: (msg = 'Authentication required.') =>
    new HttpError(401, 'UNAUTHORIZED', msg),
  forbidden: (msg = 'You do not have permission to perform this action.') =>
    new HttpError(403, 'FORBIDDEN', msg),
  notFound: (msg = 'Resource not found.') => new HttpError(404, 'NOT_FOUND', msg),
  conflict: (code, msg, details) => new HttpError(409, code, msg, details),
  unprocessable: (code, msg, details) => new HttpError(422, code, msg, details),
};
