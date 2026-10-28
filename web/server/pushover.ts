/**
 * Server-side phone-alert scheduler, delivering through Pushover and/or Web Push.
 *
 * Sends delayed notifications when attention-requiring events (permission requests,
 * questions, completions, errors) remain unresolved. Supports batching, cancellation,
 * and per-session rate limiting.
 */

import type { PhoneAlertSubject } from "./phone-alert-status.js";
import type { WebPushDelivery } from "./web-push.js";

export type PushoverEventType =
  | "permission"
  | "question"
  | "completed"
  | "error"
  | "monitored-result"
  | "urgent-result";
export type PushoverNotificationCategory = "needs-input" | "review" | "notify-me" | "error" | "urgent";

export interface PushoverEventFilters {
  needsInput: boolean;
  review: boolean;
  notifyMe: boolean;
  error: boolean;
  /** Answers a leader marked urgent. */
  urgent: boolean;
  /** One alert when personal to-dos pass their due date (sent by `todo-overdue-alerts.ts`). */
  overdueTodos: boolean;
}

export const DEFAULT_PUSHOVER_EVENT_FILTERS: Readonly<PushoverEventFilters> = {
  needsInput: true,
  review: true,
  notifyMe: true,
  error: true,
  urgent: true,
  overdueTodos: true,
};

export interface PushoverSettings {
  pushoverUserKey: string;
  pushoverApiToken: string;
  pushoverDelaySeconds: number;
  pushoverEnabled: boolean;
  pushoverEventFilters?: PushoverEventFilters;
}

export interface PushoverNotifierOpts {
  getSettings: () => PushoverSettings;
  getBaseUrl: () => string;
  getServerName: () => string;
  getSessionName: (sessionId: string) => string | undefined;
  getSessionActivity: (sessionId: string) => string | undefined;
  /** Returns the epoch ms when the user last read this session (0 = never). */
  getLastReadAt: (sessionId: string) => number;
  /** Web Push channel; shares this scheduler's delay, event filters and rate limits. */
  webPush?: WebPushDelivery;
}

export interface PushoverScheduleOptions {
  /** When true, bypass the lastReadAt suppression check (for explicit user notifications). */
  skipReadCheck?: boolean;
  /** Takode notification ID that can later cancel/revalidate this pending push. */
  notificationId?: string;
  /** Leader thread (`main` or `q-N`) the alert came from; tapping the alert opens that tab. */
  threadKey?: string;
  /** Message the alert is about (a question's anchor, a result); tapping the alert scrolls to it. */
  messageId?: string;
  /** Exact monitored result ownership, rechecked after the delay independently of session reads. */
  monitoredResult?: { threadKey: string; resultId: string; isPending: () => boolean };
  /** Rechecked after the delay instead of the session read time: the alert fires only while this holds. */
  isStillOpen?: () => boolean;
}

/** The thread and message a tapped alert opens. */
interface AlertLinkTarget {
  threadKey?: string;
  messageId?: string;
}

interface PendingNotification {
  sessionId: string;
  eventType: PushoverEventType;
  createdAt: number;
  timer: ReturnType<typeof setTimeout>;
  detail?: string;
  /** Permission/question request IDs included in this batch */
  requestIds: string[];
  /** Takode notification IDs included in this batch */
  notificationIds: string[];
  /** Request details keyed by request ID, used when still-active batched items fire. */
  requestDetails: Record<string, string>;
  /** Notification details keyed by notification ID, used when still-active batched items fire. */
  notificationDetails: Record<string, string>;
  /** Where each batched notification lives, so the link follows the items still waiting. */
  notificationTargets: Record<string, AlertLinkTarget>;
  /** Where an alert scheduled without a notification ID points. */
  target: AlertLinkTarget;
  /** When true, bypass the lastReadAt suppression check (for explicit user notifications). */
  skipReadCheck?: boolean;
  monitoredResult?: PushoverScheduleOptions["monitoredResult"];
  isStillOpen?: () => boolean;
}

interface SessionCooldown {
  lastNotifiedAt: number;
  windowStart: number;
  windowCount: number;
}

const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";

