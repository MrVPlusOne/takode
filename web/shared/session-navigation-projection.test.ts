import { describe, expect, it } from "vitest";
import {
  isSessionNavigationProjectionValue,
  reconcileSessionNavigationProjectionValue,
  sessionNavigationProjectionEqual,
  type SessionNavigationProjectionValue,
} from "./session-navigation-projection.js";

function value(): SessionNavigationProjectionValue {
  return {
    identity: {
      name: "Worker",
      model: "gpt-5.6",
      cwd: "/repo",
      backendType: "codex",
      permissionMode: "codex-default",
      askPermission: true,
      sessionNum: 42,
      createdAt: 1,
    },
    topology: {
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
    },
    lifecycle: {
      sdkState: "connected",
      status: "idle",
      cliConnected: true,
      idleKilled: false,
      pendingPermissionCount: 0,
      pendingTimerCount: 1,
      paused: false,
      pausedInputQueueCount: 0,
      lastActivityAt: 2,
      lastUserMessageAt: 1,
      lastMessagePreviewAt: 2,
    },
    quest: {
      claimedQuestId: "q-1",
      claimedQuestTitle: "Build projection",
      claimedQuestStatus: "in_progress",
      claimedQuestVerificationInboxUnread: null,
      claimedQuestLeaderSessionId: "leader",
    },
    git: {
      branch: "worker",
      defaultBranch: "origin/main",
      diffBaseBranch: "main",
      ahead: 1,
      behind: 0,
      linesAdded: 12,
      linesRemoved: 3,
      diffStatsSkippedReason: null,
      statusRefreshedAt: 3,
      statusRefreshError: null,
    },
    detail: {
      lastMessagePreview: "Implement the server projection",
      userTurnCount: 2,
      agentTurnCount: 1,
      contextUsedPercent: 12.5,
      contextTokensUsed: 10_000,
      modelContextWindow: 400_000,
      configuredContextWindow: 500_000,
      effectiveContextWindow: 450_000,
      messageHistoryBytes: 1_024,
      codexRetainedPayloadBytes: 2_048,
      codexReasoningEffort: "high",
      codexEffectiveReasoningEffort: "high",
      codexEffectiveReasoningEffortReported: true,
    },
  };
}

describe("session navigation projection contract", () => {
  it("validates the bounded normalized wire value", () => {
    expect(isSessionNavigationProjectionValue(value())).toBe(true);
    expect(
      isSessionNavigationProjectionValue({
        ...value(),
        detail: { ...value().detail, lastMessagePreview: "x".repeat(81) },
      }),
    ).toBe(false);
    expect(
      isSessionNavigationProjectionValue({
        ...value(),
        identity: { ...value().identity, askPermission: undefined },
      }),
    ).toBe(false);
    expect(
      isSessionNavigationProjectionValue({
        ...value(),
        lifecycle: { ...value().lifecycle, lastMessagePreviewAt: -1 },
      }),
    ).toBe(false);
  });

  it("compares semantic slice values", () => {
    const first = value();
    expect(sessionNavigationProjectionEqual(first, structuredClone(first))).toBe(true);
    expect(
      sessionNavigationProjectionEqual(first, {
        ...structuredClone(first),
        lifecycle: { ...first.lifecycle, status: "running" },
      }),
    ).toBe(false);
    expect(
      sessionNavigationProjectionEqual(first, {
        ...structuredClone(first),
        identity: { ...first.identity, askPermission: false },
      }),
    ).toBe(false);
  });

  it("reuses equal nested slices and the whole value when unchanged", () => {
    const first = value();
    const equal = reconcileSessionNavigationProjectionValue(first, structuredClone(first));
    expect(equal).toBe(first);

    const next = structuredClone(first);
    next.lifecycle.status = "running";
    const reconciled = reconcileSessionNavigationProjectionValue(first, next);
    expect(reconciled).not.toBe(first);
    expect(reconciled.lifecycle).toBe(next.lifecycle);
    expect(reconciled.identity).toBe(first.identity);
    expect(reconciled.topology).toBe(first.topology);
    expect(reconciled.quest).toBe(first.quest);
    expect(reconciled.git).toBe(first.git);
    expect(reconciled.detail).toBe(first.detail);
  });
});
