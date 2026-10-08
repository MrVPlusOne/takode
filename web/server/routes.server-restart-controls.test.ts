import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("./settings-manager.js", () => ({
  getSettings: vi.fn(() => ({
    namerConfig: { backend: "claude" },
    transcriptionConfig: { apiKey: "", baseUrl: "https://api.openai.com/v1", enhancementEnabled: true },
    editorConfig: { editor: "none" },
    questmasterViewMode: "cards",
  })),
  updateSettings: vi.fn(() => ({})),
  getServerName: vi.fn(() => ""),
  setServerName: vi.fn(),
  getServerId: vi.fn(() => "test-server"),
  getClaudeUserDefaultModel: vi.fn(async () => ""),
  getCodexUserDefaultModel: vi.fn(async () => ""),
  STT_MODELS: [],
}));

vi.mock("./path-resolver.js", () => ({
  resolveBinary: vi.fn(() => null),
  getEnrichedPath: vi.fn(() => process.env.PATH ?? ""),
}));

import { createSettingsRoutes } from "./routes/settings.js";
import type { PermissionRequest } from "./session-types.js";
import { WsBridge } from "./ws-bridge.js";
import { HerdEventDispatcher } from "./herd-event-dispatcher.js";

type TestClaudeAdapter = {
  sendBrowserMessage: ReturnType<typeof vi.fn>;
  isConnected: () => boolean;
  hasTurnInFlight: () => boolean;
  disconnect: ReturnType<typeof vi.fn>;
};

/** Stand-in for a connected Claude SDK adapter, running a turn, that records interrupts in order. */
function makeClaudeAdapter(sessionId: string, sentOrder: string[]): TestClaudeAdapter {
  return {
    sendBrowserMessage: vi.fn((msg: { type: string }) => {
      if (msg.type === "interrupt") sentOrder.push(sessionId);
      return true;
    }),
    isConnected: () => true,
    hasTurnInFlight: () => true,
    disconnect: vi.fn(async () => {}),
  };
}

