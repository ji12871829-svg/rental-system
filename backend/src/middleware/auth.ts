import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../config/db';

// A DB round-trip per request just to re-check user status is the single
// biggest fixed cost on a remote database (every API call paid it). A short
// TTL cache keeps the security property that matters — an INACTIVE or deleted
// user loses access within CACHE_TTL_MS instead of instantly — while making
// the common case a Map lookup. Admin writes (updateUser/deleteUser) call
// invalidateUserCache so role/status changes apply immediately.
const CACHE_TTL_MS = 30_000;

interface CachedUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: string;
  expiresAt: number;
}

const userCache = new Map<number, CachedUser>();
const inFlight = new Map<number, Promise<CachedUser | null>>();

async function loadUser(id: number): Promise<CachedUser | null> {
  const user = await queryOne<{ id: number; name: string; email: string; role: Role; status: string }>(
    'SELECT id, name, email, role, status FROM users WHERE id = $1',
    [id]
  );
  if (!user || user.status !== 'ACTIVE') return null;
  return { ...user, expiresAt: Date.now() + CACHE_TTL_MS };
}

// Concurrent requests from the same user share one load instead of stampeding
// the database with identical queries.
function getUserCached(id: number): Promise<CachedUser | null> {
  const hit = userCache.get(id);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit);
  userCache.delete(id);
  let pending = inFlight.get(id);
  if (!pending) {
    pending = loadUser(id)
      .then((user) => {
        if (user) userCache.set(id, user);
        return user;
      })
      .finally(() => inFlight.delete(id));
    inFlight.set(id, pending);
  }
  return pending;
}

// Drop one user (admin changed/deleted them) or the whole cache (JWT_SECRET
// rotation invalidates everything anyway). Exported for userService.
export function invalidateUserCache(id?: number): void {
  if (id === undefined) userCache.clear();
  else userCache.delete(id);
}
import { env } from '../config/env';
import type { AuthUser, Role } from '../types';
import { forbidden, unauthorized } from '../utils/httpError';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface TokenPayload {
  sub: number;
  role: Role;
  name: string;
  email: string;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return next(unauthorized('Missing or malformed session.'));
    }

    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, env.jwtSecret) as unknown as TokenPayload;
    } catch {
      return next(unauthorized('Invalid or expired session.'));
    }

    // Cached re-validation (see note above): an INACTIVE or deleted user is
    // refused within CACHE_TTL_MS; admin writes invalidate immediately.
    const user = await getUserCached(payload.sub);
    if (!user) {
      return next(unauthorized('Account is no longer active.'));
    }

    req.user = { userId: user.id, role: user.role, name: user.name, email: user.email };
    return next();
  } catch (err) {
    return next(err);
  }
}

// requireRoles('ADMIN') or requireRoles('ADMIN', 'PROPERTY_MANAGER')
export function requireRoles(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`This action requires the ${roles.join(' or ')} role.`));
    }
    return next();
  };
}

export const adminOnly = requireRoles('ADMIN');
export const managerOrAdmin = requireRoles('ADMIN', 'PROPERTY_MANAGER');