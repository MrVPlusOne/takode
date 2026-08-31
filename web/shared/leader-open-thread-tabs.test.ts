import { describe, expect, it } from "vitest";
import {
  applyLeaderServerCandidateThreadTabEvent,
  applyLeaderThreadTabUpdate,
  canServerCandidateOpenThread,
  createLeaderOpenThreadTabsState,
  MAX_LEADER_CLOSED_THREAD_TOMBSTONES,
  MAX_LEADER_OPEN_THREAD_TABS,
  normalizeLeaderOpenThreadKeys,
  normalizeLeaderOpenThreadTabsState,
  placeLeaderOpenThreadTabBeforeKeys,
  reorderLeaderOpenThreadKeys,
} from "./leader-open-thread-tabs.js";

describe("leader open thread tab state", () => {
  it("normalizes open keys and caps the authoritative server list at 50", () => {
    const manyKeys = Array.from({ length: MAX_LEADER_OPEN_THREAD_TABS + 5 }, (_, index) => `q-${index + 1}`);

    expect(normalizeLeaderOpenThreadKeys(["main", "all", " Q-1 ", "q-1", ...manyKeys])).toEqual(
      ["q-1", ...manyKeys.filter((key) => key !== "q-1")].slice(0, MAX_LEADER_OPEN_THREAD_TABS),
    );
  });

  it("evicts older open tabs when a new first-position tab exceeds the cap", () => {
    const baseline = Array.from({ length: MAX_LEADER_OPEN_THREAD_TABS }, (_, index) => `q-${index + 1}`);
    const state = {
      ...createLeaderOpenThreadTabsState(10),
      orderedOpenThreadKeys: baseline,
    };

    const next = applyLeaderThreadTabUpdate(state, { type: "open", threadKey: "q-1000", placement: "first" }, 20);

    expect(next.orderedOpenThreadKeys).toHaveLength(MAX_LEADER_OPEN_THREAD_TABS);
    expect(next.orderedOpenThreadKeys[0]).toBe("q-1000");
    expect(next.orderedOpenThreadKeys).not.toContain("q-50");
  });

  it("does not evict a higher-position tab for a fenced last-position candidate at the cap", () => {
    const baseline = Array.from({ length: MAX_LEADER_OPEN_THREAD_TABS }, (_, index) => `q-${index + 1}`);
    const state = {
      ...createLeaderOpenThreadTabsState(300),
      orderedOpenThreadKeys: baseline,
      explicitOrderUpdatedAt: 300,
    };

    const next = applyLeaderServerCandidateThreadTabEvent(state, "q-1000", 250);

    expect(next?.orderedOpenThreadKeys).toEqual(baseline);
    expect(next?.orderedOpenThreadKeys[0]).toBe("q-1");
    expect(next?.orderedOpenThreadKeys).not.toContain("q-1000");
    expect(next?.serverCandidatePromotedAt).toMatchObject({ "q-1000": 250 });
  });

  it("ignores obsolete or unsupported update operations without replacing state", () => {
    const state = {
      ...createLeaderOpenThreadTabsState(10),
      orderedOpenThreadKeys: ["q-1", "q-2"],
    };

    expect(applyLeaderThreadTabUpdate(state, { type: "auto_close", threadKeys: ["q-1"] }, 20)).toEqual(state);
    expect(applyLeaderThreadTabUpdate(state, { type: "unknown_operation" }, 20)).toEqual(state);
    expect(applyLeaderThreadTabUpdate(undefined, { type: "unknown_operation" }, 20)).toBeUndefined();
  });

  it("reorders existing server-open tabs without changing tombstones", () => {
    const state = {
      ...createLeaderOpenThreadTabsState(10),
      orderedOpenThreadKeys: ["q-1", "q-2", "q-3"],
      closedThreadTombstones: [{ threadKey: "q-9", closedAt: 9 }],
    };

    const next = applyLeaderThreadTabUpdate(state, { type: "reorder", orderedOpenThreadKeys: ["q-3", "q-1"] }, 20);

    expect(next.orderedOpenThreadKeys).toEqual(["q-3", "q-1", "q-2"]);
    expect(next.closedThreadTombstones).toEqual([{ threadKey: "q-9", closedAt: 9 }]);
    expect(next.updatedAt).toBe(20);
  });

  it("treats stale reorder payloads as order hints rather than close instructions", () => {
    expect(reorderLeaderOpenThreadKeys(["q-1", "q-2", "q-3"], ["q-3", "q-4", "q-1", "main"])).toEqual([
      "q-3",
      "q-1",
      "q-2",
    ]);

    const state = {
      ...createLeaderOpenThreadTabsState(10),
      orderedOpenThreadKeys: ["q-1", "q-2", "q-3"],
    };
    const next = applyLeaderThreadTabUpdate(state, { type: "reorder", orderedOpenThreadKeys: ["q-3"] }, 20);

    expect(next.orderedOpenThreadKeys).toEqual(["q-3", "q-1", "q-2"]);
  });

  it("keeps new first-position opens ahead of a manually reordered existing order", () => {
    const reordered = applyLeaderThreadTabUpdate(
      { ...createLeaderOpenThreadTabsState(10), orderedOpenThreadKeys: ["q-1", "q-2", "q-3"] },
      { type: "reorder", orderedOpenThreadKeys: ["q-3", "q-1", "q-2"] },
      20,
    );

    const opened = applyLeaderThreadTabUpdate(reordered, { type: "open", threadKey: "q-4", placement: "first" }, 30);

    expect(opened.orderedOpenThreadKeys).toEqual(["q-4", "q-3", "q-1", "q-2"]);
  });

  it("moves an already open first-position tab ahead of stale older tabs", () => {
    const stale = {
      ...createLeaderOpenThreadTabsState(10),
      orderedOpenThreadKeys: ["q-old-a", "q-old-b", "q-new"],
    };

    const opened = applyLeaderThreadTabUpdate(stale, { type: "open", threadKey: "q-new", placement: "first" }, 20);

    expect(opened.orderedOpenThreadKeys).toEqual(["q-new", "q-old-a", "q-old-b"]);
  });

  it("preserves user closes as bounded tombstones and explicit user opens remove them", () => {
    const closed = applyLeaderThreadTabUpdate(
      { ...createLeaderOpenThreadTabsState(1), orderedOpenThreadKeys: ["q-1", "q-2"] },
      { type: "close", threadKey: "q-1", closedAt: 100 },
      100,
    );

    expect(closed.orderedOpenThreadKeys).toEqual(["q-2"]);
    expect(closed.closedThreadTombstones).toEqual([{ threadKey: "q-1", closedAt: 100 }]);

    const reopened = applyLeaderThreadTabUpdate(closed, { type: "open", threadKey: "q-1" }, 110);
    expect(reopened.orderedOpenThreadKeys[0]).toBe("q-1");
    expect(reopened.closedThreadTombstones).toEqual([]);
  });

  it("records explicit ordering timestamps only for browser-owned tab actions", () => {
    const migrated = applyLeaderThreadTabUpdate(
      undefined,
      { type: "migrate", orderedOpenThreadKeys: ["q-local"], migratedAt: 10 },
      10,
    );
    expect(migrated).toMatchObject({ migratedFromLocalStorageAt: 10 });
    expect(migrated?.explicitOrderUpdatedAt).toBeUndefined();

    const serverCandidate = applyLeaderServerCandidateThreadTabEvent(
      createLeaderOpenThreadTabsState(1),
      "q-server",
      20,
    );
    expect(serverCandidate?.orderedOpenThreadKeys).toEqual(["q-server"]);
    expect(serverCandidate?.explicitOrderUpdatedAt).toBeUndefined();

    const userOpen = applyLeaderThreadTabUpdate(
      createLeaderOpenThreadTabsState(1),
      { type: "open", threadKey: "q-user" },
      30,
    );
    expect(userOpen?.explicitOrderUpdatedAt).toBe(30);

    const routeOpen = applyLeaderThreadTabUpdate(
      { ...createLeaderOpenThreadTabsState(1), orderedOpenThreadKeys: ["q-old", "q-route"] },
      { type: "open", threadKey: "q-route", placement: "first" },
      40,
    );
    expect(routeOpen?.orderedOpenThreadKeys).toEqual(["q-route", "q-old"]);
    expect(routeOpen?.explicitOrderUpdatedAt).toBe(40);

    const reordered = applyLeaderThreadTabUpdate(
      { ...createLeaderOpenThreadTabsState(1), orderedOpenThreadKeys: ["q-1", "q-2"] },
      { type: "reorder", orderedOpenThreadKeys: ["q-2", "q-1"] },
      50,
    );
    expect(reordered?.explicitOrderUpdatedAt).toBe(50);

    const closed = applyLeaderThreadTabUpdate(
      { ...createLeaderOpenThreadTabsState(1), orderedOpenThreadKeys: ["q-1"] },
      { type: "close", threadKey: "q-1", closedAt: 60 },
      60,
    );
    expect(closed?.explicitOrderUpdatedAt).toBe(60);
  });

  it("places review candidates before deferred keys without disturbing peer order", () => {
    expect(placeLeaderOpenThreadTabBeforeKeys(["q-1", "q-2", "q-3", "q-4"], "q-4", new Set(["q-3"]))).toEqual([
      "q-1",
      "q-2",
      "q-4",
      "q-3",
    ]);

    const state = {
      ...createLeaderOpenThreadTabsState(100),
      orderedOpenThreadKeys: ["q-1", "q-4", "q-3"],
    };
    const promoted = applyLeaderServerCandidateThreadTabEvent(state, "q-4", 200, {
      repositionExisting: true,
      placement: "before",
      beforeThreadKeys: new Set(["q-3"]),
    });
    expect(promoted?.orderedOpenThreadKeys).toEqual(["q-1", "q-4", "q-3"]);

    expect(placeLeaderOpenThreadTabBeforeKeys(["q-1", "q-42", "q-2"], "q-42", new Set(["q-42"]))).toEqual([
      "q-1",
      "q-42",
      "q-2",
    ]);
  });

  it("applies server-candidate positioning only on fresh edges", () => {
    const durable = {
      ...createLeaderOpenThreadTabsState(100),
      orderedOpenThreadKeys: ["q-a", "q-target", "q-b"],
      serverCandidatePromotedAt: { "q-target": 100 },
    };

    expect(applyLeaderServerCandidateThreadTabEvent(durable, "q-target", 100, { repositionExisting: true })).toBe(
      durable,
    );
    const promoted = applyLeaderServerCandidateThreadTabEvent(durable, "q-target", 200, {
      repositionExisting: true,
    });
    expect(promoted?.orderedOpenThreadKeys).toEqual(["q-target", "q-a", "q-b"]);
    expect(promoted?.updatedAt).toBe(200);

    const manuallyOrdered = {
      ...durable,
      updatedAt: 300,
      explicitOrderUpdatedAt: 300,
    };
    expect(
      applyLeaderServerCandidateThreadTabEvent(manuallyOrdered, "q-target", 250, { repositionExisting: true }),
    ).toBe(manuallyOrdered);
    expect(applyLeaderServerCandidateThreadTabEvent(manuallyOrdered, "q-new", 250)?.orderedOpenThreadKeys).toEqual([
      "q-a",
      "q-target",
      "q-b",
      "q-new",
    ]);
  });

  it("uses legacy updatedAt as the conservative fence before freshness metadata exists", () => {
    const legacy = {
      ...createLeaderOpenThreadTabsState(300),
      orderedOpenThreadKeys: ["q-a", "q-target", "q-b"],
    };

    expect(applyLeaderServerCandidateThreadTabEvent(legacy, "q-target", 250, { repositionExisting: true })).toBe(
      legacy,
    );
  });

  it("accepts distinct same-timestamp tab edges while deduping each thread independently", () => {
    const initial = {
      ...createLeaderOpenThreadTabsState(100),
      orderedOpenThreadKeys: ["q-1", "q-2", "q-3"],
    };
    const first = applyLeaderServerCandidateThreadTabEvent(initial, "q-2", 200, {
      repositionExisting: true,
    })!;
    const second = applyLeaderServerCandidateThreadTabEvent(first, "q-3", 200, {
      repositionExisting: true,
    })!;
    const duplicateFirst = applyLeaderServerCandidateThreadTabEvent(second, "q-2", 200, {
      repositionExisting: true,
    });

    expect(first.orderedOpenThreadKeys).toEqual(["q-2", "q-1", "q-3"]);
    expect(second.orderedOpenThreadKeys).toEqual(["q-3", "q-2", "q-1"]);
    expect(second.serverCandidatePromotedAt).toMatchObject({ "q-2": 200, "q-3": 200 });
    expect(duplicateFirst).toBe(second);
  });

  it("allows fresh server-created candidates to reopen only when newer than the close tombstone", () => {
    const closed = {
      ...createLeaderOpenThreadTabsState(1),
      closedThreadTombstones: [{ threadKey: "q-9", closedAt: 100 }],
    };

    expect(canServerCandidateOpenThread(closed, "q-9", 99)).toBe(false);
    expect(canServerCandidateOpenThread(closed, "q-9", 101, { allowTombstoneReopen: false })).toBe(false);
    expect(
      applyLeaderServerCandidateThreadTabEvent(closed, "q-9", 101, {
        repositionExisting: true,
        allowTombstoneReopen: false,
      }),
    ).toBe(closed);
    expect(applyLeaderServerCandidateThreadTabEvent(closed, "q-9", 99)).toBe(closed);

    const reopened = applyLeaderServerCandidateThreadTabEvent(closed, "q-9", 101);
    expect(reopened.orderedOpenThreadKeys).toEqual(["q-9"]);
    expect(reopened.closedThreadTombstones).toEqual([]);
  });

  it("caps closed tombstones while keeping the newest close decisions", () => {
    let state = createLeaderOpenThreadTabsState(0);
    for (let index = 0; index < MAX_LEADER_CLOSED_THREAD_TOMBSTONES + 5; index++) {
      state = applyLeaderThreadTabUpdate(state, { type: "close", threadKey: `q-${index}`, closedAt: index }, index);
    }

    expect(state.closedThreadTombstones).toHaveLength(MAX_LEADER_CLOSED_THREAD_TOMBSTONES);
    expect(state.closedThreadTombstones[0]).toEqual({
      threadKey: `q-${MAX_LEADER_CLOSED_THREAD_TOMBSTONES + 4}`,
      closedAt: MAX_LEADER_CLOSED_THREAD_TOMBSTONES + 4,
    });
    expect(state.closedThreadTombstones).not.toContainEqual({ threadKey: "q-0", closedAt: 0 });
  });

  it("normalizes persisted state defensively", () => {
    expect(
      normalizeLeaderOpenThreadTabsState({
        version: 1,
        orderedOpenThreadKeys: ["q-1", "main", "q-1", "q-2"],
        closedThreadTombstones: [
          { threadKey: "q-3", closedAt: 10 },
          { threadKey: "main", closedAt: 9 },
          { threadKey: "q-3", closedAt: 8 },
        ],
        updatedAt: -1,
        migratedFromLocalStorageAt: 5,
      }),
    ).toEqual({
      version: 1,
      orderedOpenThreadKeys: ["q-1", "q-2"],
      closedThreadTombstones: [{ threadKey: "q-3", closedAt: 10 }],
      updatedAt: 0,
      migratedFromLocalStorageAt: 5,
    });
  });
});
