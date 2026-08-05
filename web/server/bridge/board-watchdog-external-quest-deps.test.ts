import { describe, expect, it, vi } from "vitest";
import {
  completeDoneBoardRowsForQuestInAllSessions,
  sweepBoardDispatchableWarnings,
  upsertBoardRow,
} from "./board-watchdog-controller.js";

type TestSession = {
  id: string;
  board: Map<string, any>;
  completedBoard: Map<string, any>;
  boardDispatchStates: Map<string, any>;
  boardStallStates: Map<string, any>;
  state: Record<string, unknown>;
};

function makeSession(id: string): TestSession {
  return {
    id,
    board: new Map(),
    completedBoard: new Map(),
    boardDispatchStates: new Map(),
    boardStallStates: new Map(),
    state: {},
  };
}

function matchingRows(sessions: Map<string, TestSession>, questId: string, boardKey: "board" | "completedBoard") {
  const normalizedQuestId = questId.toLowerCase();
  const rows: any[] = [];
  for (const session of sessions.values()) {
    for (const row of session[boardKey].values()) {
      if (row.questId.toLowerCase() === normalizedQuestId) rows.push(row);
    }
  }
  return rows;
}

function makeHarness() {
  const ownerLeader = makeSession("owner-leader");
  const externalLeader = makeSession("external-leader");
  const sessions = new Map([
    [ownerLeader.id, ownerLeader],
    [externalLeader.id, externalLeader],
  ]);
  const launcherSessions = new Map<string, any>([
    [ownerLeader.id, { sessionId: ownerLeader.id, sessionNum: 11, isOrchestrator: true }],
    [externalLeader.id, { sessionId: externalLeader.id, sessionNum: 22, isOrchestrator: true }],
    ["external-worker", { sessionId: "external-worker", sessionNum: 23, herdedBy: externalLeader.id }],
  ]);
  const targetedEvents: any[] = [];
  const injectedReminders: any[] = [];
  const broadcasts: any[] = [];

  const watchdogDeps = {
    getLauncherSessionInfo: (sessionId: string) => launcherSessions.get(sessionId),
    getSession: (sessionId: string) => sessions.get(sessionId),
    listSessions: () => Array.from(launcherSessions.values()),
    resolveSessionId: (ref: string) =>
      Array.from(launcherSessions.values()).find((session) => String(session.sessionNum) === ref)?.sessionId,
    timerCount: () => 0,
    backendConnected: () => true,
    getBoard: (sessionId: string) => Array.from(sessions.get(sessionId)?.board.values() ?? []),
    getBoardRowsForQuest: (questId: string) => matchingRows(sessions, questId, "board"),
    getCompletedBoardRowsForQuest: (questId: string) => matchingRows(sessions, questId, "completedBoard"),
    emitTakodeEvent: vi.fn(),
    emitTakodeEventForOrchestrator: (
      orchestratorSessionId: string,
      sourceSessionId: string,
      type: string,
      data: Record<string, unknown>,
    ) => targetedEvents.push({ orchestratorSessionId, sourceSessionId, type, data }),
    injectLeaderBoardDispatchableReminder: (leaderSessionId: string, candidate: unknown) =>
      injectedReminders.push({ leaderSessionId, candidate }),
    markNotificationDone: vi.fn(() => true),
    isSessionIdle: () => true,
  };
  const workBoardStateDeps = {
    getBoardDispatchableSignature: () => null,
    markNotificationDone: vi.fn(() => true),
    broadcastBoard: (session: TestSession, board: unknown[], completedBoard: unknown[]) =>
      broadcasts.push({ sessionId: session.id, board, completedBoard }),
    persistSession: vi.fn(),
    notifyReview: vi.fn(),
  };

  return { ownerLeader, externalLeader, sessions, watchdogDeps, workBoardStateDeps, targetedEvents, injectedReminders };
}

describe("external quest wait-for dependencies", () => {
  it("keeps a queued row blocked while an external quest is active, then targets the owner when it reaches Memory", () => {
    const { ownerLeader, externalLeader, watchdogDeps, workBoardStateDeps, targetedEvents, injectedReminders } =
      makeHarness();

    upsertBoardRow(
      externalLeader,
      {
        questId: "q-20",
        title: "External active dependency",
        worker: "external-worker",
        workerNum: 23,
        status: "WORKING",
      },
      workBoardStateDeps,
    );
    upsertBoardRow(
      ownerLeader,
      { questId: "q-21", title: "External quest dependent", status: "QUEUED", waitFor: ["q-20"] },
      workBoardStateDeps,
    );

    sweepBoardDispatchableWarnings([ownerLeader, externalLeader], Date.now(), watchdogDeps);

    expect(targetedEvents).toHaveLength(0);
    expect(injectedReminders).toHaveLength(0);

    upsertBoardRow(
      externalLeader,
      {
        questId: "q-20",
        worker: "external-worker",
        workerNum: 23,
        status: "MEMORY",
      },
      workBoardStateDeps,
    );

    sweepBoardDispatchableWarnings([ownerLeader, externalLeader], Date.now(), watchdogDeps);

    expect(targetedEvents).toEqual([
      expect.objectContaining({
        orchestratorSessionId: ownerLeader.id,
        sourceSessionId: "external-worker",
        type: "board_dispatchable",
        data: expect.objectContaining({
          questId: "q-21",
          summary: expect.stringContaining("wait-for resolved (q-20)"),
        }),
      }),
    ]);
    expect(injectedReminders).toHaveLength(0);
  });

  it("clears external quest wait-for refs across leader boards when the quest completes", () => {
    const {
      ownerLeader,
      externalLeader,
      sessions,
      watchdogDeps,
      workBoardStateDeps,
      targetedEvents,
      injectedReminders,
    } = makeHarness();

    upsertBoardRow(
      externalLeader,
      {
        questId: "q-30",
        title: "External dependency completing",
        worker: "external-worker",
        workerNum: 23,
        status: "WORKING",
      },
      workBoardStateDeps,
    );
    upsertBoardRow(
      ownerLeader,
      { questId: "q-31", title: "External quest done dependent", status: "QUEUED", waitFor: ["q-30"] },
      workBoardStateDeps,
    );

    sweepBoardDispatchableWarnings([ownerLeader, externalLeader], Date.now(), watchdogDeps);

    expect(targetedEvents).toHaveLength(0);
    expect(injectedReminders).toHaveLength(0);

    expect(completeDoneBoardRowsForQuestInAllSessions(sessions, "q-30", workBoardStateDeps)).toEqual([
      externalLeader.id,
    ]);
    expect(ownerLeader.board.get("q-31")?.waitFor).toEqual(["free-worker"]);

    sweepBoardDispatchableWarnings([ownerLeader, externalLeader], Date.now(), watchdogDeps);

    expect(targetedEvents).toHaveLength(0);
    expect(injectedReminders).toEqual([
      expect.objectContaining({
        leaderSessionId: ownerLeader.id,
        candidate: expect.objectContaining({
          questId: "q-31",
          summary: expect.stringContaining("worker slots are available"),
        }),
      }),
    ]);
  });
});
