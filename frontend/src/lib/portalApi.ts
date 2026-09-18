// Tenant portal API client — mirrors lib/api.ts but targets /api/portal with
// portal-specific session handling: an expired tenant session redirects to
// the portal login (never the staff login), and the portal cookie is what
// authenticates, with the CSRF double-submit cookie for unsafe methods.

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || '';

interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

function getCsrfToken(): string | null {
  // The portal pairs with its own csrf cookie (rpms_portal_csrf), NOT the
  // staff app's rpms_csrf — sharing one name let each login invalidate the
  // other app's open session.
  const cookie = document.cookie.split('; ').find((entry) => entry.startsWith('rpms_portal_csrf='));
  return cookie ? decodeURIComponent(cookie.slice('rpms_portal_csrf='.length)) : null;
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
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(options.headers ?? {}),
    },
  });

  // Parse error bodies once, up front.
  let body: ApiError | undefined;
  if (!res.ok) {
    try {
      body = (await res.json()) as ApiError;
    } catch {
      // non-JSON error body
    }
  }

  // 401 (stale/missing session) and 403 (CSRF mismatch after cookies were
  // rotated or cleared) both mean "you no longer have a usable session" —
  // bounce to the portal login. The login request itself is exempt so a
  // wrong password shows an inline error instead of redirecting, and /me is
  // exempt so the shell treats "not signed in" as a normal state.
  if (
    res.status === 401 ||
    (res.status === 403 && !path.startsWith('/api/portal/login'))
  ) {
    if (!retried && !path.startsWith('/api/portal/login') && !path.startsWith('/api/portal/me')) {
      const refreshed = await fetch(`${API_URL}/api/portal/refresh`, {
        method: 'POST',
        credentials: 'include',
      }).then((response) => response.ok).catch(() => false);
      if (refreshed) return requestWithRetry<T>(path, options, true);
    }
    if (!path.startsWith('/api/portal/login') && !path.startsWith('/api/portal/me')) {
      window.location.href = '/portal/login';
      throw new Error('Portal session expired. Please sign in again.');
    }
    throw new Error(body?.message ?? 'Sign in failed. Please try again.');
  }

  if (!res.ok) {
    const err = new Error(body?.message ?? `Request failed (${res.status}).`) as Error & { code?: string; status: number };
    (err as { code?: string }).code = body?.error;
    (err as { status: number }).status = res.status;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const portalApi = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
};

export async function portalStatementDownload(): Promise<void> {
  const csrfToken = getCsrfToken();
  const res = await fetch(`${API_URL}/api/portal/statement.pdf`, {
    credentials: 'include',
    headers: { ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
  });
  if (!res.ok) throw new Error(`Statement download failed (${res.status}).`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'my-statement.pdf';
  a.click();
  URL.revokeObjectURL(a.href);
}
