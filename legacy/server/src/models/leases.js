// models/leases.js — all SQL for the `leases` table lives here.
// DB-enforced no-overlap via EXCLUDE USING gist (migrations/001_init_schema.sql);
// the controller pre-checks overlap for a friendly 409, this model is the
// transactional layer and the constraint is the last line of defense.
const db = require('../config/db');
const { buildUpdate } = require('./_buildUpdate');

const LIST_SELECT = `
  SELECT l.*, u.unit_number, t.first_name || ' ' || t.last_name AS tenant_name
  FROM leases l
  JOIN units u   ON u.id = l.unit_id
  JOIN tenants t ON t.id = l.tenant_id`;

async function count({ status, unitId, tenantId }) {
  const params = [];
  const clauses = [];
  if (status) { params.push(status); clauses.push('l.status = $' + params.length); }
  if (unitId) { params.push(unitId); clauses.push('l.unit_id = $' + params.length); }
  if (tenantId) { params.push(tenantId); clauses.push('l.tenant_id = $' + params.length); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM leases l ${where}`,
    params
  );
  return rows[0].total;
}

async function list({ limit, offset, status, unitId, tenantId }) {
  const params = [];
  const clauses = [];
  if (status) { params.push(status); clauses.push('l.status = $' + params.length); }
  if (unitId) { params.push(unitId); clauses.push('l.unit_id = $' + params.length); }
  if (tenantId) { params.push(tenantId); clauses.push('l.tenant_id = $' + params.length); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  params.push(limit, offset);
  const { rows } = await db.query(
    `${LIST_SELECT} ${where} ORDER BY l.start_date DESC, l.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(`${LIST_SELECT} WHERE l.id = $1`, [id]);
  return rows[0] || null;
}

// Controller pre-check for a friendly 409 BEFORE the write hits the DB
// constraint. Inclusive daterange ('[]') matches the EXCLUDE constraint
// exactly — touching dates count as overlapping (see utils/dateOverlap.js).
async function findOverlapping(unitId, startDate, endDate, excludeLeaseId = null) {
  const params = [unitId, startDate, endDate];
  let exclude = '';
  if (excludeLeaseId) {
    params.push(excludeLeaseId);
    exclude = `AND l.id <> $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT l.*, u.unit_number FROM leases l JOIN units u ON u.id = l.unit_id
     WHERE l.unit_id = $1 AND l.status = 'active'
       AND daterange(l.start_date, l.end_date, '[]') && daterange($2::date, $3::date, '[]')
       ${exclude}
     LIMIT 1`,
    params
  );
  return rows[0] || null;
}

// Creates the lease AND flips the unit to 'occupied' in ONE transaction —
// a lease without the unit-status flip leaves reports lying about occupancy.
async function create(lease) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO leases (unit_id, tenant_id, start_date, end_date, monthly_rent, deposit_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [lease.unit_id, lease.tenant_id, lease.start_date, lease.end_date,
       lease.monthly_rent, lease.deposit_amount, lease.status]
    );
    const created = rows[0];
    await client.query(`UPDATE units SET status = 'occupied', updated_at = NOW() WHERE id = $1`, [lease.unit_id]);
    await client.query('COMMIT');
    return created;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Field updates + status side effects in one transaction: terminating or
// expiring a lease releases the unit back to 'vacant'. Another active lease
// on that unit is impossible (overlap constraint), so no re-check needed here.
async function update(id, fields) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const q = buildUpdate('leases', id, fields);
    if (!q) {
      await client.query('ROLLBACK');
      return null;
    }
    const { rows } = await client.query(q.text, q.values);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    if (fields.status === 'terminated' || fields.status === 'expired') {
      await client.query(
        `UPDATE units SET status = 'vacant', updated_at = NOW()
         WHERE id = $1 AND NOT EXISTS (
           SELECT 1 FROM leases WHERE unit_id = $1 AND status = 'active' AND id <> $2
         )`,
        [rows[0].unit_id, id]
      );
    }
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { count, list, getById, findOverlapping, create, update };
