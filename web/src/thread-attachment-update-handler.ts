import { FEED_WINDOW_SYNC_VERSION } from "../shared/feed-window-sync.js";
import {
  getHistoryWindowTurnCount,
  HISTORY_WINDOW_SECTION_TURN_COUNT,
  HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
} from "../shared/history-window.js";
import { getThreadWindowItemCount, MAIN_THREAD_KEY } from "../shared/thread-window.js";
import { useStore } from "./store.js";
import type { ChatMessage, ThreadAttachmentUpdate } from "./types.js";
import { normalizeHistoryMessageToChatMessages } from "./utils/history-message-normalization.js";
import { invalidateHistoryWindowCache, invalidateThreadWindowCache } from "./utils/history-window-cache.js";
import { recordFrontendPerfEntry } from "./utils/frontend-perf-recorder.js";
import { isAllThreadsKey, isMainThreadKey, normalizeThreadKey } from "./utils/thread-projection.js";
import type { WsMessageHandlerDeps } from "./ws-handlers.js";

const APPLIED_UPDATE_ID_LIMIT = 200;

const appliedUpdateIdsBySession = new Map<string, Set<string>>();

export function applyThreadAttachmentUpdate(
  sessionId: string,
  update: ThreadAttachmentUpdate,
  deps: WsMessageHandlerDeps,
): void {
  const startedAt = perfNow();
  const stats = threadAttachmentUpdateStats(update);
  const recoveryReason = validateThreadAttachmentUpdate(update);
  if (recoveryReason) {
    invalidateThreadAttachmentWindows(sessionId, update.affectedThreadKeys ?? []);
    requestLatestMainWindow(sessionId, deps);
    requestAffectedThreadWindows(sessionId, update.affectedThreadKeys ?? [], deps);
    recordFrontendPerfEntry({
      kind: "thread_attachment_update_apply",
      timestamp: Date.now(),
      sessionId,
      ...stats,
      requestedHistoryWindowCount: 1,
      requestedThreadWindowCount: threadWindowRequestCount(update.affectedThreadKeys ?? []),
      durationMs: perfNow() - startedAt,
      ok: false,
      recoveryReason,
    });
    return;
  }

  if (hasAppliedThreadAttachmentUpdate(sessionId, update.updateId)) {
    recordFrontendPerfEntry({
      kind: "thread_attachment_update_apply",
      timestamp: Date.now(),
      sessionId,
      ...stats,
      requestedHistoryWindowCount: 0,
      requestedThreadWindowCount: 0,
      durationMs: perfNow() - startedAt,
      ok: true,
      deduped: true,
    });
    return;
  }

  rememberAppliedThreadAttachmentUpdate(sessionId, update.updateId);
  invalidateThreadAttachmentWindows(sessionId, update.affectedThreadKeys);
  patchLoadedThreadRefs(sessionId, update);
  appendThreadAttachmentMarkers(sessionId, update);
  requestLatestMainWindow(sessionId, deps);
  const requestedThreadWindowCount = requestAffectedThreadWindows(sessionId, update.affectedThreadKeys, deps);

  recordFrontendPerfEntry({
    kind: "thread_attachment_update_apply",
    timestamp: Date.now(),
    sessionId,
    ...stats,
    requestedHistoryWindowCount: 1,
    requestedThreadWindowCount,
    durationMs: perfNow() - startedAt,
    ok: true,
  });
}

function validateThreadAttachmentUpdate(update: ThreadAttachmentUpdate): string | null {
  if (update.version !== 1) return "unsupported_version";
  if (!update.updateId) return "missing_update_id";
  if (!Array.isArray(update.updates)) return "missing_updates";
  return null;
}

function hasAppliedThreadAttachmentUpdate(sessionId: string, updateId: string): boolean {
  return appliedUpdateIdsBySession.get(sessionId)?.has(updateId) ?? false;
}

function rememberAppliedThreadAttachmentUpdate(sessionId: string, updateId: string): void {
  const existing = appliedUpdateIdsBySession.get(sessionId) ?? new Set<string>();
  existing.add(updateId);
  while (existing.size > APPLIED_UPDATE_ID_LIMIT) {
    const oldest = existing.values().next().value;
    if (!oldest) break;
    existing.delete(oldest);
  }
  appliedUpdateIdsBySession.set(sessionId, existing);
}

