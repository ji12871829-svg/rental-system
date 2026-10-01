// Response-envelope guard — CI/test enforcement of the contract declared in
// @rpms/shared (ApiItemResponse / ApiListResponse): every /api endpoint must
// answer { data: … } (+ pagination on lists). The frontend's api/portalApi
// clients pin that shape at compile time; this middleware closes the loop on
// the backend so a new route returning a bare array or a flat object (no
// `data` key) fails loudly instead of drifting silently until some consumer
// crashes one unwrap level off.
//
// Two enforcement levels:
//   production/development — LOG-ONLY: nothing here can 500 a genuine
//     response, so the wire is identical whether or not this middleware is
//     mounted (idempotent: never double-wraps or double-inspects).
//   NODE_ENV=test — FAIL-FAST: a violating 2xx response THROWS, so the error
//     handler answers 500 ENVELOPE_VIOLATION and the integration suite that
//     caused the drift fails on the spot — not just the contract suite.
//     Supertest captures the error, making the offending route + body
//     directly visible in the failure output.
//
// Exemptions (protocol endpoints whose shape is fixed by the other party —
// see each route's header comment):
//   /api/health               — ops liveness probe, flat diagnostic shape
//   /api/mpesa/c2b/*          — Safaricom Daraja C2B acknowledgment protocol
//                               ({ ResultCode, ResultDesc }), not our clients
//   /api/mpesa/stk/callback   — Daraja STK push result protocol
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { HttpError } from '../utils/httpError';

const EXEMPT_PREFIXES = [
  '/api/health',
  '/api/mpesa/c2b/',
  '/api/mpesa/stk/callback',
];

interface JsonBody {
  [key: string]: unknown;
}

export function envelopeGuard(req: Request, res: Response, next: NextFunction): void {
  const path = req.path || req.originalUrl?.split('?')[0] || '';

  if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  let inspected = false;

  res.json = function patchedJson(body: JsonBody): Response {
    if (!inspected) {
      inspected = true;
      const status = res.statusCode;
      // Errors already answer the shared ApiErrorBody ({ error, message }).
      // 204/304 and empty bodies are envelope-free by definition.
      const isJsonObject =
        body !== null && typeof body === 'object' && !Array.isArray(body);
      if (status >= 200 && status < 300 && isJsonObject && body.data === undefined) {
        const detail =
          `${req.method} ${path} answered ${status} without the { data } envelope ` +
          `(keys: ${Object.keys(body).join(', ') || 'none'}) — violates the @rpms/shared ` +
          `ApiItemResponse contract; add data: or extend EXEMPT_PREFIXES with a reason.`;
        if (env.nodeEnv === 'test') {
          // Fail the suite that produced the drift. Throwing from res.json
          // routes through errorHandler → 500 ENVELOPE_VIOLATION; supertest
          // surfaces both the status and the offending body.
          throw new HttpError(500, 'ENVELOPE_VIOLATION', detail);
        }
        console.error(`[envelope] ${detail}`);
      }
    }
    return originalJson(body);
  } as typeof res.json;

  next();
}
