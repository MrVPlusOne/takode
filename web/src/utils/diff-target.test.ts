import { describe, expect, it } from "vitest";
import type { AppState } from "../store-types.js";
import { resolveDiffTarget } from "./diff-target.js";

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    sessions: new Map([["leader", { session_id: "leader", cwd: "/repo/leader", isOrchestrator: true } as any]]),
    sdkSessions: [
      {
        sessionId: "leader",
        createdAt: 1,
        cwd: "/repo/leader",
        isOrchestrator: true,
        sessionNum: 1,
        state: "connected",
      },
    ],
    sessionBoards: new Map(),
    sessionCompletedBoards: new Map(),
    sessionBoardRowStatuses: new Map(),
    quests: [],
    ...overrides,
  } as AppState;
}

describe("resolveDiffTarget", () => {
  it("keeps leader Main diff targeted at the leader session", () => {
    const target = resolveDiffTarget(makeState(), "leader", "main");
    expect(target).toMatchObject({ kind: "session", source: "leader", sessionId: "leader" });
  });

  it("keeps leader All Threads diff targeted at the leader session", () => {
    const target = resolveDiffTarget(makeState(), "leader", "all");
    expect(target).toMatchObject({ kind: "session", source: "leader", sessionId: "leader" });
  });

  it("targets a non-leader session's own changes when it has no quest", () => {
    const target = resolveDiffTarget(
      makeState({
        sessions: new Map([["worker", { session_id: "worker", cwd: "/repo/worker" } as any]]),
        sdkSessions: [{ sessionId: "worker", createdAt: 2, cwd: "/repo/worker", sessionNum: 2, state: "connected" }],
      }),
      "worker",
      "main",
    );
    expect(target).toMatchObject({
      kind: "session",
      source: "current-session",
      sessionId: "worker",
      title: "Show changes",
    });
  });

  // A worker's chip sits in its quest banner, so it opens the quest's commits plus its own changes.
  it("targets the claimed quest with the worker's own changes in a worker session", () => {
    const target = resolveDiffTarget(
      makeState({
        sessions: new Map([["worker", { session_id: "worker", cwd: "/repo/worker" } as any]]),
        sdkSessions: [
          {
            sessionId: "worker",
            createdAt: 2,
            cwd: "/repo/worker",
            sessionNum: 2,
            state: "connected",
            claimedQuestId: "q-7",
            claimedQuestStatus: "in_progress",
          },
        ],
      }),
      "worker",
      "main",
    );
    expect(target).toMatchObject({ kind: "quest", questId: "q-7", workerSessionId: "worker", changesOwner: "self" });
  });

  it("targets the quest and its active board worker from a leader quest thread", () => {
    const target = resolveDiffTarget(
      makeState({
        sessionBoards: new Map([
          ["leader", [{ questId: "q-42", status: "IMPLEMENTING", updatedAt: 1, worker: "w-42" }]],
        ]),
      }),
      "leader",
      "q-42",
    );
    expect(target).toMatchObject({
      kind: "quest",
      questId: "q-42",
      workerSessionId: "w-42",
      changesOwner: "worker",
      title: "Show q-42 commits and changes",
    });
    expect(target).not.toHaveProperty("commitShas");
  });

  // No silent fallback: a quest without a worker shows only its commits, never the leader's own diff.
  it("leaves the worker empty instead of falling back to the leader when no active board row has a worker", () => {
    const target = resolveDiffTarget(makeState(), "leader", "q-42");
    expect(target).toMatchObject({ kind: "quest", questId: "q-42", workerSessionId: null });
  });

  // A completed quest's worker may have moved on to other work; its current diff is not this quest's.
  it("does not attach the worker of a completed quest", () => {
    const target = resolveDiffTarget(
      makeState({
        sessionBoards: new Map(),
        sessionCompletedBoards: new Map([
          ["leader", [{ questId: "q-42", status: "DONE", updatedAt: 1, completedAt: 2, worker: "w-42" }]],
        ]),
      }),
      "leader",
      "q-42",
    );
    expect(target).toMatchObject({ kind: "quest", questId: "q-42", workerSessionId: null });
  });
});
