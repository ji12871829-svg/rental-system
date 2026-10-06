import { query, queryOne } from '../config/db';
import { paginate } from './paginate';
import { logAudit } from './auditService';
import { createExpense, type ExpenseInput } from './expenseService';
import { badRequest, notFound } from '../utils/httpError';
import type { Pagination } from '../types';

// Expense approvals: staff propose a prospective expense, a manager/admin
// decides it. An approval CREATES the real expense row on approve — the
// expense ledger stays manager-gated while any staff member can surface a
// cost for review, with the requester and decider both on the record.
//
// A decision is final: approving/rejecting an already-decided request is a
// 409, never a silent re-decision. Approving writes the audit trail twice by
// design — EXPENSE_APPROVAL_APPROVED on the request and EXPENSE_CREATED on
// the expense it produced (same as a manual entry).

export interface ExpenseApprovalInput {
  expenseDate: string;
  description: string;
  category: string;
  amount: number;
  paymentMethod: 'CASH' | 'M_PESA' | 'BANK' | 'OTHER';
  referenceNumber?: string;
  notes?: string;
}

const APPROVAL_SELECT = `ea.*, ru.name AS requested_by_name, du.name AS decided_by_name, e.id AS linked_expense_id`;

const APPROVAL_TABLES = `FROM expense_approvals ea
  LEFT JOIN users ru ON ru.id = ea.requested_by
  LEFT JOIN users du ON du.id = ea.decided_by
  LEFT JOIN expenses e ON e.id = ea.expense_id`;

export async function listExpenseApprovals(filters: {
  page: number;
  limit: number;
  status?: string;
}): Promise<{ rows: unknown[]; pagination: Pagination }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    params.push(filters.status);
    where.push(`ea.status = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return paginate<Record<string, unknown>>({
    selectSql: APPROVAL_SELECT,
    tableSql: APPROVAL_TABLES,
    whereSql,
    params,
    orderBy: `ORDER BY CASE ea.status WHEN 'PENDING' THEN 0 ELSE 1 END, ea.created_at DESC`,
    page: filters.page,
    limit: filters.limit,
  });
}

export async function createExpenseApproval(input: ExpenseApprovalInput, userId: number): Promise<unknown> {
  const inserted = await query<Record<string, unknown>>(
    `INSERT INTO expense_approvals
       (expense_date, description, category, amount, payment_method, reference_number, notes, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [input.expenseDate, input.description, input.category, input.amount,
     input.paymentMethod, input.referenceNumber ?? null, input.notes ?? null, userId]
  );
  await logAudit({
    userId,
    action: 'EXPENSE_APPROVAL_REQUESTED',
    entity: 'expense_approvals',
    entityId: inserted[0].id as number,
    newValue: input,
  });
  return inserted[0];
}

async function pendingApproval(id: number): Promise<{ id: number }> {
  const row = await queryOne<{ id: number; status: string }>(
    'SELECT id, status FROM expense_approvals WHERE id = $1',
    [id]
  );
  if (!row) throw notFound('Expense approval not found.');
  if (row.status !== 'PENDING') {
    throw badRequest(`This request was already ${row.status.toLowerCase()} — decisions are final.`);
  }
  return row;
}

export async function approveExpenseApproval(id: number, userId: number, decisionNote?: string): Promise<unknown> {
  // snake_case row (SELECT *): the stored request mirrors an expense, but the
  // DB columns stay snake_case like every other table.
  const approval = await queryOne<{
    id: number;
    status: string;
    expense_date: string;
    description: string;
    category: string;
    amount: string;
    payment_method: string;
    reference_number: string | null;
    notes: string | null;
  }>(
    `SELECT id, status, expense_date::text AS expense_date, description, category,
            amount, payment_method, reference_number, notes
     FROM expense_approvals WHERE id = $1`,
    [id]
  );
  if (!approval) throw notFound('Expense approval not found.');
  if (approval.status !== 'PENDING') {
    throw badRequest(`This request was already ${approval.status.toLowerCase()} — decisions are final.`);
  }

  // The approved request becomes a real expense through the same code path a
  // manual entry uses — one ledger, one audit trail.
  const expenseInput: ExpenseInput = {
    expenseDate: approval.expense_date,
    description: approval.description,
    category: approval.category,
    amount: Number(approval.amount),
    paymentMethod: approval.payment_method as ExpenseInput['paymentMethod'],
    referenceNumber: approval.reference_number ?? undefined,
    notes: approval.notes ?? undefined,
  };
  const expense = await createExpense(expenseInput, userId);
  const expenseId = (expense as { id: number }).id;

  const updated = await query<Record<string, unknown>>(
    `UPDATE expense_approvals
     SET status = 'APPROVED', decided_by = $2, decided_at = NOW(), decision_note = $3, expense_id = $4
     WHERE id = $1
     RETURNING *`,
    [id, userId, decisionNote ?? null, expenseId]
  );
  await logAudit({
    userId,
    action: 'EXPENSE_APPROVAL_APPROVED',
    entity: 'expense_approvals',
    entityId: id,
    oldValue: { status: 'PENDING' },
    newValue: { expenseId, note: decisionNote ?? null },
  });
  return { ...updated[0], expense };
}

export async function rejectExpenseApproval(id: number, userId: number, decisionNote?: string): Promise<unknown> {
  await pendingApproval(id);
  const updated = await query<Record<string, unknown>>(
    `UPDATE expense_approvals
     SET status = 'REJECTED', decided_by = $2, decided_at = NOW(), decision_note = $3
     WHERE id = $1
     RETURNING *`,
    [id, userId, decisionNote ?? null]
  );
  await logAudit({
    userId,
    action: 'EXPENSE_APPROVAL_REJECTED',
    entity: 'expense_approvals',
    entityId: id,
    oldValue: { status: 'PENDING' },
    newValue: { note: decisionNote ?? null },
  });
  return updated[0];
}