describe("server restart controls", () => {
  let app: Hono;
  let bridge: WsBridge;
  let launcher: {
    listSessions: ReturnType<typeof vi.fn>;
    getSessionNum: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    getHerdedSessions: ReturnType<typeof vi.fn>;
  };
  let requestRestart: ReturnType<typeof vi.fn>;
  let prepareRestart: ReturnType<typeof vi.fn>;
  let publishPreparedRestart: ReturnType<typeof vi.fn>;
  let discardPreparedRestart: ReturnType<typeof vi.fn>;
  let sentOrder: string[];
  let claudeAdapters: Record<string, TestClaudeAdapter>;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "takode-restart-controls-"));
    bridge = new WsBridge();
    sentOrder = [];
    claudeAdapters = {};
    requestRestart = vi.fn();
    publishPreparedRestart = vi.fn(async () => {});
    discardPreparedRestart = vi.fn(async () => {});
    prepareRestart = vi.fn(async () => ({
      frontendRoot: join(tempDir, "frontend-build-next"),
      buildId: "build-next",
      publish: publishPreparedRestart,
      discard: discardPreparedRestart,
    }));
    process.env.COMPANION_RESTART_PREP_TIMEOUT_MS = "20";
    process.env.COMPANION_RESTART_PREP_RETRY_DELAY_MS = "0";
    process.env.COMPANION_RESTART_PREP_MAX_INTERRUPT_ATTEMPTS = "3";
    launcher = {
      listSessions: vi.fn(() => []),
      getSessionNum: vi.fn((sessionId: string) => ({ leader: 5, worker: 11, approval: 17 })[sessionId] ?? null),
      getSession: vi.fn((sessionId: string) =>
        (launcher.listSessions as unknown as () => Array<{ sessionId: string }>)().find(
          (session) => session.sessionId === sessionId,
        ),
      ),
      getHerdedSessions: vi.fn((leaderId: string) =>
        (launcher.listSessions as unknown as () => Array<{ herdedBy?: string }>)().filter(
          (session) => session.herdedBy === leaderId,
        ),
      ),
    };
    (bridge as any).herdEventDispatcher = new HerdEventDispatcher(bridge as any, launcher as any);

    app = new Hono();
    app.route(
      "/api",
      createSettingsRoutes({
        launcher,
        wsBridge: bridge,
        sessionStore: { directory: tempDir },
        options: { requestRestart, prepareRestart },
        pushoverNotifier: undefined,
      } as any),
    );
  });

  afterEach(async () => {
    delete process.env.COMPANION_RESTART_PREP_TIMEOUT_MS;
    delete process.env.COMPANION_RESTART_PREP_RETRY_DELAY_MS;
    delete process.env.COMPANION_RESTART_PREP_MAX_INTERRUPT_ATTEMPTS;
    await rm(tempDir, { recursive: true, force: true });
  });

  function attachBlockingSession(
    sessionId: string,
    options: { isGenerating: boolean; pendingPermissionCount?: number },
  ): void {
    const session = bridge.getOrCreateSession(sessionId);
    session.isGenerating = options.isGenerating;
    session.pendingPermissions = new Map(
      Array.from({ length: options.pendingPermissionCount ?? 0 }, (_, index) => {
        const requestId = `perm-${sessionId}-${index}`;
        const request: PermissionRequest = {
          request_id: requestId,
          tool_name: "Bash",
          input: {},
          tool_use_id: `tool-${requestId}`,
          timestamp: Date.now(),
        };
        return [requestId, request];
      }),
    );
    const adapter = makeClaudeAdapter(sessionId, sentOrder);
    session.claudeSdkAdapter = adapter as any;
    claudeAdapters[sessionId] = adapter;
  }

  function attachBlockingCodexSession(sessionId: string): {
    sentMessages: unknown[];
    relaunchNeeded: ReturnType<typeof vi.fn>;
  } {
    const session = bridge.getOrCreateSession(sessionId, "codex");
    session.isGenerating = true;
    session.state.backend_state = "connected";
    session.pendingCodexTurns = [
      {
        adapterMsg: { type: "interrupt" },
        userMessageId: 1,
        pendingInputIds: [1],
        userContent: "stuck turn",
        historyIndex: 0,
        status: "backend_acknowledged",
        dispatchCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        acknowledgedAt: Date.now(),
        turnTarget: null,
        lastError: null,
        turnId: "turn-1",
        disconnectedAt: null,
        resumeConfirmedAt: null,
      } as any,
    ];
    const sentMessages: unknown[] = [];
    session.codexAdapter = {
      sendBrowserMessage: vi.fn((msg: unknown) => {
        sentMessages.push(msg);
        return true;
      }),
      onBrowserMessage: vi.fn(),
      onSessionMeta: vi.fn(),
      onDisconnect: vi.fn(),
      onInitError: vi.fn(),
      onTurnStarted: vi.fn(),
      onTurnSteered: vi.fn(),
      onTurnSteerFailed: vi.fn(),
      onTurnStartFailed: vi.fn(),
      isConnected: vi.fn(() => true),
      disconnect: vi.fn(async () => {}),
      getCurrentTurnId: vi.fn(() => "turn-1"),
      getRateLimits: vi.fn(() => null),
      rollbackTurns: vi.fn(async () => {}),
    } as any;
    const relaunchNeeded = vi.fn();
    (bridge as any).onCLIRelaunchNeeded = relaunchNeeded;
    return { sentMessages, relaunchNeeded };
  }

  it("returns a build failure without interrupting sessions or stopping the current pair", async () => {
    launcher.listSessions.mockReturnValue([{ sessionId: "worker", state: "connected", name: "Worker session" }]);
    attachBlockingSession("worker", { isGenerating: true });
    prepareRestart.mockRejectedValueOnce(new Error("Vite build failed"));

    const res = await app.request("/api/server/restart", { method: "POST" });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Frontend restart preparation failed: Vite build failed" });
    expect(claudeAdapters.worker.sendBrowserMessage).not.toHaveBeenCalled();
    expect(requestRestart).not.toHaveBeenCalled();
    expect(publishPreparedRestart).not.toHaveBeenCalled();
    expect(discardPreparedRestart).not.toHaveBeenCalled();
  });

  it("blocks restart before building or interrupting anything when the backend on disk cannot start", async () => {
    // Incident shape: a commit added a backend dependency that was never installed. The live server must
    // stay up and report the fix instead of exiting into a replacement backend that crashes on import.
    launcher.listSessions.mockReturnValue([{ sessionId: "worker", state: "connected", name: "Worker session" }]);
    attachBlockingSession("worker", { isGenerating: true });
    const checkBackendStartup = vi.fn(async (): Promise<void> => {
      throw new Error("Dependencies are out of date (web-push is not installed).");
    });
    const checkedApp = new Hono();
    checkedApp.route(
      "/api",
      createSettingsRoutes({
        launcher,
        wsBridge: bridge,
        sessionStore: { directory: tempDir },
        options: { requestRestart, prepareRestart, checkBackendStartup },
        pushoverNotifier: undefined,
      } as any),
    );

    const res = await checkedApp.request("/api/server/restart", { method: "POST" });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Restart blocked: Dependencies are out of date (web-push is not installed).",
    });
    expect(checkBackendStartup).toHaveBeenCalledOnce();
    expect(prepareRestart).not.toHaveBeenCalled();
    expect(claudeAdapters.worker.sendBrowserMessage).not.toHaveBeenCalled();
    expect(requestRestart).not.toHaveBeenCalled();

    // The in-flight guard is released, so a retry after fixing dependencies proceeds normally.
    checkBackendStartup.mockResolvedValueOnce(undefined);
    launcher.listSessions.mockReturnValue([]);
    const retry = await checkedApp.request("/api/server/restart", { method: "POST" });
    expect(retry.status).toBe(200);
    expect(prepareRestart).toHaveBeenCalledOnce();
    expect(requestRestart).toHaveBeenCalledOnce();
  });

  it("rejects restart before interruption when the resident supervisor lacks current handoff capability", async () => {
    const staleSupervisorApp = new Hono();
    staleSupervisorApp.route(
      "/api",
      createSettingsRoutes({
        launcher,
        wsBridge: bridge,
        sessionStore: { directory: tempDir },
        options: { requestRestart, restartSupported: false },
        pushoverNotifier: undefined,
      } as any),
    );

    const res = await staleSupervisorApp.request("/api/server/restart", { method: "POST" });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "Restart not supported in this mode" });
    expect(launcher.listSessions).not.toHaveBeenCalled();
    expect(requestRestart).not.toHaveBeenCalled();
  });

  it("rejects a concurrent restart while the first production candidate is still building", async () => {
    let releasePreparation!: () => void;
    const preparationGate = new Promise<void>((resolvePromise) => {
      releasePreparation = resolvePromise;
    });
    prepareRestart.mockImplementationOnce(async () => {
      await preparationGate;
      return {
        frontendRoot: join(tempDir, "frontend-build-next"),
        buildId: "build-next",
        publish: publishPreparedRestart,
        discard: discardPreparedRestart,
      };
    });

    const firstRequest = app.request("/api/server/restart", { method: "POST" });
    expect(prepareRestart).toHaveBeenCalledOnce();
    const concurrentResponse = await app.request("/api/server/restart", { method: "POST" });

    expect(concurrentResponse.status).toBe(409);
    await expect(concurrentResponse.json()).resolves.toEqual({ error: "A server restart is already being prepared" });
    expect(requestRestart).not.toHaveBeenCalled();

    releasePreparation();
    const firstResponse = await firstRequest;
    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({
      ok: true,
      restartRequested: true,
      replacementBuildId: "build-next",
    });
    expect(publishPreparedRestart).toHaveBeenCalledOnce();
    expect(requestRestart).toHaveBeenCalledOnce();
  });

  it("keeps restart behavior unchanged when no production frontend preparer is configured", async () => {
    const devApp = new Hono();
    const devRequestRestart = vi.fn();
    devApp.route(
      "/api",
      createSettingsRoutes({
        launcher,
        wsBridge: bridge,
        sessionStore: { directory: tempDir },
        options: { requestRestart: devRequestRestart },
        pushoverNotifier: undefined,
      } as any),
    );

    const res = await devApp.request("/api/server/restart", { method: "POST" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, restartRequested: true, replacementBuildId: null });
    expect(devRequestRestart).toHaveBeenCalledOnce();
  });

  it("blocks restart when a session only has pending permissions", async () => {
    launcher.listSessions.mockReturnValue([{ sessionId: "approval", state: "connected", name: "Needs approval" }]);
    attachBlockingSession("approval", { isGenerating: false, pendingPermissionCount: 1 });

    const res = await app.request("/api/server/restart", { method: "POST" });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Cannot restart while 1 session(s) are still blocking restart readiness: Needs approval");
    expect(body.result).toMatchObject({
      ok: false,
      mode: "restart",
      restartRequested: false,
      timedOut: true,
      herdDelivery: {
        suppressed: 0,
        held: 0,
        trackingActive: true,
        countsFinal: false,
        detail: expect.stringContaining("tracking is active"),
      },
      unresolvedBlockers: [
        expect.objectContaining({
          sessionId: "approval",
          label: "Needs approval",
          reasons: ["1 pending permission"],
        }),
      ],
    });
    expect(requestRestart).not.toHaveBeenCalled();
  });

  it("restarts without interrupting sessions run by a host's node, which keep running", async () => {
    // A host keeps its session processes through a coordinator restart and the
    // next server takes them over, so a running or waiting host session neither
    // blocks the restart nor gets interrupted and told to continue afterwards.
    launcher.listSessions.mockReturnValue([
      { sessionId: "remote-worker", state: "connected", name: "Remote worker", hostId: "host-1" },
      // A session without a host that this machine's own node runs survives too.
      { sessionId: "local-node-worker", state: "connected", name: "Local node worker", hostProcId: "proc-1" },
    ]);
    attachBlockingSession("remote-worker", { isGenerating: true, pendingPermissionCount: 1 });
    attachBlockingSession("local-node-worker", { isGenerating: true });

    const res = await app.request("/api/server/restart", { method: "POST" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, restartRequested: true });
    expect(bridge.getSession("remote-worker")?.isGenerating).toBe(true);
    expect(bridge.getSession("local-node-worker")?.isGenerating).toBe(true);
    expect(requestRestart).toHaveBeenCalledOnce();
  });

  it("interrupts restart blockers through the live bridge surface in child-before-leader order", async () => {
    launcher.listSessions.mockReturnValue([
      { sessionId: "leader", state: "connected", name: "Leader session" },
      { sessionId: "worker", state: "connected", name: "Worker session", herdedBy: "leader" },
      { sessionId: "approval", state: "connected", name: "Needs approval" },
      { sessionId: "idle", state: "connected", name: "Idle session" },
    ]);
    attachBlockingSession("leader", { isGenerating: true });
    attachBlockingSession("worker", { isGenerating: true });
    attachBlockingSession("approval", { isGenerating: false, pendingPermissionCount: 2 });
    attachBlockingSession("idle", { isGenerating: false });

    expect((bridge as any).routeBrowserMessage).toBeUndefined();

    const res = await app.request("/api/server/interrupt-all", { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(sentOrder).toEqual(["worker", "leader", "approval"]);
    expect(body).toEqual({
      ok: false,
      operationId: expect.any(String),
      mode: "standalone",
      restartRequested: false,
      timedOut: false,
      retryAttempts: [],
      interrupted: [
        { sessionId: "worker", label: "Worker session", reasons: ["running"] },
        { sessionId: "leader", label: "Leader session", reasons: ["running"] },
        { sessionId: "approval", label: "Needs approval", reasons: ["2 pending permissions"] },
      ],
      skipped: [],
      failures: [],
      fallbacks: [],
      protectedLeaders: [{ sessionId: "leader", label: "Leader session" }],
      unresolvedBlockers: [
        { sessionId: "leader", label: "Leader session", reasons: ["running"] },
        { sessionId: "worker", label: "Worker session", reasons: ["running"] },
        {
          sessionId: "approval",
          label: "Needs approval",
          reasons: ["2 pending permissions"],
          detail: "Pending permission blockers remain unresolved until the backend reports cancellation or resolution.",
        },
      ],
      herdDelivery: {
        suppressed: 0,
        held: 0,
        trackingActive: true,
        countsFinal: false,
        detail: expect.stringContaining("tracking is active"),
      },
    });

    const workerSession = bridge.getSession("worker");
    const leaderSession = bridge.getSession("leader");
    expect(workerSession?.interruptSourceDuringTurn).toBe("user");
    expect(workerSession?.interruptedDuringTurn).toBe(true);
    expect(workerSession?.restartPrepInterruptOrigin).toBe("restart_prep");
    expect(workerSession?.restartPrepInterruptOperationId).toBe(body.operationId);
    expect(workerSession?.messageHistory).not.toContainEqual(expect.objectContaining({ type: "user_message" }));
    expect(leaderSession?.interruptSourceDuringTurn).toBe("user");

    for (const sessionId of ["worker", "leader", "approval"] as const) {
      expect(claudeAdapters[sessionId].sendBrowserMessage).toHaveBeenCalledTimes(1);
      expect(claudeAdapters[sessionId].sendBrowserMessage.mock.calls[0][0]).toMatchObject({ type: "interrupt" });
    }
  });

  it("protects an idle leader when only its running worker is interrupted", async () => {
    launcher.listSessions.mockReturnValue([
      { sessionId: "leader", state: "connected", name: "Leader session", isOrchestrator: true },
      { sessionId: "worker", state: "connected", name: "Worker session", herdedBy: "leader" },
    ]);
    attachBlockingSession("worker", { isGenerating: true });
    const leaderSession = bridge.getOrCreateSession("leader");
    leaderSession.cliInitReceived = true;
    claudeAdapters.leader = makeClaudeAdapter("leader", sentOrder);
    leaderSession.claudeSdkAdapter = claudeAdapters.leader as any;

    const res = await app.request("/api/server/interrupt-all", { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(sentOrder).toEqual(["worker"]);
    expect(body.protectedLeaders).toEqual([{ sessionId: "leader", label: "Leader session" }]);

    (bridge as any).herdEventDispatcher.setupForOrchestrator("leader");
    (bridge as any).herdEventDispatcher.emitTakodeEvent("worker", "turn_end", {
      duration_ms: 1000,
      interrupted: true,
      interrupt_source: "user",
    });

    expect(claudeAdapters.leader?.sendBrowserMessage).not.toHaveBeenCalled();
    const snapshot = (bridge as any).herdEventDispatcher.getRestartPrepOperationSnapshot(body.operationId);
    expect(snapshot.suppressedHerdEvents).toBe(1);
  });

  it("queues concise continuation prompts for successfully interrupted running sessions before restart", async () => {
    launcher.listSessions.mockReturnValue([
      { sessionId: "leader", state: "connected", name: "Leader session", isOrchestrator: true },
      { sessionId: "worker", state: "connected", name: "Worker session", herdedBy: "leader" },
    ]);
    attachBlockingSession("worker", { isGenerating: true });

    const originalInterruptSession = bridge.interruptSession.bind(bridge);
    vi.spyOn(bridge, "interruptSession").mockImplementation(async (...args) => {
      const routed = await originalInterruptSession(...args);
      const session = bridge.getSession(args[0]);
      if (session) session.isGenerating = false;
      return routed;
    });

    publishPreparedRestart.mockImplementationOnce(async () => {
      await access(join(tempDir, "restart-continuations.json"));
      expect(requestRestart).not.toHaveBeenCalled();
    });

    const res = await app.request("/api/server/restart", { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(prepareRestart).toHaveBeenCalledOnce();
    expect(publishPreparedRestart).toHaveBeenCalledOnce();
    expect(discardPreparedRestart).not.toHaveBeenCalled();
    expect(requestRestart).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      ok: true,
      mode: "restart",
      restartRequested: true,
      replacementBuildId: "build-next",
      interrupted: [{ sessionId: "worker", label: "Worker session", reasons: ["running"] }],
    });

    const plan = JSON.parse(await readFile(join(tempDir, "restart-continuations.json"), "utf-8"));
    expect(plan).toMatchObject({
      version: 1,
      operationId: body.operationId,
      message: "Continue.",
      sessions: [{ sessionId: "worker", label: "Worker session" }],
    });
  });

  it("removes a queued continuation when the atomic frontend handoff cannot publish", async () => {
    launcher.listSessions.mockReturnValue([{ sessionId: "worker", state: "connected", name: "Worker session" }]);
    attachBlockingSession("worker", { isGenerating: true });
    const originalInterruptSession = bridge.interruptSession.bind(bridge);
    vi.spyOn(bridge, "interruptSession").mockImplementation(async (...args) => {
      const routed = await originalInterruptSession(...args);
      const session = bridge.getSession(args[0]);
      if (session) session.isGenerating = false;
      return routed;
    });
    publishPreparedRestart.mockRejectedValueOnce(new Error("handoff unavailable"));

    const res = await app.request("/api/server/restart", { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Frontend restart handoff failed: handoff unavailable");
    expect(body.result.restartRequested).toBe(false);
    expect(requestRestart).not.toHaveBeenCalled();
    await expect(access(join(tempDir, "restart-continuations.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retries running blockers before restart gives up", async () => {
    launcher.listSessions.mockReturnValue([{ sessionId: "worker", state: "connected", name: "Worker session" }]);
    attachBlockingSession("worker", { isGenerating: true });

    const originalInterruptSession = bridge.interruptSession.bind(bridge);
    let interruptCount = 0;
    vi.spyOn(bridge, "interruptSession").mockImplementation(async (...args) => {
      const routed = await originalInterruptSession(...args);
      interruptCount += 1;
      if (interruptCount === 2) {
        const session = bridge.getSession(args[0]);
        if (session) session.isGenerating = false;
      }
      return routed;
    });

    const res = await app.request("/api/server/restart", { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requestRestart).toHaveBeenCalledTimes(1);
    expect(sentOrder).toEqual(["worker", "worker"]);
    expect(body.timedOut).toBe(false);
    expect(body.retryAttempts).toHaveLength(2);
    expect(body.retryAttempts[0].timedOut).toBe(true);
    expect(body.retryAttempts[0].remainingBlockers).toEqual([
      { sessionId: "worker", label: "Worker session", reasons: ["running"] },
    ]);
    expect(body.retryAttempts[1].timedOut).toBe(false);
    expect(body.retryAttempts[1].remainingBlockers).toEqual([]);
    expect(body.fallbacks).toEqual([]);
  });

  it("moves stuck Codex running blockers into recovery after bounded restart-prep retries", async () => {
    launcher.listSessions.mockReturnValue([{ sessionId: "codex", state: "connected", name: "Codex stuck" }]);
    const { relaunchNeeded } = attachBlockingCodexSession("codex");

    const res = await app.request("/api/server/restart", { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requestRestart).toHaveBeenCalledTimes(1);
    expect(relaunchNeeded).toHaveBeenCalledWith("codex");
    expect(body.timedOut).toBe(false);
    expect(body.retryAttempts).toHaveLength(3);
    expect(body.retryAttempts.every((attempt: { timedOut: boolean }) => attempt.timedOut)).toBe(true);
    expect(body.fallbacks).toEqual([
      expect.objectContaining({
        sessionId: "codex",
        label: "Codex stuck",
        reasons: ["running"],
        detail: expect.stringContaining("Codex recovery was requested"),
        diagnostics: expect.objectContaining({
          backendState: "connected",
          adapterConnected: true,
          currentTurnId: "turn-1",
          pendingCodexTurns: 1,
        }),
      }),
    ]);
    expect(body.unresolvedBlockers).toEqual([]);

    const session = bridge.getSession("codex");
    expect(session?.isGenerating).toBe(false);
    expect(session?.state.backend_state).toBe("recovering");
    expect(session?.pendingCodexTurns[0]?.lastError).toContain("Restart prep moved this Codex turn into recovery");
    await expect(access(join(tempDir, "restart-continuations.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
