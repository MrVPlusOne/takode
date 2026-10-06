/**
 * Web Push delivery for phone alerts (iOS 16.4+ Home Screen apps and other browsers).
 *
 * Owns this server's VAPID keys, the browser subscriptions registered from Settings,
 * and per-device "currently viewing Takode" presence. The scheduling, batching and
 * retraction policy lives in the shared phone-alert scheduler (`pushover.ts`); this
 * module only knows how to reach devices. The service worker that renders these
 * payloads is `web/public/sw.js`.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import webpush from "web-push";

export interface WebPushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
  userAgent?: string;
}

/** Payloads understood by `web/public/sw.js`. */
export type WebPushPayload =
  | { type: "alert"; title: string; body: string; url: string; tag: string }
  | { type: "retract"; tags: string[] };

export interface WebPushAlert {
  title: string;
  body: string;
  /** Same-origin path the notification opens, e.g. `/#/session/<id>`. */
  url: string;
  /** Unique per delivered alert; retraction closes notifications carrying this tag. */
  tag: string;
}

/** The delivery surface the phone-alert scheduler depends on. */
export interface WebPushDelivery {
  hasSubscriptions(): boolean;
  /** Sends to every subscribed device that is not currently viewing Takode; resolves to the reached endpoints. */
  sendAlert(alert: WebPushAlert): Promise<string[]>;
  /** Asks the given devices to close the notifications carrying these tags. */
  sendRetraction(endpoints: string[], tags: string[]): Promise<void>;
}

interface WebPushStoreFile {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  subscriptions: WebPushSubscriptionRecord[];
}

/** A device counts as viewing only while its visible-heartbeat is this fresh. */
export const WEB_PUSH_PRESENCE_TTL_MS = 45_000;
/** Keep undelivered messages for a while so a phone that was offline still converges. */
const MESSAGE_TTL_SECONDS = 6 * 60 * 60;
/** Apple asks senders not to mint VAPID JWTs more often than hourly. */
const VAPID_HEADER_REUSE_MS = 60 * 60 * 1000;
const VAPID_JWT_LIFETIME_SECONDS = 12 * 60 * 60;

