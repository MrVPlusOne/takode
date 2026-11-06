import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerTakodeBoardRoutes } from "./routes/takode-board.js";
import { runPendingThreadHandoff } from "./routes/takode-thread-handoff.js";
import type { BoardRow } from "./session-types.js";
import * as questStore from "./quest-store.js";

// Spy on the filing-time handoff so the tests can prove a refused row hands nothing off.
vi.mock("./routes/takode-thread-handoff.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routes/takode-thread-handoff.js")>();
  return { ...actual, runPendingThreadHandoff: vi.fn(() => undefined) };
});

/**
 * `board set`, `board promote` and `board propose` all write through POST /sessions/:id/board.
 * A worker the row names must be a live session in the leader's herd, and a `#N` wait-for must
 * name a session that exists and is not archived; a refused request writes nothing.
 */

interface LauncherSession {
  sessionId: string;
  sessionNum: number;
  archived?: boolean;
  herdedBy?: string;
}

let app: Hono;
let leader: {
  id: string;
  state: Record<string, unknown>;
  board: Map<string, BoardRow>;
  completedBoard: Map<string, BoardRow>;
  notifications: unknown[];
  boardDispatchStates: Map<string, unknown>;
  boardStallStates: Map<string, unknown>;
  attentionRecords: unknown[];
};
let launcherSessions: LauncherSession[];

