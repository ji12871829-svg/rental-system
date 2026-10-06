import { query, queryOne, withTransaction } from '../config/db';
import { logAudit } from './auditService';
import { createRentPayment } from './rentService';
import { getSettings } from './settingsService';
import { reportingThroughMonth } from './tenantLedger';
import { round2 } from '../utils/money';
import { badRequest, notFound } from '../utils/httpError';

// Late-fee (penalty) engine, ported from the legacy system's PenaltyController
// and re-based onto this codebase's balance model:
//
//   * A rule (FIXED amount or PERCENTAGE of the month's rent, after
//     grace_days, capped by max_penalty) applies to overdue billing months.
//   * An applied penalty is recorded in penalty_log AND as a NEGATIVE
//     rent_payments row (payment_method 'OTHER', notes 'Late fee…'), so the
//     ledger, arrears, statements and the portal account for it with zero
//     special-casing — the same reversal shape the Record-Payment form
//     already accepts.
//   * The month charged is the OVERDUE month itself, so the ledger's per-month
//     arithmetic (expected - payments) nets the penalty against that month.
//   * UNIQUE (rule_id, tenant_id, month, year) makes apply idempotent: a
//     re-run can never double-charge the same rule/month/tenant.
//   * previewPenalties() runs the exact same matching logic without writing —
//     the operator sees the charge list before committing it.

export interface PenaltyRuleInput {
  name: string;
  ruleType: 'FIXED' | 'PERCENTAGE';
  amount?: number;
  percentage?: number;
  graceDays?: number;
  maxPenalty?: number | null;
  appliesTo?: 'RENT' | 'WATER';
  active?: boolean;
}

interface PenaltyRuleRow {
  id: number;
  name: string;
  rule_type: 'FIXED' | 'PERCENTAGE';
  amount: string;
  percentage: string;
  grace_days: number;
  max_penalty: string | null;
  applies_to: 'RENT' | 'WATER';
  active: boolean;
}

export async function listPenaltyRules(): Promise<PenaltyRuleRow[]> {
  return query<PenaltyRuleRow>('SELECT * FROM penalty_rules ORDER BY active DESC, name ASC');
}

async function requireRule(id: number): Promise<PenaltyRuleRow> {
  const row = await queryOne<PenaltyRuleRow>('SELECT * FROM penalty_rules WHERE id = $1', [id]);
  if (!row) throw notFound('Penalty rule not found.');
  return row;
}

