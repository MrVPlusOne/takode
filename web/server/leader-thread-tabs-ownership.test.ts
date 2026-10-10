import { describe, expect, it } from "vitest";
import type { Session } from "./bridge/ws-bridge-session.js";
import type { BoardRow } from "./session-types.js";
import {
  buildLeaderThreadTabsProjectionValue,
  resolveLeaderThreadTabMutationPolicy,
} from "./leader-thread-tabs-projection.js";

/**
 * Quest tabs outlive a leader's own work on a quest. After a leader-to-leader
 * handoff the original leader removes the row from its board and another
 * leader's board runs the quest. These tests pin how the tab projection tells
 * the viewing leader whose board holds each quest, and that lifecycle flags
 * (active, scheduled, closable) describe only the viewing leader's own work.
 */

function boardRow(questId: string, status: string, overrides: Partial<BoardRow> = {}): BoardRow {
  return {
    questId,
    title: `Title ${questId}`,
    status,
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  };
}

function leader(id: string, openThreadKeys: string[], overrides: Partial<Session> = {}): Session {
  return {
    id,
    backendType: "claude",
    state: {
      isOrchestrator: true,
      leaderOpenThreadTabs: {
        version: 1,
        orderedOpenThreadKeys: openThreadKeys,
        closedThreadTombstones: [],
        updatedAt: 1,
      },
    },
    board: new Map(),
    completedBoard: new Map(),
    notifications: [],
    attentionRecords: [],
    pendingPermissions: new Map(),
    messageHistory: [],
    notificationCounter: 0,
    lastReadAt: 0,
    attentionReason: null,
    ...overrides,
  } as unknown as Session;
}

function worker(id: string, questId: string, leaderSessionId: string): Session {
  return {
    id,
    state: {
      isOrchestrator: false,
      claimedQuestId: questId,
      claimedQuestStatus: "in_progress",
      claimedQuestLeaderSessionId: leaderSessionId,
    },
    board: new Map(),
    completedBoard: new Map(),
    messageHistory: [],
  } as unknown as Session;
}

const WORKING_JOURNEY: BoardRow["journey"] = {
  mode: "active",
  phaseIds: ["work", "memory"],
  activePhaseIndex: 0,
};

describe("leader thread tab ownership", () => {
  it("marks a quest handed to another leader as led elsewhere and closable", () => {
    // The original leader removed the quest from its board; the new leader runs it with its own worker.
    const original = leader("leader-original", ["q-7"]);
    const successor = leader("leader-successor", ["q-7"], {
      board: new Map([
        [
          "q-7",
          boardRow("q-7", "WORKING", {
            worker: "worker-new",
            workerNum: 31,
            journey: WORKING_JOURNEY,
          }),
        ],
      ]),
    });
    const sessions = [original, successor, worker("worker-new", "q-7", "leader-successor")];

    const [tab] = buildLeaderThreadTabsProjectionValue(original, {
      sessions,
    }).tabs;
    expect(tab).toMatchObject({
      threadKey: "q-7",
      ownership: "other-leader",
      // The current Journey and worker still come from the leader that runs the quest.
      sourceLeaderSessionId: "leader-successor",
      boardStatus: "WORKING",
      workerSessionNum: 31,
      journey: { currentPhaseId: "work" },
      // It is not this leader's active work, so the tab is not in motion and can be closed.
      active: false,
      queued: false,
      completed: false,
      canClose: true,
    });
    // The server-side close guard agrees with the projected tab.
    expect(resolveLeaderThreadTabMutationPolicy(original, "q-7", { sessions })).toEqual({
      inMotion: false,
      scheduled: false,
      neverStartedScheduled: false,
      completed: false,
      canClose: true,
    });

    // The new leader sees its own active quest exactly as before.
    const [successorTab] = buildLeaderThreadTabsProjectionValue(successor, {
      sessions,
    }).tabs;
    expect(successorTab).toMatchObject({
      ownership: "own",
      active: true,
      canClose: false,
    });
  });

  it("does not schedule a quest another leader has queued", () => {
    const original = leader("leader-original", ["q-8"]);
    const successor = leader("leader-successor", [], {
      board: new Map([["q-8", boardRow("q-8", "QUEUED", { waitFor: ["q-1"] })]]),
    });
    const sessions = [original, successor];

    expect(buildLeaderThreadTabsProjectionValue(original, { sessions }).tabs[0]).toMatchObject({
      ownership: "other-leader",
      boardStatus: "QUEUED",
      queued: false,
      neverStartedScheduled: false,
      canClose: true,
    });
    expect(resolveLeaderThreadTabMutationPolicy(original, "q-8", { sessions })).toMatchObject({
      scheduled: false,
      neverStartedScheduled: false,
    });
  });

  it("keeps a completion by another leader marked as led elsewhere", () => {
    const original = leader("leader-original", ["q-9"]);
    const finisher = leader("leader-finisher", [], {
      completedBoard: new Map([["q-9", boardRow("q-9", "MEMORY", { completedAt: 50 })]]),
    });

    expect(
      buildLeaderThreadTabsProjectionValue(original, {
        sessions: [original, finisher],
      }).tabs[0],
    ).toMatchObject({
      ownership: "other-leader",
      sourceLeaderSessionId: "leader-finisher",
      completed: true,
      canClose: true,
    });
  });

  it("keeps a quest on this leader's active board as its own work", () => {
    // Another leader's claimed row authors the Journey view, but this leader still has the row on its board.
    const self = leader("leader-self", ["q-10"], {
      board: new Map([["q-10", boardRow("q-10", "WORKING", { createdAt: 5 })]]),
    });
    const other = leader("leader-other", [], {
      board: new Map([
        [
          "q-10",
          boardRow("q-10", "WORKING", {
            worker: "worker-other",
            createdAt: 50,
          }),
        ],
      ]),
    });
    const sessions = [self, other, worker("worker-other", "q-10", "leader-other")];

    expect(buildLeaderThreadTabsProjectionValue(self, { sessions }).tabs[0]).toMatchObject({
      ownership: "own",
      sourceLeaderSessionId: "leader-other",
      active: true,
      canClose: false,
    });
  });

  it("keeps this leader's completed quest as its own", () => {
    const self = leader("leader-self", ["q-11"], {
      completedBoard: new Map([["q-11", boardRow("q-11", "MEMORY", { completedAt: 30 })]]),
    });

    expect(buildLeaderThreadTabsProjectionValue(self, { sessions: [self] }).tabs[0]).toMatchObject({
      ownership: "own",
      completed: true,
    });
  });

  it("marks a quest no leader's board holds as off the board", () => {
    const self = leader("leader-self", ["q-12"]);

    expect(buildLeaderThreadTabsProjectionValue(self, { sessions: [self] }).tabs[0]).toMatchObject({
      ownership: "off-board",
      boardStatus: null,
      active: false,
      canClose: true,
    });
  });

  it("leaves ownership empty for threads that are not quests", () => {
    const self = leader("leader-self", ["release-notes"]);

    expect(buildLeaderThreadTabsProjectionValue(self, { sessions: [self] }).tabs[0]).toMatchObject({
      threadKey: "release-notes",
      ownership: null,
    });
  });
});
