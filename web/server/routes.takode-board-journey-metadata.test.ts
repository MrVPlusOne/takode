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
let authCallerId = "leader-1";
let authCaller: Record<string, unknown> = { sessionId: "leader-1", isOrchestrator: true };

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
  const wsBridge = {
    getSession: vi.fn((sessionId: string) => sessions.get(sessionId) ?? null),
    completeDoneBoardRowsForQuest: vi.fn(() => []),
    findAssignedBoardRowsForWorker: vi.fn((workerSessionId: string, questId: string) =>
      [...sessions.values()].flatMap((leader) => {
        const row = [...leader.board.values()].find(
          (candidate) => candidate.questId === questId && candidate.worker === workerSessionId,
        );
        return row ? [{ leaderSessionId: leader.id, row }] : [];
      }),
    ),
  };
  registerTakodeBoardRoutes(api, {
    launcher: {} as any,
    wsBridge: wsBridge as any,
    authenticateTakodeCaller: vi.fn(() => ({
      callerId: authCallerId,
      caller: authCaller,
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
  authCallerId = "leader-1";
  authCaller = { sessionId: "leader-1", isOrchestrator: true };
  app = createRouteApp();
}

async function postBoard(body: Record<string, unknown>): Promise<Response> {
  return app.request("/sessions/leader-1/board", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function postWorkerMemory(body: Record<string, unknown>): Promise<Response> {
  return app.request("/takode/board/work-to-memory", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("Takode board Journey metadata route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(questStore, "getQuest").mockResolvedValue(null);
    setupTakodeSessions();
  });

  it("stores the active v2 phase plan and cached quest TLDR metadata on board rows", async () => {
    vi.mocked(questStore.getQuest).mockResolvedValueOnce({
      id: "q-9",
      questId: "q-9",
      title: "Improve Journey chip",
      status: "refined",
      tldr: "Make Journey chips easier to scan.",
    } as any);

    const res = await postBoard({
      questId: "q-9",
      status: "PLANNING",
      phases: ["alignment", "work", "memory"],
      presetId: "v2-work",
    });

    expect(res.status).toBe(200);
    const stored = session.board.get("q-9")!;
    expect(stored.title).toBe("Improve Journey chip");
    expect(stored.questTldr).toBe("Make Journey chips easier to scan.");
    expect(stored.journey).toMatchObject({
      presetId: "v2-work",
      phaseIds: ["alignment", "work", "memory"],
      activePhaseIndex: 0,
      currentPhaseId: "alignment",
    });
  });

  it("rejects legacy v1 phases and states for new active rows", async () => {
    const legacyPhase = await postBoard({
      questId: "q-9",
      phases: ["alignment", "implement", "memory"],
    });
    expect(legacyPhase.status).toBe(400);
    expect(await legacyPhase.json()).toMatchObject({
      error: expect.stringContaining("legacy v1 phase IDs are historical-read only"),
    });

    const legacyStatus = await postBoard({
      questId: "q-9",
      status: "IMPLEMENTING",
      phases: ["alignment", "work", "memory"],
    });
    expect(legacyStatus.status).toBe(400);
    expect(await legacyStatus.json()).toMatchObject({
      error: expect.stringContaining("Invalid active Quest Journey state"),
    });
  });

  it("links and clears active User Checkpoint waits without changing the Work occurrence", async () => {
    session.notifications.push({ id: "n-4", category: "needs-input", done: false });
    await postBoard({
      questId: "q-9",
      worker: "worker-1",
      status: "WORKING",
      phases: ["alignment", "work", "memory"],
      activePhaseIndex: 1,
    });

    const pause = await postBoard({
      questId: "q-9",
      status: "USER_CHECKPOINTING",
      activePhaseIndex: 1,
      waitForInput: ["n-4"],
    });
    expect(pause.status).toBe(200);
    expect(session.board.get("q-9")?.journey?.currentPhaseId).toBe("work");
    expect(session.board.get("q-9")?.waitForInput).toEqual(["n-4"]);

    const resume = await postBoard({
      questId: "q-9",
      status: "WORKING",
      activePhaseIndex: 1,
      clearWaitForInput: true,
    });
    expect(resume.status).toBe(200);
    expect(session.board.get("q-9")?.journey?.currentPhaseId).toBe("work");
    expect(session.board.get("q-9")?.waitForInput).toBeUndefined();
  });

  it("allows the authenticated assigned and claimed worker to move Work to Memory", async () => {
    session.board.set("q-9", {
      questId: "q-9",
      title: "Quest",
      worker: "worker-1",
      workerNum: 5,
      status: "WORKING",
      journey: {
        phaseIds: ["alignment", "work", "memory"],
        activePhaseIndex: 1,
        currentPhaseId: "work",
      },
      createdAt: 1,
      updatedAt: 2,
    });
    authCallerId = "worker-1";
    authCaller = { sessionId: "worker-1", isOrchestrator: false };
    vi.mocked(questStore.getQuest).mockResolvedValueOnce({
      id: "q-9",
      questId: "q-9",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      feedback: [
        {
          author: "agent",
          authorSessionId: "worker-1",
          kind: "phase_summary",
          phaseId: "work",
          text: "Work note with enough detail to count as current and useful for final Memory handoff.",
          ts: 10,
        },
      ],
    } as any);

    const res = await postWorkerMemory({ questId: "q-9", workFeedbackIndex: 0 });

    expect(res.status).toBe(200);
    expect(session.board.get("q-9")?.status).toBe("MEMORY");
    expect(session.board.get("q-9")?.journey).toMatchObject({
      activePhaseIndex: 2,
      currentPhaseId: "memory",
    });
    expect(await res.json()).toMatchObject({
      ok: true,
      questId: "q-9",
      previousState: "WORKING",
      newState: "MEMORY",
      workFeedbackIndex: 0,
    });
  });

  it("rejects Work to Memory when checkpoint wait or Work note proof is missing", async () => {
    session.board.set("q-9", {
      questId: "q-9",
      worker: "worker-1",
      status: "WORKING",
      waitForInput: ["n-2"],
      journey: { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 1, currentPhaseId: "work" },
      createdAt: 1,
      updatedAt: 2,
    });
    authCallerId = "worker-1";
    authCaller = { sessionId: "worker-1", isOrchestrator: false };
    vi.mocked(questStore.getQuest).mockResolvedValue({
      id: "q-9",
      questId: "q-9",
      status: "in_progress",
      sessionId: "worker-1",
      feedback: [],
    } as any);

    const checkpoint = await postWorkerMemory({ questId: "q-9" });
    expect(checkpoint.status).toBe(409);
    expect(await checkpoint.json()).toMatchObject({ error: expect.stringContaining("User Checkpoint") });

    session.board.get("q-9")!.waitForInput = undefined;
    const missingNote = await postWorkerMemory({ questId: "q-9" });
    expect(missingNote.status).toBe(409);
    expect(await missingNote.json()).toMatchObject({ error: expect.stringContaining("Work phase note") });
  });
});
