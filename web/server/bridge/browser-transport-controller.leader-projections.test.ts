/**
 * Leader tab and selected-thread projection transport tests.
 *
 * These exercise the server-owned tab commands and the bounded projection
 * payloads used when a leader opens or reconnects to a selected thread.
 */

import { describe, it, expect, vi } from "vitest";
import {
  broadcastToBrowsers,
  buildLeaderProjectionSnapshotForSession,
  handleBrowserOpen,
  handleBrowserProtocolMessage,
  handleSessionSubscribe,
  sendLeaderProjectionSnapshot,
  sendThreadWindowSync,
  type BrowserTransportSessionLike,
} from "./browser-transport-controller.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { FEED_WINDOW_SYNC_VERSION } from "../../shared/feed-window-sync.js";

function makeSession(overrides?: Partial<BrowserTransportSessionLike>): BrowserTransportSessionLike {
  const mockSocket = { send: vi.fn() };
  return {
    id: "test-session",
    backendType: "claude",
    browserSockets: new Set([mockSocket]),
    messageHistory: [],
    frozenCount: 0,
    state: { permissionMode: "default" } as any,
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

function makeDeps() {
  return {
    eventBufferLimit: 100,
    persistSession: vi.fn(),
    recordOutgoingRaw: vi.fn(),
  };
}

function makeInjectDeps(overrides: Record<string, unknown> = {}) {
  return {
    ...makeDeps(),
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
    ...overrides,
  } as any;
}

describe("leader_thread_tabs_update", () => {
  it("persists and broadcasts authoritative leader tab updates", () => {
    const session = makeSession({
      state: {
        permissionMode: "default",
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1"],
          closedThreadTombstones: [],
          updatedAt: 1,
        },
      } as any,
    });
    const deps = makeInjectDeps();

    const handled = handleBrowserProtocolMessage(
      session,
      {
        type: "leader_thread_tabs_update",
        operation: { type: "open", threadKey: "q-2", placement: "first", source: "user" },
        client_msg_id: "tabs-1",
      },
      undefined,
      deps,
    );

    expect(handled).toBe(true);
    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-2", "q-1"]);
    expect(deps.persistSession).toHaveBeenCalledWith(session);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "session_update",
      session: { leaderOpenThreadTabs: session.state.leaderOpenThreadTabs },
    });
  });

  it("keeps migrated browser localStorage from overriding existing server state", () => {
    const serverState = {
      version: 1 as const,
      orderedOpenThreadKeys: ["q-server"],
      closedThreadTombstones: [],
      updatedAt: 1,
    };
    const session = makeSession({
      state: {
        permissionMode: "default",
        isOrchestrator: true,
        leaderOpenThreadTabs: serverState,
      } as any,
    });
    const deps = makeInjectDeps();

    const handled = handleBrowserProtocolMessage(
      session,
      {
        type: "leader_thread_tabs_update",
        operation: { type: "migrate", orderedOpenThreadKeys: ["q-local"], migratedAt: 100 },
      },
      undefined,
      deps,
    );

    expect(handled).toBe(true);
    expect(session.state.leaderOpenThreadTabs).toEqual(serverState);
    expect(deps.persistSession).not.toHaveBeenCalled();
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
  });

  it("deduplicates repeated tab update client messages", () => {
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
    });
    const deps = makeInjectDeps();
    const msg = {
      type: "leader_thread_tabs_update" as const,
      operation: { type: "open" as const, threadKey: "q-1", placement: "first" as const, source: "user" as const },
      client_msg_id: "tabs-1",
    };

    expect(handleBrowserProtocolMessage(session, msg, undefined, deps)).toBe(true);
    expect(handleBrowserProtocolMessage(session, msg, undefined, deps)).toBe(true);

    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-1"]);
    expect(deps.persistSession).toHaveBeenCalledTimes(2);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledTimes(1);
  });

  it("does not broadcast an effective no-op leader tab open", () => {
    const serverState = {
      version: 1 as const,
      orderedOpenThreadKeys: ["q-1", "q-2"],
      closedThreadTombstones: [],
      updatedAt: 1,
    };
    const session = makeSession({
      state: {
        permissionMode: "default",
        isOrchestrator: true,
        leaderOpenThreadTabs: serverState,
      } as any,
    });
    const deps = makeInjectDeps();

    const handled = handleBrowserProtocolMessage(
      session,
      {
        type: "leader_thread_tabs_update",
        operation: { type: "open", threadKey: "q-1", placement: "first", source: "server_candidate", eventAt: 20 },
        client_msg_id: "tabs-noop-open-1",
      },
      undefined,
      deps,
    );

    expect(handled).toBe(true);
    expect(session.state.leaderOpenThreadTabs).toEqual({
      ...serverState,
      latestServerCandidateEventAt: 20,
      serverCandidatePromotedAt: { "q-1": 20 },
    });
    expect(deps.persistSession).toHaveBeenCalledTimes(2);
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
  });

  it("persists reordered tabs while preserving server-open keys omitted by stale clients", () => {
    const session = makeSession({
      state: {
        permissionMode: "default",
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1", "q-2", "q-3"],
          closedThreadTombstones: [],
          updatedAt: 1,
        },
      } as any,
    });
    const deps = makeInjectDeps();

    const handled = handleBrowserProtocolMessage(
      session,
      {
        type: "leader_thread_tabs_update",
        operation: { type: "reorder", orderedOpenThreadKeys: ["q-3", "q-1"] },
        client_msg_id: "tabs-reorder-1",
      },
      undefined,
      deps,
    );

    expect(handled).toBe(true);
    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-3", "q-1", "q-2"]);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "session_update",
      session: { leaderOpenThreadTabs: session.state.leaderOpenThreadTabs },
    });
  });

  it("rejects replayed browser server-candidate events after another tab moves ahead", () => {
    const serverState = {
      version: 1 as const,
      orderedOpenThreadKeys: ["q-3", "q-2", "q-1"],
      closedThreadTombstones: [],
      updatedAt: 30,
      latestServerCandidateEventAt: 30,
      serverCandidatePromotedAt: { "q-2": 20, "q-3": 30 },
    };
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true, leaderOpenThreadTabs: serverState } as any,
    });
    const deps = makeInjectDeps();

    handleBrowserProtocolMessage(
      session,
      {
        type: "leader_thread_tabs_update",
        operation: { type: "open", threadKey: "q-2", placement: "first", source: "server_candidate", eventAt: 20 },
        client_msg_id: "tabs-stale-server-candidate",
      },
      undefined,
      deps,
    );

    expect(session.state.leaderOpenThreadTabs).toEqual(serverState);
    expect(deps.persistSession).toHaveBeenCalledTimes(1);
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
  });

  it("preserves per-thread server promotion freshness across browser tab commands", () => {
    const session = makeSession({
      state: {
        permissionMode: "default",
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1", "q-2"],
          closedThreadTombstones: [],
          updatedAt: 200,
          latestServerCandidateEventAt: 200,
          serverCandidatePromotedAt: { "q-2": 200 },
        },
      } as any,
    });
    const deps = makeInjectDeps({
      getLeaderThreadTabsProjectionValue: vi.fn(() => ({
        tabState: {
          version: 1,
          orderedOpenThreadKeys: ["q-1", "q-2"],
          closedThreadTombstones: [],
          updatedAt: 200,
        },
        tabs: [],
        mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
        threadStatuses: {},
        activePhaseSummary: [],
      })),
    });

    handleBrowserProtocolMessage(
      session,
      {
        type: "leader_thread_tabs_update",
        operation: { type: "reorder", orderedOpenThreadKeys: ["q-2", "q-1"] },
        client_msg_id: "tabs-preserve-promotion-freshness",
      },
      undefined,
      deps,
    );

    expect(session.state.leaderOpenThreadTabs).toMatchObject({
      latestServerCandidateEventAt: 200,
      serverCandidatePromotedAt: { "q-2": 200 },
    });
  });

  it("materializes and closes a projection-only scheduled tab without mutating its board row", () => {
    // The explicit command persists projection-only peers and a tombstone, never board state.
    const queuedRow = { questId: "q-queued", status: "QUEUED" };
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
      board: new Map([[queuedRow.questId, queuedRow]]),
    } as any);
    const getLeaderThreadTabsProjectionValue = vi.fn(() => ({
      currentQuestStateVersion: 1 as const,
      tabState: null,
      tabs: [
        {
          threadKey: "q-active",
          questId: "q-active",
          title: "Active",
          boardStatus: "WORKING",
          journey: null,
          sourceLeaderSessionId: "test-session",
          sourceRowCreatedAt: 1,
          workerSessionId: null,
          workerSessionNum: null,
          active: true,
          queued: false,
          proposed: false,
          completed: false,
          canClose: false,
          attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
          updatedAt: 10,
        },
        {
          threadKey: "q-queued",
          questId: "q-queued",
          title: "Queued",
          boardStatus: "QUEUED",
          journey: null,
          sourceLeaderSessionId: "test-session",
          sourceRowCreatedAt: 2,
          workerSessionId: null,
          workerSessionNum: null,
          active: false,
          queued: true,
          proposed: false,
          completed: false,
          canClose: true,
          attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
          updatedAt: 20,
        },
      ],
      mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
      threadStatuses: {},
      activePhaseSummary: [],
    }));
    const deps = makeInjectDeps({ getLeaderThreadTabsProjectionValue });

    expect(
      handleBrowserProtocolMessage(
        session,
        {
          type: "leader_thread_tabs_update",
          operation: { type: "close", threadKey: "q-queued", closedAt: 30 },
          client_msg_id: "tabs-close-projected-queued",
        },
        undefined,
        deps,
      ),
    ).toBe(true);

    expect(session.state.leaderOpenThreadTabs).toMatchObject({
      orderedOpenThreadKeys: ["q-active"],
      closedThreadTombstones: [{ threadKey: "q-queued", closedAt: 30 }],
    });
    expect((session as any).board.get("q-queued")).toBe(queuedRow);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledTimes(1);
  });

  it("rejects stale close commands for current in-motion tabs", () => {
    // A stale browser must not turn a hidden close affordance into active-work authority.
    const serverState = {
      version: 1 as const,
      orderedOpenThreadKeys: ["q-active"],
      closedThreadTombstones: [],
      updatedAt: 100,
    };
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true, leaderOpenThreadTabs: serverState } as any,
    });
    const deps = makeInjectDeps({
      getLeaderThreadTabMutationPolicy: vi.fn(() => ({
        inMotion: true,
        scheduled: false,
        neverStartedScheduled: false,
        canClose: false,
      })),
    });

    handleBrowserProtocolMessage(
      session,
      {
        type: "leader_thread_tabs_update",
        operation: { type: "close", threadKey: "q-active", closedAt: 200 },
        client_msg_id: "tabs-stale-active-close",
      },
      undefined,
      deps,
    );

    expect(session.state.leaderOpenThreadTabs).toEqual(serverState);
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
  });

  it("does not let a board-lag generic candidate evict a full active rail", () => {
    // An attachment can arrive before its queued row; capacity must fail closed
    // until a later authoritative activation decides whether an eviction is valid.
    const activeKeys = Array.from({ length: 50 }, (_, index) => `q-${index + 1}`);
    const serverState = {
      version: 1 as const,
      orderedOpenThreadKeys: activeKeys,
      closedThreadTombstones: [],
      updatedAt: 100,
    };
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true, leaderOpenThreadTabs: serverState } as any,
    });
    const deps = makeInjectDeps();

    handleBrowserProtocolMessage(
      session,
      {
        type: "leader_thread_tabs_update",
        operation: {
          type: "open",
          threadKey: "q-999",
          placement: "first",
          source: "server_candidate",
          eventAt: 200,
        },
        client_msg_id: "tabs-full-board-lag-candidate",
      },
      undefined,
      deps,
    );

    expect(session.state.leaderOpenThreadTabs).toEqual(serverState);
    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toHaveLength(50);
    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys.at(-1)).toBe("q-50");
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
  });

  it("uses current cross-session policy to reject generic scheduled candidates", () => {
    // Local board state may be absent or stale while another leader owns the current queued run.
    const serverState = {
      version: 1 as const,
      orderedOpenThreadKeys: ["q-active"],
      closedThreadTombstones: [{ threadKey: "q-cross-scheduled", closedAt: 100 }],
      updatedAt: 100,
    };
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true, leaderOpenThreadTabs: serverState } as any,
    });
    const deps = makeInjectDeps({
      getLeaderThreadTabMutationPolicy: vi.fn(() => ({
        inMotion: false,
        scheduled: true,
        neverStartedScheduled: true,
        canClose: true,
      })),
    });

    handleBrowserProtocolMessage(
      session,
      {
        type: "leader_thread_tabs_update",
        operation: {
          type: "open",
          threadKey: "q-cross-scheduled",
          placement: "first",
          source: "server_candidate",
          eventAt: 200,
        },
        client_msg_id: "tabs-cross-scheduled-candidate",
      },
      undefined,
      deps,
    );

    expect(session.state.leaderOpenThreadTabs).toEqual(serverState);
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
  });

  it("keeps scheduled tombstones closed for generic candidates but allows explicit reopen", () => {
    // Automatic attachment/transition candidates are weaker than user or route navigation.
    const serverState = {
      version: 1 as const,
      orderedOpenThreadKeys: ["q-active"],
      closedThreadTombstones: [{ threadKey: "q-queued", closedAt: 100 }],
      updatedAt: 100,
    };
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true, leaderOpenThreadTabs: serverState } as any,
      board: new Map([["q-queued", { questId: "q-queued", status: "QUEUED" }]]),
    } as any);
    const deps = makeInjectDeps();

    handleBrowserProtocolMessage(
      session,
      {
        type: "leader_thread_tabs_update",
        operation: {
          type: "open",
          threadKey: "q-queued",
          placement: "first",
          source: "server_candidate",
          eventAt: 200,
        },
        client_msg_id: "tabs-scheduled-candidate",
      },
      undefined,
      deps,
    );

    expect(session.state.leaderOpenThreadTabs).toEqual(serverState);
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();

    handleBrowserProtocolMessage(
      session,
      {
        type: "leader_thread_tabs_update",
        operation: { type: "open", threadKey: "q-queued", placement: "first", source: "user" },
        client_msg_id: "tabs-scheduled-user-reopen",
      },
      undefined,
      deps,
    );

    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-queued", "q-active"]);
    expect(session.state.leaderOpenThreadTabs?.closedThreadTombstones).toEqual([]);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledTimes(1);
  });

  it("materializes projection-only visible tabs before applying a browser reorder", () => {
    const session = makeSession({
      state: {
        permissionMode: "default",
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-raw"],
          closedThreadTombstones: [],
          updatedAt: 1,
        },
      } as any,
    });
    const projectionKeys = ["q-projected", "q-raw"];
    const getLeaderThreadTabsProjectionValue = vi.fn(() => ({
      tabState: {
        version: 1,
        orderedOpenThreadKeys: projectionKeys,
        closedThreadTombstones: [],
        updatedAt: 10,
      },
      tabs: projectionKeys.map((threadKey) => ({
        threadKey,
        questId: threadKey,
        title: threadKey,
        boardStatus: null,
        journey: null,
        active: threadKey === "q-projected",
        queued: false,
        proposed: false,
        completed: false,
        canClose: threadKey !== "q-projected",
        attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
        updatedAt: 10,
      })),
      mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
      threadStatuses: {},
      activePhaseSummary: [],
    }));
    const deps = makeInjectDeps({ getLeaderThreadTabsProjectionValue });

    const handled = handleBrowserProtocolMessage(
      session,
      {
        type: "leader_thread_tabs_update",
        operation: { type: "reorder", orderedOpenThreadKeys: ["q-raw", "q-projected"] },
        client_msg_id: "tabs-reorder-projected",
      },
      undefined,
      deps,
    );

    expect(handled).toBe(true);
    expect(getLeaderThreadTabsProjectionValue).toHaveBeenCalled();
    expect(session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-raw", "q-projected"]);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "session_update",
      session: { leaderOpenThreadTabs: session.state.leaderOpenThreadTabs },
    });
  });

  it("ignores stale or unsupported tab operations without mutating server state", () => {
    const serverState = {
      version: 1 as const,
      orderedOpenThreadKeys: ["q-1", "q-2"],
      closedThreadTombstones: [],
      updatedAt: 1,
    };
    const session = makeSession({
      state: {
        permissionMode: "default",
        isOrchestrator: true,
        leaderOpenThreadTabs: serverState,
      } as any,
    });
    const deps = makeInjectDeps();

    for (const operation of [
      { type: "auto_close", threadKeys: ["q-1"] },
      { type: "unknown_operation", threadKeys: ["q-2"] },
    ]) {
      const handled = handleBrowserProtocolMessage(
        session,
        {
          type: "leader_thread_tabs_update",
          operation,
          client_msg_id: `tabs-${operation.type}`,
        } as any,
        undefined,
        deps,
      );

      expect(handled).toBe(true);
    }

    expect(session.state.leaderOpenThreadTabs).toEqual(serverState);
    expect(deps.persistSession).not.toHaveBeenCalled();
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
  });
});

