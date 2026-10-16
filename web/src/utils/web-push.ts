/**
 * Browser side of Takode's Web Push phone alerts.
 *
 * Registers the service worker (`/sw.js`), manages this device's push subscription,
 * and reports whether Takode is on screen so the server can skip alerts for a phone
 * the user is already looking at. iPhones only allow Web Push from a Home Screen app.
 */

import { api } from "../api.js";
import { ATTENTION_LIST_HASH, ATTENTION_OPEN_EVENT } from "./routing.js";

export type WebPushSupport = "supported" | "needs-home-screen" | "unsupported";

/** Must stay below the server's presence TTL (WEB_PUSH_PRESENCE_TTL_MS, 45s). */
const PRESENCE_HEARTBEAT_MS = 20_000;

let presence: { endpoint: string; stop: () => void } | null = null;

export function getWebPushSupport(): WebPushSupport {
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "supported";
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isIos && !standalone ? "needs-home-screen" : "unsupported";
}

export function registerTakodeServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js");
}

/**
 * Subscribes this device. Call directly from the tap handler: iOS only shows the
 * permission prompt for a subscribe() that runs inside a user gesture.
 */
export async function enableWebPush(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<{ subscription: PushSubscription; subscriptionCount: number }> {
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
  });
  const { subscriptionCount } = await api.subscribeWebPush(subscription.toJSON());
  startWebPushPresence(subscription.endpoint);
  return { subscription, subscriptionCount };
}

/** Unsubscribes this device; resolves to the number of devices still subscribed. */
export async function disableWebPush(subscription: PushSubscription): Promise<number> {
  stopWebPushPresence();
  const { subscriptionCount } = await api.unsubscribeWebPush(subscription.endpoint);
  await subscription.unsubscribe();
  return subscriptionCount;
}

/**
 * App-start hook: if this device is already subscribed, refresh the server's copy of
 * the subscription, start presence reporting, and follow notification taps.
 */
export async function resumeWebPushOnThisDevice(): Promise<void> {
  if (getWebPushSupport() !== "supported") return;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | null;
    if (data?.type !== "takode-open-url" || !data.url) return;
    const hash = new URL(data.url, window.location.origin).hash;
    // The attention list opens over the current view instead of navigating away from it.
    if (hash === ATTENTION_LIST_HASH) window.dispatchEvent(new Event(ATTENTION_OPEN_EVENT));
    else window.location.hash = hash;
  });
  navigator.serviceWorker.startMessages();
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  // Re-registering picks up a changed /sw.js without waiting for the browser's own check.
  await registerTakodeServiceWorker();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await api.subscribeWebPush(subscription.toJSON());
  startWebPushPresence(subscription.endpoint);
}

/**
 * Shows the number of questions waiting for the user on the app icon (the Home Screen app on
 * iPhone, or an installed app), the same count as the amber attention chip. Pushes keep it
 * current while the app is closed (`public/sw.js`). Browsers without app badges ignore it.
 */
export function showAppBadge(count: number): void {
  if (!("setAppBadge" in navigator)) return;
  const update = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
  // Rejected when notifications are not allowed, which is normal outside the phone app.
  update.catch((err: unknown) => console.debug("App badge not updated", err));
}

function startWebPushPresence(endpoint: string): void {
  if (presence?.endpoint === endpoint) return;
  stopWebPushPresence();
  const report = (visible: boolean) =>
    fetch("/api/web-push/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, visible }),
      // Lets the "hidden" report finish while iOS is suspending the app.
      keepalive: true,
    }).catch(() => undefined);
  const reportVisibility = () => void report(document.visibilityState === "visible");
  const reportHidden = () => void report(false);
  const heartbeat = setInterval(() => {
    if (document.visibilityState === "visible") void report(true);
  }, PRESENCE_HEARTBEAT_MS);
  document.addEventListener("visibilitychange", reportVisibility);
  window.addEventListener("pagehide", reportHidden);
  reportVisibility();
  presence = {
    endpoint,
    stop: () => {
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", reportVisibility);
      window.removeEventListener("pagehide", reportHidden);
      reportHidden();
    },
  };
}

function stopWebPushPresence(): void {
  presence?.stop();
  presence = null;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
