import { describe, expect, it } from "vitest";
import {
  SESSION_NAVIGATION_PROJECTION,
  reconcileSessionNavigationProjectionValue,
} from "../../shared/session-navigation-projection.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import type { SdkSessionInfo } from "../types.js";
import { createSessionNavigationProjectionValue } from "../test-fixtures/session-navigation-projection.js";
import { resolveSessionNavigation, type SessionNavigationResolverSource } from "./session-navigation-resolver.js";

function sdk(overrides: Partial<SdkSessionInfo> = {}): SdkSessionInfo {
  return {
    sessionId: "s1",
    state: "connected",
    cwd: "/legacy",
    createdAt: 10,
    model: "legacy-model",
    backendType: "claude",
    sessionNum: 1,
    ...overrides,
  };
}

function source(
  value = createSessionNavigationProjectionValue(),
  sdkOverrides: Partial<SdkSessionInfo> = {},
): SessionNavigationResolverSource {
  const entryId = syncedProjectionEntryId(SESSION_NAVIGATION_PROJECTION, "s1");
  return {
    sessions: new Map(),
    sdkSessions: [sdk(sdkOverrides)],
    syncedProjectionValues: new Map([[entryId, value]]),
    syncedProjectionKeys: new Set([entryId]),
    cliConnected: new Map([["s1", false]]),
    cliDisconnectReason: new Map([["s1", "idle_limit"]]),
    sessionStatus: new Map([["s1", "running"]]),
    pendingPermissions: new Map([["s1", new Map([["legacy", {}]])]]),
    askPermission: new Map([["s1", true]]),
    diffFileStats: new Map([["s1", new Map([["legacy.ts", { additions: 99, deletions: 88 }]])]]),
    sessionNames: new Map([["s1", "Legacy name"]]),
    sessionPreviews: new Map([["s1", "Legacy preview"]]),
    countUserPermissions: (permissions) => permissions?.size ?? 0,
  };
}

