import { describe, expect, it } from "vitest";
import { isSessionNavigationProjectionValue } from "../shared/session-navigation-projection.js";
import type { Session } from "./bridge/ws-bridge-session.js";
import type { SdkSessionInfo } from "./session-info.js";
import { buildSessionNavigationProjectionValue } from "./session-navigation-projection.js";

function makeSession(): Session {
  return {
    id: "worker-1",
    backendType: "codex",
    pendingPermissions: new Map([
      ["human", { request_id: "human", tool_name: "Bash", input: {} }],
      ["automatic", { request_id: "automatic", tool_name: "Read", input: {}, autoApproved: true }],
    ]),
    isGenerating: true,
    lastUserMessage: "Inspect the synchronized navigation projection",
    state: {
      backend_type: "codex",
      model: "gpt-5.6",
      cwd: "/repo/worktree",
      permissionMode: "codex-default",
      treeGroupId: "project",
      memorySessionSpaceSlug: "Takode",
      repo_root: "/repo",
      is_worktree: true,
      is_containerized: false,
      cronJobId: "cron-1",
      cronJobName: "Nightly",
      pause: { pausedAt: 10, queuedMessages: [{ id: "held" }] },
      claimedQuestId: "q-1",
      claimedQuestTitle: "Migrate navigation",
      claimedQuestStatus: "in_progress",
      claimedQuestVerificationInboxUnread: false,
      claimedQuestLeaderSessionId: "leader-1",
      git_branch: "worker",
      git_default_branch: "origin/main",
      diff_base_branch: "main",
      git_ahead: 2,
      git_behind: 1,
      total_lines_added: 12,
      total_lines_removed: 3,
      diff_stats_skipped_reason: null,
      git_status_refreshed_at: 30,
      git_status_refresh_error: null,
      user_turn_count: 4,
      agent_turn_count: 3,
      num_turns: 4,
      context_used_percent: 25,
      codex_token_details: {
        contextTokensUsed: 100_000,
        inputTokens: 1,
        outputTokens: 2,
        cachedInputTokens: 3,
        reasoningOutputTokens: 4,
        modelContextWindow: 400_000,
      },
      codex_max_context_length: 500_000,
      codex_leader_recycle_threshold_tokens: 350_000,
      message_history_bytes: 1_024,
      codex_retained_payload_bytes: 2_048,
      codex_reasoning_effort: "high",
      codex_effective_reasoning_effort: "medium",
      codex_effective_reasoning_effort_reported: true,
    } as Session["state"],
  } as unknown as Session;
}

