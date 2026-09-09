// models/users.js — all SQL for admin user management lives here.
// Never expose password_hash or password_version outside this module.
const db = require('../config/db');
const { buildUpdate } = require('./_buildUpdate');

function publicColumns() {
  return 'id, email, full_name, role, is_active, created_at, updated_at';
}

async function count() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS total FROM users');
  return rows[0].total;
}

async function list({ limit, offset }) {
  const { rows } = await db.query(
    `SELECT ${publicColumns()} FROM users ORDER BY id LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(
    `SELECT ${publicColumns()}, password_version FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function findByEmail(email) {
  const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

// Guard helper: how many OTHER active admins exist (excluding userId).
// Used to block demoting/deactivating the last active admin.
async function countOtherActiveAdmins(excludeUserId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM users
     WHERE role = 'admin' AND is_active = TRUE AND id <> $1`,
    [excludeUserId]
  );
  return rows[0].total;
}

async function create({ email, password_hash, full_name, role }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4) RETURNING ${publicColumns()}`,
    [email, password_hash, full_name, role]
  );
  return rows[0];
}

async function update(id, fields) {
  const q = buildUpdate('users', id, fields);
  if (!q) return null;
  const { rows } = await db.query(q.text, q.values);
  return rows[0] || null;
}

module.exports = { count, list, getById, findByEmail, countOtherActiveAdmins, create, update };