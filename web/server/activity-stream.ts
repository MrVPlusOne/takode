import { formatAnnotatedMessage } from "../shared/conversation-annotations.js";
import { leaderMessageThreadKey } from "../shared/leader-thread-response-routing.js";
import { formatReplyContentForAssistant } from "../shared/reply-context.js";
import { MAIN_THREAD_KEY } from "../shared/thread-window.js";
import { authoritativeMessageOwner } from "./authoritative-message-owner.js";
import { assignSessionScopedLeaderUserMessageIds } from "../shared/leader-user-message-id.js";
import { isLeaderUserMessageWithId } from "./leader-user-message-id.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";

/** One session's history as the activity stream sees it. */
export interface ActivitySessionDocument {
  sessionId: string;
  sessionNum: number | null;
  sessionName: string;
  /** Display name of the session space (tree group) the session belongs to. */
  space: string;
  isOrchestrator: boolean;
  messageHistory: ReadonlyArray<BrowserIncomingMessage>;
}

/** A message in the stream. `index` is its history index, so `takode read <session> <index>` opens it. */
export interface ActivityMessage {
  /**
   * `user` for a message the user typed; `answer` for a final answer, to user messages
   * or (without `to`) a leader's new result that names no message; `report` for a
   * published `takode report`.
   */
  role: "user" | "answer" | "report";
  index: number;
  at: number;
  text: string;
  /** Full text length, present only when `text` was shortened. */
  chars?: number;
  images?: number;
  /** For answers to user messages: history indexes of the messages it answers. */
  to?: number[];
}

/** The stream of one session thread: a leader's Main or quest thread, or a whole non-leader session. */
export interface ActivityThread {
  session: number | null;
  sessionId: string;
  sessionName: string;
  space: string;
  /** Leader quest thread (`q-N`); absent for a leader's Main and for non-leader sessions. */
  thread?: string;
  /** In history order. User messages no answer names are unanswered. */
  messages: ActivityMessage[];
}

export interface BuildActivityStreamInput {
  documents: ReadonlyArray<ActivitySessionDocument>;
  since: number;
  until: number;
  /** Shorten each message to this many characters; omit for full text. */
  textLimit?: number;
}

/**
 * Build the user's activity stream for `[since, until)`: every message the user typed by
 * hand and every final message the user was shown. A leader's answers are its settled
 * explicit answers, whether they name the user's messages or present a new result that
 * names none; elsewhere the last reply of a turn answers the user messages sent during it.
 * Published reports are listed in every session. A message outside the window is still
 * listed when it answers, or is answered by, a message inside it. Threads are ordered by
 * their first listed message.
 */
export function buildActivityStream(input: BuildActivityStreamInput): ActivityThread[] {
  const threads: Array<ActivityThread & { firstAt: number }> = [];
  for (const document of input.documents) {
    const byThread = new Map<string, ActivityMessage[]>();
    for (const { message, thread } of sessionActivity(document, input)) {
      byThread.set(thread, [...(byThread.get(thread) ?? []), message]);
    }
    for (const [thread, messages] of byThread) {
      messages.sort((left, right) => left.index - right.index);
      threads.push({
        session: document.sessionNum,
        sessionId: document.sessionId,
        sessionName: document.sessionName,
        space: document.space,
        ...(thread !== MAIN_THREAD_KEY ? { thread } : {}),
        messages,
        firstAt: Math.min(...messages.map((message) => message.at)),
      });
    }
  }
  return threads.sort((left, right) => left.firstAt - right.firstAt).map(({ firstAt: _firstAt, ...thread }) => thread);
}

interface RawMessage {
  index: number;
  at: number;
  text: string;
  images: number;
}

/**
 * Per-history facts that only grow as messages are appended, so each call reads only the recent
 * part of a long history: the running maximum timestamp (everything before the first index whose
 * running maximum reaches `since` is outside the window) and the leader user messages that get
 * session-scoped IDs. Extended on append; rebuilt when the history shrank or its earlier part changed.
 */
