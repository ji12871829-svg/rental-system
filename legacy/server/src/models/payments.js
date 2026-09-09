// models/payments.js — all SQL for the `payments` table lives here.
// Payments are never hard-deleted (financial records); there is intentionally
// no remove() function.
const db = require('../config/db');

const LIST_SELECT = `
  SELECT p.*, l.unit_id, u.unit_number,
         t.first_name || ' ' || t.last_name AS tenant_name
  FROM payments p
  JOIN leases l  ON l.id = p.lease_id
  JOIN units u   ON u.id = l.unit_id
  JOIN tenants t ON t.id = l.tenant_id`;

async function count({ leaseId, dateFrom, dateTo }) {
  const params = [];
  const clauses = [];
  if (leaseId) { params.push(leaseId); clauses.push('p.lease_id = $' + params.length); }
  if (dateFrom) { params.push(dateFrom); clauses.push('p.payment_date >= $' + params.length); }
  if (dateTo) { params.push(dateTo); clauses.push('p.payment_date <= $' + params.length); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const { rows } = await db.query(`SELECT COUNT(*)::int AS total FROM payments p ${where}`, params);
  return rows[0].total;
}

async function list({ limit, offset, leaseId, dateFrom, dateTo }) {
  const params = [];
  const clauses = [];
  if (leaseId) { params.push(leaseId); clauses.push('p.lease_id = $' + params.length); }
  if (dateFrom) { params.push(dateFrom); clauses.push('p.payment_date >= $' + params.length); }
  if (dateTo) { params.push(dateTo); clauses.push('p.payment_date <= $' + params.length); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  params.push(limit, offset);
  const { rows } = await db.query(
    `${LIST_SELECT} ${where} ORDER BY p.payment_date DESC, p.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(`${LIST_SELECT} WHERE p.id = $1`, [id]);
  return rows[0] || null;
}

async function sumForLease(leaseId) {
  const { rows } = await db.query(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE lease_id = $1',
    [leaseId]
  );
  return Number(rows[0].total);
}

// Soft duplicate guard (HARD-QUESTIONS.md Q4): identical payment within the
// last 60 seconds is almost certainly a double-submit, not real money.
async function findRecentDuplicate({ leaseId, amount, paymentDate, referenceNumber }) {
  const { rows } = await db.query(
    `SELECT id FROM payments
     WHERE lease_id = $1 AND amount = $2::numeric
       AND payment_date = $3::date
       AND COALESCE(reference_number, '') = COALESCE($4, '')
       AND created_at >= NOW() - INTERVAL '60 seconds'
     LIMIT 1`,
    [leaseId, amount, paymentDate, referenceNumber]
  );
  return rows[0] || null;
}

async function create(payment) {
  const { rows } = await db.query(
    `INSERT INTO payments (lease_id, amount, payment_date, payment_method, reference_number, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [payment.lease_id, payment.amount, payment.payment_date, payment.payment_method,
     payment.reference_number || null, payment.notes || null]
  );
  return rows[0];
}

module.exports = { count, list, getById, sumForLease, findRecentDuplicate, create };
