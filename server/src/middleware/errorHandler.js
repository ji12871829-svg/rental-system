// errorHandler.js — central error handler. LAST middleware in app.js.
// Standard response shape (ARCHITECTURE.md §6): { error, message, details }.
// Full stack is logged server-side; clients get a generic message on 500
// (never a stack trace or raw Postgres error text).
const { HttpError } = require('../utils/httpError');

// pg error classes, mapped so the rest of the code can throw freely and we
// still return friendly 409s. Model functions translate where they can add
// context; this map is the safety net for anything that slips through.
function translatePgError(err) {
  if (err.code === '23505') {
    return new HttpError(409, 'DUPLICATE', 'A record with that unique value already exists.');
  }
  if (err.code === '23503') {
    return new HttpError(409, 'DELETE_BLOCKED',
      'This record is referenced by other records and cannot be deleted.');
  }
  if (err.code === '23P01') {
    return new HttpError(409, 'LEASE_OVERLAP',
      'The unit already has an active lease overlapping these dates.');
  }
  if (err.code === '23514') {
    return new HttpError(422, 'CHECK_VIOLATION', 'Value violates a database constraint.');
  }
  return null;
}

module.exports = function errorHandler(err, req, res, next) {
  let e = err;
  if (!(e instanceof HttpError)) {
    e = translatePgError(e) || e;
  }

  const status = e instanceof HttpError ? e.status : 500;
  const code = e instanceof HttpError ? e.code : 'INTERNAL_ERROR';

  // JSON body parse errors (malformed request bodies) are 400, not 500.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'Request body is not valid JSON.', details: {} });
  }

  if (status >= 500) {
    console.error(`[500] ${req.method} ${req.originalUrl}:`, err.stack || err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Something went wrong.',
      details: {},
    });
  }

  // 4xx: log briefly for operational visibility, return the useful message.
  if (status !== 404) console.warn(`[${status}] ${req.method} ${req.originalUrl}: ${code} — ${e.message}`);
  return res.status(status).json({
    error: code,
    message: e.message,
    details: e.details || {},
  });
};