interface HistoryIndex {
  length: number;
  last: BrowserIncomingMessage | undefined;
  maxTimestamp: number[];
  leaderAsks: Array<{ index: number; persistedId: string | undefined }>;
  /** The IDs assigned to `leaderAsks`, kept until another leader user message arrives. */
  leaderAskIds?: { count: number; indexById: Map<string, number>; indexes: Set<number> };
}
const historyIndexes = new WeakMap<ReadonlyArray<BrowserIncomingMessage>, HistoryIndex>();

function indexHistory(history: ReadonlyArray<BrowserIncomingMessage>): HistoryIndex {
  let cached = historyIndexes.get(history);
  if (!cached || cached.length > history.length || (cached.length > 0 && history[cached.length - 1] !== cached.last)) {
    cached = { length: 0, last: undefined, maxTimestamp: [], leaderAsks: [] };
    historyIndexes.set(history, cached);
  }
  let max = cached.maxTimestamp[cached.length - 1] ?? Number.NEGATIVE_INFINITY;
  for (let index = cached.length; index < history.length; index++) {
    const message = history[index]!;
    const at = Number((message as { timestamp?: unknown }).timestamp);
    if (at > max) max = at;
    cached.maxTimestamp.push(max);
    if (isLeaderUserMessageWithId(message)) cached.leaderAsks.push({ index, persistedId: message.leaderUserMessageId });
  }
  cached.length = history.length;
  cached.last = history[history.length - 1];
  return cached;
}

function leaderAskIds(index: HistoryIndex): NonNullable<HistoryIndex["leaderAskIds"]> {
  if (index.leaderAskIds?.count === index.leaderAsks.length) return index.leaderAskIds;
  const ids = assignSessionScopedLeaderUserMessageIds(index.leaderAsks.map((ask) => ask.persistedId));
  const indexById = new Map<string, number>();
  index.leaderAsks.forEach((ask, position) => indexById.set(ids[position]!, ask.index));
  index.leaderAskIds = {
    count: index.leaderAsks.length,
    indexById,
    indexes: new Set(index.leaderAsks.map((ask) => ask.index)),
  };
  return index.leaderAskIds;
}

/** First history index from which the window can be affected: the start of the turn holding the first in-window message. */
function scanStart(history: ReadonlyArray<BrowserIncomingMessage>, index: HistoryIndex, since: number): number {
  let low = 0;
  let high = index.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (index.maxTimestamp[middle]! >= since) high = middle;
    else low = middle + 1;
  }
  // A turn's user messages are answered by its last reply, so start where that turn began: after the previous turn's result.
  for (let start = low - 1; start >= 0; start--) {
    const message = history[start]!;
    if (message.type === "result" && isRootAgentHistoryMessage(message) && !message.data.codex_provider_retry)
      return start + 1;
  }
  return 0;
}

