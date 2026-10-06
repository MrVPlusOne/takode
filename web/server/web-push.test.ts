import { createDecipheriv, createECDH, hkdfSync, randomBytes, type ECDH } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEB_PUSH_PRESENCE_TTL_MS, type WebPushAlert, WebPushChannel } from "./web-push.js";

/**
 * Tests for the Web Push delivery channel: VAPID key persistence, subscription
 * management, presence-based skipping, and the exact encrypted payloads the
 * service worker (public/sw.js) receives. A simulated browser key pair decrypts
 * each request so the assertions cover the real RFC 8291 encoding.
 */

const APPLE_ENDPOINT_A = "https://web.push.apple.com/device-a";
const APPLE_ENDPOINT_B = "https://web.push.apple.com/device-b";

/** A fake browser subscription whose private key can decrypt what the server sends. */
function makeBrowserSubscription(endpoint: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const authSecret = randomBytes(16).toString("base64url");
  return {
    endpoint,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: authSecret },
    decrypt: (body: Uint8Array) => decryptAes128gcm(Buffer.from(body), ecdh, Buffer.from(authSecret, "base64url")),
  };
}

/** RFC 8291/8188 single-record decryption, as a browser would do it. */
function decryptAes128gcm(body: Buffer, browserKey: ECDH, authSecret: Buffer): WebPushAlert {
  const salt = body.subarray(0, 16);
  const keyIdLength = body[20]!;
  const serverPublicKey = body.subarray(21, 21 + keyIdLength);
  const record = body.subarray(21 + keyIdLength);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), browserKey.getPublicKey(), serverPublicKey]);
  const ikm = Buffer.from(hkdfSync("sha256", browserKey.computeSecret(serverPublicKey), authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  // The last record ends with a 0x02 delimiter followed by optional zero padding.
  const end = padded.lastIndexOf(2);
  return JSON.parse(padded.subarray(0, end).toString("utf-8")) as WebPushAlert;
}

function fetchCallsTo(endpoint: string) {
  return vi.mocked(fetch).mock.calls.filter(([url]) => url === endpoint);
}

/** Endpoints that received a push since the last call, in request order. */
function takeSentEndpoints(): string[] {
  const endpoints = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
  vi.mocked(fetch).mockClear();
  return endpoints;
}

describe("WebPushChannel", () => {
  let dir: string;
  let filePath: string;
  let now: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "web-push-test-"));
    filePath = join(dir, "web-push", "server.json");
    now = 1_000_000;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 201 })));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  function makeChannel() {
    return new WebPushChannel({ filePath, getSubject: () => "mailto:test@example.com", now: () => now });
  }

  it("generates VAPID keys once and reuses them with persisted subscriptions after reload", async () => {
    const first = makeChannel();
    await first.load();
    const device = makeBrowserSubscription(APPLE_ENDPOINT_A);
    await first.subscribe({ endpoint: device.endpoint, keys: device.keys });

    const second = makeChannel();
    await second.load();
    expect(second.getPublicKey()).toBe(first.getPublicKey());
    expect(second.subscriptionCount()).toBe(1);
  });

  it("refuses to replace keys when the store file exists but is unreadable", async () => {
    // A corrupt file must not silently regenerate keys and orphan every device's subscription.
    await makeChannel().load();
    await writeFile(filePath, "{not json", "utf-8");
    await expect(makeChannel().load()).rejects.toThrow();
    expect(await readFile(filePath, "utf-8")).toBe("{not json");
  });

  it("sends an encrypted alert with VAPID auth and urgency", async () => {
    const channel = makeChannel();
    await channel.load();
    const device = makeBrowserSubscription(APPLE_ENDPOINT_A);
    await channel.subscribe({ endpoint: device.endpoint, keys: device.keys });

    await channel.sendAlert({ title: "Takode needs input", body: "Server - Session", url: "/#/session/s1" });

    const [, init] = fetchCallsTo(APPLE_ENDPOINT_A)[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(new RegExp(`^vapid t=.+, k=${channel.getPublicKey()}$`));
    expect(headers.Urgency).toBe("high");
    // Apple's push service answers 400 BadWebPushTopic to any Topic header (seen on a real iPhone).
    expect(headers).not.toHaveProperty("Topic");
    expect(device.decrypt(init!.body as Uint8Array)).toEqual({
      title: "Takode needs input",
      body: "Server - Session",
      url: "/#/session/s1",
    });
  });

  it("skips devices whose app is on screen, until their visible heartbeat goes stale", async () => {
    // The user requirement: no phone alert while Takode is open on that phone, but other
    // devices (and a phone whose app went to the background) still get it.
    const channel = makeChannel();
    await channel.load();
    const phone = makeBrowserSubscription(APPLE_ENDPOINT_A);
    const tablet = makeBrowserSubscription(APPLE_ENDPOINT_B);
    await channel.subscribe({ endpoint: phone.endpoint, keys: phone.keys });
    await channel.subscribe({ endpoint: tablet.endpoint, keys: tablet.keys });
    const alert = { title: "t", body: "b", url: "/" };

    channel.reportPresence(APPLE_ENDPOINT_A, true);
    await channel.sendAlert(alert);
    expect(takeSentEndpoints()).toEqual([APPLE_ENDPOINT_B]);

    channel.reportPresence(APPLE_ENDPOINT_A, false);
    await channel.sendAlert(alert);
    expect(takeSentEndpoints()).toEqual([APPLE_ENDPOINT_A, APPLE_ENDPOINT_B]);

    // A visible report with no later heartbeat (e.g. iOS suspended the app first) expires.
    channel.reportPresence(APPLE_ENDPOINT_A, true);
    now += WEB_PUSH_PRESENCE_TTL_MS + 1;
    await channel.sendAlert(alert);
    expect(takeSentEndpoints()).toEqual([APPLE_ENDPOINT_A, APPLE_ENDPOINT_B]);
  });

  it("sends a Settings test to that one device even while it is on screen", async () => {
    // The test is tapped from the device itself, so presence must not suppress it.
    const channel = makeChannel();
    await channel.load();
    const phone = makeBrowserSubscription(APPLE_ENDPOINT_A);
    const tablet = makeBrowserSubscription(APPLE_ENDPOINT_B);
    await channel.subscribe({ endpoint: phone.endpoint, keys: phone.keys });
    await channel.subscribe({ endpoint: tablet.endpoint, keys: tablet.keys });
    channel.reportPresence(APPLE_ENDPOINT_A, true);

    expect(await channel.sendTest(APPLE_ENDPOINT_A)).toEqual({ ok: true });

    expect(fetchCallsTo(APPLE_ENDPOINT_B)).toHaveLength(0);
    const [, init] = fetchCallsTo(APPLE_ENDPOINT_A)[0]!;
    expect(phone.decrypt(init!.body as Uint8Array)).toEqual({
      title: "Takode test",
      body: "Web Push works.",
      url: "/",
    });
  });

  it("reuses one VAPID JWT per push service instead of minting one per request", async () => {
    // Apple asks senders not to refresh the JWT more than hourly.
    const channel = makeChannel();
    await channel.load();
    const device = makeBrowserSubscription(APPLE_ENDPOINT_A);
    await channel.subscribe({ endpoint: device.endpoint, keys: device.keys });

    await channel.sendAlert({ title: "t", body: "b", url: "/" });
    await channel.sendAlert({ title: "t", body: "b", url: "/" });
    const [first, second] = fetchCallsTo(APPLE_ENDPOINT_A).map(
      ([, init]) => (init!.headers as Record<string, string>).Authorization,
    );
    expect(second).toBe(first);

    now += 60 * 60 * 1000;
    await channel.sendAlert({ title: "t", body: "b", url: "/" });
    const third = (fetchCallsTo(APPLE_ENDPOINT_A)[2]![1]!.headers as Record<string, string>).Authorization;
    expect(third).not.toBe(first);
  });

  it("drops a subscription the push service reports as expired", async () => {
    const channel = makeChannel();
    await channel.load();
    const device = makeBrowserSubscription(APPLE_ENDPOINT_A);
    await channel.subscribe({ endpoint: device.endpoint, keys: device.keys });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 410 }));

    await channel.sendAlert({ title: "t", body: "b", url: "/" });
    expect(channel.hasSubscriptions()).toBe(false);
    const reloaded = makeChannel();
    await reloaded.load();
    expect(reloaded.subscriptionCount()).toBe(0);
  });

  it("keeps a subscription when the push service rejects an alert for another reason", async () => {
    const channel = makeChannel();
    await channel.load();
    const device = makeBrowserSubscription(APPLE_ENDPOINT_A);
    await channel.subscribe({ endpoint: device.endpoint, keys: device.keys });
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{"reason":"BadJwtToken"}', { status: 403 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await channel.sendAlert({ title: "t", body: "b", url: "/" });
    expect(channel.hasSubscriptions()).toBe(true);
  });

  it("shows the push service's rejection reason to the device that sent a test", async () => {
    // Settings displays this text, so a failed phone test explains itself without the server log.
    const channel = makeChannel();
    await channel.load();
    const device = makeBrowserSubscription(APPLE_ENDPOINT_A);
    await channel.subscribe({ endpoint: device.endpoint, keys: device.keys });
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{"reason":"BadJwtToken"}', { status: 403 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await channel.sendTest(APPLE_ENDPOINT_A)).toEqual({
      ok: false,
      error: 'Push service rejected the test notification: 403 {"reason":"BadJwtToken"}',
    });
  });
});
