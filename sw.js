/* ═══════════════════════════════════════════════════════════════════
   FootyStats Analyser — Service Worker
   Strategy: Cache-First with network fallback
   ═══════════════════════════════════════════════════════════════════ */

const CACHE_NAME = "footystats-v7";

// Files to pre-cache on install (the complete runtime app shell)
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./data.js",
  "./fixtures.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()), // activate immediately
  );
});

// ── Activate: clean up old versioned caches ───────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()), // take control of existing clients
  );
});

// ── Fetch: cache-first, network fallback ─────────────────────────────────────
self.addEventListener("fetch", (event) => {
  // Only handle GET requests to same origin (or relative)
  if (event.request.method !== "GET") return;

  // Let cross-origin requests (e.g. Google Fonts) pass through untouched
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Serve from cache immediately; refresh in background for next visit
        const networkFetch = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches
                .open(CACHE_NAME)
                .then((cache) =>
                  cache.put(event.request, networkResponse.clone()),
                );
            }
            return networkResponse;
          })
          .catch(() => {
            /* offline — cached version already returned above */
          });

        // Return cached immediately (stale-while-revalidate)
        void networkFetch;
        return cachedResponse;
      }

      // Not in cache — fetch from network and cache for next time
      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, responseToCache));
          return networkResponse;
        })
        .catch(() => {
          // Offline and not cached — nothing we can do for this resource
        });
    }),
  );
});
