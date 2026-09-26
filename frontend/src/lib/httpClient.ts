// The request engine shared by the staff client (lib/api.ts) and the tenant
// portal client (lib/portalApi.ts). The two apps differ only in configuration:
//
//   * CSRF cookie  — staff pairs with `rpms_csrf`, the portal with
//     `rpms_portal_csrf`. Sharing one name let each login invalidate the other
//     app's open session, so the cookies must stay distinct.
//   * Refresh path — each app refreshes its own session cookie.
//   * Redirect     — an expired staff session goes to /login, an expired
//     portal session to /portal/login. Never cross the streams.
//   * Session-lost — staff treats only 401 as "session unusable"; the portal
//     also treats 403 as lost (a CSRF mismatch after cookies were rotated or
//     cleared means the session can't act), except on the login request
//     itself, whose 403 must surface as a normal failed request.
//   * Exemptions   — the login requests (and the portal's /me, which the
//     shell treats as "not signed in" rather than a failure) must surface
//     their real error instead of redirecting; auth paths never trigger a
//     refresh probe or a redirect.
//
// Every fetch sends credentials (HttpOnly session cookie) and the CSRF
// double-submit header on unsafe methods. Error bodies are parsed once and
// rethrown as `Error & { code, status }` per the shared @rpms/shared
// ApiErrorBody envelope the backend serializes.
import type { ApiErrorBody } from '@rpms/shared';

type ApiError = ApiErrorBody;

const CSRF_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export interface HttpApiConfig {
  /** Origin prefix for every request ('' when the frontend is same-origin). */
  baseUrl: string;
  csrfCookieName: string;
  refreshPath: string;
  loginRedirect: string;
  /** True when this response means "the session is unusable" and recovery should run. */
  isSessionLost: (status: number, path: string) => boolean;
  /** Session-lost responses on these paths surface their own error instead of recovering. */
  errorPaths: string[];
  /** Fallback message for a session-lost response on an errorPath (no/blank body message). */
  signInFailedMessage: string;
  /** Message thrown after recovery failed (optionally after redirecting). */
  sessionExpiredMessage: string;
  /** Paths that never trigger the refresh probe nor the login redirect. */
  sessionExemptPaths: string[];
  /** When true, an exempt-path session-lost error carries the parsed body message (portal /me); otherwise the literal sessionExpiredMessage (staff auth paths). */
  exemptUsesParsedMessage?: boolean;
}

export function readCsrfToken(cookieName: string): string | null {
  const cookie = document.cookie.split('; ').find((entry) => entry.startsWith(`${cookieName}=`));
  return cookie ? decodeURIComponent(cookie.slice(cookieName.length + 1)) : null;
}

function parseErrorBody(res: Response): Promise<ApiError | undefined> {
  return res
    .json()
    .then((body) => body as ApiError)
    .catch(() => undefined); // non-JSON error body
}

function requestFailedError(res: Response, body?: ApiError): Error & { code?: string; status: number } {
  const err = new Error(body?.message ?? `Request failed (${res.status}).`) as Error & { code?: string; status: number };
  err.code = body?.error;
  err.status = res.status;
  return err;
}

export function createHttpClient(config: HttpApiConfig) {
  const startsWithAny = (path: string, prefixes: string[]) => prefixes.some((p) => path.startsWith(p));

  async function requestWithRetry<T>(path: string, options: RequestInit, retried: boolean): Promise<T> {
    const method = options.method?.toUpperCase() ?? 'GET';
    const csrfToken = CSRF_METHODS.includes(method) ? readCsrfToken(config.csrfCookieName) : null;
    const res = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      credentials: 'include',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
        options.headers,
      ),
    });

    if (config.isSessionLost(res.status, path)) {
      // The login call itself must surface its real error (wrong password,
      // inactive account) instead of the generic session message.
      if (startsWithAny(path, config.errorPaths)) {
        const body = await parseErrorBody(res);
        throw new Error(body?.message ?? config.signInFailedMessage);
      }
      const exempt = startsWithAny(path, config.sessionExemptPaths);
      if (!retried && !exempt) {
        const refreshed = await fetch(config.refreshPath, {
          method: 'POST',
          credentials: 'include',
        }).then((response) => response.ok).catch(() => false);
        if (refreshed) return requestWithRetry<T>(path, options, true);
      }
      if (!exempt) {
        window.location.href = config.loginRedirect;
      }
      if (exempt && config.exemptUsesParsedMessage) {
        const body = await parseErrorBody(res);
        throw new Error(body?.message ?? config.signInFailedMessage);
      }
      throw new Error(config.sessionExpiredMessage);
    }

    if (!res.ok) {
      const body = await parseErrorBody(res);
      throw requestFailedError(res, body);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    return requestWithRetry<T>(path, options, false);
  }

  return { request };
}
