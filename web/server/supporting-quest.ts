import { leaderMessageThreadKey } from "../shared/leader-thread-response-routing.js";
import { parseThreadTextPrefix } from "../shared/thread-routing.js";
import { authoritativeMessageOwner } from "./authoritative-message-owner.js";
import { buildLeaderUserMessageIdentities, type LeaderUserMessageIdentity } from "./leader-user-message-id.js";
import type { QuestStartedFrom } from "./quest-types.js";
import type { BrowserIncomingMessage } from "./session-types.js";

/** The user's request a supporting quest helps answer, in its leader's history. */
export interface SupportingQuestSource {
  /** The thread that owns the request now, where the leader answers it. */
  threadKey: string;
  /** The request's session-scoped ID (uN) that answers name. */
  userMessageId: string;
  historyIndex: number;
}

/** The leader's answer that delivered a supporting quest's result. */
export interface SupportingQuestAnswer {
  messageId: string;
  /** The thread the answer was written in. */
  threadKey: string;
  timestamp: number;
  markdown: string;
}

/** The user's messages in a leader's history, built once to check many quests. */
export interface LeaderRequestIndex {
  /** The user's messages by history ID. */
  byMessageId: ReadonlyMap<string, LeaderUserMessageIdentity>;
  /**
   * The threads the user has written in: typed messages and comments, not answers to the
   * leader's questions, which the leader asks in a quest's tab as part of that quest's work.
   */
  threadsWithUserMessages: ReadonlySet<string>;
}

export function indexLeaderRequests(history: ReadonlyArray<BrowserIncomingMessage>): LeaderRequestIndex {
  const identities = buildLeaderUserMessageIdentities(history);
  return {
    byMessageId: new Map(identities.map((entry) => [entry.historyMessageId, entry])),
    threadsWithUserMessages: new Set(
      identities
        .filter((entry) => !entry.message.replyContext?.notificationId)
        .map((entry) => authoritativeMessageOwner(entry.message).threadKey),
    ),
  };
}

/**
 * A supporting (side) quest was filed (`--source-message uN`) from a user's request that
 * still belongs to another thread of the same leader: the leader answers that request
 * where it was asked, so the quest's own thread is not where its result lands and its
 * completion makes nothing unread. The quest is an ordinary one once the conversation
 * is in its own thread: the request was moved into it (Main-to-quest handoff), or the
 * user wrote a message there. Returns null when the quest is not supporting or the
 * request is not in this history, so callers keep today's behavior.
 */
export function findSupportingQuestSource(
  requests: LeaderRequestIndex,
  leaderSessionId: string,
  questId: string,
  startedFrom: QuestStartedFrom | undefined,
): SupportingQuestSource | null {
  if (!startedFrom || startedFrom.sessionId !== leaderSessionId) return null;
  const identity = requests.byMessageId.get(startedFrom.messageId);
  if (!identity) return null;
  const threadKey = authoritativeMessageOwner(identity.message).threadKey;
  const questKey = questId.toLowerCase();
  if (threadKey === questKey || requests.threadsWithUserMessages.has(questKey)) return null;
  return {
    threadKey,
    userMessageId: identity.userMessageId,
    historyIndex: identity.historyIndex,
  };
}

/**
 * For quests filed from this leader's messages, the thread each one is a side quest of:
 * findSupportingQuestSource for many quests over one index of the history.
 */
export function sideQuestSourceThreads(
  history: ReadonlyArray<BrowserIncomingMessage>,
  leaderSessionId: string,
  sources: ReadonlyMap<string, QuestStartedFrom>,
): Map<string, string> {
  const result = new Map<string, string>();
  const mine = [...sources].filter(([, startedFrom]) => startedFrom.sessionId === leaderSessionId);
  if (mine.length === 0) return result;
  const requests = indexLeaderRequests(history);
  for (const [questId, startedFrom] of mine) {
    const source = findSupportingQuestSource(requests, leaderSessionId, questId, startedFrom);
    if (source) result.set(questId.toLowerCase(), source.threadKey);
  }
  return result;
}

/**
 * The latest answer to a supporting quest's request written outside the quest's own
 * thread, in a leader turn that started after the quest was filed. An answer in the
 * filing turn ("filed it") came before the quest's result, so it does not count.
 */
export function findSupportingQuestAnswer(
  history: ReadonlyArray<BrowserIncomingMessage>,
  source: SupportingQuestSource,
  questId: string,
  questCreatedAt: number,
): SupportingQuestAnswer | null {
  let turnStartedAt = 0;
  let found: SupportingQuestAnswer | null = null;
  for (let index = source.historyIndex; index < history.length; index++) {
    const message = history[index]!;
    // Leader turns start at user messages, including herd events and timer firings.
    if (message.type === "user_message") {
      turnStartedAt = message.timestamp ?? turnStartedAt;
      continue;
    }
    if (message.type !== "assistant" || message.parent_tool_use_id != null || !message.threadAnswer) continue;
    if (!message.threadAnswer.answerUserMessageIds.includes(source.userMessageId)) continue;
    if (turnStartedAt <= questCreatedAt) continue;
    const threadKey = leaderMessageThreadKey(message);
    if (threadKey === questId.toLowerCase()) continue;
    const text = message.message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n");
    // Stored answers normally have their routing marker removed; strip one that survived.
    const parsed = parseThreadTextPrefix(text);
    const markdown = (parsed.ok ? parsed.body : text).trim();
    if (!markdown || !message.message.id) continue;
    found = {
      messageId: message.message.id,
      threadKey,
      timestamp: message.timestamp ?? 0,
      markdown,
    };
  }
  return found;
}
