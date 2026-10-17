import { useStore } from "./store.js";
import type { BrowserIncomingMessage } from "./types.js";
import { applySessionNotifications } from "./notification-status.js";
import { isMostRecentlyUsedAlertWindow } from "./utils/alert-window-presence.js";
import { parseHash } from "./utils/routing.js";
import { readDisplayedLeaderThreadKey } from "./utils/thread-viewport.js";
import { ALL_THREADS_KEY, normalizeThreadKey } from "./utils/thread-projection.js";
import { playNeedsInputSound, playReviewSound } from "./utils/notification-sound.js";

type NotificationUpdateMessage = Extract<BrowserIncomingMessage, { type: "notification_update" }>;
type AttentionAlertMessage = Extract<BrowserIncomingMessage, { type: "attention_alert" }>;

/** Alerts this close together play one sound. */
const ALERT_BURST_MS = 2000;
let lastAlertSound: { at: number; kind: AttentionAlertMessage["kind"] } | null = null;

/** Applies one server-authored inbox update for the open session. */
export function handleNotificationUpdateMessage(sessionId: string, data: NotificationUpdateMessage): void {
  applySessionNotifications(
    sessionId,
    data.notifications ?? [],
    {
      notificationUrgency: data.notificationUrgency,
      activeNotificationCount: data.activeNotificationCount,
      activeNeedsInputNotificationCount: data.activeNeedsInputNotificationCount,
      activeReviewNotificationCount: data.activeReviewNotificationCount,
      mutedNeedsInputNotificationCount: data.mutedNeedsInputNotificationCount,
      notificationStatusVersion: data.notificationStatusVersion,
      notificationStatusUpdatedAt: data.notificationStatusUpdatedAt,
    },
    { authoritativeStatus: true },
  );
}

/**
 * Sounds an alert from any session unless the user is viewing its tab: a new
 * needs-input prompt plays the two-tap, a new result to read plays the single tone.
 * Only the most recently used Takode window plays it. Alerts within about two
 * seconds play one sound; a needs-input alert still plays after a single tone.
 */
export function handleAttentionAlertMessage(data: AttentionAlertMessage, options: { live: boolean }): void {
  if (!options.live || !useStore.getState().notificationSound) return;
  if (isViewingAlertTab(data.session_id, data.thread_key)) return;
  if (!isMostRecentlyUsedAlertWindow()) return;
  const now = Date.now();
  const previous = lastAlertSound;
  if (previous && now - previous.at < ALERT_BURST_MS && (previous.kind === "needs-input" || data.kind === "result")) {
    return;
  }
  lastAlertSound = { at: now, kind: data.kind };
  void (data.kind === "needs-input" ? playNeedsInputSound() : playReviewSound());
}

/** The tab is on screen in a visible, focused window. An unfocused window views nothing. */
function isViewingAlertTab(sessionId: string, threadKey: string | undefined): boolean {
  if (document.visibilityState !== "visible" || !document.hasFocus()) return false;
  if (parseHash(window.location.hash).page !== "session") return false;
  if (useStore.getState().currentSessionId !== sessionId) return false;
  if (!threadKey) return true;
  const displayed = readDisplayedLeaderThreadKey(sessionId);
  return displayed === ALL_THREADS_KEY || displayed === normalizeThreadKey(threadKey);
}
