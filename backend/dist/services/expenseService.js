"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listExpenses = listExpenses;
exports.createExpense = createExpense;
exports.updateExpense = updateExpense;
exports.deleteExpense = deleteExpense;
exports.expenseSummary = expenseSummary;
const db_1 = require("../config/db");
const types_1 = require("../types");
const httpError_1 = require("../utils/httpError");
const money_1 = require("../utils/money");
const auditService_1 = require("./auditService");
async function listExpenses(filters) {
    const where = [];
    const params = [];
    if (filters.year) {
        params.push(filters.year);
        where.push(`EXTRACT(YEAR FROM expense_date)::int = $${params.length}`);
    }
    if (filters.month) {
        params.push(filters.month);
        where.push(`EXTRACT(MONTH FROM expense_date)::int = $${params.length}`);
    }
    if (filters.category) {
        params.push(filters.category);
        where.push(`category = $${params.length}`);
    }
    if (filters.q) {
        params.push(`%${filters.q}%`);
        where.push(`(description ILIKE $${params.length} OR reference_number ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = await (0, db_1.queryOne)(`SELECT COUNT(*)::text AS count FROM expenses ${whereSql}`, params);
    const total = Number(totalRow?.count ?? 0);
    const offset = (filters.page - 1) * filters.limit;
    const rows = await (0, db_1.query)(`SELECT * FROM expenses ${whereSql}
     ORDER BY expense_date DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, filters.limit, offset]);
    return {
        rows,
        pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
    };
}
async function createExpense(input, userId) {
    const inserted = await (0, db_1.query)(`INSERT INTO expenses
       (expense_date, description, category, amount, payment_method, reference_number, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`, [input.expenseDate, input.description, input.category, input.amount,
        input.paymentMethod, input.referenceNumber ?? null, input.notes ?? null]);
    await (0, auditService_1.logAudit)({ userId, action: 'EXPENSE_CREATED', entity: 'expenses', entityId: inserted[0].id, newValue: input });
    return inserted[0];
}
async function updateExpense(id, input, userId) {
    const existing = await (0, db_1.queryOne)('SELECT id FROM expenses WHERE id = $1', [id]);
    if (!existing)
        throw (0, httpError_1.notFound)('Expense not found.');
    const updated = await (0, db_1.query)(`UPDATE expenses
     SET expense_date = COALESCE($2, expense_date),
         description = COALESCE($3, description),
         category = COALESCE($4, category),
         amount = COALESCE($5, amount),
         payment_method = COALESCE($6, payment_method),
         reference_number = COALESCE($7, reference_number),
         notes = COALESCE($8, notes)
     WHERE id = $1
     RETURNING *`, [id, input.expenseDate ?? null, input.description ?? null, input.category ?? null,
        input.amount ?? null, input.paymentMethod ?? null, input.referenceNumber ?? null, input.notes ?? null]);
    await (0, auditService_1.logAudit)({ userId, action: 'EXPENSE_UPDATED', entity: 'expenses', entityId: id });
    return updated[0];
}
async function deleteExpense(id, userId) {
    const existing = await (0, db_1.queryOne)('SELECT id FROM expenses WHERE id = $1', [id]);
    if (!existing)
        throw (0, httpError_1.notFound)('Expense not found.');
    await (0, db_1.query)('DELETE FROM expenses WHERE id = $1', [id]);
    await (0, auditService_1.logAudit)({ userId, action: 'EXPENSE_DELETED', entity: 'expenses', entityId: id });
}
async function expenseSummary(year) {
    const targetYear = year;
    const total = (0, money_1.n)((await (0, db_1.queryOne)(`SELECT COALESCE(SUM(amount), 0)::text AS v FROM expenses WHERE EXTRACT(YEAR FROM expense_date)::int = $1`, [targetYear]))?.v);
    const byCategory = await (0, db_1.query)(`SELECT category, SUM(amount)::text AS total FROM expenses
     WHERE EXTRACT(YEAR FROM expense_date)::int = $1
     GROUP BY category ORDER BY total DESC`, [targetYear]);
    const byMonth = await (0, db_1.query)(`SELECT EXTRACT(MONTH FROM expense_date)::int AS month, SUM(amount)::text AS total
     FROM expenses WHERE EXTRACT(YEAR FROM expense_date)::int = $1
     GROUP BY month ORDER BY month`, [targetYear]);
    return {
        reportingYear: targetYear,
        totalExpenses: total,
        byCategory: byCategory.map((r) => ({ category: r.category, total: (0, money_1.n)(r.total) })),
        byMonth: byMonth.map((r) => ({ month: r.month, monthName: types_1.MONTH_NAMES[r.month - 1], total: (0, money_1.n)(r.total) })),
    };
}
//# sourceMappingURL=expenseService.js.map