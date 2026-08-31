import type { BoardRowSessionStatus, SessionAttentionRecord, SessionNotification } from "../../server/session-types.js";
import type { QuestmasterTask } from "../../server/quest-types.js";
import {
  buildLeaderThreadRowsFromSummaries,
  buildProjectionAttentionRecords,
  collectLeaderThreadSummaries,
  collectMessageAttentionRecords,
  type LeaderProjectionBoardRow,
  type LeaderProjectionMessageLike,
} from "../leader-projection.js";
import type { LeaderThreadRouteIndex, LeaderThreadTurnBoundary } from "./leader-thread-route-index.js";
import {
  buildRawTurnBoundariesFromRouteIndex,
  collectLeaderThreadSummariesFromRouteIndex,
  leaderThreadRouteIndexMatchesSource,
} from "./leader-thread-route-index.js";

interface TestLeaderProjectionSnapshot {
  schemaVersion: 1;
  revision: number;
  sourceHistoryLength: number;
  generatedAt: number;
  threadSummaries: ReturnType<typeof collectLeaderThreadSummaries>;
  threadRows: ReturnType<typeof buildLeaderThreadRowsFromSummaries>;
  workBoardThreadRows: Array<{
    threadKey: string;
    questId?: string;
    title: string;
    messageCount?: number;
    section?: "active" | "done";
  }>;
  messageAttentionRecords: SessionAttentionRecord[];
  attentionRecords: SessionAttentionRecord[];
  rawTurnBoundaries: LeaderThreadTurnBoundary[];
}

export interface BuildLeaderProjectionInput {
  leaderSessionId: string;
  messageHistory: ReadonlyArray<LeaderProjectionMessageLike>;
  activeBoard?: ReadonlyArray<LeaderProjectionBoardRow>;
  completedBoard?: ReadonlyArray<LeaderProjectionBoardRow>;
  quests?: ReadonlyArray<Pick<QuestmasterTask, "questId" | "title" | "status" | "createdAt">>;
  rowSessionStatuses?: Record<string, BoardRowSessionStatus>;
  notifications?: ReadonlyArray<SessionNotification>;
  attentionRecords?: ReadonlyArray<SessionAttentionRecord>;
  threadRouteIndex?: LeaderThreadRouteIndex;
  revision?: number;
  generatedAt?: number;
}

export function buildLeaderProjectionSnapshot(input: BuildLeaderProjectionInput): TestLeaderProjectionSnapshot {
  const routeIndex =
    input.threadRouteIndex && leaderThreadRouteIndexMatchesSource(input.threadRouteIndex, input.messageHistory)
      ? input.threadRouteIndex
      : null;
  const threadSummaries = routeIndex
    ? collectLeaderThreadSummariesFromRouteIndex(routeIndex)
    : collectLeaderThreadSummaries(input.messageHistory);
  const activeBoard = [...(input.activeBoard ?? [])];
  const completedBoard = [...(input.completedBoard ?? [])];
  const messageAttentionRecords = collectMessageAttentionRecords(input.leaderSessionId, input.messageHistory);
  const attentionRecords = buildProjectionAttentionRecords({
    leaderSessionId: input.leaderSessionId,
    records: [...(input.attentionRecords ?? []), ...messageAttentionRecords],
    notifications: input.notifications,
    boardRows: activeBoard,
    completedBoardRows: completedBoard,
  });
  const threadRows = buildLeaderThreadRowsFromSummaries({
    activeBoard,
    completedBoard,
    threadSummaries,
    quests: input.quests,
    rowSessionStatuses: input.rowSessionStatuses,
  });
  return {
    schemaVersion: 1,
    revision:
      input.revision ??
      input.messageHistory.length * 1_000_000 +
        (input.notifications?.length ?? 0) * 10_000 +
        (input.attentionRecords?.length ?? 0) * 100 +
        activeBoard.length +
        completedBoard.length,
    sourceHistoryLength: input.messageHistory.length,
    generatedAt: input.generatedAt ?? Date.now(),
    threadSummaries,
    threadRows,
    workBoardThreadRows: threadRows.map((row) => ({
      threadKey: row.threadKey,
      questId: row.questId,
      title: row.title,
      messageCount: row.messageCount,
      section: row.section,
    })),
    messageAttentionRecords,
    attentionRecords,
    rawTurnBoundaries: routeIndex
      ? buildRawTurnBoundariesFromRouteIndex(routeIndex)
      : buildRawTurnBoundaries(input.messageHistory),
  };
}

function buildRawTurnBoundaries(messages: ReadonlyArray<LeaderProjectionMessageLike>): LeaderThreadTurnBoundary[] {
  const boundaries: LeaderThreadTurnBoundary[] = [];
  let currentStart: number | null = null;
  messages.forEach((message, index) => {
    const historyIndex = typeof message.historyIndex === "number" ? message.historyIndex : index;
    if (message.type === "user_message" || message.role === "user") {
      if (currentStart !== null) {
        boundaries.push({ turnIndex: boundaries.length, startHistoryIndex: currentStart, endHistoryIndex: index - 1 });
      }
      currentStart = historyIndex;
    } else if (message.type === "result" && currentStart !== null) {
      boundaries.push({ turnIndex: boundaries.length, startHistoryIndex: currentStart, endHistoryIndex: historyIndex });
      currentStart = null;
    }
  });
  if (currentStart !== null) {
    boundaries.push({ turnIndex: boundaries.length, startHistoryIndex: currentStart, endHistoryIndex: null });
  }
  return boundaries;
}
