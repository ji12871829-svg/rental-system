import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../config/db';
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

    // Re-validate against the DB on every request: an INACTIVE user (or a
    // deleted one) loses access immediately.
    const user = await queryOne<{ id: number; name: string; email: string; role: Role; status: string }>(
      'SELECT id, name, email, role, status FROM users WHERE id = $1',
      [payload.sub]
    );
    if (!user || user.status !== 'ACTIVE') {
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