function invalidateThreadAttachmentWindows(sessionId: string, affectedThreadKeys: string[]): void {
  const store = useStore.getState();
  invalidateHistoryWindowCache(sessionId);
  store.setHistoryWindow(sessionId, null);
  for (const threadKey of uniqueThreadKeys(affectedThreadKeys)) {
    if (isMainThreadKey(threadKey) || isAllThreadsKey(threadKey)) continue;
    invalidateThreadWindowCache(sessionId, threadKey);
    store.setThreadWindow(sessionId, threadKey, null);
  }
}

function patchLoadedThreadRefs(sessionId: string, update: ThreadAttachmentUpdate): void {
  const store = useStore.getState();
  const messages = store.messages.get(sessionId) ?? [];
  for (const changed of update.updates.flatMap((item) => item.changedMessages)) {
    const message = findLoadedMessage(messages, changed.historyIndex, changed.messageId);
    if (!message) continue;
    store.updateMessage(sessionId, message.id, {
      metadata: {
        ...(message.metadata ?? {}),
        threadRefs: changed.threadRefs,
      },
    });
  }
}

function findLoadedMessage(
  messages: ReadonlyArray<ChatMessage>,
  historyIndex: number,
  messageId: string,
): ChatMessage | undefined {
  return (
    messages.find((message) => message.historyIndex === historyIndex) ??
    messages.find((message) => message.id === messageId)
  );
}

function appendThreadAttachmentMarkers(sessionId: string, update: ThreadAttachmentUpdate): void {
  const store = useStore.getState();
  for (const item of update.updates) {
    item.markers.forEach((marker, index) => {
      const historyIndex = item.markerHistoryIndices[index] ?? -1;
      const [message] = normalizeHistoryMessageToChatMessages(marker, historyIndex);
      if (message) store.appendMessage(sessionId, message);
    });
  }
}

function requestLatestMainWindow(sessionId: string, deps: WsMessageHandlerDeps): void {
  deps.sendToSession(sessionId, {
    type: "history_window_request",
    from_turn: -1,
    turn_count: getHistoryWindowTurnCount(HISTORY_WINDOW_VISIBLE_SECTION_COUNT, HISTORY_WINDOW_SECTION_TURN_COUNT),
    section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
    visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
    feed_window_sync_version: FEED_WINDOW_SYNC_VERSION,
  });
}

function requestAffectedThreadWindows(
  sessionId: string,
  affectedThreadKeys: string[],
  deps: WsMessageHandlerDeps,
): number {
  let requested = 0;
  for (const threadKey of uniqueThreadKeys(affectedThreadKeys)) {
    if (isMainThreadKey(threadKey) || isAllThreadsKey(threadKey)) continue;
    deps.sendToSession(sessionId, {
      type: "thread_window_request",
      thread_key: threadKey,
      from_item: -1,
      item_count: getThreadWindowItemCount(HISTORY_WINDOW_VISIBLE_SECTION_COUNT, HISTORY_WINDOW_SECTION_TURN_COUNT),
      section_item_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_item_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      feed_window_sync_version: FEED_WINDOW_SYNC_VERSION,
    });
    requested++;
  }
  return requested;
}

function threadWindowRequestCount(affectedThreadKeys: string[]): number {
  return uniqueThreadKeys(affectedThreadKeys).filter(
    (threadKey) => !isMainThreadKey(threadKey) && !isAllThreadsKey(threadKey),
  ).length;
}

function uniqueThreadKeys(threadKeys: string[]): string[] {
  const keys = new Set<string>();
  for (const threadKey of threadKeys) {
    const normalized = normalizeThreadKey(threadKey || MAIN_THREAD_KEY) || MAIN_THREAD_KEY;
    keys.add(normalized);
  }
  return [...keys];
}

function threadAttachmentUpdateStats(update: ThreadAttachmentUpdate): {
  updateCount: number;
  markerCount: number;
  changedMessageCount: number;
  affectedThreadCount: number;
} {
  const updates = Array.isArray(update.updates) ? update.updates : [];
  return {
    updateCount: updates.length,
    markerCount: updates.reduce((count, item) => count + item.markers.length, 0),
    changedMessageCount: updates.reduce((count, item) => count + item.changedMessages.length, 0),
    affectedThreadCount: update.affectedThreadKeys?.length ?? 0,
  };
}

function perfNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
