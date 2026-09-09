/*
 * RPMS service worker — installability + offline support.
 *
 * Strategies (same-origin GET only; every other request passes through
 * untouched so mutations always hit the real API):
 *  - Navigations (SPA routes): network-first, cached index.html offline —
 *    the app shell always loads, even with no connection.
 *  - /api/*: network-first, successful GETs cached (capped) so recently
 *    viewed data stays readable offline.
 *  - /assets/* + public files: cache-first (hashed filenames are immutable;
 *    also keeps old chunks alive across deploys, preventing 404 reload traps).
 *
 * Bump VERSION on each deploy: it names the cache generations (old asset
 * generations are kept briefly so open tabs survive the update) and acts as
 * the build-time marker the app compares to detect "a newer deploy exists".
 */
const VERSION = 'v2';
const SHELL_CACHE = `rpms-shell-${VERSION}`;
const ASSET_CACHE = `rpms-assets-${VERSION}`;
const API_CACHE = `rpms-api-${VERSION}`;
const API_CACHE_LIMIT = 60;
// Old asset-cache generations are kept (newest N) so tabs still running the
// previous deploy keep resolving their already-referenced chunks after an
// update takes over — without this, an open old tab would 404 on any route
// whose chunk it had not loaded yet.
const ASSET_GENERATIONS_KEPT = 2;

const SHELL_ASSETS = [
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-192.png',
  '/pwa-512.png',
  '/pwa-maskable-192.png',
  '/pwa-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // allSettled: one flaky file must not break the whole install
      await Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(new Request(asset, { cache: 'reload' }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const numeric = (name) => Number(/v(\d+)$/.exec(name)?.[1] ?? 0);
      const assetGens = keys.filter((k) => k.startsWith('rpms-assets-')).sort((a, b) => numeric(b) - numeric(a));
      const stale = keys.filter(
        (k) =>
          (k.startsWith('rpms-shell-') && k !== SHELL_CACHE) ||
          (k.startsWith('rpms-api-') && k !== API_CACHE) ||
          (k.startsWith('rpms-assets-') && !assetGens.slice(0, ASSET_GENERATIONS_KEPT).includes(k)),
      );
      await Promise.all(stale.map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

/** Keep a cache bounded (FIFO). */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') {
    const payload = { version: VERSION };
    if (event.ports[0]) event.ports[0].postMessage(payload);
    else event.source?.postMessage(payload);
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // mutations bypass the worker entirely

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // --- SPA navigations: fresh index when online, cached shell offline ------
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/index.html', fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
        }
      })(),
    );
    return;
  }

  // --- API reads: network-first, capped cache for offline review -----------
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE);
        try {
          const fresh = await fetch(request);
          if (fresh.status === 200) {
            cache.put(request, fresh.clone());
            trimCache(API_CACHE, API_CACHE_LIMIT);
            return fresh;
          }
          // Server unreachable/broken (5xx): stale data beats an error screen.
          // Mutations bypass the worker entirely (non-GET), so this can never
          // mask a failed write.
          if (fresh.status >= 500) {
            const cached = await cache.match(request);
            if (cached) return cached;
          }
          return fresh;
        } catch {
          return (await cache.match(request)) || Response.error();
        }
      })(),
    );
    return;
  }

  // --- Everything else (hashed assets, icons, manifest): cache-first -------
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(ASSET_CACHE);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch {
        return Response.error();
      }
    })(),
  );
});
