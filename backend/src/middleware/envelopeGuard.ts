// Response-envelope guard — CI/test enforcement of the contract declared in
// @rpms/shared (ApiItemResponse / ApiListResponse): every /api endpoint must
// answer { data: … } (+ pagination on lists). The frontend's api/portalApi
// clients pin that shape at compile time; this middleware closes the loop on
// the backend so a new route returning a bare array or a flat object (no
// `data` key) fails loudly in the integration suites instead of drifting
// silently until some consumer crashes one unwrap level off.
//
// It is LOG-ONLY in every environment: nothing here can 500 a genuine
// response, and provable drift ships a test failure via the suite in
// tests/integration/envelopeContract.test.ts. Bodies are captured by
// wrapping res.json BEFORE the route writes and re-serialized afterwards,
// so the wire bytes are identical whether or not this middleware is mounted
// (idempotent: never double-wraps or double-inspects).
//
// Exemptions (protocol endpoints whose shape is fixed by the other party or
// by a deliberate contract exception — see each route's header comment):
//   /api/health               — ops liveness probe, flat diagnostic shape
//   /api/public/units         — flat { currency, data }: the landing page
//                               needs the operator's currency without a
//                               session, and GET /api/settings needs one
//   /api/mpesa/c2b/*          — Safaricom Daraja C2B acknowledgment protocol
//                               ({ ResultCode, ResultDesc }), not our clients
//   /api/mpesa/stk/callback   — Daraja STK push result protocol
import type { NextFunction, Request, Response } from 'express';

const EXEMPT_PREFIXES = [
  '/api/health',
  '/api/public/units',
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
        console.error(
          `[envelope] ${req.method} ${path} answered ${status} without the { data } envelope ` +
          `(keys: ${Object.keys(body).join(', ') || 'none'}) — violates the @rpms/shared ` +
          `ApiItemResponse contract; add data: or extend EXEMPT_PREFIXES with a reason.`,
        );
      }
    }
    return originalJson(body);
  } as typeof res.json;

  next();
}
