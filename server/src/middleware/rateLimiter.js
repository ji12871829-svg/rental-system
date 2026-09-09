// rateLimiter.js — express-rate-limit configuration.
// Global limiter per .env; a stricter limiter specifically on POST
// /api/auth/login to blunt brute-force attempts (HARD-QUESTIONS.md Q9:
// IP-based only — never lock the account itself, that is a DoS vector).
const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many requests, please try again later.', details: {} },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many login attempts. Try again in 15 minutes.', details: {} },
});

// Rate limiting is a production/dev safeguard, not a test fixture — disable it
// under NODE_ENV=test so integration suites are deterministic (login tests
// would otherwise trip the 5-attempts per 15-min window).
module.exports = {
  globalLimiter: process.env.NODE_ENV === 'test' ? (_req, _res, next) => next() : globalLimiter,
  loginLimiter: process.env.NODE_ENV === 'test' ? (_req, _res, next) => next() : loginLimiter,
};
