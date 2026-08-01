import type { QuestJourneyPlanState } from "../shared/quest-journey.js";
import type { BoardRow, BoardRowSessionStatus, SessionAttentionRecord } from "./session-types.js";

export interface LeaderProjectionThreadSummary {
  threadKey: string;
  questId?: string;
  messageCount: number;
  firstMessageAt?: number;
  lastMessageAt?: number;
  firstHistoryIndex?: number;
  lastHistoryIndex?: number;
}

export interface LeaderProjectionThreadRow {
  threadKey: string;
  questId?: string;
  title: string;
  status?: string;
  boardStatus?: string;
  journey?: QuestJourneyPlanState;
  boardRow?: BoardRow;
  rowStatus?: BoardRowSessionStatus;
  section?: "active" | "done";
  messageCount: number;
  createdAt: number;
}

/** Rich server-side projection used for projection construction and diagnostics. */
export interface LeaderProjectionInternalSnapshot {
  schemaVersion: 1;
  revision: number;
  sourceHistoryLength: number;
  generatedAt: number;
  threadSummaries: LeaderProjectionThreadSummary[];
  threadRows: LeaderProjectionThreadRow[];
  workBoardThreadRows: Array<{
    threadKey: string;
    questId?: string;
    title: string;
    messageCount?: number;
    section?: "active" | "done";
  }>;
  messageAttentionRecords: SessionAttentionRecord[];
  attentionRecords: SessionAttentionRecord[];
  rawTurnBoundaries: Array<{
    turnIndex: number;
    startHistoryIndex: number;
    endHistoryIndex: number | null;
  }>;
}

/** Compact browser wire contract. Keep this limited to fields consumed by the browser. */
export interface LeaderProjectionSnapshot {
  schemaVersion: 2;
  sourceHistoryLength: number;
  threadSummaries: LeaderProjectionThreadSummary[];
  messageAttentionRecords: SessionAttentionRecord[];
}
