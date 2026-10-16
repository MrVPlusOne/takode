// Takode service worker: renders Web Push phone alerts and opens Takode when one is tapped.
// It has no fetch handler, so it never intercepts or caches page requests.
// The payload shape is WebPushAlert in server/web-push.ts. Every push must show a
// notification: WebKit unsubscribes an origin after a few pushes that show nothing.
// Each push also sets the app-icon badge to the number of questions waiting.

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
    self.registration
      .showNotification(payload.title || "Takode", {
        body: payload.body || "",
        icon: "/icon-192.png",
        data: { url: payload.url || "/", subjects: payload.subjects },
      })
      // After showing, so the count Takode sends is what the icon ends up with.
      .then(() => setBadge(payload.badge)),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(Promise.all([openTakode(url), closeOutdatedAlerts()]));
});

// iOS lets a service worker close notifications only while it handles a tap (a push handler
// could not), so a tap is when alerts about things already answered, muted or read go away.
// The server judges each shown alert by the subjects it was sent with; alerts without any stay.
async function closeOutdatedAlerts() {
  try {
    const shown = await self.registration.getNotifications();
    const res = await fetch("/api/web-push/shown-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alerts: shown.map((n) => (n.data && n.data.subjects) || null) }),
    });
    if (!res.ok) return;
    const { outdated, badge } = await res.json();
    shown.forEach((notification, i) => outdated[i] && notification.close());
    await setBadge(badge);
  } catch (err) {
    // Clearing is a courtesy; opening Takode must not depend on it.
    console.warn("[takode-sw] Could not clear outdated alerts", err);
  }
}

async function setBadge(count) {
  if (typeof count !== "number" || !("setAppBadge" in self.navigator)) return;
  try {
    if (count > 0) await self.navigator.setAppBadge(count);
    else await self.navigator.clearAppBadge();
  } catch (err) {
    console.warn("[takode-sw] Could not set the app badge", err);
  }
}

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
