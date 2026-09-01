import { vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
const mockShouldSettingsRuleApprove = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));
vi.mock("node:crypto", () => ({ randomUUID: () => "test-uuid" }));
// Mock settings rule loading so real user ~/.claude/settings.json rules don't
// interfere with tests. Tests that need specific rules override this per-call.
vi.mock("./bridge/settings-rule-matcher.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./bridge/settings-rule-matcher.js")>();
  return {
    ...original,
    shouldSettingsRuleApprove: mockShouldSettingsRuleApprove,
  };
});

import { WsBridge, type SocketData } from "./ws-bridge.js";
import { subscribeCurrentBrowser } from "./ws-bridge-current-browser-test-helpers.js";
import { SessionStore } from "./session-store.js";
import { HerdEventDispatcher, isSessionIdleRuntime, renderHerdEventBatch } from "./herd-event-dispatcher.js";
import {
  advanceBoardRow as advanceBoardRowController,
  advanceBoardRowNoGroom as advanceBoardRowNoGroomController,
  getBoard as getBoardController,
  getCompletedBoard as getCompletedBoardController,
  removeBoardRows as removeBoardRowsController,
  upsertBoardRow as upsertBoardRowController,
} from "./bridge/board-watchdog-controller.js";
import {
  cleanupBranchState as cleanupBranchStateIndex,
  updateBranchIndex as updateBranchIndexState,
} from "./bridge/branch-session-index.js";
import { routeBrowserMessage as routeBrowserMessageController } from "./bridge/adapter-browser-routing-controller.js";
import {
  getVsCodeSelectionState as getVsCodeSelectionStateController,
  getVsCodeWindowStates as getVsCodeWindowStatesController,
  pollVsCodeOpenFileCommands as pollVsCodeOpenFileCommandsController,
  requestVsCodeOpenFile as requestVsCodeOpenFileController,
  resolveVsCodeOpenFileResult as resolveVsCodeOpenFileResultController,
  updateVsCodeSelectionState as updateVsCodeSelectionStateController,
  upsertVsCodeWindowState as upsertVsCodeWindowStateController,
} from "./bridge/browser-transport-controller.js";
import {
  refreshGitInfoPublic as refreshGitInfoPublicController,
  setDiffBaseBranch as setDiffBaseBranchController,
} from "./bridge/session-git-state.js";
import { trafficStats } from "./traffic-stats.js";
import {
  applyInitialSessionState as applyInitialSessionStateController,
  addTaskEntry as addTaskEntryController,
  clearAttentionAndMarkRead as clearAttentionAndMarkReadController,
  getHerdDiagnostics as getHerdDiagnosticsController,
  markNotificationDone as markNotificationDoneController,
  notifyUser as notifyUserController,
  setSessionClaimedQuest as setSessionClaimedQuestController,
} from "./bridge/session-registry-controller.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

function createMockSocket(data: SocketData) {
  return {
    data,
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  } as any;
}

function makeCliSocket(sessionId: string) {
  return createMockSocket({ kind: "cli", sessionId });
}

function makeBrowserSocket(sessionId: string) {
  return createMockSocket({ kind: "browser", sessionId });
}

