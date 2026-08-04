import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock env-manager and git-utils modules before any imports
vi.mock("./env-manager.js", () => ({
  listEnvs: vi.fn(() => Promise.resolve([])),
  getEnv: vi.fn(() => Promise.resolve(null)),
  getEffectiveImage: vi.fn(() => Promise.resolve(null)),
  createEnv: vi.fn(() => Promise.resolve(undefined)),
  updateEnv: vi.fn(() => Promise.resolve(undefined)),
  deleteEnv: vi.fn(() => Promise.resolve(undefined)),
}));

const mockExecSync = vi.hoisted(() => vi.fn((_cmd?: string) => "" as any));
vi.mock("node:child_process", () => {
  // exec mock: callback-based, delegates to execSync for consistent test behavior.
  // Attaches stdout/stderr to the error object so promisify(exec) can find them,
  // matching Node's custom exec promisify behavior.
  const execMock = vi.fn((...args: any[]) => {
    const cmd = args[0] as string;
    const callback = typeof args[1] === "function" ? args[1] : args[2];
    try {
      const result = mockExecSync(cmd);
      if (callback) callback(null, { stdout: result ?? "", stderr: "" });
    } catch (err) {
      const e = err as any;
      if (e.stdout === undefined) e.stdout = "";
      if (e.stderr === undefined) e.stderr = "";
      if (callback) callback(err, { stdout: e.stdout ?? "", stderr: e.stderr ?? "" });
    }
  });
  const execFileMock = vi.fn((...args: any[]) => {
    const callback = args.find((arg) => typeof arg === "function");
    if (callback) callback(null, { stdout: "", stderr: "" });
  });
  return { execSync: mockExecSync, exec: execMock, execFile: execFileMock };
});

const mockResolveBinary = vi.hoisted(() => vi.fn((_name: string) => null as string | null));
const mockExpandTilde = vi.hoisted(() => vi.fn((p: string) => p)); // pass-through by default
const mockCaptureUserShellEnv = vi.hoisted(() => vi.fn((_varNames: string[]) => ({}) as Record<string, string>));
vi.mock("./path-resolver.js", () => ({
  resolveBinary: mockResolveBinary,
  expandTilde: mockExpandTilde,
  captureUserShellEnv: mockCaptureUserShellEnv,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => ""),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn((...args: Parameters<typeof actual.readFile>) => actual.readFile(...args)),
    stat: vi.fn((...args: Parameters<typeof actual.stat>) => actual.stat(...args)),
    access: vi.fn(async () => {}), // default: file exists (no throw)
  };
});

vi.mock("./git-utils.js", () => ({
  getRepoInfo: vi.fn(() => null),
  getRepoInfoAsync: vi.fn(async () => null),
  listBranches: vi.fn(() => []),
  listBranchesAsync: vi.fn(async () => []),
  listWorktrees: vi.fn(() => []),
  listWorktreesAsync: vi.fn(async () => []),
  ensureWorktree: vi.fn(),
  ensureWorktreeAsync: vi.fn(),
  gitFetch: vi.fn(() => ({ success: true, output: "" })),
  gitFetchAsync: vi.fn(async () => ({ success: true, output: "" })),
  gitPull: vi.fn(() => ({ success: true, output: "" })),
  gitPullAsync: vi.fn(async () => ({ success: true, output: "" })),
  checkoutBranch: vi.fn(),
  checkoutBranchAsync: vi.fn(async () => {}),
  removeWorktree: vi.fn(),
  removeWorktreeAsync: vi.fn(async () => ({ removed: true })),
  isWorktreeDirty: vi.fn(() => false),
  isWorktreeDirtyAsync: vi.fn(async () => false),
  archiveBranchAsync: vi.fn(async () => true),
  resolveDefaultBranch: vi.fn(() => "main"),
  getBranchStatus: vi.fn(() => ({ ahead: 0, behind: 0 })),
  deleteArchivedRefAsync: vi.fn(async () => {}),
}));

vi.mock("./session-names.js", () => ({
  getName: vi.fn(() => undefined),
  setName: vi.fn(),
  getAllNames: vi.fn(() => ({})),
  removeName: vi.fn(),
  getNextLeaderNumber: vi.fn(() => 1),
  _resetForTest: vi.fn(),
}));

vi.mock("./settings-manager.js", () => ({
  getSettings: vi.fn(() => ({
    serverName: "",
    serverId: "",
    pushoverUserKey: "",
    pushoverApiToken: "",
    pushoverDelaySeconds: 30,
    pushoverEnabled: true,
    pushoverEventFilters: { needsInput: true, review: true, error: true },
    pushoverBaseUrl: "",
    claudeBinary: "",
    codexBinary: "",
    maxKeepAlive: 0,
    heavyRepoModeEnabled: false,
    autoApprovalEnabled: false,
    autoApprovalModel: "haiku",
    autoApprovalMaxConcurrency: 4,
    autoApprovalTimeoutSeconds: 45,
    namerConfig: { backend: "claude" },
    autoNamerEnabled: true,
    transcriptionConfig: {
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      enhancementEnabled: true,
      enhancementModel: "gpt-5-mini",
    },
    editorConfig: { editor: "none" },
    defaultClaudeBackend: "claude",
    sleepInhibitorEnabled: false,
    sleepInhibitorDurationMinutes: 5,
    questmasterViewMode: "cards",
    updatedAt: 0,
  })),
  updateSettings: vi.fn((patch) => ({
    serverName: "",
    serverId: "",
    pushoverUserKey: patch.pushoverUserKey ?? "",
    pushoverApiToken: patch.pushoverApiToken ?? "",
    pushoverDelaySeconds: patch.pushoverDelaySeconds ?? 30,
    pushoverEnabled: patch.pushoverEnabled ?? true,
    pushoverEventFilters: patch.pushoverEventFilters ?? { needsInput: true, review: true, error: true },
    pushoverBaseUrl: patch.pushoverBaseUrl ?? "",
    claudeBinary: patch.claudeBinary ?? "",
    codexBinary: patch.codexBinary ?? "",
    maxKeepAlive: patch.maxKeepAlive ?? 0,
    heavyRepoModeEnabled: patch.heavyRepoModeEnabled ?? false,
    autoApprovalEnabled: patch.autoApprovalEnabled ?? false,
    autoApprovalModel: patch.autoApprovalModel ?? "haiku",
    autoApprovalMaxConcurrency: patch.autoApprovalMaxConcurrency ?? 4,
    autoApprovalTimeoutSeconds: patch.autoApprovalTimeoutSeconds ?? 45,
    namerConfig: patch.namerConfig ?? { backend: "claude" },
    autoNamerEnabled: patch.autoNamerEnabled ?? true,
    transcriptionConfig: patch.transcriptionConfig ?? {
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      enhancementEnabled: true,
      enhancementModel: "gpt-5-mini",
    },
    editorConfig: patch.editorConfig ?? { editor: "none" },
    defaultClaudeBackend: patch.defaultClaudeBackend ?? "claude",
    sleepInhibitorEnabled: patch.sleepInhibitorEnabled ?? false,
    sleepInhibitorDurationMinutes: patch.sleepInhibitorDurationMinutes ?? 5,
    questmasterViewMode: patch.questmasterViewMode ?? "cards",
    updatedAt: Date.now(),
  })),
  getServerName: vi.fn(() => ""),
  setServerName: vi.fn(),
  getServerId: vi.fn(() => "test-server-id"),
  getClaudeUserDefaultModel: vi.fn(async () => ""),
}));

