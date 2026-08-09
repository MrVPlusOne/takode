import type { BrowserIncomingMessage } from "./session-types.js";
import type { TurnBoundary } from "./takode-messages.js";

export function resolveHistoryWindowFromTurn(input: {
  messageHistory: BrowserIncomingMessage[];
  turns: TurnBoundary[];
  requestedFromTurn: number;
  turnCount: number;
  targetMessageId?: string;
  targetHistoryIndex?: number;
}): number {
  const totalTurns = input.turns.length;
  if (totalTurns === 0) return 0;
  const targetHistoryIndex = resolveTargetHistoryIndex(input.messageHistory, input);
  const targetTurn =
    targetHistoryIndex == null
      ? null
      : input.turns.findIndex((turn) => targetHistoryIndex >= turn.startIdx && targetHistoryIndex <= turn.endIdx);
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
}): {
  fromTurn: number;
  turnCount: number;
  startIdx: number;
  messages: BrowserIncomingMessage[];
} {
  const fromTurn = resolveHistoryWindowFromTurn(input);
  const endTurnExclusive = Math.min(input.turns.length, fromTurn + input.turnCount);
  const turnCount = Math.max(0, endTurnExclusive - fromTurn);
  const startIdx = input.turns[fromTurn]?.startIdx ?? 0;
  const lastTurn = input.turns[endTurnExclusive - 1];
  const endIdx = lastTurn && lastTurn.endIdx >= 0 ? lastTurn.endIdx : Math.max(0, input.messageHistory.length - 1);
  return {
    fromTurn,
    turnCount,
    startIdx,
    messages: input.messageHistory.slice(startIdx, endIdx + 1),
  };
}

function resolveTargetHistoryIndex(
  history: BrowserIncomingMessage[],
  input: { targetMessageId?: string; targetHistoryIndex?: number },
): number | null {
  if (typeof input.targetHistoryIndex === "number" && Number.isFinite(input.targetHistoryIndex)) {
    return Math.max(0, Math.min(Math.floor(input.targetHistoryIndex), Math.max(0, history.length - 1)));
  }
  const targetMessageId = input.targetMessageId?.trim();
  if (!targetMessageId) return null;
  const index = history.findIndex((message, historyIndex) => messageId(message, historyIndex) === targetMessageId);
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
