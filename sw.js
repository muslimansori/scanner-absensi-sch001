const CACHE_NAME = "goschool-scanner-shell-v1";

const API_HOST_SUFFIX = ".workers.dev";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      ),
    ])
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};

  if (data.type !== "CACHE_URLS" || !Array.isArray(data.urls)) {
    return;
  }

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      for (const url of data.urls) {
        try {
          const response = await fetch(url, { cache: "reload" });

          if (response && (response.ok || response.type === "opaque")) {
            await cache.put(url, response.clone());
          }
        } catch (err) {
          // Best effort. Fetch handler will cache on future successful loads.
        }
      }
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Never cache backend health/API responses.
  if (url.hostname.endsWith(API_HOST_SUFFIX)) {
    event.respondWith(fetch(request));
    return;
  }

  const cacheable =
    url.origin === self.location.origin ||
    url.hostname === "unpkg.com";

  if (!cacheable) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreSearch: false });

      if (cached) {
        // Refresh cache in background when online.
        event.waitUntil(
          fetch(request)
            .then((response) => {
              if (response && (response.ok || response.type === "opaque")) {
                return cache.put(request, response.clone());
              }
            })
            .catch(() => {})
        );

        return cached;
      }

      try {
        const response = await fetch(request);

        if (response && (response.ok || response.type === "opaque")) {
          await cache.put(request, response.clone());
        }

        return response;
      } catch (err) {
        // For navigation, try any cached copy of the same path without query.
        if (request.mode === "navigate") {
          const fallback =
            await cache.match(url.origin + url.pathname);

          if (fallback) {
            return fallback;
          }
        }

        throw err;
      }
    })()
  );
});
