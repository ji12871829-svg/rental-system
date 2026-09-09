// auth.js — session verification for protected routes.
//
// Session source (post-cookie migration):
//   1. `rms_token` httpOnly cookie — the canonical path for the web client.
//   2. `Authorization: Bearer <token>` — retained for API clients (Postman,
//      scripts, integration tests) that use raw JWT auth.
// `req.authViaCookie` records which path was used so csrfProtection can skip
// bearer-authenticated (CSRF-immune) requests.
//
// Beyond signature + expiry, every request re-validates against the DB:
//   - is_active must be true → deactivation cuts access immediately.
//   - JWT `pwdv` must match the user's current password_version → a password
//     reset invalidates all previously issued sessions.
const jwt = require('jsonwebtoken');
const authModel = require('../models/auth');
const { unauthorized, forbidden } = require('../utils/httpError');
const { getCookie } = require('../utils/cookies');

async function requireAuth(req, res, next) {
  let token = null;
  let viaCookie = false;

  const header = req.headers.authorization || '';
  const [scheme, bearerToken] = header.split(' ');
  if (scheme === 'Bearer' && bearerToken) {
    token = bearerToken;
  } else {
    const cookieToken = getCookie(req, 'rms_token');
    if (cookieToken) {
      token = cookieToken;
      viaCookie = true;
    }
  }

  if (!token) {
    return next(unauthorized('Missing or malformed session.'));
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    // Expired vs malformed both surface as 401 to avoid helping an attacker
    // distinguish token states.
    return next(unauthorized('Invalid or expired session.'));
  }

  try {
    const user = await authModel.findSessionUser(payload.userId);
    if (!user || !user.is_active) {
      return next(unauthorized('Account no longer active.'));
    }
    if (user.password_version !== payload.pwdv) {
      // Session predates a password change — force re-login.
      return next(unauthorized('Session invalidated. Please sign in again.'));
    }
    req.user = {
      userId: user.id,
      role: user.role,
      email: user.email,
      csrf: payload.csrf, // bound to the JWT at login; CSRF middleware checks it
    };
    req.authViaCookie = viaCookie;
    return next();
  } catch (err) {
    return next(err);
  }
}

// requireRole('admin') allows only that role. Managers pass for everything
// except admin-only routes (user management, destructive deletes).
function requireRole(role) {
  return function (req, res, next) {
    if (!req.user || req.user.role !== role) {
      return next(forbidden(`This action requires the '${role}' role.`));
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };