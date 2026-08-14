import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const diagnosticsByThread = vi.hoisted(
  () => new Map<string, { version: "disabled" | "v1" | "v2" | null; mode?: string | null }>(),
);
const readDiagnostics = vi.hoisted(() => vi.fn());

vi.mock("./codex-rollout-runtime-diagnostics.js", () => ({
  readCodexRolloutRuntimeDiagnostics: readDiagnostics,
}));

import { CodexWorkerV2RolloutService } from "./codex-worker-v2-rollout-service.js";
import { CODEX_WORKER_V2_HANDOFF_DEFAULT_MAX_HISTORY_SCAN_ENTRIES } from "./codex-worker-v2-handoff.js";

function diagnostics(version: "disabled" | "v1" | "v2" | null, mode: string | null = null) {
  return {
    codexEffectiveMultiAgentVersion: version,
    codexEffectiveMultiAgentMode: mode,
    codexEffectiveMultiAgentVersionReported: version !== null,
    codexMultiAgentRuntimeDiagnostics: {
      source: "retained_rollout" as const,
      status: version === null ? "turn_context_missing" : "reported",
      sessionMetaMatched: true,
      cliVersion: "0.144.1",
      turnId: version === null ? null : `turn-${version}`,
      observedAt: version === null ? null : 1_786_683_600_000,
      scannedBytes: 512,
      scanTruncated: false,
    },
  };
}

type FakeLauncherSession = ReturnType<typeof launcherSession>;
type FakeBridgeSession = ReturnType<typeof bridgeSession>;

function launcherSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "worker-1",
    sessionNum: 101,
    name: "Worker One",
    state: "connected",
    backendType: "codex",
    archived: false,
    isOrchestrator: false,
    reviewerOf: undefined,
    hidden: false,
    publicSessionNumber: true,
    herdedBy: "leader-1",
    treeGroupId: "takode-workers",
    memorySessionSpaceSlug: "Takode",
    model: "gpt-5.6-sol",
    permissionMode: "codex-auto-review",
    askPermission: true,
    uiMode: "agent",
    codexInternetAccess: true,
    codexSandbox: "workspace-write",
    codexReasoningEffort: "ultra",
    codexServiceTier: "priority",
    codexMaxContextLength: 545_000,
    cwd: "/repo/worktrees/worker-one",
    repoRoot: "/repo",
    isWorktree: true,
    branch: "jiayi",
    actualBranch: "jiayi-wt-worker-one",
    worktreePortTarget: { repoRoot: "/repo", branch: "jiayi", sourceSessionId: "leader-1" },
    cliSessionId: "thread-v1",
    ...overrides,
  } as any;
}

function bridgeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "worker-1",
    backendType: "codex",
    state: {
      session_id: "worker-1",
      treeGroupId: "takode-workers",
      memorySessionSpaceSlug: "Takode",
      backend_state: "connected",
      claimedQuestId: "q-test",
      claimedQuestTitle: "Preserve rollout state",
      claimedQuestStatus: "in_progress",
      claimedQuestLeaderSessionId: "leader-1",
      repo_root: "/repo",
      git_branch: "jiayi-wt-worker-one",
      diff_base_branch: "jiayi",
      backend_reconnect: { attempt: 1, maxAttempts: 5, cycleStartedAt: 100 },
      codex_provider_retry: {
        family: "model_backend_stream_error",
        ownerId: "pending-user",
        attempt: 1,
        maxAttempts: 3,
        startedAt: 100,
      },
      codex_result_error_auto_pause: null,
      pause: null,
    },
    board: new Map([["q-test", { activePhaseId: "work", status: "WORKING" }]]),
    messageHistory: [
      { type: "user_message", id: "history-user", content: "Continue the approved implementation." },
      {
        type: "assistant",
        message: { id: "history-assistant", role: "assistant", content: [{ type: "text", text: "Context kept." }] },
      },
    ],
    pendingCodexInputs: [
      { id: "pending-input", userMessageId: "pending-user", content: "Queued follow-up", cancelable: true },
    ],
    pendingCodexTurns: [
      {
        turnId: "pending-turn",
        userMessageId: "pending-user",
        status: "queued",
        adapterMsg: { type: "codex_start_pending" },
      },
    ],
    pendingPermissions: new Map(),
    recoveryDeliveryTransfers: [{ transferId: "transfer-1", status: "pending", message: { content: "held" } }],
    pendingCodexRollback: null,
    pendingCodexRollbackError: null,
    pendingMessages: [JSON.stringify({ type: "mcp_get_status" })],
    queuedTurnStarts: 1,
    queuedTurnReasons: ["queued_user_message"],
    queuedTurnUserMessageIds: [[1]],
    queuedTurnInterruptSources: [null],
    queuedTurnActiveRoutes: [{ threadKey: "main" }],
    codexFreshTurnRequiredUntilTurnId: null,
    codexPendingDeliveryProofSignals: [{ kind: "queued", observedAt: 1 }],
    consecutiveAdapterFailures: 1,
    lastAdapterFailureAt: 123,
    provisionalStuckRecovery: null,
    codexAdapter: { getCurrentTurnId: () => null },
    isGenerating: false,
    interruptedDuringTurn: false,
    relaunchPending: false,
    _attached: true,
    _connected: true,
    _paused: false,
    ...overrides,
  } as any;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function preservationView(info: FakeLauncherSession, session: FakeBridgeSession) {
  return {
    launch: {
      model: info.model,
      permissionMode: info.permissionMode,
      askPermission: info.askPermission,
      uiMode: info.uiMode,
      codexInternetAccess: info.codexInternetAccess,
      codexSandbox: info.codexSandbox,
      codexReasoningEffort: info.codexReasoningEffort,
      codexServiceTier: info.codexServiceTier,
      codexMaxContextLength: info.codexMaxContextLength,
      cwd: info.cwd,
      repoRoot: info.repoRoot,
      isWorktree: info.isWorktree,
      branch: info.branch,
      actualBranch: info.actualBranch,
      worktreePortTarget: clone(info.worktreePortTarget),
    },
    quest: {
      claimedQuestId: session.state.claimedQuestId,
      claimedQuestTitle: session.state.claimedQuestTitle,
      claimedQuestStatus: session.state.claimedQuestStatus,
      claimedQuestLeaderSessionId: session.state.claimedQuestLeaderSessionId,
      board: [...session.board.entries()],
    },
    recovery: {
      recoveryDeliveryTransfers: clone(session.recoveryDeliveryTransfers),
      pendingCodexRollback: clone(session.pendingCodexRollback),
      pendingCodexRollbackError: session.pendingCodexRollbackError,
      pendingMessages: clone(session.pendingMessages),
      queuedTurnStarts: session.queuedTurnStarts,
      queuedTurnReasons: clone(session.queuedTurnReasons),
      queuedTurnUserMessageIds: clone(session.queuedTurnUserMessageIds),
      queuedTurnInterruptSources: clone(session.queuedTurnInterruptSources),
      queuedTurnActiveRoutes: clone(session.queuedTurnActiveRoutes),
      codexPendingDeliveryProofSignals: clone(session.codexPendingDeliveryProofSignals),
      backendReconnect: clone(session.state.backend_reconnect),
      codexProviderRetry: clone(session.state.codex_provider_retry),
    },
    identity: {
      sessionId: info.sessionId,
      sessionNum: info.sessionNum,
      herdedBy: info.herdedBy,
      treeGroupId: info.treeGroupId,
      memorySessionSpaceSlug: info.memorySessionSpaceSlug,
      stateSessionId: session.state.session_id,
      stateTreeGroupId: session.state.treeGroupId,
      stateMemorySessionSpaceSlug: session.state.memorySessionSpaceSlug,
      board: [...session.board.entries()],
    },
    history: clone(session.messageHistory),
    pendingInputs: clone(session.pendingCodexInputs),
    pendingTurns: clone(session.pendingCodexTurns),
  };
}

function makeHarness(
  options: {
    info?: FakeLauncherSession;
    bridge?: FakeBridgeSession;
    relaunchResults?: Array<{ ok: boolean; error?: string }>;
    emitSessionMetaOnRelaunch?: boolean[];
  } = {},
) {
  const info = options.info ?? launcherSession();
  const session = options.bridge ?? bridgeSession();
  const relaunchResults = [...(options.relaunchResults ?? [{ ok: true }])];
  const emitSessionMetaOnRelaunch = [...(options.emitSessionMetaOnRelaunch ?? [])];
  let freshThreadCounter = 0;
  let service!: CodexWorkerV2RolloutService;

  const launcher = {
    listSessions: vi.fn(() => [info]),
    getSession: vi.fn((sessionId: string) => (sessionId === info.sessionId ? info : undefined)),
    updateSessionLaunchConfig: vi.fn((sessionId: string, updates: Record<string, unknown>) => {
      if (sessionId !== info.sessionId) return undefined;
      for (const [key, value] of Object.entries(updates)) (info as Record<string, unknown>)[key] = value;
      return info;
    }),
    relaunch: vi.fn(async (sessionId: string) => {
      if (sessionId !== info.sessionId) return { ok: false, error: "missing session" };
      const result = relaunchResults.shift() ?? { ok: true };
      if (result.ok) {
        if (info.codexMultiAgentVersion === "v2") {
          freshThreadCounter += 1;
          info.cliSessionId = `thread-v2-${freshThreadCounter}`;
        } else if (info.codexMultiAgentVersion === "v1" && !info.cliSessionId) {
          freshThreadCounter += 1;
          info.cliSessionId = `thread-v1-fresh-${freshThreadCounter}`;
        }
        if (info.cliSessionId && (emitSessionMetaOnRelaunch.shift() ?? true)) {
          await (service as any).beforeSessionMetaDispatch(info.sessionId, info.cliSessionId);
        }
      }
      return result;
    }),
  } as any;

  const wsBridge = {
    getSession: vi.fn((sessionId: string) => (sessionId === info.sessionId ? session : undefined)),
    isBackendAttached: vi.fn((sessionId: string) => sessionId === info.sessionId && session._attached),
    isBackendConnected: vi.fn((sessionId: string) => sessionId === info.sessionId && session._connected),
    isSessionPaused: vi.fn((sessionId: string) => sessionId === info.sessionId && session._paused),
  } as any;

  service = new CodexWorkerV2RolloutService({ launcher, wsBridge, retryMs: 60_000 });
  return { service, launcher, wsBridge, info, session };
}

async function drain(service: CodexWorkerV2RolloutService) {
  return service.schedule("test-drain");
}

