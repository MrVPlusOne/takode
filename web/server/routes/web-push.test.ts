import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebPushChannel } from "../web-push.js";
import { createWebPushRoutes } from "./web-push.js";

/**
 * Route tests for browser Web Push enrollment and presence. The server POSTs to
 * stored endpoints, so the important guard is that only https endpoints are stored.
 */

describe("web push routes", () => {
  let dir: string;
  let channel: WebPushChannel;
  let app: ReturnType<typeof createWebPushRoutes>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "web-push-routes-"));
    channel = new WebPushChannel({ filePath: join(dir, "store.json"), getSubject: () => "mailto:t@example.com" });
    await channel.load();
    app = createWebPushRoutes(channel);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function send(method: string, path: string, body: unknown) {
    return app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("exposes the VAPID public key the browser subscribes with", async () => {
    const res = await app.request("/web-push");
    expect(await res.json()).toEqual({ available: true, publicKey: channel.getPublicKey(), subscriptionCount: 0 });
  });

  it("stores https subscriptions and rejects other endpoints", async () => {
    const keys = { p256dh: "p", auth: "a" };
    expect((await send("POST", "/web-push/subscriptions", { endpoint: "http://10.0.0.1/x", keys })).status).toBe(400);
    expect((await send("POST", "/web-push/subscriptions", { endpoint: "https://web.push.apple.com/x" })).status).toBe(
      400,
    );

    const ok = await send("POST", "/web-push/subscriptions", { endpoint: "https://web.push.apple.com/x", keys });
    expect(await ok.json()).toEqual({ ok: true, subscriptionCount: 1 });

    const removed = await send("DELETE", "/web-push/subscriptions", { endpoint: "https://web.push.apple.com/x" });
    expect(await removed.json()).toEqual({ ok: true, subscriptionCount: 0 });
  });

  it("records presence reports from the device", async () => {
    const spy = vi.spyOn(channel, "reportPresence");
    const res = await send("POST", "/web-push/presence", { endpoint: "https://web.push.apple.com/x", visible: true });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("https://web.push.apple.com/x", true);
    expect((await send("POST", "/web-push/presence", { endpoint: "https://web.push.apple.com/x" })).status).toBe(400);
  });

  it("reports Web Push as unavailable when the server could not load its store", async () => {
    const unavailable = createWebPushRoutes(undefined);
    expect(await (await unavailable.request("/web-push")).json()).toEqual({
      available: false,
      publicKey: null,
      subscriptionCount: 0,
    });
  });
});
