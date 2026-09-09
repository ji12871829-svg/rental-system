/*
 * Service-worker registration + lifecycle handling (production only).
 *
 *  - Registers /sw.js on first visit; the worker precaches the app shell.
 *  - When a new worker activates (new deploy), stashes a flag in sessionStorage;
 *    if that tab is hidden (user switched away), reload it so it comes back on
 *    the fresh version instead of running old code against cached data.
 *  - Foreground tab: `vite build` injects the SW version at build time; when it
 *    differs from the controlling worker's cache version, the update is applied
 *    immediately so the next navigation uses the new code.
 */
import { buildTimeSwVersion } from './swVersion';

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (!('serviceWorker' in navigator)) return;

  const applyUpdate = (worker: ServiceWorker | null) => {
    worker?.postMessage({ type: 'SKIP_WAITING' });
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // A worker is waiting (deploy happened while this tab was open)
        if (registration.waiting && navigator.serviceWorker.controller) {
          applyUpdate(registration.waiting);
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              applyUpdate(installing);
            }
          });
        });
      })
      .catch(() => {
        // Registration failures (e.g. insecure context) must never break the app
      });

    // Reload hidden tabs onto the new version once it takes control
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (sessionStorage.getItem('rpms.sw.reloaded') !== '1' && document.hidden) {
        sessionStorage.setItem('rpms.sw.reloaded', '1');
        location.reload();
      }
    });

    // Foreground-tab freshness check: compare the deployed version marker with
    // the version of the worker currently controlling this tab.
    const checkVersion = async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const worker = navigator.serviceWorker.controller;
        if (!reg || !worker) return;
        const channel = new MessageChannel();
        const reply = new Promise<string>((resolve) => {
          channel.port1.onmessage = (e) => resolve(String(e.data?.version ?? ''));
        });
        worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
        const workerVersion = await Promise.race([reply, new Promise((r) => setTimeout(() => r(''), 1500))]);
        if (workerVersion && workerVersion !== buildTimeSwVersion) {
          reg.update().catch(() => {});
        }
      } catch {
        // never let version checks break the app
      }
    };
    checkVersion();

    // A successful session clears the one-shot recovery guard below.
    const recoveryKey = 'rpms.sw.chunkRetry';
    setTimeout(() => sessionStorage.removeItem(recoveryKey), 10_000);

    // Last-resort recovery for a failed lazy-chunk load (e.g. the very first
    // visit lands mid-deploy and nothing cacheable answers): drop the worker
    // and its caches, then reload once. A persistent failure degrades to the
    // browser's error instead of a reload loop.
    const recoverFromChunkFailure = () => {
      if (sessionStorage.getItem(recoveryKey) === '1') return;
      sessionStorage.setItem(recoveryKey, '1');
      navigator.serviceWorker
        .getRegistration()
        .then(async (reg) => {
          await reg?.unregister();
          const keys = await caches.keys();
          await Promise.all(keys.filter((k) => k.startsWith('rpms-')).map((k) => caches.delete(k)));
          location.reload();
        })
        .catch(() => location.reload());
    };

    window.addEventListener(
      'error',
      (event) => {
        const src = (event.target as HTMLScriptElement | null)?.src ?? '';
        if (src.includes('/assets/')) recoverFromChunkFailure();
      },
      true,
    );
    window.addEventListener('unhandledrejection', (event) => {
      const reason = String((event as PromiseRejectionEvent).reason ?? '');
      if (/dynamically imported module|module script failed|importing a module/i.test(reason)) {
        recoverFromChunkFailure();
      }
    });
  });
}
