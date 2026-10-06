// Takode service worker: renders Web Push phone alerts and retracts them once answered.
// It has no fetch handler, so it never intercepts or caches page requests.
// Payload shapes are defined by WebPushPayload in server/web-push.ts.

const RETRACTION_PLACEHOLDER_TAG = "takode-retraction";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  event.waitUntil(handlePush(payload));
});

async function handlePush(payload) {
  if (payload.type === "retract") {
    await closeTagged(payload.tags || []);
    // WebKit unsubscribes an origin after a few pushes that show no notification, so a
    // retraction must still show one: post a silent placeholder and close it right away.
    await self.registration.showNotification("Takode", {
      body: "An alert was answered elsewhere.",
      tag: RETRACTION_PLACEHOLDER_TAG,
      silent: true,
    });
    await closeTaggedWithRetry(RETRACTION_PLACEHOLDER_TAG);
    return;
  }
  await self.registration.showNotification(payload.title || "Takode", {
    body: payload.body || "",
    tag: payload.tag,
    icon: "/icon-192.png",
    data: { url: payload.url || "/" },
  });
}

async function closeTagged(tags) {
  for (const tag of tags) {
    const notifications = await self.registration.getNotifications({ tag });
    for (const notification of notifications) notification.close();
  }
}

// A just-posted notification can take a moment to appear in getNotifications().
async function closeTaggedWithRetry(tag) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const notifications = await self.registration.getNotifications({ tag });
    if (notifications.length > 0) {
      for (const notification of notifications) notification.close();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

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