describe("leader projection snapshots", () => {
  it("does not buffer leader projection snapshots because they are replaceable snapshots", () => {
    const sendFn = vi.fn();
    const session = makeSession({ browserSockets: new Set([{ send: sendFn }]) });
    const deps = makeDeps();

    broadcastToBrowsers(
      session,
      {
        type: "leader_projection_snapshot",
        projection: {
          schemaVersion: 2,
          sourceHistoryLength: 0,
          threadSummaries: [],
          messageAttentionRecords: [],
        },
      } as BrowserIncomingMessage,
      deps,
    );

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sendFn.mock.calls[0][0]).type).toBe("leader_projection_snapshot");
    expect(session.eventBuffer).toHaveLength(0);
    expect(deps.persistSession).not.toHaveBeenCalled();
  });

  it("sends a leader projection snapshot before the raw history window can be consumed", () => {
    const send = vi.fn();
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
      messageHistory: [
        {
          type: "user_message",
          id: "u1",
          content: "[thread:q-1039]\nPlease implement the projection slice.",
          timestamp: 1,
          threadKey: "q-1039",
          questId: "q-1039",
        } as BrowserIncomingMessage,
      ],
    });
    const deps = makeInjectDeps({
      getBoard: vi.fn(() => [{ questId: "q-1039", title: "Projection summaries", status: "IMPLEMENT", updatedAt: 2 }]),
    });

    sendLeaderProjectionSnapshot(session, { send }, deps);

    const snapshot = JSON.parse(send.mock.calls[0][0]);
    expect(snapshot.type).toBe("leader_projection_snapshot");
    expect(snapshot.projection.schemaVersion).toBe(2);
    expect(snapshot.projection.sourceHistoryLength).toBe(1);
    expect(snapshot.projection.threadSummaries).toEqual([
      expect.objectContaining({ threadKey: "q-1039", messageCount: 1 }),
    ]);
    expect(Object.keys(snapshot.projection).sort()).toEqual([
      "messageAttentionRecords",
      "schemaVersion",
      "sourceHistoryLength",
      "threadSummaries",
    ]);
    expect(snapshot.projection).not.toHaveProperty("threadRows");
    expect(snapshot.projection).not.toHaveProperty("attentionRecords");
    expect(snapshot.projection).not.toHaveProperty("rawTurnBoundaries");
  });

  it("sends the same compact authoritative projection to multiple browsers while retaining the rich server cache", () => {
    // The wire payload is shared authoritative state, while server-only rows remain available to internal callers.
    const firstSend = vi.fn();
    const secondSend = vi.fn();
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
      messageHistory: [
        {
          type: "user_message",
          id: "u1",
          content: "projected message",
          timestamp: 1,
          threadKey: "q-2040",
          questId: "q-2040",
        } as BrowserIncomingMessage,
      ],
    });
    const deps = makeInjectDeps({
      getBoard: vi.fn(() => [{ questId: "q-2040", title: "Projection source", status: "IMPLEMENT", updatedAt: 2 }]),
    });

    sendLeaderProjectionSnapshot(session, { send: firstSend }, deps);
    sendLeaderProjectionSnapshot(session, { send: secondSend }, deps);

    const first = JSON.parse(firstSend.mock.calls[0][0]);
    const second = JSON.parse(secondSend.mock.calls[0][0]);
    expect(second).toEqual(first);
    expect(first.projection).toEqual(
      expect.objectContaining({ schemaVersion: 2, sourceHistoryLength: 1, messageAttentionRecords: [] }),
    );
    const internal = buildLeaderProjectionSnapshotForSession(session, deps);
    expect(internal.schemaVersion).toBe(1);
    expect(internal.threadRows).toEqual([
      expect.objectContaining({ threadKey: "q-2040", title: "Projection source", messageCount: 1 }),
    ]);
    expect(first.projection).not.toHaveProperty("threadRows");
  });
});

