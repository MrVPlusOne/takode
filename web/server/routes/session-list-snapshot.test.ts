import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetScheduledWorktreeGitStateRefreshesForTest,
  buildEnrichedSessionsSnapshot,
} from "./session-list-snapshot.js";
import { _resetForTest, updateSettings } from "../settings-manager.js";

function makeLauncherSession(overrides: Record<string, unknown> = {}): any {
  return {
    sessionId: "s1",
    name: "Session 1",
    cwd: "/tmp/project",
    createdAt: 100,
    state: "idle",
    model: "default",
    backendType: "claude",
    archived: false,
    isWorktree: false,
    lastUserMessageAt: 900,
    ...overrides,
  };
}

function makeBridgeSession(messageHistory: unknown[]) {
  return {
    id: "s1",
    state: {},
    messageHistory,
    pendingPermissions: new Map(),
    notifications: [],
    lastReadAt: 0,
    attentionReason: null,
    isGenerating: false,
    lastUserMessage: "",
    taskHistory: [],
    keywords: [],
  };
}

function makeDeps(launcherSession: ReturnType<typeof makeLauncherSession>, bridgeSession: unknown) {
  return {
    launcher: {
      listSessions: vi.fn(() => [launcherSession]),
      getSession: vi.fn(() => launcherSession),
      getSessionNum: vi.fn(() => 1),
      setWorktreeCleanupState: vi.fn(),
      setLeaderProfilePortraitId: vi.fn((sessionId: string, portraitId: string) => {
        if (sessionId === launcherSession.sessionId) launcherSession.leaderProfilePortraitId = portraitId;
        return true;
      }),
    },
    wsBridge: {
      getSession: vi.fn(() => bridgeSession),
      isBackendConnected: vi.fn(() => false),
      refreshWorktreeGitStateForSnapshot: vi.fn(),
    },
    pendingWorktreeCleanups: new Map(),
  } as never;
}

async function runPendingBackgroundRefreshTimers(): Promise<void> {
  vi.runOnlyPendingTimers();
  await Promise.resolve();
}

