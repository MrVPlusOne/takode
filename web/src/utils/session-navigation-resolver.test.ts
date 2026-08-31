import { describe, expect, it } from "vitest";
import type { SdkSessionInfo } from "../types.js";
import { resolveSessionNavigation } from "./session-navigation-resolver.js";

function sdk(overrides: Partial<SdkSessionInfo> = {}): SdkSessionInfo {
  return {
    sessionId: "s1",
    state: "connected",
    status: "idle",
    cwd: "/repo",
    createdAt: 10,
    model: "model",
    backendType: "codex",
    sessionNum: 1,
    ...overrides,
  };
}

describe("resolveSessionNavigation", () => {
  it("derives every navigation surface from the matching canonical SDK row", () => {
    const phaseSummary = [{ phaseId: "work", count: 2 }] as never;
    const boardRows = [{ questId: "q-42", updatedAt: 1 }] as never;
    const portrait = { id: "tako", label: "Tako" } as never;
    const session = sdk({
      name: "Canonical name",
      lastMessagePreview: "Canonical preview",
      model: "canonical-model",
      permissionMode: "default",
      askPermission: false,
      sessionNum: 42,
      status: "running",
      cliConnected: true,
      killedByIdleManager: false,
      pendingPermissionCount: 3,
      pendingTimerCount: 2,
      paused: true,
      pausedInputQueueCount: 4,
      lastUserMessageAt: 500,
      lastMessagePreviewAt: 600,
      claimedQuestId: "q-42",
      claimedQuestTitle: "Canonical quest",
      claimedQuestStatus: "in_progress",
      claimedQuestLeaderSessionId: "leader-1",
      gitBranch: "canonical-branch",
      gitAhead: 5,
      gitBehind: 6,
      totalLinesAdded: 7,
      totalLinesRemoved: 8,
      userTurnCount: 9,
      agentTurnCount: 10,
      contextUsedPercent: 11,
      contextTokensUsed: 12,
      modelContextWindow: 13,
      codexMaxContextLength: 14,
      codexLeaderRecycleThresholdTokens: 15,
      messageHistoryBytes: 16,
      codexRetainedPayloadBytes: 17,
      codexReasoningEffort: "medium",
      codexEffectiveReasoningEffort: "high",
      codexEffectiveReasoningEffortReported: true,
      leaderActivePhaseSummary: phaseSummary,
      leaderActiveBoardRows: boardRows,
      leaderProfilePortraitId: "tako",
      leaderProfilePortrait: portrait,
      notificationUrgency: "review",
      activeReviewNotificationCount: 2,
    });

    const resolved = resolveSessionNavigation({ sdkSessions: [session] }, "s1");

    expect(resolved).not.toBeNull();
    expect(resolved?.sidebarItem.name).toBe("Canonical name");
    expect(resolved?.sidebarItem.lastMessagePreview).toBe("Canonical preview");
    expect(resolved?.sidebarItem).toMatchObject({
      model: "canonical-model",
      sessionNum: 42,
      status: "running",
      isConnected: true,
      idleKilled: false,
      permCount: 3,
      pendingTimerCount: 2,
      paused: true,
      pausedInputQueueCount: 4,
      lastUserMessageAt: 500,
      lastMessagePreviewAt: 600,
      gitBranch: "canonical-branch",
      gitAhead: 5,
      gitBehind: 6,
      linesAdded: 7,
      linesRemoved: 8,
      askPermission: false,
      leaderActivePhaseSummary: phaseSummary,
      leaderActiveBoardRows: boardRows,
      leaderProfilePortraitId: "tako",
      leaderProfilePortrait: portrait,
      notificationUrgency: "review",
      activeReviewNotificationCount: 2,
    });
    expect(resolved?.viewModel).toMatchObject({
      model: "canonical-model",
      permissionMode: "default",
      askPermission: false,
      claimedQuestId: "q-42",
      claimedQuestTitle: "Canonical quest",
      claimedQuestLeaderSessionId: "leader-1",
      numTurns: 9,
      agentTurnCount: 10,
      contextUsedPercent: 11,
      contextTokensUsed: 12,
      backendReportedContextWindow: 13,
      modelContextWindow: 13,
      codexMaxContextLength: 14,
      codexLeaderRecycleThresholdTokens: 15,
      messageHistoryBytes: 16,
      codexRetainedPayloadBytes: 17,
      codexReasoningEffort: "medium",
      codexEffectiveReasoningEffort: "high",
      codexEffectiveReasoningEffortReported: true,
    });
  });

  it("keeps the full resolved result stable while the canonical SDK row is unchanged", () => {
    const session = sdk();
    const source = { sdkSessions: [session] };

    const first = resolveSessionNavigation(source, "s1");
    const second = resolveSessionNavigation(source, "s1");

    expect(second).toBe(first);
    expect(second?.sidebarItem).toBe(first?.sidebarItem);
    expect(second?.viewModel).toBe(first?.viewModel);
  });

  it("replaces cached navigation when the store materializes a new SDK row", () => {
    const firstRow = sdk({ status: "idle" });
    const first = resolveSessionNavigation({ sdkSessions: [firstRow] }, "s1")!;
    const nextRow = { ...firstRow, status: "running" } satisfies SdkSessionInfo;
    const next = resolveSessionNavigation({ sdkSessions: [nextRow] }, "s1")!;

    expect(next).not.toBe(first);
    expect(next.sidebarItem.status).toBe("running");
  });

  it("lets explicit canonical status outrank an idle state fallback", () => {
    const resolved = resolveSessionNavigation(
      { sdkSessions: [sdk({ state: "connected", status: "running", cliConnected: true })] },
      "s1",
    );

    expect(resolved?.sidebarItem.status).toBe("running");
    expect(resolved?.sidebarItem.isConnected).toBe(true);
  });

  it("does not arbitrate against stale mixed-version navigation inputs", () => {
    const resolved = resolveSessionNavigation(
      {
        sdkSessions: [sdk({ model: "canonical-model", status: "idle" })],
        sessions: new Map([["s1", { model: "stale-model" }]]),
        sessionStatus: new Map([["s1", "running"]]),
        syncedProjectionValues: new Map([["session-navigation:s1", { model: "stale-projection-model" }]]),
      },
      "s1",
    );

    expect(resolved?.sidebarItem.model).toBe("canonical-model");
    expect(resolved?.sidebarItem.status).toBe("idle");
  });

  it("returns null when the compatible-build snapshot has no matching row", () => {
    expect(resolveSessionNavigation({ sdkSessions: [] }, "missing")).toBeNull();
  });
});
