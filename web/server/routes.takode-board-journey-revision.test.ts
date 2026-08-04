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

async function postRevise(questId: string, body: Record<string, unknown>): Promise<Response> {
  return app.request(`/sessions/leader-1/board/${questId}/revise`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("Takode board Journey v2 revision route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(questStore, "getQuest").mockResolvedValue(null);
    setupTakodeSessions();
  });

  it("rejects legacy v1 phase IDs in new active and proposed rows", async () => {
    const active = await postBoard({
      questId: "q-9",
      phases: ["alignment", "implement", "code-review"],
    });
    expect(active.status).toBe(400);
    expect(await active.json()).toMatchObject({
      error: expect.stringContaining("legacy v1 phase IDs are historical-read only"),
    });

    const proposed = await postBoard({
      questId: "q-9",
      status: "PROPOSED",
      journeyMode: "proposed",
      phases: ["alignment", "implement", "code-review"],
      presentation: { summary: "Approve the proposed Journey." },
    });
    expect(proposed.status).toBe(400);
    expect(await proposed.json()).toMatchObject({
      error: expect.stringContaining("legacy v1 phase IDs are historical-read only"),
    });
  });

  it("preserves completed v2 prefix and records revision metadata", async () => {
    session.board.set("q-9", {
      questId: "q-9",
      status: "WORKING",
      createdAt: 1,
      updatedAt: 2,
      journey: {
        mode: "active",
        presetId: "v2-work",
        phaseIds: ["alignment", "work", "memory"],
        activePhaseIndex: 1,
        currentPhaseId: "work",
        phaseNotes: { "1": "Current Work note." },
      },
    });

    const res = await postRevise("q-9", {
      fromIndex: 2,
      expectedPhaseId: "memory",
      phases: ["user-checkpoint", "work", "memory"],
      revisionReason: "Work found a required user decision before durable closure.",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      board: [
        {
          questId: "q-9",
          status: "WORKING",
          journey: {
            phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
            activePhaseIndex: 1,
            currentPhaseId: "work",
            revisionReason: "Work found a required user decision before durable closure.",
            revisionCount: 1,
          },
        },
      ],
    });
  });

  it("keeps proposed v2 rows revisable before promotion", async () => {
    session.board.set("q-9", {
      questId: "q-9",
      status: "PROPOSED",
      waitForInput: ["n-3"],
      createdAt: 1,
      updatedAt: 2,
      journey: {
        mode: "proposed",
        presetId: "v2-work",
        phaseIds: ["alignment", "work", "memory"],
        presentation: { state: "presented", summary: "Approve the draft.", presentedAt: 1, signature: "old" },
      },
    });

    const res = await postRevise("q-9", {
      fromIndex: 0,
      expectedPhaseId: "alignment",
      status: "PROPOSED",
      journeyMode: "proposed",
      phases: ["alignment", "work", "user-checkpoint", "memory"],
      phaseNoteEdits: [{ index: 2, note: "Ask before publishing the external artifact." }],
      presentation: { summary: "Approve the updated draft." },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      board: [
        {
          questId: "q-9",
          status: "PROPOSED",
          journey: {
            mode: "proposed",
            phaseIds: ["alignment", "work", "user-checkpoint", "memory"],
            phaseNotes: { "2": "Ask before publishing the external artifact." },
            presentation: { state: "draft" },
          },
        },
      ],
    });
  });

  it("rejects optional User Checkpoints without concrete skip conditions", async () => {
    const res = await postBoard({
      questId: "q-9",
      phases: ["alignment", "work", "user-checkpoint", "memory"],
      phaseNoteEdits: [{ index: 2, note: "Optional checkpoint." }],
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("Optional User Checkpoints require"),
    });
  });

  it("rejects attempts to mutate completed v2 phase occurrences", async () => {
    session.board.set("q-9", {
      questId: "q-9",
      status: "WORKING",
      createdAt: 1,
      updatedAt: 2,
      journey: {
        mode: "active",
        phaseIds: ["alignment", "work", "memory"],
        activePhaseIndex: 1,
        currentPhaseId: "work",
      },
    });

    const res = await postRevise("q-9", {
      fromIndex: 1,
      expectedPhaseId: "work",
      phases: ["user-checkpoint", "work", "memory"],
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("must start after the current phase"),
    });
  });

  it("requires activePhaseIndex when repeated Work occurrence is ambiguous", async () => {
    session.board.set("q-9", {
      questId: "q-9",
      status: "WORKING",
      createdAt: 1,
      updatedAt: 2,
      journey: {
        mode: "active",
        phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
        currentPhaseId: "work",
      },
    });

    const res = await postRevise("q-9", {
      fromIndex: 2,
      expectedPhaseId: "user-checkpoint",
      phases: ["alignment", "work", "user-checkpoint", "work", "memory"],
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("completed phase boundary cannot be inferred"),
    });
  });
});
