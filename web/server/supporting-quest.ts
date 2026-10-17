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

/** The leader's user messages by history ID, built once to check many quests. */
export function indexLeaderRequests(
  history: ReadonlyArray<BrowserIncomingMessage>,
): ReadonlyMap<string, LeaderUserMessageIdentity> {
  return new Map(buildLeaderUserMessageIdentities(history).map((entry) => [entry.historyMessageId, entry]));
}

/**
 * A supporting quest was filed (`--source-message uN`) from a user's request that
 * still belongs to another thread of the same leader: the leader answers that request
 * where it was asked, so the quest's own thread is never where its result lands and
 * its completion makes nothing unread. A request moved into the quest (Main-to-quest
 * handoff) makes it an ordinary quest. Returns null when the quest is not supporting
 * or the request is not in this history, so callers keep today's behavior.
 */
export function findSupportingQuestSource(
  requests: ReadonlyMap<string, LeaderUserMessageIdentity>,
  leaderSessionId: string,
  questId: string,
  startedFrom: QuestStartedFrom | undefined,
): SupportingQuestSource | null {
  if (!startedFrom || startedFrom.sessionId !== leaderSessionId) return null;
  const identity = requests.get(startedFrom.messageId);
  if (!identity) return null;
  const threadKey = authoritativeMessageOwner(identity.message).threadKey;
  if (threadKey === questId.toLowerCase()) return null;
  return {
    threadKey,
    userMessageId: identity.userMessageId,
    historyIndex: identity.historyIndex,
  };
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
