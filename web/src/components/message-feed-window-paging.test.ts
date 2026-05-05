import { describe, expect, it } from "vitest";
import {
  HISTORY_WINDOW_SECTION_TURN_COUNT,
  HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
} from "../../shared/history-window.js";
import { getHistoryBoundaryWindowRequest, getThreadBoundaryWindowRequest } from "./message-feed-window-paging.js";
import type { HistoryWindowState, ThreadWindowState } from "../types.js";

function makeHistoryWindow(overrides: Partial<HistoryWindowState> = {}): HistoryWindowState {
  return {
    from_turn: 70,
    turn_count: 30,
    total_turns: 100,
    has_older_items: true,
    has_newer_items: false,
    start_index: 0,
    section_turn_count: 10,
    visible_section_count: 3,
    ...overrides,
  };
}

function makeThreadWindow(overrides: Partial<ThreadWindowState> = {}): ThreadWindowState {
  return {
    thread_key: "main",
    from_item: 70,
    item_count: 30,
    total_items: 100,
    has_older_items: true,
    has_newer_items: false,
    source_history_length: 200,
    section_item_count: 10,
    visible_item_count: 3,
    ...overrides,
  };
}

describe("message feed window paging", () => {
  it("uses ten-item render sections with the existing three-section initial window", () => {
    expect(HISTORY_WINDOW_SECTION_TURN_COUNT).toBe(10);
    expect(HISTORY_WINDOW_VISIBLE_SECTION_COUNT).toBe(3);
    expect(HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT).toBe(30);
  });

  it("loads older selected-thread content in three-section steps while retaining nearby context", () => {
    expect(getThreadBoundaryWindowRequest(makeThreadWindow(), "older")).toEqual({
      fromItem: 40,
      itemCount: 60,
    });

    expect(getThreadBoundaryWindowRequest(makeThreadWindow({ from_item: 40, item_count: 60 }), "older")).toEqual({
      fromItem: 10,
      itemCount: 90,
    });
  });

  it("keeps selected-thread windows bounded while moving through nearby newer ranges", () => {
    expect(getThreadBoundaryWindowRequest(makeThreadWindow({ from_item: 0, item_count: 90 }), "newer")).toEqual({
      fromItem: 10,
      itemCount: 90,
    });
  });

  it("mirrors the same older and newer paging policy for raw history windows", () => {
    expect(getHistoryBoundaryWindowRequest(makeHistoryWindow(), "older")).toEqual({
      fromTurn: 40,
      turnCount: 60,
    });
    expect(getHistoryBoundaryWindowRequest(makeHistoryWindow({ from_turn: 0, turn_count: 90 }), "newer")).toEqual({
      fromTurn: 10,
      turnCount: 90,
    });
  });

  it("does not request data when the active window already reaches that boundary", () => {
    expect(getThreadBoundaryWindowRequest(makeThreadWindow({ from_item: 0 }), "older")).toBeNull();
    expect(getThreadBoundaryWindowRequest(makeThreadWindow({ from_item: 70, item_count: 30 }), "newer")).toBeNull();
  });
});
