import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  CSRF_COOKIE,
  PORTAL_COOKIE,
  PORTAL_CSRF_COOKIE,
  SESSION_COOKIE,
  readCookies,
} from '../utils/authCookies';
import { forbidden } from '../utils/httpError';

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (!unsafeMethods.has(req.method) || isPublicCallback(req.path)) return next();

  const cookies = readCookies(req.headers.cookie);
  // Staff and tenant-portal sessions each pair with their OWN csrf cookie —
  // sharing one used to let whichever app logged in last invalidate the
  // other's token, breaking the first app's every subsequent POST.
  //
  // Both session cookies ride along on every request (cookies are scoped to
  // the origin, not the app), and the caller attaches the header for ITS
  // session. So accept the request when the header matches the csrf cookie
  // of ANY session the browser legitimately holds; a cross-site attacker
  // can neither read these cookies nor set the custom header, so double
  // submit still holds for both apps at once.
  const pairs = [
    { session: cookies[SESSION_COOKIE], csrf: cookies[CSRF_COOKIE] },
    { session: cookies[PORTAL_COOKIE], csrf: cookies[PORTAL_CSRF_COOKIE] },
  ];
  if (pairs.every((p) => !p.session)) return next();

  const csrfHeader = req.header('x-csrf-token');
  const matched = pairs.some(
    (p) => p.session && p.csrf && csrfHeader && safeEqual(p.csrf, csrfHeader),
  );
  if (!matched) {
    return next(forbidden('Missing or invalid CSRF token.'));
  }
  return next();
}

function isPublicCallback(path: string): boolean {
  // Login endpoints mint the session (and set the csrf cookie) — they cannot
  // require a token that only exists after a session. Logout is exempt so a
  // session can always be cleaned up, even one whose csrf half went missing
  // (a config change, say); a CSRF-forced logout is a nuisance, not a
  // vulnerability — there is nothing to gain. Same for provider callbacks,
  // which authenticate by their own signature/params.
  return path === '/api/auth/login'
    || path === '/api/portal/login'
    || path === '/api/auth/register'
    || path === '/api/portal/register'
    || path === '/api/auth/refresh'
    || path === '/api/portal/refresh'
    || path === '/api/auth/logout'
    || path === '/api/portal/logout'
    // Clerk → staff-session bridge: the caller authenticates with Clerk's own
    // HttpOnly session cookies (verified server-side in the route), the same
    // class as login — it mints the first session, so it cannot require one.
    || path === '/api/auth/clerk/session'
    || path.startsWith('/api/mpesa/')
    || path === '/api/sms/delivery-reports'
    // Public landing-page demo form: same class as login — session-less
    // first contact, throttled by its own rate limiter, nothing to forge.
    || path === '/api/public/demo-requests';
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}