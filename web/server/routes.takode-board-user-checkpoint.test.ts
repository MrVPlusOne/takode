import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerTakodeBoardRoutes } from "./routes/takode-board.js";
import type { BoardRow } from "./session-types.js";
import * as questStore from "./quest-store.js";

interface TestSession {
  id: string;
  state: Record<string, unknown>;
  board: Map<string, BoardRow>;
  completedBoard: Map<string, BoardRow>;
  notifications: Array<Record<string, unknown>>;
  boardDispatchStates: Map<string, Record<string, unknown>>;
  boardStallStates: Map<string, Record<string, unknown>>;
  attentionRecords: Array<Record<string, unknown>>;
}

let app: Hono;
let session: TestSession;
let sessions: Map<string, TestSession>;

function createSession(id = "leader-1"): TestSession {
  return {
    id,
    state: {},
    board: new Map(),
    completedBoard: new Map(),
    notifications: [],
    boardDispatchStates: new Map(),
    boardStallStates: new Map(),
    attentionRecords: [],
  };
}

function getBoardRows(sessionId: string): BoardRow[] {
  return [...(sessions.get(sessionId)?.board.values() ?? [])];
}

function createRouteApp(): Hono {
  const api = new Hono();
  registerTakodeBoardRoutes(api, {
    launcher: {} as any,
    wsBridge: {
      getSession: vi.fn((sessionId: string) => sessions.get(sessionId) ?? null),
      completeDoneBoardRowsForQuest: vi.fn(() => []),
      findAssignedBoardRowsForWorker: vi.fn(() => []),
    } as any,
    authenticateTakodeCaller: vi.fn(() => ({
      callerId: "leader-1",
      caller: { sessionId: "leader-1", isOrchestrator: true },
    })) as any,
    resolveId: vi.fn((raw: string) => raw),
    boardWatchdogDeps: {
      getLauncherSessionInfo: vi.fn((sessionId: string) => ({
        isOrchestrator: sessionId === "leader-1",
        lastActivityAt: 0,
      })),
      getSession: vi.fn((sessionId: string) => sessions.get(sessionId)),
      listSessions: vi.fn(() => []),
      resolveSessionId: vi.fn((ref: string) => (sessions.has(ref) ? ref : undefined)),
      timerCount: vi.fn(() => 0),
      backendConnected: vi.fn(() => true),
      getBoard: vi.fn((sessionId: string) => getBoardRows(sessionId)),
      emitTakodeEvent: vi.fn(),
      markNotificationDone: vi.fn(() => true),
      isSessionIdle: vi.fn(() => true),
    },
    workBoardStateDeps: {
      getBoardDispatchableSignature: vi.fn(() => null),
      markNotificationDone: vi.fn(() => true),
      broadcastBoard: vi.fn(),
      broadcastAttentionRecords: vi.fn(),
      persistSession: vi.fn(),
      notifyReview: vi.fn(),
    },
    buildBoardRowSessionStatuses: vi.fn(async () => ({})),
    resolveSessionDeps: vi.fn(() => []),
  });
  return api;
}

function setupTakodeSessions(): void {
  session = createSession();
  sessions = new Map([[session.id, session]]);
  app = createRouteApp();
}