const mockGetUsageLimits = vi.hoisted(() => vi.fn());
vi.mock("./usage-limits.js", () => ({
  getUsageLimits: mockGetUsageLimits,
}));

import { Hono } from "hono";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildOrchestratorSystemPrompt, createRoutes } from "./routes.js";
import { _resetModelCache } from "./routes/system.js";
import { trafficStats } from "./traffic-stats.js";
import { _resetServerLoggerForTest, createLogger, initServerLogger } from "./server-logger.js";
import * as serverLoggerModule from "./server-logger.js";
import * as envManager from "./env-manager.js";
import * as gitUtils from "./git-utils.js";
import * as questStore from "./quest-store.js";
import * as sessionNames from "./session-names.js";
import * as settingsManager from "./settings-manager.js";
import * as transcriptionEnhancer from "./transcription-enhancer.js";
import { containerManager } from "./container-manager.js";

// ─── Mock factories ──────────────────────────────────────────────────────────

function createMockLauncher() {
  return {
    launch: vi.fn(() => ({
      sessionId: "session-1",
      state: "starting",
      cwd: "/test",
      createdAt: Date.now(),
    })),
    kill: vi.fn(async () => true),
    isAlive: vi.fn(() => true),
    relaunch: vi.fn(async () => ({ ok: true })),
    relaunchWithResumeAt: vi.fn(async () => ({ ok: true })),
    listSessions: vi.fn(() => []),
    getSession: vi.fn(),
    setArchived: vi.fn(),
    setWorktreeCleanupState: vi.fn(),
    updateWorktree: vi.fn(),
    removeSession: vi.fn(),
    getOrchestratorGuardrails: vi.fn(() => "# Takode — Cross-Session Orchestration\n..."),
    getPort: vi.fn(() => 3456),
    verifySessionAuthToken: vi.fn(() => true),
    herdSessions: vi.fn(() => ({ herded: [], notFound: [], conflicts: [], reassigned: [], leaders: [] })),
    unherdSession: vi.fn(() => false),
    getHerdedSessions: vi.fn(() => []),
    // resolveSessionId: pass-through for exact UUIDs (used by resolveId helper in routes)
    resolveSessionId: vi.fn((id: string) => id),
    getSessionNum: vi.fn(() => undefined),
  } as any;
}

function createMockBridge() {
  return {
    _sessions: {} as Record<string, any>,
    _gitStateDeps: {
      refreshGitInfo: vi.fn(async () => {}),
      broadcastSessionUpdate: vi.fn(),
      broadcastDiffTotals: vi.fn(),
      persistSession: vi.fn(),
    },
    _vscodeSelectionState: null as any,
    _vscodeWindows: [] as any[],
    closeSession: vi.fn(),
    getSession: vi.fn(function (this: any, sessionId: string) {
      if (sessionId in this._sessions) return this._sessions[sessionId];
      const stateEntries = this.getAllSessions();
      const stateEntry = Array.isArray(stateEntries)
        ? stateEntries.find((entry: any) => entry?.session_id === sessionId || entry?.sessionId === sessionId)
        : null;
      const messageHistory = this.getMessageHistory(sessionId) ?? [];
      if (!stateEntry && messageHistory.length === 0) {
        return null;
      }
      return {
        id: sessionId,
        state: stateEntry?.state ?? stateEntry ?? {},
        messageHistory,
        notifications: [],
        pendingPermissions: new Map(),
        taskHistory: [],
        keywords: [],
        lastReadAt: 0,
        attentionReason: null,
        isGenerating: false,
      };
    }),
    getOrCreateSession: vi.fn(),
    getAllSessions: vi.fn(() => []),
    refreshWorktreeGitStateForSnapshot: vi.fn(async () => null),
    getSessionGitStateDeps: vi.fn(function (this: any) {
      return this._gitStateDeps;
    }),
    getLastUserMessage: vi.fn(() => undefined),
    isBackendConnected: vi.fn(() => false),
    markWorktree: vi.fn(),
    applyInitialSessionState: vi.fn(),
    setDiffBaseBranch: vi.fn(() => true),
    onSessionArchived: vi.fn(),
    onSessionUnarchived: vi.fn(),
    persistSessionById: vi.fn(),
    broadcastToSession: vi.fn(),
    broadcastGlobal: vi.fn(),
    getVsCodeSelectionState: vi.fn(function (this: any) {
      return this._vscodeSelectionState;
    }),
    updateVsCodeSelectionState: vi.fn(function (this: any, state: any) {
      this._vscodeSelectionState = state;
      return true;
    }),
    getVsCodeWindowStates: vi.fn(function (this: any) {
      return this._vscodeWindows;
    }),
    upsertVsCodeWindowState: vi.fn(function (this: any, state: any) {
      const next = {
        ...state,
        workspaceRoots: [...(state.workspaceRoots ?? [])],
        lastSeenAt: 9999,
      };
      this._vscodeWindows = [...this._vscodeWindows.filter((window: any) => window.sourceId !== state.sourceId), next];
      return next;
    }),
    pollVsCodeOpenFileCommands: vi.fn(() => []),
    resolveVsCodeOpenFileResult: vi.fn(() => true),
    requestVsCodeOpenFile: vi.fn(async () => ({ sourceId: "window-a", commandId: "cmd-1" })),
    addTaskEntry: vi.fn(),
    updateQuestTaskEntries: vi.fn(),
    removeBoardRowFromAll: vi.fn(),
    completeDoneBoardRowsForQuest: vi.fn(),
    prepareSessionForRevert: vi.fn(
      (sessionId: string, truncateIdx: number, options?: { clearCodexState?: boolean }) => {
        const session = bridge.getOrCreateSession.mock.results.at(-1)?.value;
        if (!session) return null;
        session.messageHistory = session.messageHistory.slice(0, truncateIdx);
        session.frozenCount = Math.min(session.frozenCount ?? 0, session.messageHistory.length);
        session.assistantAccumulator?.clear?.();
        session.pendingMessages = [];
        session.lastOutboundUserNdjson = null;
        session.userMessageIdsThisTurn = [];
        session.queuedTurnStarts = 0;
        session.queuedTurnReasons = [];
        session.queuedTurnUserMessageIds = [];
        session.queuedTurnInterruptSources = [];
        session.interruptedDuringTurn = false;
        session.interruptSourceDuringTurn = null;
        session.isGenerating = false;
        session.generationStartedAt = null;
        session.disconnectWasGenerating = false;
        session.seamlessReconnect = false;
        session.toolStartTimes?.clear?.();
        session.toolProgressOutput?.clear?.();
        session.dropReplayHistoryAfterRevert = session.backendType === "claude" || session.backendType === "claude-sdk";
        session.pendingPermissions?.clear?.();
        session.eventBuffer = [];
        session.awaitingCompactSummary = false;
        session.claudeCompactBoundarySeen = false;
        session.compactedDuringTurn = false;
        session.forceCompactPending = false;
        if (session.state) session.state.is_compacting = false;
        if (options?.clearCodexState) {
          session.pendingCodexTurns = [];
          session.pendingCodexInputs = [];
          session.pendingCodexRollback = null;
          session.pendingCodexRollbackError = null;
          if (session.optimisticRunningTimer) session.optimisticRunningTimer = null;
          bridge.broadcastToSession(sessionId, { type: "codex_pending_inputs", inputs: [] });
        }
        bridge.broadcastToSession(sessionId, { type: "permissions_cleared" });
        return session;
      },
    ),
    beginCodexRollback: vi.fn(
      (sessionId: string, plan: { numTurns: number; truncateIdx: number; clearCodexState: boolean }) => {
        const session = bridge.getOrCreateSession.mock.results.at(-1)?.value;
        const adapter = session?.codexAdapter;
        if (adapter?.isConnected?.() && adapter.rollbackTurns) {
          return {
            promise: adapter.rollbackTurns(plan.numTurns).then(() => {
              const reverted = bridge.prepareSessionForRevert(sessionId, plan.truncateIdx, {
                clearCodexState: plan.clearCodexState,
              });
              bridge.persistSessionSync(sessionId);
              bridge.broadcastToSession(sessionId, { type: "message_history", messages: reverted.messageHistory });
              bridge.broadcastToSession(sessionId, { type: "status_change", status: "idle" });
            }),
            requiresRelaunch: false,
          };
        }
        return { promise: Promise.resolve(), requiresRelaunch: true };
      },
    ),
    persistSessionSync: vi.fn(),
    getMessageHistory: vi.fn(() => []),
    getToolResult: vi.fn(() => null),
    injectUserMessage: vi.fn(() => "sent" as const),
    emitTakodeEvent: vi.fn(),
    subscribeTakodeEvents: vi.fn(() => () => {}),
    routeExternalPermissionResponse: vi.fn(),
    routeExternalInterrupt: vi.fn(async () => {}),
    routeBrowserMessage: vi.fn(function (this: any, session: any, msg: any) {
      if (msg?.type === "permission_response") {
        return this.routeExternalPermissionResponse(
          session,
          {
            type: "permission_response",
            request_id: msg.request_id,
            behavior: msg.behavior,
            ...(msg.updated_input ? { updated_input: msg.updated_input } : {}),
            ...(msg.message ? { message: msg.message } : {}),
          },
          msg.actorSessionId,
        );
      }
      if (msg?.type === "interrupt") {
        return this.routeExternalInterrupt(session, msg.interruptSource);
      }
      return undefined;
    }),
    getTrafficStatsSnapshot: vi.fn(() => ({
      windowStartedAt: 1000,
      capturedAt: 2000,
      totals: { messages: 1, payloadBytes: 10, wireBytes: 10 },
      buckets: [],
      sessions: {},
      historySyncBreakdown: {
        totals: {
          requests: 0,
          frozenDeltaBytes: 0,
          hotMessagesBytes: 0,
          frozenDeltaMessages: 0,
          hotMessagesCount: 0,
        },
        sessions: {},
      },
      toolResultFetches: {
        totals: { requests: 0, repeatedRequests: 0, payloadBytes: 0, errorRequests: 0 },
        sessions: {},
        topRepeated: [],
      },
    })),
    resetTrafficStats: vi.fn(),
  } as any;
}

