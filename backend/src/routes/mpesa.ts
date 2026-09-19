import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { asyncHandler } from '../utils/asyncHandler';
import { parseC2bCallback, parseStkCallback } from '../services/mpesaProvider';
import { markStkFailure, processMpesaPayment, processPaybillPayment } from '../services/mpesaService';

const router = Router();

// ---------------------------------------------------------------------------
// Callback authentication
//
// These endpoints are hit by Safaricom's Daraja platform, which cannot
// authenticate as a user and cannot set custom headers — so the shared secret
// (env MPESA_CALLBACK_TOKEN) is carried as a query parameter on the registered
// callback URL and verified here timing-safely. While the token is unset
// (dev/test, or prod before the ops step), the endpoints stay open for the
// local mock provider; production logs a startup warning until the token is
// configured. The shortcode check below still rejects payloads naming a till
// we do not operate, and the limiter blunts brute-forcing the secret.
// ---------------------------------------------------------------------------
const callbackLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.nodeEnv === 'test',
  message: { ResultCode: 1, ResultDesc: 'Too many callback requests.' },
});

router.use(callbackLimiter);

function verifyCallbackToken(req: Request, res: Response, next: NextFunction): void {
  if (!env.mpesaCallbackToken) {
    return next();
  }
  const provided = Buffer.from(String(req.query.token ?? ''));
  const expected = Buffer.from(env.mpesaCallbackToken);
  if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
    return next();
  }
  // 404 (not 401/403): reveal nothing about the endpoint's existence.
  res.status(404).json({ ResultCode: 1, ResultDesc: 'Invalid callback URL.' });
}

// A real Daraja confirmation carries the business shortcode that received the
// money; reject payloads naming any other shortcode so a forged body cannot
// post payments against a till we do not operate. Absent shortcode (some
// validation-phase bodies) is tolerated — validation responses are advisory.
function verifyShortcode(shortcode: unknown, context: string): void {
  if (!env.mpesaShortcode) return; // mock/local — no shortcode configured
  if (shortcode === undefined || shortcode === null) return;
  if (String(shortcode).trim() !== env.mpesaShortcode.trim()) {
    throw new Error(`${context} references a different business shortcode.`);
  }
}

router.post('/c2b/validate', verifyCallbackToken, (_req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted.' });
});

router.post('/c2b/confirm', verifyCallbackToken, asyncHandler(async (req, res) => {
  try {
    verifyShortcode(req.body?.BusinessShortCode ?? req.body?.ShortCode, 'C2B confirmation');
    const payment = parseC2bCallback(req.body);
    const result = await processPaybillPayment(payment);
    res.json({ ResultCode: 0, ResultDesc: result.status === 'UNMATCHED' ? 'Accepted for manual review.' : 'Accepted.' });
  } catch (error) {
    console.error('[mpesa] C2B callback failed:', (error as Error).message);
    res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback.' });
  }
}));

router.post('/stk/callback', verifyCallbackToken, asyncHandler(async (req, res) => {
  try {
    const callback = parseStkCallback(req.body);
    if (!callback.payment) {
      await markStkFailure(callback.checkoutRequestId, callback.resultDescription, req.body);
      res.json({ ResultCode: 0, ResultDesc: 'Accepted.' });
      return;
    }
    const result = await processMpesaPayment(callback.payment, 'STK');
    res.json({ ResultCode: 0, ResultDesc: result.status === 'UNMATCHED' ? 'Accepted for manual review.' : 'Accepted.' });
  } catch (error) {
    console.error('[mpesa] STK callback failed:', (error as Error).message);
    res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback.' });
  }
}));

export default router;