function sessionActivity(
  document: ActivitySessionDocument,
  input: BuildActivityStreamInput,
): Array<{ message: ActivityMessage; thread: string }> {
  const history = document.messageHistory;
  const index = indexHistory(history);
  const start = scanStart(history, index, input.since);
  // Asks before `start` are read only when an answer in the scanned part names them.
  const asks = new Map<number, RawMessage>();
  const askAt = (askIndex: number): RawMessage => {
    let ask = asks.get(askIndex);
    if (!ask) {
      ask = askMessage(history[askIndex] as Extract<BrowserIncomingMessage, { type: "user_message" }>, askIndex);
      asks.set(askIndex, ask);
    }
    return ask;
  };
  const answers = new Map<number, { reply: RawMessage; to: number[] }>();
  // Results nothing asked for: leader answers that name no message, and published reports.
  const unrequested = new Map<number, { role: "answer" | "report"; raw: RawMessage; thread: string }>();

  // Leader user messages carry session-scoped IDs (u1, u2, ...) that settled answers name.
  const { indexById: leaderAskIndexById, indexes: leaderAskIndexes } = document.isOrchestrator
    ? leaderAskIds(index)
    : { indexById: new Map<string, number>(), indexes: new Set<number>() };

  // Other user messages are answered by the last reply of the turn they were sent in.
  let turn: { asks: number[]; lastReply?: RawMessage } | null = null;
  for (let messageIndex = start; messageIndex < history.length; messageIndex++) {
    const message = history[messageIndex]!;
    if (!isRootAgentHistoryMessage(message)) continue;
    if (isActualHumanUserMessage(message)) {
      askAt(messageIndex);
      if (leaderAskIndexes.has(messageIndex)) continue;
      if (turn) turn.asks.push(messageIndex);
      else turn = { asks: [messageIndex] };
      continue;
    }
    if (message.type === "markdown_report") {
      unrequested.set(messageIndex, {
        role: "report",
        raw: { index: messageIndex, at: message.timestamp, text: message.content.trim(), images: 0 },
        thread: document.isOrchestrator ? leaderMessageThreadKey(message) : MAIN_THREAD_KEY,
      });
      continue;
    }
    const reply = replyMessage(message, messageIndex);
    if (reply && message.type === "assistant" && message.threadAnswer) {
      const ids = message.threadAnswer.answerUserMessageIds;
      // An answer naming no message belongs to the thread it was written in.
      if (ids.length === 0)
        unrequested.set(messageIndex, { role: "answer", raw: reply, thread: leaderMessageThreadKey(message) });
      const to = [...new Set(ids)]
        .map((id) => leaderAskIndexById.get(id))
        .filter((askIndex): askIndex is number => askIndex !== undefined);
      if (to.length) answers.set(messageIndex, { reply, to });
    }
    if (!turn) continue;
    if (reply) turn.lastReply = reply;
    if (message.type !== "result" || message.data.codex_provider_retry) continue;
    if (turn.lastReply) answers.set(turn.lastReply.index, { reply: turn.lastReply, to: turn.asks });
    turn = null;
  }

  const inWindow = (raw: RawMessage) => raw.at >= input.since && raw.at < input.until;
  const listed = new Set<number>();
  for (const [askIndex, ask] of asks) if (inWindow(ask)) listed.add(askIndex);
  for (const [answerIndex, answer] of answers) {
    if (inWindow(answer.reply)) {
      listed.add(answerIndex);
      for (const askIndex of answer.to) listed.add(askIndex);
    } else if (answer.to.some((askIndex) => inWindow(askAt(askIndex)))) listed.add(answerIndex);
  }
  for (const [resultIndex, result] of unrequested) if (inWindow(result.raw)) listed.add(resultIndex);

  const threadOf = (askIndex: number): string =>
    document.isOrchestrator ? authoritativeMessageOwner(history[askIndex]!).threadKey : MAIN_THREAD_KEY;
  return [...listed].map((listedIndex) => {
    const answer = answers.get(listedIndex);
    if (answer) {
      return {
        message: { ...toMessage("answer", answer.reply, input.textLimit), to: answer.to },
        // An answer joins the thread of the user messages it answers.
        thread: threadOf(answer.to[0]!),
      };
    }
    const result = unrequested.get(listedIndex);
    if (result) return { message: toMessage(result.role, result.raw, input.textLimit), thread: result.thread };
    return { message: toMessage("user", askAt(listedIndex), input.textLimit), thread: threadOf(listedIndex) };
  });
}

function askMessage(message: Extract<BrowserIncomingMessage, { type: "user_message" }>, index: number): RawMessage {
  const content = formatReplyContentForAssistant(message.content || "", message.replyContext);
  return {
    index,
    at: message.timestamp,
    text: formatAnnotatedMessage(content, message.annotations).trim(),
    images: message.images?.length ?? 0,
  };
}

function replyMessage(message: BrowserIncomingMessage, index: number): RawMessage | null {
  if (message.type !== "assistant" || message.parent_tool_use_id != null) return null;
  const text = message.message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n")
    .trim();
  if (!text) return null;
  return { index, at: message.timestamp ?? 0, text, images: 0 };
}

function toMessage(role: ActivityMessage["role"], raw: RawMessage, textLimit: number | undefined): ActivityMessage {
  const shorten = textLimit !== undefined && raw.text.length > textLimit;
  return {
    role,
    index: raw.index,
    at: raw.at,
    text: shorten ? `${raw.text.slice(0, textLimit).trimEnd()}…` : raw.text,
    ...(shorten ? { chars: raw.text.length } : {}),
    ...(raw.images ? { images: raw.images } : {}),
  };
}
