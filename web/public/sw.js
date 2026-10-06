// Takode service worker: renders Web Push phone alerts and opens Takode when one is tapped.
// It has no fetch handler, so it never intercepts or caches page requests.
// The payload shape is WebPushAlert in server/web-push.ts. Every push must show a
// notification: WebKit unsubscribes an origin after a few pushes that show nothing.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Takode", {
      body: payload.body || "",
      icon: "/icon-192.png",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(openTakode(url));
});

async function openTakode(url) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const client = windows.find((candidate) => new URL(candidate.url).origin === self.location.origin);
  if (!client) {
    await self.clients.openWindow(url);
    return;
  }
  // The page switches its hash route itself; client.navigate() would reload the whole app.
  client.postMessage({ type: "takode-open-url", url });
  await client.focus();
}
