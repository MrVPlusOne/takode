import { describe, expect, it } from "vitest";
import type { LeaderThreadTabsProjectionTab } from "../../shared/leader-thread-tabs-projection.js";
import { createLeaderThreadTabsProjectionValue } from "../test-fixtures/leader-thread-tabs-projection.js";
import {
  mergeProjectedLeaderThreadRows,
  mergeProjectedTabsWithRestoredOrder,
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
    worker: { sessionId: "worker-historical", sessionNum: 2569, status: "idle" },
    reviewer: { sessionId: "reviewer-historical", sessionNum: 2570, status: "idle" },
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
        worker: { sessionId: "worker-current", sessionNum: 2580, status: "running" },
        reviewer: { sessionId: "reviewer-current", sessionNum: 2581, status: "idle" },
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

    expect(row).toMatchObject({ status: "done", section: "done", boardRow: { completedAt: 30 } });
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
