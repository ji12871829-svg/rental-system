// Clerk bridge middleware — lets Clerk sessions satisfy staff auth without
// removing the legacy JWT path.
//
// Wiring: when CLERK_SECRET_KEY is set, app.ts mounts clerkMiddleware() and
// this middleware right after it, before the route guards. When it resolves
// a signed-in Clerk session to an ACTIVE local user, it stamps req.user and
// requireAuth (and every role guard built on it) accepts the request — all
// 67 guarded routes take both token populations with zero route changes.
// Without keys, neither runs and the legacy JWT flow is untouched.
//
// The trust rule: Clerk proves identity; this database still decides what
// that identity may do. Role and ACTIVE status always come from the local
// users row — a Clerk user that isn't mapped in user_external_ids, or whose
// local user is INACTIVE, falls through and gets the normal 401.
import type { NextFunction, Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import { env } from '../config/env';
import { queryOne } from '../config/db';
import type { AuthUser, Role } from '../types';

export async function clerkAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  // No Clerk configured → inert; requireAuth's JWT path owns every request.
  if (!env.clerkSecretKey) return next();
  try {
    // clerkMiddleware() has already run (same guard in app.ts), so getAuth
    // can read the session from cookies/headers without throwing.
    const { userId } = getAuth(req);
    if (!userId) return next(); // anonymous → let requireAuth answer 401

    const mapped = await queryOne<{
      id: number; name: string; email: string; role: Role; status: string;
    }>(
      `SELECT u.id, u.name, u.email, u.role, u.status
         FROM user_external_ids x JOIN users u ON u.id = x.user_id
        WHERE x.provider = 'clerk' AND x.external_id = $1`,
      [userId]
    );
    if (!mapped || mapped.status !== 'ACTIVE') return next(); // unmapped/INACTIVE → JWT path will 401

    const user: AuthUser = {
      userId: mapped.id,
      role: mapped.role,
      name: mapped.name,
      email: mapped.email,
    };
    req.user = user;
    return next();
  } catch {
    // Malformed Clerk headers must never crash a request; fall through to
    // the legacy verdict.
    return next();
  }
}
