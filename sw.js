const CACHE_NAME = "reminder-apps-v16";
const ASSETS = ["./index.html", "./styles.css?v=2026-07-01.2", "./app.js?v=2026-07-01.4", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => (response.redirected ? fetch("./index.html") : response))
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!response || response.redirected || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || "./index.html", self.location.href).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existingClient = clients.find((client) => client.url === targetUrl || client.url.endsWith("/index.html"));
        if (existingClient) return existingClient.focus();
        return self.clients.openWindow(targetUrl);
      }),
  );
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const title = payload.title || "Reminder";

  event.waitUntil(
    shouldShowPushNotification(payload).then((shouldShow) => {
      if (!shouldShow) return;

      return self.registration.showNotification(title, {
        body: payload.body || "A reminder is due.",
        icon: "./icon.svg",
        badge: "./icon.svg",
        tag: payload.tag || "reminder-push",
        renotify: true,
        requireInteraction: true,
        data: { url: payload.url || "./index.html", reminderId: payload.reminderId },
      });
    }),
  );
});

async function shouldShowPushNotification(payload) {
  if (payload.forceShow) return true;

  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return !clients.some((client) => client.visibilityState === "visible" || client.focused);
}

function parsePushPayload(event) {
  try {
    return event.data?.json() || {};
  } catch {
    return {};
  }
}