/** Minimum seconds between any two Pushover API calls */
const GLOBAL_MIN_INTERVAL_MS = 5_000;
/** Minimum ms between notifications for the same session */
const SESSION_COOLDOWN_MS = 60_000;
/** Rate limit window duration */
const SESSION_WINDOW_MS = 300_000;
/** Max notifications per session per window */
const SESSION_WINDOW_MAX = 5;
/** Batching window for rapid-fire permissions on the same session */
const PERMISSION_BATCH_WINDOW_MS = 3_000;

const EVENT_PRIORITY: Record<PushoverEventType, number> = {
  permission: 1,
  question: 1,
  error: 1,
  completed: 0,
  "monitored-result": 0,
  "urgent-result": 1,
};

const EVENT_TITLE: Record<PushoverEventType, string> = {
  permission: "Permission needed",
  question: "Takode needs input",
  completed: "Ready for review",
  error: "Session error",
  "monitored-result": "Notify Me result",
  "urgent-result": "Urgent result",
};

const EVENT_CATEGORY: Record<PushoverEventType, PushoverNotificationCategory> = {
  permission: "needs-input",
  question: "needs-input",
  completed: "review",
  error: "error",
  "monitored-result": "notify-me",
  "urgent-result": "urgent",
};

export class PushoverNotifier {
  private opts: PushoverNotifierOpts;
  /** Pending notifications keyed by session/event, and by thread for monitored results. */
  private pending = new Map<string, PendingNotification>();
  private cooldowns = new Map<string, SessionCooldown>();
  private globalLastSent = 0;

  constructor(opts: PushoverNotifierOpts) {
    this.opts = opts;
  }

  private isPushoverConfigured(): boolean {
    const s = this.opts.getSettings();
    return !!(s.pushoverEnabled && s.pushoverUserKey.trim() && s.pushoverApiToken.trim());
  }

  private hasAnyChannel(): boolean {
    return this.isPushoverConfigured() || !!this.opts.webPush?.hasSubscriptions();
  }

  private getEventFilters(settings: PushoverSettings): PushoverEventFilters {
    const raw = settings.pushoverEventFilters;
    return {
      needsInput: raw?.needsInput ?? DEFAULT_PUSHOVER_EVENT_FILTERS.needsInput,
      review: raw?.review ?? DEFAULT_PUSHOVER_EVENT_FILTERS.review,
      notifyMe: raw?.notifyMe ?? DEFAULT_PUSHOVER_EVENT_FILTERS.notifyMe,
      error: raw?.error ?? DEFAULT_PUSHOVER_EVENT_FILTERS.error,
      urgent: raw?.urgent ?? DEFAULT_PUSHOVER_EVENT_FILTERS.urgent,
      overdueTodos: raw?.overdueTodos ?? DEFAULT_PUSHOVER_EVENT_FILTERS.overdueTodos,
    };
  }

  private isEventEnabled(eventType: PushoverEventType, settings: PushoverSettings): boolean {
    const filters = this.getEventFilters(settings);
    const category = EVENT_CATEGORY[eventType];
    if (category === "needs-input") return filters.needsInput;
    if (category === "review") return filters.review;
    if (category === "notify-me") return filters.notifyMe;
    if (category === "urgent") return filters.urgent;
    return filters.error;
  }

  /**
   * Schedule a notification for a session event.
   * For permissions/questions, multiple rapid-fire events are batched.
   */
  scheduleNotification(
    sessionId: string,
    eventType: PushoverEventType,
    detail?: string,
    requestId?: string,
    options?: PushoverScheduleOptions,
  ): void {
    const settings = this.opts.getSettings();
    if (!this.hasAnyChannel() || !this.isEventEnabled(eventType, settings)) return;
    const monitoredResult = eventType === "monitored-result" ? options?.monitoredResult : undefined;
    if (eventType === "monitored-result" && !monitoredResult) return;

    const isBatchable = eventType === "permission" || eventType === "question";
    // Each urgent result is its own alert, so a second one does not replace the first.
    const keySuffix = monitoredResult
      ? `:${monitoredResult.threadKey}`
      : eventType === "urgent-result" && options?.notificationId
        ? `:${options.notificationId}`
        : "";
    const key = `${sessionId}:${eventType}${keySuffix}`;
    const existing = this.pending.get(key);

    const notificationId = options?.notificationId;

    if (isBatchable && existing && (requestId || notificationId)) {
      // Merge into existing batch — extend timer but cap at original delay
      if (requestId && !existing.requestIds.includes(requestId)) {
        existing.requestIds.push(requestId);
      }
      if (notificationId && !existing.notificationIds.includes(notificationId)) {
        existing.notificationIds.push(notificationId);
      }
      if (detail && requestId) existing.requestDetails[requestId] = detail;
      if (detail && notificationId) existing.notificationDetails[notificationId] = detail;
      if (notificationId) existing.notificationTargets[notificationId] = alertLinkTarget(options);
      // Extend the batch window, but don't exceed the configured delay from original creation
      const maxFireAt = existing.createdAt + settings.pushoverDelaySeconds * 1000;
      const batchFireAt = Math.min(Date.now() + PERMISSION_BATCH_WINDOW_MS, maxFireAt);
      const newDelay = Math.max(0, batchFireAt - Date.now());
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => this.fire(key), newDelay);
      return;
    }

