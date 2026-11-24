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

self.addEventListener("message", (event) => {
  if (event.data?.type === "organify:skip-waiting") void self.skipWaiting();
});

const REMINDER_TITLE = "Organify";
const REMINDER_BODY = "Tienes una tarea pendiente.";
const DELIVERED_CACHE = "organify-push-delivered";

function readPush(event) {
  try {
    const data = event.data?.json();
    if (data?.v === 1 && typeof data.reminder === "string")
      return data.reminder;
  } catch {
    // Mensaje sin formato conocido: se muestra el aviso genérico.
  }
  return undefined;
}

async function windowClients() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true });
}

self.addEventListener("push", (event) => {
  const reminder = readPush(event);
  event.waitUntil(
    (async () => {
      if (reminder) {
        // La app consulta esta marca para no repetir el aviso al abrirse.
        const cache = await caches.open(DELIVERED_CACHE);
        await cache.put(
          new URL(
            "__organify/push-delivered/" + reminder,
            self.registration.scope,
          ).href,
          new Response(String(Date.now())),
        );
      }
      // iOS exige mostrar una notificación por cada push recibido.
      await self.registration.showNotification(REMINDER_TITLE, {
        body: REMINDER_BODY,
        tag: "organify-reminder:" + (reminder ?? "push"),
        icon: "./icon-192.png",
        lang: "es",
        data: { reminder },
      });
      for (const client of await windowClients()) {
        client.postMessage({ type: "organify:reminder", reminder });
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const reminder = event.notification.data?.reminder;
  event.waitUntil(
    (async () => {
      const open = (await windowClients()).find((client) =>
        client.url.startsWith(self.registration.scope),
      );
      if (open) {
        await open.focus();
        if (reminder)
          open.postMessage({ type: "organify:open-reminder", reminder });
        return;
      }
      const url = new URL(self.registration.scope);
      if (reminder) url.searchParams.set("reminder", reminder);
      await self.clients.openWindow(url.href);
    })(),
  );
});
