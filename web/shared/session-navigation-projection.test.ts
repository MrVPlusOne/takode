import { describe, expect, expectTypeOf, it } from "vitest";
import {
  isSessionNavigationProjectionValue,
  reconcileSessionNavigationProjectionValue,
  sessionNavigationProjectionEqual,
  type SessionNavigationProjectionValue,
} from "./session-navigation-projection.js";

function value(): SessionNavigationProjectionValue {
  return {
    name: "Worker",
    model: "gpt-5.6",
    cwd: "/repo",
    backendType: "codex",
    permissionMode: "codex-default",
    askPermission: true,
    sessionNum: 42,
    createdAt: 1,
    treeGroupId: "default",
    memorySessionSpaceSlug: "Takode",
    repoRoot: "/repo",
    isWorktree: true,
    isContainerized: false,
    isAssistant: false,
    isOrchestrator: false,
    herdedBy: "leader",
    reviewerOf: null,
    cronJobId: null,
    cronJobName: null,
    state: "connected",
    status: "idle",
    cliConnected: true,
    killedByIdleManager: false,
    pendingPermissionCount: 0,
    pendingTimerCount: 1,
    paused: false,
    pausedInputQueueCount: 0,
    lastActivityAt: 2,
    lastUserMessageAt: 1,
    lastMessagePreviewAt: 2,
    claimedQuestId: "q-1",
    claimedQuestTitle: "Build projection",
    claimedQuestStatus: "in_progress",
    claimedQuestVerificationInboxUnread: null,
    claimedQuestLeaderSessionId: "leader",
    gitBranch: "worker",
    gitDefaultBranch: "origin/main",
    diffBaseBranch: "main",
    gitAhead: 1,
    gitBehind: 0,
    totalLinesAdded: 12,
    totalLinesRemoved: 3,
    diffStatsSkippedReason: null,
    gitStatusRefreshedAt: 3,
    gitStatusRefreshError: null,
    lastMessagePreview: "Implement the server projection",
    userTurnCount: 2,
    agentTurnCount: 1,
    contextUsedPercent: 12.5,
    contextTokensUsed: 10_000,
    modelContextWindow: 400_000,
    codexMaxContextLength: 500_000,
    claudeMaxContextLength: null,
    codexLeaderRecycleThresholdTokens: 450_000,
    messageHistoryBytes: 1_024,
    codexRetainedPayloadBytes: 2_048,
    codexReasoningEffort: "high",
    codexEffectiveReasoningEffort: "high",
    codexEffectiveReasoningEffortReported: true,
  };
}

describe("session navigation projection contract", () => {
  it("derives exact field types from the wire rules", () => {
    expectTypeOf<SessionNavigationProjectionValue["backendType"]>().toEqualTypeOf<"claude" | "codex" | "claude-sdk">();
    expectTypeOf<SessionNavigationProjectionValue["state"]>().toEqualTypeOf<
      "starting" | "connected" | "running" | "exited"
    >();
    expectTypeOf<SessionNavigationProjectionValue["status"]>().toEqualTypeOf<
      "running" | "compacting" | "reverting" | "idle" | null
    >();
    expectTypeOf<SessionNavigationProjectionValue["name"]>().toEqualTypeOf<string | null>();
    expectTypeOf<SessionNavigationProjectionValue["sessionNum"]>().toEqualTypeOf<number | null>();
    expectTypeOf<SessionNavigationProjectionValue["claimedQuestVerificationInboxUnread"]>().toEqualTypeOf<
      boolean | null
    >();
  });

  it("validates the bounded normalized wire value", () => {
    expect(isSessionNavigationProjectionValue(value())).toBe(true);
    expect(isSessionNavigationProjectionValue({ ...value(), lastMessagePreview: "x".repeat(81) })).toBe(false);
    expect(isSessionNavigationProjectionValue({ ...value(), askPermission: undefined })).toBe(false);
    expect(isSessionNavigationProjectionValue({ ...value(), lastMessagePreviewAt: -1 })).toBe(false);
  });

  it("compares every projected field", () => {
    const first = value();
    expect(sessionNavigationProjectionEqual(first, structuredClone(first))).toBe(true);
    expect(sessionNavigationProjectionEqual(first, { ...structuredClone(first), status: "running" })).toBe(false);
    expect(sessionNavigationProjectionEqual(first, { ...structuredClone(first), askPermission: false })).toBe(false);
  });

  it("reuses the whole value only when every field is unchanged", () => {
    const first = value();
    expect(reconcileSessionNavigationProjectionValue(first, structuredClone(first))).toBe(first);

    const next = { ...structuredClone(first), status: "running" as const };
    expect(reconcileSessionNavigationProjectionValue(first, next)).toBe(next);
  });
});
