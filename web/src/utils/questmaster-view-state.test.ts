// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadQuestmasterViewState, saveQuestmasterViewState, toggleStatusFilter } from "./questmaster-view-state.js";
import type { QuestStatus } from "../types.js";

const ALL: QuestStatus[] = ["idea", "refined", "in_progress", "done"];

describe("questmaster-view-state", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cc-server-id", "test-server");
  });

  it("saves and loads scroll position and collapsed groups", () => {
    // Valid state should round-trip through scoped localStorage.
    saveQuestmasterViewState({
      scrollTop: 240,
      collapsedGroups: ["verification_inbox", "in_progress", "done"],
    });

    expect(loadQuestmasterViewState()).toEqual({
      scrollTop: 240,
      collapsedGroups: ["verification_inbox", "in_progress", "done"],
    });
  });

  it("clamps negative scroll and ignores unknown status values", () => {
    // Defensive parsing prevents malformed localStorage from breaking the UI.
    localStorage.setItem(
      "test-server:cc-questmaster-view",
      JSON.stringify({
        scrollTop: -100,
        collapsedGroups: ["idea", "verification_inbox", "invalid", "done"],
      }),
    );

    expect(loadQuestmasterViewState()).toEqual({
      scrollTop: 0,
      collapsedGroups: ["idea", "verification_inbox", "done"],
    });
  });

  it("returns null for invalid JSON", () => {
    localStorage.setItem("test-server:cc-questmaster-view", "{not-json");
    expect(loadQuestmasterViewState()).toBeNull();
  });

  // --- statusFilter persistence ---

  it("round-trips a partial status filter", () => {
    // A subset of statuses should persist and load back correctly.
    saveQuestmasterViewState({
      scrollTop: 0,
      collapsedGroups: [],
      statusFilter: ["idea", "done"],
    });
    expect(loadQuestmasterViewState()?.statusFilter).toEqual(["idea", "done"]);
  });

  it("normalizes full status set to undefined (meaning all)", () => {
    // When all 5 statuses are stored, the filter is equivalent to "no filter".
    saveQuestmasterViewState({
      scrollTop: 0,
      collapsedGroups: [],
      statusFilter: ALL,
    });
    expect(loadQuestmasterViewState()?.statusFilter).toBeUndefined();
  });

  it("normalizes empty status array to undefined", () => {
    // An empty array is meaningless -- treat as "all".
    localStorage.setItem(
      "test-server:cc-questmaster-view",
      JSON.stringify({ scrollTop: 0, collapsedGroups: [], statusFilter: [] }),
    );
    expect(loadQuestmasterViewState()?.statusFilter).toBeUndefined();
  });

  it("filters out invalid status strings from persisted filter", () => {
    // Mixed valid/invalid values should keep only recognized statuses.
    localStorage.setItem(
      "test-server:cc-questmaster-view",
      JSON.stringify({ scrollTop: 0, collapsedGroups: [], statusFilter: ["idea", "bogus", "refined"] }),
    );
    expect(loadQuestmasterViewState()?.statusFilter).toEqual(["idea", "refined"]);
  });

  it("returns undefined for non-array statusFilter", () => {
    // A string or number should be treated as missing (all).
    localStorage.setItem(
      "test-server:cc-questmaster-view",
      JSON.stringify({ scrollTop: 0, collapsedGroups: [], statusFilter: "idea" }),
    );
    expect(loadQuestmasterViewState()?.statusFilter).toBeUndefined();
  });

  it("omits statusFilter from persisted data when not provided", () => {
    // Backward compat: old format without statusFilter should load cleanly.
    saveQuestmasterViewState({ scrollTop: 10, collapsedGroups: ["done"] });
    expect(loadQuestmasterViewState()).toEqual({
      scrollTop: 10,
      collapsedGroups: ["done"],
    });
  });
});

describe("toggleStatusFilter", () => {
  const allSet = new Set<QuestStatus>(ALL);

  it("selects only the clicked status when all are currently selected", () => {
    // Clicking one status from the "all" state narrows to just that status.
    const result = toggleStatusFilter(allSet, "refined");
    expect(result).toEqual(new Set(["refined"]));
  });

  it("adds a status to a partial set", () => {
    const result = toggleStatusFilter(new Set<QuestStatus>(["idea"]), "done");
    expect(result).toEqual(new Set(["idea", "done"]));
  });

  it("removes a status from a partial set", () => {
    const result = toggleStatusFilter(new Set<QuestStatus>(["idea", "done"]), "done");
    expect(result).toEqual(new Set(["idea"]));
  });

  it("reverts to all when deselecting the last status", () => {
    // Removing the only selected status should reset to all (empty set is not allowed).
    const result = toggleStatusFilter(new Set<QuestStatus>(["idea"]), "idea");
    expect(result).toEqual(allSet);
  });

  it("does not mutate the input set", () => {
    const input = new Set<QuestStatus>(["idea", "refined"]);
    toggleStatusFilter(input, "refined");
    expect(input).toEqual(new Set(["idea", "refined"]));
  });
});
