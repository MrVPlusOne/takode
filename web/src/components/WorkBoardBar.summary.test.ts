import { describe, expect, it } from "vitest";
import type { BoardRowData } from "./BoardTable.js";
import { boardSummary, constrainThreadTabTransformToHorizontal, reorderThreadTabsAfterDrag } from "./WorkBoardBar.js";
import { getQuestJourneyPhaseForState } from "../../shared/quest-journey.js";
import { getQuestPhaseColorValue } from "../utils/quest-phase-theme.js";

describe("boardSummary", () => {
  it("returns 'Empty' for an empty board", () => {
    expect(boardSummary([], 0)).toEqual([{ text: "Empty", className: "text-cc-muted" }]);
  });

  it("summarises a single status with the phase metadata color", () => {
    const board: BoardRowData[] = [
      { questId: "q-1", status: "WORKING", updatedAt: 1 },
      { questId: "q-2", status: "WORKING", updatedAt: 2 },
    ];
    expect(boardSummary(board, 0)).toEqual([
      {
        text: "2 Work",
        className: "text-cc-fg",
        style: { color: getPhaseColor("WORKING") },
      },
    ]);
  });

  it("summarises current Quest Journey phases when phase bookkeeping exists", () => {
    const board: BoardRowData[] = [
      {
        questId: "q-1",
        status: "WORKING",
        journey: {
          presetId: "v2-work",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
        },
        updatedAt: 1,
      },
    ];
    expect(boardSummary(board, 0)).toEqual([
      {
        text: "1 Work",
        className: "text-cc-fg",
        style: { color: getPhaseColor("WORKING") },
      },
    ]);
  });

  it("summarises multiple active phases with distinct colors while checkpoint pauses remain under Work", () => {
    // USER_CHECKPOINTING is intentionally a durable pause inside Work, so the
    // active count stays under Work even though checkpoint timeline chrome is amber.
    const board: BoardRowData[] = [
      { questId: "q-1", status: "MEMORY", updatedAt: 1 },
      { questId: "q-2", status: "WORKING", updatedAt: 2 },
      {
        questId: "q-3",
        status: "USER_CHECKPOINTING",
        journey: {
          phaseIds: ["alignment", "work", "user-checkpoint", "memory"],
          activePhaseIndex: 2,
          currentPhaseId: "user-checkpoint",
        },
        updatedAt: 3,
      },
      { questId: "q-4", status: "PLANNING", updatedAt: 4 },
    ];
    const result = boardSummary(board, 0);
    expect(result).toEqual([
      {
        text: "1 Memory",
        className: "text-cc-fg",
        style: { color: getPhaseColor("MEMORY") },
      },
      {
        text: "2 Work",
        className: "text-cc-fg",
        style: { color: getPhaseColor("WORKING") },
      },
      {
        text: "1 Alignment",
        className: "text-cc-fg",
        style: { color: getPhaseColor("PLANNING") },
      },
    ]);
  });

  it("groups rows with missing status as 'unknown'", () => {
    const board: BoardRowData[] = [
      { questId: "q-1", updatedAt: 1 },
      { questId: "q-2", status: undefined, updatedAt: 2 },
      { questId: "q-3", status: "QUEUED", updatedAt: 3 },
    ];
    const result = boardSummary(board, 0);
    expect(result).toEqual([
      { text: "1 Queued", className: "text-cc-muted" },
      { text: "2 unknown", className: "text-cc-fg/80" },
    ]);
  });

  it("includes completed count as muted segment", () => {
    const board: BoardRowData[] = [{ questId: "q-1", status: "WORKING", updatedAt: 1 }];
    expect(boardSummary(board, 3)).toEqual([
      {
        text: "1 Work",
        className: "text-cc-fg",
        style: { color: getPhaseColor("WORKING") },
      },
      { text: "3 Completed", className: "text-cc-muted" },
    ]);
  });

  it("falls back to the raw status label for unknown states", () => {
    const board: BoardRowData[] = [{ questId: "q-1", status: "CUSTOM_STATUS", updatedAt: 1 }];
    expect(boardSummary(board, 0)).toEqual([{ text: "1 CUSTOM_STATUS", className: "text-cc-fg/80" }]);
  });
});

function getPhaseColor(status: string): string | undefined {
  const phase = getQuestJourneyPhaseForState(status);
  return phase ? getQuestPhaseColorValue(phase.color) : undefined;
}

describe("reorderThreadTabsAfterDrag", () => {
  it("reorders sortable thread keys and ignores Main or unknown drag targets", () => {
    expect(reorderThreadTabsAfterDrag(["q-1", "q-2", "q-3"], "q-3", "q-1")).toEqual(["q-3", "q-1", "q-2"]);
    expect(reorderThreadTabsAfterDrag(["q-1", "q-2"], "main", "q-2")).toEqual(["q-1", "q-2"]);
    expect(reorderThreadTabsAfterDrag(["q-1", "q-2"], "q-1", "q-missing")).toEqual(["q-1", "q-2"]);
  });
});

describe("constrainThreadTabTransformToHorizontal", () => {
  it("keeps sortable thread tab movement on the horizontal rail", () => {
    const transform = { x: 42, y: 18, scaleX: 1, scaleY: 0.96 };

    expect(constrainThreadTabTransformToHorizontal(transform)).toEqual({
      x: 42,
      y: 0,
      scaleX: 1,
      scaleY: 0.96,
    });
    expect(transform.y).toBe(18);
  });

  it("preserves empty and already-horizontal transforms", () => {
    const transform = { x: -24, y: 0, scaleX: 1, scaleY: 1 };

    expect(constrainThreadTabTransformToHorizontal(null)).toBeNull();
    expect(constrainThreadTabTransformToHorizontal(transform)).toBe(transform);
  });
});
