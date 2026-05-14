import type { CSSProperties } from "react";
import type { BoardRowData } from "./BoardTable.js";
import {
  buildLeaderActivePhaseSummary,
  type LeaderActivePhaseSummarySegment,
} from "../../shared/leader-active-phase-summary.js";
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
