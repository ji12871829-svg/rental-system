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

let installedStaff = false;
let installedPortal = false;

const RENEW_INTERVAL_MS = 30 * 60 * 1000;

function scheduleStaff(): void {
  const run = () => {
    void fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined);
  };
  run();
  window.setInterval(() => {
    if (document.visibilityState === 'visible') run();
  }, RENEW_INTERVAL_MS);
}

function schedulePortal(): void {
  const run = () => {
    void fetch('/api/portal/refresh', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined);
  };
  run();
  window.setInterval(() => {
    if (document.visibilityState === 'visible') run();
  }, RENEW_INTERVAL_MS);
}

export function installStaffKeepalive(): void {
  if (installedStaff) return;
  installedStaff = true;
  scheduleStaff();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).catch(() => undefined);
    }
  });
}

export function installPortalKeepalive(): void {
  if (installedPortal) return;
  installedPortal = true;
  schedulePortal();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void fetch('/api/portal/refresh', { method: 'POST', credentials: 'include' }).catch(() => undefined);
    }
  });
}
