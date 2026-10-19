// @vitest-environment jsdom
import { getViewHistory, recordViewedTab, resetViewHistoryForTest, subscribeViewHistory } from "./view-history.js";

beforeEach(() => {
  localStorage.clear();
  resetViewHistoryForTest();
});

describe("view history", () => {
  // The Recently viewed list shows one row per tab, newest first: revisiting a tab moves it
  // to the top instead of adding a duplicate, and a session's leader tabs count separately.
  it("keeps one entry per tab, newest first", () => {
    recordViewedTab("leader", "main", 1);
    recordViewedTab("leader", "q-1", 2);
    recordViewedTab("worker", null, 3);
    recordViewedTab("leader", "main", 4);

    expect(getViewHistory()).toEqual([
      { sessionId: "leader", threadKey: "main", viewedAt: 4 },
      { sessionId: "worker", threadKey: null, viewedAt: 3 },
      { sessionId: "leader", threadKey: "q-1", viewedAt: 2 },
    ]);
  });

  // The list is bounded so storage cannot grow without limit over months of use.
  it("drops the oldest entries past its limit", () => {
    for (let index = 0; index < 50; index++) recordViewedTab(`session-${index}`, null, index);

    const entries = getViewHistory();
    expect(entries).toHaveLength(40);
    expect(entries[0]?.sessionId).toBe("session-49");
    expect(entries.at(-1)?.sessionId).toBe("session-10");
  });

  // The history survives a reload (a fresh module state), and saved data that is not a valid
  // list, or entries of the wrong shape, are ignored rather than breaking the panel.
  it("restores saved history and skips malformed entries", () => {
    recordViewedTab("leader", "q-2", 5);
    resetViewHistoryForTest();
    expect(getViewHistory()).toEqual([{ sessionId: "leader", threadKey: "q-2", viewedAt: 5 }]);

    localStorage.setItem(
      "cc-view-history",
      JSON.stringify([{ sessionId: 3 }, { sessionId: "a", threadKey: null, viewedAt: 1 }]),
    );
    resetViewHistoryForTest();
    expect(getViewHistory()).toEqual([{ sessionId: "a", threadKey: null, viewedAt: 1 }]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("cc-view-history", "{not json");
    resetViewHistoryForTest();
    expect(getViewHistory()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // An open Recently viewed list updates while the user keeps navigating.
  it("notifies subscribers on each record", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeViewHistory(listener);
    recordViewedTab("leader", "main", 1);
    unsubscribe();
    recordViewedTab("leader", "q-1", 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
