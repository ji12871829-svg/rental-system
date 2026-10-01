// Tenant portal API client — targets /api/portal with portal-specific session
// handling. The request engine is shared (lib/httpClient.ts); the portal's
// configuration differs in three ways that matter: its CSRF double-submit
// cookie is `rpms_portal_csrf` (NOT the staff app's `rpms_csrf` — sharing one
// name let each login invalidate the other app's open session), it refreshes
// and redirects through its own endpoints, and it treats 403 (CSRF mismatch
// after cookies were rotated or cleared) the same as 401: you no longer have
// a usable session.
import { createHttpClient, readCsrfToken } from './httpClient';
import type { ApiItemResponse } from '@rpms/shared';

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
  // Same envelope rule as lib/api.ts: every endpoint resolves with the
  // parsed body { data: ... } (ApiItemResponse from @rpms/shared) —
  // requiring `data` on T keeps consumers unwrap-proof. Fire-and-forget
  // calls omit T and get the { data: unknown } default.
  get: <T extends ApiItemResponse<unknown>>(path: string) => request<T>(path),
  post: <T extends ApiItemResponse<unknown>>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
};

// Compile-time regression guard for the envelope constraint (see lib/api.ts).
// The negative case must fail to compile; never called or exported — types
// only; the void reference keeps noUnusedLocals quiet.
function _envelopeTypeGuard() {
  type Ok = { data: { id: number } };
  const a: ReturnType<typeof portalApi.get<Ok>> = portalApi.get<Ok>('/x');
  const b: ReturnType<typeof portalApi.post<Ok>> = portalApi.post<Ok>('/x', {});
  void [a, b];
  // @ts-expect-error — no `data` key, not an envelope.
  portalApi.get<{ summary: string }>('/x');
}
void _envelopeTypeGuard;

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
