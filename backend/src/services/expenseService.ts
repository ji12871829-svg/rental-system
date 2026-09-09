import { query, queryOne } from '../config/db';
import { MONTH_NAMES, type Pagination } from '../types';
import { notFound } from '../utils/httpError';
import { n, round2 } from '../utils/money';
import { logAudit } from './auditService';

export interface ExpenseInput {
  expenseDate: string;
  description: string;
  category: string;
  amount: number;
  paymentMethod: 'CASH' | 'M_PESA' | 'BANK' | 'OTHER';
  referenceNumber?: string;
  notes?: string;
}

export interface ExpenseFilters {
  page: number;
  limit: number;
  year?: number;
  month?: number;
  category?: string;
  q?: string;
}

export async function listExpenses(filters: ExpenseFilters): Promise<{ rows: unknown[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
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

  const totalRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM expenses ${whereSql}`, params
  );
  const total = Number(totalRow?.count ?? 0);
  const offset = (filters.page - 1) * filters.limit;
  const rows = await query(
    `SELECT * FROM expenses ${whereSql}
     ORDER BY expense_date DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, offset]
  );
  return {
    rows,
    pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
  };
}

export async function createExpense(input: ExpenseInput, userId: number): Promise<unknown> {
  const inserted = await query(
    `INSERT INTO expenses
       (expense_date, description, category, amount, payment_method, reference_number, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [input.expenseDate, input.description, input.category, input.amount,
     input.paymentMethod, input.referenceNumber ?? null, input.notes ?? null]
  );
  await logAudit({ userId, action: 'EXPENSE_CREATED', entity: 'expenses', entityId: inserted[0].id, newValue: input });
  return inserted[0];
}

export async function updateExpense(id: number, input: Partial<ExpenseInput>, userId: number): Promise<unknown> {
  const existing = await queryOne<{ id: number }>('SELECT id FROM expenses WHERE id = $1', [id]);
  if (!existing) throw notFound('Expense not found.');
  const updated = await query(
    `UPDATE expenses
     SET expense_date = COALESCE($2, expense_date),
         description = COALESCE($3, description),
         category = COALESCE($4, category),
         amount = COALESCE($5, amount),
         payment_method = COALESCE($6, payment_method),
         reference_number = COALESCE($7, reference_number),
         notes = COALESCE($8, notes)
     WHERE id = $1
     RETURNING *`,
    [id, input.expenseDate ?? null, input.description ?? null, input.category ?? null,
     input.amount ?? null, input.paymentMethod ?? null, input.referenceNumber ?? null, input.notes ?? null]
  );
  await logAudit({ userId, action: 'EXPENSE_UPDATED', entity: 'expenses', entityId: id });
  return updated[0];
}

export async function deleteExpense(id: number, userId: number): Promise<void> {
  const existing = await queryOne<{ id: number }>('SELECT id FROM expenses WHERE id = $1', [id]);
  if (!existing) throw notFound('Expense not found.');
  await query('DELETE FROM expenses WHERE id = $1', [id]);
  await logAudit({ userId, action: 'EXPENSE_DELETED', entity: 'expenses', entityId: id });
}

export async function expenseSummary(year: number): Promise<unknown> {
  const targetYear = year;
  const total = n((await queryOne<{ v: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS v FROM expenses WHERE EXTRACT(YEAR FROM expense_date)::int = $1`, [targetYear]
  ))?.v);
  const byCategory = await query<{ category: string; total: string }>(
    `SELECT category, SUM(amount)::text AS total FROM expenses
     WHERE EXTRACT(YEAR FROM expense_date)::int = $1
     GROUP BY category ORDER BY total DESC`,
    [targetYear]
  );
  const byMonth = await query<{ month: number; total: string }>(
    `SELECT EXTRACT(MONTH FROM expense_date)::int AS month, SUM(amount)::text AS total
     FROM expenses WHERE EXTRACT(YEAR FROM expense_date)::int = $1
     GROUP BY month ORDER BY month`,
    [targetYear]
  );
  return {
    reportingYear: targetYear,
    totalExpenses: total,
    byCategory: byCategory.map((r) => ({ category: r.category, total: n(r.total) })),
    byMonth: byMonth.map((r) => ({ month: r.month, monthName: MONTH_NAMES[r.month - 1], total: n(r.total) })),
  };
}