/**
 * Joining a thread onto the earlier conversation it continues. A leader's Scribe notices that a new
 * thread picks up an earlier one (another thread, or a quest's thread) and joins them: the newer
 * thread's messages are attached to the earlier conversation, which shows them after its own with a
 * marker where they begin, and the newer thread leaves the lists (its address opens the earlier
 * conversation). The user can undo a wrong join from the marker, and the Scribe can undo its own
 * when it notices one, then join the thread where it belongs. A thread whose requests went to a
 * quest joins only that quest. The same attachment machinery as `takode thread handoff` carries the
 * messages, so live views move at once.
 */
import { messageThreadKeys } from "../shared/message-threads.js";
import { questsOfThread } from "./thread-requests.js";
import { normalizeThreadKey } from "../shared/leader-projection.js";
import type { ThreadSummary } from "../shared/library-topics.js";
import { broadcastNotificationRefresh } from "./bridge/session-notification-controller.js";
import type { BrowserIncomingMessage, ThreadAttachmentMarker, ThreadRef } from "./session-types.js";
import { buildThreadAttachmentSelection, messageIdForThreadAttachment } from "./thread-routing-metadata.js";
import type { RouteContext } from "./routes/context.js";
import {
  pendingThreadAttachmentChangedCount,
  scheduleThreadAttachmentUpdateBroadcast,
  THREAD_ATTACHMENT_MAX_CHANGED_MESSAGES,
  THREAD_ATTACHMENT_RECENT_HISTORY_LIMIT,
} from "./routes/takode-thread-attachment-broadcast.js";
import { TopicStoreError, type TopicStore } from "./topic-store.js";

type Bridge = RouteContext["wsBridge"];

export interface ThreadJoined {
  thread: string;
  into: string;
  /** How many of the thread's messages now read in the earlier conversation. */
  messages: number;
  summary: ThreadSummary;
  /** The conversation the Scribe had joined it onto by mistake before this join. */
  movedFrom?: string;
}

/**
 * Joins `threadKey` (a thread of `leaderId`) onto `intoKey`: `q-N` (a quest on the leader's boards)
 * or a thread (`t-N`, or its older `topic:<handle>`). `by` is the session that asked (its Scribe).
 */
export function joinThread(
  bridge: Bridge,
  store: TopicStore,
  input: { leaderId: string; threadKey: string; intoKey: string; by: string },
): ThreadJoined {
  const threadKey = normalizeThreadKey(input.threadKey);
  const intoKey = normalizeThreadKey(input.intoKey);
  const thread = store.thread(threadKey)?.thread;
  if (!thread || thread.leaderId !== input.leaderId) {
    throw new TopicStoreError(`${input.threadKey} is not one of your leader's threads.`, 404);
  }
  const session = bridge.getSession(input.leaderId);
  if (!session) throw new TopicStoreError("Your leader's session isn't loaded.", 404);
  const questId = /^q-\d+$/.test(intoKey) ? intoKey : undefined;
  if (
    questId &&
    !session.board.has(questId) &&
    !(session as { completedBoard?: Map<string, unknown> }).completedBoard?.has(questId)
  ) {
    throw new TopicStoreError(`${questId} is not on your leader's board.`, 404);
  }
  if (!questId && !intoKey.startsWith("topic:")) {
    throw new TopicStoreError("Join onto a quest's thread (q-N) or another thread (t-N).");
  }
  // Its requests went to a quest: that quest is where the thread's work continues, not another.
  const wentTo = questsOfThread(session.messageHistory, threadKey);
  if (questId && wentTo.length && !wentTo.includes(questId)) {
    throw new TopicStoreError(
      `${input.threadKey}'s requests went to ${wentTo.join(", ")}: join it onto ${wentTo.length === 1 ? "that quest" : "one of those"}, or leave it on its own.`,
      409,
    );
  }
  // Checks the destination and records the join before anything is attached.
  const summary = store.joinThread(threadKey, intoKey);
  const into = summary.quest ?? summary.joinedInto ?? intoKey;
  const movedFrom = store.takeMovedFrom(threadKey);

  const indices = threadMessageIndices(session.messageHistory, threadKey);
  const timestamp = Date.now();
  const ref: ThreadRef = {
    threadKey: into,
    ...(questId ? { questId } : {}),
    source: "backfill",
    attachedAt: timestamp,
    attachedBy: input.by,
    joinedFrom: threadKey,
    ...(movedFrom ? { movedFrom } : {}),
  };
  for (const index of indices) {
    const message = session.messageHistory[index]!;
    message.threadRefs = [...(message.threadRefs ?? []), ref];
  }
  const target = { threadKey: into, ...(questId ? { questId } : {}) };
  const markers: ThreadAttachmentMarker[] = [];
  const markerHistoryIndices: number[] = [];
  if (indices.length) {
    const selection = buildThreadAttachmentSelection(session.messageHistory, into, indices);
    markerHistoryIndices.push(session.messageHistory.length);
    const marker: ThreadAttachmentMarker = {
      type: "thread_attachment_marker",
      id: `thread-join-${timestamp}-${session.messageHistory.length}`,
      markerKey: `join:${threadKey}:${selection.markerKey}`,
      timestamp,
      sourceThreadKey: threadKey,
      ...target,
      attachedAt: timestamp,
      attachedBy: input.by,
      messageIds: selection.messageIds,
      messageIndices: selection.indices,
      ranges: selection.ranges,
      count: selection.indices.length,
      firstMessageId: selection.firstMessageId,
      firstMessageIndex: selection.firstMessageIndex,
    };
    session.messageHistory.push(marker);
    markers.push(marker);
  }
  // Browsers hear of the recent messages at once (the update is bounded); a conversation loaded
  // later carries every ref, from the history.
  const room = THREAD_ATTACHMENT_MAX_CHANGED_MESSAGES - pendingThreadAttachmentChangedCount(input.leaderId);
  const recentFrom = Math.max(0, session.messageHistory.length - THREAD_ATTACHMENT_RECENT_HISTORY_LIMIT);
  const recent = room > 0 ? indices.filter((index) => index >= recentFrom).slice(-room) : [];
  broadcastRefs(bridge, input.leaderId, { target, source: threadKey, indices: recent, markers, markerHistoryIndices });

  // What still waits on the user in the thread (a question, an unread answer) moves with it.
  let movedNotifications = false;
  for (const notification of session.notifications) {
    if (notification.done || normalizeThreadKey(notification.threadKey ?? "") !== threadKey) continue;
    Object.assign(notification, target);
    movedNotifications = true;
  }
  if (movedNotifications) {
    broadcastNotificationRefresh(session, {
      broadcastToBrowsers: (_session, message) => bridge.broadcastToSession(input.leaderId, message),
      persistSession: () => bridge.persistSessionById(input.leaderId, indices),
    });
  } else {
    bridge.persistSessionById(input.leaderId, indices);
  }
  return { thread: threadKey, into, messages: indices.length, summary, ...(movedFrom ? { movedFrom } : {}) };
}

