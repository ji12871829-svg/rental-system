"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.poolExec = exports.pool = void 0;
exports.query = query;
exports.queryOne = queryOne;
exports.withTransaction = withTransaction;
// PostgreSQL connection pool. All SQL is parameterized ($1, $2…) — never
// interpolate user input into a query string.
const pg_1 = require("pg");
const env_1 = require("./env");
exports.pool = new pg_1.Pool({
    connectionString: env_1.env.databaseUrl,
    max: 10,
    ssl: env_1.isProd ? { rejectUnauthorized: false } : false,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function query(text, params = []) {
    const res = await exports.pool.query(text, params);
    return res.rows;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function queryOne(text, params = []) {
    const rows = await query(text, params);
    return rows[0] ?? null;
}
exports.poolExec = {
    query: async (text, params = []) => exports.pool.query(text, params),
};
// Runs `fn` inside a transaction with automatic rollback on error.
async function withTransaction(fn) {
    const client = await exports.pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn({
            query: (text, params = []) => client.query(text, params),
        });
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=db.js.map