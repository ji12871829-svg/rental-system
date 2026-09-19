import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../config/db';
import { env } from '../config/env';
import { PORTAL_COOKIE, readCookies } from '../utils/authCookies';
import { forbidden, unauthorized } from '../utils/httpError';

// The two token populations (staff sessions and tenant-portal sessions) are
// signed with the same secret, so the audience claim is the boundary between
// the two auth domains. Staff side signs/verifies STAFF_JWT_AUDIENCE; the
// portal side signs/verifies PORTAL_JWT_AUDIENCE. The two values are distinct
// on purpose — never unify them, and never sign or verify a token without one.
export const PORTAL_JWT_AUDIENCE = 'tenant_portal' as const;
// Distinct from PORTAL_JWT_AUDIENCE by design — see note above.
export const STAFF_JWT_AUDIENCE = 'staff_api' as const;

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
  aud: string;      // must be PORTAL_JWT_AUDIENCE
}

// No caching here on purpose: unlike staff users (30s cache trade-off for a
// remote DB), portal rows are few and disabling a tenant's access must take
// effect on their very next request.
export async function requireTenant(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readCookies(req.headers.cookie)[PORTAL_COOKIE];
    if (!token) {
      return next(unauthorized('Missing or malformed portal session.'));
    }

    let payload: PortalTokenPayload;
    try {
      // Pinned key + pinned audience: both halves of the portal-token trust
      // boundary live here, so a staff-signed or foreign-audience token can
      // never satisfy portal auth.
      payload = jwt.verify(token, env.jwtPortalSecret, { audience: PORTAL_JWT_AUDIENCE }) as unknown as PortalTokenPayload;
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
