import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../config/db';
import { env } from '../config/env';
import { PORTAL_COOKIE, readCookies } from '../utils/authCookies';
import { forbidden, unauthorized } from '../utils/httpError';

// Portal requests carry req.tenant (tenantId) — deliberately a different
// shape from req.user so a tenant token can never be mistaken for staff auth.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: { tenantId: number; email: string; name: string };
    }
  }
}

interface PortalTokenPayload {
  sub: number;      // tenant_id
  email: string;
  name: string;
  aud: string;      // must be 'tenant_portal'
}

// No caching here on purpose: unlike staff users (30s cache trade-off for a
// remote DB), portal rows are few and disabling a tenant's access must take
// effect on their very next request.
export async function requireTenant(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization || '';
    const [scheme, bearerToken] = header.split(' ');
    const token = scheme === 'Bearer' && bearerToken
      ? bearerToken
      : readCookies(req.headers.cookie)[PORTAL_COOKIE];
    if (!token) {
      return next(unauthorized('Missing or malformed portal session.'));
    }

    let payload: PortalTokenPayload;
    try {
      payload = jwt.verify(token, env.jwtSecret, { audience: 'tenant_portal' }) as unknown as PortalTokenPayload;
    } catch {
      return next(unauthorized('Invalid or expired portal session.'));
    }

    const row = await queryOne<{ status: string; tenant_status: string }>(
      `SELECT a.status, t.status AS tenant_status
       FROM tenant_portal_access a
       JOIN tenants t ON t.id = a.tenant_id
       WHERE a.tenant_id = $1`,
      [payload.sub]
    );
    if (!row || row.status !== 'ACTIVE' || row.tenant_status !== 'ACTIVE') {
      return next(forbidden('This portal account is no longer active.'));
    }

    req.tenant = { tenantId: payload.sub, email: payload.email, name: payload.name };
    return next();
  } catch (err) {
    return next(err);
  }
}
