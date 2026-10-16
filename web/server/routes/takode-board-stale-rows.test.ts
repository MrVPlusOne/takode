import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerStaleBoardRowRoutes } from "./takode-board-stale-rows.js";
import type { BoardRow } from "../session-types.js";

// Exercises the real route and board mutation on in-memory leader sessions:
// a leader clears a row left behind on another, stopped leader's board.

function makeLeader(id: string, rows: BoardRow[] = []) {
  return {
    id,
    state: { pause: null as null | { pausedAt: number; queuedMessages: unknown[] } },
    board: new Map(rows.map((row) => [row.questId, row])),
    completedBoard: new Map<string, BoardRow>(),
    boardDispatchStates: new Map(),
    boardStallStates: new Map(),
    attentionRecords: [] as unknown[],
    notifications: [] as unknown[],
  };
}

function staleRow(overrides: Partial<BoardRow> = {}): BoardRow {
  return {
    questId: "q-7",
    title: "Quest seven",
    worker: "worker-old",
    status: "USER_CHECKPOINTING",
    journey: { phaseIds: ["work", "user-checkpoint", "work", "memory"], activePhaseIndex: 1 },
    waitForInput: ["n-4"],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  } as BoardRow;
}

let sessions: Map<string, ReturnType<typeof makeLeader>>;
let launcherInfo: Map<string, { sessionId: string; sessionNum: number; isOrchestrator: boolean; archived?: boolean }>;
let caller: { callerId: string; caller: { isOrchestrator: boolean } };
let markNotificationDone: ReturnType<typeof vi.fn>;
let recordQuestCompletionUnread: ReturnType<typeof vi.fn>;
let workEvidenceLocked = false;
let app: Hono;

beforeEach(() => {
  sessions = new Map([
    ["live-leader", makeLeader("live-leader")],
    ["stale-leader", makeLeader("stale-leader", [staleRow(), staleRow({ questId: "q-8", waitFor: ["q-7"] })])],
  ]);
  launcherInfo = new Map([
    ["live-leader", { sessionId: "live-leader", sessionNum: 10, isOrchestrator: true }],
    ["stale-leader", { sessionId: "stale-leader", sessionNum: 20, isOrchestrator: true }],
  ]);
  sessions.get("stale-leader")!.state.pause = { pausedAt: 5, queuedMessages: [{}, {}] };
  caller = { callerId: "live-leader", caller: { isOrchestrator: true } };
  markNotificationDone = vi.fn(() => true);
  recordQuestCompletionUnread = vi.fn();
  workEvidenceLocked = false;
  app = new Hono();
  registerStaleBoardRowRoutes(app, {
    launcher: { getSession: (id: string) => launcherInfo.get(id) } as any,
    wsBridge: { getSession: (id: string) => sessions.get(id) ?? null } as any,
    authenticateTakodeCaller: (() => caller) as any,
    resolveId: (raw: string) => (raw === "20" ? "stale-leader" : sessions.has(raw) ? raw : null),
    workBoardStateDeps: {
      getBoardDispatchableSignature: () => null,
      markNotificationDone,
      broadcastBoard: vi.fn(),
      persistSession: vi.fn(),
      recordQuestCompletionUnread,
    },
    isWorkEvidenceMutationLocked: () => workEvidenceLocked,
  });
});

function removeStale(leaderRef: string, body: Record<string, unknown> = { reason: "Obsolete checkpoint" }) {
  return app.request(`/sessions/${leaderRef}/board/q-7/remove-stale`, { method: "POST", body: JSON.stringify(body) });
}

describe("POST /sessions/:id/board/:questId/remove-stale", () => {
  it("moves a paused leader's stale row to its board history with the reason, leaving its pause intact", async () => {
    const res = await removeStale("20");

    expect(res.status, await res.clone().text()).toBe(200);
    const stale = sessions.get("stale-leader")!;
    expect(stale.board.has("q-7")).toBe(false);
    expect(stale.completedBoard.get("q-7")).toMatchObject({
      staleRemoval: { reason: "Obsolete checkpoint", removedBy: "live-leader" },
      completedAt: expect.any(Number),
    });
    expect(await res.json()).toMatchObject({ leaderSessionNum: 20, removed: { questId: "q-7" } });
    // The obsolete checkpoint's prompt is resolved; the paused leader keeps its held input.
    expect(markNotificationDone).toHaveBeenCalledWith("stale-leader", "n-4", true);
    expect(stale.state.pause).toMatchObject({ pausedAt: 5, queuedMessages: [{}, {}] });
    // The quest did not finish there: no completion unread, and other rows still wait for it.
    expect(recordQuestCompletionUnread).not.toHaveBeenCalled();
    expect(stale.board.get("q-8")?.waitFor).toEqual(["q-7"]);
  });

  it("also clears rows on an archived leader", async () => {
    sessions.get("stale-leader")!.state.pause = null;
    launcherInfo.get("stale-leader")!.archived = true;

    const res = await removeStale("stale-leader");

    expect(res.status, await res.clone().text()).toBe(200);
    expect(sessions.get("stale-leader")!.board.has("q-7")).toBe(false);
  });

  it("refuses a running leader's board, which only that leader may change", async () => {
    sessions.get("stale-leader")!.state.pause = null;

    const res = await removeStale("stale-leader");

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("#20 is running") });
    expect(sessions.get("stale-leader")!.board.has("q-7")).toBe(true);
  });

  it.each([
    ["a missing reason", { callerId: "live-leader", isOrchestrator: true }, {}, 400],
    ["a non-leader caller", { callerId: "worker-1", isOrchestrator: false }, undefined, 403],
    ["the caller's own board", { callerId: "stale-leader", isOrchestrator: true }, undefined, 400],
  ])("refuses %s", async (_label, who, body, status) => {
    caller = { callerId: who.callerId, caller: { isOrchestrator: who.isOrchestrator } };

    const res = await removeStale("stale-leader", body);

    expect(res.status).toBe(status);
    expect(sessions.get("stale-leader")!.board.has("q-7")).toBe(true);
  });

  it("refuses a row still waiting for its submitted landing change, which removal would lose", async () => {
    sessions.get("stale-leader")!.board.set("q-7", staleRow({ landing: { entryId: "land-1" } as any }));

    const res = await removeStale("stale-leader");

    expect(res.status).toBe(409);
    expect(sessions.get("stale-leader")!.board.has("q-7")).toBe(true);
  });

  it("reports a missing row and an in-progress Work evidence change", async () => {
    sessions.get("stale-leader")!.board.delete("q-7");
    expect((await removeStale("stale-leader")).status).toBe(404);

    sessions.get("stale-leader")!.board.set("q-7", staleRow());
    workEvidenceLocked = true;
    expect((await removeStale("stale-leader")).status).toBe(409);
  });
});