beforeEach(() => {
  diagnosticsByThread.clear();
  readDiagnostics.mockReset();
  readDiagnostics.mockImplementation(async (_home: string, threadId: string) => {
    const observation = diagnosticsByThread.get(threadId) ?? { version: null };
    return diagnostics(observation.version, observation.mode ?? null);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe.sequential("CodexWorkerV2RolloutService", () => {
  it("fresh-cuts a connected idle worker and preserves all Takode-owned state", async () => {
    // Existing connected workers migrate through a fresh thread while model,
    // effort, permissions, quest/worktree identity, history, and delivery queues stay authoritative.
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    diagnosticsByThread.set("thread-v2-1", { version: "v2", mode: "proactive" });
    const harness = makeHarness();
    const before = preservationView(harness.info, harness.session);

    const result = await harness.service.schedule("connected-idle");

    expect(result?.results[0]).toMatchObject({ action: "migrated", reason: "cutover_complete" });
    expect(harness.info.codexMultiAgentVersion).toBe("v2");
    expect(harness.info.cliSessionId).toBe("thread-v2-1");
    expect(harness.launcher.relaunch).toHaveBeenCalledTimes(1);
    expect(harness.info.codexWorkerV2Cutover).toBeUndefined();
    expect(preservationView(harness.info, harness.session)).toEqual(before);
    await harness.service.destroy();
  });

  it.each([
    ["active turn", bridgeSession({ isGenerating: true }), "active_turn"],
    [
      "pending permission",
      bridgeSession({ pendingPermissions: new Map([["permission-1", {}]]) }),
      "pending_permission",
    ],
  ])("defers %s without mutating launch or session state", async (_label, session, expectedReason) => {
    // Cutover must never interrupt generation or bypass a pending human permission decision.
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    const harness = makeHarness({ bridge: session });
    const before = preservationView(harness.info, harness.session);

    const result = await harness.service.schedule("unsafe-runtime");

    expect(result?.results[0]).toMatchObject({ action: "deferred", reason: expectedReason });
    expect(harness.launcher.relaunch).not.toHaveBeenCalled();
    expect(harness.info.codexMultiAgentVersion).toBeUndefined();
    expect(preservationView(harness.info, harness.session)).toEqual(before);
    await harness.service.destroy();
  });

  it("does not override an explicit V1 choice made during preparation", async () => {
    // The launcher selection is mutable server authority. If it changes after
    // the controller snapshot, preparation must fail closed before writing V2.
    const harness = makeHarness();
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    readDiagnostics.mockImplementationOnce(async () => {
      harness.info.codexMultiAgentVersion = "v1";
      return diagnostics("v1");
    });

    const result = await harness.service.schedule("selected-v1-race");

    expect(result?.results[0]).toMatchObject({ action: "failed", reason: "prepare_failed" });
    expect(harness.info.codexMultiAgentVersion).toBe("v1");
    expect(harness.info.cliSessionId).toBe("thread-v1");
    expect(harness.launcher.relaunch).not.toHaveBeenCalled();
    await harness.service.destroy();
  });

  it("restores the prior implicit selection when a worker becomes active during preparation", async () => {
    // A race before relaunch is a defer, not a V2 failure. Restoring explicit V1
    // here would permanently opt the worker out instead of retrying once idle.
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    const session = bridgeSession();
    let generatingReads = 0;
    Object.defineProperty(session, "isGenerating", {
      configurable: true,
      get: () => {
        generatingReads += 1;
        return generatingReads >= 3;
      },
    });
    const harness = makeHarness({ bridge: session });

    const result = await harness.service.schedule("became-active-race");

    expect(result?.results[0]).toMatchObject({ action: "deferred", reason: "became_active" });
    expect(harness.launcher.relaunch).not.toHaveBeenCalled();
    expect(harness.info.codexMultiAgentVersion).toBeUndefined();
    expect(harness.info.cliSessionId).toBe("thread-v1");
    await harness.service.destroy();
  });

  it("stages a disconnected worker and advances only after its next session_meta", async () => {
    // Disconnected workers retain their old process state until the next legitimate
    // resume, where the first replacement metadata transitions to proof waiting.
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    const info = launcherSession({ state: "exited" });
    const session = bridgeSession({
      state: { ...bridgeSession().state, backend_state: "disconnected" },
      _attached: false,
      _connected: false,
    });
    const harness = makeHarness({ info, bridge: session });

    const staged = await harness.service.schedule("disconnected");
    expect(staged?.results[0]).toMatchObject({ action: "staged", reason: "prepared_for_next_resume" });
    expect(harness.launcher.relaunch).not.toHaveBeenCalled();
    expect(harness.info.codexMultiAgentVersion).toBe("v2");
    expect(harness.info.cliSessionId).toBeUndefined();
    expect(harness.info.codexWorkerV2Cutover).toBeDefined();

    harness.info.state = "connected";
    harness.session.state.backend_state = "connected";
    harness.session._attached = true;
    harness.session._connected = true;
    harness.info.cliSessionId = "thread-v2-resumed";
    diagnosticsByThread.set("thread-v2-resumed", { version: null });
    await (harness.service as any).beforeSessionMetaDispatch(harness.info.sessionId, "thread-v2-resumed");
    const awaiting = await drain(harness.service);

    expect(awaiting?.results[0]).toMatchObject({ action: "awaiting_effective", reason: "awaiting_first_turn" });
    expect(harness.info.codexWorkerV2Cutover).toBeDefined();
    expect(harness.launcher.relaunch).not.toHaveBeenCalled();
    await harness.service.destroy();
  });

  it("adopts selected V2 when retained runtime evidence already proves it", async () => {
    // Existing effective-V2 workers need only launcher-state adoption; a fresh
    // thread would destroy the thread-sticky evidence we are trying to preserve.
    diagnosticsByThread.set("thread-v1", { version: "v2", mode: "proactive" });
    const harness = makeHarness();

    const result = await harness.service.schedule("adopt-effective-v2");

    expect(result?.results[0]).toMatchObject({ action: "unchanged", reason: "effective_v2" });
    expect(harness.info.codexMultiAgentVersion).toBe("v2");
    expect(harness.info.cliSessionId).toBe("thread-v1");
    expect(harness.launcher.relaunch).not.toHaveBeenCalled();
    await harness.service.destroy();
  });

  it("retains rollback provenance while a replacement thread awaits its first turn", async () => {
    // session_meta alone cannot prove V2; the service must wait for a real retained
    // turn_context without manufacturing a model turn or rolling back early.
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    diagnosticsByThread.set("thread-v2-1", { version: null });
    const harness = makeHarness();

    const result = await harness.service.schedule("await-first-turn");

    expect(result?.results[0]).toMatchObject({ action: "awaiting_effective", reason: "awaiting_first_turn" });
    expect(harness.info.codexMultiAgentVersion).toBe("v2");
    expect(harness.info.cliSessionId).toBe("thread-v2-1");
    expect(harness.info.codexWorkerV2Cutover).toBeDefined();
    expect(harness.launcher.relaunch).toHaveBeenCalledTimes(1);
    await harness.service.destroy();
  });

  it("rolls an explicit effective mismatch back to the prior V1 thread", async () => {
    // A replacement thread that reports V1 is a stop signal: restore the prior
    // thread identity and explicit V1 selection before any later worker input.
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    diagnosticsByThread.set("thread-v2-1", { version: "v1", mode: "explicitRequestOnly" });
    const harness = makeHarness({ relaunchResults: [{ ok: true }, { ok: true }] });

    const result = await harness.service.schedule("mismatch");

    expect(result?.results[0]).toMatchObject({ action: "rolled_back", reason: "effective_version_mismatch" });
    expect(harness.info.codexMultiAgentVersion).toBe("v1");
    expect(harness.info.cliSessionId).toBe("thread-v1");
    expect(harness.info.codexWorkerV2Cutover).toMatchObject({ status: "rolled_back", effectiveVersion: "v1" });
    expect(harness.launcher.relaunch).toHaveBeenCalledTimes(2);
    await harness.service.destroy();
  });

  it("restores the prior V1 thread when the fresh V2 relaunch fails", async () => {
    // A launch failure still owns a safe rollback attempt; the failed replacement
    // must not leave selected V2 paired with the cleared original thread id.
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    const harness = makeHarness({
      relaunchResults: [{ ok: false, error: "fresh V2 spawn failed" }, { ok: true }],
    });

    const result = await harness.service.schedule("relaunch-failure");

    expect(result?.results[0]).toMatchObject({
      action: "rolled_back",
      reason: "relaunch_failed",
      detail: "fresh V2 spawn failed",
    });
    expect(harness.info.codexMultiAgentVersion).toBe("v1");
    expect(harness.info.cliSessionId).toBe("thread-v1");
    expect(harness.info.codexWorkerV2Cutover).toMatchObject({ status: "rolled_back", effectiveVersion: "v1" });
    expect(harness.launcher.relaunch).toHaveBeenCalledTimes(2);
    await harness.service.destroy();
  });

  it("retains rollback-failed provenance when the V1 recovery relaunch also fails", async () => {
    // A double launch failure must halt the batch with selected V1 and enough
    // durable state for inspection instead of erasing the failed recovery attempt.
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    const harness = makeHarness({
      relaunchResults: [
        { ok: false, error: "fresh V2 spawn failed" },
        { ok: false, error: "V1 recovery spawn failed" },
      ],
    });

    const result = await harness.service.schedule("rollback-relaunch-failure");

    expect(result?.results[0]).toMatchObject({
      action: "rollback_failed",
      reason: "relaunch_failed",
      detail: "V1 recovery spawn failed",
    });
    expect(result?.halted).toBe(true);
    expect(harness.info.codexMultiAgentVersion).toBe("v1");
    expect(harness.info.cliSessionId).toBe("thread-v1");
    expect(harness.info.codexWorkerV2Cutover).toMatchObject({
      status: "rollback_failed",
      lastFailure: { reason: "relaunch_failed", detail: "V1 recovery spawn failed" },
    });
    expect(harness.launcher.relaunch).toHaveBeenCalledTimes(2);
    await harness.service.destroy();
  });

  it("atomically defers when a model-bound turn is already dispatched but not yet marked generating", async () => {
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    const session = bridgeSession({
      pendingCodexTurns: [
        {
          turnId: null,
          userMessageId: "pending-user",
          status: "dispatched",
          adapterMsg: { type: "codex_start_pending" },
        },
      ],
    });
    const harness = makeHarness({ bridge: session });

    const result = await harness.service.schedule("dispatch-race");

    expect(result?.results[0]).toMatchObject({ action: "deferred", reason: "became_active" });
    expect(harness.launcher.relaunch).not.toHaveBeenCalled();
    expect(harness.info.codexMultiAgentVersion).toBeUndefined();
    await harness.service.destroy();
  });

  it("revalidates durable preservation before a staged replacement may dispatch queued work", async () => {
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    const info = launcherSession({ state: "exited" });
    const session = bridgeSession({
      state: { ...bridgeSession().state, backend_state: "disconnected" },
      _attached: false,
      _connected: false,
    });
    const harness = makeHarness({ info, bridge: session });
    await harness.service.schedule("stage-before-restart");
    harness.session.messageHistory[0].content = "mutated after staging";
    harness.info.state = "connected";
    harness.session.state.backend_state = "connected";
    harness.session._attached = true;
    harness.session._connected = true;
    harness.info.cliSessionId = "thread-v2-resumed";

    const allowDispatch = await (harness.service as any).beforeSessionMetaDispatch(
      harness.info.sessionId,
      "thread-v2-resumed",
    );

    expect(allowDispatch).toBe(false);
    expect(harness.info.codexMultiAgentVersion).toBe("v1");
    expect(harness.info.codexWorkerV2Cutover).toMatchObject({
      status: "rolled_back",
      lastFailure: { reason: "preservation_mismatch" },
    });
    expect(harness.launcher.relaunch).toHaveBeenCalledTimes(1);
    await harness.service.destroy();
  });

  it.each([
    [
      "recovery state",
      (harness: ReturnType<typeof makeHarness>) => {
        harness.session.recoveryDeliveryTransfers[0].status = "delivered";
      },
      "recovery_state_changed",
    ],
    [
      "tree and memory identity",
      (harness: ReturnType<typeof makeHarness>) => {
        harness.info.memorySessionSpaceSlug = "Other";
        harness.session.state.memorySessionSpaceSlug = "Other";
        harness.session.board.get("q-test").activePhaseId = "memory";
      },
      "session_identity_changed",
    ],
  ] as const)("fails closed when staged %s changes before replacement metadata", async (_label, mutate, difference) => {
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    const info = launcherSession({ state: "exited" });
    const session = bridgeSession({
      state: { ...bridgeSession().state, backend_state: "disconnected" },
      _attached: false,
      _connected: false,
    });
    const harness = makeHarness({ info, bridge: session });
    await harness.service.schedule("stage-preservation-state");
    mutate(harness);
    harness.info.state = "connected";
    harness.session.state.backend_state = "connected";
    harness.session._attached = true;
    harness.session._connected = true;
    harness.info.cliSessionId = "thread-v2-resumed";

    const allowDispatch = await (harness.service as any).beforeSessionMetaDispatch(
      harness.info.sessionId,
      "thread-v2-resumed",
    );

    expect(allowDispatch).toBe(false);
    expect(harness.info.codexWorkerV2Cutover).toMatchObject({
      status: "rolled_back",
      lastFailure: { reason: "preservation_mismatch", detail: expect.stringContaining(difference) },
    });
    await harness.service.destroy();
  });

  it("extracts only the bounded recent history tail for the fresh-thread handoff", async () => {
    const harness = makeHarness();
    const history = Array.from({ length: 5_000 }, (_, index) => ({
      type: "user_message",
      id: `history-${index}`,
      content: `entry-${index}`,
    }));
    let numericReads = 0;
    harness.session.messageHistory = new Proxy(history, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) numericReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    const handoffInput = (harness.service as any).getHandoffInput(harness.info.sessionId);

    expect(handoffInput.messageHistory).toHaveLength(CODEX_WORKER_V2_HANDOFF_DEFAULT_MAX_HISTORY_SCAN_ENTRIES);
    expect(handoffInput.messageHistory[0].id).toBe("history-4800");
    expect(handoffInput.messageHistory.at(-1)?.id).toBe("history-4999");
    expect(numericReads).toBeLessThanOrEqual(CODEX_WORKER_V2_HANDOFF_DEFAULT_MAX_HISTORY_SCAN_ENTRIES);
    await harness.service.destroy();
  });

  it("does not accept rollback until the matching original thread reports attached session metadata", async () => {
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    diagnosticsByThread.set("thread-v2-1", { version: "v1" });
    const harness = makeHarness({
      relaunchResults: [{ ok: true }, { ok: true }],
      emitSessionMetaOnRelaunch: [true, false],
    });

    const rollout = harness.service.schedule("wait-for-rollback-meta");
    await vi.waitFor(() => expect(harness.info.codexWorkerV2Cutover?.status).toBe("rolling_back"));
    let settled = false;
    void rollout.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    await (harness.service as any).beforeSessionMetaDispatch(harness.info.sessionId, "thread-v1");
    const result = await rollout;

    expect(result?.results[0]).toMatchObject({ action: "rolled_back", reason: "effective_version_mismatch" });
    expect(harness.info.codexWorkerV2Cutover).toMatchObject({
      status: "rolled_back",
      rollbackSessionMetaObservedAt: expect.any(Number),
    });
    await harness.service.destroy();
  });

  it("keeps explicit V1 and rollback audit state when the original thread reports metadata again", async () => {
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    diagnosticsByThread.set("thread-v2-1", { version: "v1" });
    const harness = makeHarness({ relaunchResults: [{ ok: true }, { ok: true }] });
    await harness.service.schedule("rollback-before-late-meta");

    const allowDispatch = await (harness.service as any).beforeSessionMetaDispatch(harness.info.sessionId, "thread-v1");

    expect(allowDispatch).toBe(true);
    expect(harness.info.codexMultiAgentVersion).toBe("v1");
    expect(harness.info.codexWorkerV2Cutover).toMatchObject({ status: "rolled_back" });
    await harness.service.destroy();
  });

  it("retains rollback-failed provenance when attached rollback metadata cannot prove V1", async () => {
    diagnosticsByThread.set("thread-v1", { version: null });
    diagnosticsByThread.set("thread-v2-1", { version: "v1" });
    const harness = makeHarness({ relaunchResults: [{ ok: true }, { ok: true }] });

    const result = await harness.service.schedule("rollback-proof-missing");

    expect(result?.results[0]).toMatchObject({ action: "rollback_failed" });
    expect(harness.info.codexWorkerV2Cutover).toMatchObject({
      status: "rollback_failed",
      lastFailure: { detail: "attached rollback thread reported unknown" },
    });
    await harness.service.destroy();
  });

  it("halts later startup reconciliation after any durable successful rollback", async () => {
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    diagnosticsByThread.set("thread-v2-1", { version: "v1" });
    const harness = makeHarness({ relaunchResults: [{ ok: true }, { ok: true }] });
    await harness.service.schedule("first-failure");
    const relaunchCount = harness.launcher.relaunch.mock.calls.length;

    const later = await harness.service.schedule("later-startup");

    expect(later).toMatchObject({ halted: true });
    expect(later?.results[0]).toMatchObject({ action: "rolled_back", reason: "rollout_halted" });
    expect(harness.launcher.relaunch).toHaveBeenCalledTimes(relaunchCount);
    await harness.service.destroy();
  });

  it("aborts an in-flight cutover durably during shutdown without initiating rollback", async () => {
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    const harness = makeHarness({ emitSessionMetaOnRelaunch: [false] });

    const rollout = harness.service.schedule("shutdown-in-flight");
    await vi.waitFor(() => expect(harness.launcher.relaunch).toHaveBeenCalledTimes(1));
    const shutdown = harness.service.destroy();
    const result = await rollout;
    await shutdown;

    expect(result?.results[0]).toMatchObject({
      action: "deferred",
      reason: "initializing",
      detail: expect.stringContaining("restart recovery"),
    });
    expect(harness.launcher.relaunch).toHaveBeenCalledTimes(1);
    expect(harness.info.codexMultiAgentVersion).toBe("v2");
    expect(harness.info.codexWorkerV2Cutover).toMatchObject({ status: "activating" });
    expect(harness.info.codexWorkerV2Cutover?.lastFailure).toBeUndefined();
  });

  it("awaits a real first turn when a threadless worker rolls back into a fresh V1 thread", async () => {
    const info = launcherSession({ cliSessionId: undefined });
    diagnosticsByThread.set("thread-v2-1", { version: "v1", mode: "explicitRequestOnly" });
    const harness = makeHarness({ info, relaunchResults: [{ ok: true }, { ok: true }] });

    const rollback = await harness.service.schedule("threadless-rollback");

    expect(rollback?.results[0]).toMatchObject({
      action: "awaiting_effective",
      reason: "awaiting_first_turn",
      effectiveVersion: null,
    });
    expect(rollback?.halted).toBe(true);
    expect(harness.info.codexMultiAgentVersion).toBe("v1");
    expect(harness.info.cliSessionId).toBe("thread-v1-fresh-2");
    expect(harness.info.codexWorkerV2Cutover).toMatchObject({
      status: "awaiting_rollback_effective",
      rollbackCliSessionId: "thread-v1-fresh-2",
      effectiveVersion: null,
    });
    expect(harness.launcher.relaunch).toHaveBeenCalledTimes(2);

    diagnosticsByThread.set("thread-v1-fresh-2", { version: "v1", mode: "explicitRequestOnly" });
    const confirmed = await harness.service.schedule("threadless-rollback-first-turn");

    expect(confirmed?.results[0]).toMatchObject({
      action: "rolled_back",
      reason: "rollout_halted",
      effectiveVersion: "v1",
    });
    expect(harness.info.codexWorkerV2Cutover).toMatchObject({ status: "rolled_back", effectiveVersion: "v1" });
    await harness.service.destroy();
  });

  it("retries paused workers only after an activity transition instead of polling", async () => {
    diagnosticsByThread.set("thread-v1", { version: "v1" });
    diagnosticsByThread.set("thread-v2-1", { version: "v2" });
    const session = bridgeSession({ _paused: true });
    const harness = makeHarness({ bridge: session });
    const deferred = await harness.service.schedule("paused");
    expect(deferred?.results[0]).toMatchObject({ action: "deferred", reason: "paused" });
    expect(harness.launcher.relaunch).not.toHaveBeenCalled();

    harness.session._paused = false;
    (harness.service as any).onSessionActivity(harness.info.sessionId, "session_unpaused");
    await vi.waitFor(() => expect(harness.launcher.relaunch).toHaveBeenCalledTimes(1));

    await harness.service.destroy();
  });
});
