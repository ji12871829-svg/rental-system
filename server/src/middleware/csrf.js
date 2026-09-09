// csrf.js — double-submit cookie CSRF protection for state-changing requests.
//
// Why this protects cookie auth: a browser automatically attaches cookies to
// cross-site requests, so an attacker's site could trigger POST /api/leases
// etc. against this origin and the httpOnly JWT cookie would ride along.
// Two layers stop that:
//   1. SameSite=Lax cookies are not sent on cross-site POST/PUT/PATCH/DELETE
//      at all (defense in depth).
//   2. This middleware requires X-CSRF-Token to match BOTH the rms_csrf
//      cookie AND the `csrf` claim embedded in the authenticated JWT. A
//      cross-site attacker cannot read either, so the request is rejected (403).
//
// Bearer-token API clients (Postman, tests) are NOT vulnerable to CSRF —
// cross-site requests can't attach arbitrary headers — so the check is
// skipped when the request authenticated via the Authorization header.
const { forbidden } = require('../utils/httpError');
const { getCookie } = require('../utils/cookies');

function csrfProtection(req, res, next) {
  if (req.authViaCookie === false) return next();

  const headerToken = req.headers['x-csrf-token'];
  const cookieToken = getCookie(req, 'rms_csrf');

  if (
    !headerToken ||
    !cookieToken ||
    headerToken !== cookieToken ||
    !req.user ||
    headerToken !== req.user.csrf
  ) {
    return next(forbidden('CSRF validation failed.'));
  }
  return next();
}

module.exports = { csrfProtection };