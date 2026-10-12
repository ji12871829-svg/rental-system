import { query, queryOne } from '../config/db';
import { paginate } from './paginate';
import { logAudit } from './auditService';
import { createExpense } from './expenseService';
import { badRequest, notFound } from '../utils/httpError';
import type { Pagination } from '../types';

// Recurring expenses: standing periodic costs (garbage collection, security
// contract, insurance) that generate their real expense row when due.
//
// Scheduling semantics:
//   * Due-ness is judged in the DATABASE (next_due_date <= CURRENT_DATE), so
//     server timezones never skew a due date.
//   * Each generate step records exactly ONE period and advances
//     next_due_date by the frequency (Postgres interval math — Jan 31 monthly
//     clamps to Feb 28, matching how a calendar behaves). A row that fell
//     behind while the system was off catches up one period per sweep run.
//   * The nightly sweep (recurringExpenseJob) calls the same generator with a
//     null user; audit rows record a system actor.

export interface RecurringExpenseInput {
  description: string;
  category: string;
  amount: number;
  paymentMethod: 'CASH' | 'M_PESA' | 'BANK' | 'OTHER';
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  nextDueDate: string;
  active?: boolean;
}

export interface GenerationResult {
  generated: number;
  failures: { recurringId: number; error: string }[];
  remaining: number;
}

const ADVANCE_INTERVALS: Record<string, string> = {
  MONTHLY: "INTERVAL '1 month'",
  QUARTERLY: "INTERVAL '3 months'",
  YEARLY: "INTERVAL '1 year'",
};

export async function listRecurringExpenses(filters: {
  page: number;
  limit: number;
  active?: boolean;
  q?: string;
}): Promise<{ rows: Record<string, unknown>[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.active !== undefined) {
    params.push(filters.active);
    where.push(`active = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`description ILIKE $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return paginate<Record<string, unknown>>({
    selectSql: `*, (next_due_date <= CURRENT_DATE) AS due`,
    tableSql: `FROM recurring_expenses`,
    whereSql,
    params,
    orderBy: `ORDER BY active DESC, next_due_date ASC`,
    page: filters.page,
    limit: filters.limit,
  });
}

export async function createRecurringExpense(input: RecurringExpenseInput, userId: number): Promise<unknown> {
  const inserted = await query<Record<string, unknown>>(
    `INSERT INTO recurring_expenses
       (description, category, amount, payment_method, frequency, next_due_date, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *, (next_due_date <= CURRENT_DATE) AS due`,
    [input.description, input.category, input.amount, input.paymentMethod,
     input.frequency, input.nextDueDate, input.active ?? true, userId]
  );
  await logAudit({
    userId,
    action: 'RECURRING_EXPENSE_CREATED',
    entity: 'recurring_expenses',
    entityId: inserted[0].id as number,
    newValue: input,
  });
  return inserted[0];
}

export async function updateRecurringExpense(id: number, input: Partial<RecurringExpenseInput>, userId: number): Promise<unknown> {
  const existing = await queryOne<{ id: number }>('SELECT id FROM recurring_expenses WHERE id = $1', [id]);
  if (!existing) throw notFound('Recurring expense not found.');
  const updated = await query<Record<string, unknown>>(
    `UPDATE recurring_expenses
     SET description = COALESCE($2, description),
         category = COALESCE($3, category),
         amount = COALESCE($4, amount),
         payment_method = COALESCE($5, payment_method),
         frequency = COALESCE($6, frequency),
         next_due_date = COALESCE($7, next_due_date),
         active = COALESCE($8, active),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *, (next_due_date <= CURRENT_DATE) AS due`,
    [id, input.description ?? null, input.category ?? null, input.amount ?? null,
     input.paymentMethod ?? null, input.frequency ?? null, input.nextDueDate ?? null,
     input.active ?? null]
  );
  await logAudit({
    userId,
    action: 'RECURRING_EXPENSE_UPDATED',
    entity: 'recurring_expenses',
    entityId: id,
    newValue: input,
  });
  return updated[0];
}

export async function deleteRecurringExpense(id: number, userId: number): Promise<void> {
  const existing = await queryOne<{ id: number; description: string }>(
    'SELECT id, description FROM recurring_expenses WHERE id = $1',
    [id]
  );
  if (!existing) throw notFound('Recurring expense not found.');
  await query('DELETE FROM recurring_expenses WHERE id = $1', [id]);
  await logAudit({
    userId,
    action: 'RECURRING_EXPENSE_DELETED',
    entity: 'recurring_expenses',
    entityId: id,
    oldValue: { description: existing.description },
  });
}

/**
 * Record ONE due period of a recurring expense as a real expense row and
 * advance its schedule. Throws badRequest when the row is inactive or not
 * yet due — callers deciding policy (the sweep) catch per-row failures.
 */
export async function generateRecurringExpense(id: number, userId: number | null): Promise<unknown> {
  const row = await queryOne<{
    id: number;
    active: boolean;
    description: string;
    category: string;
    amount: string;
    payment_method: string;
    frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  }>('SELECT * FROM recurring_expenses WHERE id = $1', [id]);
  if (!row) throw notFound('Recurring expense not found.');
  if (!row.active) throw badRequest('This recurring expense is inactive — activate it before generating.');

  const due = await queryOne<{ due: boolean; due_date: string }>(
    `SELECT next_due_date <= CURRENT_DATE AS due, next_due_date::text AS due_date
     FROM recurring_expenses WHERE id = $1`,
    [id]
  );
  if (!due?.due) {
    throw badRequest(`Next occurrence is ${due?.due_date ?? 'unscheduled'} — nothing to generate yet.`);
  }

  const expense = (await createExpense(
    {
      expenseDate: due.due_date,
      description: row.description,
      category: row.category,
      amount: Number(row.amount),
      paymentMethod: row.payment_method as RecurringExpenseInput['paymentMethod'],
    },
    userId
  )) as { id: number };

  const interval = ADVANCE_INTERVALS[row.frequency] ?? "INTERVAL '1 month'";
  const updated = await query<Record<string, unknown>>(
    `UPDATE recurring_expenses
     SET next_due_date = GREATEST(next_due_date + ${interval}, CURRENT_DATE),
         last_generated_at = NOW(),
         last_expense_id = $2,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *, (next_due_date <= CURRENT_DATE) AS due`,
    // GREATEST guards a pathological backlog: never re-due the same period,
    // but a genuinely old schedule still catches up one period per run.
    [id, expense.id]
  );

  await logAudit({
    userId,
    action: 'RECURRING_EXPENSE_GENERATED',
    entity: 'recurring_expenses',
    entityId: id,
    newValue: { expenseId: expense.id, expenseDate: due.due_date },
  });
  return updated[0];
}

/**
 * Generate every due active recurring expense. One row's failure never blocks
 * the rest. Returns the tally for the API response / sweep log.
 */
export async function generateDueRecurringExpenses(userId: number | null): Promise<GenerationResult> {
  const result: GenerationResult = { generated: 0, failures: [], remaining: 0 };
  const due = await query<{ id: number }>(
    `SELECT id FROM recurring_expenses WHERE active AND next_due_date <= CURRENT_DATE ORDER BY next_due_date ASC`
  );
  for (const { id } of due) {
    try {
      await generateRecurringExpense(id, userId);
      result.generated += 1;
    } catch (err) {
      result.failures.push({ recurringId: id, error: (err as Error).message });
    }
  }
  const remaining = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM recurring_expenses WHERE active AND next_due_date <= CURRENT_DATE`
  );
  result.remaining = Number(remaining?.n ?? 0);
  return result;
}