function ensureBridgeSession(
  bridge: ReturnType<typeof createMockBridge>,
  sessionId: string,
  overrides: Record<string, unknown> = {},
) {
  return (bridge._sessions[sessionId] = {
    id: sessionId,
    state: {},
    browserSockets: new Set(),
    messageHistory: [],
    notifications: [],
    pendingPermissions: new Map(),
    taskHistory: [],
    keywords: [],
    lastReadAt: 0,
    attentionReason: null,
    isGenerating: false,
    ...overrides,
  });
}

function createMockStore() {
  return {
    setArchived: vi.fn(async () => true),
    flushAll: vi.fn(async () => {}),
  } as any;
}

function createMockRecorder() {
  return {
    getRecordingsDir: vi.fn(() => "/tmp/companion-recordings"),
    isGloballyEnabled: vi.fn(() => true),
    getMaxLines: vi.fn(() => 500000),
    isRecording: vi.fn(() => true),
    getRecordingStatus: vi.fn(() => ({ filePath: "/tmp/companion-recordings/session-1.jsonl" })),
    enableForSession: vi.fn(),
    disableForSession: vi.fn(),
    listRecordings: vi.fn(async () => []),
  } as any;
}

function createMockTimerManager() {
  return {
    createTimer: vi.fn(),
    listTimers: vi.fn(() => []),
    cancelTimer: vi.fn(async () => true),
    cancelAllTimers: vi.fn(async () => {}),
  } as any;
}

function createMockTracker() {
  return {
    addMapping: vi.fn(),
    getBySession: vi.fn(() => null),
    removeBySession: vi.fn(),
    isWorktreeInUse: vi.fn(() => false),
  } as any;
}

// ─── Test setup ──────────────────────────────────────────────────────────────

let app: Hono;
let launcher: ReturnType<typeof createMockLauncher>;
let bridge: ReturnType<typeof createMockBridge>;
let sessionStore: ReturnType<typeof createMockStore>;
let tracker: ReturnType<typeof createMockTracker>;
let recorder: ReturnType<typeof createMockRecorder>;
let timerManager: ReturnType<typeof createMockTimerManager>;

beforeEach(() => {
  vi.clearAllMocks();
  mockExecSync.mockReturnValue("");
  trafficStats.reset();
  _resetServerLoggerForTest();
  // Reset the LiteLLM model cache so each test starts clean.
  _resetModelCache();
  // Stub global fetch to prevent LiteLLM proxy calls in tests.
  // Model endpoint tests exercise the fallback path (models_cache.json).
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no proxy in tests"))),
  );
  launcher = createMockLauncher();
  bridge = createMockBridge();
  sessionStore = createMockStore();
  tracker = createMockTracker();
  recorder = createMockRecorder();
  timerManager = createMockTimerManager();
  app = new Hono();
  const terminalManager = { getInfo: () => null, spawn: () => "", kill: () => {} } as any;
  app.route(
    "/api",
    createRoutes(
      launcher,
      bridge,
      sessionStore,
      tracker,
      terminalManager,
      undefined,
      recorder,
      undefined,
      timerManager,
    ),
  );

  // Default no-op mocks for container workspace isolation (called during container session creation)
  vi.spyOn(containerManager, "copyWorkspaceToContainer").mockResolvedValue(undefined);
  vi.spyOn(containerManager, "reseedGitAuth").mockImplementation(() => {});
});

