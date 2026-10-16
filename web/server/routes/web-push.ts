import { Hono } from "hono";
import type { WebPushChannel } from "../web-push.js";

/** Browser-facing Web Push endpoints: subscription management, presence heartbeats, tapped-alert checks and tests. */
export function createWebPushRoutes(webPush: WebPushChannel | undefined) {
  const api = new Hono();

  api.get("/web-push", (c) => {
    if (!webPush) return c.json({ available: false, publicKey: null, subscriptionCount: 0 });
    return c.json({
      available: true,
      publicKey: webPush.getPublicKey(),
      subscriptionCount: webPush.subscriptionCount(),
    });
  });

  api.post("/web-push/subscriptions", async (c) => {
    if (!webPush) return c.json({ error: "Web Push is not available on this server" }, 503);
    const body = await c.req.json().catch(() => null);
    const endpoint = readEndpoint(body);
    const keys = body?.keys;
    if (!endpoint || typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") {
      return c.json({ error: "Expected a push subscription with an https endpoint and p256dh/auth keys" }, 400);
    }
    await webPush.subscribe({
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      userAgent: c.req.header("user-agent"),
    });
    return c.json({ ok: true, subscriptionCount: webPush.subscriptionCount() });
  });

  api.delete("/web-push/subscriptions", async (c) => {
    if (!webPush) return c.json({ error: "Web Push is not available on this server" }, 503);
    const endpoint = readEndpoint(await c.req.json().catch(() => null));
    if (!endpoint) return c.json({ error: "endpoint is required" }, 400);
    await webPush.unsubscribe(endpoint);
    return c.json({ ok: true, subscriptionCount: webPush.subscriptionCount() });
  });

  api.post("/web-push/presence", async (c) => {
    if (!webPush) return c.json({ ok: false });
    const body = await c.req.json().catch(() => null);
    const endpoint = readEndpoint(body);
    if (!endpoint || typeof body?.visible !== "boolean") {
      return c.json({ error: "endpoint and visible are required" }, 400);
    }
    webPush.reportPresence(endpoint, body.visible);
    return c.json({ ok: true });
  });

  // Called by the service worker when an alert is tapped: `alerts` holds the subjects of each alert still shown.
  api.post("/web-push/shown-alerts", async (c) => {
    if (!webPush) return c.json({ error: "Web Push is not available on this server" }, 503);
    const alerts = (await c.req.json().catch(() => null))?.alerts;
    if (!Array.isArray(alerts)) return c.json({ error: "alerts must be an array" }, 400);
    return c.json(webPush.checkShownAlerts(alerts));
  });

  api.post("/web-push/test", async (c) => {
    if (!webPush) return c.json({ error: "Web Push is not available on this server" }, 503);
    const body = await c.req.json().catch(() => null);
    const endpoint = readEndpoint(body);
    if (!endpoint) return c.json({ error: "endpoint is required" }, 400);
    const result = await webPush.sendTest(endpoint);
    return result.ok ? c.json({ ok: true }) : c.json({ error: result.error }, 400);
  });

  return api;
}

/** The server POSTs to subscription endpoints, so only https push-service URLs are accepted. */
function readEndpoint(body: unknown): string | null {
  const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
  if (typeof endpoint !== "string") return null;
  try {
    return new URL(endpoint).protocol === "https:" ? endpoint : null;
  } catch {
    return null;
  }
}
