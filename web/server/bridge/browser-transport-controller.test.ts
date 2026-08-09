/**
 * Regression tests for tree_groups_update replay-buffer exclusion (q-599).
 *
 * tree_groups_update is a global snapshot event. Buffering it per-session
 * causes replay-buffer bloat on restart and stale-snapshot overwrites on
 * reconnect (the fresh-on-open snapshot at handleBrowserOpen is clobbered
 * by an older buffered copy during event_replay).
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  broadcastToBrowsers,
  buildLeaderProjectionSnapshotForSession,
  freezeHistoryThroughCurrentTail,
  handleBrowserOpen,
  handleBrowserProtocolMessage,
  handleBrowserIngressMessage,
  handleSessionSubscribe,
  injectUserMessage,
  sendLeaderProjectionSnapshot,
  sendStateSnapshot,
  sendHistoryWindowSync,
  sendThreadWindowSync,
  type BrowserTransportSessionLike,
} from "./browser-transport-controller.js";
import type { BackendType, BrowserIncomingMessage, ReplayableBrowserIncomingMessage } from "../session-types.js";
import { RecorderManager } from "../recorder.js";
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

describe("archived session browser viewing", () => {
  it("opens an archived session as a passive history socket without live refresh or relaunch", async () => {
    // Archived viewing still needs a browser WebSocket so session_subscribe can
    // lazy-load persisted history, but opening it must not perform live-session
    // refresh work or wake an exited backend.
    const ws = { data: {}, send: vi.fn() };
    const requestCliRelaunch = vi.fn();
    const deps = makeInjectDeps({
      getLauncherSessionInfo: vi.fn(() => ({ archived: true, state: "exited", backendType: "claude" })),
      backendAttached: vi.fn(() => false),
      requestCliRelaunch,
    });
    const session = makeSession({ browserSockets: new Set(), state: { backend_state: "initializing" } as any });

    handleBrowserOpen(session, ws, deps);
    await Promise.resolve();

    expect(deps.refreshGitInfoThenRecomputeDiff).not.toHaveBeenCalled();
    expect(deps.prefillSlashCommands).not.toHaveBeenCalled();
    expect(deps.backendAttached).not.toHaveBeenCalled();
    expect(requestCliRelaunch).not.toHaveBeenCalled();
    const sentTypes = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)).type);
    expect(sentTypes).toContain("session_init");
    expect(sentTypes).toContain("backend_disconnected");
  });

  it("serves archived history subscribe without pending-delivery recovery side effects", async () => {
    // Search-data-only archived sessions are expected to hydrate full history on
    // subscribe. The archived path must not also finalize terminal tools or arm
    // Codex watchdog recovery while doing that read-only load.
    const ws = { data: {}, send: vi.fn() };
    const deps = makeInjectDeps({
      getLauncherSessionInfo: vi.fn(() => ({ archived: true, state: "exited", backendType: "codex" })),
      lazyLoadFullHistory: vi.fn(async (target: BrowserTransportSessionLike) => {
        target.messageHistory = [{ type: "user_message", content: "archived history", id: "m1" } as any];
        (target as any).searchDataOnly = false;
      }),
    });
    const session = makeSession({ messageHistory: [] });
    (session as any).searchDataOnly = true;

    await handleSessionSubscribe(session, ws, 0, 0, undefined, undefined, undefined, undefined, undefined, deps);

    expect(deps.lazyLoadFullHistory).toHaveBeenCalledWith(session);
    expect(deps.recoverToolStartTimesFromHistory).not.toHaveBeenCalled();
    expect(deps.finalizeRecoveredDisconnectedTerminalTools).not.toHaveBeenCalled();
    expect(deps.scheduleCodexToolResultWatchdogs).not.toHaveBeenCalled();
    const historySync = ws.send.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .find((msg) => msg.type === "history_sync");
    expect(historySync?.hot_messages).toEqual([{ type: "user_message", content: "archived history", id: "m1" }]);
  });

  it("ignores model-bound browser messages for archived sessions", async () => {
    // A stale or malicious composer payload for an archived session should be a
    // no-op: no activity touch, no queueing, no route to backend recovery.
    const routeBrowserMessage = vi.fn();
    const deps = makeInjectDeps({
      routeBrowserMessage,
      getLauncherSessionInfo: vi.fn(() => ({ archived: true, state: "exited", backendType: "codex" })),
    });
    const session = makeSession();

    const result = await handleBrowserIngressMessage(
      session,
      { type: "user_message", content: "should not resume", client_msg_id: "archived-c1" },
      undefined,
      deps,
    );

    expect(result).toMatchObject({ status: "ignored_no_owner", reason: "archived_read_only" });
    expect(routeBrowserMessage).not.toHaveBeenCalled();
    expect(deps.touchActivity).not.toHaveBeenCalled();
    expect(deps.persistSession).not.toHaveBeenCalled();
  });
});

describe("state snapshot notification projection", () => {
  it("does not hydrate read or closed leader reviews as active unread", () => {
    // q-1735 live shape: raw persistence has four already-read unresolved
    // reviews plus one newer closed-thread review. The browser snapshot must
    // carry the same zero-count projection as the compact session list.
    const ws = { send: vi.fn() };
    const session = makeSession({
      state: {
        permissionMode: "default",
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-2000"],
          closedThreadTombstones: [
            { threadKey: "q-1001", closedAt: 5001 },
            { threadKey: "q-1002", closedAt: 5002 },
            { threadKey: "q-1003", closedAt: 5003 },
            { threadKey: "q-1004", closedAt: 5004 },
            { threadKey: "q-1710", closedAt: 5005 },
          ],
          updatedAt: 5005,
        },
      } as any,
      lastReadAt: 2000,
      notificationStatusVersion: 7,
      notificationStatusUpdatedAt: 7000,
      notifications: [
        { id: "n-old-1", category: "review", timestamp: 1000, threadKey: "q-1001", done: false },
        { id: "n-old-2", category: "review", timestamp: 1100, threadKey: "q-1002", done: false },
        { id: "n-old-3", category: "review", timestamp: 1200, threadKey: "q-1003", done: false },
        { id: "n-old-4", category: "review", timestamp: 1300, threadKey: "q-1004", done: false },
        { id: "n-closed", category: "review", timestamp: 3000, threadKey: "q-1710", done: false },
      ],
    });

    sendStateSnapshot(session, ws, makeInjectDeps());

    const snapshot = JSON.parse(String(ws.send.mock.calls[0]?.[0]));
    expect(snapshot).toMatchObject({
      type: "state_snapshot",
      notifications: [],
      notificationUrgency: null,
      activeNotificationCount: 0,
      activeReviewNotificationCount: 0,
      notificationStatusVersion: 7,
      notificationStatusUpdatedAt: 7000,
    });
  });
});

describe("tree_groups_update replay-buffer exclusion", () => {
  it("should NOT buffer tree_groups_update in eventBuffer", () => {
    const session = makeSession();
    const deps = makeDeps();

    broadcastToBrowsers(
      session,
      {
        type: "tree_groups_update",
        treeGroups: [{ id: "g1", name: "Group 1" }],
        treeAssignments: {},
        treeNodeOrder: {},
      } as BrowserIncomingMessage,
      deps,
    );

    expect(session.eventBuffer).toHaveLength(0);
    expect(deps.persistSession).not.toHaveBeenCalled();
  });

  it("should still send tree_groups_update to connected browsers (live fanout)", () => {
    const sendFn = vi.fn();
    const mockSocket = { send: sendFn };
    const session = makeSession({ browserSockets: new Set([mockSocket]) });
    const deps = makeDeps();

    broadcastToBrowsers(
      session,
      {
        type: "tree_groups_update",
        treeGroups: [],
        treeAssignments: {},
        treeNodeOrder: {},
      } as BrowserIncomingMessage,
      deps,
    );

    expect(sendFn).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sendFn.mock.calls[0][0]);
    expect(sent.type).toBe("tree_groups_update");
    expect(sent.seq).toBeDefined();
  });

  it("should still buffer normal session events like session_update", () => {
    const session = makeSession();
    const deps = makeDeps();

    broadcastToBrowsers(session, { type: "session_update", session: { name: "test" } } as BrowserIncomingMessage, deps);

    expect(session.eventBuffer).toHaveLength(1);
    expect(session.eventBuffer[0].message.type).toBe("session_update");
  });

  it("should respect skipBuffer option for any message type", () => {
    const session = makeSession();
    const deps = makeDeps();

    broadcastToBrowsers(
      session,
      { type: "session_update", session: { name: "test" } } as BrowserIncomingMessage,
      deps,
      { skipBuffer: true },
    );

    expect(session.eventBuffer).toHaveLength(0);
  });

  it("should not buffer or persist across multiple sessions receiving tree_groups_update", () => {
    // broadcastGlobal() iterates sessions calling broadcastToBrowsers with { skipBuffer: true }.
    // We test both defenses here: the type exclusion alone prevents buffering, and skipBuffer
    // (verified by the "should respect skipBuffer option" test) provides belt-and-suspenders.
    const sessions = [makeSession({ id: "s1" }), makeSession({ id: "s2" }), makeSession({ id: "s3" })];
    const deps = makeDeps();
    const msg = {
      type: "tree_groups_update",
      treeGroups: [],
      treeAssignments: {},
      treeNodeOrder: {},
    } as BrowserIncomingMessage;

    for (const session of sessions) {
      broadcastToBrowsers(session, msg, deps);
    }

    for (const session of sessions) {
      expect(session.eventBuffer).toHaveLength(0);
    }
    expect(deps.persistSession).not.toHaveBeenCalled();
  });

  it("does no recording work for global broadcasts when automatic capture is off", () => {
    // broadcastGlobal() invokes this browser transport callback once per session.
    // The disabled recorder must reject every callback before creating any
    // per-session recorder, buffer, directory, or file.
    const root = mkdtempSync(join(tmpdir(), "browser-broadcast-recording-test-"));
    const recordingsDir = join(root, "recordings");
    const recorder = new RecorderManager({ globalEnabled: false, recordingsDir });
    const deps = {
      ...makeDeps(),
      recordOutgoingRaw: (sessionId: string, json: string, backendType: string, cwd: string) =>
        recorder.record(sessionId, "out", json, "browser", backendType as BackendType, cwd),
    };
    const sessions = [makeSession({ id: "s1" }), makeSession({ id: "s2" }), makeSession({ id: "s3" })];
    const msg = { type: "quest_list_updated" } as BrowserIncomingMessage;

    try {
      for (const session of sessions) {
        broadcastToBrowsers(session, msg, deps, { skipBuffer: true });
      }

      expect(existsSync(recordingsDir)).toBe(false);
      for (const session of sessions) {
        expect(recorder.getActiveRecorderStats(session.id)).toBeNull();
      }
    } finally {
      recorder.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Codex auto-pause recovery summary fanout", () => {
  it("projects active manual recovery testing authoritatively to reconnecting browsers", () => {
    // Restored pending-turn metadata is sufficient to reconstruct the same
    // presentation fact after restart; no browser-local composer state participates.
    const first = { send: vi.fn() };
    const second = { send: vi.fn() };
    const session = makeSession({
      isGenerating: true,
      state: {
        permissionMode: "default",
        codex_result_error_auto_pause: {
          family: "copilot_auth_refresh_exhausted",
          fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
          streak: 1,
          threshold: 1,
          pausedAt: 123,
          lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
          lastErrorAt: 456,
          lastSourceKind: "automatic",
          totalMatchingErrors: 1,
          heldInputs: [],
        },
      } as any,
      pendingCodexTurns: [
        {
          autoPauseSourceKind: "manual",
          status: "backend_acknowledged",
          turnTarget: "current",
        } as any,
      ],
    });

    sendStateSnapshot(session, first, makeInjectDeps());
    sendStateSnapshot(session, second, makeInjectDeps());

    for (const socket of [first, second]) {
      expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toMatchObject({
        type: "state_snapshot",
        codexAutoPauseRecoveryTesting: true,
      });
    }

    session.isGenerating = false;
    const pendingRetry = { send: vi.fn() };
    sendStateSnapshot(session, pendingRetry, makeInjectDeps());
    expect(JSON.parse(String(pendingRetry.send.mock.calls[0]?.[0]))).toMatchObject({
      type: "state_snapshot",
      codexAutoPauseRecoveryTesting: true,
    });

    session.pendingCodexTurns = [];
    const afterTerminal = { send: vi.fn() };
    sendStateSnapshot(session, afterTerminal, makeInjectDeps());
    expect(JSON.parse(String(afterTerminal.send.mock.calls[0]?.[0]))).toMatchObject({
      type: "state_snapshot",
      codexAutoPauseRecoveryTesting: false,
    });
  });

  it("keeps persisted recovery-transfer payloads out of browser state snapshots", () => {
    const ws = { send: vi.fn() };
    const session = makeSession({
      recoveryDeliveryTransfers: [
        {
          id: "recovery-transfer-1234567890abcdef12345678",
          createdAt: 10,
          sourceOwnerKind: "auto_pause",
          sourceOwnerId: "held-1",
          sourceOwnerCount: 1,
          payloadBytes: 20,
          message: {
            type: "user_message",
            content: "private transfer payload sentinel",
            autoPauseRecoveries: [{ summaryId: "summary-1", groupId: "group-1" }],
          },
        },
      ],
    });

    sendStateSnapshot(session, ws, makeInjectDeps());

    expect(JSON.stringify(ws.send.mock.calls)).not.toContain("private transfer payload sentinel");
    expect(JSON.stringify(ws.send.mock.calls)).not.toContain("recoveryDeliveryTransfers");
  });

  it("projects the same mutable server-authored receipt to two browsers", () => {
    // Both tabs receive the same stable history identity; neither browser invents or merges terminal state locally.
    const first = { send: vi.fn() };
    const second = { send: vi.fn() };
    const session = makeSession({ browserSockets: new Set([first, second]) });
    const deps = makeDeps();
    const message = {
      type: "codex_auto_pause_recovery_summary",
      id: "recovery-summary",
      timestamp: 100,
      content: "Automatic input recovery: 1 delivered.",
      searchText: "automatic input recovery outcome:delivered",
      recovery: {
        family: "copilot_auth_refresh_exhausted",
        pausedAt: 10,
        recoveryConfirmedAt: 20,
        updatedAt: 100,
        status: "settled",
        receipts: [],
      },
    } as BrowserIncomingMessage;

    broadcastToBrowsers(session, message, deps);

    for (const socket of [first, second]) {
      expect(socket.send).toHaveBeenCalledOnce();
      expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
        type: "codex_auto_pause_recovery_summary",
        id: "recovery-summary",
        recovery: { status: "settled" },
      });
    }
    expect(session.eventBuffer[0]?.message.type).toBe("codex_auto_pause_recovery_summary");
  });

  it("keeps an unresolved mutable summary out of the frozen browser prefix", () => {
    // Incremental history hashes assume frozen rows are immutable; the summary freezes only after delivered turns finish.
    const summary = {
      type: "codex_auto_pause_recovery_summary",
      id: "recovery-summary",
      timestamp: 3,
      content: "Automatic input recovery: 1 delivered.",
      searchText: "automatic input recovery outcome:delivered completion:pending",
      recovery: {
        family: "copilot_auth_refresh_exhausted",
        pausedAt: 1,
        recoveryConfirmedAt: 2,
        updatedAt: 3,
        status: "settled",
        receipts: [{ outcome: "delivered" }],
      },
    } as BrowserIncomingMessage;
    const session = makeSession({
      messageHistory: [
        { type: "user_message", id: "u1", content: "probe", timestamp: 1 } as BrowserIncomingMessage,
        { type: "result", data: { is_error: false } } as BrowserIncomingMessage,
        summary,
      ],
    });

    freezeHistoryThroughCurrentTail(session);
    expect(session.frozenCount).toBe(2);

    if (summary.type === "codex_auto_pause_recovery_summary") {
      summary.recovery.receipts[0] = { ...summary.recovery.receipts[0]!, completedAt: 4 } as any;
    }
    freezeHistoryThroughCurrentTail(session);
    expect(session.frozenCount).toBe(3);
  });

  it("advances the frozen browser prefix for interrupted delivered receipt finality", () => {
    const summary = {
      type: "codex_auto_pause_recovery_summary",
      id: "interrupted-recovery-summary",
      timestamp: 3,
      content: "Automatic input recovery: 1 delivered.",
      searchText: "automatic input recovery outcome:delivered completion:pending",
      recovery: {
        family: "copilot_auth_refresh_exhausted",
        pausedAt: 1,
        recoveryConfirmedAt: 2,
        updatedAt: 3,
        status: "settled",
        receipts: [{ outcome: "delivered" }],
      },
    } as BrowserIncomingMessage;
    const session = makeSession({
      messageHistory: [
        { type: "user_message", id: "u1", content: "probe", timestamp: 1 } as BrowserIncomingMessage,
        { type: "result", data: { is_error: false } } as BrowserIncomingMessage,
        summary,
      ],
    });

    freezeHistoryThroughCurrentTail(session);
    expect(session.frozenCount).toBe(2);

    if (summary.type === "codex_auto_pause_recovery_summary") {
      summary.recovery.receipts[0] = {
        ...summary.recovery.receipts[0]!,
        finalizedAt: 4,
        finalityReason: "turn_interrupted_or_cancelled",
      } as any;
    }
    freezeHistoryThroughCurrentTail(session);
    expect(session.frozenCount).toBe(3);
  });
});

describe("quest_list_updated replay-buffer exclusion", () => {
  it("does not buffer quest_list_updated invalidations while preserving live fanout", () => {
    const sendFn = vi.fn();
    const session = makeSession({ browserSockets: new Set([{ send: sendFn }]) });
    const deps = makeDeps();

    broadcastToBrowsers(session, { type: "quest_list_updated" } as BrowserIncomingMessage, deps);

    expect(sendFn).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sendFn.mock.calls[0][0]);
    expect(sent.type).toBe("quest_list_updated");
    expect(sent.seq).toBeDefined();
    expect(session.eventBuffer).toHaveLength(0);
    expect(deps.persistSession).not.toHaveBeenCalled();
  });
});

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
    expect(session.state.leaderOpenThreadTabs).toEqual(serverState);
    expect(deps.persistSession).toHaveBeenCalledTimes(1);
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

describe("leader text stream replay-buffer exclusion", () => {
  it("sends top-level leader text deltas live without storing them for reconnect replay", () => {
    const sendFn = vi.fn();
    const session = makeSession({
      browserSockets: new Set([{ send: sendFn }]),
      state: { permissionMode: "default", isOrchestrator: true } as any,
    });
    const deps = makeDeps();

    broadcastToBrowsers(
      session,
      {
        type: "stream_event",
        parent_tool_use_id: null,
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "[thread:q-1] " } },
      },
      deps,
    );

    expect(sendFn).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sendFn.mock.calls[0][0]);
    expect(sent.type).toBe("stream_event");
    expect(sent.seq).toBeDefined();
    expect(session.eventBuffer).toHaveLength(0);
    expect(deps.persistSession).not.toHaveBeenCalled();
  });

  it("keeps worker top-level text deltas and nested leader text deltas in the replay buffer", () => {
    const leaderSession = makeSession({ state: { permissionMode: "default", isOrchestrator: true } as any });
    const workerSession = makeSession({ id: "worker-session" });
    const deps = makeDeps();

    broadcastToBrowsers(
      workerSession,
      {
        type: "stream_event",
        parent_tool_use_id: null,
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "worker" } },
      },
      deps,
    );
    broadcastToBrowsers(
      leaderSession,
      {
        type: "stream_event",
        parent_tool_use_id: "agent-1",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "nested" } },
      },
      deps,
    );

    expect(workerSession.eventBuffer).toHaveLength(1);
    expect(leaderSession.eventBuffer).toHaveLength(1);
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

describe("history window tool results", () => {
  it("includes resolved previews for visible Codex tools even when the preview is outside the window slice", () => {
    const send = vi.fn();
    const session = makeSession({
      backendType: "codex",
      messageHistory: [
        {
          type: "user_message",
          id: "u1",
          content: "Check status",
          timestamp: 1,
        } as BrowserIncomingMessage,
        {
          type: "assistant",
          message: {
            id: "a1",
            type: "message",
            role: "assistant",
            model: "gpt-5.5",
            content: [
              {
                type: "tool_use",
                id: "call-orphaned",
                name: "Bash",
                input: { command: "git status --short" },
              },
            ],
            stop_reason: null,
            usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
          parent_tool_use_id: null,
          timestamp: 2,
          tool_start_times: { "call-orphaned": 2 },
        } as BrowserIncomingMessage,
        {
          type: "result",
          data: {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "Done",
            duration_ms: 1000,
            duration_api_ms: 900,
            num_turns: 1,
            total_cost_usd: 0,
            stop_reason: "end_turn",
            session_id: "test-session",
          },
        } as BrowserIncomingMessage,
        {
          type: "tool_result_preview",
          previews: [
            {
              tool_use_id: "call-orphaned",
              content: "Terminal command did not deliver a final result after a later tool completed.",
              is_error: false,
              total_size: 77,
              is_truncated: false,
              duration_seconds: 121.7,
              synthetic_reason: "superseded_by_later_completed_tool",
              retained_output: false,
            },
          ],
        } as BrowserIncomingMessage,
      ],
    });

    sendHistoryWindowSync(
      session,
      { send },
      { fromTurn: 0, turnCount: 1, sectionTurnCount: 1, visibleSectionCount: 1 },
    );

    const payload = JSON.parse(send.mock.calls[0][0]);
    expect(payload.type).toBe("history_window_sync");
    expect(payload.messages.map((msg: BrowserIncomingMessage) => msg.type)).toEqual([
      "user_message",
      "assistant",
      "result",
      "tool_result_preview",
    ]);
    expect(payload.messages.at(-1).previews[0]).toMatchObject({
      tool_use_id: "call-orphaned",
      synthetic_reason: "superseded_by_later_completed_tool",
      retained_output: false,
    });
  });

  it("omits history payload when the browser proves its cached window still matches", () => {
    const send = vi.fn();
    const session = makeSession({
      messageHistory: [
        { type: "user_message", id: "u1", content: "turn 1", timestamp: 1000 } as BrowserIncomingMessage,
        {
          type: "result",
          data: {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "",
            duration_ms: 1,
            duration_api_ms: 1,
            num_turns: 1,
            total_cost_usd: 0,
            session_id: "test-session",
          },
        } as BrowserIncomingMessage,
        { type: "user_message", id: "u2", content: "turn 2", timestamp: 2000 } as BrowserIncomingMessage,
      ],
    });

    sendHistoryWindowSync(
      session,
      { send },
      { fromTurn: 0, turnCount: 1, sectionTurnCount: 1, visibleSectionCount: 1 },
    );
    const firstPayload = JSON.parse(send.mock.calls[0][0]);
    send.mockClear();

    sendHistoryWindowSync(
      session,
      { send },
      {
        fromTurn: 0,
        turnCount: 1,
        sectionTurnCount: 1,
        visibleSectionCount: 1,
        cachedWindowHash: firstPayload.window.window_hash,
      },
    );

    const payload = JSON.parse(send.mock.calls[0][0]);
    expect(payload.type).toBe("history_window_sync");
    expect(payload.window).toMatchObject({ has_older_items: false, has_newer_items: true });
    expect(payload.cache_hit).toBe(true);
    expect(payload.messages).toEqual([]);
    expect(payload.window.window_hash).toBe(firstPayload.window.window_hash);
  });

  it("treats negative history window fromTurn as the latest bounded window", () => {
    const send = vi.fn();
    const session = makeSession({
      messageHistory: [
        { type: "user_message", id: "u1", content: "turn 1", timestamp: 1000 } as BrowserIncomingMessage,
        {
          type: "result",
          data: {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "",
            duration_ms: 1,
            duration_api_ms: 1,
            num_turns: 1,
            total_cost_usd: 0,
            session_id: "test-session",
          },
        } as BrowserIncomingMessage,
        { type: "user_message", id: "u2", content: "turn 2", timestamp: 2000 } as BrowserIncomingMessage,
        {
          type: "result",
          data: {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "",
            duration_ms: 1,
            duration_api_ms: 1,
            num_turns: 1,
            total_cost_usd: 0,
            session_id: "test-session",
          },
        } as BrowserIncomingMessage,
        { type: "user_message", id: "u3", content: "turn 3", timestamp: 3000 } as BrowserIncomingMessage,
      ],
    });

    sendHistoryWindowSync(
      session,
      { send },
      { fromTurn: -1, turnCount: 2, sectionTurnCount: 1, visibleSectionCount: 2 },
    );

    const payload = JSON.parse(send.mock.calls[0][0]);
    expect(payload.type).toBe("history_window_sync");
    expect(payload.window.from_turn).toBe(1);
    expect(payload.window.turn_count).toBe(2);
    expect(payload.window).toMatchObject({ has_older_items: true, has_newer_items: false });
    expect(payload.messages.map((message: BrowserIncomingMessage) => (message as { id?: string }).id)).toEqual([
      "u2",
      undefined,
      "u3",
    ]);
  });

  it("centers a bounded history window on an explicit message target", () => {
    const send = vi.fn();
    const messageHistory: BrowserIncomingMessage[] = [];
    for (let turn = 0; turn < 10; turn++) {
      messageHistory.push({
        type: "user_message",
        id: `u-${turn}`,
        content: `turn ${turn}`,
        timestamp: turn,
      } as BrowserIncomingMessage);
      messageHistory.push({
        type: "result",
        data: {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "",
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          total_cost_usd: 0,
          session_id: "test-session",
        },
      } as BrowserIncomingMessage);
    }
    const session = makeSession({ messageHistory });

    sendHistoryWindowSync(
      session,
      { send },
      {
        fromTurn: -1,
        turnCount: 3,
        sectionTurnCount: 1,
        visibleSectionCount: 3,
        targetMessageId: "u-4",
      },
    );

    const payload = JSON.parse(send.mock.calls[0][0]);
    expect(payload.window).toMatchObject({ from_turn: 3, turn_count: 3, has_older_items: true, has_newer_items: true });
    expect(payload.messages.some((message: BrowserIncomingMessage) => (message as { id?: string }).id === "u-4")).toBe(
      true,
    );
  });

  it("sends additive feed_window_sync only when the browser advertises v1 support", () => {
    const send = vi.fn();
    const session = makeSession({
      messageHistory: [
        { type: "user_message", id: "u1", content: "turn 1", timestamp: 1000 } as BrowserIncomingMessage,
        {
          type: "result",
          data: {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "",
            duration_ms: 1,
            duration_api_ms: 1,
            num_turns: 1,
            total_cost_usd: 0,
            session_id: "test-session",
          },
        } as BrowserIncomingMessage,
      ],
    });

    sendHistoryWindowSync(
      session,
      { send },
      { fromTurn: 0, turnCount: 1, sectionTurnCount: 1, visibleSectionCount: 1 },
    );
    expect(send).toHaveBeenCalledTimes(1);

    send.mockClear();
    sendHistoryWindowSync(
      session,
      { send },
      {
        fromTurn: 0,
        turnCount: 1,
        sectionTurnCount: 1,
        visibleSectionCount: 1,
        feedWindowSyncVersion: FEED_WINDOW_SYNC_VERSION,
      },
    );

    expect(send).toHaveBeenCalledTimes(2);
    const legacy = JSON.parse(send.mock.calls[0][0]);
    const sidecar = JSON.parse(send.mock.calls[1][0]);
    expect(legacy.type).toBe("history_window_sync");
    expect(sidecar).toMatchObject({
      type: "feed_window_sync",
      sync: {
        version: FEED_WINDOW_SYNC_VERSION,
        source: "history_window",
        threadKey: "main",
        bounds: { from: 0, count: 1, total: 1, hasOlderItems: false, hasNewerItems: false },
      },
    });
    expect(sidecar.sync.windowHash).toBe(legacy.window.window_hash);
    expect(sidecar.sync.items.map((item: any) => item.messageId)).toEqual(["u1", "result:1"]);
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

describe("bounded conversation reconnect protocol", () => {
  it("refreshes the selected thread on a soft reconnect without passive history_sync", async () => {
    const ws = { data: {}, send: vi.fn() };
    const deps = makeInjectDeps();
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
      browserSockets: new Set(),
      nextEventSeq: 5,
      messageHistory: [
        {
          type: "user_message",
          id: "u-selected",
          content: "selected",
          timestamp: 1,
          threadKey: "q-1831",
          questId: "q-1831",
          threadRefs: [{ threadKey: "q-1831", questId: "q-1831", source: "explicit" }],
        } as BrowserIncomingMessage,
        {
          type: "assistant",
          message: { id: "a-selected", role: "assistant", content: [{ type: "text", text: "reply" }] },
          parent_tool_use_id: null,
          threadKey: "q-1831",
          questId: "q-1831",
        } as BrowserIncomingMessage,
      ],
      eventBuffer: [
        {
          seq: 3,
          message: {
            type: "assistant",
            message: { id: "a-selected", role: "assistant", content: [{ type: "text", text: "reply" }] },
            parent_tool_use_id: null,
            threadKey: "q-1831",
            questId: "q-1831",
          } as unknown as ReplayableBrowserIncomingMessage,
        },
        { seq: 4, message: { type: "status_change", status: "idle" } },
      ],
    });
    handleBrowserOpen(session, ws, deps);
    ws.send.mockClear();

    await handleSessionSubscribe(
      session,
      ws,
      2,
      0,
      undefined,
      10,
      3,
      FEED_WINDOW_SYNC_VERSION,
      {
        thread_key: "q-1831",
        from_item: -1,
        item_count: 30,
        section_item_count: 10,
        visible_item_count: 3,
      },
      deps,
    );

    const calls = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    expect(calls.some((message) => message.type === "history_sync")).toBe(false);
    expect(calls.find((message) => message.type === "thread_window_sync")).toMatchObject({
      thread_key: "q-1831",
      entries: expect.arrayContaining([
        expect.objectContaining({ message: expect.objectContaining({ id: "u-selected" }) }),
      ]),
    });
    expect(calls.find((message) => message.type === "event_replay")?.events).toEqual([
      { seq: 4, message: { type: "status_change", status: "idle" } },
    ]);
    expect(calls.find((message) => message.type === "conversation_sync_complete")).toEqual({
      type: "conversation_sync_complete",
      through_seq: 4,
    });
  });

  it("preserves history_sync for a legacy soft reconnect", async () => {
    const ws = { data: {}, send: vi.fn() };
    const deps = makeInjectDeps();
    const assistant = {
      type: "assistant",
      message: { id: "a-legacy", role: "assistant", content: [{ type: "text", text: "legacy" }] },
      parent_tool_use_id: null,
    } as ReplayableBrowserIncomingMessage;
    const session = makeSession({
      browserSockets: new Set(),
      nextEventSeq: 3,
      messageHistory: [assistant],
      eventBuffer: [{ seq: 2, message: assistant }],
    });
    handleBrowserOpen(session, ws, deps);
    ws.send.mockClear();

    await handleSessionSubscribe(session, ws, 1, 0, undefined, undefined, undefined, undefined, undefined, deps);

    const calls = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    expect(calls.some((message) => message.type === "history_sync")).toBe(true);
    expect(calls.some((message) => message.type === "conversation_sync_complete")).toBe(false);
  });

  it("keeps a capable socket bounded after an explicit full-history sync", async () => {
    const ws = { data: {}, send: vi.fn() };
    const deps = makeInjectDeps();
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
      browserSockets: new Set(),
      messageHistory: [
        { type: "user_message", id: "main-noise", content: "main", timestamp: 1 } as BrowserIncomingMessage,
        {
          type: "user_message",
          id: "selected",
          content: "selected",
          timestamp: 2,
          threadKey: "q-1831",
          questId: "q-1831",
          threadRefs: [{ threadKey: "q-1831", questId: "q-1831", source: "explicit" }],
        } as BrowserIncomingMessage,
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
        thread_key: "q-1831",
        from_item: -1,
        item_count: 30,
        section_item_count: 10,
        visible_item_count: 3,
      },
      deps,
      undefined,
      undefined,
      true,
    );

    expect(ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)).type)).toContain("history_sync");
    expect(ws.data).toMatchObject({ boundedConversation: true });
    ws.send.mockClear();

    broadcastToBrowsers(session, { type: "message_history", messages: session.messageHistory }, deps);

    const calls = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    expect(calls.map((message) => message.type)).toEqual([
      "thread_window_sync",
      "feed_window_sync",
      "conversation_sync_complete",
    ]);
    expect(JSON.stringify(calls)).not.toContain("main-noise");
  });

  it("uses a bounded raw history window for a capable All Threads soft reconnect", async () => {
    const ws = { data: {}, send: vi.fn() };
    const deps = makeInjectDeps();
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
      browserSockets: new Set(),
      nextEventSeq: 7,
      messageHistory: Array.from({ length: 20 }, (_, index) => ({
        type: "user_message",
        id: `u-${index}`,
        content: `message ${index}`,
        timestamp: index,
      })) as BrowserIncomingMessage[],
    });
    handleBrowserOpen(session, ws, deps);
    ws.send.mockClear();

    await handleSessionSubscribe(session, ws, 4, 0, undefined, 2, 2, FEED_WINDOW_SYNC_VERSION, undefined, deps);

    const calls = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    expect(calls.some((message) => message.type === "history_sync")).toBe(false);
    expect(calls.find((message) => message.type === "history_window_sync")?.messages.length).toBeLessThan(20);
    expect(calls.find((message) => message.type === "conversation_sync_complete")?.through_seq).toBe(6);
  });

  it("delivers live conversation content only to the capable socket viewing its thread", async () => {
    const first = { data: {}, send: vi.fn() };
    const second = { data: {}, send: vi.fn() };
    const deps = makeInjectDeps();
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
      browserSockets: new Set(),
    });
    handleBrowserOpen(session, first, deps);
    handleBrowserOpen(session, second, deps);
    const subscribe = (ws: typeof first, threadKey: string) =>
      handleSessionSubscribe(
        session,
        ws,
        0,
        0,
        undefined,
        10,
        3,
        FEED_WINDOW_SYNC_VERSION,
        {
          thread_key: threadKey,
          from_item: -1,
          item_count: 30,
          section_item_count: 10,
          visible_item_count: 3,
        },
        deps,
      );
    await subscribe(first, "q-1831");
    await subscribe(second, "q-9999");
    first.send.mockClear();
    second.send.mockClear();

    broadcastToBrowsers(
      session,
      {
        type: "assistant",
        message: { id: "a-live", role: "assistant", content: [{ type: "text", text: "live" }] },
        parent_tool_use_id: null,
        threadKey: "q-1831",
        questId: "q-1831",
      } as BrowserIncomingMessage,
      deps,
    );
    broadcastToBrowsers(session, { type: "session_update", session: { model: "updated" } }, deps);

    expect(first.send.mock.calls.map(([raw]) => JSON.parse(String(raw)).type)).toEqual(["assistant", "session_update"]);
    expect(second.send.mock.calls.map(([raw]) => JSON.parse(String(raw)).type)).toEqual(["session_update"]);

    handleBrowserProtocolMessage(
      session,
      {
        type: "conversation_view_update",
        view: "thread",
        thread_key: "q-1831",
        from: 0,
        count: 30,
        section_count: 10,
        visible_count: 3,
        feed_window_sync_version: FEED_WINDOW_SYNC_VERSION,
      },
      second,
      deps,
    );
    second.send.mockClear();
    broadcastToBrowsers(
      session,
      {
        type: "assistant",
        message: { id: "a-live-2", role: "assistant", content: [{ type: "text", text: "live 2" }] },
        parent_tool_use_id: null,
        threadKey: "q-1831",
        questId: "q-1831",
      } as BrowserIncomingMessage,
      deps,
    );
    expect(second.send.mock.calls.map(([raw]) => JSON.parse(String(raw)).type)).toEqual(["assistant"]);
  });

  it("translates an authoritative full-history broadcast into the capable socket's bounded view", async () => {
    const ws = { data: {}, send: vi.fn() };
    const deps = makeInjectDeps();
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
      browserSockets: new Set(),
      messageHistory: [
        { type: "user_message", id: "main-noise", content: "noise", timestamp: 1 } as BrowserIncomingMessage,
        {
          type: "user_message",
          id: "selected",
          content: "selected",
          timestamp: 2,
          threadKey: "q-1831",
          questId: "q-1831",
          threadRefs: [{ threadKey: "q-1831", questId: "q-1831", source: "explicit" }],
        } as BrowserIncomingMessage,
      ],
    });
    handleBrowserOpen(session, ws, deps);
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
        thread_key: "q-1831",
        from_item: -1,
        item_count: 30,
        section_item_count: 10,
        visible_item_count: 3,
      },
      deps,
    );
    ws.send.mockClear();

    broadcastToBrowsers(session, { type: "message_history", messages: session.messageHistory }, deps);

    const calls = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    expect(calls.map((message) => message.type)).toEqual([
      "thread_window_sync",
      "feed_window_sync",
      "conversation_sync_complete",
    ]);
    expect(calls[0].entries).toEqual([
      expect.objectContaining({ message: expect.objectContaining({ id: "selected" }) }),
    ]);
    expect(JSON.stringify(calls)).not.toContain("main-noise");
  });
});

describe("programmatic user message injection", () => {
  it("routes direct composer user messages while a session is paused", async () => {
    const routeBrowserMessage = vi.fn();
    const deps = makeInjectDeps({ routeBrowserMessage });
    const session = makeSession({
      id: "session-1",
      state: { permissionMode: "default", pause: { pausedAt: 123, queuedMessages: [] } } as any,
    });

    await handleBrowserIngressMessage(
      session,
      { type: "user_message", content: "send now", session_id: "session-1", inputSource: "composer" },
      undefined,
      deps,
    );

    expect(session.state.pause?.queuedMessages).toHaveLength(0);
    expect(routeBrowserMessage).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ type: "user_message", content: "send now", inputSource: "composer" }),
      undefined,
    );
    expect(deps.broadcastError).not.toHaveBeenCalled();
  });

  it("routes prepared composer image references while a session is paused", async () => {
    const routeBrowserMessage = vi.fn();
    const deps = makeInjectDeps({ routeBrowserMessage });
    const session = makeSession({
      id: "session-1",
      state: { permissionMode: "default", pause: { pausedAt: 123, queuedMessages: [] } } as any,
    });

    await handleBrowserIngressMessage(
      session,
      {
        type: "user_message",
        content: "inspect this",
        session_id: "session-1",
        inputSource: "composer",
        imageRefs: [{ imageId: "img-1", media_type: "image/png" }] as any,
      },
      undefined,
      deps,
    );

    expect(session.state.pause?.queuedMessages).toHaveLength(0);
    expect(routeBrowserMessage).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ type: "user_message", content: "inspect this", imageRefs: expect.any(Array) }),
      undefined,
    );
    expect(deps.broadcastError).not.toHaveBeenCalled();
  });

  it("queues non-composer browser user messages while a session is paused", async () => {
    const deps = makeInjectDeps();
    const session = makeSession({
      state: { permissionMode: "default", pause: { pausedAt: 123, queuedMessages: [] } } as any,
    });

    const result = await handleBrowserIngressMessage(
      session,
      {
        type: "user_message",
        content: "hold this input",
        autoPauseRecoveries: [{ summaryId: "summary-1", groupId: "manual-group" }],
        recoveryDeliveryTransferId: "recovery-transfer-forged-manual",
      } as any,
      undefined,
      deps,
    );

    expect(result).toEqual({ status: "queued_manual_pause" });
    expect(session.state.pause?.queuedMessages).toHaveLength(1);
    expect(session.state.pause?.queuedMessages[0]).toMatchObject({
      source: "browser",
      message: {
        type: "user_message",
        content: "hold this input",
        autoPauseRecoveries: [{ summaryId: "summary-1", groupId: "manual-group" }],
      },
    });
    expect(JSON.stringify(session.state.pause)).not.toContain("recoveryDeliveryTransferId");
    expect(deps.routeBrowserMessage).not.toHaveBeenCalled();
    expect(deps.persistSession).toHaveBeenCalledWith(session);
    expect(deps.broadcastError).toHaveBeenCalledWith(
      session,
      "Session is paused. New work is held until unpause (1 held input).",
    );
  });

  it("routes direct human control messages while a session is paused", async () => {
    const routeBrowserMessage = vi.fn();
    const deps = makeInjectDeps({ routeBrowserMessage });
    const session = makeSession({
      state: { permissionMode: "default", pause: { pausedAt: 123, queuedMessages: [] } } as any,
    });

    await handleBrowserIngressMessage(
      session,
      { type: "permission_response", request_id: "ask-1", behavior: "allow" },
      undefined,
      deps,
    );

    expect(session.state.pause?.queuedMessages).toHaveLength(0);
    expect(routeBrowserMessage).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ type: "permission_response", request_id: "ask-1" }),
      undefined,
    );
    expect(deps.broadcastError).not.toHaveBeenCalled();
  });

  it("holds automatic browser messages during Codex result-error auto-pause", async () => {
    const deps = makeInjectDeps();
    const session = makeSession({
      state: {
        permissionMode: "default",
        codex_result_error_auto_pause: {
          family: "copilot_auth_refresh_exhausted",
          fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
          streak: 1,
          threshold: 1,
          pausedAt: 123,
          lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
          lastErrorAt: 123,
          lastSourceKind: "automatic",
          totalMatchingErrors: 1,
          heldInputs: [],
        },
      } as any,
    });

    const result = await handleBrowserIngressMessage(
      session,
      {
        type: "user_message",
        content: "timer event",
        agentSource: { sessionId: "timer:abc", sessionLabel: "Timer" },
        autoPauseRecoveries: [{ summaryId: "summary-1", groupId: "auto-group" }],
        recoveryDeliveryTransferId: "recovery-transfer-forged-auto",
      } as any,
      undefined,
      deps,
    );

    expect(result).toEqual({ status: "reheld_auto_pause" });
    expect(session.state.codex_result_error_auto_pause?.heldInputs).toHaveLength(1);
    expect(session.state.codex_result_error_auto_pause?.heldInputs[0]?.message.autoPauseRecoveries).toEqual([
      { summaryId: "summary-1", groupId: "auto-group" },
    ]);
    expect(JSON.stringify(session.state.codex_result_error_auto_pause)).not.toContain("recoveryDeliveryTransferId");
    expect(deps.routeBrowserMessage).not.toHaveBeenCalled();
    expect(deps.persistSession).toHaveBeenCalledWith(session);
    expect(deps.broadcastError).toHaveBeenCalledWith(
      session,
      expect.stringContaining("Automatic Codex input delivery paused"),
    );
  });

  it("routes direct composer messages during Codex result-error auto-pause", async () => {
    const routeBrowserMessage = vi.fn();
    const deps = makeInjectDeps({ routeBrowserMessage });
    const session = makeSession({
      id: "session-1",
      state: {
        permissionMode: "default",
        codex_result_error_auto_pause: {
          family: "copilot_auth_refresh_exhausted",
          fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
          streak: 1,
          threshold: 1,
          pausedAt: 123,
          lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
          lastErrorAt: 123,
          lastSourceKind: "automatic",
          totalMatchingErrors: 1,
          heldInputs: [],
        },
      } as any,
    });

    await handleBrowserIngressMessage(
      session,
      { type: "user_message", content: "manual test", session_id: "session-1", inputSource: "composer" },
      undefined,
      deps,
    );

    expect(session.state.codex_result_error_auto_pause?.heldInputs).toHaveLength(0);
    expect(routeBrowserMessage).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ type: "user_message", content: "manual test", inputSource: "composer" }),
      undefined,
    );
  });

  it("returns normal pending-delivery ownership only after the recovery links are durably admitted", async () => {
    // Returning from the route callback is insufficient: the released group must be discoverable in pending delivery.
    const link = { summaryId: "summary-1", groupId: "pending-group" };
    const session = makeSession({ backendType: "codex" });
    const deps = makeInjectDeps({
      routeBrowserMessage: vi.fn((target: BrowserTransportSessionLike) => {
        target.pendingCodexInputs.push({ id: "pending-1", autoPauseRecoveries: [link] } as any);
      }),
    });

    const result = await handleBrowserIngressMessage(
      session,
      { type: "user_message", content: "released event", autoPauseRecoveries: [link] },
      undefined,
      deps,
    );

    expect(result).toEqual({ status: "accepted_pending_delivery" });
  });

  it("recognizes an authoritative terminal receipt when routing settles before returning", async () => {
    const link = { summaryId: "summary-1", groupId: "terminal-group" };
    const session = makeSession({
      backendType: "codex",
      messageHistory: [
        {
          type: "codex_auto_pause_recovery_summary",
          id: link.summaryId,
          recovery: { receipts: [{ groupId: link.groupId, outcome: "failed" }] },
        } as any,
      ],
    });

    const result = await handleBrowserIngressMessage(
      session,
      { type: "user_message", content: "terminal event", autoPauseRecoveries: [link] },
      undefined,
      makeInjectDeps(),
    );

    expect(result).toEqual({ status: "terminal_receipt" });
  });

  it("reports a completed route with no pending or terminal owner instead of inferring admission", async () => {
    const link = { summaryId: "summary-1", groupId: "ownerless-group" };

    const result = await handleBrowserIngressMessage(
      makeSession({ backendType: "codex" }),
      { type: "user_message", content: "ownerless event", autoPauseRecoveries: [link] },
      undefined,
      makeInjectDeps(),
    );

    expect(result).toEqual({
      status: "ignored_no_owner",
      reason: "route_completed_without_owner",
      unownedRecoveryLinks: [link],
    });
  });

  it.each([
    ["direct", undefined],
    ["queued", Promise.resolve()],
  ])("returns terminal rejection for %s routing failures", async (_label, priorRoute) => {
    // Both immediate and serialized callback failures are swallowed for ordinary browser callers but explicit to drain.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeInjectDeps({
      getRouteChain: vi.fn(() => priorRoute),
      routeBrowserMessage: vi.fn(async () => {
        throw new Error("route rejected");
      }),
    });

    const result = await handleBrowserIngressMessage(
      makeSession({ backendType: "codex" }),
      {
        type: "user_message",
        content: "rejected event",
        autoPauseRecoveries: [{ summaryId: "summary-1", groupId: "rejected-group" }],
      },
      undefined,
      deps,
    );

    expect(result).toMatchObject({ status: "terminal_rejected", reason: "routing_error" });
    expect(result).toHaveProperty("unownedRecoveryLinks", [{ summaryId: "summary-1", groupId: "rejected-group" }]);
    expect(deps.broadcastError).toHaveBeenCalledWith(expect.anything(), "Failed to process message. Please retry.");
    errorSpy.mockRestore();
  });

  it("preserves pending ownership when a route throws after admitting the released group", async () => {
    // A late route exception must not overwrite an already durable pending owner with a false failed receipt.
    const link = { summaryId: "summary-1", groupId: "accepted-before-error" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeInjectDeps({
      routeBrowserMessage: vi.fn((target: BrowserTransportSessionLike) => {
        target.pendingCodexInputs.push({ id: "pending-before-error", autoPauseRecoveries: [link] } as any);
        throw new Error("late route error");
      }),
    });

    const result = await handleBrowserIngressMessage(
      makeSession({ backendType: "codex" }),
      { type: "user_message", content: "accepted event", autoPauseRecoveries: [link] },
      undefined,
      deps,
    );

    expect(result).toEqual({ status: "accepted_pending_delivery" });
    expect(deps.broadcastError).toHaveBeenCalledWith(expect.anything(), "Failed to process message. Please retry.");
    errorSpy.mockRestore();
  });

  it("rejects paused browser messages with raw images instead of silently processing them", async () => {
    const deps = makeInjectDeps();
    const session = makeSession({
      state: { permissionMode: "default", pause: { pausedAt: 123, queuedMessages: [] } } as any,
    });

    await handleBrowserIngressMessage(
      session,
      { type: "user_message", content: "image", images: [{ path: "/tmp/screenshot.png" }] } as any,
      undefined,
      deps,
    );

    expect(session.state.pause?.queuedMessages).toHaveLength(0);
    expect(deps.routeBrowserMessage).not.toHaveBeenCalled();
    expect(deps.broadcastError).toHaveBeenCalledWith(
      session,
      "Session is paused. Raw image messages cannot be safely held; unpause and retry.",
    );
  });

  it("keeps raw image rejection explicit even when a browser payload claims composer origin", async () => {
    const deps = makeInjectDeps();
    const session = makeSession({
      id: "session-1",
      state: { permissionMode: "default", pause: { pausedAt: 123, queuedMessages: [] } } as any,
    });

    await handleBrowserIngressMessage(
      session,
      {
        type: "user_message",
        content: "raw image",
        session_id: "session-1",
        inputSource: "composer",
        images: [{ media_type: "image/png", data: "raw-bytes" }],
      },
      undefined,
      deps,
    );

    expect(session.state.pause?.queuedMessages).toHaveLength(0);
    expect(deps.routeBrowserMessage).not.toHaveBeenCalled();
    expect(deps.broadcastError).toHaveBeenCalledWith(
      session,
      "Session is paused. Raw image messages cannot be safely held; unpause and retry.",
    );
  });

  it("passes reply and thread metadata through programmatic user-message injection", () => {
    const routeBrowserMessage = vi.fn();
    const deps = makeInjectDeps({ routeBrowserMessage });
    const session = makeSession({ id: "worker-1" });
    const threadRoute = {
      threadKey: "q-1242",
      questId: "q-1242",
      threadRefs: [{ threadKey: "q-1242", questId: "q-1242", source: "explicit" }],
    } as any;
    const vscodeSelection = {
      absolutePath: "/repo/web/src/App.tsx",
      relativePath: "web/src/App.tsx",
      displayPath: "web/src/App.tsx",
      startLine: 12,
      endLine: 14,
      lineCount: 3,
    };

    const delivery = injectUserMessage(
      session,
      "Answer: yes",
      { sessionId: "leader-1", sessionLabel: "Leader" },
      undefined,
      deps,
      threadRoute,
      {
        deliveryContent: "[reply] Confirm scope\n\nAnswer: yes",
        replyContext: { messageId: "msg-123", notificationId: "n-1", previewText: "Confirm scope" },
        sessionId: "worker-1",
        vscodeSelection,
      },
    );

    expect(delivery).toBe("sent");
    expect(routeBrowserMessage).toHaveBeenCalledWith(session, {
      type: "user_message",
      content: "Answer: yes",
      deliveryContent: "[reply] Confirm scope\n\nAnswer: yes",
      replyContext: { messageId: "msg-123", notificationId: "n-1", previewText: "Confirm scope" },
      session_id: "worker-1",
      vscodeSelection,
      agentSource: { sessionId: "leader-1", sessionLabel: "Leader" },
      threadKey: "q-1242",
      questId: "q-1242",
      threadRefs: [{ threadKey: "q-1242", questId: "q-1242", source: "explicit" }],
    });
  });
});

describe("Codex herd event injection", () => {
  it("reports a live Codex pending herd input as queued until retry accepts it", () => {
    const agentSource = { sessionId: "herd-events", sessionLabel: "Herd Events" };
    const session = makeSession({
      backendType: "codex",
      state: { permissionMode: "default", backend_state: "connected", cwd: "/repo" } as any,
    });
    const routeBrowserMessage = vi.fn((target: BrowserTransportSessionLike, msg: any) => {
      const id = `pending-${target.pendingCodexInputs.length + 1}`;
      target.pendingCodexInputs.push({
        id,
        content: msg.content,
        timestamp: Date.now(),
        cancelable: true,
        agentSource: msg.agentSource,
        threadKey: msg.threadKey,
      });
      target.pendingCodexTurns.push({
        userMessageId: id,
        pendingInputIds: [id],
        adapterMsg: { type: "codex_start_pending", inputIds: [id] } as any,
        status: "queued",
        turnTarget: "current",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dispatchCount: 0,
      } as any);
    });
    const queueCodexPendingStartBatch = vi.fn((target: BrowserTransportSessionLike) => {
      target.pendingCodexTurns[0]!.status = "dispatched";
    });
    const deps = makeInjectDeps({ routeBrowserMessage, queueCodexPendingStartBatch });
    const threadRoute = { threadKey: "q-975", questId: "q-975" } as any;

    const first = injectUserMessage(
      session,
      "1 event from 1 session\n\n#1270 | board_stalled | q-975 | EXPLORING | worker disconnected | stalled 571m | 16m ago",
      agentSource,
      undefined,
      deps,
      threadRoute,
    );
    expect(first).toBe("queued");
    expect(session.pendingCodexInputs).toHaveLength(1);

    const retry = injectUserMessage(
      session,
      "1 event from 1 session\n\n#1270 | board_stalled | q-975 | EXPLORING | worker disconnected | stalled 571m | 17m ago",
      agentSource,
      undefined,
      deps,
      threadRoute,
    );
    expect(retry).toBe("sent");
    expect(routeBrowserMessage).toHaveBeenCalledTimes(1);
    expect(session.pendingCodexInputs).toHaveLength(1);
    expect(queueCodexPendingStartBatch).toHaveBeenCalledWith(session, "inject_herd_event_retry");
  });

  it("reports Codex herd injections as queued while a browser route is already in flight", async () => {
    const agentSource = { sessionId: "herd-events", sessionLabel: "Herd Events" };
    const session = makeSession({
      backendType: "codex",
      state: { permissionMode: "default", backend_state: "connected", cwd: "/repo" } as any,
    });
    const routeBrowserMessage = vi.fn();
    let releaseInFlight!: () => void;
    const inFlightRoute = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });
    let currentRoute: Promise<void> | undefined = inFlightRoute;
    const deps = makeInjectDeps({
      routeBrowserMessage,
      getRouteChain: vi.fn(() => currentRoute),
      setRouteChain: vi.fn((_sessionId: string, route: Promise<void>) => {
        currentRoute = route;
      }),
      clearRouteChain: vi.fn((_sessionId: string, route: Promise<void>) => {
        if (currentRoute === route) currentRoute = undefined;
      }),
    });

    const delivery = injectUserMessage(
      session,
      "1 event from 1 session\n\n#1270 | turn_end | worker finished | 1m ago",
      agentSource,
      undefined,
      deps,
      { threadKey: "main" } as any,
    );

    expect(delivery).toBe("queued");
    expect(routeBrowserMessage).not.toHaveBeenCalled();

    releaseInFlight();
    await currentRoute;

    expect(routeBrowserMessage).toHaveBeenCalledTimes(1);
  });

  it("dedupes Codex herd retries while a browser route is still in flight", async () => {
    const agentSource = { sessionId: "herd-events", sessionLabel: "Herd Events" };
    const session = makeSession({
      backendType: "codex",
      state: { permissionMode: "default", backend_state: "connected", cwd: "/repo" } as any,
    });
    const routeBrowserMessage = vi.fn();
    let releaseInFlight!: () => void;
    const inFlightRoute = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });
    let currentRoute: Promise<void> | undefined = inFlightRoute;
    const deps = makeInjectDeps({
      routeBrowserMessage,
      getRouteChain: vi.fn(() => currentRoute),
      setRouteChain: vi.fn((_sessionId: string, route: Promise<void>) => {
        currentRoute = route;
      }),
      clearRouteChain: vi.fn((_sessionId: string, route: Promise<void>) => {
        if (currentRoute === route) currentRoute = undefined;
      }),
    });

    const first = injectUserMessage(
      session,
      "1 event from 1 session\n\n#1270 | turn_end | worker finished | 1m ago",
      agentSource,
      undefined,
      deps,
      { threadKey: "main" } as any,
    );
    const retry = injectUserMessage(
      session,
      "1 event from 1 session\n\n#1270 | turn_end | worker finished | 2m ago",
      agentSource,
      undefined,
      deps,
      { threadKey: "main" } as any,
    );

    expect(first).toBe("queued");
    expect(retry).toBe("queued");
    expect(deps.setRouteChain).toHaveBeenCalledTimes(1);
    expect(routeBrowserMessage).not.toHaveBeenCalled();

    releaseInFlight();
    await currentRoute;

    expect(routeBrowserMessage).toHaveBeenCalledTimes(1);
  });
});

describe("session subscribe timer sync", () => {
  it("sends an authoritative empty timer update so reconnect clears stale timer UI", async () => {
    const session = makeSession();
    const ws = { data: {}, send: vi.fn() } as any;
    const deps = makeInjectDeps({ listTimers: vi.fn(() => []) });

    await handleSessionSubscribe(
      session,
      ws,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      deps,
    );

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "timer_update", timers: [] }));
  });
});
