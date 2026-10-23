import type { BrowserIncomingMessage } from "./session-types.js";
import type { TurnBoundary } from "./takode-messages.js";

export function resolveHistoryWindowFromTurn(input: {
  messageHistory: BrowserIncomingMessage[];
  turns: TurnBoundary[];
  requestedFromTurn: number;
  turnCount: number;
  targetMessageId?: string;
  targetHistoryIndex?: number;
  includeMessage?: (message: BrowserIncomingMessage, historyIndex: number) => boolean;
  includeOutsideTurnMessage?: (message: BrowserIncomingMessage, historyIndex: number) => boolean;
}): number {
  const totalTurns = input.turns.length;
  if (totalTurns === 0) return 0;
  const targetHistoryIndex = resolveTargetHistoryIndex(input.messageHistory, input);
  const targetTurn = targetHistoryIndex == null ? null : findOwningTurn(input, targetHistoryIndex);
  if (targetTurn != null && targetTurn >= 0) {
    return Math.max(0, Math.min(targetTurn - Math.floor(input.turnCount / 2), totalTurns - input.turnCount));
  }
  return input.requestedFromTurn < 0
    ? Math.max(0, totalTurns - input.turnCount)
    : Math.max(0, Math.min(input.requestedFromTurn, totalTurns - 1));
}

export function selectHistoryWindowRange(input: {
  messageHistory: BrowserIncomingMessage[];
  turns: TurnBoundary[];
  requestedFromTurn: number;
  turnCount: number;
  targetMessageId?: string;
  targetHistoryIndex?: number;
  includeMessage?: (message: BrowserIncomingMessage, historyIndex: number) => boolean;
  includeOutsideTurnMessage?: (message: BrowserIncomingMessage, historyIndex: number) => boolean;
}): {
  fromTurn: number;
  turnCount: number;
  startIdx: number;
  messages: BrowserIncomingMessage[];
} {
  const fromTurn = resolveHistoryWindowFromTurn(input);
  const endTurnExclusive = Math.min(input.turns.length, fromTurn + input.turnCount);
  const turnCount = Math.max(0, endTurnExclusive - fromTurn);
  const turnStartIdx = input.turns[fromTurn]?.startIdx ?? 0;
  let startIdx = turnStartIdx;
  const lastTurn = input.turns[endTurnExclusive - 1];
  const trailingEndExclusive = input.turns[endTurnExclusive]?.startIdx ?? input.messageHistory.length;
  const baseEndExclusive = lastTurn && lastTurn.endIdx >= 0 ? lastTurn.endIdx + 1 : trailingEndExclusive;
  let messages = projectHistoryRange(input.messageHistory, turnStartIdx, baseEndExclusive, input.includeMessage);
  if (fromTurn === 0 && turnStartIdx > 0) {
    const leadingMessages: BrowserIncomingMessage[] = [];
    for (let historyIndex = 0; historyIndex < turnStartIdx; historyIndex++) {
      const message = input.messageHistory[historyIndex]!;
      if (!input.includeOutsideTurnMessage?.(message, historyIndex)) continue;
      leadingMessages.push({ ...message, history_index: historyIndex });
    }
    if (leadingMessages.length > 0) {
      messages = [
        ...leadingMessages,
        ...messages.map((message, offset) => ({
          ...message,
          history_index:
            Number.isInteger(message.history_index) && (message.history_index ?? -1) >= 0
              ? message.history_index
              : turnStartIdx + offset,
        })),
      ];
      startIdx = leadingMessages[0]!.history_index!;
    }
  }
  if (lastTurn?.endIdx != null && lastTurn.endIdx >= 0) {
    for (let historyIndex = lastTurn.endIdx + 1; historyIndex < trailingEndExclusive; historyIndex++) {
      const message = input.messageHistory[historyIndex]!;
      if (!input.includeOutsideTurnMessage?.(message, historyIndex)) continue;
      messages.push({ ...message, history_index: historyIndex });
    }
  }
  return {
    fromTurn,
    turnCount,
    startIdx,
    messages,
  };
}

function projectHistoryRange(
  history: BrowserIncomingMessage[],
  startIndex: number,
  endIndex: number,
  includeMessage?: (message: BrowserIncomingMessage, historyIndex: number) => boolean,
): BrowserIncomingMessage[] {
  const projected: BrowserIncomingMessage[] = [];
  for (let historyIndex = startIndex; historyIndex < endIndex; historyIndex += 1) {
    const message = history[historyIndex];
    if (!message || (includeMessage && !includeMessage(message, historyIndex))) continue;
    const expectedContiguousIndex = startIndex + projected.length;
    projected.push(
      historyIndex === expectedContiguousIndex && message.history_index == null
        ? message
        : { ...message, history_index: historyIndex },
    );
  }
  return projected;
}

function findOwningTurn(
  input: {
    messageHistory: BrowserIncomingMessage[];
    turns: TurnBoundary[];
    includeMessage?: (message: BrowserIncomingMessage, historyIndex: number) => boolean;
    includeOutsideTurnMessage?: (message: BrowserIncomingMessage, historyIndex: number) => boolean;
  },
  targetHistoryIndex: number,
): number {
  const message = input.messageHistory[targetHistoryIndex];
  if (!message || (input.includeMessage && !input.includeMessage(message, targetHistoryIndex))) return -1;
  const firstTurnStart = input.turns[0]?.startIdx;
  if (firstTurnStart != null && targetHistoryIndex < firstTurnStart) {
    return input.includeOutsideTurnMessage?.(message, targetHistoryIndex) === true ? 0 : -1;
  }
  return input.turns.findIndex((turn, index) => {
    const endExclusive = input.turns[index + 1]?.startIdx ?? input.messageHistory.length;
    if (targetHistoryIndex < turn.startIdx || targetHistoryIndex >= endExclusive) return false;
    if (turn.endIdx < 0 || targetHistoryIndex <= turn.endIdx) return true;
    return input.includeOutsideTurnMessage?.(message, targetHistoryIndex) === true;
  });
}

function resolveTargetHistoryIndex(
  history: BrowserIncomingMessage[],
  input: {
    targetMessageId?: string;
    targetHistoryIndex?: number;
    includeMessage?: (message: BrowserIncomingMessage, historyIndex: number) => boolean;
  },
): number | null {
  if (typeof input.targetHistoryIndex === "number" && Number.isFinite(input.targetHistoryIndex)) {
    return Math.max(0, Math.min(Math.floor(input.targetHistoryIndex), Math.max(0, history.length - 1)));
  }
  const targetMessageId = input.targetMessageId?.trim();
  if (!targetMessageId) return null;
  const index = history.findIndex(
    (message, historyIndex) =>
      (!input.includeMessage || input.includeMessage(message, historyIndex)) &&
      messageId(message, historyIndex) === targetMessageId,
  );
  return index >= 0 ? index : null;
}

function messageId(message: BrowserIncomingMessage, historyIndex: number): string {
  const directId = (message as { id?: unknown }).id;
  if (typeof directId === "string" && directId.trim()) return directId;
  if (message.type === "assistant" && typeof message.message?.id === "string" && message.message.id.trim()) {
    return message.message.id;
  }
  return `${message.type}:${historyIndex}`;
}
