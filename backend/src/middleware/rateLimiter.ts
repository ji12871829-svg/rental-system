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