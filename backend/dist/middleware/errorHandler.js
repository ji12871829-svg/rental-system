"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const env_1 = require("../config/env");
const httpError_1 = require("../utils/httpError");
function errorHandler(err, _req, res, _next) {
    if (err instanceof httpError_1.HttpError) {
        res.status(err.status).json({ error: err.code, message: err.message, details: err.details ?? {} });
        return;
    }
    const pgErr = err;
    // Friendly mapping for common constraint violations; everything else is a
    // generic 500. Full stacks stay server-side.
    if (pgErr.code === '23505') {
        res.status(409).json({ error: 'DUPLICATE', message: 'A record with the same key already exists.' });
        return;
    }
    if (pgErr.code === '23503') {
        res.status(409).json({ error: 'FK_VIOLATION', message: 'This record is still referenced by other data.' });
        return;
    }
    if (pgErr.code === 'P0001') {
        // RAISE EXCEPTION from triggers — includes our water-rule messages.
        const message = pgErr.message || 'Database operation rejected the transaction.';
        const code = message.includes('WATER_DISABLED_FOR_UNIT')
            ? 'WATER_DISABLED_FOR_UNIT'
            : 'DB_RULE';
        res.status(422).json({ error: code, message, details: {} });
        return;
    }
    if (pgErr.code === '23514') {
        res.status(422).json({ error: 'CHECK_VIOLATION', message: 'The value violates a database rule (e.g. a negative amount or an invalid reading).' });
        return;
    }
    // eslint-disable-next-line no-console
    console.error('[error]', err.stack || err.message);
    res.status(500).json({
        error: 'INTERNAL',
        message: env_1.env.nodeEnv === 'production' ? 'An unexpected error occurred.' : err.message,
        details: {},
    });
}
//# sourceMappingURL=errorHandler.js.map