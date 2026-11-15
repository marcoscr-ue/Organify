const CACHE_PREFIX = "organify-shell-";
const CACHE = CACHE_PREFIX + "__BUILD_ID__";
const FILES = JSON.parse("__BUILD_FILES__");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (
    request.mode === "navigate" &&
    url.pathname === new URL(self.registration.scope).pathname
  ) {
    event.respondWith(
      caches
        .open(CACHE)
        .then(
          async (cache) =>
            (await cache.match("./index.html")) ?? fetch(request),
        ),
    );
  } else if (
    FILES.some(
      (file) => new URL(file, self.registration.scope).href === url.href,
    )
  ) {
    event.respondWith(
      caches
        .open(CACHE)
        .then(async (cache) => (await cache.match(request)) ?? fetch(request)),
    );
  }
});
