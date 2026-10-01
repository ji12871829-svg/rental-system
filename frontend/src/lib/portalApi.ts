// Tenant portal API client — targets /api/portal with portal-specific session
// handling. The request engine is shared (lib/httpClient.ts); the portal's
// configuration differs in three ways that matter: its CSRF double-submit
// cookie is `rpms_portal_csrf` (NOT the staff app's `rpms_csrf` — sharing one
// name let each login invalidate the other app's open session), it refreshes
// and redirects through its own endpoints, and it treats 403 (CSRF mismatch
// after cookies were rotated or cleared) the same as 401: you no longer have
// a usable session.
import { createHttpClient, readCsrfToken } from './httpClient';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || '';

const { request } = createHttpClient({
  baseUrl: API_URL,
  csrfCookieName: 'rpms_portal_csrf',
  refreshPath: `${API_URL}/api/portal/refresh`,
  loginRedirect: '/portal/login',
  isSessionLost: (status, path) => status === 401 || (status === 403 && !path.startsWith('/api/portal/login')),
  // The login request itself is exempt so a wrong password shows an inline
  // error instead of redirecting.
  errorPaths: ['/api/portal/login'],
  signInFailedMessage: 'Sign in failed. Please try again.',
  sessionExpiredMessage: 'Portal session expired. Please sign in again.',
  // /me is exempt so the shell treats "not signed in" as a normal state.
  sessionExemptPaths: ['/api/portal/login', '/api/portal/me'],
  // An exempt-path 401/403 (e.g. /me while signed out) reports the parsed
  // body message, not the generic expired-session line.
  exemptUsesParsedMessage: true,
});

export const portalApi = {
  // Same envelope rule as lib/api.ts: GETs resolve with the parsed body
  // { data: ... } — requiring `data` on T keeps consumers unwrap-proof.
  get: <T extends { data: unknown }>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
};

export async function portalStatementDownload(): Promise<void> {
  const csrfToken = readCsrfToken('rpms_portal_csrf');
  const res = await fetch(`${API_URL}/api/portal/statement.pdf`, {
    credentials: 'include',
    headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : undefined,
  });
  if (!res.ok) throw new Error(`Statement download failed (${res.status}).`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'my-statement.pdf';
  a.click();
  URL.revokeObjectURL(a.href);
}
