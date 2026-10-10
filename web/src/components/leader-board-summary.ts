import type { CSSProperties } from "react";
import type { BoardRowData } from "./BoardTable.js";
import {
  buildLeaderActivePhaseSummary,
  orderLeaderActivePhaseRows,
  type LeaderActivePhaseSummarySegment,
} from "../../shared/leader-active-phase-summary.js";
import {
  getQuestJourneyCurrentPhaseId,
  getQuestJourneyPhase,
  type QuestJourneyPhase,
} from "../../shared/quest-journey.js";
import { getQuestPhaseColorValue } from "../utils/quest-phase-theme.js";

export interface BoardSummarySegment {
  text: string;
  className: string;
  style?: CSSProperties;
}

export function activeBoardSummarySegments(board: readonly BoardRowData[]): BoardSummarySegment[] {
  return boardSummarySegmentsFromActivePhaseSummary(buildLeaderActivePhaseSummary(board));
}

export function boardSummarySegmentsFromActivePhaseSummary(
  summary: readonly LeaderActivePhaseSummarySegment[],
): BoardSummarySegment[] {
  return summary.map((segment) => ({
    text: `${segment.count} ${segment.label}`,
    className: segment.tone === "phase" ? "text-cc-fg" : segment.tone === "status" ? "text-cc-muted" : "text-cc-fg/80",
    ...(segment.color && segment.colorName
      ? { style: { color: getQuestPhaseColorValue({ name: segment.colorName, accent: segment.color }) } }
      : {}),
  }));
}

export function boardSummary(board: readonly BoardRowData[], completedCount: number): BoardSummarySegment[] {
  if (board.length === 0 && completedCount === 0) return [{ text: "Empty", className: "text-cc-muted" }];
  const segments = activeBoardSummarySegments(board);
  if (completedCount > 0) segments.push({ text: `${completedCount} Completed`, className: "text-cc-muted" });
  return segments;
}

/** One dot on the top-bar Board button: a board quest that is in a Journey phase. */
export interface BoardPhaseDot {
  questId: string;
  phase: QuestJourneyPhase;
}

const NOT_IN_MOTION_STATUSES = new Set(["QUEUED", "PROPOSED"]);

/**
 * Board quests currently in a Journey phase (Work, User Checkpoint, Memory, Landing, ...),
 * in board order. Queued and proposed rows are not being worked on and get no dot.
 */
export function activeBoardPhaseDots(board: readonly BoardRowData[]): BoardPhaseDot[] {
  const dots: BoardPhaseDot[] = [];
  for (const row of orderLeaderActivePhaseRows(board)) {
    if (NOT_IN_MOTION_STATUSES.has((row.status ?? "").trim().toUpperCase())) continue;
    const phase = getQuestJourneyPhase(getQuestJourneyCurrentPhaseId(row.journey, row.status));
    if (phase) dots.push({ questId: row.questId, phase });
  }
  return dots;
}

/** "3 active (2 Work, 1 Memory)", for the Board button's tooltip and accessible label. */
export function describeBoardPhaseDots(dots: readonly BoardPhaseDot[]): string {
  if (dots.length === 0) return "nothing active";
  const counts = new Map<string, number>();
  for (const dot of dots) counts.set(dot.phase.label, (counts.get(dot.phase.label) ?? 0) + 1);
  const breakdown = [...counts].map(([label, count]) => `${count} ${label}`).join(", ");
  return `${dots.length} active (${breakdown})`;
}
