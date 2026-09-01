import { describe, expect, it } from "vitest";
import {
  LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED,
  type LeaderThreadTabsProjectionTab,
} from "../../shared/leader-thread-tabs-projection.js";
import { createLeaderThreadTabsProjectionValue } from "../test-fixtures/leader-thread-tabs-projection.js";
import { buildLeaderThreadMigrationKeys, mergeProjectedLeaderThreadRows } from "./leader-thread-tabs-navigation.js";

function currentTab(overrides: Partial<LeaderThreadTabsProjectionTab> = {}): LeaderThreadTabsProjectionTab {
  return {
    ...createLeaderThreadTabsProjectionValue().tabs[0]!,
    threadKey: "q-1974",
    questId: "q-1974",
    title: "Current projected quest",
    boardStatus: "WORKING",
    journey: {
      mode: "active" as const,
      phaseIds: ["alignment", "work", "memory"] as const,
      currentPhaseId: "work",
      activePhaseIndex: 1,
      phaseCount: 3,
      durationSummary: null,
    },
    sourceLeaderSessionId: "leader-current",
    sourceRowCreatedAt: 200,
    workerSessionId: "worker-current",
    workerSessionNum: 2580,
    completed: false,
    active: true,
    canClose: true,
    updatedAt: 200,
    ...overrides,
  };
}

function projectionFor(tab: LeaderThreadTabsProjectionTab) {
  return createLeaderThreadTabsProjectionValue({
    tabs: [tab],
    tabState: {
      version: 1,
      orderedOpenThreadKeys: [tab.threadKey],
      closedThreadTombstones: [],
      updatedAt: tab.updatedAt,
    },
  });
}

const staleCompletedRow = {
  threadKey: "q-1974",
  questId: "q-1974",
  title: "Historical completed thread",
  status: "done",
  boardStatus: "WORKING",
  journey: {
    mode: "active" as const,
    phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"] as const,
    currentPhaseId: "work" as const,
    activePhaseIndex: 3,
  },
  boardRow: {
    questId: "q-1974",
    title: "Historical completed thread",
    status: "WORKING",
    worker: "worker-historical",
    workerNum: 2569,
    journey: {
      mode: "active" as const,
      phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"] as const,
      currentPhaseId: "work" as const,
      activePhaseIndex: 3,
    },
    createdAt: 10,
    updatedAt: 20,
    completedAt: 30,
  },
  leaderSessionId: "leader-historical",
  rowStatus: {
    worker: {
      sessionId: "worker-historical",
      sessionNum: 2569,
      status: "idle",
    },
    reviewer: {
      sessionId: "reviewer-historical",
      sessionNum: 2570,
      status: "idle",
    },
  },
  section: "done" as const,
  messageCount: 2,
  createdAt: 10,
};

