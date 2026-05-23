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

  it("uses generic current-session diff copy for non-leader sessions", () => {
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
      title: "Show diffs",
    });
  });

  it("targets the quest worker session for a leader quest thread", () => {
    const target = resolveDiffTarget(
      makeState({
        sessions: new Map([
          ["leader", { session_id: "leader", cwd: "/repo/leader", isOrchestrator: true } as any],
          ["worker", { session_id: "worker", cwd: "/repo/worker" } as any],
        ]),
        sdkSessions: [
          {
            sessionId: "leader",
            createdAt: 1,
            cwd: "/repo/leader",
            isOrchestrator: true,
            sessionNum: 1,
            state: "connected",
          },
          { sessionId: "worker", createdAt: 2, cwd: "/repo/worker", sessionNum: 2, state: "connected" },
        ],
        sessionBoards: new Map([["leader", [{ questId: "q-42", worker: "worker", updatedAt: 1 }]]]),
      }),
      "leader",
      "q-42",
    );
    expect(target).toMatchObject({ kind: "session", source: "quest-worker", sessionId: "worker", questId: "q-42" });
  });

  it("uses live board row worker status and reports disconnected workers explicitly", () => {
    const target = resolveDiffTarget(
      makeState({
        sessions: new Map([
          ["leader", { session_id: "leader", cwd: "/repo/leader", isOrchestrator: true } as any],
          ["worker", { session_id: "worker", cwd: "/repo/worker" } as any],
        ]),
        sdkSessions: [
          {
            sessionId: "leader",
            createdAt: 1,
            cwd: "/repo/leader",
            isOrchestrator: true,
            sessionNum: 1,
            state: "connected",
          },
          { sessionId: "worker", createdAt: 2, cwd: "/repo/worker", sessionNum: 2, state: "connected" },
        ],
        sessionBoardRowStatuses: new Map([
          ["leader", { "q-42": { worker: { sessionId: "worker", sessionNum: 2, status: "disconnected" } } }],
        ]),
      }),
      "leader",
      "q-42",
    );
    expect(target).toMatchObject({ kind: "session", sessionId: "worker", warning: "Worker session is disconnected." });
  });

  it("reports archived workers explicitly while still targeting their available diff state", () => {
    const target = resolveDiffTarget(
      makeState({
        sessions: new Map([
          ["leader", { session_id: "leader", cwd: "/repo/leader", isOrchestrator: true } as any],
          ["worker", { session_id: "worker", cwd: "/repo/worker" } as any],
        ]),
        sdkSessions: [
          {
            sessionId: "leader",
            createdAt: 1,
            cwd: "/repo/leader",
            isOrchestrator: true,
            sessionNum: 1,
            state: "connected",
          },
          {
            sessionId: "worker",
            createdAt: 2,
            cwd: "/repo/worker",
            sessionNum: 2,
            state: "connected",
            archived: true,
          },
        ],
        sessionBoards: new Map([["leader", [{ questId: "q-42", worker: "worker", updatedAt: 1 }]]]),
      }),
      "leader",
      "q-42",
    );
    expect(target).toMatchObject({ kind: "session", sessionId: "worker", warning: "Worker session is archived." });
  });

  it("does not fall back to the leader diff when a quest thread has no worker", () => {
    const target = resolveDiffTarget(makeState(), "leader", "q-42");
    expect(target).toMatchObject({
      kind: "unavailable",
      source: "quest-worker",
      questId: "q-42",
      message: "No worker session is assigned to q-42.",
    });
  });

  it("reports a missing named worker session without targeting the leader diff", () => {
    const target = resolveDiffTarget(
      makeState({
        sessionBoards: new Map([["leader", [{ questId: "q-42", worker: "missing-worker", updatedAt: 1 }]]]),
      }),
      "leader",
      "q-42",
    );
    expect(target).toMatchObject({
      kind: "unavailable",
      source: "quest-worker",
      questId: "q-42",
      message: "The worker session for q-42 is not available in this browser state.",
    });
  });

  it("reports an unavailable worker session without cwd before rendering a diff panel", () => {
    const target = resolveDiffTarget(
      makeState({
        sessions: new Map([
          ["leader", { session_id: "leader", cwd: "/repo/leader", isOrchestrator: true } as any],
          ["worker", { session_id: "worker" } as any],
        ]),
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
        sessionBoards: new Map([["leader", [{ questId: "q-42", worker: "worker", workerNum: 2, updatedAt: 1 }]]]),
      }),
      "leader",
      "q-42",
    );
    expect(target).toMatchObject({
      kind: "unavailable",
      source: "quest-worker",
      questId: "q-42",
      message: "#2 does not have a working directory available for diff inspection.",
    });
  });
});
