// Minimal API client. Sessions use an HttpOnly cookie; only the CSRF cookie is
// readable here so unsafe requests can prove they came from this application.
// The request/retry/session-recovery engine is shared with the tenant portal
// client (lib/portalApi.ts) in lib/httpClient.ts — only the configuration
// differs (distinct CSRF cookie, refresh path, and login redirect per app).
import { createHttpClient, readCsrfToken } from './httpClient';
import type { ApiItemResponse, ApiListResponse } from '@rpms/shared';

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
// the shared engine parses it into Error & { code, status }. The success
// envelope (ApiItemResponse) is from the same package: one contract for both
// halves of the wire.
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

/**
 * Paginated list envelope — the shared ApiListResponse contract (one source
 * of truth for both halves of the wire; the type alias keeps call sites
 * readable). request() resolves with the parsed body as-is, so api.list<T>
 * hands consumers { data, pagination } and they read `.data`.
 */
export type Paged<T> = ApiListResponse<T>;

export const api = {
  // request() resolves with the parsed body as-is: every endpoint answers
  // the shared { data: ... } envelope (ApiItemResponse from @rpms/shared).
  // Requiring `data` on T makes a bare T[] (or any non-envelope type) a
  // compile error, so a consumer can never type the response one unwrap
  // level off (the bug that crashed the signups feed). Consumers that
  // ignore the body (fire-and-forget writes, 204 deletions) omit T and get
  // the { data: unknown } default.
  get: <T extends ApiItemResponse<unknown>>(path: string) => request<T>(path),
  post: <T extends ApiItemResponse<unknown>>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T extends ApiItemResponse<unknown>>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T extends ApiItemResponse<unknown>>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
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

// Compile-time regression guard for the envelope constraint above: every
// verb requires T to carry `data`. The negative cases MUST fail to compile
// (loosening the generic turns these into "unused @ts-expect-error" errors);
// the positive cases keep the guard honest if the constraint is ever
// over-tightened. Never called or exported — types only, no runtime effect;
// the void reference below keeps noUnusedLocals quiet.
function _envelopeTypeGuard() {
  type Ok = { data: { id: number } };
  const a: ReturnType<typeof api.get<Ok>> = api.get<Ok>('/x');
  const b: ReturnType<typeof api.post<Ok>> = api.post<Ok>('/x');
  const c: ReturnType<typeof api.put<Ok>> = api.put<Ok>('/x');
  const d: ReturnType<typeof api.del<Ok>> = api.del<Ok>('/x');
  const e: ReturnType<typeof api.get> = api.get('/x');
  const f: ReturnType<typeof api.post> = api.post('/x');
  void [a, b, c, d, e, f];
  // @ts-expect-error — bare arrays are the unwrap bug: T must carry `data`.
  api.get<string[]>('/x');
  // @ts-expect-error — same for writes: { user } at top level is not an envelope.
  api.post<{ user: unknown }>('/x', {});
  // @ts-expect-error — and deletes: no `data` key, not an envelope.
  api.del<{ ok: boolean }>('/x');
}
void _envelopeTypeGuard;

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