function createRouteApp(): Hono {
  const api = new Hono();
  const findSession = (ref: string) =>
    launcherSessions.find((s) => s.sessionId === ref || String(s.sessionNum) === ref.replace(/^#/, ""));
  const wsBridge = {
    getSession: vi.fn((id: string) => (id === leader.id ? leader : null)),
    broadcastGlobal: vi.fn(),
    completeDoneBoardRowsForQuest: vi.fn(() => []),
    findAssignedBoardRowsForWorker: vi.fn(() => []),
  };
  registerTakodeBoardRoutes(api, {
    launcher: {
      resolveSessionId: vi.fn((ref: string) => findSession(ref)?.sessionId ?? null),
      getSession: vi.fn((id: string) => launcherSessions.find((s) => s.sessionId === id)),
    } as any,
    wsBridge: wsBridge as any,
    authenticateTakodeCaller: vi.fn(() => ({
      callerId: "leader-1",
      caller: { sessionId: "leader-1", isOrchestrator: true },
    })) as any,
    resolveId: vi.fn((raw: string) => raw),
    boardWatchdogDeps: {
      getLauncherSessionInfo: vi.fn(() => ({ isOrchestrator: true, lastActivityAt: 0 })),
      getSession: vi.fn((id: string) => (id === leader.id ? leader : undefined)),
      listSessions: vi.fn(() => []),
      resolveSessionId: vi.fn(() => undefined),
      timerCount: vi.fn(() => 0),
      backendConnected: vi.fn(() => true),
      getBoard: vi.fn(() => [...leader.board.values()]),
      emitTakodeEvent: vi.fn(),
      markNotificationDone: vi.fn(() => true),
      isSessionIdle: vi.fn(() => true),
    } as any,
    workBoardStateDeps: {
      getBoardDispatchableSignature: vi.fn(() => null),
      markNotificationDone: vi.fn(() => true),
      broadcastBoard: vi.fn(),
      broadcastAttentionRecords: vi.fn(),
      persistSession: vi.fn(),
    } as any,
    buildBoardRowSessionStatuses: vi.fn(async () => ({})),
    resolveSessionDeps: vi.fn(() => []),
  });
  return api;
}

async function postBoard(body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const res = await app.request("/sessions/leader-1/board", { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

describe("board rows refuse unusable sessions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(runPendingThreadHandoff).mockClear();
    vi.spyOn(questStore, "getQuest").mockResolvedValue(null);
    leader = {
      id: "leader-1",
      state: {},
      board: new Map(),
      completedBoard: new Map(),
      notifications: [],
      boardDispatchStates: new Map(),
      boardStallStates: new Map(),
      attentionRecords: [],
    };
    launcherSessions = [
      { sessionId: "live-worker", sessionNum: 3358, herdedBy: "leader-1" },
      { sessionId: "archived-worker", sessionNum: 3357, herdedBy: "leader-1", archived: true },
      { sessionId: "other-herd-worker", sessionNum: 3359, herdedBy: "leader-2" },
      { sessionId: "helper", sessionNum: 31 },
      { sessionId: "archived-helper", sessionNum: 32, archived: true },
    ];
    app = createRouteApp();
  });

  it("refuses an archived worker without writing the row or handing off, and names the replacement path", async () => {
    // The original slip: a worker picked from memory had been archived the day before.
    const res = await postBoard({ questId: "q-1", worker: "3357", phases: ["work", "memory"] });

    expect(res.status).toBe(409);
    expect(res.json.error).toContain("Worker #3357 is archived");
    expect(res.json.error).toContain("takode spawn --replace-worktree-worker 3357");
    expect(leader.board.has("q-1")).toBe(false);
    expect(runPendingThreadHandoff).not.toHaveBeenCalled();
  });

  it("refuses an archived worker on an existing row and keeps the row as it was", async () => {
    // Promote and set both reassign through this route; a refusal must not touch the existing row.
    await postBoard({ questId: "q-1", worker: "3358", phases: ["work", "memory"] });
    const before = structuredClone(leader.board.get("q-1"));
    expect(before).toMatchObject({ worker: "live-worker", workerNum: 3358 });

    const res = await postBoard({ questId: "q-1", worker: "#3357", status: "WORKING" });

    expect(res.status).toBe(409);
    expect(leader.board.get("q-1")).toEqual(before);
  });

  it("refuses unknown or deleted workers and workers outside the leader's herd", async () => {
    const unknown = await postBoard({ questId: "q-1", worker: "9999", phases: ["work", "memory"] });
    expect(unknown.status).toBe(400);
    expect(unknown.json.error).toContain("Worker 9999 not found");

    const otherHerd = await postBoard({ questId: "q-1", worker: "3359", phases: ["work", "memory"] });
    expect(otherHerd.status).toBe(409);
    expect(otherHerd.json.error).toContain("Worker #3359 is not in your herd");
    expect(otherHerd.json.error).toContain("takode herd 3359");

    expect(leader.board.has("q-1")).toBe(false);
    expect(runPendingThreadHandoff).not.toHaveBeenCalled();
  });

  it("stores a herded live worker by its resolved session ID and number, whatever reference was sent", async () => {
    // The CLI falls back to sending the raw reference when its own lookup fails; the server resolves it.
    const res = await postBoard({ questId: "q-1", worker: "#3358", phases: ["work", "memory"] });

    expect(res.status).toBe(200);
    expect(leader.board.get("q-1")).toMatchObject({ worker: "live-worker", workerNum: 3358 });
    expect(runPendingThreadHandoff).toHaveBeenCalledWith(expect.anything(), "leader-1", "q-1");
  });

  it("still clears a worker with an empty reference", async () => {
    await postBoard({ questId: "q-1", worker: "3358", phases: ["work", "memory"] });

    const res = await postBoard({ questId: "q-1", worker: "" });

    expect(res.status).toBe(200);
    expect(leader.board.get("q-1")?.worker).toBeFalsy();
  });

  it("refuses #N wait-fors on unknown or archived sessions and accepts live ones", async () => {
    const unknown = await postBoard({ questId: "q-1", waitFor: ["#9999"] });
    expect(unknown.status).toBe(400);
    expect(unknown.json.error).toBe("Cannot wait for #9999: no such session (unknown or deleted).");

    const archived = await postBoard({ questId: "q-1", waitFor: ["q-7", "#32"] });
    expect(archived.status).toBe(400);
    expect(archived.json.error).toBe("Cannot wait for #32: the session is archived.");
    expect(leader.board.has("q-1")).toBe(false);

    // Quest and free-worker waits are not session references and pass through untouched.
    const live = await postBoard({ questId: "q-1", waitFor: ["#31", "q-7", "free-worker"] });
    expect(live.status).toBe(200);
    expect(leader.board.get("q-1")).toMatchObject({ status: "QUEUED", waitFor: ["#31", "q-7", "free-worker"] });
  });
});
