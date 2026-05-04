// @vitest-environment jsdom

import type { BrowserIncomingMessage, ThreadWindowEntry } from "../types.js";
import {
  cacheHistoryWindow,
  cacheThreadWindow,
  getCachedHistoryWindowHash,
  getCachedThreadWindowHash,
  resetHistoryWindowCacheForTests,
  resolveCachedHistoryWindowMessages,
  resolveCachedThreadWindowEntries,
} from "./history-window-cache.js";

beforeEach(() => {
  localStorage.clear();
  resetHistoryWindowCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("history-window-cache", () => {
  it("keeps history windows in memory without persisting server-derived message payloads to localStorage", () => {
    // The cache may optimize same-page server window sync, but messages must not
    // become browser-persisted source-of-truth data after reload.
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const messages = [{ type: "user_message", id: "u1", content: "cached", timestamp: 1 } as BrowserIncomingMessage];

    cacheHistoryWindow(
      "s1",
      {
        from_turn: 0,
        turn_count: 10,
        total_turns: 10,
        section_turn_count: 5,
        visible_section_count: 2,
        window_hash: "history-hash",
      },
      messages,
    );

    expect(
      getCachedHistoryWindowHash("s1", {
        fromTurn: 0,
        turnCount: 10,
        sectionTurnCount: 5,
        visibleSectionCount: 2,
      }),
    ).toBe("history-hash");
    expect(
      resolveCachedHistoryWindowMessages("s1", {
        from_turn: 0,
        turn_count: 10,
        total_turns: 10,
        section_turn_count: 5,
        visible_section_count: 2,
        window_hash: "history-hash",
      }),
    ).toEqual(messages);
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("keeps thread windows in memory without persisting server-derived thread payloads to localStorage", () => {
    // Thread entries carry message payloads too, so the thread cache has the same
    // no-localStorage rule as the main history cache.
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const entries: ThreadWindowEntry[] = [
      { message: { type: "user_message", id: "u1", content: "cached", timestamp: 1 }, history_index: 4 },
    ];

    cacheThreadWindow(
      "s1",
      {
        thread_key: "Thread-Alpha",
        from_item: 0,
        item_count: 5,
        total_items: 5,
        source_history_length: 20,
        section_item_count: 5,
        visible_item_count: 2,
        window_hash: "thread-hash",
      },
      entries,
    );

    expect(
      getCachedThreadWindowHash("s1", {
        threadKey: "thread-alpha",
        fromItem: 0,
        itemCount: 5,
        sectionItemCount: 5,
        visibleItemCount: 2,
      }),
    ).toBe("thread-hash");
    expect(
      resolveCachedThreadWindowEntries("s1", {
        thread_key: "thread-alpha",
        from_item: 0,
        item_count: 5,
        total_items: 5,
        source_history_length: 20,
        section_item_count: 5,
        visible_item_count: 2,
        window_hash: "thread-hash",
      }),
    ).toEqual(entries);
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("ignores legacy persisted window-cache payloads instead of restoring them from localStorage", () => {
    // Old browsers may still have cc-history-window-cache/cc-thread-window-cache
    // keys. The current cache must treat them as inert leftovers.
    localStorage.setItem(
      "cc-history-window-cache:v1:legacy",
      JSON.stringify({
        version: 1,
        entries: [
          {
            key: "0:10:5:2",
            fromTurn: 0,
            turnCount: 10,
            sectionTurnCount: 5,
            visibleSectionCount: 2,
            windowHash: "legacy-history",
            messages: [{ type: "user_message", id: "legacy", content: "legacy", timestamp: 1 }],
            updatedAt: 1,
          },
        ],
      }),
    );
    localStorage.setItem(
      "server-id:cc-thread-window-cache:v1:legacy:thread-alpha",
      JSON.stringify({
        version: 1,
        entries: [
          {
            key: "thread-alpha:0:5:5:2",
            threadKey: "thread-alpha",
            fromItem: 0,
            itemCount: 5,
            sectionItemCount: 5,
            visibleItemCount: 2,
            windowHash: "legacy-thread",
            entries: [
              {
                message: { type: "user_message", id: "legacy", content: "legacy", timestamp: 1 },
                history_index: 1,
              },
            ],
            updatedAt: 1,
          },
        ],
      }),
    );

    expect(
      getCachedHistoryWindowHash("legacy", {
        fromTurn: 0,
        turnCount: 10,
        sectionTurnCount: 5,
        visibleSectionCount: 2,
      }),
    ).toBeUndefined();
    expect(
      getCachedThreadWindowHash("legacy", {
        threadKey: "thread-alpha",
        fromItem: 0,
        itemCount: 5,
        sectionItemCount: 5,
        visibleItemCount: 2,
      }),
    ).toBeUndefined();
    expect(localStorage.getItem("cc-history-window-cache:v1:legacy")).toBeNull();
    expect(localStorage.getItem("server-id:cc-thread-window-cache:v1:legacy:thread-alpha")).toBeNull();
  });
});
