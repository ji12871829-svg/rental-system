// controllers/auth.js — login / current user / logout.
//
// Session management (post-cookie migration): login issues TWO cookies —
//   rms_token  (JWT, httpOnly, SameSite=Lax) — JS can never read it
//   rms_csrf   (random hex, SameSite=Lax, NOT httpOnly) — the double-submit
//              CSRF token; the SAME value is embedded in the JWT payload so
//              csrfProtection can verify the header against both.
// The raw JWT is deliberately NOT returned by the cookie login: the web
// client's JavaScript has no legitimate need for it, and returning it would
// re-expose it to any XSS that hooks fetch. API clients use /auth/login/token.
//
// Every JWT carries `pwdv` (the user's password_version). requireAuth rejects
// tokens whose pwdv is stale, so an admin password reset invalidates all
// previously issued sessions for that user.
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authModel = require('../models/auth');
const { unauthorized } = require('../utils/httpError');
const { cookieOptions, parseDuration } = require('../utils/cookies');

const TOKEN_COOKIE = 'rms_token';
const CSRF_COOKIE = 'rms_csrf';

function mapUser(u) {
  return { id: u.id, email: u.email, fullName: u.full_name, role: u.role };
}

// Single place where session JWTs are minted (login, token login, and the
// self-service password-change rotation in controllers/users.js).
function signSession(user, csrfToken) {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      email: user.email,
      csrf: csrfToken,
      pwdv: user.password_version,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

// Sets the cookie pair on a response. Used by login and by the password-change
// rotation (so an admin changing their OWN password keeps their browser
// session instead of being logged out mid-action).
function setSessionCookies(res, user, csrfToken) {
  const maxAgeMs = parseDuration(process.env.JWT_EXPIRES_IN);
  res.cookie(TOKEN_COOKIE, signSession(user, csrfToken), cookieOptions({ httpOnly: true, maxAgeMs }));
  res.cookie(CSRF_COOKIE, csrfToken, cookieOptions({ maxAgeMs }));
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await authModel.findByEmail(email.toLowerCase().trim());

    // Same 401 + generic message whether the email or the password is wrong —
    // never tell an attacker which half failed.
    if (!user || !user.is_active) {
      throw unauthorized('Invalid email or password.');
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw unauthorized('Invalid email or password.');

    // One random CSRF value, split across the JS-readable cookie and the JWT
    // claim — the middleware requires both to agree with the header.
    const csrfToken = crypto.randomBytes(24).toString('hex');
    setSessionCookies(res, user, csrfToken);

    return res.json({ user: mapUser(user), csrfToken });
  } catch (err) {
    return next(err);
  }
}

// Logout needs no auth: clearing cookies is safe regardless, and it doubles as
// a "make this browser forget me" escape hatch even if the token already died.
function logout(req, res) {
  const opts = cookieOptions();
  res.clearCookie(TOKEN_COOKIE, opts);
  res.clearCookie(CSRF_COOKIE, opts);
  return res.json({ message: 'Logged out.' });
}

// API-client login: identical credential verification, but returns the raw
// JWT in the body instead of setting cookies. Exists so Postman, scripts and
// the E2E suite can use Bearer auth (cookies are browser-only machinery).
// The web client NEVER calls this — its session lives in the httpOnly cookie.
async function loginToken(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await authModel.findByEmail(email.toLowerCase().trim());
    if (!user || !user.is_active) throw unauthorized('Invalid email or password.');
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw unauthorized('Invalid email or password.');

    const csrfToken = crypto.randomBytes(24).toString('hex');
    return res.json({ token: signSession(user, csrfToken), user: mapUser(user) });
  } catch (err) {
    return next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await authModel.findActiveById(req.user.userId);
    if (!user) throw unauthorized('Account no longer active.');
    return res.json({ user: mapUser(user) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { login, loginToken, logout, me, signSession, setSessionCookies, mapUser };