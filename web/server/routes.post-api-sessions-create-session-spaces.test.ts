import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock env-manager and git-utils modules before any imports
vi.mock("./env-manager.js", () => ({
  listEnvs: vi.fn(() => Promise.resolve([])),
  getEnv: vi.fn(() => Promise.resolve(null)),
  getEffectiveImage: vi.fn(() => Promise.resolve(null)),
  createEnv: vi.fn(() => Promise.resolve(undefined)),
  updateEnv: vi.fn(() => Promise.resolve(undefined)),
  deleteEnv: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("node:child_process", () => {
  const execSyncMock = vi.fn((_cmd?: string) => "" as any);
  // exec mock: callback-based, delegates to execSync for consistent test behavior.
  // Attaches stdout/stderr to the error object so promisify(exec) can find them,
  // matching Node's custom exec promisify behavior.
  const execMock = vi.fn((...args: any[]) => {
    const cmd = args[0] as string;
    const callback = typeof args[1] === "function" ? args[1] : args[2];
    try {
      const result = execSyncMock(cmd);
      if (callback) callback(null, { stdout: result ?? "", stderr: "" });
    } catch (err) {
      const e = err as any;
      if (e.stdout === undefined) e.stdout = "";
      if (e.stderr === undefined) e.stderr = "";
      if (callback) callback(err, { stdout: e.stdout ?? "", stderr: e.stderr ?? "" });
    }
  });
  const execFileMock = vi.fn((_file?: string, _args?: string[], _options?: any, callback?: any) => {
    if (typeof _options === "function") callback = _options;
    if (callback) callback(null, { stdout: "", stderr: "" });
  });
  return { execSync: execSyncMock, exec: execMock, execFile: execFileMock };
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
    maxKeepAlive: 0,
    heavyRepoModeEnabled: false,
    namerConfig: { backend: "claude" },
    autoNamerEnabled: true,
    transcriptionConfig: {
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      enhancementEnabled: true,
      enhancementModel: "gpt-5-mini",
    },
    editorConfig: { editor: "none" },
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
    maxKeepAlive: patch.maxKeepAlive ?? 0,
    heavyRepoModeEnabled: patch.heavyRepoModeEnabled ?? false,
    namerConfig: patch.namerConfig ?? { backend: "claude" },
    autoNamerEnabled: patch.autoNamerEnabled ?? true,
    transcriptionConfig: patch.transcriptionConfig ?? {
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      enhancementEnabled: true,
      enhancementModel: "gpt-5-mini",
    },
    editorConfig: patch.editorConfig ?? { editor: "none" },
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
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import * as treeGroupStore from "./tree-group-store.js";
import { containerManager } from "./container-manager.js";
import { DEFAULT_SESSION_DEFAULTS } from "../shared/session-defaults.js";
import { _resetCodexModelCatalogCacheForTest, loadCodexModelCatalog } from "./codex-model-catalog.js";

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
    getMemorySessionSpaceSlug: vi.fn(() => "Takode"),
    setMemorySessionSpaceSlug: vi.fn(() => false),
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
    getLastUserMessage: vi.fn(() => undefined),
    isBackendConnected: vi.fn(() => false),
    markWorktree: vi.fn(),
    applyInitialSessionState: vi.fn(),
    setDiffBaseBranch: vi.fn(() => true),
    refreshGitInfoPublic: vi.fn(async () => true),
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
let treeGroupTempDir: string;
let homeDir: string;
let streamsDir: string;

async function cacheInstalledCodexModelsForTest(models: Array<Record<string, unknown>>): Promise<void> {
  await loadCodexModelCatalog({
    codexBinary: "/fake/codex",
    statImpl: (async () => ({ mtimeMs: 1, size: 1 })) as never,
    runCodexCommand: async (_binary, args) => ({
      stdout: args[0] === "--version" ? "codex-cli test" : JSON.stringify({ models }),
    }),
  });
}

function overrideSettingsForTest(sessionDefaults: typeof DEFAULT_SESSION_DEFAULTS): () => void {
  const originalGetSettings = vi.mocked(settingsManager.getSettings).getMockImplementation();
  vi.mocked(settingsManager.getSettings).mockImplementation(() => ({
    ...(originalGetSettings?.() ?? settingsManager.getSettings()),
    sessionDefaults,
  }));
  return () => {
    if (originalGetSettings) vi.mocked(settingsManager.getSettings).mockImplementation(originalGetSettings);
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  trafficStats.reset();
  _resetServerLoggerForTest();
  // Reset the LiteLLM model cache so each test starts clean.
  _resetModelCache();
  _resetCodexModelCatalogCacheForTest();
  // Stub global fetch to prevent LiteLLM proxy calls in tests.
  // Model endpoint tests exercise the fallback path (models_cache.json).
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no proxy in tests"))),
  );
  homeDir = mkdtempSync(join(tmpdir(), "routes-create-home-"));
  vi.stubEnv("HOME", homeDir);
  launcher = createMockLauncher();
  bridge = createMockBridge();
  sessionStore = createMockStore();
  tracker = createMockTracker();
  recorder = createMockRecorder();
  timerManager = createMockTimerManager();
  treeGroupTempDir = mkdtempSync(join(tmpdir(), "routes-create-tree-groups-"));
  treeGroupStore._resetForTest(join(treeGroupTempDir, "tree-groups.json"));
  streamsDir = (await import("./stream-store.js")).getStreamsDir();
  rmSync(streamsDir, { recursive: true, force: true });
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
  vi.mocked(envManager.getEffectiveImage).mockResolvedValue(null);
});

afterEach(async () => {
  await treeGroupStore._flushForTest();
  _resetCodexModelCatalogCacheForTest();
  vi.unstubAllEnvs();
  rmSync(treeGroupTempDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(streamsDir, { recursive: true, force: true });
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

describe("POST /api/sessions/create tree groups and memory session spaces", () => {
  it("persists explicit default tree group metadata during session creation", async () => {
    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test" }),
    });

    expect(res.status).toBe(200);
    expect(bridge.applyInitialSessionState).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ treeGroupId: "default" }),
    );
    expect(await treeGroupStore.getGroupForSession("session-1")).toBe("default");
  });

  it("persists tree group assignment during session creation", async () => {
    // The server must persist group membership as part of creation so a restart
    // cannot drop a newly-created grouped session back into Default.
    const group = await treeGroupStore.createGroup("Takode");

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test", treeGroupId: group.id }),
    });

    expect(res.status).toBe(200);
    expect(bridge.applyInitialSessionState).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ treeGroupId: group.id }),
    );
    expect(await treeGroupStore.getGroupForSession("session-1")).toBe(group.id);
    await treeGroupStore._flushForTest();

    treeGroupStore._resetForTest(join(treeGroupTempDir, "tree-groups.json"));
    expect(await treeGroupStore.getGroupForSession("session-1")).toBe(group.id);
  });

  it("uses the requested tree group name as the default memory session-space for Codex leaders", async () => {
    const group = await treeGroupStore.createGroup("MSI");

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backend: "codex",
        role: "orchestrator",
        cwd: "/test",
        treeGroupId: group.id,
      }),
    });

    expect(res.status).toBe(200);
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        backendType: "codex",
        memorySessionSpaceSlug: "MSI",
        env: expect.objectContaining({
          COMPANION_MEMORY_SPACE_SLUG: "MSI",
        }),
      }),
    );
    expect(bridge.applyInitialSessionState).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        treeGroupId: group.id,
        memorySessionSpaceSlug: "MSI",
      }),
    );
  });

  it("rejects a memory session-space slug that disagrees with the requested tree group", async () => {
    // A session's tree group decides its memory space. A request naming both
    // must not silently create a session grouped in one space that writes
    // memory into another, so the mismatch is refused before launch.
    const group = await treeGroupStore.createGroup("MSI");

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cwd: "/test",
        treeGroupId: group.id,
        memorySessionSpaceSlug: "ExplicitSpace",
      }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Memory space "ExplicitSpace" does not match session space "MSI"');
    expect(launcher.launch).not.toHaveBeenCalled();
  });

  it("accepts a memory session-space slug that matches the requested tree group", async () => {
    const group = await treeGroupStore.createGroup("MSI");

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test", treeGroupId: group.id, memorySessionSpaceSlug: "MSI" }),
    });

    expect(res.status).toBe(200);
    expect(bridge.applyInitialSessionState).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ treeGroupId: group.id, memorySessionSpaceSlug: "MSI" }),
    );
  });

  it("places a session in the tree group named by its memory space when no group is requested", async () => {
    // The replacement-leader incident: a direct create with role orchestrator,
    // memorySessionSpaceSlug MSI and no treeGroupId got MSI memory but landed
    // in Default. The memory space must now pick the matching session space.
    const group = await treeGroupStore.createGroup("MSI");

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "orchestrator", cwd: "/test", memorySessionSpaceSlug: "MSI" }),
    });

    expect(res.status).toBe(200);
    expect(bridge.applyInitialSessionState).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ treeGroupId: group.id, memorySessionSpaceSlug: "MSI" }),
    );
    expect(await treeGroupStore.getGroupForSession("session-1")).toBe(group.id);
  });

  it("puts the server's own memory space in Default when no named session space uses it", async () => {
    launcher.getMemorySessionSpaceSlug.mockReturnValue("Takode");

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test", memorySessionSpaceSlug: "Takode" }),
    });

    expect(res.status).toBe(200);
    expect(bridge.applyInitialSessionState).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ treeGroupId: "default", memorySessionSpaceSlug: "Takode" }),
    );
  });

  it("rejects a memory session-space slug that no session space uses", async () => {
    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test", memorySessionSpaceSlug: "Nowhere" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No session space uses memory space "Nowhere"');
    expect(launcher.launch).not.toHaveBeenCalled();
  });

  it("rejects a memory session-space slug shared by several session spaces", async () => {
    await treeGroupStore.createGroup("MSI");
    await treeGroupStore.createGroup("MSI");

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test", memorySessionSpaceSlug: "MSI" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("pass treeGroupId to pick one");
  });

  it("creates a leader as its creator's peer: same session space and memory space, not herded", async () => {
    // Leaders create replacement or extra leaders with createdBy so the new
    // leader inherits their session space, but a leader is never a worker:
    // it must not be herded, and the creator's grouping must still apply.
    const group = await treeGroupStore.createGroup("MSI");
    ensureBridgeSession(bridge, "leader-msi", { state: { treeGroupId: group.id } });
    launcher.getSession.mockImplementation((id: string) =>
      id === "leader-msi" ? { sessionId: id, isOrchestrator: true } : undefined,
    );

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backend: "codex",
        role: "orchestrator",
        cwd: "/test",
        createdBy: "leader-msi",
        memorySessionSpaceSlug: "MSI",
      }),
    });

    expect(res.status).toBe(200);
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({ isOrchestrator: true, memorySessionSpaceSlug: "MSI" }),
    );
    expect(launcher.herdSessions).not.toHaveBeenCalled();
    expect(bridge.applyInitialSessionState).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ treeGroupId: group.id, memorySessionSpaceSlug: "MSI" }),
    );
    expect(await treeGroupStore.getGroupForSession("session-1")).toBe(group.id);
  });

  it("uses the creator tree group as the default memory session-space for spawned sessions", async () => {
    const group = await treeGroupStore.createGroup("MSI");
    ensureBridgeSession(bridge, "leader-msi", { state: { treeGroupId: group.id } });

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cwd: "/test",
        createdBy: "leader-msi",
      }),
    });

    expect(res.status).toBe(200);
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        memorySessionSpaceSlug: "MSI",
        env: expect.objectContaining({
          COMPANION_MEMORY_SPACE_SLUG: "MSI",
        }),
      }),
    );
    expect(bridge.applyInitialSessionState).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        treeGroupId: group.id,
        memorySessionSpaceSlug: "MSI",
      }),
    );
  });

  it("keeps an explicit requested tree group visually authoritative when also spawned by a leader", async () => {
    // A create request can be both a leader spawn and an explicit placement into
    // another session space. The requested tree group must stay authoritative so
    // the visible group and default memory repo cannot diverge after launch.
    const leaderGroup = await treeGroupStore.createGroup("Takode");
    const requestedGroup = await treeGroupStore.createGroup("MSI");
    ensureBridgeSession(bridge, "leader-takode", { state: { treeGroupId: leaderGroup.id } });
    launcher.getSession.mockImplementation((id: string) =>
      id === "leader-takode" ? { sessionId: id, isOrchestrator: true } : undefined,
    );

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cwd: "/test",
        createdBy: "leader-takode",
        treeGroupId: requestedGroup.id,
      }),
    });

    expect(res.status).toBe(200);
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        memorySessionSpaceSlug: "MSI",
        env: expect.objectContaining({
          COMPANION_MEMORY_SPACE_SLUG: "MSI",
        }),
      }),
    );
    expect(launcher.herdSessions).toHaveBeenCalledWith("leader-takode", ["session-1"]);
    await Promise.resolve();
    await Promise.resolve();

    expect(bridge.applyInitialSessionState).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        treeGroupId: requestedGroup.id,
        memorySessionSpaceSlug: "MSI",
      }),
    );
    expect(await treeGroupStore.getGroupForSession("session-1")).toBe(requestedGroup.id);
    expect(await treeGroupStore.getGroupForSession("session-1")).not.toBe(leaderGroup.id);
  });

  it("syncs session metadata and assignment index on manual reassignment", async () => {
    const group = await treeGroupStore.createGroup("Reassigned");
    ensureBridgeSession(bridge, "s1", { state: { treeGroupId: "default" } });
    await treeGroupStore.assignSession("s1", "default");
    const streamStore = await import("./stream-store.js");
    const defaultScope = streamStore.streamScopeForSessionGroup("default", "test-server-id");
    const destinationScope = streamStore.streamScopeForSessionGroup(group.id, "test-server-id");
    await streamStore.createStream({ title: "Shared memory", scope: defaultScope, summary: "Source stream" });
    await streamStore.createStream({ title: "Shared memory", scope: destinationScope, summary: "Collision target" });

    const res = await app.request("/api/tree-groups/assign", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", groupId: group.id }),
    });

    expect(res.status).toBe(200);
    expect(bridge._sessions["s1"].state.treeGroupId).toBe(group.id);
    expect(bridge._sessions["s1"].state.memorySessionSpaceSlug).toBe("Reassigned");
    expect(launcher.setMemorySessionSpaceSlug).toHaveBeenCalledWith("s1", "Reassigned");
    expect(bridge.persistSessionById).toHaveBeenCalledWith("s1");
    expect(await treeGroupStore.getGroupForSession("s1")).toBe(group.id);
    expect(await streamStore.listStreams({ scope: defaultScope, includeArchived: true })).toEqual([]);
    expect(
      (await streamStore.listStreams({ scope: destinationScope, includeArchived: true }))
        .map((stream) => stream.title)
        .sort(),
    ).toEqual(["Default-Shared memory", "Shared memory"]);
  });

  it("syncs session metadata and assignment index on bulk reassignment", async () => {
    const group = await treeGroupStore.createGroup("Bulk Reassigned");
    ensureBridgeSession(bridge, "s1", { state: { treeGroupId: "default" } });
    ensureBridgeSession(bridge, "s2", { state: { treeGroupId: "default" } });
    await treeGroupStore.assignSession("s1", "default");
    await treeGroupStore.assignSession("s2", "default");

    const res = await app.request("/api/tree-groups/assign", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds: ["s1", "s2"], groupId: group.id }),
    });

    expect(res.status).toBe(200);
    expect(bridge._sessions["s1"].state.treeGroupId).toBe(group.id);
    expect(bridge._sessions["s2"].state.treeGroupId).toBe(group.id);
    expect(bridge.persistSessionById).toHaveBeenCalledWith("s1");
    expect(bridge.persistSessionById).toHaveBeenCalledWith("s2");
    expect(await treeGroupStore.getGroupForSession("s1")).toBe(group.id);
    expect(await treeGroupStore.getGroupForSession("s2")).toBe(group.id);
    await treeGroupStore._flushForTest();

    treeGroupStore._resetForTest(join(treeGroupTempDir, "tree-groups.json"));
    expect(await treeGroupStore.getGroupForSession("s1")).toBe(group.id);
    expect(await treeGroupStore.getGroupForSession("s2")).toBe(group.id);
  });

  it("keeps existing shared-group streams in the source group when another session remains", async () => {
    const group = await treeGroupStore.createGroup("Reassigned");
    ensureBridgeSession(bridge, "s1", { state: { treeGroupId: "default" } });
    ensureBridgeSession(bridge, "s2", { state: { treeGroupId: "default" } });
    await treeGroupStore.assignSession("s1", "default");
    await treeGroupStore.assignSession("s2", "default");
    const streamStore = await import("./stream-store.js");
    const defaultScope = streamStore.streamScopeForSessionGroup("default", "test-server-id");
    const destinationScope = streamStore.streamScopeForSessionGroup(group.id, "test-server-id");
    await streamStore.createStream({ title: "Shared memory", scope: defaultScope, summary: "Shared source stream" });

    const res = await app.request("/api/tree-groups/assign", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", groupId: group.id }),
    });

    expect(res.status).toBe(200);
    expect(bridge._sessions["s1"].state.treeGroupId).toBe(group.id);
    expect(await treeGroupStore.getGroupForSession("s1")).toBe(group.id);
    expect(await treeGroupStore.getGroupForSession("s2")).toBe("default");
    expect(
      (await streamStore.listStreams({ scope: defaultScope, includeArchived: true })).map((stream) => stream.title),
    ).toEqual(["Shared memory"]);
    expect(await streamStore.listStreams({ scope: destinationScope, includeArchived: true })).toEqual([]);
    expect(await streamStore.defaultStreamScope("/tmp/moved-session", "test-server-id", "s1")).toBe(destinationScope);
  });

  it("reassigns affected sessions to explicit default when deleting a group", async () => {
    const group = await treeGroupStore.createGroup("To Delete");
    ensureBridgeSession(bridge, "s1", { state: { treeGroupId: group.id } });
    launcher.listSessions.mockReturnValue([{ sessionId: "s1" }]);
    await treeGroupStore.assignSession("s1", group.id);
    const streamStore = await import("./stream-store.js");
    const sourceScope = streamStore.streamScopeForSessionGroup(group.id, "test-server-id");
    const defaultScope = streamStore.streamScopeForSessionGroup("default", "test-server-id");
    await streamStore.createStream({ title: "Keep me", scope: sourceScope, summary: "Migrated on delete" });

    const res = await app.request(`/api/tree-groups/groups/${group.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(bridge._sessions["s1"].state.treeGroupId).toBe("default");
    expect(await treeGroupStore.getGroupForSession("s1")).toBe("default");
    expect(await streamStore.listStreams({ scope: sourceScope, includeArchived: true })).toEqual([]);
    expect(
      (await streamStore.listStreams({ scope: defaultScope, includeArchived: true })).map((stream) => stream.title),
    ).toEqual(["Keep me"]);
  });

  it("passes an authoritative memory session-space slug into launch options and env", async () => {
    // The slug must name a session space; that space's group is then used.
    await treeGroupStore.createGroup("Other");
    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cwd: "/test",
        memorySessionSpaceSlug: "Other",
      }),
    });

    expect(res.status).toBe(200);
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        memorySessionSpaceSlug: "Other",
        env: expect.objectContaining({
          COMPANION_MEMORY_SPACE_SLUG: "Other",
        }),
      }),
    );
  });

  it("uses the server memory session-space default for create when the request omits an explicit slug", async () => {
    launcher.getMemorySessionSpaceSlug.mockReturnValue("Other");
    vi.mocked(envManager.getEnv).mockResolvedValue({
      name: "Stale Memory Space",
      slug: "stale-memory-space",
      variables: { COMPANION_MEMORY_SPACE_SLUG: "Takode", API_KEY: "secret123" },
      createdAt: 1000,
      updatedAt: 1000,
    });

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/test", envSlug: "stale-memory-space" }),
    });

    expect(res.status).toBe(200);
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        memorySessionSpaceSlug: "Other",
        env: expect.objectContaining({
          API_KEY: "secret123",
          COMPANION_MEMORY_SPACE_SLUG: "Other",
        }),
      }),
    );
  });

  it("uses the server memory session-space default for resume when the request omits an explicit slug", async () => {
    launcher.getMemorySessionSpaceSlug.mockReturnValue("Other");
    vi.mocked(envManager.getEnv).mockResolvedValue({
      name: "Stale Memory Space",
      slug: "stale-memory-space",
      variables: { COMPANION_MEMORY_SPACE_SLUG: "Takode", API_KEY: "secret123" },
      createdAt: 1000,
      updatedAt: 1000,
    });

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backend: "claude",
        cwd: "/test",
        envSlug: "stale-memory-space",
        resumeCliSessionId: "cli-resume-1",
      }),
    });

    expect(res.status).toBe(200);
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeCliSessionId: "cli-resume-1",
        memorySessionSpaceSlug: "Other",
        env: expect.objectContaining({
          API_KEY: "secret123",
          COMPANION_MEMORY_SPACE_SLUG: "Other",
        }),
      }),
    );
  });

  it("uses the requested tree group name as the memory session-space when resuming Codex sessions", async () => {
    const group = await treeGroupStore.createGroup("MSI");

    const res = await app.request("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backend: "codex",
        cwd: "/test",
        treeGroupId: group.id,
        resumeCliSessionId: "codex-resume-1",
      }),
    });

    expect(res.status).toBe(200);
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        backendType: "codex",
        resumeCliSessionId: "codex-resume-1",
        memorySessionSpaceSlug: "MSI",
        env: expect.objectContaining({
          COMPANION_MEMORY_SPACE_SLUG: "MSI",
        }),
      }),
    );
  });
});
