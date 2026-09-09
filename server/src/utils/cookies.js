// cookies.js — cookie helpers. No cookie-parser dependency needed: every
// value this app sets is hex or base64url (JWT), which never contains ';' or
// '=', so a simple split on ';' is safe for reading our own cookies.
function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Shared options for both cookies. SameSite=Lax is the secure default: the
// cookie is NOT sent on cross-site POST/PUT/PATCH/DELETE (which is what CSRF
// exploits), only on top-level GET navigations. Secure is on in production
// (must be — the transport is HTTPS there); local dev runs over http.
function cookieOptions({ httpOnly = false, maxAgeMs } = {}) {
  return {
    httpOnly,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

// Parses JWT_EXPIRES_IN-style durations ('8h', '30m', '90d', '4500s') to ms.
// Falls back to 8 hours so cookie lifetime always matches the token lifetime.
function parseDuration(str) {
  const m = /^(\d+)(ms|s|m|h|d)$/.exec(String(str || '').trim());
  if (!m) return 8 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = m[2];
  const multipliers = { ms: 1, s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return n * multipliers[unit];
}

module.exports = { getCookie, cookieOptions, parseDuration };