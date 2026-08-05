// blnk PWA service worker — deliberately conservative.
//
// Network-first: every request goes to the network first, and the cache is
// only a fallback for offline. This avoids the classic PWA footgun where an
// over-eager cache pins users to a stale build. Bump CACHE to force a refresh.
//
// Only same-origin GETs are handled. The blnk API lives on another origin, so
// authed tenant data never lands in CacheStorage.

const CACHE = 'blnk-v1';
const SHELL = '/';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // leave API/cross-origin alone

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match(SHELL)))
  );
});
