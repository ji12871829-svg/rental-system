// Minimal API client. Sessions use an HttpOnly cookie; only the CSRF cookie is
// readable here so unsafe requests can prove they came from this application.
// The request/retry/session-recovery engine is shared with the tenant portal
// client (lib/portalApi.ts) in lib/httpClient.ts — only the configuration
// differs (distinct CSRF cookie, refresh path, and login redirect per app).
import { createHttpClient, readCsrfToken } from './httpClient';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || '';

/**
 * Absolute URL for a backend path (CSV/PDF exports open outside the axios
 * client, so they need the full origin-prefixed path).
 */
export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

// The error envelope is the shared contract from @rpms/shared — the same
// shape backend/src/utils/httpError.ts throws and errorHandler.ts serializes;
// the shared engine parses it into Error & { code, status }.
const { request } = createHttpClient({
  baseUrl: API_URL,
  csrfCookieName: 'rpms_csrf',
  refreshPath: `${API_URL}/api/auth/refresh`,
  loginRedirect: '/login',
  isSessionLost: (status) => status === 401,
  // The login call itself must surface its real error (wrong password,
  // inactive account) instead of the generic session message.
  errorPaths: ['/api/auth/login'],
  signInFailedMessage: 'Sign in failed. Please try again.',
  sessionExpiredMessage: 'Session expired. Please sign in again.',
  // Auth paths never trigger a refresh probe or a redirect.
  sessionExemptPaths: ['/api/auth/'],
});

export interface Paged<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  /** Optional endpoint-specific aggregate metadata (e.g. SMS spend totals). */
  meta?: Record<string, unknown>;
}

export const api = {
  // request() resolves with the parsed body as-is: plain GETs arrive as the
  // { data: ... } envelope. Requiring `data` on T makes a bare T[] (or any
  // non-envelope type) a compile error, so a consumer can never type the
  // response one unwrap level off (the bug that crashed the signups feed).
  get: <T extends { data: unknown }>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  list: <T>(path: string) => request<Paged<T>>(path),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  });
  const s = search.toString();
  return s ? `?${s}` : '';
}

export async function authenticatedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const method = options.method?.toUpperCase() ?? 'GET';
  const csrfToken = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? readCsrfToken('rpms_csrf') : null;
  return fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: Object.assign(
      {},
      csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
      options.headers,
    ),
  });
}