describe("buildEnrichedSessionsSnapshot", () => {
  beforeEach(() => {
    _resetForTest(join(tmpdir(), `takode-session-list-snapshot-${randomUUID()}.json`));
    _resetScheduledWorktreeGitStateRefreshesForTest();
  });

  afterEach(() => {
    _resetScheduledWorktreeGitStateRefreshesForTest();
    vi.useRealTimers();
  });

  it("returns cached worktree git metadata immediately and schedules background refresh", async () => {
    vi.useFakeTimers();
    const launcherSession = makeLauncherSession({ isWorktree: true });
    const bridgeSession = {
      ...makeBridgeSession([]),
      state: {
        session_id: "s1",
        is_worktree: true,
        git_branch: "jiayi-wt-1",
        git_ahead: 2,
        git_behind: 0,
        total_lines_added: 777,
        total_lines_removed: 55,
      },
    };
    const deps = makeDeps(launcherSession, bridgeSession);
    (deps as any).wsBridge.refreshWorktreeGitStateForSnapshot.mockImplementation(async () => {
      bridgeSession.state.total_lines_added = 0;
      bridgeSession.state.total_lines_removed = 0;
      return bridgeSession.state;
    });

    const snapshot = await buildEnrichedSessionsSnapshot(deps);

    expect(snapshot[0]).toMatchObject({
      sessionId: "s1",
      gitAhead: 2,
      totalLinesAdded: 777,
      totalLinesRemoved: 55,
    });
    expect((deps as any).wsBridge.refreshWorktreeGitStateForSnapshot).not.toHaveBeenCalled();

    await runPendingBackgroundRefreshTimers();

    expect((deps as any).wsBridge.refreshWorktreeGitStateForSnapshot).toHaveBeenCalledWith("s1", {
      broadcastUpdate: true,
      notifyPoller: true,
    });
  });

  it("coalesces duplicate background refresh scheduling before the timer runs", async () => {
    vi.useFakeTimers();
    const launcherSession = makeLauncherSession({ isWorktree: true });
    const bridgeSession = {
      ...makeBridgeSession([]),
      state: {
        session_id: "s1",
        is_worktree: true,
        git_branch: "jiayi-wt-1",
      },
    };
    const deps = makeDeps(launcherSession, bridgeSession);

    await buildEnrichedSessionsSnapshot(deps);
    await buildEnrichedSessionsSnapshot(deps);
    await runPendingBackgroundRefreshTimers();

    expect((deps as any).wsBridge.refreshWorktreeGitStateForSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does not schedule list-driven background git refresh in heavy repo mode", async () => {
    vi.useFakeTimers();
    updateSettings({ heavyRepoModeEnabled: true });
    const launcherSession = makeLauncherSession({ isWorktree: true });
    const bridgeSession = {
      ...makeBridgeSession([]),
      state: {
        session_id: "s1",
        is_worktree: true,
        git_branch: "jiayi-wt-1",
        total_lines_added: 777,
        total_lines_removed: 55,
      },
    };
    const deps = makeDeps(launcherSession, bridgeSession);

    const snapshot = await buildEnrichedSessionsSnapshot(deps);
    await runPendingBackgroundRefreshTimers();

    expect(snapshot[0]).toMatchObject({
      sessionId: "s1",
      totalLinesAdded: 777,
      totalLinesRemoved: 55,
    });
    expect((deps as any).wsBridge.refreshWorktreeGitStateForSnapshot).not.toHaveBeenCalled();
  });

  it("derives lastUserMessageAt from human message history when bridge history is available", async () => {
    const launcherSession = makeLauncherSession({ lastUserMessageAt: 900 });
    const bridgeSession = makeBridgeSession([
      { type: "user_message", timestamp: 200, content: "Human request" },
      {
        type: "user_message",
        timestamp: 900,
        content: "Leader injection",
        agentSource: { sessionId: "leader-1", sessionLabel: "#1 Leader" },
      },
    ]);

    const snapshot = await buildEnrichedSessionsSnapshot(makeDeps(launcherSession, bridgeSession));

    expect(snapshot[0].lastUserMessageAt).toBe(200);
  });

  it("clears polluted lastUserMessageAt when bridge history has no human user messages", async () => {
    const launcherSession = makeLauncherSession({ lastUserMessageAt: 900 });
    const bridgeSession = makeBridgeSession([
      {
        type: "user_message",
        timestamp: 900,
        content: "Timer injection",
        agentSource: { sessionId: "timer", sessionLabel: "Timer" },
      },
      { type: "assistant", timestamp: 950, content: "Assistant work" },
    ]);

    const snapshot = await buildEnrichedSessionsSnapshot(makeDeps(launcherSession, bridgeSession));

    expect(snapshot[0].lastUserMessageAt).toBeUndefined();
  });

  it("exposes backend-owned real user turn counts instead of bridge CLI num_turns", async () => {
    // Sidebar and hover metadata must use server history because Codex may keep
    // bridge state at num_turns: 1 even after many completed turns.
    const launcherSession = makeLauncherSession({ backendType: "codex" });
    const bridgeSession = makeBridgeSession([
      { type: "user_message", timestamp: 100, content: "First human request" },
      { type: "assistant", parent_tool_use_id: null, message: { content: [] } },
      { type: "result", data: { num_turns: 1 } },
      {
        type: "user_message",
        timestamp: 200,
        content: "Timer injection",
        agentSource: { sessionId: "timer", sessionLabel: "Timer" },
      },
      { type: "user_message", timestamp: 300, content: "Second human request" },
      { type: "assistant", parent_tool_use_id: null, message: { content: [] } },
      { type: "result", data: { num_turns: 1 } },
    ]);
    bridgeSession.state = { num_turns: 1 };

    const snapshot = await buildEnrichedSessionsSnapshot(makeDeps(launcherSession, bridgeSession));

    expect(snapshot[0]).toMatchObject({
      numTurns: 2,
      userTurnCount: 2,
      agentTurnCount: 2,
    });
    expect(bridgeSession.state).toMatchObject({
      num_turns: 2,
      user_turn_count: 2,
      agent_turn_count: 2,
    });
  });

  it("exposes the resolved Codex leader recycle threshold for session info display", async () => {
    updateSettings({
      codexLeaderRecycleThresholdTokens: 260_000,
      codexLeaderRecycleThresholdTokensByModel: { "gpt-5.5": 430_000 },
    });
    const launcherSession = makeLauncherSession({
      backendType: "codex",
      isOrchestrator: true,
      model: "gpt-5.4",
    });
    const bridgeSession = {
      ...makeBridgeSession([]),
      state: { model: "gpt-5.5" },
    };

    const snapshot = await buildEnrichedSessionsSnapshot(makeDeps(launcherSession, bridgeSession));

    expect(snapshot[0]).toMatchObject({
      model: "gpt-5.5",
      codexLeaderRecycleThresholdTokens: 430_000,
    });
  });

  it("does not expose the Codex leader recycle threshold for control sessions", async () => {
    updateSettings({ codexLeaderRecycleThresholdTokens: 260_000 });
    const launcherSession = makeLauncherSession({
      backendType: "codex",
      isOrchestrator: false,
      model: "gpt-5.5",
    });

    const snapshot = await buildEnrichedSessionsSnapshot(makeDeps(launcherSession, makeBridgeSession([])));

    expect(snapshot[0]).not.toHaveProperty("codexLeaderRecycleThresholdTokens");
  });

  it("lazily backfills active leader profile portraits with a stable persisted assignment", async () => {
    const launcherSession = makeLauncherSession({ isOrchestrator: true });
    const deps = makeDeps(launcherSession, makeBridgeSession([]));

    const first = await buildEnrichedSessionsSnapshot(deps);
    const second = await buildEnrichedSessionsSnapshot(deps);
    const firstRow = first[0] as any;
    const secondRow = second[0] as any;

    expect(firstRow.leaderProfilePortrait?.poolId).toMatch(/^(tako|shmi)$/);
    expect(firstRow.leaderProfilePortraitId).toBe(firstRow.leaderProfilePortrait?.id);
    expect(secondRow.leaderProfilePortraitId).toBe(firstRow.leaderProfilePortraitId);
    expect((deps as any).launcher.setLeaderProfilePortraitId).toHaveBeenCalledTimes(1);
  });

  it("preserves assigned leader portraits even when their pool is disabled", async () => {
    updateSettings({ leaderProfilePools: { tako: false, shmi: true } });
    const launcherSession = makeLauncherSession({ isOrchestrator: true, leaderProfilePortraitId: "tako1-01" });

    const snapshot = await buildEnrichedSessionsSnapshot(makeDeps(launcherSession, makeBridgeSession([])));

    expect((snapshot[0] as any).leaderProfilePortrait).toMatchObject({ id: "tako1-01", poolId: "tako" });
  });

  it("normalizes obsolete sheet-level portrait ids in active leader snapshots", async () => {
    const launcherSession = makeLauncherSession({ isOrchestrator: true, leaderProfilePortraitId: "shmi3" });
    const deps = makeDeps(launcherSession, makeBridgeSession([]));

    const snapshot = await buildEnrichedSessionsSnapshot(deps);

    expect(snapshot[0].leaderProfilePortraitId).toBe("shmi3-01");
    expect((snapshot[0] as any).leaderProfilePortrait).toMatchObject({ id: "shmi3-01", poolId: "shmi" });
    expect((deps as any).launcher.setLeaderProfilePortraitId).toHaveBeenCalledWith(
      launcherSession.sessionId,
      "shmi3-01",
    );
  });

  it("uses the fallback portrait for unassigned leaders when all pools are disabled", async () => {
    updateSettings({ leaderProfilePools: { tako: false, shmi: false } });
    const launcherSession = makeLauncherSession({ isOrchestrator: true });
    const deps = makeDeps(launcherSession, makeBridgeSession([]));

    const snapshot = await buildEnrichedSessionsSnapshot(deps);

    expect((snapshot[0] as any).leaderProfilePortrait).toMatchObject({ id: "leader-fallback", poolId: "fallback" });
    expect((deps as any).launcher.setLeaderProfilePortraitId).not.toHaveBeenCalled();
  });

  it("does not expose portrait URLs for archived leaders in list snapshots", async () => {
    const launcherSession = makeLauncherSession({
      archived: true,
      isOrchestrator: true,
      leaderProfilePortraitId: "tako1-01",
    });

    const snapshot = await buildEnrichedSessionsSnapshot(makeDeps(launcherSession, makeBridgeSession([])));

    expect(snapshot[0].leaderProfilePortraitId).toBe("tako1-01");
    expect((snapshot[0] as any).leaderProfilePortrait).toBeUndefined();
  });

  it("includes claimed quest review metadata for idle sidebar session rows", async () => {
    const launcherSession = makeLauncherSession();
    const bridgeSession = {
      ...makeBridgeSession([]),
      state: {
        claimedQuestId: "q-1207",
        claimedQuestTitle: "Hide thread-detail hints inside collapsed agent turns",
        claimedQuestStatus: "done",
        claimedQuestVerificationInboxUnread: true,
      },
    };

    const snapshot = await buildEnrichedSessionsSnapshot(makeDeps(launcherSession, bridgeSession));

    expect(snapshot[0]).toMatchObject({
      claimedQuestId: "q-1207",
      claimedQuestTitle: "Hide thread-detail hints inside collapsed agent turns",
      claimedQuestStatus: "done",
      claimedQuestVerificationInboxUnread: true,
    });
  });
});
