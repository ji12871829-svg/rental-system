// models/reports.js — read-only aggregations for the Reports page and Dashboard.
// No mutations; every query is parameterized. Cycle math is deliberately done
// in JS via utils/calculateCyclesElapsed.js (the single named implementation,
// per AGENTS.md §4) rather than duplicated as a SQL function.
const db = require('../config/db');
const { calculateCyclesElapsed } = require('../utils/calculateCyclesElapsed');
const { formatDate } = require('../utils/formatDate');

// Occupancy at month end: month_end boundary is exclusive, so a lease that
// starts exactly ON month end does not count as occupying that month
// (conservative: avoids double-counting turnover days between back-to-back
// leases). Maintenance units are NOT vacant (rule: maintenance ≠ available).
async function occupancyForMonth(year, month) {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const { rows } = await db.query(
    `WITH month_end AS (
       SELECT ($1::date + INTERVAL '1 month')::date AS me
     )
     SELECT
       (SELECT COUNT(*)::int FROM units) AS total_units,
       (SELECT COUNT(*)::int FROM leases l
         WHERE l.status = 'active'
           AND l.start_date < (SELECT me FROM month_end)   -- started before month end
           AND l.end_date >= $1::date) AS occupied_units,  -- still running at some point in the month
       (SELECT COUNT(*)::int FROM units WHERE status = 'maintenance') AS maintenance_units`,
    [monthStart]
  );
  return rows[0];
}

// Rent due for a calendar month = sum of monthly_rent over ACTIVE leases
// covering that month (proration is out of scope: rent is billed monthly per
// ARCHITECTURE-ESSENTIALS). Collected = payments with payment_date in month.
async function rentCollectionForMonth(year, month) {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const { rows } = await db.query(
    `WITH month_end AS (
       SELECT ($1::date + INTERVAL '1 month')::date AS me
     )
     SELECT
       (SELECT COALESCE(SUM(l.monthly_rent), 0)::numeric(12,2) FROM leases l, month_end
         WHERE l.status = 'active' AND l.start_date < me) AS total_billed,
       (SELECT COALESCE(SUM(p.amount), 0)::numeric(12,2) FROM payments p
         WHERE p.payment_date >= $1::date
           AND p.payment_date < (SELECT me FROM month_end)) AS total_collected`,
    [monthStart]
  );
  return rows[0];
}

// Per-unit collection detail for the same month.
async function rentCollectionByUnit(year, month) {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const { rows } = await db.query(
    `WITH month_end AS (
       SELECT ($1::date + INTERVAL '1 month')::date AS me
     )
     SELECT u.id AS unit_id, u.unit_number,
       COALESCE(billed.rent, 0)::numeric(12,2) AS billed,
       COALESCE(paid.collected, 0)::numeric(12,2) AS collected
     FROM units u
     LEFT JOIN (
       SELECT l.unit_id, SUM(l.monthly_rent) AS rent
       FROM leases l, month_end
       WHERE l.status = 'active' AND l.start_date < me
       GROUP BY l.unit_id
     ) billed ON billed.unit_id = u.id
     LEFT JOIN (
       SELECT l.unit_id, SUM(p.amount) AS collected
       FROM payments p JOIN leases l ON l.id = p.lease_id
       WHERE p.payment_date >= $1::date AND p.payment_date < (SELECT me FROM month_end)
       GROUP BY l.unit_id
     ) paid ON paid.unit_id = u.id
     ORDER BY u.id`,
    [monthStart]
  );
  return rows;
}

// Active leases ending within N days from today — the human-facing nudge that
// prompts a manual expire/terminate (HARD-QUESTIONS.md Q6: no cron in v1).
async function upcomingExpirations(withinDays) {
  const { rows } = await db.query(
    `SELECT l.id, l.unit_id, l.tenant_id, l.start_date, l.end_date, l.monthly_rent, l.status,
            u.unit_number, t.first_name || ' ' || t.last_name AS tenant_name,
            (l.end_date - CURRENT_DATE) AS days_until_expiry
     FROM leases l
     JOIN units u ON u.id = l.unit_id
     JOIN tenants t ON t.id = l.tenant_id
     WHERE l.status = 'active'
       AND l.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1::int)
     ORDER BY l.end_date ASC`,
    [withinDays]
  );
  return rows;
}

// Money still owed per lease: due-to-date minus paid, over ALL leases
// (active or expired — a finished lease can still carry arrears).
// Two set-based queries (leases+paysum in one, cycles computed in JS) — no N+1.
async function outstandingBalances() {
  const { rows } = await db.query(
    `SELECT l.id AS lease_id, u.unit_number,
            t.first_name || ' ' || t.last_name AS tenant_name,
            l.monthly_rent::numeric(12,2) AS monthly_rent,
            l.start_date, l.end_date, l.status,
            COALESCE(ps.paid, 0)::numeric(12,2) AS paid
     FROM leases l
     JOIN units u ON u.id = l.unit_id
     JOIN tenants t ON t.id = l.tenant_id
     LEFT JOIN (
       SELECT lease_id, SUM(amount) AS paid FROM payments GROUP BY lease_id
     ) ps ON ps.lease_id = l.id`
  );
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((r) => {
    // pg returns DATE columns as JS Date objects — normalize to YYYY-MM-DD
    // strings BEFORE the cycle math (Date→String coercion is locale-dependent
    // and would corrupt the calculation).
    const start = formatDate(r.start_date);
    const end = formatDate(r.end_date);
    const billingEnd = end < today ? end : today;
    const cycles = calculateCyclesElapsed(start, billingEnd);
    const balanceDue = Math.round((cycles * Number(r.monthly_rent) - Number(r.paid)) * 100) / 100;
    return {
      lease_id: r.lease_id,
      unit_number: r.unit_number,
      tenant_name: r.tenant_name,
      monthly_rent: r.monthly_rent,
      start_date: r.start_date,
      end_date: r.end_date,
      status: r.status,
      cycles_elapsed: cycles,
      paid: r.paid,
      balance_due: balanceDue.toFixed(2),
    };
  });
}

module.exports = { occupancyForMonth, rentCollectionForMonth, rentCollectionByUnit, upcomingExpirations, outstandingBalances };
