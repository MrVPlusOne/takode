import { describe, expect, it, vi } from "vitest";
import { injectUserMessage, type BrowserTransportSessionLike } from "./browser-transport-controller.js";

function makeSession(overrides?: Partial<BrowserTransportSessionLike>): BrowserTransportSessionLike {
  return {
    id: "test-session",
    backendType: "codex",
    browserSockets: new Set(),
    messageHistory: [],
    frozenCount: 0,
    state: { permissionMode: "default", backend_state: "connected", cwd: "/repo" } as any,
    nextEventSeq: 1,
    lastAckSeq: 0,
    pendingPermissions: new Map(),
    pendingCodexInputs: [],
    pendingCodexTurns: [],
    taskHistory: [],
    eventBuffer: [],
    lastReadAt: Date.now(),
    attentionReason: null,
    generationStartedAt: null,
    notifications: [],
    attentionRecords: [],
    processedClientMessageIds: [],
    processedClientMessageIdSet: new Set(),
    ...overrides,
  };
}

function makeInjectDeps(overrides: Record<string, unknown> = {}) {
  return {
    refreshGitInfoThenRecomputeDiff: vi.fn(),
    prefillSlashCommands: vi.fn(),
    getTreeGroupState: vi.fn(async () => ({ groups: [], assignments: {}, nodeOrder: {} })),
    getVsCodeSelectionState: vi.fn(() => null),
    getLauncherSessionInfo: vi.fn(() => ({ isOrchestrator: true, state: "connected", backendType: "codex" })),
    backendAttached: vi.fn(() => true),
    backendConnected: vi.fn(() => true),
    getRouteChain: vi.fn(() => undefined),
    setRouteChain: vi.fn(),
    clearRouteChain: vi.fn(),
    routeBrowserMessage: vi.fn(),
    abortAutoApproval: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    setAttentionAction: vi.fn(),
    touchActivity: vi.fn(),
    notifyImageSendFailure: vi.fn(),
    broadcastError: vi.fn(),
    queueCodexPendingStartBatch: vi.fn(),
    deriveBackendState: vi.fn(() => "connected"),
    getBoard: vi.fn(() => []),
    getCompletedBoard: vi.fn(() => []),
    getBoardRowSessionStatuses: vi.fn(() => ({})),
    recoverToolStartTimesFromHistory: vi.fn(),
    finalizeRecoveredDisconnectedTerminalTools: vi.fn(),
    scheduleCodexToolResultWatchdogs: vi.fn(),
    recomputeAndBroadcastHistoryBytes: vi.fn(),
    listTimers: vi.fn(() => []),
    persistSession: vi.fn(),
    recordOutgoingRaw: vi.fn(),
    browserTransportState: {
      vscodeSelectionState: null,
      vscodeWindows: new Map(),
      vscodeOpenFileQueues: new Map(),
      pendingVsCodeOpenResults: new Map(),
    },
    idempotentMessageTypes: new Set<string>(),
    processedClientMsgIdLimit: 100,
    getSessions: vi.fn(() => []),
    windowStaleMs: 1000,
    openFileTimeoutMs: 1000,
    eventBufferLimit: 100,
    ...overrides,
  } as any;
}

describe("Codex herd stale route pruning", () => {
  it("drops queued Codex herd injections when their board batch is stale before routing", async () => {
    const agentSource = { sessionId: "herd-events", sessionLabel: "Herd Events" };
    const session = makeSession();
    const routeBrowserMessage = vi.fn();
    let releaseInFlight!: () => void;
    const inFlightRoute = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });
    let currentRoute: Promise<void> | undefined = inFlightRoute;
    const deps = makeInjectDeps({
      routeBrowserMessage,
      pruneTakodeHerdBatch: vi.fn(() => ({ changed: true })),
      getRouteChain: vi.fn(() => currentRoute),
      setRouteChain: vi.fn((_sessionId: string, route: Promise<void>) => {
        currentRoute = route;
      }),
      clearRouteChain: vi.fn((_sessionId: string, route: Promise<void>) => {
        if (currentRoute === route) currentRoute = undefined;
      }),
    });
    const batch = {
      events: [
        {
          id: -1,
          event: "board_dispatchable",
          sessionId: "work-board",
          sessionNum: -1,
          sessionName: "Work Board",
          ts: Date.now(),
          data: {
            questId: "q-77",
            signature: "q-77|dispatchable|free-worker|free-worker-capacity:2/5/5",
            rowUpdatedAt: 100,
            summary: "q-77 can be dispatched now: worker slots are available.",
          },
        },
      ],
      renderedLines: ["Work Board | board_dispatchable | q-77 | q-77 can be dispatched now."],
    } as any;

    const delivery = injectUserMessage(
      session,
      "1 event from work board\n\nWork Board | board_dispatchable | q-77 | q-77 can be dispatched now.",
      agentSource,
      batch,
      deps,
      { threadKey: "q-77", questId: "q-77" } as any,
    );

    expect(delivery).toBe("queued");
    expect(routeBrowserMessage).not.toHaveBeenCalled();

    releaseInFlight();
    await currentRoute;

    expect(deps.pruneTakodeHerdBatch).toHaveBeenCalledWith(session, batch);
    expect(routeBrowserMessage).not.toHaveBeenCalled();
  });
});
