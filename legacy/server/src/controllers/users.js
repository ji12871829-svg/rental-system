// controllers/users.js — admin-only user management.
//
// Business rules beyond the DB:
//   1. Admin-only (routes gate with requireRole('admin')).
//   2. Passwords must satisfy the shared policy (min 8 chars, ≥1 number);
//      stored bcrypt-hashed; NEVER returned in any response.
//   3. Password reset bumps password_version → all of that user's existing
//      sessions die on their next request (requireAuth compares pwdv).
//   4. Self-protection: you cannot change your own role or deactivate your
//      own account (422 SELF_LOCKOUT). Changing your own PASSWORD is allowed
//      and rotates your session cookies so you stay signed in.
//   5. Last-admin protection: demoting or deactivating the final active admin
//      is blocked (422 LAST_ADMIN) — the building must always have one.
//   6. No DELETE endpoint: deactivate (isActive=false) instead. Users are
//      audit-relevant records, mirroring the archive-don't-delete philosophy
//      used for tenants.
const bcrypt = require('bcrypt');
const usersModel = require('../models/users');
const { signSession, setSessionCookies, mapUser } = require('./auth');
const { notFound, conflict, unprocessable } = require('../utils/httpError');

function mapManagedUser(u) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    isActive: u.is_active,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

async function hashPassword(plain) {
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
  return bcrypt.hash(plain, saltRounds);
}

async function list(req, res, next) {
  try {
    const { page, limit, offset } = require('../utils/pagination').parsePagination(req.query);
    const [rows, total] = await Promise.all([
      usersModel.list({ limit, offset }),
      usersModel.count(),
    ]);
    return res.json({
      data: rows.map(mapManagedUser),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const user = await usersModel.getById(Number(req.params.id));
    if (!user) throw notFound('User not found.');
    return res.json(mapManagedUser(user));
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const { email, password, fullName, role } = req.body;
    if (await usersModel.findByEmail(email.toLowerCase().trim())) {
      throw conflict('DUPLICATE_EMAIL', 'A user with that email already exists.');
    }
    const passwordHash = await hashPassword(password);
    const user = await usersModel.create({
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      full_name: fullName,
      role,
    });
    return res.status(201).json(mapManagedUser(user));
  } catch (err) {
    if (err.code === '23505') {
      return next(conflict('DUPLICATE_EMAIL', 'A user with that email already exists.'));
    }
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const target = await usersModel.getById(id);
    if (!target) throw notFound('User not found.');

    const b = req.body;
    const fields = {};
    if (b.fullName !== undefined) fields.full_name = b.fullName;
    if (b.role !== undefined) fields.role = b.role;
    if (b.isActive !== undefined) fields.is_active = b.isActive;

    // --- Rule 4: self-protection ---
    const changingOwnRole = b.role !== undefined && b.role !== target.role;
    if (req.user.userId === id && (changingOwnRole || b.isActive === false)) {
      throw unprocessable('SELF_LOCKOUT',
        'You cannot change your own role or deactivate your own account. Ask another admin.');
    }

    // --- Rule 5: last active admin protection ---
    const removesAdmin =
      target.role === 'admin' && target.is_active &&
      ((b.role !== undefined && b.role !== 'admin') || b.isActive === false);
    if (removesAdmin && (await usersModel.countOtherActiveAdmins(id)) === 0) {
      throw unprocessable('LAST_ADMIN',
        'Cannot remove the last active admin. Create another admin first.');
    }

    // --- Password reset (rule 3) ---
    let passwordChanged = false;
    if (b.password !== undefined) {
      fields.password_hash = await hashPassword(b.password);
      fields.password_version = target.password_version + 1;
      passwordChanged = true;
    }

    if (Object.keys(fields).length === 0) {
      throw unprocessable('EMPTY_UPDATE',
        'Provide at least one of fullName, role, password, isActive.');
    }

    const updated = await usersModel.update(id, fields);

    // Self password-change: rotate THIS browser's session cookies so the
    // current session survives the pwdv bump (other sessions still die).
    if (passwordChanged && req.user.userId === id && req.authViaCookie) {
      const fresh = await usersModel.getById(id);
      const csrfToken = require('crypto').randomBytes(24).toString('hex');
      setSessionCookies(res, { ...fresh, password_version: fields.password_version }, csrfToken);
      return res.json({ ...mapManagedUser(updated), passwordChanged: true, csrfToken });
    }

    return res.json({ ...mapManagedUser(updated), ...(passwordChanged ? { passwordChanged: true } : {}) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getById, create, update };