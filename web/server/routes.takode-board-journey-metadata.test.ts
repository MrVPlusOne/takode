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

function createSession(id = "orch-1"): TestSession {
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
    } as any,
    authenticateTakodeCaller: vi.fn(() => ({
      callerId: "orch-1",
      caller: { sessionId: "orch-1" },
    })) as any,
    resolveId: vi.fn((raw: string) => raw),
    boardWatchdogDeps: {
      getLauncherSessionInfo: vi.fn((sessionId: string) => ({
        isOrchestrator: sessionId === "orch-1",
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
  return app.request("/sessions/orch-1/board", {
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

  it("stores lightweight planned phases and cached quest TLDR metadata on board rows", async () => {
    vi.mocked(questStore.getQuest).mockResolvedValueOnce({
      id: "q-9",
      title: "Improve Journey Started chip",
      status: "refined",
      tldr: "Make Journey Started chips easier to scan.",
    } as any);

    const res = await postBoard({
      questId: "q-9",
      status: "PLANNING",
      phases: ["planning", "implement", "port"],
      presetId: "lightweight",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      board: [
        {
          questId: "q-9",
          title: "Improve Journey Started chip",
          questTldr: "Make Journey Started chips easier to scan.",
          status: "PLANNING",
          journey: {
            presetId: "lightweight",
            phaseIds: ["alignment", "implement", "port"],
            currentPhaseId: "alignment",
            nextLeaderAction: expect.stringContaining("alignment leader brief"),
          },
        },
      ],
    });
  });

  it("initializes a phase-planned active board row to the first planned phase when status is omitted", async () => {
    const res = await postBoard({
      questId: "q-9",
      worker: "worker-1",
      workerNum: 11,
      phases: ["planning", "implement", "code-review"],
      presetId: "lightweight-code",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      board: [
        {
          questId: "q-9",
          worker: "worker-1",
          workerNum: 11,
          status: "PLANNING",
          journey: {
            presetId: "lightweight-code",
            phaseIds: ["alignment", "implement", "code-review"],
            currentPhaseId: "alignment",
          },
        },
      ],
    });
  });

  it("stores per-phase Journey notes keyed by phase occurrence", async () => {
    session.board = new Map([
      [
        "q-9",
        {
          questId: "q-9",
          title: "Implement board lifecycle",
          status: "PROPOSED",
          createdAt: 1,
          updatedAt: 1,
          journey: {
            presetId: "rework-loop",
            mode: "proposed",
            phaseIds: ["alignment", "implement", "code-review", "implement", "code-review", "port"],
          },
        },
      ],
    ]);

    const res = await postBoard({
      questId: "q-9",
      phaseNoteEdits: [
        { index: 2, note: "focus on stream migration behavior" },
        { index: 4, note: "inspect only the follow-up diff" },
      ],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      board: [
        {
          questId: "q-9",
          journey: {
            phaseNotes: {
              "2": "focus on stream migration behavior",
              "4": "inspect only the follow-up diff",
            },
          },
        },
      ],
    });
  });

  it("rebases phase notes by phase occurrence when revising a Journey", async () => {
    session.board = new Map([
      [
        "q-9",
        {
          questId: "q-9",
          title: "Implement board lifecycle",
          status: "PROPOSED",
          createdAt: 1,
          updatedAt: 1,
          journey: {
            presetId: "rework-loop",
            mode: "proposed",
            phaseIds: ["alignment", "implement", "code-review", "implement", "mental-simulation", "port"],
            phaseNotes: {
              "4": "Replay turns 116/120/121/122-123 before dispatching this phase",
            },
          },
        },
      ],
    ]);

    const res = await postBoard({
      questId: "q-9",
      phases: ["alignment", "implement", "code-review", "implement", "code-review", "mental-simulation", "port"],
      presetId: "rework-loop",
      revisionReason: "Add a second review pass before simulation",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      board: [
        {
          questId: "q-9",
          status: "PROPOSED",
          journey: {
            phaseIds: [
              "alignment",
              "implement",
              "code-review",
              "implement",
              "code-review",
              "mental-simulation",
              "port",
            ],
            phaseNotes: {
              "5": "Replay turns 116/120/121/122-123 before dispatching this phase",
            },
          },
        },
      ],
    });
  });

  it("clears omitted and empty spec notes before presenting a revised proposed Journey", async () => {
    session.board = new Map([
      [
        "q-9",
        {
          questId: "q-9",
          title: "Implement board lifecycle",
          status: "PROPOSED",
          createdAt: 1,
          updatedAt: 1,
          journey: {
            presetId: "proposal-flow",
            mode: "proposed",
            phaseIds: ["alignment", "implement", "code-review", "port"],
            phaseNotes: {
              "0": "Old verbose alignment note",
              "1": "Old verbose implementation note",
              "2": "Old verbose review note",
              "3": "Old verbose port note",
            },
          },
        },
      ],
    ]);

    const reviseRes = await postBoard({
      questId: "q-9",
      phases: ["alignment", "implement", "code-review", "port"],
      presetId: "proposal-flow",
      revisionReason: "Replace noisy draft notes with concise approval notes",
      // This is the server payload emitted by takode board propose --spec-file:
      // every phase occurrence is authoritative, and null/empty notes clear old text.
      phaseNoteEdits: [
        { index: 0, note: "Confirm the approval surface and scope." },
        { index: 1, note: "" },
        { index: 2, note: null },
        { index: 3, note: null },
      ],
    });

    expect(reviseRes.status).toBe(200);
    const reviseBody = await reviseRes.json();
    expect(reviseBody).toMatchObject({
      board: [
        {
          questId: "q-9",
          status: "PROPOSED",
          journey: {
            phaseNotes: {
              "0": "Confirm the approval surface and scope.",
            },
          },
        },
      ],
    });
    expect(reviseBody.board[0].journey.phaseNotes).toEqual({
      "0": "Confirm the approval surface and scope.",
    });

    const presentRes = await postBoard({
      questId: "q-9",
      presentProposal: true,
    });

    expect(presentRes.status).toBe(200);
    const presentBody = await presentRes.json();
    expect(presentBody).toMatchObject({
      proposalReview: {
        questId: "q-9",
        journey: {
          phaseNotes: {
            "0": "Confirm the approval surface and scope.",
          },
        },
      },
    });
    expect(presentBody.proposalReview.journey.phaseNotes).toEqual({
      "0": "Confirm the approval surface and scope.",
    });
  });

  it("returns explicit warnings when a Journey revision drops unmappable phase notes", async () => {
    session.board = new Map([
      [
        "q-9",
        {
          questId: "q-9",
          title: "Implement board lifecycle",
          status: "PROPOSED",
          createdAt: 1,
          updatedAt: 1,
          journey: {
            presetId: "rework-loop",
            mode: "proposed",
            phaseIds: ["alignment", "implement", "code-review", "implement", "mental-simulation", "port"],
            phaseNotes: {
              "4": "Replay turns 116/120/121/122-123 before dispatching this phase",
            },
          },
        },
      ],
    ]);

    const res = await postBoard({
      questId: "q-9",
      phases: ["alignment", "implement", "code-review", "implement", "port"],
      presetId: "rework-loop",
      revisionReason: "Simulation is no longer needed after the narrowed fix",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      board: [
        {
          questId: "q-9",
          status: "PROPOSED",
          journey: {
            phaseIds: ["alignment", "implement", "code-review", "implement", "port"],
          },
        },
      ],
      phaseNoteRebaseWarnings: [
        {
          previousIndex: 4,
          previousPhaseId: "mental-simulation",
          previousOccurrence: 1,
          note: "Replay turns 116/120/121/122-123 before dispatching this phase",
        },
      ],
    });
  });
});