/**
 * Undoes a join the Scribe made (the user's Undo on the marker, or the Scribe's own when it finds
 * the join wrong): the thread is a conversation of its own again and its messages leave the earlier
 * one.
 */
export function unjoinThread(
  bridge: Bridge,
  store: TopicStore,
  input: { leaderId: string; threadKey: string; byScribe?: boolean },
): { thread: ThreadSummary; from: string } {
  const threadKey = normalizeThreadKey(input.threadKey);
  const thread = store.thread(threadKey)?.thread;
  if (!thread || thread.leaderId !== input.leaderId) throw new TopicStoreError("Thread not found.", 404);
  const { thread: summary, from } = store.unjoinThread(threadKey, input.byScribe);
  const session = bridge.getSession(input.leaderId);
  if (!session) return { thread: summary, from };
  const indices: number[] = [];
  session.messageHistory.forEach((message, index) => {
    const refs = message.threadRefs;
    if (!refs?.some((ref) => ref.joinedFrom === threadKey)) return;
    message.threadRefs = refs.filter((ref) => ref.joinedFrom !== threadKey);
    indices.push(index);
  });
  const questId = /^q-\d+$/.test(from) ? from : undefined;
  broadcastRefs(bridge, input.leaderId, {
    target: { threadKey: from, ...(questId ? { questId } : {}) },
    source: threadKey,
    indices,
    markers: [],
    markerHistoryIndices: [],
  });
  bridge.persistSessionById(input.leaderId, indices);
  return { thread: summary, from };
}

/** The thread's messages, oldest first. */
function threadMessageIndices(history: readonly BrowserIncomingMessage[], threadKey: string): number[] {
  const indices: number[] = [];
  history.forEach((message, index) => {
    if (messageThreadKeys(message)?.includes(threadKey)) indices.push(index);
  });
  return indices;
}

function broadcastRefs(
  bridge: Bridge,
  leaderId: string,
  input: {
    target: { threadKey: string; questId?: string };
    source: string;
    indices: number[];
    markers: ThreadAttachmentMarker[];
    markerHistoryIndices: number[];
  },
): void {
  const session = bridge.getSession(leaderId);
  if (!session || (!input.indices.length && !input.markers.length)) return;
  scheduleThreadAttachmentUpdateBroadcast(bridge, leaderId, {
    target: input.target,
    source: { threadKey: input.source },
    markers: input.markers,
    markerHistoryIndices: input.markerHistoryIndices,
    changedMessages: input.indices.map((historyIndex) => {
      const message = session.messageHistory[historyIndex]!;
      return {
        historyIndex,
        messageId: messageIdForThreadAttachment(message, historyIndex),
        threadRefs: message.threadRefs ?? [],
      };
    }),
    ranges: input.markers[0]?.ranges ?? [],
    count: input.indices.length,
  });
}
