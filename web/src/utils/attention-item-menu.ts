import { updateThreadMonitoring } from "../api/thread-monitoring.js";
import { api } from "../api.js";
import type { ContextMenuItem } from "../components/ContextMenu.js";
import { NEEDS_INPUT_SNOOZE_PRESETS } from "../components/NeedsInputSnoozeControl.js";
import { applyServerNotification } from "../notification-status.js";
import { useStore } from "../store.js";
import type { SessionNotification } from "../types.js";
import { parseQuestIdsFromReviewSummary } from "./attention-records.js";
import { resolveLeaderThreadTabsProjection } from "./leader-thread-tabs-resolver.js";
import type { NextAttentionItem } from "./next-attention.js";
import { resolveNotificationOwnerThreadKey } from "./notification-thread.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";

/**
 * Asks the session's open ChatView to close one of its thread tabs, through the
 * same path as the tab's own close button (which also leaves the tab if it is
 * selected). The view cancels the event when it handled it. Detail:
 * `{ sessionId, threadKey }`.
 */
export const CLOSE_THREAD_TAB_EVENT = "takode:close-thread-tab";

function logFailure(action: string) {
  return (error: unknown) => console.error(`[attention-menu] ${action} failed:`, error);
}

/**
 * Context-menu actions for an unresolved needs-input prompt: Mute or Unmute,
 * and Remind me later (presets) or Cancel snooze. Answering stays on the row.
 */
export function needsInputMenuItems(sessionId: string, notification: SessionNotification): ContextMenuItem[] {
  if (notification.category !== "needs-input" || notification.done) return [];
  const apply = (request: Promise<{ notification: SessionNotification }>, action: string) =>
    request.then((result) => applyServerNotification(sessionId, result.notification)).catch(logFailure(action));
  if (notification.snoozedUntil !== undefined) {
    return [
      {
        label: "Cancel snooze",
        onClick: () => apply(api.setNotificationMuted(sessionId, notification.id, false), "Cancel snooze"),
      },
    ];
  }
  return [
    notification.muted
      ? { label: "Unmute", onClick: () => apply(api.setNotificationMuted(sessionId, notification.id, false), "Unmute") }
      : { label: "Mute", onClick: () => apply(api.setNotificationMuted(sessionId, notification.id, true), "Mute") },
    {
      label: "Remind me later",
      onClick: () => {},
      children: NEEDS_INPUT_SNOOZE_PRESETS.map((preset) => ({
        label: preset.label,
        onClick: () => apply(api.snoozeNotification(sessionId, notification.id, preset.durationMs), "Snooze"),
      })),
    },
  ];
}

/**
 * The actions an attention list offers for one item, by kind: prompt actions,
 * Acknowledge and Stop tracking for Notify Me results, Mark as read for unread
 * results, and Close tab for a leader thread tab in the session on screen
 * (only its view can close tabs). Opening stays on the row's Go to.
 */
export function attentionItemMenuItems(item: NextAttentionItem): ContextMenuItem[] {
  if (item.kind === "needs-input") return needsInputMenuItems(item.sessionId, item.entry.notification);
  const items: ContextMenuItem[] = [];
  if (item.kind === "notify-me") {
    const { threadKey, pending } = item.entry;
    if (pending) {
      items.push({
        label: "Acknowledge",
        onClick: () =>
          void updateThreadMonitoring(item.sessionId, threadKey, "acknowledge", pending.id).catch(
            logFailure("Acknowledge"),
          ),
      });
    }
    items.push({
      label: "Stop tracking",
      onClick: () =>
        void updateThreadMonitoring(item.sessionId, threadKey, "untrack").catch(logFailure("Stop tracking")),
    });
  } else {
    items.push({
      label: "Mark as read",
      onClick: () =>
        void (
          item.threadKey === null ? api.markSessionRead(item.sessionId) : markThreadRead(item.sessionId, item.threadKey)
        ).catch(logFailure("Mark as read")),
    });
  }
  if (item.threadKey && canCloseThreadTab(item.sessionId, item.threadKey)) {
    const { sessionId, threadKey } = item;
    items.push({
      label: "Close tab",
      onClick: () => closeThreadTab(sessionId, threadKey),
    });
  }
  return items;
}

/**
 * Offered for an open, closable thread tab of any leader whose tab projection
 * this browser holds. The projection carries the server's closability, and
 * the server checks it again when closing.
 */
function canCloseThreadTab(sessionId: string, threadKey: string): boolean {
  if (normalizeThreadKey(threadKey) === MAIN_THREAD_KEY) return false;
  const tabs = resolveLeaderThreadTabsProjection(useStore.getState(), sessionId);
  return (
    tabs.projectionState === "accepted" &&
    tabs.value.tabs.some((tab) => tab.threadKey === normalizeThreadKey(threadKey) && tab.canClose)
  );
}

/**
 * The session on screen closes the tab in its own view; any other leader's tab
 * is closed by the server, which then updates every browser's tabs.
 */
function closeThreadTab(sessionId: string, threadKey: string) {
  if (useStore.getState().currentSessionId === sessionId) {
    const event = new CustomEvent(CLOSE_THREAD_TAB_EVENT, { cancelable: true, detail: { sessionId, threadKey } });
    if (!window.dispatchEvent(event)) return;
  }
  api.closeLeaderThreadTab(sessionId, threadKey).catch(logFailure("Close tab"));
}

/**
 * Read a thread's Ready results without opening it: mark done the same review
 * notifications that viewing the thread clears. Loads the session's
 * notifications first when this browser has not seen them.
 */
export async function markThreadRead(sessionId: string, threadKey: string): Promise<void> {
  const target = normalizeThreadKey(threadKey);
  const notifications =
    useStore.getState().sessionNotifications.get(sessionId) ?? (await api.getSessionNotifications(sessionId));
  const reviews = notifications.filter((notification) => {
    if (notification.category !== "review" || notification.done) return false;
    const quests = parseQuestIdsFromReviewSummary(notification.summary).map(normalizeThreadKey);
    return quests.length > 1 ? quests.includes(target) : resolveNotificationOwnerThreadKey(notification) === target;
  });
  await Promise.all(reviews.map((notification) => api.markNotificationDone(sessionId, notification.id, true)));
}