describe("selected feed thread windows", () => {
  it("sends bounded thread_window_sync entries without using the raw history window protocol", () => {
    const send = vi.fn();
    const history: BrowserIncomingMessage[] = [];
    for (let index = 0; index < 1_000; index++) {
      const threadKey = index % 100 === 0 ? "q-1040" : "q-noise";
      history.push({
        type: "user_message",
        id: `u-${index}`,
        content: `message ${index}`,
        timestamp: index,
        threadKey,
        questId: threadKey,
        threadRefs: [{ threadKey, questId: threadKey, source: "explicit" }],
      } as BrowserIncomingMessage);
    }
    const session = makeSession({ messageHistory: history });

    sendThreadWindowSync(
      session,
      { send },
      {
        threadKey: "q-1040",
        fromItem: -1,
        itemCount: 3,
        sectionItemCount: 3,
        visibleItemCount: 1,
      },
    );

    const sync = JSON.parse(send.mock.calls[0][0]);
    expect(sync.type).toBe("thread_window_sync");
    expect(sync.thread_key).toBe("q-1040");
    expect(sync.window.source_history_length).toBe(1_000);
    expect(sync.window.total_items).toBe(10);
    expect(sync.window).toMatchObject({ has_older_items: true, has_newer_items: false });
    expect(sync.entries).toHaveLength(3);
    expect(sync.entries.map((entry: any) => entry.history_index)).toEqual([700, 800, 900]);
    expect(sync.entries.map((entry: any) => entry.message.id)).toEqual(["u-700", "u-800", "u-900"]);
  });

  it("does not let preview-only support tails consume the server-authored visible window budget", () => {
    // Exercise the actual browser producer, not a frontend-invented window shape.
    const history: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u-main", content: "visible request", timestamp: 1 },
      {
        type: "assistant",
        message: { id: "a-main", role: "assistant", content: [{ type: "text", text: "visible response" }] },
      } as BrowserIncomingMessage,
      {
        type: "result",
        data: {
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          session_id: "s1",
          total_cost_usd: 0,
          result: "done",
        },
      } as BrowserIncomingMessage,
    ];
    for (let index = 0; index < 140; index++) {
      history.push({
        type: "tool_result_preview",
        previews: [
          {
            tool_use_id: `orphan-${index}`,
            content: "support-only",
            is_error: false,
            total_size: 12,
            is_truncated: false,
          },
        ],
      });
      history.push({
        type: "result",
        data: {
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          session_id: "s1",
          total_cost_usd: 0,
          result: "done",
        },
      } as BrowserIncomingMessage);
    }
    const send = vi.fn();

    sendThreadWindowSync(
      makeSession({ messageHistory: history }),
      { send },
      { threadKey: "main", fromItem: -1, itemCount: 30, sectionItemCount: 10, visibleItemCount: 3 },
    );

    const sync = JSON.parse(send.mock.calls[0][0]);
    expect(sync.window).toMatchObject({
      total_items: 1,
      item_count: 1,
      has_older_items: false,
      has_newer_items: false,
    });
    expect(sync.entries.map((entry: any) => entry.history_index)).toEqual([0, 1, 2]);
    expect(sync.entries.some((entry: any) => entry.message.type === "user_message")).toBe(true);
  });

  it("omits selected-thread payload when the cached thread window hash still matches", () => {
    const send = vi.fn();
    const session = makeSession({
      messageHistory: [
        {
          type: "user_message",
          id: "u-thread",
          content: "thread message",
          timestamp: 1,
          threadKey: "q-1040",
          questId: "q-1040",
          threadRefs: [{ threadKey: "q-1040", questId: "q-1040", source: "explicit" }],
        } as BrowserIncomingMessage,
      ],
    });

    sendThreadWindowSync(
      session,
      { send },
      {
        threadKey: "q-1040",
        fromItem: 0,
        itemCount: 1,
        sectionItemCount: 1,
        visibleItemCount: 1,
      },
    );
    const firstPayload = JSON.parse(send.mock.calls[0][0]);
    send.mockClear();

    sendThreadWindowSync(
      session,
      { send },
      {
        threadKey: "q-1040",
        fromItem: 0,
        itemCount: 1,
        sectionItemCount: 1,
        visibleItemCount: 1,
        cachedWindowHash: firstPayload.window.window_hash,
      },
    );

    const payload = JSON.parse(send.mock.calls[0][0]);
    expect(payload.type).toBe("thread_window_sync");
    expect(payload.cache_hit).toBe(true);
    expect(payload.entries).toEqual([]);
    expect(payload.window.window_hash).toBe(firstPayload.window.window_hash);
  });

  it("sends additive selected-thread feed_window_sync while keeping cache-hit fallback explicit", () => {
    const send = vi.fn();
    const session = makeSession({
      messageHistory: [
        {
          type: "user_message",
          id: "u-thread",
          content: "thread message",
          timestamp: 1,
          threadKey: "q-1040",
          questId: "q-1040",
          threadRefs: [{ threadKey: "q-1040", questId: "q-1040", source: "explicit" }],
        } as BrowserIncomingMessage,
      ],
    });

    sendThreadWindowSync(
      session,
      { send },
      {
        threadKey: "q-1040",
        fromItem: 0,
        itemCount: 1,
        sectionItemCount: 1,
        visibleItemCount: 1,
        feedWindowSyncVersion: FEED_WINDOW_SYNC_VERSION,
      },
    );
    const firstWindow = JSON.parse(send.mock.calls[0][0]).window;
    send.mockClear();

    sendThreadWindowSync(
      session,
      { send },
      {
        threadKey: "q-1040",
        fromItem: 0,
        itemCount: 1,
        sectionItemCount: 1,
        visibleItemCount: 1,
        cachedWindowHash: firstWindow.window_hash,
        feedWindowSyncVersion: FEED_WINDOW_SYNC_VERSION,
      },
    );

    expect(send).toHaveBeenCalledTimes(2);
    const legacy = JSON.parse(send.mock.calls[0][0]);
    const sidecar = JSON.parse(send.mock.calls[1][0]);
    expect(legacy).toMatchObject({
      type: "thread_window_sync",
      cache_hit: true,
      entries: [],
    });
    expect(sidecar).toMatchObject({
      type: "feed_window_sync",
      sync: {
        version: FEED_WINDOW_SYNC_VERSION,
        source: "thread_window",
        threadKey: "q-1040",
        windowHash: firstWindow.window_hash,
        bounds: {
          from: 0,
          count: 1,
          total: 1,
          hasOlderItems: false,
          hasNewerItems: false,
          sourceHistoryLength: 1,
        },
      },
    });
    expect(sidecar.sync.items).toEqual([
      expect.objectContaining({ messageId: "u-thread", historyIndex: 0, messageType: "user_message" }),
    ]);
  });
});

