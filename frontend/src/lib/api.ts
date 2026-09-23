// Minimal API client. Sessions use an HttpOnly cookie; only the CSRF cookie is
// readable here so unsafe requests can prove they came from this application.

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || '';

/**
 * Absolute URL for a backend path (CSV/PDF exports open outside the axios
 * client, so they need the full origin-prefixed path).
 */
import type { ApiErrorBody } from '@rpms/shared';

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

// The error envelope is the shared contract from @rpms/shared — the same
// shape backend/src/utils/httpError.ts throws and errorHandler.ts serializes.
type ApiError = ApiErrorBody;

function getCsrfToken(): string | null {
  const cookie = document.cookie.split('; ').find((entry) => entry.startsWith('rpms_csrf='));
  return cookie ? decodeURIComponent(cookie.slice('rpms_csrf='.length)) : null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestWithRetry<T>(path, options, false);
}

async function requestWithRetry<T>(path: string, options: RequestInit, retried: boolean): Promise<T> {
  const method = options.method?.toUpperCase() ?? 'GET';
  const csrfToken = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? getCsrfToken() : null;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
      options.headers,
    ),
  });

  if (res.status === 401) {
    // The login call itself must surface its real error (wrong password,
    // inactive account) instead of the generic session message.
    if (path.startsWith('/api/auth/login')) {
      let body: ApiError | undefined;
      try {
        body = (await res.json()) as ApiError;
      } catch {
        // non-JSON error body
      }
      throw new Error(body?.message ?? 'Sign in failed. Please try again.');
    }
    if (!retried && !path.startsWith('/api/auth/')) {
      const refreshed = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      }).then((response) => response.ok).catch(() => false);
      if (refreshed) return requestWithRetry<T>(path, options, true);
    }
    if (!path.startsWith('/api/auth/')) {
      window.location.href = '/login';
    }
    throw new Error('Session expired. Please sign in again.');
  }

  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      // non-JSON error body
    }
    const err = new Error(body?.message ?? `Request failed (${res.status}).`) as Error & { code?: string; status: number };
    (err as { code?: string }).code = body?.error;
    (err as { status: number }).status = res.status;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Paged<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  /** Optional endpoint-specific aggregate metadata (e.g. SMS spend totals). */
  meta?: Record<string, unknown>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
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
  const csrfToken = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? getCsrfToken() : null;
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