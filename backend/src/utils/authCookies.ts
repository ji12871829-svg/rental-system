import { parse, serialize } from 'cookie';
import crypto from 'node:crypto';
import type { Response } from 'express';
import { isProd } from '../config/env';

export const SESSION_COOKIE = 'rpms_session';
export const CSRF_COOKIE = 'rpms_csrf';

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