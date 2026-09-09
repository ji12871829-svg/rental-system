// models/units.js — all SQL for the `units` table lives here. No SQL in routes/controllers.
const db = require('../config/db');
const { buildUpdate } = require('./_buildUpdate');

async function count({ status }) {
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = 'WHERE status = $1';
  }
  const { rows } = await db.query(`SELECT COUNT(*)::int AS total FROM units ${where}`, params);
  return rows[0].total;
}

async function list({ limit, offset, status }) {
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = 'WHERE status = $1';
  }
  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT * FROM units ${where} ORDER BY id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function getById(id) {
  const { rows } = await db.query('SELECT * FROM units WHERE id = $1', [id]);
  return rows[0] || null;
}

// True when the unit has any lease or maintenance history, i.e. it is a
// historical record and must not be hard-deleted (ARCHITECTURE-ESSENTIALS rule 5).
async function hasHistory(id) {
  const { rows } = await db.query(
    `SELECT EXISTS(SELECT 1 FROM leases WHERE unit_id = $1)
          OR EXISTS(SELECT 1 FROM maintenance_requests WHERE unit_id = $1) AS has_history`,
    [id]
  );
  return rows[0].has_history;
}

async function create(unit) {
  const { rows } = await db.query(
    `INSERT INTO units (unit_number, floor, bedrooms, bathrooms, square_feet, base_rent, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [unit.unit_number, unit.floor, unit.bedrooms, unit.bathrooms, unit.square_feet, unit.base_rent, unit.notes]
  );
  return rows[0];
}

async function update(id, fields) {
  const q = buildUpdate('units', id, fields);
  if (!q) return null;
  const { rows } = await db.query(q.text, q.values);
  return rows[0] || null;
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM units WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = { count, list, getById, hasHistory, create, update, remove };
