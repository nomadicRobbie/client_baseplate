const CACHE = 'blnk-shell-v1';

// On install, cache nothing explicitly — let the browser cache pages as visited.
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Clear old cache versions.
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Let API and cross-origin requests go straight to the network.
  if (url.origin !== location.origin) return;
  if (request.method !== 'GET') return;

  // Navigation requests: serve cached shell if offline, otherwise network.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('/') ?? fetch(request))
    );
    return;
  }

  // Static assets: cache-first.
  e.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
    )
  );
});
