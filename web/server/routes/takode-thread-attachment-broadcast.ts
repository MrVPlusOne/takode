import type { ThreadAttachmentUpdate, ThreadAttachmentUpdateEntry } from "../session-types.js";
import type { RouteContext } from "./context.js";
import { normalizeAffectedThreadKey } from "./takode-route-thread-helpers.js";

const THREAD_ATTACHMENT_HISTORY_BROADCAST_DELAY_MS = 100;
const THREAD_ATTACHMENT_UPDATE_VERSION = 1;
export const THREAD_ATTACHMENT_RECENT_HISTORY_LIMIT = 300;
export const THREAD_ATTACHMENT_MAX_CHANGED_MESSAGES = 100;

const pendingThreadAttachmentUpdates = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; changedCount: number; updates: ThreadAttachmentUpdateEntry[] }
>();

export function pendingThreadAttachmentChangedCount(sessionId: string): number {
  return pendingThreadAttachmentUpdates.get(sessionId)?.changedCount ?? 0;
}

function threadAttachmentEntryAttachedAt(update: ThreadAttachmentUpdateEntry): number | undefined {
  const markerAttachedAt = update.markers[0]?.attachedAt;
  if (typeof markerAttachedAt === "number") return markerAttachedAt;
  for (const message of update.changedMessages) {
    const refAttachedAt = message.threadRefs.find((ref) => typeof ref.attachedAt === "number")?.attachedAt;
    if (typeof refAttachedAt === "number") return refAttachedAt;
  }
  return undefined;
}

function threadAttachmentEntryAttachedBy(update: ThreadAttachmentUpdateEntry): string | undefined {
  const markerAttachedBy = update.markers[0]?.attachedBy;
  if (markerAttachedBy) return markerAttachedBy;
  for (const message of update.changedMessages) {
    const refAttachedBy = message.threadRefs.find((ref) => ref.attachedBy)?.attachedBy;
    if (refAttachedBy) return refAttachedBy;
  }
  return undefined;
}

export function buildThreadAttachmentBoundError(input: {
  questId: string;
  historyLength: number;
  selectedIndices: number[];
  changedCount: number;
  pendingChangedCount: number;
}): Record<string, unknown> | null {
  const minAllowedIndex = Math.max(0, input.historyLength - THREAD_ATTACHMENT_RECENT_HISTORY_LIMIT);
  const validSelectedIndices = input.selectedIndices.filter((index) => index >= 0 && index < input.historyLength);
  const minSelectedIndex = validSelectedIndices[0];
  const maxSelectedIndex = validSelectedIndices[validSelectedIndices.length - 1];
  if (typeof minSelectedIndex === "number" && minSelectedIndex < minAllowedIndex) {
    return {
      error: "Thread attach range is outside the recent bounded update window",
      code: "THREAD_ATTACH_OUTSIDE_RECENT_WINDOW",
      questId: input.questId,
      historyLength: input.historyLength,
      minSelectedIndex,
      maxSelectedIndex,
      minAllowedIndex,
      maxDistanceFromTail: THREAD_ATTACHMENT_RECENT_HISTORY_LIMIT,
      maxChangedMessages: THREAD_ATTACHMENT_MAX_CHANGED_MESSAGES,
      suggestion: "Attach recent messages only.",
    };
  }
  if (input.pendingChangedCount + input.changedCount > THREAD_ATTACHMENT_MAX_CHANGED_MESSAGES) {
    return {
      error: "Thread attach selection exceeds the bounded update message limit",
      code: "THREAD_ATTACH_TOO_MANY_MESSAGES",
      questId: input.questId,
      changedMessages: input.changedCount,
      pendingChangedMessages: input.pendingChangedCount,
      maxChangedMessages: THREAD_ATTACHMENT_MAX_CHANGED_MESSAGES,
      maxDistanceFromTail: THREAD_ATTACHMENT_RECENT_HISTORY_LIMIT,
      suggestion: "Attach fewer messages in this recent burst.",
    };
  }
  return null;
}

export function scheduleThreadAttachmentUpdateBroadcast(
  wsBridge: RouteContext["wsBridge"],
  sessionId: string,
  update: ThreadAttachmentUpdateEntry,
): void {
  const existing = pendingThreadAttachmentUpdates.get(sessionId);
  if (existing) clearTimeout(existing.timer);

  const updates = [...(existing?.updates ?? []), update];
  const changedCount = (existing?.changedCount ?? 0) + update.changedMessages.length;
  const timer = setTimeout(() => {
    pendingThreadAttachmentUpdates.delete(sessionId);
    const session = wsBridge.getSession(sessionId);
    if (!session) return;
    const timestamp = Date.now();
    const affectedThreadKeys = new Set<string>(["main"]);
    for (const item of updates) {
      const target = normalizeAffectedThreadKey(item.target.threadKey);
      const targetQuest = normalizeAffectedThreadKey(item.target.questId);
      const source = normalizeAffectedThreadKey(item.source?.threadKey);
      const sourceQuest = normalizeAffectedThreadKey(item.source?.questId);
      if (target) affectedThreadKeys.add(target);
      if (targetQuest) affectedThreadKeys.add(targetQuest);
      if (source) affectedThreadKeys.add(source);
      if (sourceQuest) affectedThreadKeys.add(sourceQuest);
    }
    const markerIds = updates.flatMap((item) => item.markers.map((marker) => marker.id));
    const event: ThreadAttachmentUpdate = {
      type: "thread_attachment_update",
      version: THREAD_ATTACHMENT_UPDATE_VERSION,
      updateId: `thread-attachment-update:${timestamp}:${markerIds.join(",") || changedCount}`,
      timestamp,
      attachedAt: threadAttachmentEntryAttachedAt(updates[0]!) ?? timestamp,
      attachedBy: threadAttachmentEntryAttachedBy(updates[0]!) ?? "",
      historyLength: session.messageHistory.length,
      affectedThreadKeys: [...affectedThreadKeys],
      maxDistanceFromTail: THREAD_ATTACHMENT_RECENT_HISTORY_LIMIT,
      maxChangedMessages: THREAD_ATTACHMENT_MAX_CHANGED_MESSAGES,
      updates,
    };
    wsBridge.broadcastToSession(sessionId, event);
  }, THREAD_ATTACHMENT_HISTORY_BROADCAST_DELAY_MS);
  pendingThreadAttachmentUpdates.set(sessionId, { timer, changedCount, updates });
}

export function _resetThreadAttachmentBroadcastsForTest(): void {
  for (const pending of pendingThreadAttachmentUpdates.values()) {
    clearTimeout(pending.timer);
  }
  pendingThreadAttachmentUpdates.clear();
}
