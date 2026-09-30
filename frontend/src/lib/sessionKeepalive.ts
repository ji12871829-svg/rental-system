// Session keepalive — makes "Session expired" a thing of the past for
// anyone actively using the app.
//
// Sessions are 8h JWT leases in cookies. Instead of a surprise bounce at the
// deadline, this module renews the lease while the app is in use:
//   * a timer renews every 30 min while the tab is visible;
//   * visibilitychange renews immediately when a user returns to a tab that
//     was backgrounded (the classic "came back tomorrow, got bounced" case is
//     also caught because the renewal still lands inside the 24h grace);
//   * nothing runs while the tab is hidden, and the timer pauses on
//     visibility — no churn in the background.
// Both staff and portal apps install it with their own refresh endpoint; each
// refresh mints a fresh cookie and nothing else about the session changes.
//
// Uninstall symmetry: logout() must stop the keepalive, because after the
// session cookie is gone every renewal 401s — and a 401 triggers the http
// client's hard redirect to the login page, reloading the form out from
// under the user (the "stuck in /portal/login" bug). Each install returns
// nothing; uninstall is by name.

type Refresher = () => void;

interface KeepaliveHandle {
  intervalId: number;
  onVisible: () => void;
}

const RENEW_INTERVAL_MS = 30 * 60 * 1000;

function startRenewing(
  refreshUrl: string,
  refresher: Refresher,
  setHandle: (h: KeepaliveHandle) => void,
): void {
  const run = () => {
    void fetch(refreshUrl, { method: 'POST', credentials: 'include' }).catch(() => undefined);
  };
  run();
  const intervalId = window.setInterval(() => {
    if (document.visibilityState === 'visible') run();
  }, RENEW_INTERVAL_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') refresher();
  };
  document.addEventListener('visibilitychange', onVisible);
  setHandle({ intervalId, onVisible });
}

function stopRenewing(handle: KeepaliveHandle | null): void {
  if (!handle) return;
  window.clearInterval(handle.intervalId);
  document.removeEventListener('visibilitychange', handle.onVisible);
}

let staffHandle: KeepaliveHandle | null = null;
let portalHandle: KeepaliveHandle | null = null;

export function installStaffKeepalive(): void {
  if (staffHandle) return;
  startRenewing('/api/auth/refresh', () => {
    void fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).catch(() => undefined);
  }, (h) => { staffHandle = h; });
}

export function uninstallStaffKeepalive(): void {
  stopRenewing(staffHandle);
  staffHandle = null;
}

export function installPortalKeepalive(): void {
  if (portalHandle) return;
  startRenewing('/api/portal/refresh', () => {
    void fetch('/api/portal/refresh', { method: 'POST', credentials: 'include' }).catch(() => undefined);
  }, (h) => { portalHandle = h; });
}

export function uninstallPortalKeepalive(): void {
  stopRenewing(portalHandle);
  portalHandle = null;
}
