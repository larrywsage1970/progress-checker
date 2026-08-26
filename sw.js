// Progress Checker service worker.
// App shell: network-first (falls back to cache only if offline), so a new
// deploy is picked up on the very next load instead of serving a stale bundle
// indefinitely. CDN modules (esm.sh) rarely change once pinned, so those stay
// cache-first / opportunistically cached for offline use.
// Keep in sync with the ?v= query on app.js in index.html.
const CACHE = "progress-checker-v3";
const SHELL = [
  "./",
  "./index.html",
  "./app.js?v=3",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const isSameOrigin = new URL(req.url).origin === self.location.origin;

  if (isSameOrigin) {
    // App shell + data/grades.json: network-first so updates and fresh
    // grade data always show up next load.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // CDN modules (esm.sh): cache-first, opportunistically cached on first load.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      });
    })
  );
});
