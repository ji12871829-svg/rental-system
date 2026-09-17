import { parse, serialize } from 'cookie';
import crypto from 'node:crypto';
import type { Response } from 'express';
import { isProd } from '../config/env';

export const SESSION_COOKIE = 'rpms_session';
export const CSRF_COOKIE = 'rpms_csrf';
// Tenant portal session — a different cookie from the staff session so both
// can coexist in one browser (e.g. an owner checking the portal) without
// either login clobbering the other.
export const PORTAL_COOKIE = 'rpms_portal_session';
// The portal pairs with its OWN csrf cookie. Sharing rpms_csrf across both
// apps meant each login rotated the token out from under the other app's
// open session — the staff app would then 403 every portal POST (and vice
// versa) until re-login.
export const PORTAL_CSRF_COOKIE = 'rpms_portal_csrf';

const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/',
};

export function readCookies(header: string | undefined): Record<string, string> {
  return header ? parse(header) : {};
}

export function setAuthCookies(res: Response, token: string): void {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.setHeader('Set-Cookie', [
    serialize(SESSION_COOKIE, token, { ...cookieOptions, maxAge: 8 * 60 * 60 }),
    serialize(CSRF_COOKIE, csrfToken, {
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60,
    }),
  ]);
}

export function clearAuthCookies(res: Response): void {
  res.setHeader('Set-Cookie', [
    serialize(SESSION_COOKIE, '', { ...cookieOptions, maxAge: 0 }),
    serialize(CSRF_COOKIE, '', { secure: isProd, sameSite: 'lax', path: '/', maxAge: 0 }),
  ]);
}

export function setPortalCookies(res: Response, token: string): void {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.setHeader('Set-Cookie', [
    serialize(PORTAL_COOKIE, token, { ...cookieOptions, maxAge: 8 * 60 * 60 }),
    serialize(PORTAL_CSRF_COOKIE, csrfToken, {
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60,
    }),
  ]);
}

export function clearPortalCookies(res: Response): void {
  res.setHeader('Set-Cookie', [
    serialize(PORTAL_COOKIE, '', { ...cookieOptions, maxAge: 0 }),
    serialize(PORTAL_CSRF_COOKIE, '', { secure: isProd, sameSite: 'lax', path: '/', maxAge: 0 }),
  ]);
}