// ─── Sessions ────────────────────────────────────────────────────────────────

// ─── SSE Session Creation Streaming ──────────────────────────────────────────
/** Parse an SSE response body into an array of {event, data} objects */
async function parseSSE(res: Response): Promise<{ event: string; data: string }[]> {
  const text = await res.text();
  const events: { event: string; data: string }[] = [];
  // SSE frames are separated by double newlines
  for (const block of text.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let event = "message";
    let data = "";
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data = line.slice(5).trim();
    }
    if (data) events.push({ event, data });
  }
  return events;
}

describe("POST /api/quests/:questId/claim", () => {
  function companionAuthHeaders(sessionId: string, token: string): Record<string, string> {
    return {
      "x-companion-session-id": sessionId,
      "x-companion-auth-token": token,
      "Content-Type": "application/json",
    };
  }

  it("returns 400 when sessionId does not belong to a known companion session", async () => {
    const claimSpy = vi.spyOn(questStore, "claimQuest");

    const res = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "cli-standalone" }),
    });

    expect(res.status).toBe(400);
    expect(claimSpy).not.toHaveBeenCalled();
  });

  it("accepts authenticated caller identity when sessionId is omitted", async () => {
    vi.spyOn(questStore, "claimQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "session-2",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    launcher.getSession.mockImplementation((sid: string) =>
      sid === "session-2" ? { sessionId: "session-2", state: "running", cwd: "/test", archived: false } : undefined,
    );
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "session-2" && token === "tok-2",
    );

    const res = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: companionAuthHeaders("session-2", "tok-2"),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(questStore.claimQuest).toHaveBeenCalledWith("q-1", "session-2", expect.any(Object));
  });

  it("resolves numeric body sessionId before comparing to authenticated caller", async () => {
    vi.spyOn(questStore, "claimQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "session-2",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    launcher.resolveSessionId.mockImplementation((ref: string) => (ref === "42" ? "session-2" : ref));
    launcher.getSession.mockImplementation((sid: string) =>
      sid === "session-2" ? { sessionId: "session-2", state: "running", cwd: "/test", archived: false } : undefined,
    );
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "session-2" && token === "tok-2",
    );

    const res = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: companionAuthHeaders("session-2", "tok-2"),
      body: JSON.stringify({ sessionId: "42" }),
    });

    expect(res.status).toBe(200);
    expect(questStore.claimQuest).toHaveBeenCalledWith("q-1", "session-2", expect.any(Object));
  });

  it("returns 403 when body sessionId mismatches authenticated caller", async () => {
    launcher.getSession.mockImplementation((sid: string) =>
      sid === "session-2" ? { sessionId: "session-2", state: "running", cwd: "/test", archived: false } : undefined,
    );
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "session-2" && token === "tok-2",
    );

    const res = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: companionAuthHeaders("session-2", "tok-2"),
      body: JSON.stringify({ sessionId: "session-3" }),
    });

    expect(res.status).toBe(403);
    expect(questStore.claimQuest).not.toHaveBeenCalled();
  });

  it("returns 403 when the claiming session is an orchestrator (q-87)", async () => {
    // Orchestrator/leader sessions must never claim quests -- they dispatch to workers.
    // The server enforces this even if the CLI-side TAKODE_ROLE check is bypassed.
    launcher.getSession.mockReturnValue({
      sessionId: "session-1",
      state: "running",
      cwd: "/test",
      archived: false,
      isOrchestrator: true,
    } as any);
    const claimSpy = vi.spyOn(questStore, "claimQuest");

    const res = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-1" }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Leader sessions cannot claim quests");
    expect(claimSpy).not.toHaveBeenCalled();
  });

  it("passes archived-owner takeover policy to questStore.claimQuest", async () => {
    vi.spyOn(questStore, "claimQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "session-2",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);

    launcher.getSession.mockImplementation((sid: string) =>
      sid === "session-1"
        ? { sessionId: "session-1", state: "exited", cwd: "/test", archived: true }
        : { sessionId: sid, state: "running", cwd: "/test", archived: false },
    );

    const res = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-2" }),
    });

    expect(res.status).toBe(200);
    expect(questStore.claimQuest).toHaveBeenCalledWith(
      "q-1",
      "session-2",
      expect.objectContaining({
        allowArchivedOwnerTakeover: true,
        isSessionArchived: expect.any(Function),
      }),
    );
    const opts = vi.mocked(questStore.claimQuest).mock.calls[0][2] as { isSessionArchived: (sid: string) => boolean };
    expect(opts.isSessionArchived("session-1")).toBe(true);
    expect(opts.isSessionArchived("session-2")).toBe(false);
  });

  it("allows authenticated board-assigned worker force-claim with audit data", async () => {
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "session-1",
      leaderSessionId: "leader-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    vi.spyOn(questStore, "claimQuest").mockResolvedValueOnce({
      id: "q-1",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "session-2",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    launcher.getSession.mockImplementation((sid: string) => {
      if (sid === "session-1") return { sessionId: sid, state: "running", cwd: "/test", archived: false };
      if (sid === "session-2") return { sessionId: sid, state: "running", cwd: "/test", archived: false };
      if (sid === "leader-1")
        return { sessionId: sid, state: "running", cwd: "/test", archived: false, isOrchestrator: true };
      return undefined;
    });
    bridge._sessions["leader-1"] = {
      id: "leader-1",
      board: new Map([["q-1", { questId: "q-1", worker: "session-2", createdAt: 1, updatedAt: 1 }]]),
      messageHistory: [],
      taskHistory: [],
      browserSockets: new Set(),
      state: {},
    };

    const res = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: companionAuthHeaders("session-2", "tok-2"),
      body: JSON.stringify({ force: true, reason: "board assigned this worker" }),
    });

    expect(res.status).toBe(200);
    expect(questStore.claimQuest).toHaveBeenCalledWith(
      "q-1",
      "session-2",
      expect.objectContaining({
        force: true,
        ownershipEvent: expect.objectContaining({
          operation: "force_claim",
          actorSessionId: "session-2",
          previousOwnerSessionId: "session-1",
          newOwnerSessionId: "session-2",
          previousLeaderSessionId: "leader-1",
          reason: "board assigned this worker",
        }),
      }),
    );
  });

  it("rejects live-owner force-claim without archive or board assignment evidence", async () => {
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "session-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    const claimSpy = vi.spyOn(questStore, "claimQuest");
    launcher.getSession.mockImplementation((sid: string) =>
      sid === "session-1" || sid === "session-2"
        ? { sessionId: sid, state: "running", cwd: "/test", archived: false }
        : undefined,
    );

    const res = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: companionAuthHeaders("session-2", "tok-2"),
      body: JSON.stringify({ force: true, reason: "take over" }),
    });

    expect(res.status).toBe(403);
    expect(claimSpy).not.toHaveBeenCalled();
  });

  it("passes the current orchestrating leader when a herded worker claims a quest", async () => {
    vi.spyOn(questStore, "claimQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      leaderSessionId: "leader-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);

    launcher.getSession.mockImplementation((sid: string) => {
      if (sid === "worker-1") {
        return { sessionId: "worker-1", state: "running", cwd: "/test", archived: false, herdedBy: "leader-1" };
      }
      if (sid === "leader-1") {
        return { sessionId: "leader-1", state: "running", cwd: "/test", archived: false, isOrchestrator: true };
      }
      return undefined;
    });

    const res = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "worker-1" }),
    });

    expect(res.status).toBe(200);
    expect(questStore.claimQuest).toHaveBeenCalledWith(
      "q-1",
      "worker-1",
      expect.objectContaining({ leaderSessionId: "leader-1" }),
    );
  });

  it("omits leader attribution when the worker is unherded or points at a non-leader", async () => {
    vi.spyOn(questStore, "claimQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);

    launcher.getSession.mockImplementation((sid: string) => {
      if (sid === "worker-1") {
        return { sessionId: "worker-1", state: "running", cwd: "/test", archived: false, herdedBy: "peer-1" };
      }
      if (sid === "peer-1") {
        return { sessionId: "peer-1", state: "running", cwd: "/test", archived: false, isOrchestrator: false };
      }
      return undefined;
    });

    const res = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "worker-1" }),
    });

    expect(res.status).toBe(200);
    const options = vi.mocked(questStore.claimQuest).mock.calls[0][2] as { leaderSessionId?: string };
    expect(options.leaderSessionId).toBeUndefined();
  });

  it("adds a quest-sourced task history entry with questId for deep-linking", async () => {
    vi.spyOn(questStore, "claimQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "session-2",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);

    launcher.getSession.mockReturnValue({
      sessionId: "session-2",
      state: "running",
      cwd: "/test",
      archived: false,
    } as any);

    bridge.getSession.mockReturnValue({
      id: "session-2",
      state: {},
      browserSockets: new Set(),
      taskHistory: [],
      messageHistory: [{ type: "user_message", id: "u-1", content: "claim", timestamp: Date.now() }],
    } as any);

    const res = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-2" }),
    });

    expect(res.status).toBe(200);
    expect(bridge.broadcastToSession).toHaveBeenCalledWith(
      "session-2",
      expect.objectContaining({
        type: "session_task_history",
        tasks: expect.arrayContaining([
          expect.objectContaining({
            title: "Quest",
            source: "quest",
            questId: "q-1",
            triggerMessageId: "u-1",
          }),
        ]),
      }),
    );
    expect(bridge.persistSessionById).toHaveBeenCalledWith("session-2");
  });

  it("does not duplicate quest task history on repeated same-session claims", async () => {
    // Regression: a same-session re-claim is idempotent at the quest-store layer
    // and must not append another identical quest pill to session task history.
    vi.spyOn(questStore, "claimQuest").mockResolvedValue({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "session-2",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);

    launcher.getSession.mockReturnValue({
      sessionId: "session-2",
      state: "running",
      cwd: "/test",
      archived: false,
    } as any);

    const trackedSession = {
      id: "session-2",
      state: {},
      browserSockets: new Set(),
      taskHistory: [],
      messageHistory: [{ type: "user_message", id: "u-1", content: "claim", timestamp: Date.now() }],
    } as any;
    bridge.getSession.mockReturnValue(trackedSession);

    const first = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-2" }),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/api/quests/q-1/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-2" }),
    });
    expect(second.status).toBe(200);

    expect(trackedSession.taskHistory).toEqual([
      expect.objectContaining({
        title: "Quest",
        source: "quest",
        questId: "q-1",
        triggerMessageId: "u-1",
      }),
    ]);
    expect(
      bridge.broadcastToSession.mock.calls.filter(
        ([sid, msg]: [string, { type?: string; tasks?: unknown[] }]) =>
          sid === "session-2" &&
          msg.type === "session_task_history" &&
          Array.isArray(msg.tasks) &&
          msg.tasks.length === 1,
      ),
    ).toHaveLength(1);
  });
});

