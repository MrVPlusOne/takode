import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerTakodeBoardRoutes } from "./routes/takode-board.js";
import type { BoardRow } from "./session-types.js";
import type { QuestmasterTask } from "./quest-types.js";
import * as questStore from "./quest-store.js";

/**
 * Another leader's quest on a leader's board (Jiayi, Nov 3): a leader that guessed quest IDs
 * boarded three of another leader's quests, and after `board rm` they stayed in its thread lists
 * and its Next walk, because removing a row records it as finished there (board history, an unread
 * "quest complete", an open thread tab). `board set` now refuses such a quest unless told to take
 * it over, and `board rm` of one leaves no trace on this leader.
 */

interface TestSession {
  id: string;
  state: Record<string, any>;
  board: Map<string, BoardRow>;
  completedBoard: Map<string, BoardRow>;
  notifications: Array<Record<string, any>>;
  boardDispatchStates: Map<string, Record<string, unknown>>;
  boardStallStates: Map<string, Record<string, unknown>>;
  attentionRecords: Array<Record<string, unknown>>;
}

function createSession(id: string): TestSession {
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

const LEADERS: Record<string, { sessionId: string; sessionNum: number; name: string; isOrchestrator: boolean }> = {
  "leader-1": { sessionId: "leader-1", sessionNum: 2851, name: "DevBox takode", isOrchestrator: true },
  "leader-2": { sessionId: "leader-2", sessionNum: 2957, name: "Daily Leader", isOrchestrator: true },
};

let sessions: Map<string, TestSession>;
let quests: Map<string, Partial<QuestmasterTask>>;
let markNotificationDone: ReturnType<typeof vi.fn>;
let app: Hono;

beforeEach(() => {
  sessions = new Map([
    ["leader-1", createSession("leader-1")],
    ["leader-2", createSession("leader-2")],
  ]);
  quests = new Map([
    ["q-25", { questId: "q-25", title: "77B failure modes", status: "in_progress", leaderSessionId: "leader-2" }],
    ["q-31", { questId: "q-31", title: "Board guard", status: "in_progress", leaderSessionId: "leader-1" }],
  ]);
  vi.spyOn(questStore, "getQuest").mockImplementation(
    async (questId: string) => (quests.get(questId) as QuestmasterTask | undefined) ?? null,
  );
  markNotificationDone = vi.fn((sessionId: string, notificationId: string) => {
    const notification = sessions.get(sessionId)?.notifications.find((entry) => entry.id === notificationId);
    if (notification) notification.done = true;
    return true;
  });
  app = new Hono();
  registerTakodeBoardRoutes(app, {
    launcher: { getSession: (id: string) => LEADERS[id] } as any,
    wsBridge: {
      getSession: (id: string) => sessions.get(id) ?? null,
      completeDoneBoardRowsForQuest: vi.fn(() => []),
      findAssignedBoardRowsForWorker: vi.fn(() => []),
    } as any,
    authenticateTakodeCaller: vi.fn(() => ({ callerId: "leader-1", caller: { isOrchestrator: true } })) as any,
    resolveId: (raw: string) => raw,
    boardWatchdogDeps: {
      getLauncherSessionInfo: vi.fn(() => ({ isOrchestrator: true, lastActivityAt: 0 })),
      getSession: vi.fn((id: string) => sessions.get(id)),
      listSessions: vi.fn(() => []),
      resolveSessionId: vi.fn((ref: string) => (sessions.has(ref) ? ref : undefined)),
      timerCount: vi.fn(() => 0),
      backendConnected: vi.fn(() => true),
      getBoard: vi.fn((id: string) => [...(sessions.get(id)?.board.values() ?? [])]),
      emitTakodeEvent: vi.fn(),
      markNotificationDone: vi.fn(() => true),
      isSessionIdle: vi.fn(() => true),
    },
    workBoardStateDeps: {
      getBoardDispatchableSignature: vi.fn(() => null),
      markNotificationDone,
      broadcastBoard: vi.fn(),
      broadcastAttentionRecords: vi.fn(),
      persistSession: vi.fn(),
    },
    buildBoardRowSessionStatuses: vi.fn(async () => ({})),
    resolveSessionDeps: vi.fn(() => []),
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const setRow = (body: Record<string, unknown>) =>
  app.request("/sessions/leader-1/board", { method: "POST", body: JSON.stringify(body) });

describe("boarding another leader's quest", () => {
  it("refuses it, naming the leader that runs it", async () => {
    const response = await setRow({ questId: "q-25", status: "QUEUED", waitFor: ["free-worker"] });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("q-25 is #2957 Daily Leader's quest");
    expect(body.error).toContain("--take-over");
    expect(sessions.get("leader-1")!.board.size).toBe(0);
  });

  it("boards it when told to take it over, and boards this leader's own quests as before", async () => {
    const taken = await setRow({ questId: "q-25", status: "QUEUED", waitFor: ["free-worker"], takeOver: true });
    expect(taken.status, await taken.clone().text()).toBe(200);
    expect(sessions.get("leader-1")!.board.has("q-25")).toBe(true);
    expect((await setRow({ questId: "q-31", status: "QUEUED", waitFor: ["free-worker"] })).status).toBe(200);
    // A row already here is updated without asking again.
    expect(
      (await setRow({ questId: "q-25", status: "QUEUED", waitFor: ["free-worker"], title: "Renamed" })).status,
    ).toBe(200);
  });

  it("refuses a quest another leader's message started, before any leader boarded it", async () => {
    quests.set("q-40", {
      questId: "q-40",
      title: "Filed by the other leader",
      status: "refined",
      relationships: { startedFrom: { sessionId: "leader-2", messageId: "m", threadKey: "main", timestamp: 1 } },
    });
    expect((await setRow({ questId: "q-40", status: "QUEUED", waitFor: ["free-worker"] })).status).toBe(409);
  });
});

describe("board rm of another leader's quest", () => {
  it("leaves no trace: no board history, no unread result, no thread tab; the other leader is untouched", async () => {
    await setRow({ questId: "q-25", status: "QUEUED", waitFor: ["free-worker"], takeOver: true });
    const leader = sessions.get("leader-1")!;
    leader.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: ["q-25", "q-31"],
      closedThreadTombstones: [],
      updatedAt: 1,
    };
    leader.notifications.push({ id: "n-1", category: "review", threadKey: "q-25", done: false, timestamp: 1 });
    sessions.get("leader-2")!.board.set("q-25", { questId: "q-25", status: "WORKING", createdAt: 1, updatedAt: 1 });

    const response = await app.request("/sessions/leader-1/board/q-25", { method: "DELETE" });
    expect(response.status).toBe(200);
    expect((await response.json()).droppedOtherLeadersQuests).toEqual(["q-25"]);
    expect(leader.board.has("q-25")).toBe(false);
    expect(leader.completedBoard.has("q-25")).toBe(false);
    expect(leader.notifications.find((entry) => entry.id === "n-1")!.done).toBe(true);
    expect(leader.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toEqual(["q-31"]);
    expect(sessions.get("leader-2")!.board.has("q-25")).toBe(true);
  });

  it("clears a row an earlier rm already moved to board history", async () => {
    // How the stray threads of Nov 3 were left: the rows sat in board history as finished.
    const leader = sessions.get("leader-1")!;
    leader.completedBoard.set("q-25", { questId: "q-25", status: "WORKING", createdAt: 1, updatedAt: 1 });
    await app.request("/sessions/leader-1/board/q-25", { method: "DELETE" });
    expect(leader.completedBoard.has("q-25")).toBe(false);
  });

  it("finishes this leader's own quest as before, into its board history", async () => {
    await setRow({ questId: "q-31", status: "QUEUED", waitFor: ["free-worker"] });
    const response = await app.request("/sessions/leader-1/board/q-31", { method: "DELETE" });
    expect(response.status).toBe(200);
    expect((await response.json()).droppedOtherLeadersQuests).toBeUndefined();
    expect(sessions.get("leader-1")!.completedBoard.has("q-31")).toBe(true);
  });
});
