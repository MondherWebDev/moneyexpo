self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("meq-badges-v1").then((cache) =>
      cache.addAll(["/", "/manifest.json", "/MoneyExpo.jpeg"])
    )
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((resp) => resp || fetch(event.request))
  );
});
