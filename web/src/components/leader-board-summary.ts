import type { CSSProperties } from "react";
import type { BoardRowData } from "./BoardTable.js";
import { orderBoardRows } from "./BoardTable.js";
import {
  getQuestJourneyCurrentPhaseId,
  getQuestJourneyPhase,
  getQuestJourneyPresentation,
} from "../../shared/quest-journey.js";

export interface BoardSummarySegment {
  text: string;
  className: string;
  style?: CSSProperties;
}

export function activeBoardSummarySegments(board: readonly BoardRowData[]): BoardSummarySegment[] {
  const counts = new Map<string, { count: number; className: string; style?: CSSProperties }>();
  for (const row of orderBoardRows([...board])) {
    const currentPhase = getQuestJourneyPhase(getQuestJourneyCurrentPhaseId(row.journey, row.status));
    const presentation = getQuestJourneyPresentation(row.status);
    const label = currentPhase?.label ?? presentation?.label ?? row.status ?? "unknown";
    const className = currentPhase ? "text-cc-fg" : presentation ? "text-cc-muted" : "text-cc-fg/80";
    const style = currentPhase ? { color: currentPhase.color.accent } : undefined;
    const entry = counts.get(label);
    if (entry) entry.count++;
    else counts.set(label, { count: 1, className, style });
  }
  return [...counts.entries()].map(([label, { count, className, style }]) => ({
    text: `${count} ${label}`,
    className,
    ...(style ? { style } : {}),
  }));
}

export function boardSummary(board: readonly BoardRowData[], completedCount: number): BoardSummarySegment[] {
  if (board.length === 0 && completedCount === 0) return [{ text: "Empty", className: "text-cc-muted" }];
  const segments = activeBoardSummarySegments(board);
  if (completedCount > 0) segments.push({ text: `${completedCount} done`, className: "text-cc-muted" });
  return segments;
}