/** Flush queued ingress, bounded-sync yields, and deferred traffic-stat microtasks. */
async function flushAsync() {
  for (let pass = 0; pass < 3; pass++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function makeCodexAdapterMock() {
  let onBrowserMessageCb: ((msg: any) => void) | undefined;
  let onSessionMetaCb: ((meta: any) => void) | undefined;
  let onDisconnectCb: (() => void) | undefined;
  let onInitErrorCb: ((error: string) => void) | undefined;
  let onTurnStartFailedCb: ((msg: any) => void) | undefined;
  let onTurnStartedCb: ((turnId: string) => void) | undefined;
  let onTurnSteeredCb: ((turnId: string, pendingInputIds: string[]) => void) | undefined;
  let onTurnSteerFailedCb: ((pendingInputIds: string[]) => void) | undefined;
  let currentTurnId: string | null = null;
  const rollbackTurns = vi.fn(async (_numTurns: number) => {});

  return {
    onBrowserMessage: vi.fn((cb: (msg: any) => void) => {
      onBrowserMessageCb = cb;
    }),
    onSessionMeta: vi.fn((cb: (meta: any) => void) => {
      onSessionMetaCb = cb;
    }),
    onDisconnect: vi.fn((cb: () => void) => {
      onDisconnectCb = cb;
    }),
    onInitError: vi.fn((cb: (error: string) => void) => {
      onInitErrorCb = cb;
    }),
    onTurnStartFailed: vi.fn((cb: (msg: any) => void) => {
      onTurnStartFailedCb = cb;
    }),
    onTurnStarted: vi.fn((cb: (turnId: string) => void) => {
      onTurnStartedCb = cb;
    }),
    onTurnSteered: vi.fn((cb: (turnId: string, pendingInputIds: string[]) => void) => {
      onTurnSteeredCb = cb;
    }),
    onTurnSteerFailed: vi.fn((cb: (pendingInputIds: string[]) => void) => {
      onTurnSteerFailedCb = cb;
    }),
    sendBrowserMessage: vi.fn((_msg?: any) => true),
    rollbackTurns,
    isConnected: vi.fn(() => true),
    disconnect: vi.fn(async () => {}),
    getThreadId: vi.fn(() => "thread-ready"),
    getCurrentTurnId: vi.fn(() => currentTurnId),
    emitBrowserMessage: (msg: any) => onBrowserMessageCb?.(msg),
    emitSessionMeta: (meta: any) => {
      const resumed = meta?.resumeSnapshot;
      currentTurnId =
        resumed?.threadStatus !== "idle" && resumed?.lastTurn?.status === "inProgress" ? resumed.lastTurn.id : null;
      onSessionMetaCb?.(meta);
    },
    emitDisconnect: (turnId?: string | null) => {
      currentTurnId = turnId === undefined ? currentTurnId : turnId;
      onDisconnectCb?.();
    },
    emitInitError: (error: string) => onInitErrorCb?.(error),
    emitTurnStartFailed: (msg: any) => onTurnStartFailedCb?.(msg),
    emitTurnStarted: (turnId: string) => {
      currentTurnId = turnId;
      onTurnStartedCb?.(turnId);
    },
    emitTurnSteered: (turnId: string, pendingInputIds: string[]) => {
      onTurnSteeredCb?.(turnId, pendingInputIds);
    },
    emitTurnSteerFailed: (pendingInputIds: string[]) => {
      onTurnSteerFailedCb?.(pendingInputIds);
    },
  };
}

function emitCodexSessionReady(
  adapter: ReturnType<typeof makeCodexAdapterMock>,
  overrides: Record<string, unknown> = {},
) {
  adapter.emitSessionMeta({
    cliSessionId: "thread-ready",
    model: "gpt-5.3-codex",
    cwd: "/repo",
    ...overrides,
  });
}

function getPendingCodexTurn(session: { pendingCodexTurns?: unknown[] }) {
  return (session.pendingCodexTurns?.[0] ?? null) as any;
}

function seedAutoPause(session: any, heldId: string) {
  session.state.codex_result_error_auto_pause = {
    family: "copilot_auth_refresh_exhausted",
    fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
    streak: 1,
    threshold: 1,
    pausedAt: 123,
    lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
    lastErrorAt: 123,
    lastSourceKind: "automatic",
    totalMatchingErrors: 1,
    heldInputs: [
      {
        id: heldId,
        queuedAt: 124,
        lastQueuedAt: 124,
        source: "programmatic",
        count: 1,
        message: { type: "user_message", content: "held event", agentSource: { sessionId: "herd-events" } },
      },
    ],
  };
}

function getCodexStartPendingInputs(msg: any) {
  expect(msg?.type).toBe("codex_start_pending");
  expect(Array.isArray(msg?.inputs)).toBe(true);
  return msg.inputs as Array<{ content: string }>;
}

function getNotificationTestDeps(bridge: WsBridge) {
  return {
    isHerdedWorkerSession: (session: any) => !!(bridge as any).launcher?.getSession(session.id)?.herdedBy,
    broadcastToBrowsers: (session: any, msg: any) => bridge.broadcastToSession(session.id, msg),
    persistSession: (session: any) => bridge.persistSessionById(session.id),
    emitTakodeEvent: (sessionId: string, type: string, data: Record<string, unknown>) =>
      bridge.emitTakodeEvent(sessionId, type as any, data as any),
    scheduleNotification: () => undefined,
  };
}

function applyClaimedQuest(
  bridge: WsBridge,
  sessionId: string,
  quest: { id: string; title: string; status?: string } | null,
) {
  const session = bridge.getSession(sessionId);
  if (!session) return;
  setSessionClaimedQuestController(session, quest, {
    broadcastToBrowsers: (_session: any, msg: any) => bridge.broadcastToSession(sessionId, msg),
    persistSession: () => bridge.persistSessionById(sessionId),
    getLauncherSessionInfo: (targetSessionId: string) => (bridge as any).launcher?.getSession?.(targetSessionId),
    onSessionNamedByQuest: (targetSessionId: string, title: string) =>
      (bridge as any).onSessionNamedByQuest?.(targetSessionId, title),
  });
}

type TestBridge = WsBridge & {
  setStore(store: SessionStore): void;
  setRecorder(recorder: any): void;
  setTimerManager(timerManager: any): void;
  setImageStore(imageStore: any): void;
  setPushoverNotifier(notifier: any): void;
  setLauncher(launcher: any): void;
  setHerdEventDispatcher(dispatcher: any): void;
  onCLIRelaunchNeededCallback(cb: (sessionId: string) => void): void;
  onPermissionModeChangedCallback(cb: (sessionId: string, newMode: string) => void): void;
  onSessionRelaunchRequestedCallback(cb: (sessionId: string) => void): void;
  onUserMessageCallback(cb: any): void;
  onTurnCompletedCallback(cb: any): void;
  onAgentPausedCallback(cb: any): void;
  applyInitialSessionState(sessionId: string, options: any): void;
  markWorktree(
    sessionId: string,
    repoRoot: string,
    worktreeCwd: string,
    defaultBranch?: string,
    diffBaseBranch?: string,
  ): void;
  getTrafficStatsSnapshot(): any;
  resetTrafficStats(): void;
  setDiffBaseBranch(sessionId: string, branch: string): boolean;
  refreshGitInfoPublic(
    sessionId: string,
    options?: { broadcastUpdate?: boolean; notifyPoller?: boolean; force?: boolean },
  ): Promise<boolean>;
  onSessionArchived(sessionId: string): void;
  onSessionUnarchived(sessionId: string): void;
  getBoard(sessionId: string): any[];
  upsertBoardRow(sessionId: string, row: any): any[] | null;
  removeBoardRows(sessionId: string, questIds: string[]): any[] | null;
  advanceBoardRow(sessionId: string, questId: string): any;
  advanceBoardRowNoGroom(sessionId: string, questId: string): any;
  getCompletedBoard(sessionId: string): any[];
  getCompletedBoardCount(sessionId: string): number;
  getVsCodeSelectionState(): any;
  updateVsCodeSelectionState(nextState: any): boolean;
  getVsCodeWindowStates(): any[];
  upsertVsCodeWindowState(nextState: any): any;
  pollVsCodeOpenFileCommands(sourceId: string, limit?: number): any[];
  resolveVsCodeOpenFileResult(sourceId: string, commandId: string, result: { ok: boolean; error?: string }): boolean;
  requestVsCodeOpenFile(
    target: any,
    options?: { timeoutMs?: number },
  ): Promise<{ sourceId: string; commandId: string }>;
};

function attachBoardFacade(bridge: WsBridge): TestBridge {
  const anyBridge = bridge as any;
  anyBridge.setStore = (store: SessionStore) => {
    bridge.store = store;
  };
  anyBridge.setRecorder = (recorder: any) => {
    bridge.recorder = recorder;
  };
  anyBridge.setTimerManager = (timerManager: any) => {
    bridge.timerManager = timerManager;
  };
  anyBridge.setImageStore = (imageStore: any) => {
    bridge.imageStore = imageStore;
  };
  anyBridge.setPushoverNotifier = (notifier: any) => {
    bridge.pushoverNotifier = notifier;
  };
  anyBridge.setLauncher = (launcher: any) => {
    bridge.launcher = launcher;
  };
  anyBridge.setHerdEventDispatcher = (dispatcher: any) => {
    bridge.herdEventDispatcher = dispatcher;
  };
  anyBridge.onCLIRelaunchNeededCallback = (cb: (sessionId: string) => void) => {
    bridge.onCLIRelaunchNeeded = cb;
  };
  anyBridge.onPermissionModeChangedCallback = (cb: (sessionId: string, newMode: string) => void) => {
    bridge.onPermissionModeChanged = cb;
  };
  anyBridge.onSessionRelaunchRequestedCallback = (cb: (sessionId: string) => void) => {
    bridge.onSessionRelaunchRequested = cb;
  };
  anyBridge.onUserMessageCallback = (cb: any) => {
    bridge.onUserMessage = cb;
  };
  anyBridge.onTurnCompletedCallback = (cb: any) => {
    bridge.onTurnCompleted = cb;
  };
  anyBridge.onAgentPausedCallback = (cb: any) => {
    bridge.onAgentPaused = cb;
  };
  bridge.herdEventDispatcher = new HerdEventDispatcher(
    {
      subscribeTakodeEvents: () => () => {},
      injectUserMessage: () => "no_session",
      getSession: (sessionId: string) => bridge.getSession(sessionId) as any,
    },
    {
      getHerdedSessions: (orchId: string) => bridge.launcher?.getHerdedSessions?.(orchId) ?? [],
      getSession: (sessionId: string) => bridge.launcher?.getSession?.(sessionId),
    },
    {
      requestCliRelaunch: (sessionId: string) => bridge.onCLIRelaunchNeeded?.(sessionId),
      getSessionNum: (sessionId: string) => bridge.launcher?.getSessionNum?.(sessionId),
      getSessionName: (sessionId: string) => bridge.sessionNameGetter?.(sessionId),
      getSessions: () => anyBridge.sessions,
      getLeaderIdleDeps: () => anyBridge.getSessionRegistryDeps(),
    },
  );
  anyBridge.applyInitialSessionState = (sessionId: string, options: any) => {
    const session = bridge.getOrCreateSession(sessionId);
    applyInitialSessionStateController(session as any, options, {
      persistSession: (targetSession) => bridge.persistSessionById((targetSession as any).id),
      prefillSlashCommands: (targetSession) => anyBridge.prefillSlashCommands.call(anyBridge, targetSession),
    });
  };
  anyBridge.markWorktree = (
    sessionId: string,
    repoRoot: string,
    worktreeCwd: string,
    defaultBranch?: string,
    diffBaseBranch?: string,
  ) => {
    anyBridge.applyInitialSessionState(sessionId, {
      cwd: worktreeCwd,
      worktree: { repoRoot, defaultBranch, diffBaseBranch },
    });
  };
  anyBridge.getTrafficStatsSnapshot = () => trafficStats.snapshot();
  anyBridge.resetTrafficStats = () => {
    trafficStats.reset();
  };
  anyBridge.setDiffBaseBranch = (sessionId: string, branch: string) => {
    const session = bridge.getSession(sessionId);
    if (!session) return false;
    setDiffBaseBranchController(session as any, branch, anyBridge.getSessionGitStateDeps());
    return true;
  };
  anyBridge.refreshGitInfoPublic = async (
    sessionId: string,
    options: { broadcastUpdate?: boolean; notifyPoller?: boolean; force?: boolean } = {},
  ) => {
    const session = bridge.getSession(sessionId);
    if (!session) return false;
    await refreshGitInfoPublicController(session as any, anyBridge.getSessionGitStateDeps(), options);
    return true;
  };
  anyBridge.onSessionArchived = (sessionId: string) => {
    cleanupBranchStateIndex(sessionId, {
      branchToSessions: anyBridge.branchToSessions,
      sessionBranches: anyBridge.sessionBranches,
      lastCrossSessionRefreshAt: anyBridge.lastCrossSessionRefreshAt,
    });
  };
  anyBridge.onSessionUnarchived = (sessionId: string) => {
    const session = bridge.getSession(sessionId);
    if (!session) return;
    updateBranchIndexState(session, {
      isArchived: bridge.launcher?.getSession(session.id)?.archived === true,
      branchToSessions: anyBridge.branchToSessions,
      sessionBranches: anyBridge.sessionBranches,
    });
  };
  const workBoardStateDeps = {
    getBoardDispatchableSignature: (session: any, questId: string) =>
      anyBridge.getBoardDispatchableSignature(session.id, questId),
    markNotificationDone: (sessionId: string, notifId: string, done: boolean) => {
      const session = bridge.getSession(sessionId);
      if (!session) return false;
      return markNotificationDoneController(session, notifId, done, {
        broadcastToBrowsers: (_session: any, msg: any) => bridge.broadcastToSession(sessionId, msg),
        persistSession: () => bridge.persistSessionById(sessionId),
      });
    },
    broadcastBoard: (session: any, board: unknown[], completedBoard: unknown[]) =>
      bridge.broadcastToSession(session.id, { type: "board_updated", board, completedBoard } as any),
    persistSession: (session: any) => bridge.persistSessionById(session.id),
    notifyReview: (sessionId: string, summary: string) => {
      const session = bridge.getSession(sessionId);
      if (session) notifyUserController(session, "review", summary, getNotificationTestDeps(bridge));
    },
  };
  anyBridge.getBoard = (sessionId: string) =>
    bridge.getSession(sessionId) ? getBoardController(bridge.getSession(sessionId)!) : [];
  anyBridge.upsertBoardRow = (sessionId: string, row: any) =>
    bridge.getSession(sessionId)
      ? upsertBoardRowController(bridge.getSession(sessionId)!, row, workBoardStateDeps)
      : null;
  anyBridge.removeBoardRows = (sessionId: string, questIds: string[]) =>
    bridge.getSession(sessionId)
      ? removeBoardRowsController(bridge.getSession(sessionId)!, questIds, workBoardStateDeps)
      : null;
  anyBridge.advanceBoardRow = (sessionId: string, questId: string) =>
    bridge.getSession(sessionId)
      ? advanceBoardRowController(
          bridge.getSession(sessionId)!,
          questId,
          [
            "QUEUED",
            "PLANNING",
            "EXPLORING",
            "IMPLEMENTING",
            "CODE_REVIEWING",
            "MENTAL_SIMULATING",
            "EXECUTING",
            "OUTCOME_REVIEWING",
            "BOOKKEEPING",
            "PORTING",
          ],
          workBoardStateDeps,
        )
      : null;
  anyBridge.advanceBoardRowNoGroom = (sessionId: string, questId: string) =>
    bridge.getSession(sessionId)
      ? advanceBoardRowNoGroomController(bridge.getSession(sessionId)!, questId, workBoardStateDeps)
      : null;
  anyBridge.getCompletedBoard = (sessionId: string) =>
    bridge.getSession(sessionId) ? getCompletedBoardController(bridge.getSession(sessionId)!) : [];
  anyBridge.getCompletedBoardCount = (sessionId: string) => bridge.getSession(sessionId)?.completedBoard.size ?? 0;
  anyBridge.getVsCodeSelectionState = () => getVsCodeSelectionStateController(anyBridge.browserTransportState);
  anyBridge.updateVsCodeSelectionState = (nextState: any) =>
    updateVsCodeSelectionStateController(
      anyBridge.browserTransportState,
      nextState,
      anyBridge.getBrowserTransportDeps(),
    );
  anyBridge.getVsCodeWindowStates = () =>
    getVsCodeWindowStatesController(anyBridge.browserTransportState, anyBridge.getBrowserTransportDeps());
  anyBridge.upsertVsCodeWindowState = (nextState: any) =>
    upsertVsCodeWindowStateController(anyBridge.browserTransportState, nextState);
  anyBridge.pollVsCodeOpenFileCommands = (sourceId: string, limit = 1) =>
    pollVsCodeOpenFileCommandsController(anyBridge.browserTransportState, sourceId, limit);
  anyBridge.resolveVsCodeOpenFileResult = (
    sourceId: string,
    commandId: string,
    result: { ok: boolean; error?: string },
  ) => resolveVsCodeOpenFileResultController(anyBridge.browserTransportState, sourceId, commandId, result);
  anyBridge.requestVsCodeOpenFile = (target: any, options?: { timeoutMs?: number }) =>
    requestVsCodeOpenFileController(
      anyBridge.browserTransportState,
      target,
      anyBridge.getBrowserTransportDeps(),
      options,
    );
  anyBridge.routeBrowserMessage = (session: any, msg: any, ws?: any) =>
    routeBrowserMessageController(session, msg, ws, anyBridge.getBrowserRoutingDeps());
  return bridge as TestBridge;
}

function expectCodexStartPendingTurnLike(
  turn: any,
  expected: {
    firstContent?: string;
    firstContentContaining?: string;
    forbidNativeImageTransport?: boolean;
    status?: string;
    dispatchCount?: number;
    userContent?: string;
    turnId?: string | null;
    turnTarget?: string | null;
  } = {},
) {
  expect(turn).toBeTruthy();
  expect(turn.adapterMsg?.type).toBe("codex_start_pending");
  const inputs = getCodexStartPendingInputs(turn.adapterMsg);
  expect(inputs.length).toBeGreaterThan(0);
  if (expected.firstContent !== undefined) {
    expect(inputs[0]?.content).toBe(expected.firstContent);
  }
  if (expected.firstContentContaining !== undefined) {
    expect(inputs[0]?.content).toContain(expected.firstContentContaining);
  }
  if (expected.forbidNativeImageTransport) {
    expect((inputs[0] as any)?.local_images).toBeUndefined();
  }
  if (expected.status !== undefined) {
    expect(turn.status).toBe(expected.status);
  }
  if (expected.dispatchCount !== undefined) {
    expect(turn.dispatchCount).toBe(expected.dispatchCount);
  }
  if (expected.userContent !== undefined) {
    expect(turn.userContent).toBe(expected.userContent);
  }
  if ("turnId" in expected) {
    expect(turn.turnId).toBe(expected.turnId);
  }
  if ("turnTarget" in expected) {
    expect(turn.turnTarget).toBe(expected.turnTarget);
  }
}

function makeClaudeSdkAdapterMock() {
  let onBrowserMessageCb: ((msg: any) => void) | undefined;
  let onSessionMetaCb: ((meta: any) => void) | undefined;
  let onDisconnectCb: (() => void) | undefined;
  let onInitErrorCb: ((error: string) => void) | undefined;
  let onCompactRequestedCb: (() => void) | undefined;

  return {
    onBrowserMessage: vi.fn((cb: (msg: any) => void) => {
      onBrowserMessageCb = cb;
    }),
    onSessionMeta: vi.fn((cb: (meta: any) => void) => {
      onSessionMetaCb = cb;
    }),
    onDisconnect: vi.fn((cb: () => void) => {
      onDisconnectCb = cb;
    }),
    onInitError: vi.fn((cb: (error: string) => void) => {
      onInitErrorCb = cb;
    }),
    onCompactRequested: vi.fn((cb: () => void) => {
      onCompactRequestedCb = cb;
    }),
    sendBrowserMessage: vi.fn(),
    drainPendingOutgoing: vi.fn((): any[] => []),
    isConnected: vi.fn(() => true),
    disconnect: vi.fn(async () => {}),
    emitBrowserMessage: (msg: any) => onBrowserMessageCb?.(msg),
    emitSessionMeta: (meta: any) => onSessionMetaCb?.(meta),
    emitDisconnect: () => onDisconnectCb?.(),
    emitInitError: (error: string) => onInitErrorCb?.(error),
    emitCompactRequested: () => onCompactRequestedCb?.(),
  };
}

let bridge: TestBridge;
let tempDir: string;
let store: SessionStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "bridge-test-"));
  store = new SessionStore(tempDir);
  bridge = attachBoardFacade(new WsBridge());
  bridge.setStore(store);
  bridge.resetTrafficStats();
  mockExecSync.mockReset();
  mockExec.mockReset();
  mockShouldSettingsRuleApprove.mockReset().mockResolvedValue(null);
  // Default: mockExec delegates to mockExecSync so tests that set up
  // mockExecSync automatically work for async computeDiffStatsAsync too.
  mockExec.mockImplementation((cmd: string, opts: any, cb?: Function) => {
    const callback = typeof opts === "function" ? opts : cb;
    try {
      const result = mockExecSync(cmd);
      if (callback) callback(null, { stdout: result ?? "", stderr: "" });
    } catch (err) {
      if (callback) callback(err, { stdout: "", stderr: "" });
    }
  });
});

