import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many requests. Please try again later.', details: {} },
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.nodeEnv === 'test',
  message: { error: 'RATE_LIMITED', message: 'Too many login attempts. Please wait 15 minutes.', details: {} },
});

// Public marketing forms ("Request a demo") — stricter than login because a
// submission here is pure noise, not an auth attempt: 5 per IP per 15 min
// blunts scripted spam without blocking a shared office NAT. Test env skips
// so integration tests exercise the handler, not the throttle.
export const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.nodeEnv === 'test',
  message: { error: 'RATE_LIMITED', message: 'Too many requests. Please try again later.', details: {} },
});