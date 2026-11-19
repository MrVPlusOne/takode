import { leaderMessageThreadKey } from "../shared/leader-thread-response-routing.js";
import { parseThreadTextPrefix } from "../shared/thread-routing.js";
import { canonicalThreadStatusKey } from "../shared/thread-status-marker.js";
import { threadAddress } from "../shared/topic-thread-key.js";
import { authoritativeMessageOwner } from "./authoritative-message-owner.js";
import { buildLeaderUserMessageIdentities, type LeaderUserMessageIdentity } from "./leader-user-message-id.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import { questSources } from "./quest-source-index.js";
import type { QuestStartedFrom } from "./quest-types.js";
import type { BrowserIncomingMessage } from "./session-types.js";

/** The user's request a side quest helps answer, in its leader's history. */
export interface SideQuestSource {
  /** The thread that owns the request now, where the leader answers it. */
  threadKey: string;
  /** The request's session-scoped ID (uN) that answers name. */
  userMessageId: string;
  historyIndex: number;
  /** When the user sent the request. */
  timestamp: number;
}

/** The leader's answer that delivered a side quest's result. */
export interface SideQuestAnswer {
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
   * The threads the user reads a conversation in: ones the user has written in (typed
   * messages, comments, answers to the leader's questions) and ones holding a leader
   * answer, with or without the messages it answers, or a published report.
   */
  conversationThreads: ReadonlySet<string>;
}

export function indexLeaderRequests(history: ReadonlyArray<BrowserIncomingMessage>): LeaderRequestIndex {
  const identities = buildLeaderUserMessageIdentities(history);
  const conversationThreads = new Set(identities.map((entry) => authoritativeMessageOwner(entry.message).threadKey));
  for (const message of history) {
    if (!isRootAgentHistoryMessage(message)) continue;
    // Commentary stays out: only what the user is meant to read there makes it a conversation.
    if ((message.type === "assistant" && message.threadAnswer) || message.type === "markdown_report") {
      conversationThreads.add(leaderMessageThreadKey(message));
    }
  }
  return {
    byMessageId: new Map(identities.map((entry) => [entry.historyMessageId, entry])),
    conversationThreads,
  };
}

/**
 * A side quest was filed (`--source-message uN`) from a user's request that still belongs
 * to another thread of the same leader: the leader answers that request where it was
 * asked, so the quest's own thread is not where its result lands and its completion makes
 * nothing unread. The quest is an ordinary one once the conversation is in its own thread:
 * the request was moved into it (handoff), the leader filed it as its own conversation
 * (`--own-thread`), or the user wrote a message there. Leader answers and reports in its
 * thread count too, but since Nov 18, 2026 Takode moves those to the asking thread
 * (sideQuestOf), so only ones written before then make a quest ordinary.
 * Returns null when the quest is not a side quest or the request is not in this history,
 * so callers keep today's behavior.
 */
export function findSideQuestSource(
  requests: LeaderRequestIndex,
  leaderSessionId: string,
  questId: string,
  startedFrom: QuestStartedFrom | undefined,
): SideQuestSource | null {
  if (!startedFrom || startedFrom.sessionId !== leaderSessionId || startedFrom.ownThread) return null;
  const identity = requests.byMessageId.get(startedFrom.messageId);
  if (!identity) return null;
  const threadKey = authoritativeMessageOwner(identity.message).threadKey;
  const questKey = questId.toLowerCase();
  if (threadKey === questKey || requests.conversationThreads.has(questKey)) return null;
  return {
    threadKey,
    userMessageId: identity.userMessageId,
    historyIndex: identity.historyIndex,
    timestamp: identity.message.timestamp,
  };
}

/**
 * The request a leader's quest thread is a side quest of, if it is one now, from the quest
 * sources Takode keeps in memory. Takode uses it where the leader writes or is told something
 * in that thread, to send results to the thread where the user asked. A side quest of Main
 * (asked before Main became the leader's log) is left alone: Main takes no answers.
 */
export function sideQuestOf(
  history: ReadonlyArray<BrowserIncomingMessage>,
  leaderSessionId: string,
  threadKey: string,
): SideQuestSource | null {
  const startedFrom = mineFiledFrom(leaderSessionId, threadKey);
  if (!startedFrom) return null;
  const source = findSideQuestSource(indexLeaderRequests(history), leaderSessionId, threadKey, startedFrom);
  return source && source.threadKey !== "main" ? source : null;
}

/** A side quest in progress whose result has not been posted where the user asked. */
export interface OwedSideQuest {
  questId: string;
  source: SideQuestSource;
}

/**
 * The side quests on the leader's board asked from `threadKey` whose result is still owed
 * there: no answer to their request after the turn that put them on the board. The asking
 * thread waits for them; a quest that leaves the board (done or removed) is no longer owed.
 */
export function owedSideQuests(
  history: ReadonlyArray<BrowserIncomingMessage>,
  leaderSessionId: string,
  threadKey: string,
  boardRows: Iterable<{ questId: string; createdAt: number }>,
): OwedSideQuest[] {
  const candidates = [...boardRows].filter((row) => mineFiledFrom(leaderSessionId, row.questId));
  if (candidates.length === 0) return [];
  const requests = indexLeaderRequests(history);
  const asked = canonicalThreadStatusKey(threadKey);
  const owed: OwedSideQuest[] = [];
  for (const row of candidates) {
    const source = findSideQuestSource(requests, leaderSessionId, row.questId, questSources.get(row.questId));
    if (!source || canonicalThreadStatusKey(source.threadKey) !== asked) continue;
    if (findSideQuestAnswer(history, source, row.questId, row.createdAt)) continue;
    owed.push({ questId: row.questId.toLowerCase(), source });
  }
  return owed;
}

/**
 * The side quest a user's message in its thread turns into an ordinary quest: the quest was a
 * side quest until this message. Takode tells the leader with the message, so it answers there.
 */
export function sideQuestEndedBy(
  history: ReadonlyArray<BrowserIncomingMessage>,
  leaderSessionId: string,
  message: Extract<BrowserIncomingMessage, { type: "user_message" }>,
): { questId: string; source: SideQuestSource } | null {
  const questId = authoritativeMessageOwner(message).questId;
  if (!questId) return null;
  const startedFrom = mineFiledFrom(leaderSessionId, questId);
  if (!startedFrom) return null;
  const before = history.filter((entry) => entry !== message);
  const source = findSideQuestSource(indexLeaderRequests(before), leaderSessionId, questId, startedFrom);
  return source ? { questId, source } : null;
}

/** What a leader reads about a side quest: where its result goes and whether it went there yet. */
export function formatSideQuestNote(questId: string, source: SideQuestSource, resultPosted: boolean): string {
  const asked = threadAddress(source.threadKey);
  return resultPosted
    ? `${questId} is a side quest of ${asked}; you posted its result there (answer to ${source.userMessageId}). Post anything new about it there too.`
    : `${questId} is a side quest of ${asked}: when its result is ready, post it in ${asked} as an answer to ${source.userMessageId}. ${asked} waits for it until then.`;
}

/** The note for a side quest, with whether its result went out yet; null for any other thread. */
export function sideQuestNoteFor(
  history: ReadonlyArray<BrowserIncomingMessage>,
  leaderSessionId: string,
  threadKey: string,
  boardCreatedAt: number | undefined,
): string | null {
  const source = sideQuestOf(history, leaderSessionId, threadKey);
  if (!source) return null;
  // Off the board, the request's own time stands in, so a "filed it" answer still doesn't count.
  const posted = !!findSideQuestAnswer(history, source, threadKey, boardCreatedAt ?? source.timestamp);
  return formatSideQuestNote(threadKey.toLowerCase(), source, posted);
}

/**
 * For quests filed from this leader's messages, the thread each one is a side quest of:
 * findSideQuestSource for many quests over one index of the history.
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
    const source = findSideQuestSource(requests, leaderSessionId, questId, startedFrom);
    if (source) result.set(questId.toLowerCase(), source.threadKey);
  }
  return result;
}

/**
 * The latest answer to a side quest's request written outside the quest's own
 * thread, in a leader turn that started after the quest was filed. An answer in the
 * filing turn ("filed it") came before the quest's result, so it does not count.
 */
export function findSideQuestAnswer(
  history: ReadonlyArray<BrowserIncomingMessage>,
  source: SideQuestSource,
  questId: string,
  questCreatedAt: number,
): SideQuestAnswer | null {
  let turnStartedAt = 0;
  let found: SideQuestAnswer | null = null;
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

/** The quest's source when it was filed from this leader's messages, as a side quest can be. */
function mineFiledFrom(leaderSessionId: string, questId: string): QuestStartedFrom | null {
  if (!/^q-\d+$/i.test(questId)) return null;
  const startedFrom = questSources.get(questId);
  return startedFrom?.sessionId === leaderSessionId && !startedFrom.ownThread ? startedFrom : null;
}