// localDateKey is a private static — access via `any` cast for testing.
// ─── Helper: build a system.init NDJSON string ────────────────────────────────

function makeInitMsg(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "cli-123",
    model: "claude-sonnet-4-5-20250929",
    cwd: "/test",
    tools: ["Bash", "Read"],
    permissionMode: "default",
    claude_code_version: "1.0",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    output_style: "normal",
    uuid: "uuid-1",
    apiKeySource: "env",
    ...overrides,
  });
}

describe("Codex resumed-turn recovery", () => {
  it("projects a matching resumed in-progress recovery owner as active across reconnect", async () => {
    const sid = "s-resumed-auto-pause-active";
    const adapter1 = makeCodexAdapterMock();
    bridge.attachCodexAdapter(sid, adapter1 as any);
    emitCodexSessionReady(adapter1, { cliSessionId: "thread-resumed-active" });
    const session = bridge.getSession(sid)!;
    seedAutoPause(session, "held-resumed-active");
    const browser = makeBrowserSocket(sid);
    bridge.handleBrowserOpen(browser, sid);
    await subscribeCurrentBrowser(bridge, browser);

    await bridge.handleBrowserMessage(
      browser,
      JSON.stringify({ type: "user_message", content: "resume active recovery", inputSource: "composer" }),
    );
    expect(getPendingCodexTurn(session)).toMatchObject({ status: "dispatched", turnTarget: "current" });
    adapter1.emitDisconnect();

    const adapter2 = makeCodexAdapterMock();
    bridge.attachCodexAdapter(sid, adapter2 as any);
    browser.send.mockClear();
    adapter2.emitSessionMeta({
      cliSessionId: "thread-resumed-active",
      model: "gpt-5.3-codex",
      cwd: "/repo",
      resumeSnapshot: {
        threadId: "thread-resumed-active",
        turnCount: 1,
        threadStatus: "active",
        turns: [],
        lastTurn: {
          id: "turn-resumed-active",
          status: "inProgress",
          error: null,
          items: [
            { type: "userMessage", content: [{ type: "text", text: "resume active recovery" }] },
            { type: "commandExecution", id: "cmd-active", status: "in_progress", command: ["bun", "test"] },
          ],
        },
      },
    });
    await flushAsync();

    expect(getPendingCodexTurn(session)).toMatchObject({
      status: "backend_acknowledged",
      turnId: "turn-resumed-active",
      turnTarget: "current",
    });
    expect(session.state.codex_result_error_auto_pause?.heldInputs).toHaveLength(1);
    expect(session.messageHistory.some((entry) => entry.type === "codex_auto_pause_recovery_summary")).toBe(false);
    expect(browser.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw))).toContainEqual(
      expect.objectContaining({
        type: "session_update",
        session: expect.objectContaining({ codex_result_error_auto_pause_recovery_progress: "active" }),
      }),
    );

    const reconnect = makeBrowserSocket(sid);
    bridge.handleBrowserOpen(reconnect, sid);
    bridge.handleBrowserMessage(
      reconnect,
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        history_window_section_turn_count: 10,
        history_window_visible_section_count: 3,
      }),
    );
    await flushAsync();
    await vi.waitFor(
      () =>
        expect(reconnect.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw))).toContainEqual(
          expect.objectContaining({ type: "state_snapshot", codexAutoPauseRecoveryProgress: "active" }),
        ),
      { timeout: 5_000 },
    );
  });

  it("clears and drains once when resume proves the exact recovery owner completed", async () => {
    const sid = "s-resumed-auto-pause-completed";
    const adapter1 = makeCodexAdapterMock();
    bridge.attachCodexAdapter(sid, adapter1 as any);
    emitCodexSessionReady(adapter1, { cliSessionId: "thread-resumed-completed" });
    const session = bridge.getSession(sid)!;
    seedAutoPause(session, "held-resumed-completed");
    session.state.codex_result_error_auto_pause!.heldInputs = [];
    const browser = makeBrowserSocket(sid);
    bridge.handleBrowserOpen(browser, sid);
    await subscribeCurrentBrowser(bridge, browser);

    await bridge.handleBrowserMessage(
      browser,
      JSON.stringify({ type: "user_message", content: "resume completed recovery", inputSource: "composer" }),
    );
    session.pendingCodexInputs.push({
      id: "queued-auto-resume",
      content: "queued automatic during disconnect",
      timestamp: 130,
      cancelable: true,
      autoPauseSourceKind: "automatic",
      agentSource: { sessionId: "herd-events" },
    });
    session.pendingCodexTurns.push({
      adapterMsg: {
        type: "codex_start_pending",
        pendingInputIds: ["queued-auto-resume"],
        inputs: [{ content: "queued automatic during disconnect" }],
      },
      userMessageId: "queued-auto-resume",
      pendingInputIds: ["queued-auto-resume"],
      userContent: "queued automatic during disconnect",
      historyIndex: -1,
      status: "queued",
      dispatchCount: 0,
      createdAt: 130,
      updatedAt: 130,
      acknowledgedAt: null,
      turnTarget: "queued",
      lastError: null,
      turnId: null,
      disconnectedAt: null,
      resumeConfirmedAt: null,
      autoPauseSourceKind: "automatic",
    });
    adapter1.emitDisconnect();

    const adapter2 = makeCodexAdapterMock();
    bridge.attachCodexAdapter(sid, adapter2 as any);
    browser.send.mockClear();
    adapter2.emitSessionMeta({
      cliSessionId: "thread-resumed-completed",
      model: "gpt-5.3-codex",
      cwd: "/repo",
      resumeSnapshot: {
        threadId: "thread-resumed-completed",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "turn-resumed-completed",
          status: "completed",
          error: null,
          items: [
            { type: "userMessage", content: [{ type: "text", text: "resume completed recovery" }] },
            { type: "agentMessage", id: "agent-completed", text: "Recovery completed successfully." },
          ],
        },
      },
    });
    await flushAsync();

    await vi.waitFor(() => expect(session.state.codex_result_error_auto_pause).toBeNull());
    await vi.waitFor(() =>
      expect(
        adapter2.sendBrowserMessage.mock.calls.filter((call) =>
          call[0]?.inputs?.some((input: any) => input.content === "queued automatic during disconnect"),
        ),
      ).toHaveLength(1),
    );
    const events = browser.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
    const summaryIndex = events.findIndex((event: any) => event.type === "codex_auto_pause_recovery_summary");
    const clearIndex = events.findIndex(
      (event: any) => event.type === "session_update" && event.session?.codex_result_error_auto_pause === null,
    );
    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(clearIndex).toBeGreaterThan(summaryIndex);
    const summaries = session.messageHistory.filter(
      (entry) => entry.type === "codex_auto_pause_recovery_summary",
    ) as any[];
    expect(summaries).toHaveLength(1);
    expect(summaries[0].recovery.receipts).toHaveLength(1);
    expect(
      adapter2.sendBrowserMessage.mock.calls.filter((call) =>
        call[0]?.inputs?.some((input: any) => input.content === "queued automatic during disconnect"),
      ),
    ).toHaveLength(1);
  });

  it("clears and drains once when resume proves the exact automatic provider-retry owner completed", async () => {
    const sid = "s-resumed-automatic-provider-recovery-completed";
    const adapter1 = makeCodexAdapterMock();
    bridge.attachCodexAdapter(sid, adapter1 as any);
    emitCodexSessionReady(adapter1, { cliSessionId: "thread-resumed-automatic-provider" });
    const browser = makeBrowserSocket(sid);
    bridge.handleBrowserOpen(browser, sid);
    await subscribeCurrentBrowser(bridge, browser);

    const ownerContent = "automatic provider recovery owner";
    await bridge.handleBrowserMessage(
      browser,
      JSON.stringify({
        type: "user_message",
        content: ownerContent,
        agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
      }),
    );
    adapter1.emitTurnStarted("turn-resumed-automatic-provider");
    await flushAsync();
    const session = bridge.getSession(sid)!;
    const owner = getPendingCodexTurn(session);
    owner.autoPauseSourceKind = "automatic";
    owner.providerRecoveryAttempts = 151;
    owner.providerRecoveryFamily = "model_backend_stream_error";
    seedAutoPause(session, "held-resumed-automatic-provider");
    Object.assign(session.state.codex_result_error_auto_pause!, {
      family: "model_backend_stream_error",
      fingerprint: "model_backend_stream_error:responses",
      lastError: "Model backend stream disconnected before completion.",
    });
    adapter1.emitDisconnect();

    const adapter2 = makeCodexAdapterMock();
    bridge.attachCodexAdapter(sid, adapter2 as any);
    browser.send.mockClear();
    adapter2.emitSessionMeta({
      cliSessionId: "thread-resumed-automatic-provider",
      model: "gpt-5.3-codex",
      cwd: "/repo",
      resumeSnapshot: {
        threadId: "thread-resumed-automatic-provider",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "turn-resumed-automatic-provider",
          status: "completed",
          error: null,
          items: [
            { type: "userMessage", content: [{ type: "text", text: ownerContent }] },
            { type: "agentMessage", id: "agent-automatic-completed", text: "Automatic recovery completed." },
          ],
        },
      },
    });
    await flushAsync();

    await vi.waitFor(() => expect(session.state.codex_result_error_auto_pause).toBeNull());
    await vi.waitFor(() =>
      expect(
        adapter2.sendBrowserMessage.mock.calls.filter((call) =>
          call[0]?.inputs?.some((input: any) => input.content === "held event"),
        ),
      ).toHaveLength(1),
    );
    expect(
      adapter2.sendBrowserMessage.mock.calls.filter((call) =>
        call[0]?.inputs?.some((input: any) => input.content === ownerContent),
      ),
    ).toHaveLength(0);
    const summaries = session.messageHistory.filter(
      (entry) => entry.type === "codex_auto_pause_recovery_summary",
    ) as any[];
    expect(summaries).toHaveLength(1);
    expect(summaries[0].recovery.receipts).toEqual([
      expect.objectContaining({ groupId: "held-resumed-automatic-provider", outcome: "released_to_delivery" }),
    ]);

    const reconnect = makeBrowserSocket(sid);
    bridge.handleBrowserOpen(reconnect, sid);
    bridge.handleBrowserMessage(
      reconnect,
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        history_window_section_turn_count: 10,
        history_window_visible_section_count: 3,
      }),
    );
    await flushAsync();
    await vi.waitFor(() =>
      expect(reconnect.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw))).toContainEqual(
        expect.objectContaining({ type: "state_snapshot", codexAutoPauseRecoveryProgress: null }),
      ),
    );
  });

  it("suppresses stale recovery replay when idle inProgress turn has command activity", async () => {
    // A stale idle/inProgress snapshot can still prove that the user payload
    // reached command execution. Replaying it would duplicate model delivery
    // and potentially repeat side effects.
    const sid = "s-idle-thread-stale-turn";
    const adapter1 = makeCodexAdapterMock();
    bridge.attachCodexAdapter(sid, adapter1 as any);

    const browser = makeBrowserSocket(sid);
    bridge.handleBrowserOpen(browser, sid);
    browser.send.mockClear();

    await bridge.handleBrowserMessage(
      browser,
      JSON.stringify({
        type: "user_message",
        content: "run a command",
      }),
    );
    adapter1.emitDisconnect("turn-stale");

    // Reconnect with inProgress turn but idle thread
    const adapter2 = makeCodexAdapterMock();
    bridge.attachCodexAdapter(sid, adapter2 as any);
    adapter2.emitSessionMeta({
      cliSessionId: "thread-idle",
      model: "gpt-5.3-codex",
      cwd: "/repo",
      resumeSnapshot: {
        threadId: "thread-idle",
        turnCount: 5,
        threadStatus: "idle",
        lastTurn: {
          id: "turn-stale",
          status: "inProgress",
          error: null,
          items: [
            { type: "userMessage", content: [{ type: "text", text: "run a command" }] },
            { type: "commandExecution", id: "cmd_stale", status: "in_progress", command: ["make", "build"] },
          ],
        },
      },
    });

    expect(adapter2.sendBrowserMessage).not.toHaveBeenCalled();
    expect(getPendingCodexTurn(bridge.getSession(sid)!)).toBeNull();
    const calls = browser.send.mock.calls.map(([arg]: [string]) => JSON.parse(arg));
    expect(calls).toContainEqual(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("old user payload was not replayed"),
      }),
    );
  });
});
