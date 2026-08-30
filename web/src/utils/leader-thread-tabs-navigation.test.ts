import { describe, expect, it } from "vitest";
import type { LeaderThreadTabsProjectionTab } from "../../shared/leader-thread-tabs-projection.js";
import { createLeaderThreadTabsProjectionValue } from "../test-fixtures/leader-thread-tabs-projection.js";
import {
  mergeProjectedLeaderThreadRows,
  mergeProjectedTabsWithRestoredOrder,
  prioritizeLeaderThreadKeysForFallback,
} from "./leader-thread-tabs-navigation.js";

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

function projectionFor(tab: LeaderThreadTabsProjectionTab, currentStateAuthoritative = true) {
  return createLeaderThreadTabsProjectionValue({
    currentQuestStateVersion: currentStateAuthoritative ? 1 : null,
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

  it("preserves compatible Journey detail from legacy producers without source identity fields", () => {
    const samePlanHistory = {
      ...staleCompletedRow,
      status: "WORKING",
      section: "active" as const,
      journey: {
        mode: "active" as const,
        phaseIds: ["alignment", "work", "memory"] as const,
        currentPhaseId: "work" as const,
        activePhaseIndex: 1,
        phaseNotes: { "1": "Current Work note" },
        phaseTimings: { "1": { startedAt: 10 } },
      },
    };
    const legacyTab = currentTab({
      sourceLeaderSessionId: undefined,
      sourceRowCreatedAt: undefined,
      workerSessionId: undefined,
      workerSessionNum: undefined,
    });

    const [row] = mergeProjectedLeaderThreadRows([samePlanHistory], projectionFor(legacyTab, false), new Map());

    expect((row as typeof samePlanHistory).journey.phaseNotes).toEqual({
      "1": "Current Work note",
    });
    expect((row as typeof samePlanHistory).journey.phaseTimings).toEqual({
      "1": { startedAt: 10 },
    });
  });

  it("keeps local completion evidence for legacy projection producers", () => {
    const legacyTab = currentTab({
      sourceLeaderSessionId: undefined,
      sourceRowCreatedAt: undefined,
      workerSessionId: undefined,
      workerSessionNum: undefined,
    });
    const [row] = mergeProjectedLeaderThreadRows([staleCompletedRow], projectionFor(legacyTab, false), new Map());

    expect(row).toMatchObject({
      status: "done",
      section: "done",
      boardRow: { completedAt: 30 },
    });
  });

  it("promotes active fallback tabs across newer never-started scheduled tabs", () => {
    // Legacy/restored peers keep their relative order; only active-versus-scheduled inversions are repaired.
    expect(
      prioritizeLeaderThreadKeysForFallback(
        ["q-queued", "q-neutral", "q-work", "q-proposed", "q-memory"],
        [
          { questId: "q-queued", status: "QUEUED", updatedAt: 50 },
          { questId: "q-work", status: "WORKING", updatedAt: 20 },
          { questId: "q-proposed", status: "PROPOSED", updatedAt: 60 },
          { questId: "q-memory", status: "MEMORY", updatedAt: 10 },
        ],
      ),
    ).toEqual(["q-work", "q-memory", "q-queued", "q-neutral", "q-proposed"]);
  });

  it("uses projected current state during first-upgrade ordering without demoting a requeued run", () => {
    // Current projection authority overrides stale local classification, while an activated queued row stays neutral.
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
    expect(
      prioritizeLeaderThreadKeysForFallback(
        ["q-scheduled", "q-current", "q-requeued"],
        [
          { questId: "q-current", status: "QUEUED", updatedAt: 1 },
          { questId: "q-scheduled", status: "QUEUED", updatedAt: 2 },
          {
            questId: "q-requeued",
            status: "QUEUED",
            threadTabActivatedAt: 3,
            updatedAt: 4,
          },
        ],
        projection,
      ),
    ).toEqual(["q-current", "q-scheduled", "q-requeued"]);
  });

  it("preserves a cross-session requeued tab when no local active row carries its activation history", () => {
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
        currentTab({
          threadKey: "q-requeued",
          questId: "q-requeued",
          active: false,
          queued: true,
          neverStartedScheduled: false,
          boardStatus: "QUEUED",
          canClose: true,
        }),
      ],
    });

    expect(
      prioritizeLeaderThreadKeysForFallback(
        ["q-requeued", "q-scheduled", "q-current"],
        [
          { questId: "q-current", status: "WORKING", updatedAt: 1 },
          { questId: "q-scheduled", status: "QUEUED", updatedAt: 2 },
        ],
        projection,
      ),
    ).toEqual(["q-requeued", "q-current", "q-scheduled"]);
  });

  it("does not infer never-started state from an absent local row for legacy projections", () => {
    const projection = createLeaderThreadTabsProjectionValue({
      tabState: null,
      tabs: [
        currentTab({ threadKey: "q-current", questId: "q-current" }),
        currentTab({
          threadKey: "q-legacy-scheduled",
          questId: "q-legacy-scheduled",
          active: false,
          queued: true,
          neverStartedScheduled: undefined,
          boardStatus: "QUEUED",
          canClose: true,
        }),
      ],
    });

    expect(
      prioritizeLeaderThreadKeysForFallback(
        ["q-legacy-scheduled", "q-current"],
        [{ questId: "q-current", status: "WORKING", updatedAt: 1 }],
        projection,
      ),
    ).toEqual(["q-legacy-scheduled", "q-current"]);
  });

  it("keeps restored local order while projected visuals cover overlapping and newly derived tabs", () => {
    const restored = [
      { threadKey: "q-701", title: "Local A" },
      { threadKey: "q-702", title: "Local stale" },
    ];
    const projected = [
      { threadKey: "q-702", title: "Projected current" },
      { threadKey: "q-703", title: "Derived" },
    ];

    expect(mergeProjectedTabsWithRestoredOrder(projected, restored)).toEqual([
      { threadKey: "q-701", title: "Local A" },
      { threadKey: "q-702", title: "Projected current" },
      { threadKey: "q-703", title: "Derived" },
    ]);
  });
});
