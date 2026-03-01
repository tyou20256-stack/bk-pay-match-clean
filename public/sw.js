const CACHE_NAME = 'bkpay-v1';
const STATIC_ASSETS = [
  '/',
  '/pay.html',
  '/miniapp.html',
  '/mypage.html',
  '/guide.html',
  '/style.css',
  '/app.js',
  '/i18n.js',
  '/offline.html'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => 
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() => 
        new Response(JSON.stringify({success: false, error: 'オフライン'}), 
          {headers: {'Content-Type': 'application/json'}})
      )
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('/offline.html')))
    );
  }
});
