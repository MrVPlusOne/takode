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

  it("targets the quest commit surface for a leader quest thread", () => {
    const target = resolveDiffTarget(makeState(), "leader", "q-42");
    expect(target).toMatchObject({
      kind: "quest-commits",
      source: "quest-commits",
      questId: "q-42",
      title: "Show q-42 recorded commits",
    });
    expect(target).not.toHaveProperty("commitShas");
  });

  it("does not fall back to worker or leader raw diffs when a quest has no recorded commits", () => {
    const target = resolveDiffTarget(makeState(), "leader", "q-42");
    expect(target).toMatchObject({
      kind: "quest-commits",
      source: "quest-commits",
      questId: "q-42",
    });
    expect(target).not.toHaveProperty("commitShas");
  });
});
