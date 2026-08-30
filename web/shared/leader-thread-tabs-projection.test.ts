import { describe, expect, it } from "vitest";
import {
  LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_SUMMARY_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_TABS,
  isLeaderThreadTabsProjectionValue,
  leaderThreadTabsProjectionEqual,
  reconcileLeaderThreadTabsProjectionValue,
  type LeaderThreadTabsProjectionValue,
} from "./leader-thread-tabs-projection.js";

function value(): LeaderThreadTabsProjectionValue {
  return {
    tabState: {
      version: 1,
      orderedOpenThreadKeys: ["q-1", "q-2"],
      closedThreadTombstones: [{ threadKey: "q-3", closedAt: 8 }],
      updatedAt: 10,
    },
    tabs: [
      {
        threadKey: "q-1",
        questId: "q-1",
        title: "Active work",
        boardStatus: "WORKING",
        journey: { mode: "active", currentPhaseId: "work", activePhaseIndex: 1, phaseCount: 3 },
        active: true,
        queued: false,
        proposed: false,
        completed: false,
        canClose: false,
        attention: { needsInput: true, mutedNeedsInput: false, reviewUnread: true, updatedAt: 9 },
        updatedAt: 10,
      },
      {
        threadKey: "q-2",
        questId: "q-2",
        title: "Completed work",
        boardStatus: "MEMORY",
        journey: { mode: "active", currentPhaseId: "memory", activePhaseIndex: 2, phaseCount: 3 },
        active: false,
        queued: false,
        proposed: false,
        completed: true,
        canClose: true,
        attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
        updatedAt: 7,
      },
    ],
    mainAttention: { needsInput: false, mutedNeedsInput: true, reviewUnread: false, updatedAt: 6 },
    threadStatuses: {
      "q-2": {
        kind: "waiting",
        label: "Thread Waiting",
        threadKey: "q-2",
        questId: "q-2",
        summary: "waiting on a reviewer",
        messageId: "assistant-2",
        timestamp: 7,
        updatedAt: 7,
      },
    },
    activePhaseSummary: [{ label: "Work", count: 1, tone: "phase", color: "#123456", colorName: "blue" }],
  };
}

describe("leader thread tabs projection wire contract", () => {
  it("accepts the bounded semantic tab state while rejecting malformed or oversized shapes", () => {
    const valid = value();
    expect(isLeaderThreadTabsProjectionValue(valid)).toBe(true);
    expect(isLeaderThreadTabsProjectionValue({ ...valid, tabState: null })).toBe(true);

    expect(isLeaderThreadTabsProjectionValue({ ...valid, tabs: valid.tabs.slice(1) })).toBe(false);
    expect(
      isLeaderThreadTabsProjectionValue({
        ...valid,
        threadStatuses: {
          "q-2": {
            ...valid.threadStatuses["q-2"],
            summary: "x".repeat(LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_SUMMARY_LENGTH + 1),
          },
        },
      }),
    ).toBe(false);
    expect(
      isLeaderThreadTabsProjectionValue({
        ...valid,
        tabState: {
          ...valid.tabState!,
          orderedOpenThreadKeys: Array.from(
            { length: LEADER_THREAD_TABS_PROJECTION_MAX_TABS + 1 },
            (_, index) => `q-${index + 1}`,
          ),
        },
      }),
    ).toBe(false);
  });

  it("distinguishes proposed from queued and preserves exact Waiting status semantics", () => {
    const proposed = value();
    proposed.tabs[0] = {
      ...proposed.tabs[0]!,
      active: false,
      proposed: true,
      boardStatus: "PROPOSED",
    };
    expect(isLeaderThreadTabsProjectionValue(proposed)).toBe(true);
    expect(proposed.tabs[0]).toMatchObject({ proposed: true, queued: false });
    expect(proposed.threadStatuses["q-2"]?.kind).toBe("waiting");
  });

  it("reuses unchanged slices, tabs, and statuses across a partial update", () => {
    const previous = value();
    const next = structuredClone(previous);
    next.tabs[0]!.attention = { ...next.tabs[0]!.attention, needsInput: false, updatedAt: 11 };
    next.tabs[0]!.updatedAt = 11;

    const reconciled = reconcileLeaderThreadTabsProjectionValue(previous, next);
    expect(reconciled).not.toBe(previous);
    expect(reconciled.tabState).toBe(previous.tabState);
    expect(reconciled.tabs).not.toBe(previous.tabs);
    expect(reconciled.tabs[0]).not.toBe(previous.tabs[0]);
    expect(reconciled.tabs[1]).toBe(previous.tabs[1]);
    expect(reconciled.mainAttention).toBe(previous.mainAttention);
    expect(reconciled.threadStatuses).toBe(previous.threadStatuses);
    expect(reconciled.activePhaseSummary).toBe(previous.activePhaseSummary);
    expect(leaderThreadTabsProjectionEqual(previous, reconciled)).toBe(false);

    const equal = reconcileLeaderThreadTabsProjectionValue(reconciled, structuredClone(reconciled));
    expect(equal).toBe(reconciled);
  });
});