describe("initial selected thread subscribe", () => {
  it("sends the selected window before tree state, transient replay, and the final snapshot", async () => {
    const ws = { data: {}, send: vi.fn() };
    const deps = makeInjectDeps({
      getTreeGroupState: vi.fn(async () => ({
        groups: [{ id: "group-1" }],
        assignments: { "test-session": "group-1" },
        nodeOrder: {},
      })),
    });
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
      isGenerating: true,
      activeTurnRoute: { threadKey: "q-1825", questId: "q-1825" },
      nextEventSeq: 2,
      browserSockets: new Set(),
      messageHistory: [
        { type: "user_message", id: "u-main", content: "main", timestamp: 1 } as BrowserIncomingMessage,
        {
          type: "user_message",
          id: "u-thread",
          content: "selected",
          timestamp: 2,
          threadKey: "q-1825",
          questId: "q-1825",
          threadRefs: [{ threadKey: "q-1825", questId: "q-1825", source: "explicit" }],
        } as BrowserIncomingMessage,
      ],
      eventBuffer: [
        {
          seq: 1,
          message: {
            type: "tool_progress",
            tool_use_id: "tool-1",
            tool_name: "Bash",
            elapsed_time_seconds: 1,
          },
        },
      ],
    });

    handleBrowserOpen(session, ws, deps);
    ws.send.mockClear();
    await handleSessionSubscribe(
      session,
      ws,
      0,
      0,
      undefined,
      10,
      3,
      FEED_WINDOW_SYNC_VERSION,
      {
        thread_key: "q-1825",
        from_item: -1,
        item_count: 30,
        section_item_count: 10,
        visible_item_count: 3,
      },
      deps,
    );

    const calls = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    const types = calls.map((message) => message.type);
    expect(types).toEqual([
      "leader_projection_snapshot",
      "thread_window_sync",
      "feed_window_sync",
      "tree_groups_update",
      "event_replay",
      "timer_update",
      "conversation_sync_complete",
      "state_snapshot",
    ]);
    expect(calls[1]).toMatchObject({
      type: "thread_window_sync",
      thread_key: "q-1825",
      entries: [expect.objectContaining({ message: expect.objectContaining({ id: "u-thread" }) })],
    });
    expect(types).not.toContain("history_window_sync");
    expect(types).not.toContain("history_sync");
  });

  it("falls back to the legacy bounded history window for an unsupported initial thread", async () => {
    const ws = { data: {}, send: vi.fn() };
    const deps = makeInjectDeps();
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
      messageHistory: [{ type: "user_message", id: "u-main", content: "main", timestamp: 1 } as any],
    });
    handleBrowserOpen(session, ws, deps);
    ws.send.mockClear();

    await handleSessionSubscribe(
      session,
      ws,
      0,
      0,
      undefined,
      1,
      1,
      FEED_WINDOW_SYNC_VERSION,
      {
        thread_key: "all",
        from_item: -1,
        item_count: 1,
        section_item_count: 1,
        visible_item_count: 1,
      },
      deps,
    );

    const calls = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    expect(calls.some((message) => message.type === "history_window_sync")).toBe(true);
    expect(calls.some((message) => message.type === "thread_window_sync")).toBe(false);
  });

  it("sends an authoritative empty Main thread window for an empty leader session", async () => {
    const ws = { data: {}, send: vi.fn() };
    const deps = makeInjectDeps();
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
      messageHistory: [],
    });
    handleBrowserOpen(session, ws, deps);
    ws.send.mockClear();

    await handleSessionSubscribe(
      session,
      ws,
      0,
      0,
      undefined,
      10,
      3,
      FEED_WINDOW_SYNC_VERSION,
      {
        thread_key: "main",
        from_item: -1,
        item_count: 30,
        section_item_count: 10,
        visible_item_count: 3,
      },
      deps,
    );

    const calls = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    expect(calls.find((message) => message.type === "thread_window_sync")).toMatchObject({
      thread_key: "main",
      entries: [],
      window: { total_items: 0, item_count: 0, source_history_length: 0 },
    });
    expect(calls.some((message) => message.type === "history_window_sync")).toBe(false);
  });
});