describe("leader thread tabs navigation projection", () => {
  it("replaces stale completed Journey and participant detail with projected current state", () => {
    const [row] = mergeProjectedLeaderThreadRows([staleCompletedRow], projectionFor(currentTab()), new Map());

    expect(row).toMatchObject({
      threadKey: "q-1974",
      status: "WORKING",
      boardStatus: "WORKING",
      section: "active",
      leaderSessionId: "leader-current",
      journey: {
        phaseIds: ["alignment", "work", "memory"],
        currentPhaseId: "work",
        activePhaseIndex: 1,
      },
      boardRow: {
        worker: "worker-current",
        workerNum: 2580,
        createdAt: 200,
        completedAt: undefined,
        journey: {
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
          activePhaseIndex: 1,
        },
      },
    });
    expect((row as typeof staleCompletedRow).rowStatus).toBeUndefined();
  });

  it("preserves reviewer status only when projected run identity still matches", () => {
    const matchingRow = {
      ...staleCompletedRow,
      leaderSessionId: "leader-current",
      boardRow: {
        ...staleCompletedRow.boardRow,
        worker: "worker-current",
        workerNum: 2580,
        createdAt: 200,
      },
      rowStatus: {
        worker: {
          sessionId: "worker-current",
          sessionNum: 2580,
          status: "running",
        },
        reviewer: {
          sessionId: "reviewer-current",
          sessionNum: 2581,
          status: "idle",
        },
      },
    };

    const [row] = mergeProjectedLeaderThreadRows([matchingRow], projectionFor(currentTab()), new Map());

    expect((row as typeof matchingRow).rowStatus).toEqual(matchingRow.rowStatus);
  });

  it("drops same-plan historical notes and timings when the projected row identity changes", () => {
    const samePlanHistory = {
      ...staleCompletedRow,
      journey: {
        mode: "active" as const,
        phaseIds: ["alignment", "work", "memory"] as const,
        currentPhaseId: "work" as const,
        activePhaseIndex: 1,
        phaseNotes: { "1": "Historical Work note" },
        phaseTimings: { "1": { startedAt: 10, endedAt: 20 } },
      },
      boardRow: {
        ...staleCompletedRow.boardRow,
        journey: {
          mode: "active" as const,
          phaseIds: ["alignment", "work", "memory"] as const,
          currentPhaseId: "work" as const,
          activePhaseIndex: 1,
          phaseNotes: { "1": "Historical Work note" },
          phaseTimings: { "1": { startedAt: 10, endedAt: 20 } },
        },
      },
    };

    const [row] = mergeProjectedLeaderThreadRows([samePlanHistory], projectionFor(currentTab()), new Map());

    expect(row).toMatchObject({
      journey: {
        phaseIds: ["alignment", "work", "memory"],
        currentPhaseId: "work",
      },
      boardRow: {
        journey: {
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
        },
      },
    });
    expect((row as typeof samePlanHistory).journey.phaseNotes).toBeUndefined();
    expect((row as typeof samePlanHistory).journey.phaseTimings).toBeUndefined();
    expect((row as typeof samePlanHistory).boardRow.journey.phaseNotes).toBeUndefined();
    expect((row as typeof samePlanHistory).boardRow.journey.phaseTimings).toBeUndefined();
  });

  it("carries authoritative projected durations when no local detail identity matches", () => {
    const projected = currentTab({
      journey: {
        mode: "active",
        phaseIds: ["alignment", "work", "memory"],
        currentPhaseId: "work",
        activePhaseIndex: 1,
        phaseCount: 3,
        durationSummary: {
          phaseDurationsMs: [120_000],
          activePhaseStartedAt: 500_000,
        },
      },
    });

    const [row] = mergeProjectedLeaderThreadRows([staleCompletedRow], projectionFor(projected), new Map());

    expect(row).toMatchObject({
      journeyDurationSummary: {
        phaseDurationsMs: [120_000],
        activePhaseStartedAt: 500_000,
      },
    });
    expect((row as { journey?: { phaseTimings?: unknown } }).journey?.phaseTimings).toBeUndefined();
  });

  it("preserves matching phase notes while an explicit projected timing clear remains authoritative", () => {
    const matchingRow = {
      ...staleCompletedRow,
      leaderSessionId: "leader-current",
      journeyDurationSummary: {
        phaseDurationsMs: [60_000],
        activePhaseStartedAt: 70_000,
      },
      journey: {
        ...staleCompletedRow.journey,
        phaseIds: ["alignment", "work", "memory"] as const,
        activePhaseIndex: 1,
        currentPhaseId: "work" as const,
        phaseNotes: { "1": "Current Work note" },
      },
      boardRow: {
        ...staleCompletedRow.boardRow,
        worker: "worker-current",
        workerNum: 2580,
        createdAt: 200,
      },
    };

    const [row] = mergeProjectedLeaderThreadRows([matchingRow], projectionFor(currentTab()), new Map());

    expect((row as typeof matchingRow).journey.phaseNotes).toEqual({ "1": "Current Work note" });
    expect((row as typeof matchingRow).journeyDurationSummary).toBeNull();
  });

  it("uses exact matching board timing when the compact projection omits only duration evidence", () => {
    const matchingRow = {
      ...staleCompletedRow,
      leaderSessionId: "leader-current",
      journey: {
        mode: "active" as const,
        phaseIds: ["alignment", "work", "memory"] as const,
        activePhaseIndex: 1,
        currentPhaseId: "work" as const,
        phaseTimings: {
          "0": { startedAt: 1_000, endedAt: 61_000 },
          "1": { startedAt: 61_000 },
        },
      },
      boardRow: {
        ...staleCompletedRow.boardRow,
        worker: "worker-current",
        workerNum: 2580,
        createdAt: 200,
      },
    };
    const projected = currentTab({
      journey: {
        ...currentTab().journey!,
        durationSummary: LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED,
      },
    });

    const [row] = mergeProjectedLeaderThreadRows([matchingRow], projectionFor(projected), new Map());

    expect((row as typeof matchingRow).journey.phaseTimings).toEqual(matchingRow.journey.phaseTimings);
    expect((row as { journeyDurationSummary?: unknown }).journeyDurationSummary).toBeUndefined();
  });

  it("keeps wire-budget omission explicit when the same row has a revised phase sequence", () => {
    const matchingOldSequence = {
      ...staleCompletedRow,
      leaderSessionId: "leader-current",
      journey: {
        mode: "active" as const,
        phaseIds: ["alignment", "work", "memory"] as const,
        activePhaseIndex: 1,
        currentPhaseId: "work" as const,
        phaseTimings: {
          "0": { startedAt: 1_000, endedAt: 61_000 },
          "1": { startedAt: 61_000 },
        },
      },
      boardRow: {
        ...staleCompletedRow.boardRow,
        worker: "worker-current",
        workerNum: 2580,
        createdAt: 200,
      },
    };
    const projected = currentTab({
      journey: {
        mode: "active",
        phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
        currentPhaseId: "work",
        activePhaseIndex: 3,
        phaseCount: 5,
        durationSummary: LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED,
      },
    });

    const [row] = mergeProjectedLeaderThreadRows([matchingOldSequence], projectionFor(projected), new Map());

    const revisedJourney = (row as { journey?: { phaseIds?: readonly string[]; phaseTimings?: unknown } }).journey;
    expect(revisedJourney?.phaseIds).toEqual(["alignment", "work", "user-checkpoint", "work", "memory"]);
    expect(revisedJourney?.phaseTimings).toBeUndefined();
    expect((row as { journeyDurationSummary?: unknown }).journeyDurationSummary).toBe(
      LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED,
    );
  });

  it("drops historical Journey detail when current projected identity is explicitly absent", () => {
    const samePlanHistory = {
      ...staleCompletedRow,
      status: "WORKING",
      section: "active" as const,
      journey: {
        mode: "active" as const,
        phaseIds: ["alignment", "work", "memory"] as const,
        currentPhaseId: "work" as const,
        activePhaseIndex: 1,
        phaseNotes: { "1": "Historical Work note" },
        phaseTimings: { "1": { startedAt: 10 } },
      },
    };
    const currentWithoutMatchingRow = currentTab({
      sourceLeaderSessionId: null,
      sourceRowCreatedAt: null,
      workerSessionId: null,
      workerSessionNum: null,
    });

    const [row] = mergeProjectedLeaderThreadRows(
      [samePlanHistory],
      projectionFor(currentWithoutMatchingRow),
      new Map(),
    );

    expect((row as typeof samePlanHistory).journey.phaseNotes).toBeUndefined();
    expect((row as typeof samePlanHistory).journey.phaseTimings).toBeUndefined();
  });

  it("lets current projected activity clear historical local completion evidence", () => {
    const [row] = mergeProjectedLeaderThreadRows([staleCompletedRow], projectionFor(currentTab()), new Map());

    expect(row).toMatchObject({
      status: "WORKING",
      section: "active",
      boardRow: { completedAt: undefined },
    });
  });

  it("promotes current active migration keys across never-started scheduled keys", () => {
    const projection = createLeaderThreadTabsProjectionValue({
      tabState: null,
      tabs: [
        currentTab({ threadKey: "q-work", questId: "q-work" }),
        currentTab({ threadKey: "q-memory", questId: "q-memory", boardStatus: "MEMORY" }),
        currentTab({
          threadKey: "q-queued",
          questId: "q-queued",
          active: false,
          queued: true,
          neverStartedScheduled: true,
          boardStatus: "QUEUED",
        }),
        currentTab({
          threadKey: "q-proposed",
          questId: "q-proposed",
          active: false,
          proposed: true,
          neverStartedScheduled: true,
          boardStatus: "PROPOSED",
        }),
      ],
    });

    expect(
      buildLeaderThreadMigrationKeys(["q-queued", "q-neutral", "q-work", "q-proposed", "q-memory"], projection),
    ).toEqual(["q-work", "q-memory", "q-queued", "q-neutral", "q-proposed"]);
  });

  it("unions restored keys with missing current candidates during first-upgrade migration", () => {
    const projection = createLeaderThreadTabsProjectionValue({
      tabState: null,
      tabs: [
        currentTab({ threadKey: "q-current", questId: "q-current" }),
        currentTab({
          threadKey: "q-scheduled",
          questId: "q-scheduled",
          active: false,
          queued: true,
          neverStartedScheduled: true,
          boardStatus: "QUEUED",
          canClose: true,
        }),
      ],
    });

    expect(buildLeaderThreadMigrationKeys(["q-local", "q-scheduled"], projection)).toEqual([
      "q-local",
      "q-current",
      "q-scheduled",
    ]);
  });

  it("preserves a requeued peer when projection says it has started before", () => {
    const projection = createLeaderThreadTabsProjectionValue({
      tabState: null,
      tabs: [
        currentTab({ threadKey: "q-current", questId: "q-current" }),
        currentTab({
          threadKey: "q-scheduled",
          questId: "q-scheduled",
          active: false,
          queued: true,
          neverStartedScheduled: true,
          boardStatus: "QUEUED",
        }),
        currentTab({
          threadKey: "q-requeued",
          questId: "q-requeued",
          active: false,
          queued: true,
          neverStartedScheduled: false,
          boardStatus: "QUEUED",
        }),
      ],
    });

    expect(buildLeaderThreadMigrationKeys(["q-requeued", "q-scheduled", "q-current"], projection)).toEqual([
      "q-requeued",
      "q-current",
      "q-scheduled",
    ]);
  });

  it("does not infer never-started state when the current projection omits that optional discriminator", () => {
    const projection = createLeaderThreadTabsProjectionValue({
      tabState: null,
      tabs: [
        currentTab({ threadKey: "q-current", questId: "q-current" }),
        currentTab({
          threadKey: "q-unknown-scheduled",
          questId: "q-unknown-scheduled",
          active: false,
          queued: true,
          neverStartedScheduled: undefined,
          boardStatus: "QUEUED",
        }),
      ],
    });

    expect(buildLeaderThreadMigrationKeys(["q-unknown-scheduled", "q-current"], projection)).toEqual([
      "q-unknown-scheduled",
      "q-current",
    ]);
  });

  it("materializes projected candidates even when no localStorage keys exist", () => {
    const projection = createLeaderThreadTabsProjectionValue({
      tabState: null,
      tabs: [
        currentTab({ threadKey: "q-current", questId: "q-current" }),
        currentTab({ threadKey: "q-second", questId: "q-second" }),
      ],
    });

    expect(buildLeaderThreadMigrationKeys([], projection)).toEqual(["q-current", "q-second"]);
  });
});
