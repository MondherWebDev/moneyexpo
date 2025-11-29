const CACHE_NAME = "meq-badges-v2";
const ASSETS = ["/manifest.json", "/MoneyExpo.jpeg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Always let navigations hit the network (middleware redirects need follow).
  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { redirect: "follow" }));
    return;
  }

  // Only cache same-origin GET requests.
  const isSameOrigin = request.url.startsWith(self.location.origin);
  if (request.method !== "GET" || !isSameOrigin) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return resp;
        })
    )
  );
});
