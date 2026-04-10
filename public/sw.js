// sw.js — Service Worker for PayMatch PWA
// Strategies:
//   - /api/rates/*  : network-first + stale cache fallback (offline-tolerant rate display)
//   - /api/*        : network-only (never cache auth / orders / admin)
//   - /admin*       : network-only
//   - Static shell  : stale-while-revalidate (instant load, background refresh)
// Bumping CACHE_VERSION on each deploy invalidates old caches via activate handler.

const CACHE_VERSION = 'bkpay-v2-2026-04-10';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/buy-usdt.html',
  '/paypay-convert.html',
  '/about.html',
  '/guide.html',
  '/features.html',
  '/manual.html',
  '/i18n.js',
  '/toast.js',
  '/floating-cta.js',
  '/style.css',
  '/buy-usdt.css',
  '/app.js',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.svg',
  '/icon-512.svg',
  '/og-image.svg',
  '/offline.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Use allSettled so one 404 doesn't break the whole install
      Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : null)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Network-first for rate data — fall back to last cached rate when offline
  if (url.pathname.startsWith('/api/rates') || url.pathname.startsWith('/api/rate/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) =>
            cached ||
            new Response(JSON.stringify({ success: false, error: 'offline', cached: false }), {
              headers: { 'Content-Type': 'application/json' }
            })
          )
        )
    );
    return;
  }

  // Never cache sensitive/dynamic endpoints
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/health')
  ) {
    return; // network-only (default browser behavior)
  }

  // Stale-while-revalidate for static shell
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((fresh) => {
          if (fresh && fresh.status === 200 && fresh.type === 'basic') {
            const copy = fresh.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return fresh;
        })
        .catch(() => cached || caches.match('/offline.html'));
      return cached || fetchPromise;
    })
  );
});

// Allow page to trigger immediate SW activation after deploy
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