describe("POST /api/quests/:questId/reassign", () => {
  function companionAuthHeaders(sessionId: string, token: string): Record<string, string> {
    return {
      "x-companion-session-id": sessionId,
      "x-companion-auth-token": token,
      "Content-Type": "application/json",
    };
  }

  it("allows an authenticated leader to reassign to a herded worker with audit data", async () => {
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "old-worker",
      leaderSessionId: "old-leader",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    vi.spyOn(questStore, "claimQuest").mockResolvedValueOnce({
      id: "q-1",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "new-worker",
      leaderSessionId: "leader-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    launcher.getSession.mockImplementation((sid: string) => {
      if (sid === "leader-1")
        return { sessionId: sid, state: "running", cwd: "/test", archived: false, isOrchestrator: true };
      if (sid === "new-worker")
        return { sessionId: sid, state: "running", cwd: "/test", archived: false, herdedBy: "leader-1" };
      if (sid === "old-worker") return { sessionId: sid, state: "running", cwd: "/test", archived: false };
      return undefined;
    });

    const res = await app.request("/api/quests/q-1/reassign", {
      method: "POST",
      headers: companionAuthHeaders("leader-1", "leader-token"),
      body: JSON.stringify({ sessionId: "new-worker", reason: "stale previous phase owner" }),
    });

    expect(res.status).toBe(200);
    expect(questStore.claimQuest).toHaveBeenCalledWith(
      "q-1",
      "new-worker",
      expect.objectContaining({
        force: true,
        leaderSessionId: "leader-1",
        ownershipEvent: expect.objectContaining({
          operation: "reassign",
          actorSessionId: "leader-1",
          previousOwnerSessionId: "old-worker",
          newOwnerSessionId: "new-worker",
          previousLeaderSessionId: "old-leader",
          newLeaderSessionId: "leader-1",
          reason: "stale previous phase owner",
        }),
      }),
    );
  });

  it("rejects reassignment from non-leader callers", async () => {
    launcher.getSession.mockReturnValue({
      sessionId: "worker-1",
      state: "running",
      cwd: "/test",
      archived: false,
      isOrchestrator: false,
    } as any);
    const claimSpy = vi.spyOn(questStore, "claimQuest");

    const res = await app.request("/api/quests/q-1/reassign", {
      method: "POST",
      headers: companionAuthHeaders("worker-1", "tok"),
      body: JSON.stringify({ sessionId: "worker-2", reason: "stale" }),
    });

    expect(res.status).toBe(403);
    expect(claimSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/quests/:questId/complete", () => {
  function companionAuthHeaders(sessionId: string, token: string): Record<string, string> {
    return {
      "x-companion-session-id": sessionId,
      "x-companion-auth-token": token,
      "Content-Type": "application/json",
    };
  }

  function installV2MemoryFixture(
    options: {
      callerId?: string;
      callerToken?: string;
      callerIsLeader?: boolean;
      callerReviewerOf?: number;
      row?: Record<string, unknown>;
      quest?: Record<string, unknown>;
      workerState?: Record<string, unknown>;
      workerLauncher?: Record<string, unknown>;
      completeQuest?: Record<string, unknown>;
      trackedStatus?: string;
    } = {},
  ) {
    const callerId = options.callerId ?? "worker-1";
    const callerToken = options.callerToken ?? "tok";
    const leaderSession = {
      sessionId: "leader-1",
      state: "running",
      cwd: "/test",
      archived: false,
      isOrchestrator: true,
    };
    const workerSession = {
      sessionId: "worker-1",
      state: "running",
      cwd: "/repo",
      archived: false,
      isWorktree: true,
      repoRoot: "/repo",
      branch: "feature",
      actualBranch: "feature-wt-1",
      ...(options.callerReviewerOf !== undefined ? { reviewerOf: options.callerReviewerOf } : {}),
      ...(options.workerLauncher ?? {}),
    };
    launcher.listSessions.mockReturnValue([leaderSession, workerSession] as any);
    launcher.getSession.mockImplementation((sid: string) => {
      if (sid === "leader-1") return leaderSession as any;
      if (sid === "worker-1") return workerSession as any;
      if (sid === "other-worker")
        return { sessionId: "other-worker", state: "running", cwd: "/repo", archived: false } as any;
      if (sid === "other-leader") {
        return {
          sessionId: "other-leader",
          state: "running",
          cwd: "/test",
          archived: false,
          isOrchestrator: true,
        } as any;
      }
      return undefined;
    });
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === callerId && token === callerToken,
    );
    if (options.trackedStatus !== undefined) {
      mockExecSync.mockImplementation((cmd?: string) =>
        cmd?.includes("status --porcelain") ? (options.trackedStatus ?? "") : "",
      );
    }
    bridge._sessions = {
      "leader-1": {
        id: "leader-1",
        board: new Map([
          [
            "q-1",
            {
              questId: "q-1",
              worker: "worker-1",
              workerNum: 7,
              status: "MEMORY",
              journey: { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 2, currentPhaseId: "memory" },
              createdAt: 1,
              updatedAt: 2,
              ...(options.row ?? {}),
            },
          ],
        ]),
        completedBoard: new Map(),
        notifications: [],
        pendingPermissions: new Map(),
        taskHistory: [],
        keywords: [],
        attentionRecords: [],
        messageHistory: [],
        browserSockets: new Set(),
      },
      "worker-1": {
        id: "worker-1",
        worktreeStateFingerprint: "",
        diffStatsDirty: false,
        backendSocket: null,
        codexAdapter: null,
        state: {
          cwd: "/repo",
          git_branch: "feature",
          git_default_branch: "origin/feature",
          diff_base_branch: "origin/feature",
          git_head_sha: "abc1234",
          is_worktree: true,
          git_ahead: 0,
          git_behind: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
          git_status_refresh_error: null,
          diff_stats_skipped_reason: null,
          ...(options.workerState ?? {}),
        },
        notifications: [],
        pendingPermissions: new Map(),
        taskHistory: [],
        keywords: [],
        attentionRecords: [],
        messageHistory: [],
        browserSockets: new Set(),
      },
    };
    const quest = {
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
      feedback: [
        {
          author: "agent",
          authorSessionId: "worker-1",
          phaseId: "work",
          kind: "phase_summary",
          text: "Accepted Work evidence with enough detail to satisfy the v2 completion guard before Memory closure.",
          ts: 1,
        },
        {
          author: "agent",
          authorSessionId: "worker-1",
          phaseId: "memory",
          kind: "phase_summary",
          text: "Final Memory closure.\n\nmemory update not needed: no durable cross-quest learning.",
          ts: 2,
        },
      ],
      ...(options.quest ?? {}),
    };
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce(quest as any);
    vi.spyOn(questStore, "completeQuest").mockResolvedValueOnce({
      ...quest,
      status: "done",
      verificationItems: [],
      verificationInboxUnread: true,
      ...(options.completeQuest ?? {}),
    } as any);
    return { callerId, callerToken };
  }

  async function postV2Complete(
    body: Record<string, unknown> = {},
    auth: { callerId: string; callerToken: string } = { callerId: "worker-1", callerToken: "tok" },
  ) {
    return app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders(auth.callerId, auth.callerToken),
      body: JSON.stringify({
        verificationItems: [],
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
        ...body,
      }),
    });
  }

  it("allows the assigned worker to complete an active v2 Memory row with final evidence", async () => {
    const auth = installV2MemoryFixture({
      workerState: { total_lines_added: 12, total_lines_removed: 1 },
    });

    const res = await postV2Complete({ commitShas: ["abc1234"] }, auth);

    expect(res.status).toBe(200);
    expect(bridge.getSessionGitStateDeps).toHaveBeenCalled();
    expect(bridge.refreshWorktreeGitStateForSnapshot).not.toHaveBeenCalled();
    expect(questStore.completeQuest).toHaveBeenCalledWith("q-1", [], {
      commitShas: ["abc1234"],
      memoryCommitShas: undefined,
      debrief: "Completed the accepted work and final Memory closure.",
      debriefTldr: "Accepted work is complete with final Memory closure.",
    });
    expect(bridge.completeDoneBoardRowsForQuest).toHaveBeenCalledWith("q-1");
  });

  it("fails closed when the authoritative git refresh path is unavailable", async () => {
    const auth = installV2MemoryFixture();
    bridge.getSessionGitStateDeps.mockReturnValueOnce(undefined);

    const res = await postV2Complete({ commitShas: ["abc1234"] }, auth);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "Cannot refresh worker git state for v2 Memory completion.",
    });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("allows the owning leader to complete v2 Memory on behalf of the assigned worker", async () => {
    const auth = installV2MemoryFixture({ callerId: "leader-1", callerToken: "leader-token" });

    const res = await postV2Complete({ sessionId: "worker-1", memoryCommitShas: ["def5678"] }, auth);

    expect(res.status).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalledWith("q-1", [], {
      commitShas: undefined,
      memoryCommitShas: ["def5678"],
      sessionId: "worker-1",
      debrief: "Completed the accepted work and final Memory closure.",
      debriefTldr: "Accepted work is complete with final Memory closure.",
    });
  });

  it.each([
    ["wrong worker", { callerId: "other-worker", callerToken: "tok" }, {}, 403],
    ["reviewer caller", { callerId: "worker-1", callerToken: "tok" }, { callerReviewerOf: 7 }, 403],
    ["other leader", { callerId: "other-leader", callerToken: "tok" }, { callerIsLeader: true }, 403],
  ])("rejects v2 Memory completion from %s", async (_label, auth, fixture, status) => {
    installV2MemoryFixture(fixture as any);
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === auth.callerId && token === auth.callerToken,
    );

    const res = await postV2Complete({}, auth);

    expect(res.status).toBe(status);
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it.each([
    [
      "wrong phase",
      {
        row: {
          status: "WORKING",
          journey: { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 1, currentPhaseId: "work" },
        },
      },
      "MEMORY",
    ],
    ["unresolved checkpoint", { row: { waitForInput: ["n-1"] } }, "User Checkpoint"],
    ["missing debrief", {}, "Final debrief", { debrief: "" }],
    ["missing debrief TLDR", {}, "Final debrief TLDR", { debriefTldr: "" }],
    [
      "unaddressed feedback",
      { quest: { feedback: [{ author: "human", text: "Please fix", ts: 1, addressed: false }] } },
      "human feedback",
    ],
    ["missing memory statement", { quest: { feedback: [] } }, "exactly one final memory statement"],
    [
      "duplicate memory statements",
      {
        quest: {
          feedback: [
            {
              author: "agent",
              authorSessionId: "worker-1",
              phaseId: "work",
              kind: "phase_summary",
              text: "Accepted Work evidence with enough detail to satisfy the v2 completion guard before Memory closure.",
              ts: 1,
            },
            {
              author: "agent",
              authorSessionId: "worker-1",
              phaseId: "memory",
              kind: "phase_summary",
              text: "memory updated: abc\nmemory update not needed: duplicate",
              ts: 2,
            },
          ],
        },
      },
      "exactly one final memory statement",
    ],
    ["dirty tracked changes", { trackedStatus: " M web/server/file.ts\n" }, "tracked changes"],
    ["ahead worktree", { workerState: { git_ahead: 1 } }, "ahead"],
    ["uncertain git state", { workerState: { git_status_refresh_error: "status failed" } }, "uncertain"],
    ["missing remote-backed sync counts", { workerState: { is_worktree: false, git_ahead: undefined } }, "sync state"],
    [
      "missing remote-backed comparison target",
      { workerState: { is_worktree: false, git_default_branch: "", diff_base_branch: "" } },
      "comparison target",
    ],
    ["ahead non-worktree remote-backed branch", { workerState: { is_worktree: false, git_ahead: 1 } }, "ahead"],
    ["behind non-worktree remote-backed branch", { workerState: { is_worktree: false, git_behind: 1 } }, "behind"],
    [
      "uncertain non-worktree remote-backed branch",
      { workerState: { is_worktree: false, git_status_refresh_error: "refresh budget" } },
      "uncertain",
    ],
  ])("rejects v2 Memory completion with %s", async (_label, fixture, errorText, body?: Record<string, unknown>) => {
    const auth = installV2MemoryFixture(fixture as any);

    const res = await postV2Complete(body ?? {}, auth);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining(errorText) });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("preserves zero-tracked-change v2 completion", async () => {
    const zeroAuth = installV2MemoryFixture();
    const zero = await postV2Complete({}, zeroAuth);
    expect(zero.status).toBe(200);
  });

  it("allows clean synced non-worktree remote-backed v2 completion", async () => {
    const auth = installV2MemoryFixture({ workerState: { is_worktree: false, git_ahead: 0, git_behind: 0 } });

    const res = await postV2Complete({}, auth);

    expect(res.status).toBe(200);
  });

  it("rejects dirty tracked git status even when commit metadata is present", async () => {
    const auth = installV2MemoryFixture();
    mockExecSync.mockImplementation((cmd?: string) =>
      cmd?.includes("status --porcelain --untracked-files=no") ? " M web/server/file.ts\n" : "",
    );

    const res = await postV2Complete({ commitShas: ["abc1234"] }, auth);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("uncommitted tracked changes") });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("rejects remote-backed worktree completion when the caller self-selects local-clean", async () => {
    const auth = installV2MemoryFixture({ workerState: { git_ahead: 2 } });

    const res = await postV2Complete({ commitShas: ["abc1234"], v2CompletionSync: "local-clean" }, auth);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("ahead") });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("rejects remote-backed non-worktree completion when the caller self-selects local-clean", async () => {
    const auth = installV2MemoryFixture({
      workerState: { is_worktree: false, git_ahead: 2, git_behind: 1 },
    });

    const res = await postV2Complete({ commitShas: ["abc1234"], v2CompletionSync: "local-clean" }, auth);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("ahead") });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
  });

  it("allows server-proven local-only clean v2 completion with structured accepted state", async () => {
    const auth = installV2MemoryFixture({
      workerLauncher: {
        worktreePortTarget: {
          repoRoot: "/repo",
          branch: "leader-local-wt-1",
          worktreePath: "/worktrees/repo/leader-local-wt-1",
          sourceSessionNum: 7,
        },
      },
      workerState: {
        is_worktree: true,
        git_ahead: 2,
        git_behind: 1,
        git_default_branch: "",
        diff_base_branch: "",
        total_lines_added: 4,
      },
    });

    const res = await postV2Complete({ commitShas: ["abc1234"], v2CompletionSync: "local-clean" }, auth);

    expect(res.status).toBe(200);
  });

  it("applies the same v2 Memory guard to transition-done route shapes before mutation", async () => {
    const auth = installV2MemoryFixture({ quest: { feedback: [] } });
    const transitionSpy = vi.spyOn(questStore, "transitionQuest");

    const rejected = await app.request("/api/quests/q-1/transition", {
      method: "POST",
      headers: companionAuthHeaders(auth.callerId, auth.callerToken),
      body: JSON.stringify({
        status: "done",
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
      }),
    });

    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({
      error: expect.stringContaining("exactly one final memory statement"),
    });
    expect(questStore.completeQuest).not.toHaveBeenCalled();
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  it("allows transition-done after the shared v2 Memory guard passes", async () => {
    const auth = installV2MemoryFixture();
    const transitionSpy = vi.spyOn(questStore, "transitionQuest").mockResolvedValueOnce({
      id: "q-1-v4",
      questId: "q-1",
      title: "Quest",
      status: "done",
      description: "Ready",
      previousOwnerSessionIds: ["worker-1"],
      verificationItems: [],
      verificationInboxUnread: true,
    } as any);

    const res = await app.request("/api/quests/q-1/transition", {
      method: "POST",
      headers: companionAuthHeaders(auth.callerId, auth.callerToken),
      body: JSON.stringify({
        status: "done",
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
      }),
    });

    expect(res.status).toBe(200);
    expect(transitionSpy).toHaveBeenCalledWith(
      "q-1",
      expect.objectContaining({
        status: "done",
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
      }),
    );
  });

  it("applies the same v2 Memory guard to deprecated done route shapes", async () => {
    const auth = installV2MemoryFixture({ row: { waitForInput: ["n-1"] } });
    const transitionSpy = vi.spyOn(questStore, "transitionQuest");

    const res = await app.request("/api/quests/q-1/done", {
      method: "POST",
      headers: companionAuthHeaders(auth.callerId, auth.callerToken),
      body: JSON.stringify({
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
      }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("User Checkpoint") });
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  it("allows deprecated done after the shared v2 Memory guard passes", async () => {
    const auth = installV2MemoryFixture();
    const transitionSpy = vi.spyOn(questStore, "transitionQuest").mockResolvedValueOnce({
      id: "q-1-v4",
      questId: "q-1",
      title: "Quest",
      status: "done",
      description: "Ready",
      previousOwnerSessionIds: ["worker-1"],
      verificationItems: [],
      verificationInboxUnread: true,
    } as any);

    const res = await app.request("/api/quests/q-1/done", {
      method: "POST",
      headers: companionAuthHeaders(auth.callerId, auth.callerToken),
      body: JSON.stringify({
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
      }),
    });

    expect(res.status).toBe(200);
    expect(transitionSpy).toHaveBeenCalledWith(
      "q-1",
      expect.objectContaining({
        status: "done",
        debrief: "Completed the accepted work and final Memory closure.",
        debriefTldr: "Accepted work is complete with final Memory closure.",
      }),
    );
  });

  it("allows an authenticated leader to complete on behalf of a worker session", async () => {
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    vi.spyOn(questStore, "completeQuest").mockResolvedValueOnce({
      id: "q-1-v4",
      questId: "q-1",
      title: "Quest",
      status: "done",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
      verificationItems: [{ text: "Verify handoff", checked: false }],
      verificationInboxUnread: true,
    } as any);
    launcher.getSession.mockImplementation((sid: string) => {
      if (sid === "leader-1") {
        return { sessionId: "leader-1", state: "running", cwd: "/test", archived: false, isOrchestrator: true };
      }
      if (sid === "worker-1") {
        return { sessionId: "worker-1", state: "running", cwd: "/test", archived: false };
      }
      return undefined;
    });
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "leader-1" && token === "leader-token",
    );

    const res = await app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders("leader-1", "leader-token"),
      body: JSON.stringify({
        sessionId: "worker-1",
        verificationItems: [{ text: "Verify handoff", checked: false }],
      }),
    });

    expect(res.status).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalledWith("q-1", [{ text: "Verify handoff", checked: false }], {
      commitShas: undefined,
      sessionId: "worker-1",
    });
    expect(bridge.completeDoneBoardRowsForQuest).toHaveBeenCalledWith("q-1");
  });

  it("resolves numeric completion sessionId before leader authorization and lookup", async () => {
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    vi.spyOn(questStore, "completeQuest").mockResolvedValueOnce({
      id: "q-1-v4",
      questId: "q-1",
      title: "Quest",
      status: "done",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
      verificationItems: [{ text: "Verify handoff", checked: false }],
      verificationInboxUnread: true,
    } as any);
    launcher.resolveSessionId.mockImplementation((ref: string) => (ref === "42" ? "worker-1" : ref));
    launcher.getSession.mockImplementation((sid: string) => {
      if (sid === "leader-1") {
        return { sessionId: "leader-1", state: "running", cwd: "/test", archived: false, isOrchestrator: true };
      }
      if (sid === "worker-1") {
        return { sessionId: "worker-1", state: "running", cwd: "/test", archived: false };
      }
      return undefined;
    });
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "leader-1" && token === "leader-token",
    );

    const res = await app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders("leader-1", "leader-token"),
      body: JSON.stringify({
        sessionId: "42",
        verificationItems: [{ text: "Verify handoff", checked: false }],
      }),
    });

    expect(res.status).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalledWith("q-1", [{ text: "Verify handoff", checked: false }], {
      commitShas: undefined,
      sessionId: "worker-1",
    });
  });

  it("rejects non-leader completion for a different authenticated session", async () => {
    // Workers may complete their own quests, but only leaders can submit a
    // different worker's session id in the handoff payload.
    const completeSpy = vi.spyOn(questStore, "completeQuest");
    launcher.getSession.mockImplementation((sid: string) => {
      if (sid === "session-1") {
        return { sessionId: "session-1", state: "running", cwd: "/test", archived: false };
      }
      if (sid === "session-2") {
        return { sessionId: "session-2", state: "running", cwd: "/test", archived: false };
      }
      return undefined;
    });
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "session-1" && token === "tok-1",
    );

    const res = await app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders("session-1", "tok-1"),
      body: JSON.stringify({
        sessionId: "session-2",
        verificationItems: [{ text: "Verify handoff", checked: false }],
      }),
    });

    expect(res.status).toBe(403);
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it("allows an authenticated owner to complete without a body sessionId", async () => {
    // The normal claimed-quest path omits sessionId so the store preserves the
    // current owner instead of treating the authenticated caller as an override.
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "session-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    vi.spyOn(questStore, "completeQuest").mockResolvedValueOnce({
      id: "q-1-v4",
      questId: "q-1",
      title: "Quest",
      status: "done",
      sessionId: "session-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
      verificationItems: [{ text: "Verify handoff", checked: false }],
      verificationInboxUnread: true,
    } as any);
    launcher.getSession.mockImplementation((sid: string) =>
      sid === "session-1" ? { sessionId: "session-1", state: "running", cwd: "/test", archived: false } : undefined,
    );
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "session-1" && token === "tok-1",
    );

    const res = await app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders("session-1", "tok-1"),
      body: JSON.stringify({
        verificationItems: [{ text: "Verify handoff", checked: false }],
      }),
    });

    expect(res.status).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalledWith("q-1", [{ text: "Verify handoff", checked: false }], {
      commitShas: undefined,
    });
  });

  it("rejects non-owner completion when body sessionId is omitted", async () => {
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    const completeSpy = vi.spyOn(questStore, "completeQuest");
    launcher.getSession.mockImplementation((sid: string) =>
      sid === "session-1" ? { sessionId: "session-1", state: "running", cwd: "/test", archived: false } : undefined,
    );
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "session-1" && token === "tok-1",
    );

    const res = await app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders("session-1", "tok-1"),
      body: JSON.stringify({
        verificationItems: [{ text: "Verify handoff", checked: false }],
      }),
    });

    expect(res.status).toBe(403);
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it("does not rewrite ownership when an authenticated leader omits body sessionId", async () => {
    vi.spyOn(questStore, "getQuest").mockResolvedValueOnce({
      id: "q-1-v3",
      questId: "q-1",
      title: "Quest",
      status: "in_progress",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
    } as any);
    vi.spyOn(questStore, "completeQuest").mockResolvedValueOnce({
      id: "q-1-v4",
      questId: "q-1",
      title: "Quest",
      status: "done",
      sessionId: "worker-1",
      createdAt: Date.now(),
      claimedAt: Date.now(),
      description: "Ready",
      verificationItems: [{ text: "Verify handoff", checked: false }],
      verificationInboxUnread: true,
    } as any);
    launcher.getSession.mockImplementation((sid: string) =>
      sid === "leader-1"
        ? { sessionId: "leader-1", state: "running", cwd: "/test", archived: false, isOrchestrator: true }
        : undefined,
    );
    launcher.verifySessionAuthToken.mockImplementation(
      (sid: string, token: string) => sid === "leader-1" && token === "leader-token",
    );

    const res = await app.request("/api/quests/q-1/complete", {
      method: "POST",
      headers: companionAuthHeaders("leader-1", "leader-token"),
      body: JSON.stringify({
        verificationItems: [{ text: "Verify handoff", checked: false }],
      }),
    });

    expect(res.status).toBe(200);
    expect(questStore.completeQuest).toHaveBeenCalledWith("q-1", [{ text: "Verify handoff", checked: false }], {
      commitShas: undefined,
    });
  });
});
