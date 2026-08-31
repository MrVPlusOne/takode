import { describe, expect, it } from "vitest";
import {
  LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_SUMMARY_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_TABS,
  applyLeaderThreadTabsProjectionPatch,
  createLeaderThreadTabsProjectionPatch,
  isLeaderThreadTabsProjectionValue,
  leaderThreadTabsProjectionEqual,
  reconcileLeaderThreadTabsProjectionValue,
  type LeaderThreadTabsProjectionValue,
} from "./leader-thread-tabs-projection.js";

function value(): LeaderThreadTabsProjectionValue {
  return {
    currentQuestStateVersion: 1,
    tabState: { version: 1 },
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
        tabs: [valid.tabs[0], { ...valid.tabs[1]!, threadKey: valid.tabs[0]!.threadKey }],
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
        tabs: Array.from({ length: LEADER_THREAD_TABS_PROJECTION_MAX_TABS + 1 }, (_, index) => ({
          ...valid.tabs[0]!,
          threadKey: `q-${index + 1}`,
          questId: `q-${index + 1}`,
        })),
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

  it("rejects unversioned or partial current-build payloads", () => {
    const unversioned = structuredClone(value()) as Partial<LeaderThreadTabsProjectionValue>;
    delete unversioned.currentQuestStateVersion;
    expect(isLeaderThreadTabsProjectionValue(unversioned)).toBe(false);

    for (const key of ["sourceLeaderSessionId", "sourceRowCreatedAt", "workerSessionId", "workerSessionNum"] as const) {
      const partial = structuredClone(value()) as unknown as { tabs: Array<Record<string, unknown>> };
      delete partial.tabs[0]![key];
      expect(isLeaderThreadTabsProjectionValue(partial), `missing ${key}`).toBe(false);
    }
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

  it("encodes a narrow status change as a field delta below the retained control payload", () => {
    const previous = value();
    const next = structuredClone(previous);
    next.threadStatuses["q-2"] = {
      ...next.threadStatuses["q-2"]!,
      summary: "changed bounded status",
      updatedAt: 8,
    };

    const patch = createLeaderThreadTabsProjectionPatch(previous, next);
    expect(patch).toEqual({ s: { "q-2": { summary: "changed bounded status", updatedAt: 8 } } });
    expect(applyLeaderThreadTabsProjectionPatch(previous, patch)).toEqual(next);

    const envelope = {
      type: "synced_projection_update",
      projection: "leader-thread-tabs",
      key: "leader",
      generation: "12345678-1234-1234-1234-123456789012",
      revision: 2,
      patch,
    };
    expect(new TextEncoder().encode(JSON.stringify(envelope)).byteLength).toBeLessThanOrEqual(236);
  });

  it("applies keyed tab add, remove, reorder, attention, status, and phase operations strictly", () => {
    const previous = value();
    const next = structuredClone(previous);
    next.tabs = [
      next.tabs[1]!,
      {
        ...next.tabs[0]!,
        threadKey: "q-4",
        questId: "q-4",
        title: "New current work",
        updatedAt: 12,
      },
    ];
    next.mainAttention = { ...next.mainAttention, mutedNeedsInput: false, updatedAt: 12 };
    delete next.threadStatuses["q-2"];
    next.activePhaseSummary = [{ label: "Memory", count: 1, tone: "phase" }];

    const patch = createLeaderThreadTabsProjectionPatch(previous, next);
    expect(patch).toEqual({
      t: { "q-1": null, "q-4": next.tabs[1] },
      o: ["q-2", "q-4"],
      a: next.mainAttention,
      s: { "q-2": null },
      p: next.activePhaseSummary,
    });
    expect(applyLeaderThreadTabsProjectionPatch(previous, patch)).toEqual(next);
  });

  it("rejects malformed patches and omits no-op patches", () => {
    const previous = value();
    expect(applyLeaderThreadTabsProjectionPatch(previous, { s: { "q-2": { unknown: true } } })).toBeUndefined();
    expect(applyLeaderThreadTabsProjectionPatch(previous, { o: ["q-1"] })).toBeUndefined();
    expect(applyLeaderThreadTabsProjectionPatch(previous, { t: { "q-bad": { threadKey: "q-bad" } } })).toBeUndefined();
    expect(createLeaderThreadTabsProjectionPatch(previous, structuredClone(previous))).toBeUndefined();
  });

  it("retains required current-build authority through reconciliation", () => {
    const previous = value();
    const current = structuredClone(previous);
    current.mainAttention = { ...current.mainAttention, updatedAt: 7 };

    const reconciled = reconcileLeaderThreadTabsProjectionValue(previous, current);
    expect(reconciled).not.toBe(previous);
    expect(reconciled.currentQuestStateVersion).toBe(1);
    expect(reconciled.tabs).toBe(previous.tabs);
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