async function postBoard(body: Record<string, unknown>): Promise<Response> {
  return app.request("/sessions/leader-1/board", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function postAdvance(questId: string): Promise<Response> {
  return app.request(`/sessions/leader-1/board/${questId}/advance`, { method: "POST", body: JSON.stringify({}) });
}

function addOpenNotification(id: string): void {
  session.notifications.push({ id, category: "needs-input", summary: "Question", done: false, timestamp: 1 });
}

function workingRow(phaseIds: string[], activePhaseIndex = 0): BoardRow {
  return {
    questId: "q-9",
    worker: "worker-1",
    status: "WORKING",
    createdAt: 1,
    updatedAt: 2,
    journey: {
      mode: "active",
      presetId: "v2-work",
      phaseIds: phaseIds as NonNullable<BoardRow["journey"]>["phaseIds"],
      activePhaseIndex,
      currentPhaseId: "work",
    },
  };
}

// The leader's board commands around automatic User Checkpoints: marking a question as blocking
// pauses Work, ending a checkpoint by hand keeps its questions open, and a stale `board advance`
// after Takode already resumed Work is refused.
describe("Takode board automatic User Checkpoint routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(questStore, "getQuest").mockResolvedValue(null);
    setupTakodeSessions();
  });

  it("puts Work into User Checkpoint when the leader marks a question as blocking", async () => {
    session.board.set("q-9", { ...workingRow(["work", "memory"]), openQuestions: ["n-5"] });
    addOpenNotification("n-5");

    const res = await postBoard({ questId: "q-9", waitForInput: ["5"] });

    expect(res.status).toBe(200);
    const row = session.board.get("q-9")!;
    expect(row.status).toBe("USER_CHECKPOINTING");
    expect(row.waitForInput).toEqual(["n-5"]);
    expect(row.openQuestions).toBeUndefined();
    expect(row.journey).toMatchObject({
      phaseIds: ["work", "user-checkpoint", "work", "memory"],
      activePhaseIndex: 1,
    });
  });

  it("ends a checkpoint by hand without resolving its questions", async () => {
    session.board.set("q-9", workingRow(["work", "memory"]));
    addOpenNotification("n-5");
    await postBoard({ questId: "q-9", waitForInput: ["5"] });

    const res = await postBoard({ questId: "q-9", status: "WORKING" });

    expect(res.status).toBe(200);
    const row = session.board.get("q-9")!;
    expect(row.status).toBe("WORKING");
    expect(row.journey).toMatchObject({ activePhaseIndex: 2, currentPhaseId: "work" });
    expect(row.waitForInput).toBeUndefined();
    expect(row.openQuestions).toEqual(["n-5"]);
    // The question stays open for the user to answer later.
    expect(session.notifications[0]).toMatchObject({ id: "n-5", done: false });
  });

  it("ends a checkpoint by hand and resolves its questions when asked to clear them", async () => {
    session.board.set("q-9", workingRow(["work", "memory"]));
    addOpenNotification("n-5");
    await postBoard({ questId: "q-9", waitForInput: ["5"] });

    const res = await postBoard({ questId: "q-9", status: "WORKING", clearWaitForInput: true });

    expect(res.status).toBe(200);
    const row = session.board.get("q-9")!;
    expect(row).toMatchObject({ status: "WORKING", journey: { activePhaseIndex: 2, currentPhaseId: "work" } });
    expect(row.waitForInput).toBeUndefined();
    expect(row.openQuestions).toBeUndefined();
  });

  it("refuses a generic advance after Takode returned the quest to Work", async () => {
    session.board.set("q-9", {
      ...workingRow(["work", "user-checkpoint", "work", "user-checkpoint", "work", "memory"], 2),
      autoCheckpoint: { checkpointIndex: 1, resumedAt: 5 },
    });

    const res = await postAdvance("q-9");

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("already returned it to Work") });
    expect(session.board.get("q-9")?.journey?.activePhaseIndex).toBe(2);
  });

  it("enters a planned User Checkpoint by hand with its own timing", async () => {
    session.board.set("q-9", workingRow(["work", "user-checkpoint", "work", "memory"]));

    const res = await postBoard({ questId: "q-9", status: "USER_CHECKPOINTING" });

    expect(res.status).toBe(200);
    const row = session.board.get("q-9")!;
    expect(row.status).toBe("USER_CHECKPOINTING");
    expect(row.journey).toMatchObject({ activePhaseIndex: 1, currentPhaseId: "user-checkpoint" });
    expect(row.journey?.phaseTimings?.["1"]?.startedAt).toBeDefined();

    // Planned checkpoints keep leader-driven resumption into the later Work.
    const advanced = await postAdvance("q-9");
    expect(advanced.status).toBe(200);
    expect(session.board.get("q-9")).toMatchObject({
      status: "WORKING",
      journey: { activePhaseIndex: 2, currentPhaseId: "work" },
    });
  });
});
