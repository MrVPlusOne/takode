import {
  assignSessionScopedLeaderUserMessageIds,
  isCanonicalLeaderUserMessageId,
  LEADER_USER_MESSAGE_ID_RE,
} from "../shared/leader-user-message-id.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";

export { isCanonicalLeaderUserMessageId, LEADER_USER_MESSAGE_ID_RE };

export interface LeaderUserMessageIdentity {
  userMessageId: string;
  historyMessageId: string;
  historyIndex: number;
  message: Extract<BrowserIncomingMessage, { type: "user_message" }>;
}

function eligibleLeaderUserMessages(
  history: ReadonlyArray<BrowserIncomingMessage>,
): Array<Omit<LeaderUserMessageIdentity, "userMessageId">> {
  return history.flatMap((message, historyIndex) => {
    if (
      !isRootAgentHistoryMessage(message) ||
      !isActualHumanUserMessage(message) ||
      message.leaderResponseCoverageVersion !== 1 ||
      !message.id
    ) {
      return [];
    }
    return [{ historyMessageId: message.id, historyIndex, message }];
  });
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