    // Cancel any existing notification of the same type for this session
    if (existing) {
      clearTimeout(existing.timer);
      this.pending.delete(key);
    }
    const delayMs = settings.pushoverDelaySeconds * 1000;
    const now = Date.now();

    const pending: PendingNotification = {
      sessionId,
      eventType,
      createdAt: now,
      timer: setTimeout(() => this.fire(key), delayMs),
      detail,
      requestIds: requestId ? [requestId] : [],
      notificationIds: notificationId ? [notificationId] : [],
      requestDetails: detail && requestId ? { [requestId]: detail } : {},
      notificationDetails: detail && notificationId ? { [notificationId]: detail } : {},
      notificationTargets: notificationId ? { [notificationId]: alertLinkTarget(options) } : {},
      target: notificationId ? {} : alertLinkTarget(options),
      skipReadCheck: options?.skipReadCheck,
      monitoredResult,
      isStillOpen: options?.isStillOpen,
    };
    this.pending.set(key, pending);
  }

  /** Cancel a specific permission/question request from a pending batch. */
  cancelPermission(sessionId: string, requestId: string): void {
    for (const eventType of ["permission", "question"] as const) {
      const key = `${sessionId}:${eventType}`;
      const pending = this.pending.get(key);
      if (!pending) continue;

      const idx = pending.requestIds.indexOf(requestId);
      if (idx !== -1) {
        delete pending.requestDetails[requestId];
        pending.requestIds.splice(idx, 1);
        if (pending.requestIds.length === 0 && pending.notificationIds.length === 0) {
          clearTimeout(pending.timer);
          this.pending.delete(key);
        }
        return;
      }
    }
  }

  /** Cancel a specific Takode notification from a pending Pushover batch. */
  cancelNotification(sessionId: string, notificationId: string): void {
    for (const [key, pending] of this.pending) {
      if (pending.sessionId !== sessionId) continue;

      const idx = pending.notificationIds.indexOf(notificationId);
      if (idx === -1) continue;

      delete pending.notificationDetails[notificationId];
      delete pending.notificationTargets[notificationId];
      pending.notificationIds.splice(idx, 1);
      if (pending.requestIds.length === 0 && pending.notificationIds.length === 0) {
        clearTimeout(pending.timer);
        this.pending.delete(key);
      }
      return;
    }
  }

  /** Cancel all pending notifications for a session, optionally filtered by event type. */
  cancelForSession(sessionId: string, eventType?: PushoverEventType): void {
    for (const [key, pending] of this.pending) {
      if (pending.sessionId === sessionId && (!eventType || pending.eventType === eventType)) {
        clearTimeout(pending.timer);
        this.pending.delete(key);
      }
    }
  }

  /**
   * Send a reminder about all waiting questions right away on every channel. It belongs
   * to no single session, so the delay, event filters and per-session limits do not apply;
   * Web Push still skips devices that are viewing Takode.
   */
  async sendReminder(alert: {
    title: string;
    body: string;
    path: string;
    subjects?: PhoneAlertSubject[];
  }): Promise<void> {
    console.log(`[pushover] Sending reminder: ${alert.title}`);
    if (this.opts.webPush?.hasSubscriptions()) {
      void this.opts.webPush.sendAlert({
        title: alert.title,
        body: alert.body,
        url: alert.path,
        subjects: alert.subjects,
      });
    }
    if (this.isPushoverConfigured()) {
      const url = this.opts.getBaseUrl().replace(/\/+$/, "") + alert.path;
      await this.sendToApi(this.opts.getSettings(), alert.title, alert.body, EVENT_PRIORITY.question, url, false);
    }
  }

  /** Send a test notification (bypasses delay and cooldowns). */
  async sendTest(): Promise<{ ok: boolean; error?: string }> {
    const settings = this.opts.getSettings();
    if (!settings.pushoverUserKey.trim() || !settings.pushoverApiToken.trim()) {
      return { ok: false, error: "Pushover credentials not configured" };
    }
    const serverName = this.opts.getServerName();
    return this.sendToApi(settings, "Companion", `${serverName}\nPushover is configured correctly.`, -1);
  }

  /** Clean up all timers for graceful shutdown. */
  destroy(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
    }
    this.pending.clear();
    this.cooldowns.clear();
  }

  private async fire(key: string): Promise<void> {
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    // Acknowledgement, accepted replies, replacement, and Stop tracking retire only this result.
    if (pending.monitoredResult && !pending.monitoredResult.isPending()) return;
    if (pending.isStillOpen && !pending.isStillOpen()) return;

    const settings = this.opts.getSettings();
    if (!this.hasAnyChannel()) return;
    if (!this.isEventEnabled(pending.eventType, settings)) {
      console.log(
        `[pushover] Suppressed ${pending.eventType} for ${pending.sessionId.slice(0, 8)}: category disabled in settings`,
      );
      return;
    }

    // Skip notification if the user has read the session since the event was created,
    // unless this is an explicit notification (e.g. takode notify) that should always fire.
    if (!pending.skipReadCheck && !pending.monitoredResult && !pending.isStillOpen) {
      const lastRead = this.opts.getLastReadAt(pending.sessionId);
      if (lastRead >= pending.createdAt) {
        console.log(
          `[pushover] Suppressed ${pending.eventType} for ${pending.sessionId.slice(0, 8)}: user read session after event was created`,
        );
        return;
      }
    }

    if (!this.checkRateLimit(pending.sessionId)) {
      console.log(`[pushover] Suppressed ${pending.eventType} for ${pending.sessionId.slice(0, 8)}: rate limited`);
      return;
    }

    const { sessionId, eventType } = pending;

    // Build title
    let title: string;
    const pendingItemCount = Math.max(1, pending.requestIds.length + pending.notificationIds.length);
    if ((eventType === "permission" || eventType === "question") && pendingItemCount > 1) {
      title = `${pendingItemCount} ${eventType === "question" ? "questions" : "permissions"} waiting`;
    } else {
      title = EVENT_TITLE[eventType];
    }

    // Build message body
    const lines: string[] = [];

    // Line 1: server name + session name
    const serverName = this.opts.getServerName();
    const sessionName = this.opts.getSessionName(sessionId);
    if (sessionName) {
      lines.push(`${serverName} — ${sessionName}`);
    } else {
      lines.push(`${serverName} — ${sessionId.slice(0, 8)}`);
    }

    // Line 2: activity preview (if available)
    const activity = pending.monitoredResult ? undefined : this.opts.getSessionActivity(sessionId);
    if (activity) {
      lines.push(activity);
    }

    // Line 3: event-specific detail
    const activeDetails = this.getActiveDetails(pending);
    const displayNames = [...new Set(activeDetails.map((detail) => this.getDisplayName(detail)).filter(Boolean))];
    if ((eventType === "permission" || eventType === "question") && displayNames.length > 1) {
      lines.push(displayNames.join(", "));
    } else if (activeDetails[0]) {
      lines.push(activeDetails[0]);
    } else if (pending.detail) {
      lines.push(pending.detail);
    }

    const message = lines.join("\n");
    const path = this.buildDeepLinkPath(sessionId, this.getDeepLinkTarget(pending));

    console.log(`[pushover] Sending ${eventType} notification for ${sessionId.slice(0, 8)}`);
    if (this.opts.webPush?.hasSubscriptions()) {
      void this.opts.webPush.sendAlert({ title, body: message, url: path, subjects: this.getAlertSubjects(pending) });
    }
    if (this.isPushoverConfigured()) {
      const url = this.opts.getBaseUrl().replace(/\/+$/, "") + path;
      await this.sendToApi(settings, title, message, EVENT_PRIORITY[eventType], url, !pending.monitoredResult);
    }
  }

  private async sendToApi(
    settings: PushoverSettings,
    title: string,
    message: string,
    priority: number,
    url?: string,
    html = true,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const body = new URLSearchParams({
        token: settings.pushoverApiToken,
        user: settings.pushoverUserKey,
        title,
        message,
        priority: String(priority),
        html: html ? "1" : "0",
      });
      if (url) {
        body.set("url", url);
        body.set("url_title", "Open in Companion");
      }

      const res = await fetch(PUSHOVER_API_URL, {
        method: "POST",
        body,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const error = `Pushover API error ${res.status}: ${text}`.slice(0, 200);
        console.warn(`[pushover] ${error}`);
        return { ok: false, error };
      }

      this.globalLastSent = Date.now();
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[pushover] Send failed: ${error}`);
      return { ok: false, error };
    }
  }

  private checkRateLimit(sessionId: string): boolean {
    const now = Date.now();

    // Global rate limit
    if (now - this.globalLastSent < GLOBAL_MIN_INTERVAL_MS) {
      return false;
    }

    // Per-session rate limit
    let cooldown = this.cooldowns.get(sessionId);
    if (!cooldown) {
      cooldown = { lastNotifiedAt: 0, windowStart: now, windowCount: 0 };
      this.cooldowns.set(sessionId, cooldown);
    }

    // Session cooldown
    if (now - cooldown.lastNotifiedAt < SESSION_COOLDOWN_MS) {
      return false;
    }

    // Windowed rate limit
    if (now - cooldown.windowStart > SESSION_WINDOW_MS) {
      cooldown.windowStart = now;
      cooldown.windowCount = 0;
    }
    if (cooldown.windowCount >= SESSION_WINDOW_MAX) {
      return false;
    }

    cooldown.lastNotifiedAt = now;
    cooldown.windowCount++;
    return true;
  }

  /**
   * Where a tapped alert opens: the monitored thread, else the oldest still-waiting batched
   * item's thread and message. Main is named explicitly: a bare session link reopens whichever
   * tab the app last showed, not the thread the alert came from.
   */
  private getDeepLinkTarget(pending: PendingNotification): AlertLinkTarget {
    if (pending.monitoredResult) return { threadKey: pending.monitoredResult.threadKey };
    for (const notificationId of pending.notificationIds) {
      const target = pending.notificationTargets[notificationId];
      if (target?.threadKey || target?.messageId) return target;
    }
    return pending.target;
  }

  /** What the alert is about, so tapping a later alert can close this one once it is outdated. */
  private getAlertSubjects(pending: PendingNotification): PhoneAlertSubject[] {
    const { sessionId, monitoredResult } = pending;
    if (monitoredResult) {
      return [
        { kind: "notify-me", sessionId, threadKey: monitoredResult.threadKey, resultId: monitoredResult.resultId },
      ];
    }
    const subjects: PhoneAlertSubject[] = [
      ...pending.requestIds.map((requestId) => ({ kind: "permission" as const, sessionId, requestId })),
      ...pending.notificationIds.map((notificationId) => ({ kind: "question" as const, sessionId, notificationId })),
    ];
    // Finished turns, reviews and errors have no item to answer; reading the session settles them.
    return subjects.length > 0 ? subjects : [{ kind: "unread", sessionId, since: pending.createdAt }];
  }

  /** `/msg/<id>` makes the app scroll to and flash the message, as an in-app notification link does. */
  private buildDeepLinkPath(sessionId: string, { threadKey, messageId }: AlertLinkTarget): string {
    const message = messageId ? `/msg/${encodeURIComponent(messageId)}` : "";
    const thread = threadKey ? `?thread=${encodeURIComponent(threadKey)}` : "";
    return `/#/session/${encodeURIComponent(sessionId)}${message}${thread}`;
  }

  private getActiveDetails(pending: PendingNotification): string[] {
    const details: string[] = [];
    for (const requestId of pending.requestIds) {
      const detail = pending.requestDetails[requestId];
      if (detail) details.push(detail);
    }
    for (const notificationId of pending.notificationIds) {
      const detail = pending.notificationDetails[notificationId];
      if (detail) details.push(detail);
    }
    return details;
  }

  private getDisplayName(detail: string): string {
    return detail.split(":")[0]?.trim() ?? "";
  }
}

function alertLinkTarget(options: PushoverScheduleOptions | undefined): AlertLinkTarget {
  return {
    ...(options?.threadKey ? { threadKey: options.threadKey } : {}),
    ...(options?.messageId ? { messageId: options.messageId } : {}),
  };
}