export class WebPushChannel implements WebPushDelivery {
  private store: WebPushStoreFile | null = null;
  private presence = new Map<string, { visible: boolean; at: number }>();
  private vapidHeaders = new Map<string, { authorization: string; createdAt: number }>();
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly opts: {
      filePath: string;
      /** VAPID `sub` claim; Apple requires an https URL or mailto. */
      getSubject: () => string;
      now?: () => number;
    },
  ) {}

  /** Loads keys and subscriptions, generating and persisting VAPID keys on first use. */
  async load(): Promise<void> {
    try {
      this.store = JSON.parse(await readFile(this.opts.filePath, "utf-8")) as WebPushStoreFile;
    } catch (err) {
      // Only a missing file means "first use"; anything else must not silently replace keys.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const keys = webpush.generateVAPIDKeys();
      this.store = { vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey, subscriptions: [] };
      await this.save();
    }
  }

  getPublicKey(): string {
    return this.requireStore().vapidPublicKey;
  }

  hasSubscriptions(): boolean {
    return (this.store?.subscriptions.length ?? 0) > 0;
  }

  subscriptionCount(): number {
    return this.store?.subscriptions.length ?? 0;
  }

  /** Registers or refreshes a browser subscription (idempotent by endpoint). */
  async subscribe(subscription: Omit<WebPushSubscriptionRecord, "createdAt">): Promise<void> {
    const store = this.requireStore();
    store.subscriptions = store.subscriptions.filter((s) => s.endpoint !== subscription.endpoint);
    store.subscriptions.push({ ...subscription, createdAt: this.now() });
    await this.save();
  }

  async unsubscribe(endpoint: string): Promise<void> {
    const store = this.requireStore();
    store.subscriptions = store.subscriptions.filter((s) => s.endpoint !== endpoint);
    this.presence.delete(endpoint);
    await this.save();
  }

  /** Records whether the app tied to this subscription is currently on screen. */
  reportPresence(endpoint: string, visible: boolean): void {
    this.presence.set(endpoint, { visible, at: this.now() });
  }

  isViewing(endpoint: string): boolean {
    const state = this.presence.get(endpoint);
    return !!state?.visible && this.now() - state.at <= WEB_PUSH_PRESENCE_TTL_MS;
  }

  async sendAlert(alert: WebPushAlert): Promise<string[]> {
    const targets = (this.store?.subscriptions ?? []).filter((s) => !this.isViewing(s.endpoint));
    const payload: WebPushPayload = { type: "alert", ...alert };
    const errors = await Promise.all(targets.map((s) => this.send(s, payload)));
    return targets.filter((_, i) => errors[i] === null).map((s) => s.endpoint);
  }

  async sendRetraction(endpoints: string[], tags: string[]): Promise<void> {
    if (tags.length === 0) return;
    const targets = (this.store?.subscriptions ?? []).filter((s) => endpoints.includes(s.endpoint));
    await Promise.all(targets.map((s) => this.send(s, { type: "retract", tags })));
  }

  /** Sends a test alert to one device regardless of presence, optionally retracting it later. */
  async sendTest(endpoint: string, retractAfterMs?: number): Promise<{ ok: boolean; error?: string }> {
    const subscription = this.store?.subscriptions.find((s) => s.endpoint === endpoint);
    if (!subscription) return { ok: false, error: "This device is not subscribed" };
    const tag = newAlertTag();
    const body = retractAfterMs
      ? `Web Push works. This notification should disappear in ${Math.round(retractAfterMs / 1000)}s.`
      : "Web Push works.";
    const error = await this.send(subscription, { type: "alert", title: "Takode test", body, url: "/", tag });
    if (error) return { ok: false, error: `Push service rejected the test notification: ${error}` };
    if (retractAfterMs) {
      setTimeout(() => void this.sendRetraction([endpoint], [tag]), retractAfterMs);
    }
    return { ok: true };
  }

  /** Resolves to null on success, otherwise a short failure reason. */
  private async send(subscription: WebPushSubscriptionRecord, payload: WebPushPayload): Promise<string | null> {
    try {
      // No Topic header: Apple's push service rejects any Topic with 400 BadWebPushTopic.
      // VAPID auth is added separately so one JWT can be reused per push service.
      const details = webpush.generateRequestDetails(subscription, JSON.stringify(payload), {
        TTL: MESSAGE_TTL_SECONDS,
        urgency: "high",
      });
      const res = await fetch(details.endpoint, {
        method: "POST",
        headers: {
          ...(details.headers as Record<string, string>),
          Authorization: this.vapidAuthorization(subscription.endpoint),
        },
        body: new Uint8Array(details.body),
      });
      if (res.status === 404 || res.status === 410) {
        console.log(`[web-push] Removing expired subscription (${res.status})`);
        await this.unsubscribe(subscription.endpoint);
        return `subscription expired (${res.status})`;
      }
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 200);
        console.warn(`[web-push] Push service error ${res.status}: ${text}`);
        return `${res.status} ${text}`.trim();
      }
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[web-push] Send failed: ${message}`);
      return message;
    }
  }

  private vapidAuthorization(endpoint: string): string {
    const audience = new URL(endpoint).origin;
    const cached = this.vapidHeaders.get(audience);
    if (cached && this.now() - cached.createdAt < VAPID_HEADER_REUSE_MS) return cached.authorization;
    const store = this.requireStore();
    const headers = webpush.getVapidHeaders(
      audience,
      this.opts.getSubject(),
      store.vapidPublicKey,
      store.vapidPrivateKey,
      "aes128gcm",
      Math.floor(this.now() / 1000) + VAPID_JWT_LIFETIME_SECONDS,
    );
    this.vapidHeaders.set(audience, { authorization: headers.Authorization, createdAt: this.now() });
    return headers.Authorization;
  }

  private requireStore(): WebPushStoreFile {
    if (!this.store) throw new Error("WebPushChannel used before load()");
    return this.store;
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.store, null, 2);
    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.opts.filePath), { recursive: true });
        await writeFile(this.opts.filePath, snapshot, { encoding: "utf-8", mode: 0o600 });
      });
    return this.pendingWrite;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }
}

/** Unique tag for one delivered alert. */
export function newAlertTag(): string {
  return `t${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
}
