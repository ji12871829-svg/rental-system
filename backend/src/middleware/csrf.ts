import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE, SESSION_COOKIE, readCookies } from '../utils/authCookies';
import { forbidden } from '../utils/httpError';

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (!unsafeMethods.has(req.method) || isPublicCallback(req.path)) return next();

  const cookies = readCookies(req.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE];
  if (!sessionToken) return next();

  const csrfCookie = cookies[CSRF_COOKIE];
  const csrfHeader = req.header('x-csrf-token');
  if (!csrfCookie || !csrfHeader || !safeEqual(csrfCookie, csrfHeader)) {
    return next(forbidden('Missing or invalid CSRF token.'));
  }
  return next();
}

function isPublicCallback(path: string): boolean {
  return path === '/api/auth/login'
    || path.startsWith('/api/mpesa/')
    || path === '/api/sms/delivery-reports';
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}