import { leaderMessageThreadKey } from "../shared/leader-thread-response-routing.js";
import { normalizeThreadKey } from "../shared/leader-projection.js";
import { normalizeThreadTarget } from "../shared/thread-routing.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import type { BrowserIncomingMessage, SessionNotification } from "./session-types.js";
import { threadConversationKey } from "./topic-views.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";

/**
 * When the user last dealt with each of a leader's threads (`main`, quests and other threads), the
 * order of the sessions panel's Threads view (Jiayi, Nov 1: like a chat app, the thread just used
 * on top). It is the later of
 * - the user's own message there: typed, a command, or the answer to a question asked there;
 * - the user marking one of its results or questions done in a browser: reading it (on screen or
 *   with Mark as read), or dismissing a question;
 * - the user viewing it: the chat showing it stayed focused for a moment (`viewedAt`, kept in
 *   `SessionState.threadViewedAt`; Jiayi, Nov 10: a thread just looked at must be easy to find again).
 * Takode's and agents' activity (a new answer, a quest moving on) doesn't count, so an unread
 * result doesn't move a thread. A thread joined onto another, or handed to a quest, counts as that
 * conversation.
 */
export function threadUserInteractionTimes(
  history: ReadonlyArray<BrowserIncomingMessage>,
  notifications: ReadonlyArray<SessionNotification>,
  viewedAt: Readonly<Record<string, number>> = {},
): Map<string, number> {
  const times = new Map<string, number>();
  const record = (threadKey: string, at: unknown) => {
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return;
    const key = threadConversationKey(normalizeThreadKey(threadKey));
    if (at > (times.get(key) ?? 0)) times.set(key, at);
  };
  for (const message of history) {
    if (!isRootAgentHistoryMessage(message) || !isActualHumanUserMessage(message)) continue;
    record(leaderMessageThreadKey(message as Parameters<typeof leaderMessageThreadKey>[0]), message.timestamp);
  }
  for (const notification of notifications) {
    if (!notification.userDoneAt) continue;
    const owner = notification.threadKey?.trim() || notification.questId || "main";
    record(normalizeThreadTarget(owner)?.threadKey ?? "main", notification.userDoneAt);
  }
  for (const [threadKey, at] of Object.entries(viewedAt)) record(threadKey, at);
  return times;
}