describe("session navigation projection", () => {
  it("derives one normalized bounded summary from bridge and launcher authorities", () => {
    const session = makeSession();
    const value = buildSessionNavigationProjectionValue(session, {
      getSession: () => session,
      getLauncherSessionInfo: () => ({
        sessionId: session.id,
        state: "connected",
        cwd: session.state.cwd,
        createdAt: 5,
        sessionNum: 42,
        backendType: "codex",
        isOrchestrator: true,
        isAssistant: false,
        herdedBy: "leader-1",
        reviewerOf: 7,
        lastActivityAt: 40,
        lastUserMessageAt: 999,
        killedByIdleManager: true,
      }),
      getSessionName: () => "Projection worker",
      getPendingTimerCount: () => 2,
      getBackendConnected: () => true,
      getSessionStatus: () => "running",
      getLastActivityAt: () => 40,
      // The projection deliberately uses the history-derived human timestamp,
      // not potentially polluted legacy launcher metadata.
      getLastUserMessageAt: () => 20,
      getLastMessagePreviewAt: () => 30,
      authorizeSubscription: () => true,
    });

    expect(value).toMatchObject({
      identity: {
        name: "Projection worker",
        model: "gpt-5.6",
        cwd: "/repo/worktree",
        backendType: "codex",
        permissionMode: "codex-default",
        askPermission: true,
        sessionNum: 42,
        createdAt: 5,
      },
      topology: {
        treeGroupId: "project",
        memorySessionSpaceSlug: "Takode",
        repoRoot: "/repo",
        isWorktree: true,
        isContainerized: false,
        isAssistant: false,
        isOrchestrator: true,
        herdedBy: "leader-1",
        reviewerOf: 7,
        cronJobId: "cron-1",
        cronJobName: "Nightly",
      },
      lifecycle: {
        sdkState: "running",
        status: "running",
        cliConnected: true,
        idleKilled: true,
        pendingPermissionCount: 1,
        pendingTimerCount: 2,
        paused: true,
        pausedInputQueueCount: 1,
        lastActivityAt: 40,
        lastUserMessageAt: 20,
        lastMessagePreviewAt: 30,
      },
      quest: {
        claimedQuestId: "q-1",
        claimedQuestTitle: "Migrate navigation",
        claimedQuestStatus: "in_progress",
        claimedQuestVerificationInboxUnread: false,
        claimedQuestLeaderSessionId: "leader-1",
      },
      git: {
        branch: "worker",
        defaultBranch: "origin/main",
        diffBaseBranch: "main",
        ahead: 2,
        behind: 1,
        linesAdded: 12,
        linesRemoved: 3,
      },
      detail: {
        lastMessagePreview: "Inspect the synchronized navigation projection",
        userTurnCount: 4,
        agentTurnCount: 3,
        contextUsedPercent: 25,
        contextTokensUsed: 100_000,
        modelContextWindow: 400_000,
        configuredContextWindow: 500_000,
        effectiveContextWindow: 350_000,
        messageHistoryBytes: 1_024,
        codexRetainedPayloadBytes: 2_048,
        codexReasoningEffort: "high",
        codexEffectiveReasoningEffort: "medium",
        codexEffectiveReasoningEffortReported: true,
      },
    });
    expect(isSessionNavigationProjectionValue(value)).toBe(true);
  });

  it("preserves explicit ask-permission authority before falling back to the selected mode", () => {
    const session = makeSession();
    session.state.askPermission = false;
    const launcherInfo: SdkSessionInfo = {
      sessionId: session.id,
      state: "connected" as const,
      cwd: session.state.cwd,
      createdAt: 5,
      backendType: "codex" as const,
      askPermission: true,
    };
    const deps = {
      getSession: () => session,
      getLauncherSessionInfo: () => launcherInfo,
      getSessionName: () => undefined,
      getPendingTimerCount: () => 0,
      getBackendConnected: () => true,
      getSessionStatus: () => "idle" as const,
      getLastActivityAt: () => undefined,
      getLastUserMessageAt: () => undefined,
      getLastMessagePreviewAt: () => undefined,
      authorizeSubscription: () => true,
    };

    expect(buildSessionNavigationProjectionValue(session, deps).identity.askPermission).toBe(false);

    delete session.state.askPermission;
    launcherInfo.askPermission = false;
    expect(buildSessionNavigationProjectionValue(session, deps).identity.askPermission).toBe(false);

    delete launcherInfo.askPermission;
    session.state.permissionMode = "codex-full-access";
    expect(buildSessionNavigationProjectionValue(session, deps).identity.askPermission).toBe(false);
  });

  it("uses the recycle budget only for Codex leaders that are actually in recycle mode", () => {
    // A compact-mode leader can retain an older recycle threshold in persisted
    // metadata. That stale value must not replace the provider runtime window.
    const session = makeSession();
    session.state.codex_leader_compaction_mode = "compact";
    const launcherInfo: SdkSessionInfo = {
      sessionId: session.id,
      state: "connected",
      cwd: session.state.cwd,
      createdAt: 5,
      backendType: "codex",
      isOrchestrator: true,
      codexLeaderCompactionMode: "compact",
      codexLeaderRecycleThresholdTokens: 350_000,
    };
    const deps = {
      getSession: () => session,
      getLauncherSessionInfo: () => launcherInfo,
      getSessionName: () => undefined,
      getPendingTimerCount: () => 0,
      getBackendConnected: () => true,
      getSessionStatus: () => "idle" as const,
      getLastActivityAt: () => undefined,
      getLastUserMessageAt: () => undefined,
      getLastMessagePreviewAt: () => undefined,
      authorizeSubscription: () => true,
    };

    expect(buildSessionNavigationProjectionValue(session, deps).detail.effectiveContextWindow).toBe(400_000);

    session.state.codex_leader_compaction_mode = "recycle";
    launcherInfo.codexLeaderCompactionMode = "recycle";
    expect(buildSessionNavigationProjectionValue(session, deps).detail.effectiveContextWindow).toBe(350_000);

    session.state.isOrchestrator = false;
    launcherInfo.isOrchestrator = false;
    expect(buildSessionNavigationProjectionValue(session, deps).detail.effectiveContextWindow).toBe(400_000);
  });

  it("truncates text/path inputs and normalizes invalid numeric sources", () => {
    const session = makeSession();
    session.state.model = "m".repeat(2_000);
    session.state.cwd = "/".repeat(6_000);
    session.state.git_ahead = -2;
    session.state.context_used_percent = Number.NaN;
    session.lastUserMessage = "p".repeat(200);
    const value = buildSessionNavigationProjectionValue(session, {
      getSession: () => session,
      getLauncherSessionInfo: () => undefined,
      getSessionName: () => "n".repeat(2_000),
      getPendingTimerCount: () => -3,
      getBackendConnected: () => false,
      getSessionStatus: () => null,
      getLastActivityAt: () => undefined,
      getLastUserMessageAt: () => undefined,
      getLastMessagePreviewAt: () => Number.NaN,
      authorizeSubscription: () => true,
    });

    expect(value.identity.name).toHaveLength(1_024);
    expect(value.identity.model).toHaveLength(1_024);
    expect(value.identity.cwd).toHaveLength(4_096);
    expect(value.detail.lastMessagePreview).toHaveLength(80);
    expect(value.git.ahead).toBe(0);
    expect(value.lifecycle.pendingTimerCount).toBe(0);
    expect(value.lifecycle.lastMessagePreviewAt).toBeNull();
    expect(value.detail.contextUsedPercent).toBe(0);
    expect(isSessionNavigationProjectionValue(value)).toBe(true);
  });
});
