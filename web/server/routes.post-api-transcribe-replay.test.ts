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
  const execFileMock = vi.fn((...args: any[]) => {
    const callback = typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined;
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
    serverSlug: "prod",
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
    codexLeaderContextWindowOverrideTokens: 1_000_000,
    codexLeaderRecycleThresholdTokens: 260_000,
    updatedAt: 0,
  })),
  updateSettings: vi.fn((patch) => ({
    serverName: "",
    serverId: "",
    serverSlug: "prod",
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
  GPT_TRANSCRIBE_STT_MODEL: "gpt-transcribe",
}));

const mockGetUsageLimits = vi.hoisted(() => vi.fn());
vi.mock("./usage-limits.js", () => ({
  getUsageLimits: mockGetUsageLimits,
}));

import { Hono } from "hono";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
import { _setTranscriptionRecordingRootForTest } from "./transcription-recordings.js";
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

function mockVoiceSettings(overrides: Record<string, unknown> = {}) {
  vi.mocked(settingsManager.getSettings).mockReturnValue({
    serverName: "",
    serverId: "",
    serverSlug: "prod",
    pushoverUserKey: "",
    pushoverApiToken: "",
    pushoverDelaySeconds: 30,
    pushoverEnabled: true,
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
      apiKey: "transcription-secret",
      baseUrl: "https://api.openai.com/v1",
      enhancementEnabled: true,
      enhancementModel: "gpt-5-mini",
      ...overrides,
    },
    editorConfig: { editor: "none" },
    defaultClaudeBackend: "claude",
    sleepInhibitorEnabled: false,
    sleepInhibitorDurationMinutes: 5,
    codexLeaderContextWindowOverrideTokens: 1_000_000,
    codexLeaderRecycleThresholdTokens: 260_000,
    updatedAt: 123,
  } as any);
}

// ─── Test setup ──────────────────────────────────────────────────────────────

let app: Hono;
let launcher: ReturnType<typeof createMockLauncher>;
let bridge: ReturnType<typeof createMockBridge>;
let sessionStore: ReturnType<typeof createMockStore>;
let tracker: ReturnType<typeof createMockTracker>;
let recorder: ReturnType<typeof createMockRecorder>;
let timerManager: ReturnType<typeof createMockTimerManager>;
let transcriptionRecordingRoot: string;

