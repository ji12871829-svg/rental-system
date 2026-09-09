// models/auth.js — SQL for the `users` table (login + session validation).
const db = require('../config/db');

async function findByEmail(email) {
  const { rows } = await db.query(
    `SELECT id, email, password_hash, full_name, role, is_active, password_version
     FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
}

// Session validation lookup: requireAuth calls this on EVERY authenticated
// request so that (a) deactivated accounts lose access immediately and
// (b) sessions issued before a password reset (old password_version) are
// rejected. Small table, indexed PK — cheap, and it closes the "stateless JWT
// outlives the account change" hole.
async function findSessionUser(id) {
  const { rows } = await db.query(
    `SELECT id, email, full_name, role, is_active, password_version
     FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function findActiveById(id) {
  const { rows } = await db.query(
    'SELECT id, email, full_name, role, is_active FROM users WHERE id = $1 AND is_active = TRUE',
    [id]
  );
  return rows[0] || null;
}

module.exports = { findByEmail, findSessionUser, findActiveById };