import type { Turn } from "../hooks/use-feed-model.js";
import { isTimedChatMessage } from "./message-feed-utils.js";

function getTurnBoundaryTimestamp(turn: Turn): number | null {
  const boundary = turn.userEntry;
  if (!boundary || boundary.kind !== "message" || !isTimedChatMessage(boundary.msg)) return null;
  return boundary.msg.timestamp;
}

function getNormalTurnDurationMs(turn: Turn): number | null {
  const boundary = turn.userEntry;
  if (
    !boundary ||
    boundary.kind !== "message" ||
    boundary.msg.role !== "user" ||
    boundary.msg.agentSource?.sessionId === "herd-events"
  ) {
    return null;
  }
  if (!turn.responseEntry || turn.responseEntry.kind !== "message" || turn.responseEntry.msg.role !== "assistant") {
    return null;
  }
  const responseTimestamp = turn.responseEntry.msg.timestamp;
  return responseTimestamp < boundary.msg.timestamp ? null : responseTimestamp - boundary.msg.timestamp;
}

function getLeaderTurnDurationMs(turn: Turn, nextTurn: Turn | null): number | null {
  if (!nextTurn) return null;
  const currentBoundary = getTurnBoundaryTimestamp(turn);
  const nextBoundary = getTurnBoundaryTimestamp(nextTurn);
  if (currentBoundary == null || nextBoundary == null || nextBoundary < currentBoundary) return null;
  return nextBoundary - currentBoundary;
}

export function getTurnSummaryDurationMs(turn: Turn, nextTurn: Turn | null, leaderMode: boolean): number | null {
  return leaderMode ? getLeaderTurnDurationMs(turn, nextTurn) : getNormalTurnDurationMs(turn);
}