describe("resolveSessionNavigation", () => {
  it("uses projected navigation authority across row, configuration, git, and detail fields", () => {
    const value = createSessionNavigationProjectionValue({
      identity: {
        name: "Projected name",
        model: "projected-model",
        permissionMode: "default",
        askPermission: false,
        sessionNum: 42,
      },
      lifecycle: {
        status: null,
        cliConnected: true,
        idleKilled: false,
        pendingPermissionCount: 3,
        pendingTimerCount: 2,
        paused: true,
        pausedInputQueueCount: 4,
        lastUserMessageAt: 500,
        lastMessagePreviewAt: 600,
      },
      quest: {
        claimedQuestId: "q-42",
        claimedQuestTitle: "Projected quest",
        claimedQuestStatus: "in_progress",
        claimedQuestLeaderSessionId: "leader-1",
      },
      git: { branch: "projected-branch", ahead: 5, behind: 6, linesAdded: 7, linesRemoved: 8 },
      detail: {
        lastMessagePreview: "Projected preview",
        userTurnCount: 9,
        agentTurnCount: 10,
        contextUsedPercent: 11,
        contextTokensUsed: 12,
        modelContextWindow: 13,
        configuredContextWindow: 14,
        effectiveContextWindow: 15,
        messageHistoryBytes: 16,
        codexRetainedPayloadBytes: 17,
        codexReasoningEffort: "medium",
        codexEffectiveReasoningEffort: "high",
        codexEffectiveReasoningEffortReported: true,
      },
    });

    const resolved = resolveSessionNavigation(source(value), "s1");

    expect(resolved).not.toBeNull();
    expect(resolved?.projectionState).toBe("accepted");
    expect(resolved?.name).toBe("Projected name");
    expect(resolved?.preview).toBe("Projected preview");
    expect(resolved?.sidebarItem).toMatchObject({
      model: "projected-model",
      sessionNum: 42,
      status: null,
      isConnected: true,
      idleKilled: false,
      permCount: 3,
      pendingTimerCount: 2,
      paused: true,
      pausedInputQueueCount: 4,
      lastUserMessageAt: 500,
      lastMessagePreviewAt: 600,
      gitBranch: "projected-branch",
      gitAhead: 5,
      gitBehind: 6,
      linesAdded: 7,
      linesRemoved: 8,
      askPermission: false,
    });
    expect(resolved?.viewModel).toMatchObject({
      model: "projected-model",
      permissionMode: "default",
      askPermission: false,
      claimedQuestId: "q-42",
      claimedQuestTitle: "Projected quest",
      claimedQuestLeaderSessionId: "leader-1",
      numTurns: 9,
      agentTurnCount: 10,
      contextUsedPercent: 11,
      contextTokensUsed: 12,
      backendReportedContextWindow: 13,
      modelContextWindow: 13,
      codexMaxContextLength: 14,
      messageHistoryBytes: 16,
      codexRetainedPayloadBytes: 17,
      codexReasoningEffort: "medium",
      codexEffectiveReasoningEffort: "high",
      codexEffectiveReasoningEffortReported: true,
    });
  });

  it("keeps leader thread, board, profile, and notification fields on legacy authority", () => {
    const phaseSummary = [{ phaseId: "work", count: 2 }] as never;
    const boardRows = [{ questId: "q-42", updatedAt: 1 }] as never;
    const portrait = { id: "tako", label: "Tako" } as never;
    const resolved = resolveSessionNavigation(
      source(createSessionNavigationProjectionValue(), {
        leaderActivePhaseSummary: phaseSummary,
        leaderActiveBoardRows: boardRows,
        leaderProfilePortraitId: "tako",
        leaderProfilePortrait: portrait,
        notificationUrgency: "review",
        activeReviewNotificationCount: 2,
      }),
      "s1",
    );

    expect(resolved?.sidebarItem).toMatchObject({
      leaderActivePhaseSummary: phaseSummary,
      leaderActiveBoardRows: boardRows,
      leaderProfilePortraitId: "tako",
      leaderProfilePortrait: portrait,
      notificationUrgency: "review",
      activeReviewNotificationCount: 2,
    });
  });

  it("keeps an authoritative projected recycle-threshold clear from reviving stale legacy metadata", () => {
    const value = createSessionNavigationProjectionValue({
      identity: { backendType: "codex" },
      topology: { isOrchestrator: true },
      detail: { modelContextWindow: 950_000, effectiveContextWindow: 950_000 },
    });
    const resolved = resolveSessionNavigation(
      source(value, { backendType: "codex", isOrchestrator: true, codexLeaderRecycleThresholdTokens: 260_000 }),
      "s1",
    );

    expect(resolved?.viewModel.codexLeaderRecycleThresholdTokens).toBeUndefined();
    expect(resolved?.viewModel.modelContextWindow).toBe(950_000);
  });

  it("keeps sidebar row identity stable when only projected detail changes", () => {
    const first = createSessionNavigationProjectionValue({ detail: { lastMessagePreview: "First" } });
    const resolverSource = source(first);
    const initial = resolveSessionNavigation(resolverSource, "s1")!;
    const next = reconcileSessionNavigationProjectionValue(first, {
      ...first,
      detail: { ...first.detail, lastMessagePreview: "Second", contextUsedPercent: 20 },
    });
    resolverSource.syncedProjectionValues?.set(syncedProjectionEntryId(SESSION_NAVIGATION_PROJECTION, "s1"), next);

    const updated = resolveSessionNavigation(resolverSource, "s1")!;

    expect(updated.sidebarItem).toBe(initial.sidebarItem);
    expect(updated.preview).toBe("Second");
    expect(updated.viewModel).not.toBe(initial.viewModel);
    expect(updated.viewModel.contextUsedPercent).toBe(20);
  });

  it("replaces the row cache across repeated lifecycle changes instead of retaining old variants", () => {
    const first = createSessionNavigationProjectionValue({ lifecycle: { status: "idle" } });
    const resolverSource = source(first);
    const entryId = syncedProjectionEntryId(SESSION_NAVIGATION_PROJECTION, "s1");
    const initial = resolveSessionNavigation(resolverSource, "s1")!;
    const running = reconcileSessionNavigationProjectionValue(first, {
      ...first,
      lifecycle: { ...first.lifecycle, status: "running" },
    });
    resolverSource.syncedProjectionValues?.set(entryId, running);
    const active = resolveSessionNavigation(resolverSource, "s1")!;
    const idleAgain = reconcileSessionNavigationProjectionValue(running, {
      ...running,
      lifecycle: { ...running.lifecycle, status: "idle" },
    });
    resolverSource.syncedProjectionValues?.set(entryId, idleAgain);
    const settled = resolveSessionNavigation(resolverSource, "s1")!;

    expect(active.sidebarItem).not.toBe(initial.sidebarItem);
    expect(settled.sidebarItem).not.toBe(initial.sidebarItem);
    expect(settled.sidebarItem.status).toBe("idle");
  });

  it("fails closed when an SDK row supplies a malformed projection envelope", () => {
    const resolved = resolveSessionNavigation(
      {
        sessions: new Map(),
        sdkSessions: [sdk({ sessionNavigationProjection: { revision: 0 } as never, name: "Stale name" })],
        sessionNames: new Map([["s1", "Stale name"]]),
      },
      "s1",
    );

    expect(resolved?.projectionState).toBe("invalid-supplied");
    expect(resolved?.name).toBeUndefined();
    expect(resolved?.sidebarItem.model).toBe("");
  });
});