export async function createPenaltyRule(input: PenaltyRuleInput, userId: number): Promise<PenaltyRuleRow> {
  if (input.ruleType === 'FIXED' && !(input.amount && input.amount > 0)) {
    throw badRequest('A fixed rule needs a positive amount.');
  }
  if (input.ruleType === 'PERCENTAGE' && !(input.percentage && input.percentage > 0)) {
    throw badRequest('A percentage rule needs a positive percentage.');
  }
  const inserted = await query<PenaltyRuleRow>(
    `INSERT INTO penalty_rules (name, rule_type, amount, percentage, grace_days, max_penalty, applies_to, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [input.name, input.ruleType, input.amount ?? 0, input.percentage ?? 0,
     input.graceDays ?? 0, input.maxPenalty ?? null, input.appliesTo ?? 'RENT', input.active ?? true]
  );
  await logAudit({ userId, action: 'PENALTY_RULE_CREATED', entity: 'penalty_rules', entityId: inserted[0].id, newValue: input });
  return inserted[0];
}

export async function updatePenaltyRule(id: number, input: Partial<PenaltyRuleInput>, userId: number): Promise<PenaltyRuleRow> {
  const existing = await requireRule(id);
  const updated = await query<PenaltyRuleRow>(
    `UPDATE penalty_rules
     SET name = COALESCE($2, name),
         rule_type = COALESCE($3, rule_type),
         amount = COALESCE($4, amount),
         percentage = COALESCE($5, percentage),
         grace_days = COALESCE($6, grace_days),
         max_penalty = $7,
         applies_to = COALESCE($8, applies_to),
         active = COALESCE($9, active)
     WHERE id = $1
     RETURNING *`,
    [id, input.name ?? null, input.ruleType ?? null, input.amount ?? null,
     input.percentage ?? null, input.graceDays ?? null,
     input.maxPenalty === undefined ? existing.max_penalty : input.maxPenalty,
     input.appliesTo ?? null, input.active ?? null]
  );
  await logAudit({ userId, action: 'PENALTY_RULE_UPDATED', entity: 'penalty_rules', entityId: id, newValue: input });
  return updated[0];
}

export async function deletePenaltyRule(id: number, userId: number): Promise<void> {
  const existing = await requireRule(id);
  await query('DELETE FROM penalty_rules WHERE id = $1', [id]);
  await logAudit({
    userId,
    action: 'PENALTY_RULE_DELETED',
    entity: 'penalty_rules',
    entityId: id,
    oldValue: { name: existing.name },
  });
}

// ---------------------------------------------------------------------------
// Matching: the ACTIVE tenants whose rent for `month` is still unpaid after
// the rule's grace window (billing month + grace_days before today).
// ---------------------------------------------------------------------------

interface OverdueCandidate {
  tenant_id: number;
  full_name: string;
  unit_number: string | null;
  monthly_rent: string;
  paid: string;
  was_occupied: boolean;
}

async function overdueTenants(rule: PenaltyRuleRow, month: number, year: number): Promise<OverdueCandidate[]> {
  // The grace cutoff: the month is late if (its first day + grace days) has
  // passed. Implemented as: today > monthStart + graceDays.
  const rows = await query<OverdueCandidate>(
    `SELECT t.id AS tenant_id, t.full_name, u.unit_number, u.monthly_rent,
            (SELECT COALESCE(SUM(amount), 0) FROM rent_payments rp
              WHERE rp.tenant_id = t.id AND rp.billing_month = $1::int AND rp.billing_year = $2::int)::text AS paid,
            (t.unit_id IS NOT NULL AND t.move_in_date IS NOT NULL
              AND t.move_in_date <= make_date($2::int, $1::int, 1)
              AND (t.move_out_date IS NULL OR t.move_out_date >= make_date($2::int, $1::int, 1))
            ) AS was_occupied
     FROM tenants t
     LEFT JOIN units u ON u.id = t.unit_id
     WHERE t.status = 'ACTIVE'
       AND CURRENT_DATE > (make_date($2::int, $1::int, 1) + make_interval(days => $3))
     ORDER BY u.unit_number NULLS LAST, t.full_name`,
    [month, year, rule.grace_days]
  );
  // Only tenants that lived in a unit that month (the arrears module's
  // tenancy window) owe that month's rent.
  return rows.filter((r) => r.was_occupied);
}

function computePenalty(rule: PenaltyRuleRow, candidate: OverdueCandidate): number {
  const expected = Number(candidate.monthly_rent);
  const paid = Number(candidate.paid);
  if (paid >= expected) return 0; // not actually overdue (overpay counts as clear)
  let amount = rule.rule_type === 'FIXED' ? Number(rule.amount) : (expected * Number(rule.percentage)) / 100;
  if (rule.max_penalty !== null) amount = Math.min(amount, Number(rule.max_penalty));
  return round2(amount);
}

export interface PenaltyPreviewRow {
  tenantId: number;
  tenantName: string;
  unitNumber: string | null;
  month: number;
  year: number;
  monthlyRent: number;
  paid: number;
  penalty: number;
  ruleId: number;
  ruleName: string;
}

export async function previewPenalties(ruleId: number, month?: number, year?: number): Promise<PenaltyPreviewRow[]> {
  const rule = await requireRule(ruleId);
  const settings = await getSettings();
  const targetYear = year ?? settings.reporting_year;
  const targetMonth = month ?? reportingThroughMonth(targetYear);

  const candidates = await overdueTenants(rule, targetMonth, targetYear);
  return candidates
    .map((c) => ({
      tenantId: c.tenant_id,
      tenantName: c.full_name,
      unitNumber: c.unit_number,
      month: targetMonth,
      year: targetYear,
      monthlyRent: Number(c.monthly_rent),
      paid: Number(c.paid),
      penalty: computePenalty(rule, c),
      ruleId: rule.id,
      ruleName: rule.name,
    }))
    .filter((r) => r.penalty > 0);
}

export interface ApplyResult {
  applied: number;
  skippedAlreadyCharged: number;
  failures: { tenantId: number; error: string }[];
  totalCharged: number;
}

export async function applyPenalties(
  ruleId: number,
  userId: number,
  month?: number,
  year?: number
): Promise<ApplyResult> {
  const rule = await requireRule(ruleId);
  if (!rule.active) throw badRequest('This rule is inactive — activate it before applying.');
  const settings = await getSettings();
  const targetYear = year ?? settings.reporting_year;
  const targetMonth = month ?? reportingThroughMonth(targetYear);

  const candidates = await overdueTenants(rule, targetMonth, targetYear);
  const result: ApplyResult = { applied: 0, skippedAlreadyCharged: 0, failures: [], totalCharged: 0 };

  for (const candidate of candidates) {
    const penalty = computePenalty(rule, candidate);
    if (penalty <= 0) continue;

    try {
      await withTransaction(async (client) => {
        // Idempotency gate: UNIQUE (rule_id, tenant_id, month, year). INSERT
        // ... ON CONFLICT DO NOTHING → skipped rows never double-charge.
        const log = await client.query(
          `INSERT INTO penalty_log
             (rule_id, tenant_id, month, year, amount, balance_before, description, applied_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (rule_id, tenant_id, month, year) DO NOTHING
           RETURNING id`,
          [
            rule.id,
            candidate.tenant_id,
            targetMonth,
            targetYear,
            penalty,
            round2(Number(candidate.paid) - Number(candidate.monthly_rent)),
            `${rule.name}: rent for ${targetMonth}/${targetYear} unpaid after ${rule.grace_days}-day grace`,
            userId,
          ]
        );
        if (!log.rows.length) {
          result.skippedAlreadyCharged += 1;
          return; // already charged — skip the ledger write too
        }

        // The penalty rides the rent ledger as a negative payment for the
        // OVERDUE month (manual entries stay positive via the API guard).
        const payment = await client.query(
          `INSERT INTO rent_payments
             (payment_reference, tenant_id, unit_id, payment_date, billing_month, billing_year,
              amount, payment_method, notes)
           VALUES (NULL, $1, (SELECT unit_id FROM tenants WHERE id = $1), CURRENT_DATE, $2, $3, $4, 'OTHER', $5)
           RETURNING id`,
          [
            candidate.tenant_id,
            targetMonth,
            targetYear,
            -penalty,
            `Late fee (${rule.name}) for ${targetMonth}/${targetYear}`,
          ]
        );
        await client.query('UPDATE penalty_log SET payment_id = $2 WHERE id = $1', [log.rows[0].id, payment.rows[0].id]);
        result.applied += 1;
        result.totalCharged = round2(result.totalCharged + penalty);
      });
    } catch (err) {
      result.failures.push({ tenantId: candidate.tenant_id, error: (err as Error).message });
    }
  }

  await logAudit({
    userId,
    action: 'PENALTIES_APPLIED',
    entity: 'penalty_rules',
    entityId: rule.id,
    newValue: { month: targetMonth, year: targetYear, ...result },
  });
  return result;
}

export async function listPenaltyLog(filters: { page: number; limit: number; tenantId?: number; year?: number }): Promise<{ rows: unknown[]; pagination: import('../types').Pagination }> {
  const { paginate } = await import('./paginate');
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.tenantId) {
    params.push(filters.tenantId);
    where.push(`pl.tenant_id = $${params.length}`);
  }
  if (filters.year) {
    params.push(filters.year);
    where.push(`pl.year = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return paginate<Record<string, unknown>>({
    selectSql: `pl.*, r.name AS rule_name, t.full_name AS tenant_name, u.unit_number`,
    tableSql: `FROM penalty_log pl
     LEFT JOIN penalty_rules r ON r.id = pl.rule_id
     LEFT JOIN tenants t ON t.id = pl.tenant_id
     LEFT JOIN units u ON u.id = t.unit_id`,
    whereSql,
    params,
    orderBy: `ORDER BY pl.applied_at DESC`,
    page: filters.page,
    limit: filters.limit,
  });
}
