import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEnrichedSessionsSnapshot } from "./session-list-snapshot.js";
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

describe("buildEnrichedSessionsSnapshot", () => {
  beforeEach(() => {
    _resetForTest(join(tmpdir(), `takode-session-list-snapshot-${randomUUID()}.json`));
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
