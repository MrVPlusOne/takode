import { formatAnnotatedMessage } from "../shared/conversation-annotations.js";
import { formatReplyContentForAssistant } from "../shared/reply-context.js";
import { MAIN_THREAD_KEY } from "../shared/thread-window.js";
import { authoritativeMessageOwner } from "./authoritative-message-owner.js";
import { buildLeaderUserMessageIdentities } from "./leader-user-message-id.js";
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
  /** `user` for a message the user typed; `answer` for a final answer to user messages. */
  role: "user" | "answer";
  index: number;
  at: number;
  text: string;
  /** Full text length, present only when `text` was shortened. */
  chars?: number;
  images?: number;
  /** For answers: history indexes of the user messages it answers. */
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
 * hand and the final answers to them. A leader's answers are the settled explicit answers
 * that name the user's messages; elsewhere the last reply of a turn answers the user
 * messages sent during it. A message outside the window is still listed when it answers,
 * or is answered by, a message inside it. Threads are ordered by their first listed message.
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

function sessionActivity(
  document: ActivitySessionDocument,
  input: BuildActivityStreamInput,
): Array<{ message: ActivityMessage; thread: string }> {
  const history = document.messageHistory;
  const asks = new Map<number, RawMessage>();
  const answers = new Map<number, { reply: RawMessage; to: number[] }>();

  // Leader user messages carry session-scoped IDs (u1, u2, ...) that settled answers name.
  const leaderAskIndexById = new Map<string, number>();
  if (document.isOrchestrator) {
    for (const identity of buildLeaderUserMessageIdentities(history)) {
      leaderAskIndexById.set(identity.userMessageId, identity.historyIndex);
    }
  }
  const leaderAskIndexes = new Set(leaderAskIndexById.values());

  // Other user messages are answered by the last reply of the turn they were sent in.
  let turn: { asks: number[]; lastReply?: RawMessage } | null = null;
  history.forEach((message, index) => {
    if (!isRootAgentHistoryMessage(message)) return;
    if (isActualHumanUserMessage(message)) {
      asks.set(index, askMessage(message, index));
      if (leaderAskIndexes.has(index)) return;
      if (turn) turn.asks.push(index);
      else turn = { asks: [index] };
      return;
    }
    const reply = replyMessage(message, index);
    if (reply && message.type === "assistant" && message.threadAnswer) {
      const to = [...new Set(message.threadAnswer.answerUserMessageIds)]
        .map((id) => leaderAskIndexById.get(id))
        .filter((askIndex): askIndex is number => askIndex !== undefined);
      if (to.length) answers.set(index, { reply, to });
    }
    if (!turn) return;
    if (reply) turn.lastReply = reply;
    if (message.type !== "result" || message.data.codex_provider_retry) return;
    if (turn.lastReply) answers.set(turn.lastReply.index, { reply: turn.lastReply, to: turn.asks });
    turn = null;
  });

  const inWindow = (raw: RawMessage) => raw.at >= input.since && raw.at < input.until;
  const listed = new Set<number>();
  for (const [index, ask] of asks) if (inWindow(ask)) listed.add(index);
  for (const [index, answer] of answers) {
    if (inWindow(answer.reply)) {
      listed.add(index);
      for (const askIndex of answer.to) listed.add(askIndex);
    } else if (answer.to.some((askIndex) => inWindow(asks.get(askIndex)!))) listed.add(index);
  }

  const threadOf = (askIndex: number): string =>
    document.isOrchestrator ? authoritativeMessageOwner(history[askIndex]!).threadKey : MAIN_THREAD_KEY;
  return [...listed].map((index) => {
    const answer = answers.get(index);
    if (answer) {
      return {
        message: { ...toMessage("answer", answer.reply, input.textLimit), to: answer.to },
        // An answer joins the thread of the user messages it answers.
        thread: threadOf(answer.to[0]!),
      };
    }
    return { message: toMessage("user", asks.get(index)!, input.textLimit), thread: threadOf(index) };
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