beforeEach(async () => {
  vi.clearAllMocks();
  trafficStats.reset();
  _resetServerLoggerForTest();
  // Reset the LiteLLM model cache so each test starts clean.
  _resetModelCache();
  transcriptionEnhancer._resetTranscriptionLogForTest();
  transcriptionRecordingRoot = await mkdtemp(join(tmpdir(), "routes-transcription-recordings-"));
  _setTranscriptionRecordingRootForTest(transcriptionRecordingRoot);
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

afterEach(async () => {
  _setTranscriptionRecordingRootForTest(null);
  await rm(transcriptionRecordingRoot, { recursive: true, force: true });
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

describe("POST /api/transcribe replay and durable discovery", () => {
  it("re-transcribes a source recording with stored STT context into a durable child variant", async () => {
    mockVoiceSettings({
      baseUrl: "https://provider.example/v1/",
      enhancementEnabled: false,
      sttModel: "gpt-transcribe",
      customVocabulary: "Takode, ReplayTerm",
      sttLanguageHints: ["en"],
    });
    vi.mocked(sessionNames.getName).mockReturnValue("Replay source session");
    ensureBridgeSession(bridge, "session-1", {
      taskHistory: [{ title: "Replay transcription context" }],
      messageHistory: [],
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "original transcript" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "variant transcript" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "legacy variant transcript" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const form = new FormData();
    form.append("audio", new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], "recording.wav", { type: "audio/wav" }));
    form.append("backend", "openai");
    form.append("sessionId", "session-1");
    const sourceRes = await app.request("/api/transcribe", { method: "POST", body: form });
    expect(sourceRes.status).toBe(200);
    await sourceRes.text();
    const sourceId = transcriptionEnhancer.getTranscriptionLogIndex()[0].id;

    const replayRes = await app.request("/api/transcription-logs/" + sourceId + "/retranscribe", {
      method: "POST",
      body: JSON.stringify({ sttModel: "gpt-transcribe" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(replayRes.status).toBe(200);
    const replayBody = (await replayRes.json()) as { variant: { rawTranscript: string } };
    expect(replayBody.variant.rawTranscript).toBe("variant transcript");
    expect(fetch).toHaveBeenCalledTimes(2);
    const [, replayInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    const replayForm = replayInit.body as FormData;
    expect(replayForm.get("model")).toBe("gpt-transcribe");
    expect(replayForm.getAll("keywords[]")).toEqual(["Takode", "ReplayTerm"]);
    expect(replayForm.getAll("languages[]")).toEqual(["en"]);

    const legacyReplayRes = await app.request("/api/transcription-logs/" + sourceId + "/retranscribe", {
      method: "POST",
      body: JSON.stringify({ sttModel: "custom-legacy-transcribe" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(legacyReplayRes.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
    const [, legacyReplayInit] = vi.mocked(fetch).mock.calls[2] as [string, RequestInit];
    const legacyReplayForm = legacyReplayInit.body as FormData;
    const legacyPrompt = String(legacyReplayForm.get("prompt"));
    expect(legacyReplayForm.get("model")).toBe("custom-legacy-transcribe");
    expect(legacyReplayForm.getAll("keywords[]")).toEqual([]);
    expect(legacyReplayForm.getAll("languages[]")).toEqual([]);
    expect(legacyPrompt).toContain("Custom vocabulary: Takode, ReplayTerm");
    expect(legacyPrompt).toContain("Expected input languages: en");

    const detailRes = await app.request("/api/transcription-logs/" + sourceId);
    const detail = (await detailRes.json()) as { replayVariants?: Array<{ rawTranscript?: string }> };
    expect(detail.replayVariants?.map((variant) => variant.rawTranscript)).toEqual([
      "legacy variant transcript",
      "variant transcript",
    ]);
  });

  it("hydrates preview-bounded list, detail, audio, replay, aliases, and tombstones after restart", async () => {
    const sourceModel = "org/private";
    const sourceMimeType = "audio/webm;codecs=opus";
    const sourceAudio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    mockVoiceSettings({ enhancementEnabled: false, sttModel: sourceModel });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "persisted raw transcript" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "replayed after restart" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const sourceRes = await app.request("/api/transcribe?backend=openai", {
      method: "POST",
      body: sourceAudio,
      headers: {
        "Content-Type": sourceMimeType,
        "X-Companion-Audio-Filename": "restart.webm",
      },
    });
    expect(sourceRes.status).toBe(200);
    await sourceRes.text();
    const live = transcriptionEnhancer.getTranscriptionLogIndex()[0];
    expect(live.recordingKey).toEqual(expect.stringMatching(/^r_/));
    const mergedCurrentRes = await app.request("/api/transcription-logs?limit=50&refresh=1");
    await expect(mergedCurrentRes.json()).resolves.toEqual([
      expect.objectContaining({ previewText: "persisted raw transcript" }),
    ]);

    // Clearing the process-local hot cache simulates a server restart while preserving the isolated recording root.
    transcriptionEnhancer._resetTranscriptionLogForTest();
    const indexRes = await app.request("/api/transcription-logs?limit=50&refresh=1");
    expect(indexRes.status).toBe(200);
    expect(indexRes.headers.get("X-Total-Count")).toBe("1");
    const index = (await indexRes.json()) as Array<Record<string, unknown>>;
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({
      recordingKey: live.recordingKey,
      sttModel: sourceModel,
      audioMimeType: "audio/webm",
      enhancement: null,
      previewText: "persisted raw transcript",
    });
    expect(index[0]).not.toHaveProperty("rawTranscript");
    expect(index[0]).not.toHaveProperty("sttPrompt");
    expect(index[0]).not.toHaveProperty("replayVariants");
    expect(index[0]).not.toHaveProperty("recordingDirectoryPath");
    expect(index[0]).not.toHaveProperty("recordingManifestPath");

    const replaySource = await transcriptionEnhancer.getTranscriptionReplaySource(live.recordingKey!);
    expect(replaySource).toMatchObject({ sttModel: sourceModel, audioMimeType: sourceMimeType });

    const stableDetailRes = await app.request(`/api/transcription-logs/${live.recordingKey}`);
    expect(stableDetailRes.status).toBe(200);
    await expect(stableDetailRes.json()).resolves.toMatchObject({ rawTranscript: "persisted raw transcript" });
    const compatibilityId = Number(index[0].id);
    const numericDetailRes = await app.request(`/api/transcription-logs/${compatibilityId}`);
    expect(numericDetailRes.status).toBe(200);

    const audioRes = await app.request(`/api/transcription-logs/${live.recordingKey}/audio`);
    expect(audioRes.status).toBe(200);
    expect(new Uint8Array(await audioRes.arrayBuffer())).toEqual(sourceAudio);

    const replayRes = await app.request(`/api/transcription-logs/${live.recordingKey}/retranscribe`, {
      method: "POST",
      body: JSON.stringify({ sttModel: sourceModel }),
      headers: { "Content-Type": "application/json" },
    });
    expect(replayRes.status).toBe(200);
    await expect(replayRes.json()).resolves.toMatchObject({ variant: { rawTranscript: "replayed after restart" } });
    const [, replayInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    const replayForm = replayInit.body as FormData;
    expect(replayForm.get("model")).toBe(sourceModel);
    expect((replayForm.get("file") as File).type).toBe("audio/webm");

    const deleteRes = await app.request(`/api/transcription-logs/${live.recordingKey}/recording`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toMatchObject({ recordingDeletedAt: expect.any(Number) });
    transcriptionEnhancer._resetTranscriptionLogForTest();
    const deletedIndexRes = await app.request("/api/transcription-logs?limit=50&refresh=1");
    const [deleted] = (await deletedIndexRes.json()) as Array<Record<string, unknown>>;
    expect(deleted).toMatchObject({ recordingKey: live.recordingKey, discoveryState: "deleted" });
    expect(deleted).not.toHaveProperty("previewText");
    expect(
      (await app.request(`/api/transcription-logs/${live.recordingKey}/recording/open`, { method: "POST" })).status,
    ).toBe(410);
    const deletedAudioRes = await app.request(`/api/transcription-logs/${live.recordingKey}/audio`);
    expect(deletedAudioRes.status).toBe(410);
    await expect(deletedAudioRes.json()).resolves.toMatchObject({ code: "recording_deleted" });
    expect(
      (await app.request(`/api/transcription-logs/${live.recordingKey}/retranscribe`, { method: "POST" })).status,
    ).toBe(410);
  });

  it("returns explicit unavailable audio states for known non-ready records and 404 only for unknown locators", async () => {
    const dateRoot = join(transcriptionRecordingRoot, "2026-07-28");
    await mkdir(join(dateRoot, "incomplete"), { recursive: true });
    await mkdir(join(dateRoot, "malformed"), { recursive: true });
    await writeFile(join(dateRoot, "malformed", "manifest.json"), "{bad-json", "utf-8");
    transcriptionEnhancer._resetTranscriptionLogForTest();

    const indexRes = await app.request("/api/transcription-logs?refresh=1");
    const index = (await indexRes.json()) as Array<{
      recordingKey: string;
      discoveryState: string;
      audioUrl?: string;
      previewText?: string;
    }>;
    expect(index).toHaveLength(2);
    for (const entry of index) {
      expect(entry.audioUrl).toBeUndefined();
      expect(entry.previewText).toBeUndefined();
      const audioRes = await app.request(`/api/transcription-logs/${entry.recordingKey}/audio`);
      expect(audioRes.status).toBe(409);
      await expect(audioRes.json()).resolves.toMatchObject({ code: `recording_${entry.discoveryState}` });
    }
    const unknown = await app.request("/api/transcription-logs/r_dW5rbm93bi9yZWNvcmQ/audio");
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toMatchObject({ code: "recording_not_found" });
  });

  it("recursively keeps absolute persistence and provider diagnostics out of the metadata index", async () => {
    const datePath = join(transcriptionRecordingRoot, new Date().toISOString().slice(0, 10));
    await writeFile(datePath, "block recording directory creation", "utf-8");
    const absoluteDiagnostic = join(transcriptionRecordingRoot, "private", "artifact.txt");
    const pathLikeModel = `custom:${absoluteDiagnostic}`;
    const detail = await transcriptionEnhancer.addTranscriptionLogEntry({
      status: "error",
      sessionId: absoluteDiagnostic,
      mode: "dictation",
      backend: "openai",
      uploadDurationMs: 1,
      sttModel: pathLikeModel,
      sttDurationMs: 2,
      rawTranscript: `raw ${absoluteDiagnostic}`,
      audioBytes: Buffer.from([1]),
      audioSizeBytes: 1,
      audioMimeType: absoluteDiagnostic,
      audioFileName: absoluteDiagnostic,
      audioExtension: "wav",
      sttPrompt: `prompt ${absoluteDiagnostic}`,
      enhancement: {
        model: "gpt-5-mini",
        systemPrompt: absoluteDiagnostic,
        userMessage: absoluteDiagnostic,
        enhancedText: absoluteDiagnostic,
        durationMs: 3,
        skipReason: `API error at ${absoluteDiagnostic}`,
      },
      frontendTiming: null,
      error: { message: `provider failed at ${absoluteDiagnostic}`, phase: "transcribe" },
    });
    expect(detail.recordingPersistenceError).toContain(transcriptionRecordingRoot);
    expect(detail).toMatchObject({ sttModel: pathLikeModel, audioMimeType: absoluteDiagnostic });

    const detailRes = await app.request(`/api/transcription-logs/${detail.id}`);
    expect(detailRes.status).toBe(200);
    await expect(detailRes.json()).resolves.toMatchObject({
      sttModel: pathLikeModel,
      audioMimeType: absoluteDiagnostic,
      recordingPersistenceError: expect.stringContaining(transcriptionRecordingRoot),
    });

    const indexRes = await app.request("/api/transcription-logs?refresh=1");
    const index = (await indexRes.json()) as unknown;
    expect(index).toEqual([
      expect.objectContaining({
        statusReason: "persistence_error",
        sttModel: "unknown",
        audioMimeType: null,
        audioAvailable: false,
        enhancement: expect.objectContaining({ skipReasonCode: "provider_error" }),
      }),
    ]);
    const forbiddenKeys = new Set([
      "rawTranscript",
      "enhancedText",
      "sttPrompt",
      "systemPrompt",
      "userMessage",
      "inputContext",
      "result",
      "replayVariants",
      "artifacts",
      "recordingPersistenceError",
      "recordingDirectoryPath",
      "recordingManifestPath",
      "discoveryIssue",
      "error",
    ]);
    const visit = (value: unknown): void => {
      if (typeof value === "string") {
        expect(value).not.toContain(transcriptionRecordingRoot);
        expect(value).not.toContain(absoluteDiagnostic);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        expect(forbiddenKeys.has(key)).toBe(false);
        visit(child);
      }
    };
    visit(index);
  });

  it("re-enhances a source transcript with selected model and style into a durable child variant", async () => {
    mockVoiceSettings({
      enhancementEnabled: false,
      sttModel: "gpt-transcribe",
      customVocabulary: "Takode",
    });
    vi.mocked(sessionNames.getName).mockReturnValue("Enhance replay session");
    ensureBridgeSession(bridge, "session-1", {
      taskHistory: [{ title: "Replay enhancement context" }],
      messageHistory: [],
    });
    const longTranscript =
      "This is a deliberately long replay transcript with enough words and characters for the enhancement path to run with useful context and produce a cleaned output.";
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: longTranscript }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "cleaned replay output" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const form = new FormData();
    form.append("audio", new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], "recording.wav", { type: "audio/wav" }));
    form.append("backend", "openai");
    form.append("sessionId", "session-1");
    const sourceRes = await app.request("/api/transcribe", { method: "POST", body: form });
    expect(sourceRes.status).toBe(200);
    await sourceRes.text();
    const sourceId = transcriptionEnhancer.getTranscriptionLogIndex()[0].id;

    const replayRes = await app.request("/api/transcription-logs/" + sourceId + "/reenhance", {
      method: "POST",
      body: JSON.stringify({ enhancementModel: "gpt-5.5", enhancementMode: "bullet" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(replayRes.status).toBe(200);
    const replayBody = (await replayRes.json()) as { variant: { enhancedText: string; enhancementMode: string } };
    expect(replayBody.variant.enhancedText).toBe("cleaned replay output");
    expect(replayBody.variant.enhancementMode).toBe("bullet");
    const [chatUrl, chatInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(chatUrl).toBe("https://api.openai.com/v1/chat/completions");
    const chatBody = JSON.parse(String(chatInit.body)) as { model: string; messages: Array<{ content: string }> };
    expect(chatBody.model).toBe("gpt-5.5");
    expect(chatBody.messages[1].content).toContain("Replay enhancement context");
  });
});
