// models/maintenance.js — all SQL for the `maintenance_requests` table lives here.
const db = require('../config/db');
const { buildUpdate } = require('./_buildUpdate');
const { MAINTENANCE_TRANSITIONS, isTransitionAllowed } = require('../utils/transitions');

const LIST_SELECT = `
  SELECT m.*, u.unit_number, t.first_name || ' ' || t.last_name AS tenant_name
  FROM maintenance_requests m
  JOIN units u   ON u.id = m.unit_id
  LEFT JOIN tenants t ON t.id = m.tenant_id`; // LEFT: tenant may have been deleted (ON DELETE SET NULL)

async function count({ status, unitId, priority }) {
  const params = [];
  const clauses = [];
  if (status) { params.push(status); clauses.push('m.status = $' + params.length); }
  if (unitId) { params.push(unitId); clauses.push('m.unit_id = $' + params.length); }
  if (priority) { params.push(priority); clauses.push('m.priority = $' + params.length); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM maintenance_requests m ${where}`,
    params
  );
  return rows[0].total;
}

async function list({ limit, offset, status, unitId, priority }) {
  const params = [];
  const clauses = [];
  if (status) { params.push(status); clauses.push('m.status = $' + params.length); }
  if (unitId) { params.push(unitId); clauses.push('m.unit_id = $' + params.length); }
  if (priority) { params.push(priority); clauses.push('m.priority = $' + params.length); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  params.push(limit, offset);
  const { rows } = await db.query(
    `${LIST_SELECT} ${where}
     ORDER BY CASE m.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              m.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(`${LIST_SELECT} WHERE m.id = $1`, [id]);
  return rows[0] || null;
}

async function create(request) {
  const { rows } = await db.query(
    `INSERT INTO maintenance_requests (unit_id, tenant_id, description, priority)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [request.unit_id, request.tenant_id || null, request.description, request.priority]
  );
  return rows[0];
}

// Status transition was already validated in the controller (open → in_progress
// → resolved, open/in_progress → cancelled). 'resolved' stamps resolved_at.
// Priority/vendor/cost can be updated in the same call.
async function update(id, fields) {
  // maintenance_requests has no updated_at column (see 001_init_schema.sql).
  const q = buildUpdate('maintenance_requests', id, fields, { withTimestamp: false });
  if (!q) return null;
  const { rows } = await db.query(q.text, q.values);
  return rows[0] || null;
}

module.exports = { count, list, getById, create, update, VALID_TRANSITIONS: MAINTENANCE_TRANSITIONS };
