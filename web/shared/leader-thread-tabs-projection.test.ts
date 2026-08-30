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
    currentQuestStateVersion: 1,
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
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
          activePhaseIndex: 1,
          phaseCount: 3,
        },
        sourceLeaderSessionId: "leader-current",
        sourceRowCreatedAt: 10,
        workerSessionId: "worker-current",
        workerSessionNum: 42,
        active: true,
        queued: false,
        proposed: false,
        neverStartedScheduled: false,
        completed: false,
        canClose: false,
        attention: {
          needsInput: true,
          mutedNeedsInput: false,
          reviewUnread: true,
          updatedAt: 9,
        },
        updatedAt: 10,
      },
      {
        threadKey: "q-2",
        questId: "q-2",
        title: "Completed work",
        boardStatus: "MEMORY",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "memory",
          activePhaseIndex: 2,
          phaseCount: 3,
        },
        sourceLeaderSessionId: null,
        sourceRowCreatedAt: null,
        workerSessionId: null,
        workerSessionNum: null,
        active: false,
        queued: false,
        proposed: false,
        neverStartedScheduled: false,
        completed: true,
        canClose: true,
        attention: {
          needsInput: false,
          mutedNeedsInput: false,
          reviewUnread: false,
          updatedAt: 0,
        },
        updatedAt: 7,
      },
    ],
    mainAttention: {
      needsInput: false,
      mutedNeedsInput: true,
      reviewUnread: false,
      updatedAt: 6,
    },
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
    activePhaseSummary: [
      {
        label: "Work",
        count: 1,
        tone: "phase",
        color: "#123456",
        colorName: "blue",
      },
    ],
  };
}

describe("leader thread tabs projection wire contract", () => {
  it("accepts the bounded semantic tab state while rejecting malformed or oversized shapes", () => {
    const valid = value();
    expect(isLeaderThreadTabsProjectionValue(valid)).toBe(true);
    expect(isLeaderThreadTabsProjectionValue({ ...valid, tabState: null })).toBe(true);

    expect(
      isLeaderThreadTabsProjectionValue({
        ...valid,
        tabs: valid.tabs.slice(1),
      }),
    ).toBe(false);
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
    expect(
      isLeaderThreadTabsProjectionValue({
        ...valid,
        tabs: [
          {
            ...valid.tabs[0],
            journey: {
              ...valid.tabs[0]!.journey!,
              phaseIds: ["alignment", "work"],
            },
          },
          valid.tabs[1],
        ],
      }),
    ).toBe(false);
    expect(
      isLeaderThreadTabsProjectionValue({
        ...valid,
        tabs: [{ ...valid.tabs[0], workerSessionNum: -1 }, valid.tabs[1]],
      }),
    ).toBe(false);
    expect(
      isLeaderThreadTabsProjectionValue({
        ...valid,
        currentQuestStateVersion: 2,
      }),
    ).toBe(false);
    expect(
      isLeaderThreadTabsProjectionValue({
        ...valid,
        tabs: [{ ...valid.tabs[0], neverStartedScheduled: "yes" }, valid.tabs[1]],
      }),
    ).toBe(false);
  });

  it("requires the full current-state payload atomically when version 1 is present", () => {
    const current = value();
    expect(isLeaderThreadTabsProjectionValue(current)).toBe(true);

    for (const key of ["sourceLeaderSessionId", "sourceRowCreatedAt", "workerSessionId", "workerSessionNum"] as const) {
      const missingIdentity = structuredClone(current);
      delete missingIdentity.tabs[0]![key];
      expect(isLeaderThreadTabsProjectionValue(missingIdentity), `missing ${key}`).toBe(false);
    }

    const missingPhaseIds = structuredClone(current);
    delete missingPhaseIds.tabs[0]!.journey!.phaseIds;
    expect(isLeaderThreadTabsProjectionValue(missingPhaseIds)).toBe(false);

    const nullIdentity = structuredClone(current);
    nullIdentity.tabs[0] = {
      ...nullIdentity.tabs[0]!,
      sourceLeaderSessionId: null,
      sourceRowCreatedAt: null,
      workerSessionId: null,
      workerSessionNum: null,
    };
    expect(isLeaderThreadTabsProjectionValue(nullIdentity)).toBe(true);

    const nullJourney = structuredClone(current);
    nullJourney.tabs[0]!.journey = null;
    expect(isLeaderThreadTabsProjectionValue(nullJourney)).toBe(true);
  });

  it("preserves optional current-state fields for unversioned legacy payloads", () => {
    const legacy = value();
    delete legacy.currentQuestStateVersion;
    for (const tab of legacy.tabs) {
      delete tab.sourceLeaderSessionId;
      delete tab.sourceRowCreatedAt;
      delete tab.workerSessionId;
      delete tab.workerSessionNum;
      if (tab.journey) delete tab.journey.phaseIds;
    }

    expect(isLeaderThreadTabsProjectionValue(legacy)).toBe(true);
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
    next.tabs[0]!.attention = {
      ...next.tabs[0]!.attention,
      needsInput: false,
      updatedAt: 11,
    };
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

  it("upgrades legacy cached values when current-state authority arrives", () => {
    const legacy = value();
    delete legacy.currentQuestStateVersion;
    const current = structuredClone(legacy);
    current.currentQuestStateVersion = 1;

    const reconciled = reconcileLeaderThreadTabsProjectionValue(legacy, current);
    expect(reconciled).not.toBe(legacy);
    expect(reconciled.currentQuestStateVersion).toBe(1);
    expect(reconciled.tabs).toBe(legacy.tabs);
  });

  it("treats current phase sequences and participant identity as semantic visual changes", () => {
    const previous = value();
    const next = structuredClone(previous);
    next.tabs[0] = {
      ...next.tabs[0]!,
      sourceLeaderSessionId: "leader-next",
      sourceRowCreatedAt: 20,
      workerSessionId: "worker-next",
      workerSessionNum: 43,
      journey: {
        ...next.tabs[0]!.journey!,
        phaseIds: ["alignment", "work", "user-checkpoint", "memory"],
        activePhaseIndex: 1,
        phaseCount: 4,
      },
    };

    expect(leaderThreadTabsProjectionEqual(previous, next)).toBe(false);
    const reconciled = reconcileLeaderThreadTabsProjectionValue(previous, next);
    expect(reconciled.tabs[0]).not.toBe(previous.tabs[0]);
    expect(reconciled.tabs[1]).toBe(previous.tabs[1]);
  });

  it("treats the scheduled activation-history distinction as a semantic visual change", () => {
    const previous = value();
    previous.tabs[0] = {
      ...previous.tabs[0]!,
      active: false,
      queued: true,
      canClose: true,
      neverStartedScheduled: false,
    };
    const next = structuredClone(previous);
    next.tabs[0]!.neverStartedScheduled = true;

    expect(leaderThreadTabsProjectionEqual(previous, next)).toBe(false);
    const reconciled = reconcileLeaderThreadTabsProjectionValue(previous, next);
    expect(reconciled.tabs[0]).not.toBe(previous.tabs[0]);
    expect(reconciled.tabs[1]).toBe(previous.tabs[1]);
  });
});
