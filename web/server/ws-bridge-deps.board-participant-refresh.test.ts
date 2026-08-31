import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  broadcastGlobalAndScheduleBoardParticipantRefresh,
  scheduleBoardParticipantRefreshForSession,
} from "./bridge/board-participant-invalidation-controller.js";
import { buildBoardRowSessionStatuses } from "./board-row-session-status.js";
import { maybeBroadcastGlobalSessionActivityUpdate } from "./ws-bridge-deps.js";
import { WsBridge } from "./ws-bridge.js";

type LauncherSession = {
  sessionId: string;
  sessionNum?: number;
  reviewerOf?: number;
  herdedBy?: string;
  archived?: boolean;
  state: string;
  cliConnected?: boolean;
  name?: string;
};

function makeHarness() {
  const leader = {
    id: "leader-1",
    state: {},
    board: new Map([
      [
        "q-1761",
        {
          questId: "q-1761",
          title: "Restore reviewer chip",
          worker: "worker-1",
          workerNum: 2402,
          status: "CODE_REVIEWING",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    ]),
    completedBoard: new Map(),
  };
  const launcherSessions = new Map<string, LauncherSession>([
    ["leader-1", { sessionId: "leader-1", sessionNum: 1563, state: "connected", cliConnected: true }],
    [
      "worker-1",
      {
        sessionId: "worker-1",
        sessionNum: 2402,
        herdedBy: "leader-1",
        state: "connected",
        cliConnected: true,
        name: "Stale Worker Name",
      },
    ],
  ]);
  const names = new Map([
    ["worker-1", "Current Worker"],
    ["reviewer-1", "Current Reviewer"],
    ["reviewer-2", "Replacement Reviewer"],
    ["reviewer-3", "Deleted Reviewer"],
  ]);
  const host = {
    sessions: new Map([[leader.id, leader]]),
    launcher: {
      getSession: (sessionId: string) => launcherSessions.get(sessionId),
      listSessions: () => [...launcherSessions.values()],
    },
    sessionNameGetter: (sessionId: string) => names.get(sessionId),
    broadcastToBrowsers: vi.fn(),
    broadcastGlobal: vi.fn(),
    getBoardRowSessionStatuses: vi.fn((_leaderId: string, board: any[], completedBoard: any[]) =>
      buildBoardRowSessionStatuses(
        [...board, ...completedBoard],
        [...launcherSessions.values()].map((session) => ({
          ...session,
          name: names.get(session.sessionId),
        })),
      ),
    ),
  };
  return { host, leader, launcherSessions };
}

function boardUpdates(host: ReturnType<typeof makeHarness>["host"]) {
  return host.broadcastToBrowsers.mock.calls.filter(([, message]) => message.type === "board_updated");
}

function flushInvalidations() {
  vi.advanceTimersByTime(50);
}

describe("board row session status projection", () => {
  it("keeps active row participant status when completed history has the same quest", () => {
    // Board detail requests active rows plus completed history. The status map
    // is keyed by quest id, so the active row must win over stale history.
    const statuses = buildBoardRowSessionStatuses(
      [
        { questId: "q-1799", worker: "worker-new", workerNum: 2464, status: "PLANNING", createdAt: 2, updatedAt: 2 },
        {
          questId: "q-1799",
          worker: "worker-archived",
          workerNum: 2455,
          status: "MEMORY",
          completedAt: 100,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [
        {
          sessionId: "worker-new",
          sessionNum: 2464,
          state: "connected",
          cliConnected: true,
        },
        {
          sessionId: "worker-archived",
          sessionNum: 2455,
          state: "exited",
          archived: true,
        },
      ],
    );

    expect(statuses["q-1799"]?.worker).toEqual({
      sessionId: "worker-new",
      sessionNum: 2464,
      status: "idle",
    });
  });
});

describe("targeted board participant invalidation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // These transitions use the same launcher and board fields as production so
  // archive/delete cannot accidentally keep returning a static reviewer stub.
  it("projects reviewer spawn through real session and board inputs", () => {
    const { host, leader, launcherSessions } = makeHarness();
    launcherSessions.set("reviewer-1", {
      sessionId: "reviewer-1",
      sessionNum: 2403,
      reviewerOf: 2402,
      herdedBy: "leader-1",
      state: "running",
      cliConnected: true,
      name: "Stale Reviewer Name",
    });

    broadcastGlobalAndScheduleBoardParticipantRefresh(host, {
      type: "session_created",
      session_id: "reviewer-1",
    });
    expect(boardUpdates(host)).toHaveLength(0);
    flushInvalidations();

    expect(boardUpdates(host)).toEqual([
      [
        leader,
        expect.objectContaining({
          type: "board_updated",
          board: [expect.objectContaining({ worker: "worker-1", workerNum: 2402 })],
          rowSessionStatuses: {
            "q-1761": {
              worker: expect.objectContaining({ sessionId: "worker-1", name: "Current Worker" }),
              reviewer: expect.objectContaining({ sessionId: "reviewer-1", name: "Current Reviewer" }),
            },
          },
        }),
        { skipBuffer: true, skipGlobalActivity: true },
      ],
    ]);
  });

  it("coalesces an archive/create replacement burst and publishes only the exact replacement", () => {
    const { host, launcherSessions } = makeHarness();
    launcherSessions.set("reviewer-1", {
      sessionId: "reviewer-1",
      sessionNum: 2403,
      reviewerOf: 2402,
      herdedBy: "leader-1",
      archived: true,
      state: "exited",
    });
    broadcastGlobalAndScheduleBoardParticipantRefresh(host, {
      type: "session_archived",
      session_id: "reviewer-1",
      reviewerOf: 2402,
      herdedBy: "leader-1",
    });
    launcherSessions.set("reviewer-2", {
      sessionId: "reviewer-2",
      sessionNum: 2404,
      reviewerOf: 2402,
      herdedBy: "leader-1",
      state: "running",
      cliConnected: true,
    });
    broadcastGlobalAndScheduleBoardParticipantRefresh(host, {
      type: "session_created",
      session_id: "reviewer-2",
    });
    flushInvalidations();

    expect(boardUpdates(host)).toHaveLength(1);
    expect(boardUpdates(host)[0]?.[1]).toMatchObject({
      rowSessionStatuses: {
        "q-1761": {
          worker: { sessionId: "worker-1", sessionNum: 2402, name: "Current Worker", status: "idle" },
          reviewer: {
            sessionId: "reviewer-2",
            sessionNum: 2404,
            name: "Replacement Reviewer",
            status: "running",
          },
        },
      },
    });
  });

  it("removes archived and deleted reviewers from the exact active board projection", () => {
    const { host, launcherSessions } = makeHarness();
    launcherSessions.set("reviewer-3", {
      sessionId: "reviewer-3",
      sessionNum: 2405,
      reviewerOf: 2402,
      herdedBy: "leader-1",
      state: "running",
      cliConnected: true,
    });
    broadcastGlobalAndScheduleBoardParticipantRefresh(host, {
      type: "session_created",
      session_id: "reviewer-3",
    });
    flushInvalidations();
    host.broadcastToBrowsers.mockClear();

    launcherSessions.get("reviewer-3")!.archived = true;
    broadcastGlobalAndScheduleBoardParticipantRefresh(host, {
      type: "session_archived",
      session_id: "reviewer-3",
      reviewerOf: 2402,
      herdedBy: "leader-1",
    });
    flushInvalidations();
    expect(boardUpdates(host)[0]?.[1]).toMatchObject({
      rowSessionStatuses: { "q-1761": { reviewer: null } },
    });

    host.broadcastToBrowsers.mockClear();
    launcherSessions.delete("reviewer-3");
    broadcastGlobalAndScheduleBoardParticipantRefresh(host, {
      type: "session_deleted",
      session_id: "reviewer-3",
      reviewerOf: 2402,
      herdedBy: "leader-1",
    });
    flushInvalidations();
    expect(boardUpdates(host)[0]?.[1]).toMatchObject({
      rowSessionStatuses: { "q-1761": { reviewer: null } },
    });
  });

  it("does not publish boards for unrelated session lifecycle changes", () => {
    const { host, launcherSessions } = makeHarness();
    launcherSessions.set("unrelated-reviewer", {
      sessionId: "unrelated-reviewer",
      sessionNum: 2501,
      reviewerOf: 2500,
      herdedBy: "leader-1",
      state: "running",
      cliConnected: true,
    });

    broadcastGlobalAndScheduleBoardParticipantRefresh(host, {
      type: "session_created",
      session_id: "unrelated-reviewer",
    });
    flushInvalidations();

    expect(boardUpdates(host)).toHaveLength(0);
    expect(host.getBoardRowSessionStatuses).not.toHaveBeenCalled();
  });

  it("publishes an active worker board projection refresh for its leader", () => {
    const { host, leader } = makeHarness();

    scheduleBoardParticipantRefreshForSession(host, "worker-1");
    expect(boardUpdates(host)).toHaveLength(0);
    flushInvalidations();

    expect(boardUpdates(host)).toEqual([
      [
        leader,
        expect.objectContaining({
          type: "board_updated",
          board: [expect.objectContaining({ questId: "q-1761", worker: "worker-1" })],
          rowSessionStatuses: {
            "q-1761": {
              worker: expect.objectContaining({ sessionId: "worker-1", name: "Current Worker" }),
              reviewer: null,
            },
          },
        }),
        { skipBuffer: true, skipGlobalActivity: true },
      ],
    ]);
  });

  it("keeps status changes on the projection-only path", () => {
    const { host } = makeHarness();
    const reviewerSession = {
      id: "reviewer-1",
      state: {},
      pendingPermissions: new Map(),
      notifications: [],
      notificationStatusVersion: 0,
      notificationStatusUpdatedAt: 0,
    };

    maybeBroadcastGlobalSessionActivityUpdate(host, reviewerSession as any, {
      type: "status_change",
      status: "running",
    });

    expect(host.broadcastGlobal).not.toHaveBeenCalled();
    expect(boardUpdates(host)).toHaveLength(0);
  });
});

describe("board participant names", () => {
  it("uses the authoritative session-name getter instead of launcher names", () => {
    const bridge = new WsBridge();
    bridge.launcher = {
      listSessions: () => [
        {
          sessionId: "worker-1",
          sessionNum: 2402,
          state: "connected",
          name: "Stale Launcher Worker",
        },
        {
          sessionId: "reviewer-1",
          sessionNum: 2403,
          reviewerOf: 2402,
          state: "connected",
          name: "Stale Launcher Reviewer",
        },
      ],
    } as any;
    bridge.sessionNameGetter = (sessionId) =>
      sessionId === "worker-1" ? "Authoritative Worker" : "Authoritative Reviewer";

    const statuses = bridge.getBoardRowSessionStatuses(
      "leader-1",
      [
        {
          questId: "q-1761",
          worker: "worker-1",
          workerNum: 2402,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      [],
    );

    expect(statuses["q-1761"]).toMatchObject({
      worker: { name: "Authoritative Worker" },
      reviewer: { name: "Authoritative Reviewer" },
    });
  });

  it("includes retained worker Codex reasoning metadata while idle", () => {
    const statuses = buildBoardRowSessionStatuses(
      [
        {
          questId: "q-1761",
          worker: "worker-1",
          workerNum: 2402,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      [
        {
          sessionId: "worker-1",
          sessionNum: 2402,
          state: "idle",
          cliConnected: true,
          codexReasoningPreviews: [
            {
              text: "Inspecting row state",
              updatedAt: 456,
              threadKey: "q-1761",
              questId: "q-1761",
            },
          ],
        },
      ],
    );

    expect(statuses["q-1761"].worker).toMatchObject({
      sessionId: "worker-1",
      status: "idle",
      codexReasoningPreviews: [{ text: "Inspecting row state", threadKey: "q-1761" }],
    });
  });
});
