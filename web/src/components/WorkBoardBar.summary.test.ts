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
      { questId: "q-1", status: "IMPLEMENTING", updatedAt: 1 },
      { questId: "q-2", status: "IMPLEMENTING", updatedAt: 2 },
    ];
    expect(boardSummary(board, 0)).toEqual([
      {
        text: "2 Implement",
        className: "text-cc-fg",
        style: { color: getPhaseColor("IMPLEMENTING") },
      },
    ]);
  });

  it("summarises current Quest Journey phases when phase bookkeeping exists", () => {
    const board: BoardRowData[] = [
      {
        questId: "q-1",
        status: "IMPLEMENTING",
        journey: {
          presetId: "full-code",
          phaseIds: ["alignment", "implement", "code-review", "port"],
          currentPhaseId: "implement",
        },
        updatedAt: 1,
      },
    ];
    expect(boardSummary(board, 0)).toEqual([
      {
        text: "1 Implement",
        className: "text-cc-fg",
        style: { color: getPhaseColor("IMPLEMENTING") },
      },
    ]);
  });

  it("summarises multiple statuses with distinct colors", () => {
    const board: BoardRowData[] = [
      { questId: "q-1", status: "PORTING", updatedAt: 1 },
      { questId: "q-2", status: "CODE_REVIEWING", updatedAt: 2 },
      { questId: "q-3", status: "IMPLEMENTING", updatedAt: 3 },
      { questId: "q-4", status: "IMPLEMENTING", updatedAt: 4 },
    ];
    const result = boardSummary(board, 0);
    expect(result).toEqual([
      {
        text: "1 Port",
        className: "text-cc-fg",
        style: { color: getPhaseColor("PORTING") },
      },
      {
        text: "1 Code Review",
        className: "text-cc-fg",
        style: { color: getPhaseColor("CODE_REVIEWING") },
      },
      {
        text: "2 Implement",
        className: "text-cc-fg",
        style: { color: getPhaseColor("IMPLEMENTING") },
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
    const board: BoardRowData[] = [{ questId: "q-1", status: "IMPLEMENTING", updatedAt: 1 }];
    expect(boardSummary(board, 3)).toEqual([
      {
        text: "1 Implement",
        className: "text-cc-fg",
        style: { color: getPhaseColor("IMPLEMENTING") },
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
