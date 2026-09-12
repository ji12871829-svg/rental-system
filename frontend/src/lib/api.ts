// Minimal API client. The JWT is stored in localStorage (standard SPA pattern;
// it is NOT httpOnly, so keep the app free of XSS sinks). On 401 the session
// is cleared and the user is sent to the login page.

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || '';

interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

const TOKEN_KEY = 'rpms_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401) {
    setToken(null);
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