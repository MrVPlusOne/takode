// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadQuestmasterViewState, saveQuestmasterViewState } from "./questmaster-view-state.js";

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
});
