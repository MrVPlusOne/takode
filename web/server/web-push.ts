/**
 * Web Push delivery for phone alerts (iOS 16.4+ Home Screen apps and other browsers).
 *
 * Owns this server's VAPID keys, the browser subscriptions registered from Settings,
 * and per-device "currently viewing Takode" presence. The scheduling and batching
 * policy lives in the shared phone-alert scheduler (`pushover.ts`); this module only
 * knows how to reach devices. The service worker that renders these payloads is
 * `web/public/sw.js`.
 *
 * Delivered alerts are never retracted: on iOS a service worker handling a push could
 * not close an already-shown notification (seen on a real iPhone), and every iOS push
 * must show something, so a retraction push would only add a notification. Instead each
 * alert names its subjects, and tapping any alert closes the outdated ones
 * (`phone-alert-status.ts`). Every alert also carries the app-icon badge.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import webpush from "web-push";
import type { PhoneAlertSubject } from "./phone-alert-status.js";

export interface WebPushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
  userAgent?: string;
}

/** The push payload `web/public/sw.js` renders as a notification. */
export interface WebPushAlert {
  title: string;
  body: string;
  /** Same-origin path the notification opens, e.g. `/#/session/<id>?thread=q-7`. */
  url: string;
  /** What the alert is about; once none of it waits for the user, a tap on any alert closes this one. */
  subjects?: PhoneAlertSubject[];
  /** App-icon badge: questions waiting for the user. Filled in by the channel at send time. */
  badge?: number;
}

/** The delivery surface the phone-alert scheduler depends on. */
export interface WebPushDelivery {
  hasSubscriptions(): boolean;
  /** Sends to every subscribed device that is not currently viewing Takode. */
  sendAlert(alert: WebPushAlert): Promise<void>;
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
/** Push services accept about 4 KB of encrypted payload; past this, subjects are left out. */
const MAX_PAYLOAD_BYTES = 3_000;

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
      /** Questions waiting for the user, the same count as the app's amber attention chip. */
      getBadge?: () => number;
      /** Whether nothing an alert's subjects name still waits for the user. */
      isAlertOutdated?: (subjects: unknown) => boolean;
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

  async sendAlert(alert: WebPushAlert): Promise<void> {
    const targets = (this.store?.subscriptions ?? []).filter((s) => !this.isViewing(s.endpoint));
    if (targets.length === 0) return;
    const payload = { ...alert, badge: this.opts.getBadge?.() };
    // A lost subject list only means the alert stays after it is outdated; an oversized push is lost.
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) delete payload.subjects;
    await Promise.all(targets.map((s) => this.send(s, payload)));
  }

  /**
   * For a tapped alert: which of the alerts still shown on the phone (given by their
   * subjects) are outdated, and the current badge.
   */
  checkShownAlerts(alerts: unknown[]): { outdated: boolean[]; badge?: number } {
    return {
      outdated: alerts.map((subjects) => this.opts.isAlertOutdated?.(subjects) ?? false),
      badge: this.opts.getBadge?.(),
    };
  }

  /** Sends a test alert to one device regardless of presence. */
  async sendTest(endpoint: string): Promise<{ ok: boolean; error?: string }> {
    const subscription = this.store?.subscriptions.find((s) => s.endpoint === endpoint);
    if (!subscription) return { ok: false, error: "This device is not subscribed" };
    const error = await this.send(subscription, { title: "Takode test", body: "Web Push works.", url: "/" });
    if (error) return { ok: false, error: `Push service rejected the test notification: ${error}` };
    return { ok: true };
  }

  /** Resolves to null on success, otherwise a short failure reason. */
  private async send(subscription: WebPushSubscriptionRecord, payload: WebPushAlert): Promise<string | null> {
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
