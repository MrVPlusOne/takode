// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadQuestmasterViewState, saveQuestmasterViewState } from "./questmaster-view-state.js";

describe("questmaster-view-state", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cc-server-id", "test-server");
  });

  it("saves and loads the scroll position and status filter", () => {
    // Valid state should round-trip through scoped localStorage.
    saveQuestmasterViewState({ scrollTop: 240, statusFilter: "in_progress" });
    expect(loadQuestmasterViewState()).toEqual({ scrollTop: 240, statusFilter: "in_progress" });
  });

  it("omits the status filter when all quests are shown", () => {
    saveQuestmasterViewState({ scrollTop: 10 });
    expect(loadQuestmasterViewState()).toEqual({ scrollTop: 10 });
  });

  it("clamps negative scroll and ignores unknown status values", () => {
    // Defensive parsing prevents malformed localStorage from breaking the UI.
    localStorage.setItem("test-server:cc-questmaster-view", JSON.stringify({ scrollTop: -100, statusFilter: "bogus" }));
    expect(loadQuestmasterViewState()).toEqual({ scrollTop: 0 });
  });

  it("keeps a single status saved by the older multi-select filter", () => {
    // Saves from before the status chips stored a list; one entry is still a valid filter.
    localStorage.setItem("test-server:cc-questmaster-view", JSON.stringify({ scrollTop: 0, statusFilter: ["idea"] }));
    expect(loadQuestmasterViewState()?.statusFilter).toBe("idea");
  });

  it("falls back to all quests for an older multi-status save", () => {
    // The chips show one status at a time, so a saved combination cannot be shown and means all.
    localStorage.setItem(
      "test-server:cc-questmaster-view",
      JSON.stringify({ scrollTop: 0, collapsedGroups: ["done"], statusFilter: ["idea", "refined"] }),
    );
    expect(loadQuestmasterViewState()).toEqual({ scrollTop: 0 });
  });

  it("returns null for invalid JSON", () => {
    localStorage.setItem("test-server:cc-questmaster-view", "{not-json");
    expect(loadQuestmasterViewState()).toBeNull();
  });
});
