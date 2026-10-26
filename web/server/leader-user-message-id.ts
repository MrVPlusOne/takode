import {
  assignSessionScopedLeaderUserMessageIds,
  isCanonicalLeaderUserMessageId,
  LEADER_USER_MESSAGE_ID_RE,
} from "../shared/leader-user-message-id.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import type { AnsweredMessageReference, BrowserIncomingMessage } from "./session-types.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";

export { isCanonicalLeaderUserMessageId, LEADER_USER_MESSAGE_ID_RE };

export interface LeaderUserMessageIdentity {
  userMessageId: string;
  historyMessageId: string;
  historyIndex: number;
  message: Extract<BrowserIncomingMessage, { type: "user_message" }>;
}

/** Whether a history row is a user message that receives a session-scoped ID (u1, u2, ...). */
export function isLeaderUserMessageWithId(
  message: BrowserIncomingMessage,
): message is Extract<BrowserIncomingMessage, { type: "user_message" }> & { id: string } {
  return (
    isRootAgentHistoryMessage(message) &&
    isActualHumanUserMessage(message) &&
    message.leaderResponseCoverageVersion === 1 &&
    !!message.id
  );
}

/**
 * Whether each message gets an ID, kept per message: the answer state reads every message's
 * eligibility several times per leader turn end, and classifying user messages reads their text.
 * Everything it depends on is fixed when the message is stored.
 */
const eligibility = new WeakMap<object, boolean>();

function eligibleLeaderUserMessages(
  history: ReadonlyArray<BrowserIncomingMessage>,
): Array<Omit<LeaderUserMessageIdentity, "userMessageId">> {
  const eligible: Array<Omit<LeaderUserMessageIdentity, "userMessageId">> = [];
  history.forEach((message, historyIndex) => {
    let withId = eligibility.get(message);
    if (withId === undefined) {
      withId = isLeaderUserMessageWithId(message);
      eligibility.set(message, withId);
    }
    if (!withId) return;
    const user = message as LeaderUserMessageIdentity["message"] & { id: string };
    eligible.push({ historyMessageId: user.id, historyIndex, message: user });
  });
  return eligible;
}

/**
 * Build the stable session-scoped ID map. New rows persist their ID; older
 * coverage rows receive deterministic ordinal fallbacks without rewriting
 * durable history solely for compatibility.
 */
export function buildLeaderUserMessageIdentities(
  history: ReadonlyArray<BrowserIncomingMessage>,
): LeaderUserMessageIdentity[] {
  const eligible = eligibleLeaderUserMessages(history);
  const assignedIds = assignSessionScopedLeaderUserMessageIds(
    eligible.map((entry) => entry.message.leaderUserMessageId),
  );
  return eligible.map((entry, index) => ({ ...entry, userMessageId: assignedIds[index]! }));
}

export function nextLeaderUserMessageId(
  history: ReadonlyArray<BrowserIncomingMessage>,
  reservedIds: ReadonlyArray<string | undefined> = [],
): string {
  const assignedMax = buildLeaderUserMessageIdentities(history).reduce((max, entry) => {
    const ordinal = Number(entry.userMessageId.slice(1));
    return Number.isSafeInteger(ordinal) ? Math.max(max, ordinal) : max;
  }, 0);
  const persistedMax = eligibleLeaderUserMessages(history).reduce((max, entry) => {
    const id = entry.message.leaderUserMessageId;
    if (!isCanonicalLeaderUserMessageId(id)) return max;
    const ordinal = Number(id.slice(1));
    return Number.isSafeInteger(ordinal) ? Math.max(max, ordinal) : max;
  }, 0);
  const reservedMax = reservedIds.reduce((max, id) => {
    if (!isCanonicalLeaderUserMessageId(id)) return max;
    const ordinal = Number(id.slice(1));
    return Number.isSafeInteger(ordinal) ? Math.max(max, ordinal) : max;
  }, 0);
  return `u${Math.max(assignedMax, persistedMax, reservedMax) + 1}`;
}

export function findLeaderUserMessageById(
  history: ReadonlyArray<BrowserIncomingMessage>,
  userMessageId: string,
): LeaderUserMessageIdentity | null {
  if (!isCanonicalLeaderUserMessageId(userMessageId)) return null;
  return buildLeaderUserMessageIdentities(history).find((entry) => entry.userMessageId === userMessageId) ?? null;
}

/** At most this many answered messages ride along with one history window. */
const MAX_ANSWERED_MESSAGE_REFERENCES = 64;

/**
 * Prepare a history window (All Threads) for leader answers: give its direct
 * human messages their session-scoped `uN` IDs, and collect the messages its
 * answers answer that lie outside it, so every answer can quote them. Older
 * rows store no ID and their IDs follow from the whole history, which the
 * browser never holds. Windows without coverage rows or answers (worker
 * sessions) come back unchanged.
 */
export function prepareLeaderHistoryWindow(
  windowMessages: BrowserIncomingMessage[],
  history: ReadonlyArray<BrowserIncomingMessage>,
): { messages: BrowserIncomingMessage[]; answeredMessages: AnsweredMessageReference[] } {
  const needsId = (message: BrowserIncomingMessage) =>
    message.type === "user_message" && message.leaderResponseCoverageVersion === 1 && !message.leaderUserMessageId;
  const answeredIds = windowMessages.flatMap((message) =>
    message.type === "assistant" && message.leaderThreadRole === "answer"
      ? (message.threadAnswer?.answerUserMessageIds ?? [])
      : [],
  );
  if (answeredIds.length === 0 && !windowMessages.some(needsId))
    return { messages: windowMessages, answeredMessages: [] };

  const identities = buildLeaderUserMessageIdentities(history);
  const idByMessage = new Map(identities.map((entry) => [entry.message, entry.userMessageId]));
  const messages = windowMessages.map((message) => {
    const id = needsId(message)
      ? idByMessage.get(message as Extract<BrowserIncomingMessage, { type: "user_message" }>)
      : undefined;
    return id ? { ...message, leaderUserMessageId: id } : message;
  });

  const inWindow = new Set(windowMessages);
  const wanted = new Set(answeredIds);
  const answeredMessages = identities
    .filter((entry) => wanted.has(entry.userMessageId) && !inWindow.has(entry.message))
    // The newest answered messages matter most when the bound cuts the list.
    .slice(-MAX_ANSWERED_MESSAGE_REFERENCES)
    .map(({ message, historyMessageId, userMessageId }) => ({
      history_message_id: historyMessageId,
      user_message_id: userMessageId,
      content: message.content,
      ...(message.images?.length ? { attachment_count: message.images.length } : {}),
      ...(message.annotations?.length ? { annotations: message.annotations } : {}),
    }));
  return { messages, answeredMessages };
}
