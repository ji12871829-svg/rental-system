// models/tenants.js — all SQL for the `tenants` table lives here.
const db = require('../config/db');
const { buildUpdate } = require('./_buildUpdate');

async function count({ includeArchived }) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM tenants ${includeArchived ? '' : 'WHERE is_archived = FALSE'}`
  );
  return rows[0].total;
}

async function list({ limit, offset, includeArchived }) {
  const { rows } = await db.query(
    `SELECT * FROM tenants ${includeArchived ? '' : 'WHERE is_archived = FALSE'}
     ORDER BY last_name, first_name LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function getById(id) {
  const { rows } = await db.query('SELECT * FROM tenants WHERE id = $1', [id]);
  return rows[0] || null;
}

// Used by BOTH hard-delete blocking AND archive blocking (HARD-QUESTIONS.md Q7):
// a tenant with an active lease cannot be archived ("done with us") or deleted.
async function hasActiveLease(tenantId) {
  const { rows } = await db.query(
    `SELECT EXISTS(SELECT 1 FROM leases WHERE tenant_id = $1 AND status = 'active') AS has_active`,
    [tenantId]
  );
  return rows[0].has_active;
}

async function create(tenant) {
  const { rows } = await db.query(
    `INSERT INTO tenants (first_name, last_name, email, phone, national_id, emergency_contact_name, emergency_contact_phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [tenant.first_name, tenant.last_name, tenant.email, tenant.phone,
     tenant.national_id || null, tenant.emergency_contact_name || null, tenant.emergency_contact_phone || null]
  );
  return rows[0];
}

async function update(id, fields) {
  const q = buildUpdate('tenants', id, fields);
  if (!q) return null;
  const { rows } = await db.query(q.text, q.values);
  return rows[0] || null;
}

async function archive(id) {
  const { rows } = await db.query(
    'UPDATE tenants SET is_archived = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *',
    [id]
  );
  return rows[0] || null;
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM tenants WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = { count, list, getById, hasActiveLease, create, update, archive, remove };
